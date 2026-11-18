-- ====================================================================
-- CASINO ROYALE — POSTGRESQL PRODUCTION DATABASE MIGRATION
-- Revision: 2026-11-16 Complete Production Schema & Audited RPCs
-- ====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ====================================================================
-- 1. TABLES & CONSTRAINTS
-- ====================================================================

-- 1.1 ADMIN PROFILES
CREATE TABLE IF NOT EXISTS public.admin_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'organizer' CHECK (role IN ('owner', 'organizer', 'scorer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

DO $$
BEGIN
  ALTER TABLE public.admin_profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'organizer';
END;
$$;

-- 1.1.1 OWNER BOOTSTRAP SINGLETON
-- Ensures exactly one owner can ever be bootstrapped across the database lifecycle.
CREATE TABLE IF NOT EXISTS public.owner_bootstrap (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.owner_bootstrap ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_bootstrap FROM anon, authenticated;
GRANT SELECT ON public.owner_bootstrap TO authenticated, service_role;

-- Trigger: Prevent authenticated users from escalating their own role in admin_profiles
CREATE OR REPLACE FUNCTION public.enforce_profile_role_protection()
RETURNS TRIGGER AS $$
DECLARE
  v_is_bootstrap BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      -- Allow legitimate initial bootstrap: if no other owner exists yet,
      -- NEW.role = 'owner', and NEW.id matches the owner_bootstrap record.
      SELECT EXISTS (
        SELECT 1 FROM public.owner_bootstrap ob
        WHERE ob.owner_id = NEW.id
          AND NOT EXISTS (
            SELECT 1 FROM public.admin_profiles ap
            WHERE ap.role = 'owner' AND ap.id != NEW.id
          )
      ) INTO v_is_bootstrap;

      IF v_is_bootstrap THEN
        RETURN NEW;
      END IF;

      -- Role modifications strictly require an authorized existing Owner
      IF auth.uid() IS NULL OR NOT public.is_global_owner() THEN
        RAISE EXCEPTION 'Privilege Escalation Blocked: Role modifications require Owner authorization'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_profile_role_protection ON public.admin_profiles;
CREATE TRIGGER trg_profile_role_protection
  BEFORE UPDATE ON public.admin_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profile_role_protection();

-- 1.2 EVENTS
CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  deleted_at TIMESTAMPTZ
);

-- Trigger: Automatically enroll event creator as Owner in event_admins
CREATE OR REPLACE FUNCTION public.handle_new_event_creator()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.event_admins (event_id, admin_id, role)
    VALUES (NEW.id, auth.uid(), 'owner')
    ON CONFLICT (event_id, admin_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_new_event_creator ON public.events;
CREATE TRIGGER trg_new_event_creator
  AFTER INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_event_creator();

-- 1.3 EVENT ADMINS (Role-based access per event)
CREATE TABLE IF NOT EXISTS public.event_admins (
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'organizer' CHECK (role IN ('owner', 'organizer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (event_id, admin_id)
);

-- 1.4 EVENT SETTINGS (Starting score defaults to ZERO per requirements)
CREATE TABLE IF NOT EXISTS public.event_settings (
  event_id UUID PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  leaderboard_visible BOOLEAN NOT NULL DEFAULT TRUE,
  leaderboard_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  frozen_at TIMESTAMPTZ,
  starting_score NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  allow_negative_scores BOOLEAN NOT NULL DEFAULT FALSE,
  sort_direction TEXT NOT NULL DEFAULT 'desc' CHECK (sort_direction IN ('desc', 'asc')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

DO $$
BEGIN
  ALTER TABLE public.event_settings ADD COLUMN IF NOT EXISTS allow_negative_scores BOOLEAN NOT NULL DEFAULT FALSE;
END;
$$;

-- 1.5 TEAMS
CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  deleted_at TIMESTAMPTZ
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_event_team_name'
  ) THEN
    ALTER TABLE public.teams ADD CONSTRAINT uq_event_team_name UNIQUE (event_id, name);
  END IF;
END;
$$;

-- 1.6 ROUNDS
CREATE TABLE IF NOT EXISTS public.rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  deleted_at TIMESTAMPTZ
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_event_round_number'
  ) THEN
    ALTER TABLE public.rounds ADD CONSTRAINT uq_event_round_number UNIQUE (event_id, round_number);
  END IF;
END;
$$;

-- 1.7 IDEMPOTENCY RECORDS (Scoped to Event)
CREATE TABLE IF NOT EXISTS public.idempotency_records (
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  response_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (event_id, idempotency_key)
);

-- 1.8 SCORE TRANSACTIONS (Authoritative Immutable Audit Ledger)
-- Note: event_id, team_id, and round_id use ON DELETE RESTRICT to prevent hard deletion
-- of parent events, teams, or rounds from cascading into the immutable audit ledger.
CREATE TABLE IF NOT EXISTS public.score_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  round_id UUID REFERENCES public.rounds(id) ON DELETE RESTRICT,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'SET_SCORE')),
  input_value NUMERIC(12, 2) NOT NULL,
  previous_score NUMERIC(12, 2) NOT NULL,
  resulting_score NUMERIC(12, 2) NOT NULL,
  points_delta NUMERIC(12, 2) NOT NULL,
  reason TEXT,
  idempotency_key TEXT,
  reversal_of_transaction_id UUID REFERENCES public.score_transactions(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Ensure event_id, team_id, and round_id foreign key constraints enforce RESTRICT on existing databases
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'score_transactions'
      AND rc.constraint_name LIKE '%event_id%'
      AND rc.delete_rule != 'RESTRICT'
  ) THEN
    ALTER TABLE public.score_transactions DROP CONSTRAINT IF EXISTS score_transactions_event_id_fkey;
    ALTER TABLE public.score_transactions
      ADD CONSTRAINT score_transactions_event_id_fkey
      FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'score_transactions'
      AND rc.constraint_name LIKE '%team_id%'
      AND rc.delete_rule != 'RESTRICT'
  ) THEN
    ALTER TABLE public.score_transactions DROP CONSTRAINT IF EXISTS score_transactions_team_id_fkey;
    ALTER TABLE public.score_transactions
      ADD CONSTRAINT score_transactions_team_id_fkey
      FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'score_transactions'
      AND rc.constraint_name LIKE '%round_id%'
      AND rc.delete_rule != 'RESTRICT'
  ) THEN
    ALTER TABLE public.score_transactions DROP CONSTRAINT IF EXISTS score_transactions_round_id_fkey;
    ALTER TABLE public.score_transactions
      ADD CONSTRAINT score_transactions_round_id_fkey
      FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_transaction_reversal'
  ) THEN
    ALTER TABLE public.score_transactions ADD CONSTRAINT uq_transaction_reversal UNIQUE (reversal_of_transaction_id);
  END IF;
