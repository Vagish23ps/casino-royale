-- ====================================================================
-- CASINO ROYALE — FORWARD MIGRATION: FIX SCORING OPERATIONS
-- Revision: 2026-11-18 (Fix #2: Authoritative Mathematical Specification)
-- Description:
-- 1. SUBTRACT zero-floor:
--    - v_res_score := GREATEST(0, v_prev_score - v_val)
--    - v_delta     := v_res_score - v_prev_score   (actual clamped delta)
--    - Penalty that exceeds available score clamps to 0, never rejects.
--    - allow_negative_scores is DEPRECATED; zero-floor is now unconditional
--      for SUBTRACT. The column is preserved for schema compatibility only.
-- 2. Non-negative input enforcement:
--    - V must be >= 0 for every operation. Negative input is rejected.
--    - Zero is valid for ADD, SUBTRACT, MULTIPLY, SET_SCORE.
-- 3. Reversal zero-floor:
--    - reverse_score_transaction() now clamps reversal result to 0 when
--      the reversal would produce a negative score, mirroring SUBTRACT.
--    - The old allow_negative_scores gate on reversals is removed.
-- 4. DEPRECATED column annotation:
--    - Adds a PostgreSQL comment on event_settings.allow_negative_scores
--      documenting its deprecated status.
-- 5. Data-only: no schema structure changes. All grant/revoke/permission
--    lines exactly mirror the previous migration.
-- ====================================================================

-- Mark allow_negative_scores as deprecated in the schema
COMMENT ON COLUMN public.event_settings.allow_negative_scores IS
  'DEPRECATED as of migration 20261118020000. The zero-floor for SUBTRACT '
  'is now unconditional (GREATEST(0, P - V)). This column is preserved for '
  'backward schema compatibility only and has no effect on scoring logic.';

-- ====================================================================
-- UPDATED ATOMIC BATCH SCORING FUNCTION
-- Changes from previous version:
--   • Pre-validation loop: rejects input_value < 0 (new)
--   • SUBTRACT: GREATEST(0, P - V) with actual clamped delta (changed)
--   • Negative-scores gate: removed (was based on allow_negative_scores)
-- ====================================================================

CREATE OR REPLACE FUNCTION public.record_score_batch(
  p_event_id UUID,
  p_round_id UUID,
  p_idempotency_key TEXT,
  p_operations JSONB,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_op JSONB;
  v_idx INT;
  v_team_id UUID;
  v_team_event_id UUID;
  v_team_deleted_at TIMESTAMPTZ;
  v_event_status TEXT;
  v_round_rec RECORD;
  v_op_type TEXT;
  v_val NUMERIC(12, 2);
  v_prev_score NUMERIC(12, 2);
  v_res_score NUMERIC(12, 2);
  v_delta NUMERIC(12, 2);
  v_starting_score NUMERIC(12, 2);
  v_total_delta NUMERIC(12, 2);
  v_recorded_ids UUID[] := ARRAY[]::UUID[];
  v_tx_id UUID;
  v_cached_response JSONB;
  v_cached_hash TEXT;
  v_payload_hash TEXT;
  v_distinct_team_ids UUID[];
  v_tx_records JSONB := '[]'::JSONB;
  v_updated_scores JSONB := '{}'::JSONB;
BEGIN
  -- 1. Authorization Check: Caller must be an authorized admin for p_event_id
  IF auth.uid() IS NULL OR NOT public.check_is_event_admin(p_event_id, 'organizer') THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an authorized administrator for event %', p_event_id
      USING ERRCODE = '42501';
  END IF;

  -- 2. Require non-null, non-blank, length-bounded idempotency key
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'p_idempotency_key is required and cannot be NULL, empty, or whitespace-only. Supply a UUID for each new scoring batch.'
      USING ERRCODE = '22004';
  END IF;

  IF length(btrim(p_idempotency_key)) > 255 THEN
    RAISE EXCEPTION 'p_idempotency_key exceeds maximum length of 255 characters (got %). Use a standard UUID (36 characters).',
      length(btrim(p_idempotency_key))
      USING ERRCODE = '22023';
  END IF;

  -- 3. Strict Input Validation on p_operations
  IF p_operations IS NULL THEN
    RAISE EXCEPTION 'p_operations cannot be NULL'
      USING ERRCODE = '22004';
  END IF;

  IF jsonb_typeof(p_operations) != 'array' THEN
    RAISE EXCEPTION 'p_operations must be a JSON array, got %', jsonb_typeof(p_operations)
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_operations) = 0 THEN
    RAISE EXCEPTION 'p_operations array cannot be empty'
      USING ERRCODE = '22023';
  END IF;

  -- Pre-validate every operation object structure before acquiring locks or mutating state
  FOR v_op, v_idx IN
    SELECT op, ord
    FROM jsonb_array_elements(p_operations) WITH ORDINALITY AS arr(op, ord)
    ORDER BY ord ASC
  LOOP
    IF jsonb_typeof(v_op) != 'object' THEN
      RAISE EXCEPTION 'Operation item at index % must be a JSON object, got %', v_idx - 1, jsonb_typeof(v_op)
        USING ERRCODE = '22023';
    END IF;

    -- Validate team_id
    IF v_op->'team_id' IS NULL OR jsonb_typeof(v_op->'team_id') = 'null' OR btrim(COALESCE(v_op->>'team_id', '')) = '' THEN
      RAISE EXCEPTION 'Operation item at index % is missing required field "team_id"', v_idx - 1
        USING ERRCODE = '22023';
    END IF;

    IF (v_op->>'team_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Operation item at index % has invalid UUID for "team_id": %', v_idx - 1, v_op->>'team_id'
        USING ERRCODE = '22023';
    END IF;

    -- Validate operation_type
    IF v_op->'operation_type' IS NULL OR jsonb_typeof(v_op->'operation_type') = 'null' OR btrim(COALESCE(v_op->>'operation_type', '')) = '' THEN
      RAISE EXCEPTION 'Operation item at index % is missing required field "operation_type"', v_idx - 1
        USING ERRCODE = '22023';
    END IF;

    IF upper(btrim(v_op->>'operation_type')) NOT IN ('ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'SET_SCORE') THEN
      RAISE EXCEPTION 'Operation item at index % has invalid operation_type: "%". Allowed types: ADD, SUBTRACT, MULTIPLY, DIVIDE, SET_SCORE',
        v_idx - 1, v_op->>'operation_type'
        USING ERRCODE = '22023';
    END IF;

    -- Validate input_value presence
    IF v_op->'input_value' IS NULL OR jsonb_typeof(v_op->'input_value') = 'null' OR btrim(COALESCE(v_op->>'input_value', '')) = '' THEN
      RAISE EXCEPTION 'Operation item at index % is missing required field "input_value"', v_idx - 1
        USING ERRCODE = '22023';
    END IF;

    IF (v_op->>'input_value') !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'Operation item at index % has unsupported or malformed numeric input_value: "%"',
        v_idx - 1, v_op->>'input_value'
        USING ERRCODE = '22023';
    END IF;

    -- NEW: Reject negative input values. V must be >= 0 for every operation.
    -- Zero is valid for ADD, SUBTRACT, MULTIPLY, SET_SCORE.
    -- This check is intentionally performed before NUMERIC casting to give a clear message.
    IF (v_op->>'input_value')::NUMERIC < 0 THEN
      RAISE EXCEPTION 'Operation item at index % input_value must be non-negative (got %). Use SUBTRACT with a positive value to reduce a score.',
        v_idx - 1, v_op->>'input_value'
        USING ERRCODE = '22023';
    END IF;

    -- Enforce strict decimal precision: reject inputs with more than 2 decimal places
    IF (v_op->>'input_value') ~ '\.[0-9]{3,}$' THEN
      RAISE EXCEPTION 'Operation item at index % input_value "%" exceeds maximum allowed decimal precision of 2 decimal places',
        v_idx - 1, v_op->>'input_value'
        USING ERRCODE = '22023';
    END IF;

    -- Enforce NUMERIC(12,2) range: absolute value cannot exceed 9999999999.99
    IF abs((v_op->>'input_value')::NUMERIC) > 9999999999.99 THEN
      RAISE EXCEPTION 'Operation item at index % input_value exceeds maximum allowed precision NUMERIC(12,2): %',
        v_idx - 1, v_op->>'input_value'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 4. Compute Deterministic Request Payload Fingerprint (canonical JSONB)
  -- Using jsonb_build_object preserves the NULL vs empty-string distinction for
  -- p_reason, which COALESCE-based string concatenation would collapse.
  v_payload_hash := md5(jsonb_build_object(
    'round_id',   p_round_id,
    'operations', p_operations,
    'reason',     p_reason
  )::TEXT);

  -- 5. Fast-path Idempotency Check with Payload Fingerprint Validation (pre-lock)
  SELECT response_payload, request_payload_hash
  INTO v_cached_response, v_cached_hash
  FROM public.idempotency_records
  WHERE event_id = p_event_id AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    -- Legacy records added before migration 20261118000000 have NULL request_payload_hash.
    -- Silently returning their cached response would bypass payload verification.
    -- Reject them so the caller issues a fresh UUID for the new batch.
    IF v_cached_hash IS NULL THEN
      RAISE EXCEPTION
        'Idempotency key "%" references a legacy record that predates payload verification. '
        'Please use a new unique key (UUID) to submit a fresh scoring batch. '
        'Note: your previous submission with this key may have succeeded — check the history before resubmitting.',
        p_idempotency_key
        USING ERRCODE = '23505';
    END IF;
    -- Reusing an existing key with a different payload MUST be rejected.
    IF v_cached_hash != v_payload_hash THEN
      RAISE EXCEPTION 'Idempotency conflict: idempotency key "%" was already used for a different scoring batch payload', p_idempotency_key
        USING ERRCODE = '23505';
    END IF;
    RETURN v_cached_response;
  END IF;

  -- 6. Lock Event Row exclusively and verify active status
  SELECT status INTO v_event_status
  FROM public.events
  WHERE id = p_event_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found or has been soft-deleted', p_event_id;
  END IF;

  IF v_event_status != 'active' THEN
    RAISE EXCEPTION 'Event % is currently "%". Scores can only be recorded in active events.', p_event_id, v_event_status
      USING ERRCODE = '22000';
  END IF;

  -- 7. Re-check Idempotency under Event Lock (double-checked locking pattern)
  SELECT response_payload, request_payload_hash
  INTO v_cached_response, v_cached_hash
  FROM public.idempotency_records
  WHERE event_id = p_event_id AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_cached_hash IS NULL THEN
      RAISE EXCEPTION
        'Idempotency key "%" references a legacy record that predates payload verification. '
        'Please use a new unique key (UUID) to submit a fresh scoring batch. '
        'Note: your previous submission with this key may have succeeded — check the history before resubmitting.',
        p_idempotency_key
        USING ERRCODE = '23505';
    END IF;
    IF v_cached_hash != v_payload_hash THEN
      RAISE EXCEPTION 'Idempotency conflict: idempotency key "%" was already used for a different scoring batch payload', p_idempotency_key
        USING ERRCODE = '23505';
    END IF;
    RETURN v_cached_response;
  END IF;

  -- 8. Round Validation & Compatible Row Locking
  IF p_round_id IS NOT NULL THEN
    SELECT id, event_id, status, deleted_at
    INTO v_round_rec
    FROM public.rounds
    WHERE id = p_round_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Round % not found', p_round_id;
    END IF;

    IF v_round_rec.event_id != p_event_id THEN
      RAISE EXCEPTION 'Round % does not belong to event %', p_round_id, p_event_id;
    END IF;

    IF v_round_rec.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot record scores for soft-deleted round %', p_round_id;
    END IF;

    IF v_round_rec.status = 'completed' THEN
      RAISE EXCEPTION 'Cannot record scores in completed round %. It must be reopened by an event owner first.', p_round_id
        USING ERRCODE = '22000';
    END IF;

    IF v_round_rec.status != 'active' THEN
      RAISE EXCEPTION 'Round % is currently "%". Scores can only be recorded in active rounds.', p_round_id, v_round_rec.status
        USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 9. Lock participating teams in deterministic order to prevent deadlocks
  SELECT ARRAY_AGG(t_id ORDER BY t_id)
  INTO v_distinct_team_ids
  FROM (
    SELECT DISTINCT (op->>'team_id')::UUID AS t_id
    FROM jsonb_array_elements(p_operations) op
  ) sub;

  PERFORM 1
  FROM public.teams
  WHERE id = ANY(v_distinct_team_ids)
  ORDER BY id
  FOR UPDATE;

  -- 10. Lock event_settings row to prevent concurrent changes to starting_score
  PERFORM 1
  FROM public.event_settings
  WHERE event_id = p_event_id
  FOR UPDATE;

  -- 11. Retrieve Event Settings (Starting Score only; allow_negative_scores is deprecated)
  SELECT COALESCE(starting_score, 0.00)
  INTO v_starting_score
  FROM public.event_settings
  WHERE event_id = p_event_id;

  IF NOT FOUND THEN
    v_starting_score := 0.00;
  END IF;

  -- 12. Process each operation sequentially, strictly preserving submitted array order
  FOR v_op, v_idx IN
    SELECT op, ord
    FROM jsonb_array_elements(p_operations) WITH ORDINALITY AS arr(op, ord)
    ORDER BY ord ASC
  LOOP
    v_team_id := (v_op->>'team_id')::UUID;
    v_op_type := upper(btrim(v_op->>'operation_type'));
    v_val := (v_op->>'input_value')::NUMERIC(12, 2);

    -- Validate team existence, event ownership, and non-deleted status
    SELECT event_id, deleted_at
    INTO v_team_event_id, v_team_deleted_at
    FROM public.teams
    WHERE id = v_team_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Team % not found', v_team_id;
    END IF;

    IF v_team_event_id != p_event_id THEN
      RAISE EXCEPTION 'Team % does not belong to event %', v_team_id, p_event_id;
    END IF;

    IF v_team_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot record scores for soft-deleted team %', v_team_id;
    END IF;

    -- Authoritative Previous Score:
    -- Always calculates against the team's current OVERALL TOURNAMENT SCORE.
    -- In-transaction queries include transactions inserted earlier in this loop,
    -- correctly chaining multiple operations on the same team within one batch.
    SELECT COALESCE(SUM(points_delta), 0.00) INTO v_total_delta
    FROM public.score_transactions
    WHERE team_id = v_team_id
      AND event_id = p_event_id;

    v_prev_score := v_starting_score + v_total_delta;

    -- Authoritative arithmetic: five operations, each precisely specified.
    -- SUBTRACT: zero-floor is unconditional (allow_negative_scores is deprecated).
    --   R = GREATEST(0, P - V)
    --   delta = R - P  (the actual clamped delta, NOT -V)
    IF v_op_type = 'ADD' THEN
      v_res_score := v_prev_score + v_val;
      v_delta     := v_val;

    ELSIF v_op_type = 'SUBTRACT' THEN
      -- Zero-floor: clamp result to 0 when penalty exceeds available score.
      -- Never rejects a valid SUBTRACT. Delta reflects the actual score change.
      v_res_score := GREATEST(0.00, v_prev_score - v_val);
      v_delta     := v_res_score - v_prev_score;

    ELSIF v_op_type = 'MULTIPLY' THEN
      v_res_score := ROUND(v_prev_score * v_val, 2);
      v_delta     := v_res_score - v_prev_score;

    ELSIF v_op_type = 'DIVIDE' THEN
      IF v_val = 0 THEN
        RAISE EXCEPTION 'Division by zero is not permitted for team %', v_team_id
          USING ERRCODE = '22012';
      END IF;
      v_res_score := ROUND(v_prev_score / v_val, 2);
      v_delta     := v_res_score - v_prev_score;

    ELSIF v_op_type = 'SET_SCORE' THEN
      v_res_score := v_val;
      v_delta     := v_val - v_prev_score;

    ELSE
      RAISE EXCEPTION 'Invalid operation type: %. Must be ADD, SUBTRACT, MULTIPLY, DIVIDE, or SET_SCORE.', v_op_type;
    END IF;

    -- Insert into immutable score ledger
    INSERT INTO public.score_transactions (
      event_id,
      team_id,
      round_id,
      operation_type,
      input_value,
      previous_score,
      resulting_score,
      points_delta,
      reason,
      idempotency_key,
      created_by,
      created_at
    ) VALUES (
      p_event_id,
      v_team_id,
      p_round_id,
      v_op_type,
      v_val,
      v_prev_score,
      v_res_score,
      v_delta,
      COALESCE(v_op->>'reason', p_reason),
      p_idempotency_key,
      auth.uid(),
      clock_timestamp()
    )
    RETURNING id INTO v_tx_id;

    v_recorded_ids := array_append(v_recorded_ids, v_tx_id);

    -- Build structured audit record for response payload
    v_tx_records := v_tx_records || jsonb_build_object(
      'id', v_tx_id,
      'team_id', v_team_id,
      'operation_type', v_op_type,
      'input_value', v_val,
      'previous_score', v_prev_score,
      'resulting_score', v_res_score,
      'points_delta', v_delta
    );

    v_updated_scores := jsonb_set(
      v_updated_scores,
      ARRAY[v_team_id::TEXT],
      to_jsonb(v_res_score)
    );
  END LOOP;

  -- 13. Construct authoritative response payload
  v_cached_response := jsonb_build_object(
    'success', TRUE,
    'event_id', p_event_id,
    'round_id', p_round_id,
    'transactions_count', array_length(v_recorded_ids, 1),
    'transaction_ids', to_jsonb(v_recorded_ids),
    'transactions', v_tx_records,
    'updated_scores', v_updated_scores,
    'recorded_at', clock_timestamp()
  );

  -- 14. Store idempotency record with payload fingerprint
  INSERT INTO public.idempotency_records (event_id, idempotency_key, response_payload, request_payload_hash, created_at)
  VALUES (p_event_id, p_idempotency_key, v_cached_response, v_payload_hash, clock_timestamp())
  ON CONFLICT (event_id, idempotency_key) DO UPDATE
    SET response_payload = EXCLUDED.response_payload,
        request_payload_hash = EXCLUDED.request_payload_hash;

  RETURN v_cached_response;
END;
$$;

-- Function ownership & permissions (identical to previous migration)
ALTER FUNCTION public.record_score_batch(UUID, UUID, TEXT, JSONB, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_score_batch(UUID, UUID, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_score_batch(UUID, UUID, TEXT, JSONB, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_score_batch(UUID, UUID, TEXT, JSONB, TEXT) TO authenticated;

-- ====================================================================
-- UPDATED REVERSE SCORE TRANSACTION FUNCTION
-- Changes from previous version:
--   • Reversal result is clamped to GREATEST(0, P + rev_delta) — mirrors
--     the SUBTRACT zero-floor so reversals of ADD transactions at a low
--     current score cannot go negative.
--   • The old allow_negative_scores gate on reversals is removed.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.reverse_score_transaction(
  p_transaction_id UUID,
  p_reason TEXT DEFAULT 'Reversal requested by organizer'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_orig RECORD;
  v_prev_score NUMERIC(12, 2);
  v_res_score NUMERIC(12, 2);
  v_rev_delta NUMERIC(12, 2);
  v_starting_score NUMERIC(12, 2);
  v_existing_rev_id UUID;
  v_tx_id UUID;
  v_cached_response JSONB;
BEGIN
  -- 1. Authorization check: caller must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not authenticated'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Find and exclusively lock original transaction row
  SELECT * INTO v_orig
  FROM public.score_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original transaction % not found', p_transaction_id;
  END IF;

  IF v_orig.reversal_of_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot reverse transaction % because it is itself a reversal record', p_transaction_id;
  END IF;

  -- 3. Authorization Check: Caller must be admin for original event
  IF NOT public.check_is_event_admin(v_orig.event_id, 'organizer') THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an authorized administrator for this event'
      USING ERRCODE = '42501';
  END IF;

  -- 4. Exclusively lock event, team, and event_settings rows in deterministic order
  -- Consistent lock hierarchy: events -> teams -> event_settings (prevents deadlocks)
  PERFORM 1
  FROM public.events
  WHERE id = v_orig.event_id
  FOR UPDATE;

  PERFORM 1
  FROM public.teams
  WHERE id = v_orig.team_id
  FOR UPDATE;

  PERFORM 1
  FROM public.event_settings
  WHERE event_id = v_orig.event_id
  FOR UPDATE;

  -- 5. Re-check for existing reversal AFTER acquiring exclusive locks
  SELECT id INTO v_existing_rev_id
  FROM public.score_transactions
  WHERE reversal_of_transaction_id = p_transaction_id;

  IF FOUND THEN
    RAISE EXCEPTION 'Transaction % has already been reversed by transaction %', p_transaction_id, v_existing_rev_id
      USING ERRCODE = '23505';
  END IF;

  -- 6. Retrieve starting_score under row lock (allow_negative_scores is deprecated)
  SELECT COALESCE(starting_score, 0.00)
  INTO v_starting_score
  FROM public.event_settings
  WHERE event_id = v_orig.event_id;

  IF NOT FOUND THEN
    v_starting_score := 0.00;
  END IF;

  -- 7. Calculate current overall tournament score
  SELECT v_starting_score + COALESCE(SUM(points_delta), 0.00) INTO v_prev_score
  FROM public.score_transactions
  WHERE team_id = v_orig.team_id
    AND event_id = v_orig.event_id;

  -- 8. Compute reversal delta and enforce Zero-Floor Policy.
  --    Reversal undoes the recorded points_delta, not the original input_value.
  --    Example: SUBTRACT 10 on score-5 clamped to 0 (delta=-5).
  --    Reversal: rev_delta = +5, result = current + 5.
  --    A compensating reversal cannot produce a negative overall score.
  --    If subsequent operations reduced the score such that undoing this transaction
  --    would drive the score negative, the reversal is rejected with ERRCODE 22000.
  v_rev_delta := -v_orig.points_delta;
  v_res_score := v_prev_score + v_rev_delta;

  IF v_res_score < 0 THEN
    RAISE EXCEPTION 'Cannot reverse transaction %: resulting score % would be negative and violates the zero-floor policy for event %',
      p_transaction_id, v_res_score, v_orig.event_id
      USING ERRCODE = '22000';
  END IF;

  -- 9. Insert reversal record into immutable score ledger
  INSERT INTO public.score_transactions (
    event_id,
    team_id,
    round_id,
    operation_type,
    input_value,
    previous_score,
    resulting_score,
    points_delta,
    reason,
    reversal_of_transaction_id,
    created_by,
    created_at
  ) VALUES (
    v_orig.event_id,
    v_orig.team_id,
    v_orig.round_id,
    'SUBTRACT',
    abs(v_orig.points_delta),
    v_prev_score,
    v_res_score,
    v_rev_delta,
    COALESCE(p_reason, 'Reversal of transaction ' || p_transaction_id::TEXT),
    p_transaction_id,
    auth.uid(),
    clock_timestamp()
  )
  RETURNING id INTO v_tx_id;

  v_cached_response := jsonb_build_object(
    'success', TRUE,
    'reversal_transaction_id', v_tx_id,
    'original_transaction_id', p_transaction_id,
    'team_id', v_orig.team_id,
    'previous_score', v_prev_score,
    'resulting_score', v_res_score,
    'points_delta', v_rev_delta,
    'recorded_at', clock_timestamp()
  );

  RETURN v_cached_response;
END;
$$;

-- Function ownership & permissions (identical to previous migration)
ALTER FUNCTION public.reverse_score_transaction(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reverse_score_transaction(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_score_transaction(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.reverse_score_transaction(UUID, TEXT) TO authenticated;

-- ====================================================================
-- HARDENED update_event_settings() FUNCTION
-- Includes non-negative starting_score validation:
--   • starting_score must be >= 0 (ERRCODE 22023).
--   • starting_score is immutable once score transactions exist.
--   • Lock order: events -> event_settings (prevents deadlocks).
-- ====================================================================

CREATE OR REPLACE FUNCTION public.update_event_settings(
  p_event_id UUID,
  p_leaderboard_visible BOOLEAN DEFAULT NULL,
  p_leaderboard_frozen BOOLEAN DEFAULT NULL,
  p_starting_score NUMERIC(12, 2) DEFAULT NULL,
  p_allow_negative_scores BOOLEAN DEFAULT NULL,
  p_sort_direction TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_frozen_at TIMESTAMPTZ;
  v_res JSONB;
  v_current_starting_score NUMERIC(12, 2);
  v_tx_exists BOOLEAN;
BEGIN
  -- 1. Authorization Check: Caller must be an authorized admin for p_event_id
  IF auth.uid() IS NULL OR NOT public.check_is_event_admin(p_event_id, 'organizer') THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an authorized administrator for event %', p_event_id
      USING ERRCODE = '42501';
  END IF;

  -- 2. Lock event row first (Locking Hierarchy: events -> event_settings)
  PERFORM 1
  FROM public.events
  WHERE id = p_event_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found or has been soft-deleted', p_event_id;
  END IF;

  -- 3. Lock event_settings row next and fetch current starting_score
  SELECT starting_score INTO v_current_starting_score
  FROM public.event_settings
  WHERE event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.event_settings (
      event_id,
      starting_score,
      leaderboard_visible,
      leaderboard_frozen,
      allow_negative_scores,
      sort_direction
    )
    VALUES (
      p_event_id,
      COALESCE(p_starting_score, 0.00),
      TRUE,
      FALSE,
      FALSE,
      'desc'
    )
    RETURNING starting_score INTO v_current_starting_score;
  END IF;

  -- 4. Validate starting_score: must be non-negative
  IF p_starting_score IS NOT NULL AND p_starting_score < 0 THEN
    RAISE EXCEPTION 'starting_score must be non-negative (got %)', p_starting_score
      USING ERRCODE = '22023';
  END IF;

  -- 5. Protect starting_score integrity:
  -- Changing starting_score is rejected if any score transactions exist for the event.
  -- Supplying the identical starting_score value is permitted.
  IF p_starting_score IS NOT NULL AND p_starting_score != v_current_starting_score THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.score_transactions
      WHERE event_id = p_event_id
    ) INTO v_tx_exists;

    IF v_tx_exists THEN
      RAISE EXCEPTION 'Cannot modify starting_score after score transactions have been recorded for event %', p_event_id
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Validate sort_direction if provided
  IF p_sort_direction IS NOT NULL AND p_sort_direction NOT IN ('desc', 'asc') THEN
    RAISE EXCEPTION 'Invalid sort_direction: "%". Must be "desc" or "asc".', p_sort_direction
      USING ERRCODE = '22023';
  END IF;

  -- Compute frozen_at timestamp if leaderboard_frozen is updated
  IF p_leaderboard_frozen IS TRUE THEN
    v_frozen_at := clock_timestamp();
  ELSIF p_leaderboard_frozen IS FALSE THEN
    v_frozen_at := NULL;
  END IF;

  -- 6. Apply updates atomically
  UPDATE public.event_settings
  SET
    leaderboard_visible   = COALESCE(p_leaderboard_visible, leaderboard_visible),
    leaderboard_frozen    = COALESCE(p_leaderboard_frozen, leaderboard_frozen),
    frozen_at             = CASE
                              WHEN p_leaderboard_frozen IS NOT NULL THEN v_frozen_at
                              ELSE frozen_at
                            END,
    starting_score        = COALESCE(p_starting_score, starting_score),
    allow_negative_scores = COALESCE(p_allow_negative_scores, allow_negative_scores),
    sort_direction        = COALESCE(p_sort_direction, sort_direction),
    updated_at            = clock_timestamp()
  WHERE event_id = p_event_id
  RETURNING to_jsonb(event_settings.*) INTO v_res;

  RETURN jsonb_build_object('success', TRUE, 'settings', v_res);
END;
$$;

-- Function ownership & permissions
ALTER FUNCTION public.update_event_settings(UUID, BOOLEAN, BOOLEAN, NUMERIC, BOOLEAN, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_event_settings(UUID, BOOLEAN, BOOLEAN, NUMERIC, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_event_settings(UUID, BOOLEAN, BOOLEAN, NUMERIC, BOOLEAN, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_event_settings(UUID, BOOLEAN, BOOLEAN, NUMERIC, BOOLEAN, TEXT) TO authenticated;

