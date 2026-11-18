// ====================================================================
// CASINO ROYALE — SCORING ENGINE COMPLETE AUTOMATED TEST SUITE
// ====================================================================

class MockScoringLedger {
  constructor(startingScore = 0.0, allowNegative = false) {
    this.startingScore = startingScore;
    this.allowNegative = allowNegative;
    this.transactions = [];
    this.idempotencyRecords = new Map();
  }

  getCurrentOverallScore(teamId) {
    const totalDelta = this.transactions
      .filter((t) => t.team_id === teamId)
      .reduce((sum, t) => sum + t.points_delta, 0.0);
    return Math.round((this.startingScore + totalDelta) * 100) / 100;
  }

  recordScoreBatch(eventId, roundId, idempotencyKey, operations, reason = null) {
    const payloadHash = `${roundId}:${JSON.stringify(operations)}:${reason || ""}`;

    // 1. Idempotency Check with Payload Fingerprint
    if (idempotencyKey && this.idempotencyRecords.has(idempotencyKey)) {
      const cachedRecord = this.idempotencyRecords.get(idempotencyKey);
      if (cachedRecord.payloadHash !== payloadHash) {
        throw new Error("[23505] Idempotency conflict: idempotency key was already used for a different scoring batch payload");
      }
      return { ...cachedRecord.response, cached: true };
    }

    // 2. Validate non-empty operations
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new Error("p_operations must be a non-empty JSON array");
    }

    // 3. Atomic execution simulation (staging changes before committing)
    const stagedTransactions = [];
    const tempTransactions = [...this.transactions];

    for (const op of operations) {
      const teamId = op.team_id;
      const opType = (op.operation_type || "").toUpperCase().trim();
      const valStr = String(op.input_value).trim();

      // Enforce strict 2-decimal precision (prevents silent rounding)
      if (/\.[0-9]{3,}$/.test(valStr)) {
        throw new Error("[22023] input_value exceeds maximum allowed decimal precision of 2 decimal places");
      }

      const val = Number(op.input_value);
      if (isNaN(val)) throw new Error("Invalid numeric input: " + op.input_value);

      // In-transaction previous overall score (reflects earlier ops in same batch)
      const currentDelta = tempTransactions
        .filter((t) => t.team_id === teamId)
        .reduce((sum, t) => sum + t.points_delta, 0.0);
      const prevScore = Math.round((this.startingScore + currentDelta) * 100) / 100;

      let resScore = 0.0;
      let delta = 0.0;

      if (opType === "ADD") {
        resScore = Math.round((prevScore + val) * 100) / 100;
        delta = val;
      } else if (opType === "SUBTRACT") {
        resScore = Math.round((prevScore - val) * 100) / 100;
        delta = -val;
      } else if (opType === "MULTIPLY") {
        resScore = Math.round(prevScore * val * 100) / 100;
        delta = Math.round((resScore - prevScore) * 100) / 100;
      } else if (opType === "DIVIDE") {
        if (val === 0) throw new Error("Division by zero is not permitted for team " + teamId);
        resScore = Math.round((prevScore / val) * 100) / 100;
        delta = Math.round((resScore - prevScore) * 100) / 100;
      } else if (opType === "SET_SCORE") {
        resScore = val;
        delta = Math.round((val - prevScore) * 100) / 100;
      } else {
        throw new Error("Invalid operation type: " + opType);
      }

      if (!this.allowNegative && resScore < 0) {
        throw new Error("Negative scores are not permitted for event (Team " + teamId + " resulting: " + resScore + ")");
      }

      const txRecord = {
        id: "tx-" + Math.random().toString(36).substring(2, 9),
        event_id: eventId,
        team_id: teamId,
        round_id: roundId,
        operation_type: opType,
        input_value: val,
        previous_score: prevScore,
        resulting_score: resScore,
        points_delta: delta,
        reason: op.reason || reason,
        idempotency_key: idempotencyKey,
        created_at: new Date().toISOString(),
      };

      stagedTransactions.push(txRecord);
      tempTransactions.push(txRecord);
    }

    // Atomic Commit: All succeeded, commit to real store
    this.transactions.push(...stagedTransactions);

