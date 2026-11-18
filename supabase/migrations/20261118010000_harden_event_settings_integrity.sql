-- ====================================================================
-- CASINO ROYALE — FORWARD MIGRATION: HARDEN EVENT SETTINGS INTEGRITY
-- Migration: 20261118010000_harden_event_settings_integrity.sql
--
-- 1. Protect starting_score integrity in update_event_settings():
--    - Changing starting_score is permitted BEFORE any score transactions exist.
--    - Once at least one score transaction exists, changing starting_score is REJECTED (ERRCODE 22023).
--    - Supplying the identical existing starting_score value is permitted.
--    - Updating other event settings (leaderboard visibility, frozen state, sort direction)
--      continues working normally even when transactions exist.
-- 2. Restrict direct event_settings writes:
--    - Revoke direct INSERT, UPDATE, DELETE, TRUNCATE on public.event_settings from authenticated.
--    - Preserve SELECT for authenticated and anon spectators.
--    - Retain full administrative access for database owner and service_role.
-- 3. Automatic event_settings provisioning trigger:
--    - Automatically initializes default event_settings upon events insertion via SECURITY DEFINER.
-- ====================================================================

-- 1. REVOKE DIRECT TABLE MUTATION PRIVILEGES FROM CLIENT ROLES
REVOKE ALL ON TABLE public.event_settings FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.event_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.event_settings FROM authenticated;
GRANT SELECT ON TABLE public.event_settings TO anon, authenticated;

-- 2. DROP OBSOLETE WRITE RLS POLICIES ON event_settings
DROP POLICY IF EXISTS "Admins update event settings" ON public.event_settings;
DROP POLICY IF EXISTS "Admins insert event settings" ON public.event_settings;

-- 3. AUTOMATIC EVENT SETTINGS PROVISIONING TRIGGER (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.handle_new_event_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.event_settings (
    event_id,
    starting_score,
    leaderboard_visible,
    leaderboard_frozen,
    allow_negative_scores,
    sort_direction
  )
  VALUES (
    NEW.id,
    0.00,
    TRUE,
    FALSE,
    FALSE,
    'desc'
  )
  ON CONFLICT (event_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_new_event_settings ON public.events;
CREATE TRIGGER trg_new_event_settings
  AFTER INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_event_settings();

-- 4. HARDENED AUTHORITATIVE update_event_settings() FUNCTION
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
    -- In case settings were not yet initialized, provision defaults atomically
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

  -- 4. Protect starting_score integrity:
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

  -- 5. Apply updates atomically
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