END;
$$;

-- ====================================================================
-- 2. INDEXES
-- ====================================================================

CREATE INDEX IF NOT EXISTS idx_teams_event ON public.teams(event_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rounds_event ON public.rounds(event_id, round_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rounds_active ON public.rounds(event_id) WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_score_tx_team ON public.score_transactions(team_id);
CREATE INDEX IF NOT EXISTS idx_score_tx_event ON public.score_transactions(event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_score_tx_round ON public.score_transactions(round_id);
CREATE INDEX IF NOT EXISTS idx_score_tx_team_round ON public.score_transactions(team_id, round_id);
CREATE INDEX IF NOT EXISTS idx_event_admins_lookup ON public.event_admins(admin_id, event_id, role);

-- ====================================================================
-- 3. HELPER SECURITY FUNCTIONS
-- ====================================================================

-- 3.0 RLS-safe helpers for admin_profiles policies.
-- These bypass RLS on admin_profiles (SECURITY DEFINER) so policies on
-- that same table never trigger recursive RLS evaluation.

CREATE OR REPLACE FUNCTION public.is_global_owner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_profiles
    WHERE id = auth.uid() AND role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_own_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.admin_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.check_is_event_admin(
  p_event_id UUID,
  p_required_role TEXT DEFAULT 'organizer'
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_admins ea
    WHERE ea.event_id = p_event_id
      AND ea.admin_id = auth.uid()
      AND (
        (p_required_role = 'organizer' AND ea.role IN ('owner', 'organizer'))
        OR (p_required_role = 'owner' AND ea.role = 'owner')
      )
  );
$$;

-- ====================================================================
-- 4. VIEWS (Public Sanitized Leaderboard & Team Round Scores)
-- Security Barrier enabled to prevent query side-channel data leakage.
-- Underlying raw score_transactions remain restricted to authorized admins.
-- ====================================================================

CREATE OR REPLACE VIEW public.v_public_overall_leaderboard
WITH (security_barrier = true, security_invoker = false) AS
WITH active_teams AS (
  SELECT t.id AS team_id,
         t.event_id,
         t.name AS team_name,
         t.color AS team_color,
         t.avatar_url,
         COALESCE(es.starting_score, 0.00) AS starting_score,
         COALESCE(es.leaderboard_frozen, FALSE) AS is_frozen,
         es.frozen_at
  FROM public.teams t
  JOIN public.events e ON t.event_id = e.id AND e.deleted_at IS NULL AND e.status = 'active'
  LEFT JOIN public.event_settings es ON e.id = es.event_id
  WHERE t.deleted_at IS NULL
    AND (
      COALESCE(es.leaderboard_visible, TRUE) IS TRUE
      OR public.check_is_event_admin(e.id, 'organizer')
    )
),
team_deltas AS (
  SELECT st.team_id,
         SUM(st.points_delta) AS total_delta
  FROM public.score_transactions st
  JOIN active_teams at ON st.team_id = at.team_id
  WHERE (at.is_frozen IS FALSE OR st.created_at <= at.frozen_at)
  GROUP BY st.team_id
)
SELECT
  at.event_id,
  at.team_id,
  at.team_name,
  at.team_color,
  at.avatar_url,
  (at.starting_score + COALESCE(td.total_delta, 0.00)) AS total_score,
  DENSE_RANK() OVER (
    PARTITION BY at.event_id
    ORDER BY (at.starting_score + COALESCE(td.total_delta, 0.00)) DESC
  ) AS rank
FROM active_teams at
LEFT JOIN team_deltas td ON at.team_id = td.team_id;

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
  COUNT(st.id) AS transactions_count
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

-- ====================================================================
-- 5. RPC: ATOMIC SCORE BATCH MUTATION (Round-Specific & Idempotent)
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

-- ====================================================================
-- 6. RPC: REVERSE SCORE TRANSACTION (Audited & Authorized)
-- ====================================================================

CREATE OR REPLACE FUNCTION public.reverse_score_transaction(
  p_transaction_id UUID,
  p_reason TEXT DEFAULT 'Transaction reversal by organizer'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_orig public.score_transactions%ROWTYPE;
  v_starting_score NUMERIC(12, 2);
  v_prev_score NUMERIC(12, 2);
  v_res_score NUMERIC(12, 2);
  v_rev_delta NUMERIC(12, 2);
  v_new_tx_id UUID;
  v_existing_rev_id UUID;
BEGIN
  -- 1. Find and lock original transaction row
  SELECT * INTO v_orig
  FROM public.score_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original transaction % not found', p_transaction_id;
  END IF;

  -- 2. Authorization Check: Caller must be admin for original event
  IF auth.uid() IS NULL OR NOT public.check_is_event_admin(v_orig.event_id, 'organizer') THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an authorized administrator for this event'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Concurrency-Safe Check: Prevent double-reversal
  SELECT id INTO v_existing_rev_id
  FROM public.score_transactions
  WHERE reversal_of_transaction_id = p_transaction_id
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'Transaction % has already been reversed by transaction %', p_transaction_id, v_existing_rev_id;
  END IF;

  IF v_orig.reversal_of_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot reverse transaction % because it is itself a reversal record', p_transaction_id;
  END IF;

  -- 4. Lock team row deterministically
  PERFORM 1
  FROM public.teams
  WHERE id = v_orig.team_id
  FOR UPDATE;

  -- 5. Calculate previous score for reversal:
  -- If round-specific, calculate using round transactions; otherwise overall score
  IF v_orig.round_id IS NOT NULL THEN
    SELECT COALESCE(SUM(points_delta), 0.00) INTO v_prev_score
    FROM public.score_transactions
    WHERE team_id = v_orig.team_id
      AND round_id = v_orig.round_id;
  ELSE
    SELECT COALESCE(starting_score, 0.00) INTO v_starting_score
    FROM public.event_settings
    WHERE event_id = v_orig.event_id;

    IF NOT FOUND THEN
      v_starting_score := 0.00;
    END IF;

    SELECT v_starting_score + COALESCE(SUM(points_delta), 0.00) INTO v_prev_score
    FROM public.score_transactions
    WHERE team_id = v_orig.team_id;
  END IF;

  v_rev_delta := -v_orig.points_delta;
  v_res_score := v_prev_score + v_rev_delta;

  -- 6. Insert reversal record into immutable score ledger
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
    ABS(v_orig.points_delta),
    v_prev_score,
    v_res_score,
    v_rev_delta,
    COALESCE(p_reason, 'Reversal of transaction ' || p_transaction_id::TEXT),
    p_transaction_id,
    auth.uid(),
    clock_timestamp()
  )
  RETURNING id INTO v_new_tx_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'reversed_transaction_id', p_transaction_id,
    'reversal_transaction_id', v_new_tx_id,
    'team_id', v_orig.team_id,
    'reversed_delta', v_rev_delta,
    'new_score', v_res_score
  );
END;
$$;

-- ====================================================================
-- 7. RPC: SET ROUND STATUS (Enforce Invariants & Owner Reopening)
-- ====================================================================

CREATE OR REPLACE FUNCTION public.set_round_status(
  p_round_id UUID,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.rounds%ROWTYPE;
BEGIN
  -- 1. Validate status argument
  IF p_status NOT IN ('upcoming', 'active', 'completed') THEN
    RAISE EXCEPTION 'Invalid round status: %. Must be upcoming, active, or completed.', p_status;
  END IF;

  -- 2. Find and lock round row
  SELECT * INTO v_round
  FROM public.rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Round % not found', p_round_id;
  END IF;

  IF v_round.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot update status of soft-deleted round %', p_round_id;
  END IF;

  -- 3. Authorization Check:
  -- Basic organizer check for all status updates
  IF auth.uid() IS NULL OR NOT public.check_is_event_admin(v_round.event_id, 'organizer') THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an authorized administrator for this event'
      USING ERRCODE = '42501';
  END IF;

  -- Enforce: Completed rounds cannot be reopened without OWNER role
  IF v_round.status = 'completed' AND p_status != 'completed' THEN
    IF NOT public.check_is_event_admin(v_round.event_id, 'owner') THEN
      RAISE EXCEPTION 'Unauthorized: Completed rounds cannot be reopened without owner privileges'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 4. Lock the parent event row exclusively
  PERFORM 1
  FROM public.events
  WHERE id = v_round.event_id
  FOR UPDATE;

  -- 5. Enforce: ONLY ONE round can be active at a time
  IF p_status = 'active' THEN
    UPDATE public.rounds
    SET status = 'upcoming', updated_at = clock_timestamp()
    WHERE event_id = v_round.event_id
      AND status = 'active'
      AND id != p_round_id;
  END IF;

  -- 6. Update round status
  UPDATE public.rounds
  SET status = p_status, updated_at = clock_timestamp()
  WHERE id = p_round_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'round_id', p_round_id,
    'status', p_status
  );
END;
$$;

-- ====================================================================
-- 8. RPC: REORDER ROUNDS (Atomic, Secure, and Collision-Free)
-- ====================================================================

CREATE OR REPLACE FUNCTION public.reorder_rounds(
  p_event_id UUID,
  p_round_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
  v_active_count INTEGER;
  v_i INTEGER;
  v_round_id UUID;
  v_safe_offset INTEGER;
BEGIN
  -- 1. Authorization: Verify caller is an authorized administrator for p_event_id
  IF auth.uid() IS NULL OR NOT public.check_is_event_admin(p_event_id, 'organizer') THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an authorized administrator for event %', p_event_id
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validate input array
  IF p_round_ids IS NULL OR array_length(p_round_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_round_ids must be a non-empty array of round UUIDs';
  END IF;

  v_count := array_length(p_round_ids, 1);

  -- 3. Lock parent event row exclusively to serialize reordering operations
  PERFORM 1
  FROM public.events
  WHERE id = p_event_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active event % not found or has been deleted', p_event_id;
  END IF;

  -- 4. Validate exact match: Every active (non-deleted) round must appear exactly once
  SELECT COUNT(*)
  INTO v_active_count
  FROM public.rounds
  WHERE event_id = p_event_id AND deleted_at IS NULL;

  IF v_count != v_active_count THEN
    RAISE EXCEPTION 'Invalid round reordering: Input array contains % rounds, but event has % active rounds',
      v_count, v_active_count;
  END IF;

  -- Verify no duplicate IDs in input array
  IF (SELECT COUNT(DISTINCT id) FROM unnest(p_round_ids) AS id) != v_count THEN
    RAISE EXCEPTION 'Duplicate round IDs detected in reorder input array';
  END IF;

  -- Verify every ID belongs to p_event_id and is not soft-deleted
  IF EXISTS (
    SELECT 1
    FROM unnest(p_round_ids) AS input_id
    LEFT JOIN public.rounds r ON r.id = input_id AND r.event_id = p_event_id AND r.deleted_at IS NULL
    WHERE r.id IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more round IDs do not exist in event % or have been deleted', p_event_id;
  END IF;

  -- 5. Safe collision-free two-phase reordering
  -- Lock all active round rows
  PERFORM 1
  FROM public.rounds
  WHERE event_id = p_event_id AND deleted_at IS NULL
  ORDER BY id
  FOR UPDATE;

  SELECT COALESCE(MAX(round_number), 0) + 1000000
  INTO v_safe_offset
  FROM public.rounds
  WHERE event_id = p_event_id;

  -- Phase 1: Move to safe temporary offset numbers to avoid unique constraint collisions
  FOR v_i IN 1..v_count LOOP
    v_round_id := p_round_ids[v_i];
    UPDATE public.rounds
    SET round_number = v_safe_offset + v_i,
        updated_at = clock_timestamp()
    WHERE id = v_round_id;
  END LOOP;

  -- Phase 2: Assign final sequential positions (1, 2, 3...)
  FOR v_i IN 1..v_count LOOP
    v_round_id := p_round_ids[v_i];
    UPDATE public.rounds
    SET round_number = v_i,
        updated_at = clock_timestamp()
    WHERE id = v_round_id;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'event_id', p_event_id,
    'reordered_count', v_count,
    'updated_at', clock_timestamp()
  );
END;
$$;

-- Overload for convenience if event_id is omitted by caller
CREATE OR REPLACE FUNCTION public.reorder_rounds(
  p_round_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  IF p_round_ids IS NULL OR array_length(p_round_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_round_ids cannot be empty';
  END IF;

  SELECT event_id INTO v_event_id
  FROM public.rounds
  WHERE id = p_round_ids[1] AND deleted_at IS NULL;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Event could not be determined from round %', p_round_ids[1];
  END IF;

  RETURN public.reorder_rounds(v_event_id, p_round_ids);
END;
$$;

-- ====================================================================
-- 8.1 RPC: ASSIGN ADMIN ROLE (Owner-Only Authorization)
-- ====================================================================

CREATE OR REPLACE FUNCTION public.assign_admin_role(
  p_target_user_id UUID,
  p_new_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_new_role NOT IN ('owner', 'organizer', 'scorer') THEN
    RAISE EXCEPTION 'Invalid role: %. Must be owner, organizer, or scorer', p_new_role;
  END IF;

  -- Only existing Owners may assign or change roles
  IF auth.uid() IS NULL OR NOT public.is_global_owner() THEN
    RAISE EXCEPTION 'Unauthorized: Only an existing Owner may assign roles'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.admin_profiles
  SET role = p_new_role, updated_at = clock_timestamp()
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user % not found in admin_profiles', p_target_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'user_id', p_target_user_id,
    'role', p_new_role,
    'assigned_by', auth.uid()
  );
END;
$$;

-- ====================================================================
-- 8.2 OWNER BOOTSTRAP — Controlled, race-safe singleton first-owner registration
-- Only the intended administrator can bootstrap the first Owner account.
-- Arbitrary authenticated callers cannot claim Owner status.
-- ====================================================================

DROP FUNCTION IF EXISTS public.bootstrap_first_owner(TEXT);
DROP FUNCTION IF EXISTS public.bootstrap_first_owner();

CREATE OR REPLACE FUNCTION public.bootstrap_first_owner(
  p_bootstrap_token TEXT DEFAULT NULL,
  p_target_user_id UUID DEFAULT NULL,
  p_display_name TEXT DEFAULT 'Owner'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
  v_auth_role TEXT;
  v_is_db_admin BOOLEAN;
  v_is_service_role BOOLEAN;
  v_configured_token TEXT;
BEGIN
  -- 1. Identify caller privilege level securely under SECURITY DEFINER:
  -- Note: Do NOT use current_user because SECURITY DEFINER switches current_user to the function owner (e.g. postgres).
  -- session_user preserves the connected database user ('postgres' in SQL Editor/psql, 'authenticator' via PostgREST).
  v_auth_role := COALESCE(auth.role(), auth.jwt() ->> 'role');

  -- Context A: SQL Editor / direct database administrator (connected directly as postgres/supabase_admin with no JWT)
  v_is_db_admin := (session_user IN ('postgres', 'supabase_admin') AND v_auth_role IS NULL);

  -- Context B: Supabase service_role JWT execution
  v_is_service_role := (v_auth_role = 'service_role');

  -- 2. Determine target user to promote to Owner
  v_uid := COALESCE(p_target_user_id, auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Target user ID must be provided when calling outside an authenticated user session'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Controlled Authorization Check:
  -- Distinguish between administrative execution and ordinary authenticated users.
  -- Ordinary authenticated users MUST present the valid pre-configured bootstrap token
  -- via database setting (app.settings.bootstrap_token).
  IF NOT (v_is_db_admin OR v_is_service_role) THEN
    v_configured_token := current_setting('app.settings.bootstrap_token', true);

    IF v_configured_token IS NULL OR btrim(v_configured_token) = '' THEN
      RAISE EXCEPTION 'Unauthorized: Initial Owner bootstrap requires administrative privileges or configured bootstrap token'
        USING ERRCODE = '42501';
    END IF;

    IF p_bootstrap_token IS NULL OR p_bootstrap_token != v_configured_token THEN
      RAISE EXCEPTION 'Unauthorized: Invalid bootstrap token provided'
        USING ERRCODE = '42501';
    END IF;

    -- Authenticated callers can only bootstrap their own user account
    IF auth.uid() IS NOT NULL AND v_uid != auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized: Authenticated callers may only bootstrap their own user account'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 4. Verify target user exists in auth.users
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid) THEN
    RAISE EXCEPTION 'Target user % does not exist in auth.users', v_uid
      USING ERRCODE = '02000';
  END IF;

  -- 5. Atomic singleton insert — only the first caller ever succeeds
  BEGIN
    INSERT INTO public.owner_bootstrap (owner_id) VALUES (v_uid);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Owner has already been bootstrapped. Use assign_admin_role() to manage roles.'
      USING ERRCODE = '23505';
  END;

  -- 6. Insert the owner profile (or promote existing profile to owner)
  -- The enforce_profile_role_protection trigger validates NEW.id against owner_bootstrap
  INSERT INTO public.admin_profiles (id, display_name, role)
  VALUES (v_uid, COALESCE(p_display_name, 'Owner'), 'owner')
  ON CONFLICT (id) DO UPDATE
    SET role = 'owner',
        display_name = COALESCE(EXCLUDED.display_name, admin_profiles.display_name),
        updated_at = clock_timestamp();

  RETURN jsonb_build_object(
    'success', TRUE,
    'owner_id', v_uid,
    'display_name', COALESCE(p_display_name, 'Owner'),
    'bootstrapped_at', clock_timestamp()
  );
END;
$$;

-- ====================================================================
-- 9. ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_records ENABLE ROW LEVEL SECURITY;

-- Revoke default broad grants
REVOKE ALL ON public.score_transactions FROM anon, authenticated;
REVOKE ALL ON public.idempotency_records FROM anon, authenticated;

-- Grants
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.v_public_overall_leaderboard TO anon, authenticated;
GRANT SELECT ON public.v_team_round_scores TO anon, authenticated;
GRANT SELECT ON public.admin_profiles TO authenticated;
GRANT SELECT ON public.events TO anon, authenticated;
GRANT SELECT ON public.event_settings TO anon, authenticated;
GRANT SELECT ON public.teams TO anon, authenticated;
GRANT SELECT ON public.rounds TO anon, authenticated;
GRANT SELECT ON public.event_admins TO authenticated;
GRANT SELECT ON public.score_transactions TO authenticated;

-- Table Grants for Admin mutations
GRANT INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.rounds TO authenticated;
GRANT INSERT, UPDATE ON public.events TO authenticated;
GRANT INSERT, UPDATE ON public.event_settings TO authenticated;
GRANT INSERT, UPDATE ON public.admin_profiles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.event_admins TO authenticated;

-- RPC Execution Grants
GRANT EXECUTE ON FUNCTION public.is_global_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_own_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_event_admin(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.bootstrap_first_owner(TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_owner(TEXT, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_score_batch(UUID, UUID, TEXT, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_score_transaction(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_round_status(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_rounds(UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_rounds(UUID[]) TO authenticated;

-- 9.1 ADMIN PROFILES POLICIES
-- Privilege Escalation Protection: Regular users may update only permitted profile
-- fields (display_name, avatar_url). Role self-promotion is strictly rejected.
DROP POLICY IF EXISTS "Authenticated users view profiles" ON public.admin_profiles;
CREATE POLICY "Authenticated users view profiles"
  ON public.admin_profiles FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Users manage own profile" ON public.admin_profiles;
DROP POLICY IF EXISTS "Users update own profile fields" ON public.admin_profiles;
CREATE POLICY "Users update own profile fields"
  ON public.admin_profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = public.get_own_role()
  );

DROP POLICY IF EXISTS "Users insert own profile" ON public.admin_profiles;
CREATE POLICY "Users insert own profile"
  ON public.admin_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    id = auth.uid()
    AND role IN ('organizer', 'scorer')
  );

DROP POLICY IF EXISTS "Owners manage all admin profiles" ON public.admin_profiles;
CREATE POLICY "Owners manage all admin profiles"
  ON public.admin_profiles FOR ALL
  TO authenticated
  USING (public.is_global_owner())
  WITH CHECK (public.is_global_owner());

-- 9.2 EVENTS POLICIES
DROP POLICY IF EXISTS "Public view active events" ON public.events;
CREATE POLICY "Public view active events"
  ON public.events FOR SELECT
  TO anon, authenticated
  USING (deleted_at IS NULL AND status = 'active');

DROP POLICY IF EXISTS "Admins view all own events" ON public.events;
CREATE POLICY "Admins view all own events"
  ON public.events FOR SELECT
  TO authenticated
  USING (public.check_is_event_admin(id, 'organizer'));

DROP POLICY IF EXISTS "Admins create events" ON public.events;
CREATE POLICY "Admins create events"
  ON public.events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins update own events" ON public.events;
CREATE POLICY "Admins update own events"
  ON public.events FOR UPDATE
  TO authenticated
  USING (public.check_is_event_admin(id, 'organizer'))
  WITH CHECK (public.check_is_event_admin(id, 'organizer'));

-- 9.3 EVENT ADMINS POLICIES
DROP POLICY IF EXISTS "Admins view event memberships" ON public.event_admins;
CREATE POLICY "Admins view event memberships"
  ON public.event_admins FOR SELECT
  TO authenticated
  USING (admin_id = auth.uid() OR public.check_is_event_admin(event_id, 'organizer'));

DROP POLICY IF EXISTS "Owners manage event admins" ON public.event_admins;
CREATE POLICY "Owners manage event admins"
  ON public.event_admins FOR ALL
  TO authenticated
  USING (public.check_is_event_admin(event_id, 'owner'))
  WITH CHECK (public.check_is_event_admin(event_id, 'owner'));

-- 9.4 EVENT SETTINGS POLICIES
DROP POLICY IF EXISTS "Public view visible event settings" ON public.event_settings;
CREATE POLICY "Public view visible event settings"
  ON public.event_settings FOR SELECT
  TO anon, authenticated
  USING (
    leaderboard_visible IS TRUE
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_settings.event_id
        AND e.deleted_at IS NULL
        AND e.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Admins view all event settings" ON public.event_settings;
CREATE POLICY "Admins view all event settings"
  ON public.event_settings FOR SELECT
  TO authenticated
  USING (public.check_is_event_admin(event_id, 'organizer'));

DROP POLICY IF EXISTS "Admins update event settings" ON public.event_settings;
CREATE POLICY "Admins update event settings"
  ON public.event_settings FOR UPDATE
  TO authenticated
  USING (public.check_is_event_admin(event_id, 'organizer'))
  WITH CHECK (public.check_is_event_admin(event_id, 'organizer'));

DROP POLICY IF EXISTS "Admins insert event settings" ON public.event_settings;
CREATE POLICY "Admins insert event settings"
  ON public.event_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.check_is_event_admin(event_id, 'organizer'));

-- 9.5 TEAMS POLICIES
DROP POLICY IF EXISTS "Public view active teams" ON public.teams;
CREATE POLICY "Public view active teams"
  ON public.teams FOR SELECT
  TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = teams.event_id
        AND e.deleted_at IS NULL
        AND e.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Admins view all event teams" ON public.teams;
CREATE POLICY "Admins view all event teams"
  ON public.teams FOR SELECT
  TO authenticated
  USING (public.check_is_event_admin(event_id, 'organizer'));

DROP POLICY IF EXISTS "Admins insert teams" ON public.teams;
CREATE POLICY "Admins insert teams"
  ON public.teams FOR INSERT
  TO authenticated
  WITH CHECK (public.check_is_event_admin(event_id, 'organizer'));

DROP POLICY IF EXISTS "Admins update teams" ON public.teams;
CREATE POLICY "Admins update teams"
  ON public.teams FOR UPDATE
  TO authenticated
  USING (public.check_is_event_admin(event_id, 'organizer'))
  WITH CHECK (public.check_is_event_admin(event_id, 'organizer'));

DROP POLICY IF EXISTS "Admins delete teams" ON public.teams;
CREATE POLICY "Admins delete teams"
  ON public.teams FOR DELETE
  TO authenticated
  USING (public.check_is_event_admin(event_id, 'organizer'));

-- 9.6 ROUNDS POLICIES
DROP POLICY IF EXISTS "Public view active rounds" ON public.rounds;
CREATE POLICY "Public view active rounds"
  ON public.rounds FOR SELECT
  TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = rounds.event_id
        AND e.deleted_at IS NULL
        AND e.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Admins view all event rounds" ON public.rounds;
CREATE POLICY "Admins view all event rounds"
  ON public.rounds FOR SELECT
  TO authenticated
  USING (public.check_is_event_admin(event_id, 'organizer'));

DROP POLICY IF EXISTS "Admins insert rounds" ON public.rounds;
CREATE POLICY "Admins insert rounds"
  ON public.rounds FOR INSERT
  TO authenticated
  WITH CHECK (public.check_is_event_admin(event_id, 'organizer'));

DROP POLICY IF EXISTS "Admins update rounds" ON public.rounds;
CREATE POLICY "Admins update rounds"
  ON public.rounds FOR UPDATE
  TO authenticated
  USING (public.check_is_event_admin(event_id, 'organizer'))
  WITH CHECK (public.check_is_event_admin(event_id, 'organizer'));

DROP POLICY IF EXISTS "Admins delete rounds" ON public.rounds;
CREATE POLICY "Admins delete rounds"
  ON public.rounds FOR DELETE
  TO authenticated
  USING (public.check_is_event_admin(event_id, 'organizer'));

-- 9.7 SCORE TRANSACTIONS POLICIES
-- Score transactions are an immutable ledger. Direct INSERT/UPDATE/DELETE is revoked.
-- Detailed raw audit ledger is restricted to authorized event administrators.
-- Anonymous and public viewers access sanitized aggregate standings via views only.
DROP POLICY IF EXISTS "Public view active score transactions" ON public.score_transactions;
DROP POLICY IF EXISTS "Admins view event score transactions" ON public.score_transactions;

CREATE POLICY "Admins view event score transactions"
  ON public.score_transactions FOR SELECT
  TO authenticated
  USING (public.check_is_event_admin(event_id, 'organizer'));

-- ====================================================================
-- 10. SUPABASE REALTIME CONFIGURATION
-- ====================================================================

-- Set REPLICA IDENTITY FULL to ensure payload diffs are delivered for realtime events
ALTER TABLE public.score_transactions REPLICA IDENTITY FULL;
ALTER TABLE public.teams REPLICA IDENTITY FULL;
ALTER TABLE public.rounds REPLICA IDENTITY FULL;
ALTER TABLE public.event_settings REPLICA IDENTITY FULL;

-- Safely add tables to supabase_realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'score_transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.score_transactions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'teams'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.teams;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'rounds'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rounds;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'event_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.event_settings;
  END IF;
END;
$$;

-- ====================================================================
-- 11. PERMISSIONS & GRANTS
-- ====================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Table read/write permissions (strictly governed by RLS policies)
GRANT SELECT ON public.events TO anon, authenticated;
GRANT ALL ON public.events TO authenticated;

GRANT SELECT ON public.event_settings TO anon, authenticated;
GRANT ALL ON public.event_settings TO authenticated;

GRANT SELECT ON public.teams TO anon, authenticated;
GRANT ALL ON public.teams TO authenticated;

GRANT SELECT ON public.rounds TO anon, authenticated;
GRANT ALL ON public.rounds TO authenticated;

-- Explicitly revoke raw score transaction access from anon
REVOKE ALL ON public.score_transactions FROM anon;
GRANT SELECT ON public.score_transactions TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.admin_profiles TO authenticated;
GRANT SELECT ON public.admin_profiles TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_admins TO authenticated;

-- Views (Sanitized public leaderboard with security barrier)
GRANT SELECT ON public.v_public_overall_leaderboard TO anon, authenticated;
GRANT SELECT ON public.v_team_round_scores TO anon, authenticated;

-- Security Definer RPC Execution
GRANT EXECUTE ON FUNCTION public.is_global_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_own_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_event_admin(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_admin_role(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.bootstrap_first_owner(TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_owner(TEXT, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_score_batch(UUID, UUID, TEXT, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_score_transaction(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_round_status(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_rounds(UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_rounds(UUID[]) TO authenticated;