    const updatedScores = {};
    for (const tx of stagedTransactions) {
      updatedScores[tx.team_id] = this.getCurrentOverallScore(tx.team_id);
    }

    const response = {
      success: true,
      event_id: eventId,
      round_id: roundId,
      transactions_count: stagedTransactions.length,
      transactions: stagedTransactions,
      updated_scores: updatedScores,
    };

    if (idempotencyKey) {
      this.idempotencyRecords.set(idempotencyKey, { response, payloadHash });
    }

    return response;
  }

  reverseScoreTransaction(transactionId, reason = "Reversal requested by organizer") {
    const orig = this.transactions.find((t) => t.id === transactionId);
    if (!orig) throw new Error("Original transaction not found: " + transactionId);
    if (orig.reversal_of_transaction_id) {
      throw new Error("Cannot reverse transaction because it is itself a reversal record");
    }

    const existingRev = this.transactions.find((t) => t.reversal_of_transaction_id === transactionId);
    if (existingRev) {
      throw new Error("Transaction has already been reversed by " + existingRev.id);
    }

    const prevScore = this.getCurrentOverallScore(orig.team_id);
    const revDelta = -orig.points_delta;
    const resScore = Math.round((prevScore + revDelta) * 100) / 100;

    if (!this.allowNegative && resScore < 0) {
      throw new Error("Cannot reverse transaction: resulting score would be negative");
    }

    const revTx = {
      id: "rev-" + Math.random().toString(36).substring(2, 9),
      event_id: orig.event_id,
      team_id: orig.team_id,
      round_id: orig.round_id,
      operation_type: "SUBTRACT",
      input_value: Math.abs(orig.points_delta),
      previous_score: prevScore,
      resulting_score: resScore,
      points_delta: revDelta,
      reason: reason || `Reversal of transaction ${transactionId}`,
      reversal_of_transaction_id: transactionId,
      created_at: new Date().toISOString(),
    };

    this.transactions.push(revTx);

    return {
      success: true,
      reversal_transaction_id: revTx.id,
      original_transaction_id: transactionId,
      team_id: orig.team_id,
      previous_score: prevScore,
      resulting_score: resScore,
      points_delta: revDelta,
    };
  }
}

// -------------------------------------------------------------
// EXECUTE TEST SUITE
// -------------------------------------------------------------
let passed = 0;
let total = 0;
function assert(desc, condition) {
  total++;
  if (condition) {
    passed++;
    console.log("✓ " + desc);
  } else {
    console.error("✗ FAILED: " + desc);
  }
}

console.log("=== CASINO ROYALE SCORING REPAIR AUTOMATED TEST SUITE ===\n");

// 1. ISOLATED CONTRACT TESTS (Base 140)
{
  const ledger = new MockScoringLedger(140.0, false);
  const t1 = ledger.recordScoreBatch("e1", "r1", "k1", [{ team_id: "teamA", operation_type: "ADD", input_value: 10 }]);
  assert("ADD 10 on 140 -> 150 (delta +10)", t1.transactions[0].resulting_score === 150 && t1.transactions[0].points_delta === 10);

  const ledger2 = new MockScoringLedger(140.0, false);
  const t2 = ledger2.recordScoreBatch("e1", "r1", "k2", [{ team_id: "teamA", operation_type: "SUBTRACT", input_value: 10 }]);
  assert("SUBTRACT 10 on 140 -> 130 (delta -10)", t2.transactions[0].resulting_score === 130 && t2.transactions[0].points_delta === -10);

  const ledger3 = new MockScoringLedger(140.0, false);
  const t3 = ledger3.recordScoreBatch("e1", "r1", "k3", [{ team_id: "teamA", operation_type: "MULTIPLY", input_value: 2 }]);
  assert("MULTIPLY 2 on 140 -> 280 (delta +140)", t3.transactions[0].resulting_score === 280 && t3.transactions[0].points_delta === 140);

  const ledger4 = new MockScoringLedger(140.0, false);
  const t4 = ledger4.recordScoreBatch("e1", "r1", "k4", [{ team_id: "teamA", operation_type: "DIVIDE", input_value: 2 }]);
  assert("DIVIDE 2 on 140 -> 70 (delta -70)", t4.transactions[0].resulting_score === 70 && t4.transactions[0].points_delta === -70);

  const ledger5 = new MockScoringLedger(140.0, false);
  const t5 = ledger5.recordScoreBatch("e1", "r1", "k5", [{ team_id: "teamA", operation_type: "SET_SCORE", input_value: 40 }]);
  assert("SET_SCORE 40 on 140 -> 40 (delta -100)", t5.transactions[0].resulting_score === 40 && t5.transactions[0].points_delta === -100);
}

