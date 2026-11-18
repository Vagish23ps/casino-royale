-- ====================================================================
-- CASINO ROYALE — FORWARD MIGRATION: REPAIR SCORING ENGINE & AUDIT TRAIL
-- Revision: 2026-11-18 (Final Targeted Hardening — Pass 3: Reversal Settings Lock + update_event_settings RPC)
-- Description:
-- 1. Updates public.record_score_batch() so that all operations (ADD,
--    SUBTRACT, MULTIPLY, DIVIDE, and SET_SCORE) calculate against the team's
--    authoritative current OVERALL TOURNAMENT SCORE.
-- 2. SET_SCORE strictly performs absolute score replacement:
--    - previous_score = current_overall_score
--    - resulting_score = input_value
--    - points_delta = input_value - current_overall_score
-- 3. Round context (p_round_id) is preserved on each transaction for
--    audit provenance, round-level reporting, and live event display.
-- 4. Handles intra-batch sequential updates for multiple operations on
--    the same team within one atomic transaction, preserving explicit
--    submitted array order via WITH ORDINALITY and ORDER BY ord ASC.
-- 5. Strict input validation on p_operations:
--    - Rejects SQL NULL, non-array, and empty arrays.
--    - Validates team_id (UUID syntax), operation_type, and input_value.
--    - Strictly rejects inputs exceeding 2 decimal places (prevents silent rounding).
--    - Enforces NUMERIC(12, 2) boundary limits.
-- 6. Event, Round and event_settings concurrency & status locking:
--    - Verifies event is active (status = 'active') and not deleted.
--    - Locks event row and round row exclusively (FOR UPDATE) to prevent
--      concurrent round completion race conditions during score batch insertion.
--    - Locks event_settings row (FOR UPDATE) to prevent concurrent changes to
--      starting_score or allow_negative_scores mid-transaction.
-- 7. Idempotency Payload Fingerprinting:
--    - p_idempotency_key is now REQUIRED (NULL, blank, and whitespace-only rejected).
--    - Adds request_payload_hash to public.idempotency_records.
--    - Fingerprint uses canonical JSONB (jsonb_build_object) so NULL p_reason
--      and empty-string p_reason produce distinct hashes.
--    - Replaying exact same payload returns cached response.
--    - Reusing key with a different payload is strictly rejected with ERRCODE 23505.
--    - Legacy records with NULL request_payload_hash are rejected; callers
--      must generate a fresh UUID key to submit a new batch.
-- 8. Concurrent reversal handling & lock ordering:
--    - Locks original transaction, event, team, and event_settings rows deterministically.
--    - Consistent lock acquisition order across all mutating procedures:
--      events -> teams -> event_settings (prevents deadlocks).
--    - Re-checks for an existing reversal AFTER acquiring exclusive locks.
--    - Enforces unique partial index on reversal_of_transaction_id.
--    - Enforces event_settings.allow_negative_scores on reversals under row lock.
-- 9. Authoritative update_event_settings() RPC:
--    - Enforces identical lock order (events -> event_settings) during settings mutations.
-- 10. Hardened permissions:
--    - Revokes EXECUTE from PUBLIC and anon; grants EXECUTE only to authenticated.
--    - Sets owner to postgres with SECURITY DEFINER and search_path = public, pg_temp.
--    - Restricts direct table writes on score_transactions to authenticated.
-- 11. Enhanced v_team_round_scores view:
--     - Preserves original 9 columns in exact positions 1 through 9.
--     - Appends earned_points (pure gameplay), adjustment_points (SET_SCORE overrides),
--       reversal_points (compensating reversals), has_score_reset, and has_reversal.
-- ====================================================================

-- 1. Add request_payload_hash to idempotency_records
ALTER TABLE public.idempotency_records
ADD COLUMN IF NOT EXISTS request_payload_hash TEXT;

-- 2. Check for any existing duplicate reversals before creating unique index
DO $$
DECLARE
  v_dup_count INT;
