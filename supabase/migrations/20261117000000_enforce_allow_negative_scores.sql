-- ====================================================================
-- CASINO ROYALE — FORWARD-FIX MIGRATION: ENFORCE ALLOW_NEGATIVE_SCORES
-- Revision: 2026-11-17
-- Description: Updates public.record_score_batch() to read event_settings.allow_negative_scores
--              and reject any operation that produces a negative resulting score when disabled.
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
  v_team_id UUID;
  v_team_event_id UUID;
  v_team_deleted_at TIMESTAMPTZ;
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
  v_distinct_team_ids UUID[];
BEGIN
  -- 1. Authorization Check: Caller must be an authorized admin for p_event_id
  IF auth.uid() IS NULL OR NOT public.check_is_event_admin(p_event_id, 'organizer') THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an authorized administrator for event %', p_event_id
      USING ERRCODE = '42501';
  END IF;

  -- 2. Fast-path Idempotency Check (before lock)
  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) != '' THEN
    SELECT response_payload INTO v_cached_response
    FROM public.idempotency_records
    WHERE event_id = p_event_id AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN v_cached_response;
    END IF;
  END IF;

  -- 3. Lock Event Row exclusively to serialize all score mutations for this event
  PERFORM 1
  FROM public.events
  WHERE id = p_event_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active event % not found or has been deleted', p_event_id;
  END IF;

  -- 4. Re-check Idempotency under Event Lock (guarantees concurrent retries never duplicate)
  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) != '' THEN
    SELECT response_payload INTO v_cached_response
    FROM public.idempotency_records
    WHERE event_id = p_event_id AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN v_cached_response;
    END IF;
  END IF;

  -- 5. Round Validation & Rule Enforcement
  IF p_round_id IS NOT NULL THEN
    SELECT id, event_id, status, deleted_at
    INTO v_round_rec
    FROM public.rounds
    WHERE id = p_round_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Round % not found', p_round_id;
    END IF;

    IF v_round_rec.event_id != p_event_id THEN
      RAISE EXCEPTION 'Round % does not belong to event %', p_round_id, p_event_id;
    END IF;

    IF v_round_rec.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot record scores for soft-deleted round %', p_round_id;
    END IF;

    -- Enforce: Completed rounds cannot be scored until reopened by the owner
    IF v_round_rec.status = 'completed' THEN
      RAISE EXCEPTION 'Cannot record scores in completed round %. It must be reopened by an event owner first.', p_round_id
        USING ERRCODE = '22000';
    END IF;

    -- Enforce: Scoring is only permitted in active rounds
    IF v_round_rec.status != 'active' THEN
      RAISE EXCEPTION 'Round % is currently "%". Scores can only be recorded in active rounds.', p_round_id, v_round_rec.status
        USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 6. Validate Operations Payload
  IF jsonb_typeof(p_operations) != 'array' OR jsonb_array_length(p_operations) = 0 THEN
    RAISE EXCEPTION 'p_operations must be a non-empty JSON array';
  END IF;

  -- 7. Lock participating teams in deterministic order to prevent deadlocks
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

  -- 8. Retrieve Event Settings (Starting Score and Negative Scores Policy)
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

  -- 9. Process each operation in batch atomically
  FOR v_op IN SELECT * FROM jsonb_array_elements(p_operations)
  LOOP
    v_team_id := (v_op->>'team_id')::UUID;
    v_op_type := upper(trim(v_op->>'operation_type'));
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

    -- Calculate previous score:
    -- When p_round_id is supplied, calculate using transactions belonging to that team and that round ONLY.
    -- When p_round_id IS NULL (event-level adjustment), calculate using overall cumulative score.
    IF p_round_id IS NOT NULL THEN
      SELECT COALESCE(SUM(points_delta), 0.00) INTO v_prev_score
      FROM public.score_transactions
      WHERE team_id = v_team_id
        AND round_id = p_round_id;
    ELSE
      SELECT COALESCE(SUM(points_delta), 0.00) INTO v_total_delta
      FROM public.score_transactions
      WHERE team_id = v_team_id;

      v_prev_score := v_starting_score + v_total_delta;
    END IF;

    -- Authoritative arithmetic computation based on previous score
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

    -- Enforce Negative Scores Policy:
    -- When allow_negative_scores is disabled (FALSE), reject any operation that produces a negative resulting score.
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
  END LOOP;

  -- 10. Construct response payload
  v_cached_response := jsonb_build_object(
    'success', TRUE,
    'event_id', p_event_id,
    'round_id', p_round_id,
    'transactions_count', array_length(v_recorded_ids, 1),
    'transaction_ids', to_jsonb(v_recorded_ids),
    'recorded_at', clock_timestamp()
  );

  -- 11. Store idempotency record scoped to event
  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) != '' THEN
    INSERT INTO public.idempotency_records (event_id, idempotency_key, response_payload, created_at)
    VALUES (p_event_id, p_idempotency_key, v_cached_response, clock_timestamp())
    ON CONFLICT (event_id, idempotency_key) DO UPDATE
      SET response_payload = EXCLUDED.response_payload;
  END IF;

  RETURN v_cached_response;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_score_batch(UUID, UUID, TEXT, JSONB, TEXT) TO authenticated;