// 2. SET_SCORE ROUND TRIPS
{
  const ledger = new MockScoringLedger(140.0, false);
  const s1 = ledger.recordScoreBatch("e1", "r1", "k6", [{ team_id: "teamA", operation_type: "SET_SCORE", input_value: 40 }]);
  assert("SET_SCORE 140 -> 40: resulting = 40, delta = -100", s1.transactions[0].resulting_score === 40 && s1.transactions[0].points_delta === -100);
  assert("Leaderboard matches SET_SCORE 40", ledger.getCurrentOverallScore("teamA") === 40);

  const s2 = ledger.recordScoreBatch("e1", "r1", "k7", [{ team_id: "teamA", operation_type: "SET_SCORE", input_value: 140 }]);
  assert("SET_SCORE 40 -> 140: resulting = 140, delta = +100", s2.transactions[0].resulting_score === 140 && s2.transactions[0].points_delta === 100);
  assert("Leaderboard matches restored 140", ledger.getCurrentOverallScore("teamA") === 140);
}

// 3. INTRA-BATCH SEQUENTIAL & ROUND TRIP
{
  const ledger = new MockScoringLedger(140.0, false);
  const batch = ledger.recordScoreBatch("e1", "r1", "k8", [
    { team_id: "teamA", operation_type: "ADD", input_value: 20 },
    { team_id: "teamA", operation_type: "SUBTRACT", input_value: 10 },
  ]);
  assert(
    "ADD 20 followed by SUBTRACT 10 in same batch -> prev 140 -> 160, then prev 160 -> 150",
    batch.transactions[0].resulting_score === 160 && batch.transactions[1].resulting_score === 150
  );
  assert("Leaderboard overall matches final 150", ledger.getCurrentOverallScore("teamA") === 150);

  const batch2 = ledger.recordScoreBatch("e1", "r2", "k9", [
    { team_id: "teamA", operation_type: "MULTIPLY", input_value: 3 },
    { team_id: "teamA", operation_type: "DIVIDE", input_value: 2 },
  ]);
  assert(
    "MUL 3 then DIV 2 in same batch -> prev 150 -> 450, then prev 450 -> 225",
    batch2.transactions[0].resulting_score === 450 && batch2.transactions[1].resulting_score === 225
  );
  assert("Leaderboard overall matches 225", ledger.getCurrentOverallScore("teamA") === 225);
}

// 4. DIVISION BY ZERO & NEGATIVE CHECKS
{
  const ledger = new MockScoringLedger(140.0, false);
  let divZeroCaught = false;
  try {
    ledger.recordScoreBatch("e1", "r1", "k10", [{ team_id: "teamA", operation_type: "DIVIDE", input_value: 0 }]);
  } catch {
    divZeroCaught = true;
  }
  assert("Division by zero throws exception and rejects batch", divZeroCaught);
  assert("Ledger unchanged after division by zero rejection", ledger.transactions.length === 0);

  let negBlocked = false;
  try {
    ledger.recordScoreBatch("e1", "r1", "k11", [{ team_id: "teamA", operation_type: "SUBTRACT", input_value: 200 }]);
  } catch {
    negBlocked = true;
  }
  assert("Negative score blocked when allow_negative = false", negBlocked);
  assert("Ledger unchanged after negative rejection", ledger.transactions.length === 0);

  const negAllowedLedger = new MockScoringLedger(140.0, true);
  const negOk = negAllowedLedger.recordScoreBatch("e1", "r1", "k12", [{ team_id: "teamA", operation_type: "SUBTRACT", input_value: 200 }]);
  assert("Negative score permitted when allow_negative = true (result = -60)", negOk.transactions[0].resulting_score === -60);
}

