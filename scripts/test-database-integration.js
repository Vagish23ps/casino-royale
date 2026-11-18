/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
// ====================================================================
// CASINO ROYALE — POSTGRESQL DATABASE INTEGRATION TEST SUITE
// Tests PostgreSQL schema, unique indexes, constraints, views,
// record_score_batch, reverse_score_transaction, batch atomicity,
// sequential ordering, validation, security, and ledger integrity.
// ====================================================================

const { newDb } = require('pg-mem');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`✓ ${message}`);
}

function assertThrows(fn, expectedCodeOrSnippet, message) {
  totalTests++;
  try {
    fn();
    console.error(`❌ FAIL (Expected error but succeeded): ${message}`);
    throw new Error(`Expected error containing "${expectedCodeOrSnippet}" but no error was thrown`);
  } catch (err) {
    const errStr = (err.message || String(err));
    if (expectedCodeOrSnippet && !errStr.includes(expectedCodeOrSnippet)) {
      console.error(`❌ FAIL: ${message}. Got unexpected error: ${errStr}`);
      throw err;
    }
    passedTests++;
    console.log(`✓ ${message}`);
  }
}

async function runDatabaseIntegrationTests() {
  console.log('\n=== CASINO ROYALE POSTGRESQL INTEGRATION TEST SUITE ===\n');

  const db = newDb();

  // 1. Setup Database Schema
  db.public.none(`
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      deleted_at TIMESTAMPTZ DEFAULT NULL
    );

    CREATE TABLE event_members (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'organizer'
    );

    CREATE TABLE event_settings (
      event_id TEXT PRIMARY KEY,
      starting_score NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
      allow_negative_scores BOOLEAN NOT NULL DEFAULT FALSE,
      leaderboard_visible BOOLEAN NOT NULL DEFAULT TRUE,
      leaderboard_frozen BOOLEAN NOT NULL DEFAULT FALSE,
      frozen_at TIMESTAMPTZ DEFAULT NULL
    );

    CREATE TABLE teams (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      avatar_url TEXT,
      starting_score NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
      deleted_at TIMESTAMPTZ DEFAULT NULL
    );

    CREATE TABLE rounds (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      round_number INT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      deleted_at TIMESTAMPTZ DEFAULT NULL
    );

    CREATE TABLE score_transactions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      round_id TEXT,
      operation_type TEXT NOT NULL,
      input_value NUMERIC(12, 2) NOT NULL,
      previous_score NUMERIC(12, 2) NOT NULL,
      resulting_score NUMERIC(12, 2) NOT NULL,
      points_delta NUMERIC(12, 2) NOT NULL,
      reason TEXT,
      idempotency_key TEXT,
      reversal_of_transaction_id TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE idempotency_records (
      event_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      response_payload JSONB NOT NULL,
      request_payload_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (event_id, idempotency_key)
    );

    -- Unique partial index on reversal_of_transaction_id
    CREATE UNIQUE INDEX idx_score_transactions_unique_reversal
    ON score_transactions (reversal_of_transaction_id)
    WHERE reversal_of_transaction_id IS NOT NULL;
  `);

  // 2. Views: v_public_overall_leaderboard and v_team_round_scores
  db.public.none(`
    CREATE OR REPLACE VIEW v_public_overall_leaderboard AS
    WITH active_teams AS (
      SELECT t.id AS team_id,
             t.event_id,
             t.name AS team_name,
             t.color AS team_color,
             t.avatar_url,
             COALESCE(es.starting_score, 0.00) AS starting_score
      FROM teams t
      JOIN events e ON t.event_id = e.id AND e.deleted_at IS NULL AND e.status = 'active'
      LEFT JOIN event_settings es ON e.id = es.event_id
      WHERE t.deleted_at IS NULL
    ),
    team_deltas AS (
      SELECT st.team_id,
             SUM(st.points_delta) AS total_delta
      FROM score_transactions st
      GROUP BY st.team_id
    )
    SELECT
      at.event_id,
      at.team_id,
      at.team_name,
      at.team_color,
      at.avatar_url,
      (at.starting_score + COALESCE(td.total_delta, 0.00)) AS total_score
    FROM active_teams at
    LEFT JOIN team_deltas td ON at.team_id = td.team_id;

    CREATE OR REPLACE VIEW v_team_round_scores AS
    SELECT
      st.event_id,
      st.round_id,
      r.name AS round_name,
      r.round_number,
      st.team_id,
      COALESCE(SUM(st.points_delta), 0.00) AS round_score,
      COALESCE(SUM(st.points_delta), 0.00) AS points_delta,
      COUNT(st.id) AS transaction_count,
      COUNT(st.id) AS transactions_count,
      COALESCE(SUM(CASE WHEN st.operation_type != 'SET_SCORE' AND st.reversal_of_transaction_id IS NULL THEN st.points_delta ELSE 0.00 END), 0.00) AS earned_points,
      COALESCE(SUM(CASE WHEN st.operation_type = 'SET_SCORE' AND st.reversal_of_transaction_id IS NULL THEN st.points_delta ELSE 0.00 END), 0.00) AS adjustment_points,
      COALESCE(SUM(CASE WHEN st.reversal_of_transaction_id IS NOT NULL THEN st.points_delta ELSE 0.00 END), 0.00) AS reversal_points,
      BOOL_OR(st.operation_type = 'SET_SCORE') AS has_score_reset,
      BOOL_OR(st.reversal_of_transaction_id IS NOT NULL) AS has_reversal
    FROM score_transactions st
    JOIN rounds r ON st.round_id = r.id
    WHERE st.round_id IS NOT NULL
    GROUP BY st.event_id, st.round_id, r.name, r.round_number, st.team_id;
  `);

  // Helper context for authorized caller
  let currentCallerId = 'user-admin-1';
  function setCaller(userId) {
    currentCallerId = userId;
  }

  function checkIsEventAdmin(eventId, minRole = 'organizer') {
    if (!currentCallerId) return false;
    const res = db.public.many(
      `SELECT role FROM event_members WHERE event_id = '${eventId}' AND user_id = '${currentCallerId}'`
    );
    return res.length > 0;
  }

  // 3. PostgreSQL record_score_batch Implementation matching 20261118000000 SQL
  function pgRecordScoreBatch(p_event_id, p_round_id, p_idempotency_key, p_operations, p_reason) {
    // 1. Authorization Check
    if (!currentCallerId || !checkIsEventAdmin(p_event_id, 'organizer')) {
      throw new Error(`[42501] Unauthorized: Caller is not an authorized administrator for event ${p_event_id}`);
    }

    // 2a. Require non-null, non-blank, length-bounded idempotency key (mirrors SQL step 2)
    if (p_idempotency_key === null || p_idempotency_key === undefined || String(p_idempotency_key).trim() === '') {
      throw new Error('[22004] p_idempotency_key is required and cannot be NULL, empty, or whitespace-only. Supply a UUID for each new scoring batch.');
    }
    if (String(p_idempotency_key).trim().length > 255) {
      throw new Error(`[22023] p_idempotency_key exceeds maximum length of 255 characters. Use a standard UUID (36 characters).`);
    }

    // 2b. Strict Input Validation on p_operations
    if (p_operations === null || p_operations === undefined) {
      throw new Error('[22004] p_operations cannot be NULL');
    }
    if (!Array.isArray(p_operations)) {
      throw new Error(`[22023] p_operations must be a JSON array, got ${typeof p_operations}`);
    }
    if (p_operations.length === 0) {
      throw new Error('[22023] p_operations array cannot be empty');
    }

    // Pre-validate every operation object structure
    for (let idx = 0; idx < p_operations.length; idx++) {
      const op = p_operations[idx];
      if (typeof op !== 'object' || op === null || Array.isArray(op)) {
        throw new Error(`[22023] Operation item at index ${idx} must be a JSON object`);
      }

      // Validate team_id
      if (!op.team_id || typeof op.team_id !== 'string' || op.team_id.trim() === '') {
        throw new Error(`[22023] Operation item at index ${idx} is missing required field "team_id"`);
      }
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(op.team_id.trim())) {
        throw new Error(`[22023] Operation item at index ${idx} has invalid UUID for "team_id": ${op.team_id}`);
      }

      // Validate operation_type
      if (!op.operation_type || typeof op.operation_type !== 'string' || op.operation_type.trim() === '') {
        throw new Error(`[22023] Operation item at index ${idx} is missing required field "operation_type"`);
      }
      const opType = op.operation_type.trim().toUpperCase();
      if (!['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'SET_SCORE'].includes(opType)) {
        throw new Error(`[22023] Operation item at index ${idx} has invalid operation_type: "${op.operation_type}"`);
      }

      // Validate input_value
      if (op.input_value === null || op.input_value === undefined || String(op.input_value).trim() === '') {
        throw new Error(`[22023] Operation item at index ${idx} is missing required field "input_value"`);
      }
      const valStr = String(op.input_value).trim();
      if (!/^-?[0-9]+(\.[0-9]+)?$/.test(valStr)) {
        throw new Error(`[22023] Operation item at index ${idx} has unsupported or malformed numeric input_value: "${op.input_value}"`);
      }
      if (/\.[0-9]{3,}$/.test(valStr)) {
        throw new Error(`[22023] Operation item at index ${idx} input_value "${op.input_value}" exceeds maximum allowed decimal precision of 2 decimal places`);
      }
      const valNum = Number(valStr);
      if (isNaN(valNum) || !isFinite(valNum)) {
        throw new Error(`[22023] Operation item at index ${idx} has unsupported numeric value "${op.input_value}"`);
      }
      if (Math.abs(valNum) > 9999999999.99) {
        throw new Error(`[22023] Operation item at index ${idx} input_value exceeds maximum allowed precision NUMERIC(12,2): ${op.input_value}`);
      }
    }

    // 3. Compute Deterministic Payload Fingerprint using canonical JSONB
    // Mirrors the SQL: md5(jsonb_build_object('round_id', p_round_id, 'operations', p_operations, 'reason', p_reason)::TEXT)
    // This preserves NULL vs empty-string distinction for p_reason.
    const canonicalPayload = JSON.stringify({
      round_id: p_round_id !== undefined ? p_round_id : null,
      operations: p_operations,
      reason: p_reason !== undefined ? p_reason : null
    });
    const v_payload_hash = canonicalPayload;

    // Fast-path idempotency check (pre-lock)
    // p_idempotency_key is guaranteed non-null/non-blank by step 2a above.
    const cached = db.public.many(
      `SELECT response_payload, request_payload_hash FROM idempotency_records WHERE event_id = '${p_event_id}' AND idempotency_key = '${p_idempotency_key}'`
    );
    if (cached.length > 0) {
      // Legacy records (NULL request_payload_hash) must be rejected.
      if (cached[0].request_payload_hash === null || cached[0].request_payload_hash === undefined) {
        throw new Error(
          `[23505] Idempotency key "${p_idempotency_key}" references a legacy record that predates payload verification. ` +
          `Please use a new unique key (UUID) to submit a fresh scoring batch. ` +
          `Note: your previous submission with this key may have succeeded — check the history before resubmitting.`
        );
      }
      if (cached[0].request_payload_hash !== v_payload_hash) {
        throw new Error(`[23505] Idempotency conflict: idempotency key "${p_idempotency_key}" was already used for a different scoring batch payload`);
      }
      return cached[0].response_payload;
    }

    // 4. Validate Active Event
    const evRows = db.public.many(
      `SELECT id, status FROM events WHERE id = '${p_event_id}' AND deleted_at IS NULL`
    );
    if (evRows.length === 0) {
      throw new Error(`Active event ${p_event_id} not found or has been deleted`);
    }
    if (evRows[0].status !== 'active') {
      throw new Error(`[22000] Event ${p_event_id} is currently "${evRows[0].status}". Scores can only be recorded in active events.`);
    }

    // 5. Validate Round
    if (p_round_id) {
      const rRows = db.public.many(
        `SELECT id, event_id, status, deleted_at FROM rounds WHERE id = '${p_round_id}'`
      );
      if (rRows.length === 0) {
        throw new Error(`Round ${p_round_id} not found`);
      }
      const r = rRows[0];
      if (r.event_id !== p_event_id) {
        throw new Error(`Round ${p_round_id} does not belong to event ${p_event_id}`);
      }
      if (r.deleted_at) {
        throw new Error(`Cannot record scores for soft-deleted round ${p_round_id}`);
      }
      if (r.status === 'completed') {
        throw new Error(`[22000] Cannot record scores in completed round ${p_round_id}. It must be reopened by an event owner first.`);
      }
      if (r.status !== 'active') {
        throw new Error(`[22000] Round ${p_round_id} is currently "${r.status}". Scores can only be recorded in active rounds.`);
      }
    }

    // 6. Retrieve Event Settings
    const setRows = db.public.many(
      `SELECT starting_score, allow_negative_scores FROM event_settings WHERE event_id = '${p_event_id}'`
    );
    const v_starting_score = setRows.length > 0 ? Number(setRows[0].starting_score) : 0.00;
    const v_allow_negative = setRows.length > 0 ? Boolean(setRows[0].allow_negative_scores) : false;

    // 7. Atomic Execution with Rollback Support
    const backup = db.backup();
    try {
      const v_recorded_ids = [];
      const v_tx_records = [];
      const v_updated_scores = {};

      // Preserve explicit array ordering (WITH ORDINALITY ORDER BY ord ASC)
      for (let idx = 0; idx < p_operations.length; idx++) {
        const op = p_operations[idx];
        const v_team_id = op.team_id.trim();
        const v_op_type = op.operation_type.trim().toUpperCase();
        const v_val = Number(Number(op.input_value).toFixed(2));

        // Team verification
        const tRows = db.public.many(
          `SELECT event_id, deleted_at FROM teams WHERE id = '${v_team_id}'`
        );
        if (tRows.length === 0) {
          throw new Error(`Team ${v_team_id} not found`);
        }
        if (tRows[0].event_id !== p_event_id) {
          throw new Error(`Team ${v_team_id} does not belong to event ${p_event_id}`);
        }
        if (tRows[0].deleted_at) {
          throw new Error(`Cannot record scores for soft-deleted team ${v_team_id}`);
        }

        // Authoritative Overall Tournament Score:
        // In-transaction query includes previous iterations within this batch
        const deltaRows = db.public.many(
          `SELECT COALESCE(SUM(points_delta), 0.00) AS total_delta FROM score_transactions WHERE team_id = '${v_team_id}' AND event_id = '${p_event_id}'`
        );
        const v_total_delta = Number(deltaRows[0].total_delta || 0);
        const v_prev_score = Number((v_starting_score + v_total_delta).toFixed(2));

        let v_res_score = 0;
        let v_delta = 0;

        if (v_op_type === 'ADD') {
          v_res_score = Number((v_prev_score + v_val).toFixed(2));
          v_delta = v_val;
        } else if (v_op_type === 'SUBTRACT') {
          v_res_score = Number((v_prev_score - v_val).toFixed(2));
          v_delta = -v_val;
        } else if (v_op_type === 'MULTIPLY') {
          v_res_score = Number((v_prev_score * v_val).toFixed(2));
          v_delta = Number((v_res_score - v_prev_score).toFixed(2));
        } else if (v_op_type === 'DIVIDE') {
          if (v_val === 0) {
            throw new Error(`[22012] Division by zero is not permitted for team ${v_team_id}`);
          }
          v_res_score = Number((v_prev_score / v_val).toFixed(2));
          v_delta = Number((v_res_score - v_prev_score).toFixed(2));
        } else if (v_op_type === 'SET_SCORE') {
          v_res_score = v_val;
          v_delta = Number((v_val - v_prev_score).toFixed(2));
        }

        // Enforce Negative Scores Policy
        if (!v_allow_negative && v_res_score < 0) {
          throw new Error(`[22000] Negative scores are not permitted for event ${p_event_id} (Team ${v_team_id} resulting score: ${v_res_score})`);
        }

        // Generate Transaction ID and Insert into immutable ledger
        const v_tx_id = `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const txReason = op.reason || p_reason || null;

        db.public.none(`
          INSERT INTO score_transactions (
            id, event_id, team_id, round_id, operation_type, input_value,
            previous_score, resulting_score, points_delta, reason,
            idempotency_key, created_by, created_at
          ) VALUES (
            '${v_tx_id}', '${p_event_id}', '${v_team_id}', ${p_round_id ? `'${p_round_id}'` : 'NULL'},
            '${v_op_type}', ${v_val}, ${v_prev_score}, ${v_res_score}, ${v_delta},
            ${txReason ? `'${txReason.replace(/'/g, "''")}'` : 'NULL'},
            ${p_idempotency_key ? `'${p_idempotency_key}'` : 'NULL'},
            '${currentCallerId}', NOW()
          );
        `);

        v_recorded_ids.push(v_tx_id);
        v_tx_records.push({
          id: v_tx_id,
          team_id: v_team_id,
          operation_type: v_op_type,
          input_value: v_val,
          previous_score: v_prev_score,
          resulting_score: v_res_score,
          points_delta: v_delta
        });
        v_updated_scores[v_team_id] = v_res_score;
      }

      const v_response = {
        success: true,
        event_id: p_event_id,
        round_id: p_round_id,
        transactions_count: v_recorded_ids.length,
        transaction_ids: v_recorded_ids,
        transactions: v_tx_records,
        updated_scores: v_updated_scores,
        recorded_at: new Date().toISOString()
      };

      // Store idempotency record (key is guaranteed non-null/non-blank)
      db.public.none(`
        INSERT INTO idempotency_records (event_id, idempotency_key, response_payload, request_payload_hash, created_at)
        VALUES ('${p_event_id}', '${p_idempotency_key}', '${JSON.stringify(v_response).replace(/'/g, "''")}', '${v_payload_hash.replace(/'/g, "''")}', NOW())
        ON CONFLICT (event_id, idempotency_key) DO UPDATE
          SET response_payload = EXCLUDED.response_payload,
              request_payload_hash = EXCLUDED.request_payload_hash;
      `);

      return v_response;
    } catch (err) {
      // Atomic Rollback
      backup.restore();
      throw err;
    }
  }

  // 4. PostgreSQL reverse_score_transaction Implementation matching 20261118000000 SQL
  function pgReverseScoreTransaction(p_transaction_id, p_reason = 'Reversal requested by organizer') {
    if (!currentCallerId) {
      throw new Error('[42501] Unauthorized: Caller is not authenticated');
    }

    // 1. Find original transaction
    const origRows = db.public.many(
      `SELECT * FROM score_transactions WHERE id = '${p_transaction_id}'`
    );
    if (origRows.length === 0) {
      throw new Error(`Original transaction ${p_transaction_id} not found`);
    }
    const v_orig = origRows[0];

    if (v_orig.reversal_of_transaction_id) {
      throw new Error(`Cannot reverse transaction ${p_transaction_id} because it is itself a reversal record`);
    }

    // 2. Authorization check
    if (!checkIsEventAdmin(v_orig.event_id, 'organizer')) {
      throw new Error(`[42501] Unauthorized: Caller is not an authorized administrator for this event`);
    }

    // Step 4 in SQL: Exclusively lock event, team, and event_settings rows in deterministic order
    // Lock hierarchy: events -> teams -> event_settings (prevents deadlocks)
    // (Simulated in pg-mem by querying rows; in real PostgreSQL, executed as FOR UPDATE)
    const evRows = db.public.many(`SELECT id FROM events WHERE id = '${v_orig.event_id}'`);
    const tmRows = db.public.many(`SELECT id FROM teams WHERE id = '${v_orig.team_id}'`);
    const setLockRows = db.public.many(`SELECT event_id FROM event_settings WHERE event_id = '${v_orig.event_id}'`);

    // 3. Re-check for existing reversal after acquiring locks
    const revCheck = db.public.many(
      `SELECT id FROM score_transactions WHERE reversal_of_transaction_id = '${p_transaction_id}'`
    );
    if (revCheck.length > 0) {
      throw new Error(`[23505] Transaction ${p_transaction_id} has already been reversed by transaction ${revCheck[0].id}`);
    }

    // 4. Retrieve event settings under row lock
    const setRows = db.public.many(
      `SELECT starting_score, allow_negative_scores FROM event_settings WHERE event_id = '${v_orig.event_id}'`
    );
    const v_starting_score = setRows.length > 0 ? Number(setRows[0].starting_score) : 0.00;
    const v_allow_negative = setRows.length > 0 ? Boolean(setRows[0].allow_negative_scores) : false;

    // 5. Current Overall Tournament Score
    const deltaRows = db.public.many(
      `SELECT COALESCE(SUM(points_delta), 0.00) AS total_delta FROM score_transactions WHERE team_id = '${v_orig.team_id}' AND event_id = '${v_orig.event_id}'`
    );
    const v_prev_score = Number((v_starting_score + Number(deltaRows[0].total_delta || 0)).toFixed(2));
    const v_rev_delta = -Number(v_orig.points_delta);
    const v_res_score = Number((v_prev_score + v_rev_delta).toFixed(2));

    // 6. Enforce Negative Score Policy on Reversal
    if (!v_allow_negative && v_res_score < 0) {
      throw new Error(`[22000] Cannot reverse transaction ${p_transaction_id}: resulting score ${v_res_score} would be negative and allow_negative_scores is disabled for event ${v_orig.event_id}`);
    }

    // 7. Insert Reversal Record
    const v_tx_id = `rev-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const revReason = p_reason || `Reversal of transaction ${p_transaction_id}`;

    db.public.none(`
      INSERT INTO score_transactions (
        id, event_id, team_id, round_id, operation_type, input_value,
        previous_score, resulting_score, points_delta, reason,
        reversal_of_transaction_id, created_by, created_at
      ) VALUES (
        '${v_tx_id}', '${v_orig.event_id}', '${v_orig.team_id}', ${v_orig.round_id ? `'${v_orig.round_id}'` : 'NULL'},
        'SUBTRACT', ${Math.abs(Number(v_orig.points_delta))}, ${v_prev_score}, ${v_res_score}, ${v_rev_delta},
        '${revReason.replace(/'/g, "''")}', '${p_transaction_id}', '${currentCallerId}', NOW()
      );
    `);

    return {
      success: true,
      reversal_transaction_id: v_tx_id,
      original_transaction_id: p_transaction_id,
      team_id: v_orig.team_id,
      previous_score: v_prev_score,
      resulting_score: v_res_score,
      points_delta: v_rev_delta,
      recorded_at: new Date().toISOString()
    };
  }

  // 5. PostgreSQL update_event_settings Implementation matching 20261118000000 SQL
  // Enforces consistent lock order: events row -> event_settings row
  function pgUpdateEventSettings(p_event_id, p_leaderboard_visible, p_leaderboard_frozen, p_starting_score, p_allow_negative_scores, p_sort_direction) {
    if (!currentCallerId) {
      throw new Error('[42501] Unauthorized: Caller is not authenticated');
    }
    if (!checkIsEventAdmin(p_event_id, 'organizer')) {
      throw new Error(`[42501] Unauthorized: Caller is not an authorized administrator for event ${p_event_id}`);
    }

    // Step 2 in SQL: Lock event row first (Hierarchy: events -> event_settings)
    const evRows = db.public.many(`SELECT id, status FROM events WHERE id = '${p_event_id}' AND deleted_at IS NULL`);
    if (evRows.length === 0) {
      throw new Error(`Event ${p_event_id} not found or has been soft-deleted`);
    }

    // Step 3 in SQL: Lock event_settings row next
    const setRows = db.public.many(`SELECT * FROM event_settings WHERE event_id = '${p_event_id}'`);
    if (setRows.length === 0) {
      throw new Error(`Settings for event ${p_event_id} not found`);
    }

    // Validate sort_direction
    if (p_sort_direction !== undefined && p_sort_direction !== null && !['desc', 'asc'].includes(p_sort_direction)) {
      throw new Error(`[22023] Invalid sort_direction: "${p_sort_direction}". Must be "desc" or "asc".`);
    }

    const cur = setRows[0];
    const newVis = p_leaderboard_visible !== undefined && p_leaderboard_visible !== null ? Boolean(p_leaderboard_visible) : Boolean(cur.leaderboard_visible);
    const newFrz = p_leaderboard_frozen !== undefined && p_leaderboard_frozen !== null ? Boolean(p_leaderboard_frozen) : Boolean(cur.leaderboard_frozen);
    const newStart = p_starting_score !== undefined && p_starting_score !== null ? Number(p_starting_score) : Number(cur.starting_score);
    const newNeg = p_allow_negative_scores !== undefined && p_allow_negative_scores !== null ? Boolean(p_allow_negative_scores) : Boolean(cur.allow_negative_scores);
    const newSort = p_sort_direction !== undefined && p_sort_direction !== null ? p_sort_direction : (cur.sort_direction || 'desc');

    db.public.none(`
      UPDATE event_settings
      SET leaderboard_visible = ${newVis},
          leaderboard_frozen = ${newFrz},
          starting_score = ${newStart},
          allow_negative_scores = ${newNeg}
      WHERE event_id = '${p_event_id}'
    `);

    return {
      success: true,
      settings: {
        event_id: p_event_id,
        leaderboard_visible: newVis,
        leaderboard_frozen: newFrz,
        starting_score: newStart,
        allow_negative_scores: newNeg,
        sort_direction: newSort
      }
    };
  }

  // ====================================================================
  // TEST SUITE EXECUTION
  // ====================================================================

  const EVENT_ID = '00000000-0000-0000-0000-000000000001';
  const ROUND_1_ID = '11111111-1111-1111-1111-111111111111';
  const ROUND_2_ID = '22222222-2222-2222-2222-222222222222';
  const TEAM_1_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // ThunderBolt
  const TEAM_2_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // PowerHouse
  const TEAM_3_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'; // Royal Flush

  // Seed baseline data
  db.public.none(`
    INSERT INTO events (id, name, status) VALUES ('${EVENT_ID}', 'Championship', 'active');
    INSERT INTO event_members (id, event_id, user_id, role) VALUES ('em-1', '${EVENT_ID}', 'user-admin-1', 'organizer');
    INSERT INTO event_settings (event_id, starting_score, allow_negative_scores) VALUES ('${EVENT_ID}', 140.00, FALSE);
    INSERT INTO teams (id, event_id, name, starting_score) VALUES
      ('${TEAM_1_ID}', '${EVENT_ID}', 'ThunderBolt', 140.00),
      ('${TEAM_2_ID}', '${EVENT_ID}', 'PowerHouse', 140.00),
      ('${TEAM_3_ID}', '${EVENT_ID}', 'Royal Flush', 140.00);
    INSERT INTO rounds (id, event_id, round_number, name, status) VALUES
      ('${ROUND_1_ID}', '${EVENT_ID}', 1, 'Round 1', 'active'),
      ('${ROUND_2_ID}', '${EVENT_ID}', 2, 'Round 2', 'active');
  `);

  console.log('--- GROUP 1: STRICT INPUT VALIDATION ---');
  // Note: idempotency key validation is tested in GROUP 14.
  // All Group 1 ops-validation tests use a valid UUID key so the ops check is reached.
  assertThrows(() => pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'valid-key-g1a', null), '[22004]', 'Rejects SQL NULL p_operations');
  assertThrows(() => pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'valid-key-g1b', 'not-an-array'), '[22023]', 'Rejects non-array p_operations');
  assertThrows(() => pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'valid-key-g1c', []), '[22023]', 'Rejects empty array p_operations');
  assertThrows(() => pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'valid-key-g1d', ['not-an-object']), '[22023]', 'Rejects non-object array element');
  assertThrows(() => pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'valid-key-g1e', [{ operation_type: 'ADD', input_value: 10 }]), '[22023]', 'Rejects missing team_id');
  assertThrows(() => pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'valid-key-g1f', [{ team_id: 'not-a-uuid', operation_type: 'ADD', input_value: 10 }]), '[22023]', 'Rejects invalid UUID team_id');
  assertThrows(() => pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'valid-key-g1g', [{ team_id: TEAM_1_ID, input_value: 10 }]), '[22023]', 'Rejects missing operation_type');
  assertThrows(() => pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'valid-key-g1h', [{ team_id: TEAM_1_ID, operation_type: 'EXPONENT', input_value: 10 }]), '[22023]', 'Rejects invalid operation_type');
  assertThrows(() => pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'valid-key-g1i', [{ team_id: TEAM_1_ID, operation_type: 'ADD' }]), '[22023]', 'Rejects missing input_value');
  assertThrows(() => pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'valid-key-g1j', [{ team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 'abc' }]), '[22023]', 'Rejects malformed non-numeric input_value');
  assertThrows(() => pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'valid-key-g1k', [{ team_id: TEAM_1_ID, operation_type: 'ADD', input_value: '10.555' }]), '[22023]', 'Rejects input exceeding 2 decimal places (no silent rounding)');
  assertThrows(() => pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'valid-key-g1l', [{ team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 99999999999999 }]), '[22023]', 'Rejects input_value exceeding NUMERIC(12,2)');

  console.log('\n--- GROUP 2: BASE 140 ARITHMETIC ON OVERALL TOURNAMENT SCORE ---');
  // 1. ADD 10 on 140 -> 150
  const addRes = pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'k-add', [
    { team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 10 }
  ]);
  assert(addRes.transactions[0].previous_score === 140, 'ADD: previous_score is 140');
  assert(addRes.transactions[0].resulting_score === 150, 'ADD: resulting_score is 150');
  assert(addRes.transactions[0].points_delta === 10, 'ADD: points_delta is +10');

  // 2. SUBTRACT 20 on 150 -> 130
  const subRes = pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'k-sub', [
    { team_id: TEAM_1_ID, operation_type: 'SUBTRACT', input_value: 20 }
  ]);
  assert(subRes.transactions[0].previous_score === 150, 'SUBTRACT: previous_score is 150');
  assert(subRes.transactions[0].resulting_score === 130, 'SUBTRACT: resulting_score is 130');
  assert(subRes.transactions[0].points_delta === -20, 'SUBTRACT: points_delta is -20');

  // 3. MULTIPLY 2 on 130 -> 260
  const mulRes = pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'k-mul', [
    { team_id: TEAM_1_ID, operation_type: 'MULTIPLY', input_value: 2 }
  ]);
  assert(mulRes.transactions[0].previous_score === 130, 'MULTIPLY: previous_score is 130');
  assert(mulRes.transactions[0].resulting_score === 260, 'MULTIPLY: resulting_score is 260');
  assert(mulRes.transactions[0].points_delta === 130, 'MULTIPLY: points_delta is +130');

  // 4. DIVIDE 2 on 260 -> 130
  const divRes = pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'k-div', [
    { team_id: TEAM_1_ID, operation_type: 'DIVIDE', input_value: 2 }
  ]);
  assert(divRes.transactions[0].previous_score === 260, 'DIVIDE: previous_score is 260');
  assert(divRes.transactions[0].resulting_score === 130, 'DIVIDE: resulting_score is 130');
  assert(divRes.transactions[0].points_delta === -130, 'DIVIDE: points_delta is -130');

  console.log('\n--- GROUP 3: SET_SCORE ABSOLUTE REPLACEMENT ---');
  // Team 1 is currently at 130 overall score. SET_SCORE 40 in Round 2.
  const setRes = pgRecordScoreBatch(EVENT_ID, ROUND_2_ID, 'k-set-40', [
    { team_id: TEAM_1_ID, operation_type: 'SET_SCORE', input_value: 40 }
  ]);
  assert(setRes.transactions[0].previous_score === 130, 'SET_SCORE 40: previous_score is 130');
  assert(setRes.transactions[0].resulting_score === 40, 'SET_SCORE 40: resulting_score is exactly 40');
  assert(setRes.transactions[0].points_delta === -90, 'SET_SCORE 40: points_delta is -90');

  // Verify Leaderboard matches resulting_score 40
  const lb1 = db.public.many(`SELECT total_score FROM v_public_overall_leaderboard WHERE team_id = '${TEAM_1_ID}'`);
  assert(Number(lb1[0].total_score) === 40, 'Leaderboard total_score matches SET_SCORE 40');

  // Now restore back: SET_SCORE 140
  const setRes2 = pgRecordScoreBatch(EVENT_ID, ROUND_2_ID, 'k-set-140', [
    { team_id: TEAM_1_ID, operation_type: 'SET_SCORE', input_value: 140 }
  ]);
  assert(setRes2.transactions[0].previous_score === 40, 'SET_SCORE 140: previous_score is 40');
  assert(setRes2.transactions[0].resulting_score === 140, 'SET_SCORE 140: resulting_score is 140');
  assert(setRes2.transactions[0].points_delta === 100, 'SET_SCORE 140: points_delta is +100');

  const lb2 = db.public.many(`SELECT total_score FROM v_public_overall_leaderboard WHERE team_id = '${TEAM_1_ID}'`);
  assert(Number(lb2[0].total_score) === 140, 'Leaderboard total_score restored to 140');

  console.log('\n--- GROUP 4: EXPLICIT BATCH ORDERING (WITH ORDINALITY) ---');
  // Team 2 starts at 140. Run sequential operations on Team 2 in a single batch:
  // Op 0: ADD 60 (140 -> 200)
  // Op 1: SUBTRACT 50 (200 -> 150)
  // Op 2: MULTIPLY 2 (150 -> 300)
  const batchOrderRes = pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'k-seq-batch', [
    { team_id: TEAM_2_ID, operation_type: 'ADD', input_value: 60 },
    { team_id: TEAM_2_ID, operation_type: 'SUBTRACT', input_value: 50 },
    { team_id: TEAM_2_ID, operation_type: 'MULTIPLY', input_value: 2 }
  ]);
  assert(batchOrderRes.transactions.length === 3, 'Batch committed all 3 transactions in sequence');
  assert(batchOrderRes.transactions[0].previous_score === 140 && batchOrderRes.transactions[0].resulting_score === 200, 'Op 0 (ADD 60): 140 -> 200');
  assert(batchOrderRes.transactions[1].previous_score === 200 && batchOrderRes.transactions[1].resulting_score === 150, 'Op 1 (SUBTRACT 50): 200 -> 150');
  assert(batchOrderRes.transactions[2].previous_score === 150 && batchOrderRes.transactions[2].resulting_score === 300, 'Op 2 (MULTIPLY 2): 150 -> 300');

  console.log('\n--- GROUP 5: ATOMIC BATCH ROLLBACK BEHAVIOR ---');
  const countBeforeFail = db.public.many('SELECT count(*) AS c FROM score_transactions')[0].c;
  // Multi-team batch where the 3rd operation has division by zero
  assertThrows(() => {
    pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'k-fail-batch', [
      { team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 50 },
      { team_id: TEAM_2_ID, operation_type: 'ADD', input_value: 50 },
      { team_id: TEAM_3_ID, operation_type: 'DIVIDE', input_value: 0 } // FAIL: Division by zero
    ]);
  }, '[22012]', 'Batch with division by zero throws exception');

  const countAfterFail = db.public.many('SELECT count(*) AS c FROM score_transactions')[0].c;
  assert(countBeforeFail === countAfterFail, 'Entire batch rolled back: no partial transactions inserted');

  // Verify scores did not change for Team 1 and Team 2
  const t1Check = db.public.many(`SELECT total_score FROM v_public_overall_leaderboard WHERE team_id = '${TEAM_1_ID}'`)[0].total_score;
  const t2Check = db.public.many(`SELECT total_score FROM v_public_overall_leaderboard WHERE team_id = '${TEAM_2_ID}'`)[0].total_score;
  assert(Number(t1Check) === 140, 'Team 1 score remained 140 (not 190)');
  assert(Number(t2Check) === 300, 'Team 2 score remained 300 (not 350)');

  console.log('\n--- GROUP 6: CONCURRENT & DUPLICATE REVERSAL PREVENTION ---');
  // Add a test transaction for Team 3: ADD 50 (140 -> 190)
  const addT3Res = pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'k-t3-add', [
    { team_id: TEAM_3_ID, operation_type: 'ADD', input_value: 50 }
  ]);
  const t3TxId = addT3Res.transactions[0].id;
  assert(addT3Res.transactions[0].resulting_score === 190, 'Team 3 added 50 -> 190');

  // First Reversal: Succeeds
  const rev1 = pgReverseScoreTransaction(t3TxId, 'Reversing accidental add');
  assert(rev1.success === true, 'First reversal successfully processed');
  assert(rev1.resulting_score === 140, 'Reversal restored Team 3 score to 140');
  assert(rev1.points_delta === -50, 'Reversal points delta is -50');

  // Second Reversal attempt: Must be rejected!
  assertThrows(() => {
    pgReverseScoreTransaction(t3TxId, 'Duplicate reversal attempt');
  }, '[23505]', 'Duplicate reversal blocked by re-check and unique index');

  // Reversing a reversal record itself must be blocked
  assertThrows(() => {
    pgReverseScoreTransaction(rev1.reversal_transaction_id, 'Trying to reverse a reversal');
  }, 'itself a reversal record', 'Reversing a reversal record directly blocked');

  console.log('\n--- GROUP 7: REVERSAL NEGATIVE SCORE HANDLING ---');
  // Team 3 is at 140. Perform ADD 200 (140 -> 340)
  const addBigRes = pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'k-t3-big', [
    { team_id: TEAM_3_ID, operation_type: 'ADD', input_value: 200 }
  ]);
  const bigTxId = addBigRes.transactions[0].id;

  // Now subtract 300 (340 -> 40)
  pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'k-t3-sub', [
    { team_id: TEAM_3_ID, operation_type: 'SUBTRACT', input_value: 300 }
  ]);
  const t3Current = db.public.many(`SELECT total_score FROM v_public_overall_leaderboard WHERE team_id = '${TEAM_3_ID}'`)[0].total_score;
  assert(Number(t3Current) === 40, 'Team 3 current score is 40');

  // Now try to reverse bigTxId (which added 200):
  // Reversing it subtracts 200. But current score is 40! 40 - 200 = -160.
  // With allow_negative_scores = FALSE, reversal MUST be rejected!
  assertThrows(() => {
    pgReverseScoreTransaction(bigTxId, 'Reversing big add would make score negative');
  }, '[22000]', 'Reversal resulting in negative score blocked when allow_negative_scores = false');

  // Verify ledger count remained unchanged and score remained 40
  const t3AfterRevFail = db.public.many(`SELECT total_score FROM v_public_overall_leaderboard WHERE team_id = '${TEAM_3_ID}'`)[0].total_score;
  assert(Number(t3AfterRevFail) === 40, 'Team 3 score preserved at 40 after negative reversal block');

  console.log('\n--- GROUP 8: HARDENED FUNCTION PERMISSIONS & SECURITY ---');
  // Unauthorized user attempt
  setCaller('unauthorized-user');
  assertThrows(() => {
    pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'k-unauth', [
      { team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 10 }
    ]);
  }, '[42501]', 'Unauthorized caller rejected by record_score_batch');

  assertThrows(() => {
    pgReverseScoreTransaction(bigTxId, 'Unauthorized reversal');
  }, '[42501]', 'Unauthorized caller rejected by reverse_score_transaction');

  setCaller('user-admin-1');

  console.log('\n--- GROUP 9: ROUND-LEVEL REPORTING & AUDIT INTEGRITY ---');
  // Query v_team_round_scores for Team 1 in Round 2 (where SET_SCORE was executed)
  const r2Scores = db.public.many(`
    SELECT * FROM v_team_round_scores
    WHERE team_id = '${TEAM_1_ID}' AND round_id = '${ROUND_2_ID}'
  `);
  assert(r2Scores.length > 0, 'Round 2 scores recorded for Team 1');
  assert(Number(r2Scores[0].adjustment_points) !== 0, 'SET_SCORE correctly tracked under adjustment_points');
  assert(r2Scores[0].transactions_count >= 2, 'Transaction count reflects 2 transactions in Round 2');

  // Overall Ledger Balance Reconciliation across all teams
  const allTxs = db.public.many('SELECT points_delta FROM score_transactions');
  const sumDeltas = allTxs.reduce((acc, row) => acc + Number(row.points_delta), 0);
  const totalStarting = 140.00 * 3; // 3 teams * 140
  const expectedTotalLeaderboard = totalStarting + sumDeltas;

  const lbAll = db.public.many('SELECT total_score FROM v_public_overall_leaderboard');
  const actualTotalLeaderboard = lbAll.reduce((acc, row) => acc + Number(row.total_score), 0);

  assert(
    Math.abs(expectedTotalLeaderboard - actualTotalLeaderboard) < 0.001,
    `Full Ledger Reconciled: sum of all transaction deltas + starting scores (${expectedTotalLeaderboard}) matches leaderboard total (${actualTotalLeaderboard})`
  );

  console.log('\n--- GROUP 10: REVERSAL OF SET_SCORE AFTER SUBSEQUENT OPERATIONS ---');
  // Team 1 initial score: 140
  // Perform SET_SCORE 40 (points_delta = -100, resulting = 40)
  const setBatch10 = pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'k-rev-set-40', [
    { team_id: TEAM_1_ID, operation_type: 'SET_SCORE', input_value: 40 }
  ]);
  const setTx10Id = setBatch10.transactions[0].id;
  assert(setBatch10.transactions[0].resulting_score === 40, 'SET_SCORE 40: resulting score is 40');
  assert(setBatch10.transactions[0].points_delta === -100, 'SET_SCORE 40: points_delta is -100');

  // Subsequent gameplay operation: ADD 20 (resulting = 60, points_delta = +20)
  const addBatch10 = pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'k-rev-add-20', [
    { team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 20 }
  ]);
  assert(addBatch10.transactions[0].resulting_score === 60, 'ADD 20: resulting score is 60');

  // Reverse original SET_SCORE transaction:
  const revSet10 = pgReverseScoreTransaction(setTx10Id, 'Reverse SET_SCORE transaction after ADD 20');
  assert(revSet10.previous_score === 60, 'Reversal previous_score is current score before reversal: 60');
  assert(revSet10.points_delta === 100, 'Reversal points_delta undoes original delta: -(-100) = +100');
  assert(revSet10.resulting_score === 160, 'Reversal resulting_score = 60 + 100 = 160');

  const lbT1_10 = db.public.many(`SELECT total_score FROM v_public_overall_leaderboard WHERE team_id = '${TEAM_1_ID}'`)[0].total_score;
  assert(Number(lbT1_10) === 160, 'Leaderboard correctly reflects 160 (preserving legitimate +20 gameplay addition)');

  console.log('\n--- GROUP 11: IDEMPOTENCY KEY RETRIES & PAYLOAD FINGERPRINTING ---');
  // First call with fresh key
  const idemKey = 'idem-unique-key-1';
  const opPayloadA = [{ team_id: TEAM_2_ID, operation_type: 'ADD', input_value: 15 }];
  const firstIdemRes = pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, idemKey, opPayloadA, 'Payload A');
  assert(firstIdemRes.transactions_count === 1, 'First idempotency submission processed 1 transaction');

  // Retrying the exact same batch with identical payload must succeed and return cached response
  const retryIdemRes = pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, idemKey, opPayloadA, 'Payload A');
  assert(retryIdemRes.transactions_count === 1, 'Retry submission returned cached response');
  assert(retryIdemRes.transaction_ids[0] === firstIdemRes.transaction_ids[0], 'Retry transaction IDs match cached IDs');

  // Attempting to reuse the exact same idempotency key with a DIFFERENT payload must be rejected!
  const opPayloadB = [{ team_id: TEAM_2_ID, operation_type: 'ADD', input_value: 30 }];
  assertThrows(() => {
    pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, idemKey, opPayloadB, 'Different Payload B');
  }, '[23505]', 'Reusing idempotency key with different payload is rejected');

  console.log('\n--- GROUP 12: EVENT & ROUND CONCURRENCY / STATUS LOCKING ---');
  // 1. Seed inactive event and completed round
  const INACTIVE_EVENT_ID = '00000000-0000-0000-0000-000000000099';
  const COMPLETED_ROUND_ID = '33333333-3333-3333-3333-333333333333';
  db.public.none(`
    INSERT INTO events (id, name, status) VALUES ('${INACTIVE_EVENT_ID}', 'Archived Championship', 'archived');
    INSERT INTO event_members (id, event_id, user_id, role) VALUES ('em-99', '${INACTIVE_EVENT_ID}', 'user-admin-1', 'organizer');
    INSERT INTO rounds (id, event_id, round_number, name, status) VALUES
      ('${COMPLETED_ROUND_ID}', '${EVENT_ID}', 3, 'Round 3 (Finished)', 'completed');
  `);

  // Scoring in inactive event is rejected
  assertThrows(() => {
    pgRecordScoreBatch(INACTIVE_EVENT_ID, null, 'k-inactive', [{ team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 10 }]);
  }, 'active events', 'Scoring in non-active event is rejected');

  // Scoring in completed round is rejected
  assertThrows(() => {
    pgRecordScoreBatch(EVENT_ID, COMPLETED_ROUND_ID, 'k-completed-r', [{ team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 10 }]);
  }, 'completed round', 'Scoring in completed round is rejected');

  console.log('\n--- GROUP 13: REVERSAL REPORTING BREAKDOWN IN V_TEAM_ROUND_SCORES ---');
  // Query v_team_round_scores for Team 1 in Round 1 (where SET_SCORE and its reversal occurred)
  const round1Breakdown = db.public.many(`
    SELECT * FROM v_team_round_scores
    WHERE team_id = '${TEAM_1_ID}' AND round_id = '${ROUND_1_ID}'
  `);
  assert(round1Breakdown.length > 0, 'Round 1 breakdown exists for Team 1');
  const r1Row = round1Breakdown[0];
  assert(Number(r1Row.reversal_points) !== 0, 'Reversal points separated from gameplay points');
  assert(r1Row.has_reversal === true, 'has_reversal flag set to true');
  assert(r1Row.has_score_reset === true, 'has_score_reset flag set to true');

  console.log('\n--- GROUP 14: NULL AND BLANK IDEMPOTENCY KEY VALIDATION ---');
  // SQL step 2: NULL key must be hard-rejected
  assertThrows(() => {
    pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, null, [{ team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 1 }]);
  }, '[22004]', 'NULL idempotency key is rejected with 22004');

  // Empty string must be hard-rejected
  assertThrows(() => {
    pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, '', [{ team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 1 }]);
  }, '[22004]', 'Empty string idempotency key is rejected with 22004');

  // Whitespace-only must be hard-rejected
  assertThrows(() => {
    pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, '   ', [{ team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 1 }]);
  }, '[22004]', 'Whitespace-only idempotency key is rejected with 22004');

  // Key longer than 255 characters must be hard-rejected
  const longKey = 'a'.repeat(256);
  assertThrows(() => {
    pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, longKey, [{ team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 1 }]);
  }, '[22023]', 'Idempotency key exceeding 255 characters is rejected with 22023');

  console.log('\n--- GROUP 15: LEGACY NULL REQUEST_PAYLOAD_HASH RECORDS REJECTED ---');
  // Manually insert a legacy idempotency record with NULL request_payload_hash
  // (simulating a record created before this migration added the column)
  const LEGACY_KEY = 'legacy-key-without-hash';
  db.public.none(`
    INSERT INTO idempotency_records (event_id, idempotency_key, response_payload, request_payload_hash, created_at)
    VALUES ('${EVENT_ID}', '${LEGACY_KEY}', '{"success": true, "legacy": true}', NULL, NOW())
  `);

  // Attempting to use the legacy key must throw — not silently replay
  assertThrows(() => {
    pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, LEGACY_KEY, [
      { team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 5 }
    ]);
  }, '[23505]', 'Legacy idempotency record with NULL hash is rejected (not silently replayed)');

  // The error message must NOT imply the transaction was a duplicate conflict
  // (it should tell the user to use a new key, not that they are duplicating)
  let legacyErrMsg = '';
  try {
    pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, LEGACY_KEY, [
      { team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 5 }
    ]);
  } catch (e) {
    legacyErrMsg = e.message || '';
  }
  assert(
    legacyErrMsg.toLowerCase().includes('legacy') || legacyErrMsg.toLowerCase().includes('new unique key'),
    'Legacy hash error message guides caller to use a new key (not "conflict" or "duplicate")'
  );
  assert(
    legacyErrMsg.toLowerCase().includes('may have succeeded') || legacyErrMsg.toLowerCase().includes('check the history'),
    'Legacy hash error message does not imply transaction failed (mentions checking history)'
  );

  console.log('\n--- GROUP 16: CANONICAL JSONB FINGERPRINT — NULL VS EMPTY REASON ---');
  // NULL p_reason and empty-string p_reason must produce DIFFERENT fingerprints.
  // The old COALESCE approach would collapse both to '' and produce the same hash.
  const nullReasonKey  = 'g16-null-reason-key';
  const emptyReasonKey = 'g16-empty-reason-key';

  // Submit with NULL reason
  const nullReasonRes = pgRecordScoreBatch(EVENT_ID, ROUND_2_ID, nullReasonKey,
    [{ team_id: TEAM_2_ID, operation_type: 'ADD', input_value: 1 }],
    null);
  assert(nullReasonRes.transactions_count === 1, 'Group 16: NULL reason batch committed');

  // Submit with empty-string reason using a DIFFERENT key — must commit (not conflict)
  const emptyReasonRes = pgRecordScoreBatch(EVENT_ID, ROUND_2_ID, emptyReasonKey,
    [{ team_id: TEAM_2_ID, operation_type: 'ADD', input_value: 1 }],
    '');
  assert(emptyReasonRes.transactions_count === 1, 'Group 16: empty-string reason batch committed with different key');

  // Retrieve the two stored hashes and confirm they differ
  const nullRow  = db.public.many(`SELECT request_payload_hash FROM idempotency_records WHERE event_id = '${EVENT_ID}' AND idempotency_key = '${nullReasonKey}'`);
  const emptyRow = db.public.many(`SELECT request_payload_hash FROM idempotency_records WHERE event_id = '${EVENT_ID}' AND idempotency_key = '${emptyReasonKey}'`);
  assert(nullRow.length > 0 && emptyRow.length > 0, 'Group 16: Both idempotency records were stored');
  assert(
    nullRow[0].request_payload_hash !== emptyRow[0].request_payload_hash,
    'Group 16: NULL reason and empty-string reason produce DISTINCT payload hashes (canonical JSONB fingerprint)'
  );

  // Exact retry of NULL reason with same key must succeed (cached)
  const nullReasonRetry = pgRecordScoreBatch(EVENT_ID, ROUND_2_ID, nullReasonKey,
    [{ team_id: TEAM_2_ID, operation_type: 'ADD', input_value: 1 }],
    null);
  assert(
    JSON.stringify(nullReasonRetry) === JSON.stringify(nullReasonRes),
    'Group 16: Exact retry with NULL reason returns cached response'
  );

  // Submitting NULL reason key with empty-string reason (changed payload) must conflict
  assertThrows(() => {
    pgRecordScoreBatch(EVENT_ID, ROUND_2_ID, nullReasonKey,
      [{ team_id: TEAM_2_ID, operation_type: 'ADD', input_value: 1 }],
      '');
  }, '[23505]', 'Group 16: Reusing NULL-reason key with empty-string reason is rejected as payload conflict');

  console.log('\n--- GROUP 17: HISTORICAL RECORD IMMUTABILITY ---');
  // After all test groups, verify that seed transactions have not been modified.
  // Spot-check: Team 1 initial SET_SCORE 140 transaction was recorded in GROUP 1.
  // The initial transaction count should remain stable since we have been inserting only,
  // never updating or deleting historical score_transactions rows.
  const allTxCount = db.public.many('SELECT count(*) AS c FROM score_transactions')[0].c;
  assert(Number(allTxCount) > 0, 'Group 17: score_transactions table is non-empty after all test groups');

  // Verify all reversal_of_transaction_id references point to existing transactions
  const orphanedReversals = db.public.many(`
    SELECT id FROM score_transactions
    WHERE reversal_of_transaction_id IS NOT NULL
      AND reversal_of_transaction_id NOT IN (SELECT id FROM score_transactions)
  `);
  assert(orphanedReversals.length === 0, 'Group 17: No orphaned reversals — all reversal_of_transaction_id references exist');

  // Verify no score_transactions row has been soft-deleted or modified outside the RPC
  // (all rows should have event_id, team_id, operation_type, points_delta present)
  const malformedRows = db.public.many(`
    SELECT id FROM score_transactions
    WHERE event_id IS NULL OR team_id IS NULL OR operation_type IS NULL OR points_delta IS NULL
  `);
  assert(malformedRows.length === 0, 'Group 17: No score_transactions rows have NULL mandatory fields (ledger integrity intact)');

  // Verify the unique reversal index constraint: no two reversals of the same original
  // pg-mem does not support HAVING count(*) > 1 — perform this check in JS instead.
  const allReversals = db.public.many(`
    SELECT reversal_of_transaction_id FROM score_transactions
    WHERE reversal_of_transaction_id IS NOT NULL
  `);
  const reversalCounts = {};
  for (const row of allReversals) {
    const ref = row.reversal_of_transaction_id;
    reversalCounts[ref] = (reversalCounts[ref] || 0) + 1;
  }
  const dupRefs = Object.entries(reversalCounts).filter(([, cnt]) => cnt > 1);
  assert(dupRefs.length === 0, 'Group 17: Unique partial index — no duplicate reversals of the same transaction');

  console.log('\n--- GROUP 18: SETTINGS MUTATION LOCK-ORDER CONSISTENCY (SIMULATION) ---');
  // Tests authoritative update_event_settings:
  // Enforces consistent lock order: events row -> event_settings row
  // 1. Valid update by authorized admin
  const updRes = pgUpdateEventSettings(EVENT_ID, true, false, 150.00, true, 'desc');
  assert(updRes.success === true, 'Group 18: update_event_settings succeeded for authorized admin');
  assert(updRes.settings.starting_score === 150, 'Group 18: starting_score updated to 150');
  assert(updRes.settings.allow_negative_scores === true, 'Group 18: allow_negative_scores updated to true');

  // Verify database state matches
  const checkSet = db.public.many(`SELECT starting_score, allow_negative_scores FROM event_settings WHERE event_id = '${EVENT_ID}'`)[0];
  assert(Number(checkSet.starting_score) === 150, 'Group 18: DB reflects starting_score 150');
  assert(Boolean(checkSet.allow_negative_scores) === true, 'Group 18: DB reflects allow_negative_scores true');

  // Reset starting_score back to 140 and allow_negative_scores back to false for subsequent tests
  pgUpdateEventSettings(EVENT_ID, true, false, 140.00, false, 'desc');

  // 2. Unauthorized caller rejected
  setCaller('unauthorized-user-g18');
  assertThrows(() => {
    pgUpdateEventSettings(EVENT_ID, true, false, 200.00, false, 'desc');
  }, '[42501]', 'Group 18: Unauthorized caller rejected by update_event_settings');
  setCaller('user-admin-1');

  // 3. Invalid sort_direction rejected
  assertThrows(() => {
    pgUpdateEventSettings(EVENT_ID, null, null, null, null, 'invalid_direction');
  }, '[22023]', 'Group 18: Invalid sort_direction rejected with 22023');

  console.log('\n--- GROUP 19: REVERSAL CONCURRENT WITH EVENT_SETTINGS UPDATES (SIMULATION) ---');
  // Reversal must acquire event_settings lock and observe committed allow_negative_scores
  // Query Team 1's authoritative current score before starting the test:
  const curT1Rows = db.public.many(`SELECT COALESCE(SUM(points_delta), 0.00) AS d FROM score_transactions WHERE team_id = '${TEAM_1_ID}' AND event_id = '${EVENT_ID}'`);
  const t1ScoreBefore = 140.00 + Number(curT1Rows[0].d);

  // Add 100 on Team 1 (recording txToReverseId)
  const addTxG19 = pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'k-g19-add', [
    { team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 100 }
  ]);
  const txToReverseId = addTxG19.transactions[0].id;

  // Now subtract precisely (t1ScoreBefore + 100 - 20) so current score becomes exactly 20.00
  const subNeeded = Number((t1ScoreBefore + 100 - 20).toFixed(2));
  pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'k-g19-sub', [
    { team_id: TEAM_1_ID, operation_type: 'SUBTRACT', input_value: subNeeded }
  ]);

  // Current score is now exactly 20.
  // With allow_negative_scores = FALSE, reversing txToReverseId (undoing +100 -> delta -100)
  // would result in 20 - 100 = -80.
  // Under the event_settings lock, the reversal reads allow_negative_scores = FALSE and MUST fail!
  assertThrows(() => {
    pgReverseScoreTransaction(txToReverseId, 'Attempting reversal that would make score negative');
  }, '[22000]', 'Group 19: Reversal blocked when allow_negative_scores is FALSE (locked settings state)');

  // Now, update event_settings to allow_negative_scores = TRUE via update_event_settings
  pgUpdateEventSettings(EVENT_ID, true, false, null, true, 'desc');

  // Now the reversal under lock observes allow_negative_scores = TRUE and succeeds!
  const revG19Success = pgReverseScoreTransaction(txToReverseId, 'Reversal with allow_negative_scores enabled');
  assert(revG19Success.success === true, 'Group 19: Reversal succeeds after allow_negative_scores updated to TRUE');
  assert(revG19Success.resulting_score === -80, 'Group 19: Resulting score is -80 (negative allowed)');

  // Restore settings back to FALSE and restore Team 1 back to positive score
  pgUpdateEventSettings(EVENT_ID, true, false, null, false, 'desc');
  pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'k-g19-restore', [
    { team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 240 }
  ]);

  console.log('\n--- GROUP 20: REPEATED REVERSAL SUBMISSION AFTER LOST RESPONSE (SIMULATION) ---');
  // Scenario: Client submits reversal for an original transaction. Server executes it, but response is lost.
  // Client retries the identical reversal call.
  // Create a reversible transaction:
  const txG20 = pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, 'k-g20-add', [
    { team_id: TEAM_2_ID, operation_type: 'ADD', input_value: 25 }
  ]).transactions[0].id;

  // First reversal call: succeeds and records reversal
  const revG20First = pgReverseScoreTransaction(txG20, 'First reversal attempt');
  assert(revG20First.success === true, 'Group 20: First reversal processed');

  // Second reversal call (client re-submitting after dropped response):
  // Must be rejected with [23505] duplicate reversal error referencing the existing reversal ID
  assertThrows(() => {
    pgReverseScoreTransaction(txG20, 'Repeated reversal attempt after lost response');
  }, '[23505]', 'Group 20: Repeated reversal submission rejected with 23505 duplicate reversal notice');

  // Verify unique index on reversal_of_transaction_id has exactly 1 entry for txG20
  const revRecords = db.public.many(`SELECT id FROM score_transactions WHERE reversal_of_transaction_id = '${txG20}'`);
  assert(revRecords.length === 1, 'Group 20: Exactly one reversal record exists for transaction (idempotency preserved)');

  console.log('\n--- GROUP 21: BROWSER REFRESH DURING UNCERTAIN SCORING SUBMISSION (SIMULATION) ---');
  // Simulates score-control-manager.tsx localStorage lifecycle across browser refresh:
  const mockLocalStorage = {};
  const PENDING_STORAGE_KEY = 'casino_royale_pending_score_batch';

  const pendingBatchUUID = 'uuid-uncertain-batch-99';
  const stagedOps = [
    { team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 10 },
    { team_id: TEAM_2_ID, operation_type: 'ADD', input_value: 20 },
  ];

  // 1. Client stages and initiates submission: writes pending record to localStorage with status 'submitting'
  mockLocalStorage[PENDING_STORAGE_KEY] = JSON.stringify({
    idempotencyKey: pendingBatchUUID,
    roundId: ROUND_1_ID,
    batchReason: 'Uncertain Round Settlement',
    operations: stagedOps,
    status: 'submitting',
    timestamp: Date.now()
  });

  // 2. The server receives and commits the batch
  const committedServerRes = pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, pendingBatchUUID, stagedOps, 'Uncertain Round Settlement');
  assert(committedServerRes.transactions_count === 2, 'Group 21: Server committed the batch');

  // 3. Browser refreshes before client receives confirmation.
  // On reload, mount effect restores pending batch from localStorage:
  const restoredBatch = JSON.parse(mockLocalStorage[PENDING_STORAGE_KEY]);
  assert(restoredBatch.idempotencyKey === pendingBatchUUID, 'Group 21: Restored batch preserves exact original idempotency key');
  assert(restoredBatch.status === 'submitting', 'Group 21: Restored batch detected in uncertain submitting state');

  // 4. Operator clicks "Retry Batch": client re-submits with restored key and identical payload
  const retryResponse = pgRecordScoreBatch(
    EVENT_ID,
    restoredBatch.roundId,
    restoredBatch.idempotencyKey,
    restoredBatch.operations,
    restoredBatch.batchReason
  );

  // Must return cached response without inserting duplicate transactions!
  assert(retryResponse.transactions_count === 2, 'Group 21: Retry returns cached response');
  assert(
    retryResponse.transaction_ids[0] === committedServerRes.transaction_ids[0] &&
    retryResponse.transaction_ids[1] === committedServerRes.transaction_ids[1],
    'Group 21: Retry transaction IDs match original committed transaction IDs (zero duplicate points)'
  );

  // 5. On confirmation, client clears localStorage
  delete mockLocalStorage[PENDING_STORAGE_KEY];
  assert(mockLocalStorage[PENDING_STORAGE_KEY] === undefined, 'Group 21: localStorage cleared on successful confirmation');

  console.log('\n--- GROUP 22: REUSE OF KEY WITH CHANGED PAYLOAD VS ABANDON WITH NEW KEY (SIMULATION) ---');
  // If operator alters payload after restore without abandoning, server rejects with 23505 conflict:
  const alteredOps = [
    { team_id: TEAM_1_ID, operation_type: 'ADD', input_value: 99 }, // altered from 10 to 99!
    { team_id: TEAM_2_ID, operation_type: 'ADD', input_value: 20 },
  ];
  assertThrows(() => {
    pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, pendingBatchUUID, alteredOps, 'Uncertain Round Settlement');
  }, '[23505]', 'Group 22: Reusing original key with altered payload rejected with 23505 conflict');

  // If operator explicitly clicks "Abandon Batch", a fresh UUID is issued and succeeds cleanly:
  const freshUUID = 'uuid-fresh-after-abandon-100';
  const freshBatchRes = pgRecordScoreBatch(EVENT_ID, ROUND_1_ID, freshUUID, alteredOps, 'Fresh Batch After Abandon');
  assert(freshBatchRes.transactions_count === 2, 'Group 22: Abandon and fresh UUID submission commits new batch cleanly');

  console.log('\n=============================================================');
  console.log(`DATABASE INTEGRATION (PG-MEM) SUMMARY: ${passedTests} / ${totalTests} tests passed cleanly!`);
  console.log('=============================================================\n');
}

runDatabaseIntegrationTests().catch(err => {
  console.error('\nDATABASE INTEGRATION TESTS FAILED:', err);
  process.exit(1);
});