BEGIN
  SELECT count(*) INTO v_dup_count
  FROM (
    SELECT reversal_of_transaction_id
    FROM public.score_transactions
    WHERE reversal_of_transaction_id IS NOT NULL
    GROUP BY reversal_of_transaction_id
    HAVING count(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot create unique partial index: found % existing duplicate reversals in public.score_transactions', v_dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_score_transactions_unique_reversal
ON public.score_transactions (reversal_of_transaction_id)
WHERE reversal_of_transaction_id IS NOT NULL;

-- ====================================================================
-- ATOMIC BATCH SCORING FUNCTION
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
  v_allow_negative BOOLEAN;
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

    -- Validate input_value
    IF v_op->'input_value' IS NULL OR jsonb_typeof(v_op->'input_value') = 'null' OR btrim(COALESCE(v_op->>'input_value', '')) = '' THEN
      RAISE EXCEPTION 'Operation item at index % is missing required field "input_value"', v_idx - 1
        USING ERRCODE = '22023';
    END IF;

    IF (v_op->>'input_value') !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'Operation item at index % has unsupported or malformed numeric input_value: "%"',
        v_idx - 1, v_op->>'input_value'
        USING ERRCODE = '22023';
    END IF;

    -- Enforce strict decimal precision: reject inputs with more than 2 decimal places to prevent silent rounding
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
  -- p_idempotency_key is guaranteed non-null/non-blank by step 2 above.
  SELECT response_payload, request_payload_hash
  INTO v_cached_response, v_cached_hash
  FROM public.idempotency_records
  WHERE event_id = p_event_id AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    -- Legacy records added before this migration have NULL request_payload_hash.
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
  -- Guards against a concurrent submission that committed between the pre-lock
  -- check and the moment this connection acquired the event FOR UPDATE lock.
  -- p_idempotency_key is guaranteed non-null/non-blank by step 2 above.
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
  -- Exclusively locks round row (FOR UPDATE) to serialize against concurrent round completion
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
  --     or allow_negative_scores while this batch is being processed.
  --     All callers mutating event_settings must also hold the event FOR UPDATE lock
  --     (enforced by application logic) to serialize against this acquisition order.
  PERFORM 1
  FROM public.event_settings
  WHERE event_id = p_event_id
  FOR UPDATE;

  -- 11. Retrieve Event Settings (Starting Score and Negative Scores Policy)
  SELECT
    COALESCE(starting_score, 0.00),
    COALESCE(allow_negative_scores, FALSE)
  INTO
    v_starting_score,
    v_allow_negative
  FROM public.event_settings
  WHERE event_id = p_event_id;

  IF NOT FOUND THEN
    v_starting_score := 0.00;
    v_allow_negative := FALSE;
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

    -- Authoritative arithmetic computation based on Current Overall Score
    IF v_op_type = 'ADD' THEN
      v_res_score := v_prev_score + v_val;
      v_delta := v_val;
    ELSIF v_op_type = 'SUBTRACT' THEN
      v_res_score := v_prev_score - v_val;
      v_delta := -v_val;
    ELSIF v_op_type = 'MULTIPLY' THEN
      v_res_score := ROUND(v_prev_score * v_val, 2);
      v_delta := v_res_score - v_prev_score;
    ELSIF v_op_type = 'DIVIDE' THEN
      IF v_val = 0 THEN
        RAISE EXCEPTION 'Division by zero is not permitted for team %', v_team_id
          USING ERRCODE = '22012';
      END IF;
      v_res_score := ROUND(v_prev_score / v_val, 2);
      v_delta := v_res_score - v_prev_score;
    ELSIF v_op_type = 'SET_SCORE' THEN
      v_res_score := v_val;
      v_delta := v_val - v_prev_score;
    ELSE
      RAISE EXCEPTION 'Invalid operation type: %. Must be ADD, SUBTRACT, MULTIPLY, DIVIDE, or SET_SCORE.', v_op_type;
    END IF;

    -- Enforce Negative Scores Policy
    IF NOT v_allow_negative AND v_res_score < 0 THEN
      RAISE EXCEPTION 'Negative scores are not permitted for event % (Team % resulting score: %)',
        p_event_id, v_team_id, v_res_score
        USING ERRCODE = '22000';
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
  -- p_idempotency_key is guaranteed non-null/non-blank; no conditional guard needed.
  INSERT INTO public.idempotency_records (event_id, idempotency_key, response_payload, request_payload_hash, created_at)
  VALUES (p_event_id, p_idempotency_key, v_cached_response, v_payload_hash, clock_timestamp())
  ON CONFLICT (event_id, idempotency_key) DO UPDATE
    SET response_payload = EXCLUDED.response_payload,
        request_payload_hash = EXCLUDED.request_payload_hash;

  RETURN v_cached_response;
END;
$$;

-- Function ownership & permissions
ALTER FUNCTION public.record_score_batch(UUID, UUID, TEXT, JSONB, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_score_batch(UUID, UUID, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_score_batch(UUID, UUID, TEXT, JSONB, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_score_batch(UUID, UUID, TEXT, JSONB, TEXT) TO authenticated;

-- ====================================================================
-- REVERSE SCORE TRANSACTION (Hardened Concurrency & Negative Check)
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
  v_allow_negative BOOLEAN;
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

  -- 6. Retrieve event settings under row lock (starting score and allow_negative_scores)
  SELECT
    COALESCE(starting_score, 0.00),
    COALESCE(allow_negative_scores, FALSE)
  INTO
    v_starting_score,
    v_allow_negative
  FROM public.event_settings
  WHERE event_id = v_orig.event_id;

  IF NOT FOUND THEN
    v_starting_score := 0.00;
    v_allow_negative := FALSE;
  END IF;

  -- 7. Calculate current overall tournament score
  SELECT v_starting_score + COALESCE(SUM(points_delta), 0.00) INTO v_prev_score
  FROM public.score_transactions
  WHERE team_id = v_orig.team_id
    AND event_id = v_orig.event_id;

  v_rev_delta := -v_orig.points_delta;
  v_res_score := v_prev_score + v_rev_delta;

  -- 8. Enforce Negative Score Policy on reversal
  IF NOT v_allow_negative AND v_res_score < 0 THEN
    RAISE EXCEPTION 'Cannot reverse transaction %: resulting score % would be negative and allow_negative_scores is disabled for event %',
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

-- Function ownership & permissions
ALTER FUNCTION public.reverse_score_transaction(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reverse_score_transaction(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_score_transaction(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.reverse_score_transaction(UUID, TEXT) TO authenticated;

-- ====================================================================
-- AUTHORITATIVE EVENT SETTINGS UPDATE FUNCTION
-- Enforces consistent lock order (events -> event_settings) to prevent deadlocks
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
BEGIN
  -- 1. Authorization Check: Caller must be an authorized admin for p_event_id
  IF auth.uid() IS NULL OR NOT public.check_is_event_admin(p_event_id, 'organizer') THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an authorized administrator for event %', p_event_id
      USING ERRCODE = '42501';
  END IF;

  -- 2. Lock event row first (Hierarchy: events -> event_settings)
  PERFORM 1
  FROM public.events
  WHERE id = p_event_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found or has been soft-deleted', p_event_id;
  END IF;

  -- 3. Lock event_settings row next
  PERFORM 1
  FROM public.event_settings
  WHERE event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settings for event % not found', p_event_id;
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

  -- 4. Apply updates atomically
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

-- ====================================================================
-- TABLE LEVEL PERMISSIONS HARDENING
-- ====================================================================

REVOKE ALL ON TABLE public.score_transactions FROM PUBLIC;
REVOKE ALL ON TABLE public.score_transactions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.score_transactions FROM authenticated;
GRANT SELECT ON TABLE public.score_transactions TO authenticated;

-- ====================================================================
-- ENHANCED ROUND-LEVEL REPORTING VIEW
-- Preserves original 9 columns in exact order; appends distinct breakdown fields
-- ====================================================================

CREATE OR REPLACE VIEW public.v_team_round_scores
WITH (security_barrier = true, security_invoker = false) AS
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
  -- Appended Breakdown Columns (Positions 10-14)
  COALESCE(SUM(CASE WHEN st.operation_type != 'SET_SCORE' AND st.reversal_of_transaction_id IS NULL THEN st.points_delta ELSE 0.00 END), 0.00) AS earned_points,
  COALESCE(SUM(CASE WHEN st.operation_type = 'SET_SCORE' AND st.reversal_of_transaction_id IS NULL THEN st.points_delta ELSE 0.00 END), 0.00) AS adjustment_points,
  COALESCE(SUM(CASE WHEN st.reversal_of_transaction_id IS NOT NULL THEN st.points_delta ELSE 0.00 END), 0.00) AS reversal_points,
  BOOL_OR(st.operation_type = 'SET_SCORE') AS has_score_reset,
  BOOL_OR(st.reversal_of_transaction_id IS NOT NULL) AS has_reversal
FROM public.score_transactions st
JOIN public.events e ON st.event_id = e.id AND e.deleted_at IS NULL AND e.status = 'active'
LEFT JOIN public.event_settings es ON e.id = es.event_id
JOIN public.rounds r ON st.round_id = r.id AND r.deleted_at IS NULL AND r.event_id = e.id
JOIN public.teams t ON st.team_id = t.id AND t.deleted_at IS NULL AND t.event_id = e.id
WHERE st.round_id IS NOT NULL
  AND (
    COALESCE(es.leaderboard_visible, TRUE) IS TRUE
    OR public.check_is_event_admin(e.id, 'organizer')
  )
GROUP BY st.event_id, st.round_id, r.name, r.round_number, st.team_id;

GRANT SELECT ON public.v_team_round_scores TO anon, authenticated;