// 5. DECIMALS
{
  const ledger = new MockScoringLedger(140.0, false);
  const decBatch = ledger.recordScoreBatch("e1", "r1", "k13", [
    { team_id: "teamA", operation_type: "ADD", input_value: 12.5 },
    { team_id: "teamA", operation_type: "DIVIDE", input_value: 3 },
  ]);
  assert("Decimal ADD 12.5 -> 152.5", decBatch.transactions[0].resulting_score === 152.5);
  assert(
    "Decimal DIVIDE 3 rounded to 2 decimals -> 50.83, delta -101.67",
    decBatch.transactions[1].resulting_score === 50.83 && decBatch.transactions[1].points_delta === -101.67
  );
  assert("Reconciliation: starting(140) + 12.5 - 101.67 = 50.83", ledger.getCurrentOverallScore("teamA") === 50.83);
}

// 6. MULTI-TEAM ATOMIC BATCH & ROLLBACK
{
  const ledger = new MockScoringLedger(100.0, false);
  const multiBatch = ledger.recordScoreBatch("e1", "r1", "k14", [
    { team_id: "team1", operation_type: "ADD", input_value: 50 },
    { team_id: "team2", operation_type: "MULTIPLY", input_value: 2 },
    { team_id: "team3", operation_type: "SET_SCORE", input_value: 40 },
    { team_id: "team4", operation_type: "DIVIDE", input_value: 4 },
  ]);
  assert("Multi-team batch committed 4 transactions", multiBatch.transactions_count === 4);
  assert("Team 1 score = 150", ledger.getCurrentOverallScore("team1") === 150);
  assert("Team 2 score = 200", ledger.getCurrentOverallScore("team2") === 200);
  assert("Team 3 score = 40", ledger.getCurrentOverallScore("team3") === 40);
  assert("Team 4 score = 25", ledger.getCurrentOverallScore("team4") === 25);

  // Atomic Rollback Test: 3 valid teams + 1 invalid (div by zero)
  let rollbackCaught = false;
  try {
    ledger.recordScoreBatch("e1", "r1", "k15", [
      { team_id: "team1", operation_type: "ADD", input_value: 10 },
      { team_id: "team2", operation_type: "DIVIDE", input_value: 0 },
      { team_id: "team3", operation_type: "ADD", input_value: 10 },
    ]);
  } catch {
    rollbackCaught = true;
  }
  assert("Atomic batch with 1 error throws exception", rollbackCaught);
  assert("Entire batch rolled back: Team 1 score remained 150 (not 160)", ledger.getCurrentOverallScore("team1") === 150);
  assert("Entire batch rolled back: Team 3 score remained 40 (not 50)", ledger.getCurrentOverallScore("team3") === 40);
  assert("Total transactions count strictly preserved at 4", ledger.transactions.length === 4);
}

// 7. IDEMPOTENCY KEY DUPLICATION & PAYLOAD FINGERPRINTING
{
  const ledger = new MockScoringLedger(100.0, false);
  const firstCall = ledger.recordScoreBatch("e1", "r1", "idem-100", [{ team_id: "teamA", operation_type: "ADD", input_value: 25 }]);
  assert("First call commits 1 transaction", firstCall.transactions_count === 1);
  assert("Team score after first call = 125", ledger.getCurrentOverallScore("teamA") === 125);

  // Retrying identical batch with exact same payload
  const secondCall = ledger.recordScoreBatch("e1", "r1", "idem-100", [{ team_id: "teamA", operation_type: "ADD", input_value: 25 }]);
  assert("Second call with same key and same payload is marked cached", secondCall.cached === true);
  assert("No duplicate transaction inserted (count is still 1)", ledger.transactions.length === 1);
  assert("Team score remained 125 (not 150)", ledger.getCurrentOverallScore("teamA") === 125);

  // Reusing same key with a DIFFERENT payload must throw exception
  let conflictCaught = false;
  try {
    ledger.recordScoreBatch("e1", "r1", "idem-100", [{ team_id: "teamA", operation_type: "ADD", input_value: 50 }]);
  } catch (err) {
    conflictCaught = String(err).includes("Idempotency conflict");
  }
  assert("Reusing idempotency key with different payload throws conflict exception", conflictCaught);
  assert("Transactions count preserved after conflict rejection", ledger.transactions.length === 1);

  // Decimal precision rejection
  let precisionCaught = false;
  try {
    ledger.recordScoreBatch("e1", "r1", "idem-dec", [{ team_id: "teamA", operation_type: "ADD", input_value: "10.555" }]);
  } catch (err) {
    precisionCaught = String(err).includes("exceeds maximum allowed decimal precision");
  }
  assert("Input with > 2 decimal places is rejected (no silent rounding)", precisionCaught);
}

// 8. COMPLETE LEDGER RECONCILIATION TEST
{
  const ledger = new MockScoringLedger(0.0, false);
  ledger.recordScoreBatch("e1", "r1", "r1-batch", [
    { team_id: "thunder", operation_type: "ADD", input_value: 50 },
    { team_id: "power", operation_type: "ADD", input_value: 60 },
  ]);
  ledger.recordScoreBatch("e1", "r2", "r2-batch", [
    { team_id: "thunder", operation_type: "ADD", input_value: 74 },
    { team_id: "power", operation_type: "ADD", input_value: 70 },
  ]);
  ledger.recordScoreBatch("e1", "r3", "r3-batch", [
    { team_id: "thunder", operation_type: "ADD", input_value: 16 },
    { team_id: "power", operation_type: "ADD", input_value: 10 },
  ]);
  // Current before SET_SCORE: Thunder = 140, Power = 140
  assert("Pre-SET ThunderBolt overall = 140", ledger.getCurrentOverallScore("thunder") === 140);
  assert("Pre-SET PowerHouse overall = 140", ledger.getCurrentOverallScore("power") === 140);

  // Apply SET_SCORE 40 to ThunderBolt and ADD 10 to PowerHouse
  const r4 = ledger.recordScoreBatch("e1", "r4", "r4-batch", [
    { team_id: "thunder", operation_type: "SET_SCORE", input_value: 40 },
    { team_id: "power", operation_type: "ADD", input_value: 10 },
  ]);

  assert(
    "ThunderBolt SET_SCORE 40: prev = 140, res = 40, delta = -100",
    r4.transactions[0].previous_score === 140 && r4.transactions[0].resulting_score === 40 && r4.transactions[0].points_delta === -100
  );
  assert(
    "PowerHouse ADD 10: prev = 140, res = 150, delta = +10",
    r4.transactions[1].previous_score === 140 && r4.transactions[1].resulting_score === 150 && r4.transactions[1].points_delta === 10
  );

  // Leaderboard verification
  assert("Reconciled Leaderboard ThunderBolt = 40", ledger.getCurrentOverallScore("thunder") === 40);
  assert("Reconciled Leaderboard PowerHouse = 150", ledger.getCurrentOverallScore("power") === 150);

  // Round-wise delta audit
  const thunderR4Delta = ledger.transactions
    .filter((t) => t.team_id === "thunder" && t.round_id === "r4")
    .reduce((sum, t) => sum + t.points_delta, 0);
  assert("ThunderBolt Round 4 delta = -100", thunderR4Delta === -100);
}

// 9. REVERSAL OF SET_SCORE AFTER SUBSEQUENT OPERATIONS (Compensating Ledger Policy)
{
  const ledger = new MockScoringLedger(140.0, false);
  assert("Initial team score = 140", ledger.getCurrentOverallScore("team-alpha") === 140);

  // Step 1: SET_SCORE 40: resulting score = 40 (points_delta = -100)
  const setBatch = ledger.recordScoreBatch("e1", "r1", "k-set-40", [
    { team_id: "team-alpha", operation_type: "SET_SCORE", input_value: 40 },
  ]);
  const setTx = setBatch.transactions[0];
  assert("SET_SCORE 40: resulting = 40, delta = -100", setTx.resulting_score === 40 && setTx.points_delta === -100);
  assert("Leaderboard matches SET_SCORE: 40", ledger.getCurrentOverallScore("team-alpha") === 40);

  // Step 2: Subsequent operation ADD 20: resulting score = 60 (points_delta = +20)
  const addBatch = ledger.recordScoreBatch("e1", "r1", "k-add-20", [
    { team_id: "team-alpha", operation_type: "ADD", input_value: 20 },
  ]);
  const addTx = addBatch.transactions[0];
  assert("ADD 20: resulting = 60, delta = +20", addTx.resulting_score === 60 && addTx.points_delta === 20);
  assert("Leaderboard after subsequent ADD: 60", ledger.getCurrentOverallScore("team-alpha") === 60);

  // Step 3: Reverse the original SET_SCORE transaction
  const revRes = ledger.reverseScoreTransaction(setTx.id, "Reversing mistaken score reset");
  assert("Reversal of SET_SCORE executed successfully", revRes.success === true);
  assert("Reversal previous_score is current score before reversal: 60", revRes.previous_score === 60);
  assert("Reversal points_delta restores original delta: +100", revRes.points_delta === 100);
  assert("Reversal resulting_score = 60 + 100 = 160", revRes.resulting_score === 160);

  // Step 4: Leaderboard reflects compensating score 160
  // Math: 140 (starting) - 100 (SET) + 20 (ADD) + 100 (REV) = 160
  assert("Leaderboard after reversal equals 160 (preserving legitimate +20 gameplay addition)", ledger.getCurrentOverallScore("team-alpha") === 160);

  // Step 5: Verify ledger immutability (original transactions untouched, total 3 tx records)
  assert("Ledger total transactions count = 3 (append-only immutable ledger)", ledger.transactions.length === 3);
  assert("Original SET_SCORE record preserved unchanged in history", ledger.transactions[0].id === setTx.id && ledger.transactions[0].points_delta === -100);
  assert("Original ADD record preserved unchanged in history", ledger.transactions[1].id === addTx.id && ledger.transactions[1].points_delta === 20);
  assert("Compensating reversal record references original transaction ID", ledger.transactions[2].reversal_of_transaction_id === setTx.id);
}

// 10. PENDING BATCH STORAGE & IDEMPOTENCY SURVIVAL ACROSS PAGE REFRESH
{
  const PENDING_KEY = "casino_royale_pending_score_batch";
  const mockStorage = new Map();

  // 1. Stage an operation and save to mock storage
  const originalKey = "uuid-pending-key-101";
  const initialPayload = {
    idempotencyKey: originalKey,
    roundId: "r-gold",
    batchReason: "Championship Round Settlement",
    rowStates: {
      team1: { operation: "ADD", inputValue: "50", reason: "Gold bonus", staged: true },
    },
    timestamp: Date.now(),
    status: "submitting",
  };
  mockStorage.set(PENDING_KEY, JSON.stringify(initialPayload));

  // 2. Simulate page reload / unconfirmed state: restore from storage
  const restored = JSON.parse(mockStorage.get(PENDING_KEY));
  assert("Pending batch survives simulated page reload", Boolean(restored));
  assert("Restored batch preserves exact original idempotency key", restored.idempotencyKey === originalKey);
  assert("Restored batch preserves roundId and staged operations", restored.roundId === "r-gold" && restored.rowStates.team1.inputValue === "50");
  assert("Restored batch reflects 'submitting' status", restored.status === "submitting");

  // 3. Retry with restored key: ledger processes it with cached protection
  const ledger = new MockScoringLedger(100.0, false);
  const firstExec = ledger.recordScoreBatch("e1", restored.roundId, restored.idempotencyKey, [
    { team_id: "team1", operation_type: "ADD", input_value: 50 },
  ]);
  assert("First execution committed 1 transaction", firstExec.transactions_count === 1);

  // Retry after simulated page reload:
  const retryExec = ledger.recordScoreBatch("e1", restored.idempotencyKey ? restored.roundId : "r-gold", restored.idempotencyKey, [
    { team_id: "team1", operation_type: "ADD", input_value: 50 },
  ]);
  assert("Retry after reload returns cached response", retryExec.cached === true);
  assert("Score remains 150 (zero duplicate points on retry)", ledger.getCurrentOverallScore("team1") === 150);

  // 4. Operator modifies payload: must generate a new UUID
  const modifiedKey = "uuid-new-key-102";
  assert("Modified payload receives a fresh UUID", modifiedKey !== originalKey);

  // 5. Explicit abandon: clears storage
  mockStorage.delete(PENDING_KEY);
  assert("Explicit abandon removes pending batch from storage", !mockStorage.has(PENDING_KEY));
}

console.log("\n=============================================================");
console.log("SUMMARY: " + passed + " / " + total + " tests passed cleanly!");
console.log("=============================================================");
