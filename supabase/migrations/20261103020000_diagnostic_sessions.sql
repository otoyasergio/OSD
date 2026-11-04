-- Scan-tool sessions recorded in the shop.
-- Location-scoped like work orders. The catalog starts empty: an unknown
-- code stays unrecognised until someone at that location describes it.
-- Readings are insert-only. A mistaken scan is removed, not rewritten.

CREATE TABLE public.diagnostic_catalog (
  catalog_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.location(location_id) ON DELETE RESTRICT,
  dtc_code text NOT NULL CHECK (dtc_code ~ '^[A-Z0-9][A-Z0-9-]{1,15}$'),
  description text NOT NULL CHECK (
    char_length(btrim(description)) BETWEEN 1 AND 400
  ),
  severity_hint text NOT NULL CHECK (severity_hint IN ('P0', 'P1', 'P2', 'P3')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_diagnostic_catalog_code UNIQUE (location_id, dtc_code)
);

CREATE INDEX idx_diagnostic_catalog_location
  ON public.diagnostic_catalog (location_id, dtc_code);

CREATE TABLE public.diagnostic_session (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  motorcycle_id uuid NOT NULL
    REFERENCES public.motorcycle(motorcycle_id) ON DELETE RESTRICT,
  work_order_id uuid
    REFERENCES public.work_order(work_order_id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.location(location_id) ON DELETE RESTRICT,
  recorded_by_user_id uuid
    REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('scan_tool', 'manual')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  scan_results text NOT NULL CHECK (
    scan_results IN ('complete', 'partial', 'unavailable')
  )
);

CREATE INDEX idx_diagnostic_session_motorcycle
  ON public.diagnostic_session (motorcycle_id, recorded_at DESC);
CREATE INDEX idx_diagnostic_session_work_order
  ON public.diagnostic_session (work_order_id, recorded_at DESC)
  WHERE work_order_id IS NOT NULL;
CREATE INDEX idx_diagnostic_session_location
  ON public.diagnostic_session (location_id, recorded_at DESC);

CREATE TABLE public.diagnostic_reading (
  reading_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL
    REFERENCES public.diagnostic_session(session_id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,15}$'),
  status text NOT NULL CHECK (status IN ('active', 'pending', 'stored')),
  ecu text CHECK (ecu IS NULL OR char_length(btrim(ecu)) BETWEEN 1 AND 40),
  freeze_frame jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT diagnostic_reading_freeze_frame_shape CHECK (
    jsonb_typeof(freeze_frame) = 'object'
    AND freeze_frame - ARRAY['odometer', 'rpm', 'coolant_c', 'voltage'] = '{}'::jsonb
    AND (
      NOT freeze_frame ? 'odometer'
      OR jsonb_typeof(freeze_frame->'odometer') = 'number'
    )
    AND (
      NOT freeze_frame ? 'rpm'
      OR jsonb_typeof(freeze_frame->'rpm') = 'number'
    )
    AND (
      NOT freeze_frame ? 'coolant_c'
      OR jsonb_typeof(freeze_frame->'coolant_c') = 'number'
    )
    AND (
      NOT freeze_frame ? 'voltage'
      OR jsonb_typeof(freeze_frame->'voltage') = 'number'
    )
  )
);

CREATE INDEX idx_diagnostic_reading_session
  ON public.diagnostic_reading (session_id, code);

COMMENT ON TABLE public.diagnostic_session IS
  'A scan the shop recorded. This is not a live vehicle connection.';
COMMENT ON COLUMN public.diagnostic_reading.freeze_frame IS
  'Only keys the technician entered. Absent keys are omitted, never stored as 0.';

CREATE OR REPLACE FUNCTION public.diagnostic_session_matches_work_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_location_id uuid;
  v_motorcycle_id uuid;
BEGIN
  IF NEW.work_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT location_id, motorcycle_id
  INTO v_location_id, v_motorcycle_id
  FROM public.work_order
  WHERE work_order_id = NEW.work_order_id;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND';
  END IF;
  IF v_location_id IS DISTINCT FROM NEW.location_id THEN
    RAISE EXCEPTION 'LOCATION_MISMATCH';
  END IF;
  IF v_motorcycle_id IS DISTINCT FROM NEW.motorcycle_id THEN
    RAISE EXCEPTION 'MOTORCYCLE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.diagnostic_session_matches_work_order()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_diagnostic_session_matches_work_order
  BEFORE INSERT OR UPDATE OF work_order_id, location_id, motorcycle_id
  ON public.diagnostic_session
  FOR EACH ROW
  EXECUTE FUNCTION public.diagnostic_session_matches_work_order();

CREATE OR REPLACE FUNCTION public.record_diagnostic_session(
  p_motorcycle_id uuid,
  p_work_order_id uuid,
  p_location_id uuid,
  p_source text,
  p_scan_results text,
  p_notes text,
  p_readings jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_session_id uuid;
  v_reading jsonb;
  v_code text;
  v_status text;
  v_ecu text;
  v_frame jsonb;
  v_description text;
  v_severity text;
  v_key text;
  v_value jsonb;
BEGIN
  v_actor := public.current_app_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF public.current_app_user_role() NOT IN (
    'owner', 'manager', 'service_advisor', 'technician', 'head_tech'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_motorcycle_id IS NULL OR p_location_id IS NULL THEN
    RAISE EXCEPTION 'DIAGNOSTIC_SESSION_INVALID';
  END IF;
  IF p_source NOT IN ('scan_tool', 'manual')
    OR p_scan_results NOT IN ('complete', 'partial', 'unavailable') THEN
    RAISE EXCEPTION 'DIAGNOSTIC_SESSION_INVALID';
  END IF;
  IF p_notes IS NOT NULL AND char_length(p_notes) > 2000 THEN
    RAISE EXCEPTION 'DIAGNOSTIC_SESSION_INVALID';
  END IF;
  IF p_readings IS NULL OR jsonb_typeof(p_readings) <> 'array'
    OR jsonb_array_length(p_readings) > 40 THEN
    RAISE EXCEPTION 'DIAGNOSTIC_SESSION_INVALID';
  END IF;

  INSERT INTO public.diagnostic_session (
    motorcycle_id,
    work_order_id,
    location_id,
    recorded_by_user_id,
    source,
    notes,
    scan_results
  ) VALUES (
    p_motorcycle_id,
    p_work_order_id,
    p_location_id,
    v_actor,
    p_source,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    p_scan_results
  )
  RETURNING session_id INTO v_session_id;

  FOR v_reading IN SELECT value FROM jsonb_array_elements(p_readings)
  LOOP
    IF jsonb_typeof(v_reading) <> 'object' THEN
      RAISE EXCEPTION 'DIAGNOSTIC_SESSION_INVALID';
    END IF;

    v_code := upper(btrim(COALESCE(v_reading->>'code', '')));
    v_status := v_reading->>'status';
    v_ecu := NULLIF(btrim(COALESCE(v_reading->>'ecu', '')), '');
    v_description := NULLIF(btrim(COALESCE(v_reading->>'description', '')), '');
    v_severity := NULLIF(btrim(COALESCE(v_reading->>'severity_hint', '')), '');
    v_frame := '{}'::jsonb;

    IF v_code !~ '^[A-Z0-9][A-Z0-9-]{1,15}$' THEN
      RAISE EXCEPTION 'DIAGNOSTIC_CODE_INVALID';
    END IF;
    IF v_status NOT IN ('active', 'pending', 'stored') THEN
      RAISE EXCEPTION 'DIAGNOSTIC_SESSION_INVALID';
    END IF;
    IF v_ecu IS NOT NULL AND char_length(v_ecu) > 40 THEN
      RAISE EXCEPTION 'DIAGNOSTIC_SESSION_INVALID';
    END IF;

    IF v_reading ? 'freeze_frame' AND v_reading->'freeze_frame' IS NOT NULL
      AND v_reading->'freeze_frame' <> 'null'::jsonb THEN
      IF jsonb_typeof(v_reading->'freeze_frame') <> 'object' THEN
        RAISE EXCEPTION 'DIAGNOSTIC_FREEZE_FRAME_INVALID';
      END IF;
      FOR v_key, v_value IN
        SELECT key, value FROM jsonb_each(v_reading->'freeze_frame')
      LOOP
        IF v_key NOT IN ('odometer', 'rpm', 'coolant_c', 'voltage')
          OR jsonb_typeof(v_value) <> 'number' THEN
          RAISE EXCEPTION 'DIAGNOSTIC_FREEZE_FRAME_INVALID';
        END IF;
        v_frame := v_frame || jsonb_build_object(v_key, v_value);
      END LOOP;
    END IF;

    INSERT INTO public.diagnostic_reading (
      session_id, code, status, ecu, freeze_frame
    ) VALUES (
      v_session_id, v_code, v_status, v_ecu, v_frame
    );

    IF v_description IS NOT NULL OR v_severity IS NOT NULL THEN
      IF v_description IS NULL
        OR v_severity IS NULL
        OR v_severity NOT IN ('P0', 'P1', 'P2', 'P3')
        OR char_length(v_description) > 400 THEN
        RAISE EXCEPTION 'DIAGNOSTIC_CATALOG_INVALID';
      END IF;
      INSERT INTO public.diagnostic_catalog (
        location_id, dtc_code, description, severity_hint
      ) VALUES (
        p_location_id, v_code, v_description, v_severity
      )
      ON CONFLICT (location_id, dtc_code) DO UPDATE
      SET description = EXCLUDED.description,
          severity_hint = EXCLUDED.severity_hint,
          updated_at = now();
    END IF;
  END LOOP;

  RETURN v_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_diagnostic_session(
  uuid, uuid, uuid, text, text, text, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_diagnostic_session(
  uuid, uuid, uuid, text, text, text, jsonb
) TO authenticated, service_role;

ALTER TABLE public.diagnostic_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_reading ENABLE ROW LEVEL SECURITY;

CREATE POLICY diagnostic_catalog_select ON public.diagnostic_catalog
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner', 'manager', 'service_advisor', 'technician', 'head_tech', 'admin'
    )
    AND location_id IN (SELECT public.user_location_ids())
  );

CREATE POLICY diagnostic_catalog_insert ON public.diagnostic_catalog
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner', 'manager', 'service_advisor', 'technician', 'head_tech'
    )
    AND location_id IN (SELECT public.user_location_ids())
  );

CREATE POLICY diagnostic_catalog_update ON public.diagnostic_catalog
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner', 'manager', 'service_advisor', 'technician', 'head_tech'
    )
    AND location_id IN (SELECT public.user_location_ids())
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner', 'manager', 'service_advisor', 'technician', 'head_tech'
    )
    AND location_id IN (SELECT public.user_location_ids())
  );

CREATE POLICY diagnostic_catalog_delete ON public.diagnostic_catalog
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner', 'manager', 'service_advisor', 'technician', 'head_tech'
    )
    AND location_id IN (SELECT public.user_location_ids())
  );

CREATE POLICY diagnostic_session_select ON public.diagnostic_session
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner', 'manager', 'service_advisor', 'technician', 'head_tech', 'admin'
    )
    AND location_id IN (SELECT public.user_location_ids())
  );

CREATE POLICY diagnostic_session_insert ON public.diagnostic_session
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner', 'manager', 'service_advisor', 'technician', 'head_tech'
    )
    AND location_id IN (SELECT public.user_location_ids())
  );

CREATE POLICY diagnostic_session_delete ON public.diagnostic_session
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner', 'manager', 'service_advisor', 'technician', 'head_tech'
    )
    AND location_id IN (SELECT public.user_location_ids())
  );

CREATE POLICY diagnostic_reading_select ON public.diagnostic_reading
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner', 'manager', 'service_advisor', 'technician', 'head_tech', 'admin'
    )
    AND EXISTS (
      SELECT 1
      FROM public.diagnostic_session AS session
      WHERE session.session_id = diagnostic_reading.session_id
        AND session.location_id IN (SELECT public.user_location_ids())
    )
  );

CREATE POLICY diagnostic_reading_insert ON public.diagnostic_reading
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner', 'manager', 'service_advisor', 'technician', 'head_tech'
    )
    AND EXISTS (
      SELECT 1
      FROM public.diagnostic_session AS session
      WHERE session.session_id = diagnostic_reading.session_id
        AND session.location_id IN (SELECT public.user_location_ids())
    )
  );

CREATE POLICY diagnostic_reading_delete ON public.diagnostic_reading
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner', 'manager', 'service_advisor', 'technician', 'head_tech'
    )
    AND EXISTS (
      SELECT 1
      FROM public.diagnostic_session AS session
      WHERE session.session_id = diagnostic_reading.session_id
        AND session.location_id IN (SELECT public.user_location_ids())
    )
  );

REVOKE ALL ON TABLE public.diagnostic_catalog FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.diagnostic_session FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.diagnostic_reading FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.diagnostic_catalog TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.diagnostic_session TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.diagnostic_reading TO authenticated;
GRANT ALL ON TABLE public.diagnostic_catalog TO service_role;
GRANT ALL ON TABLE public.diagnostic_session TO service_role;
GRANT ALL ON TABLE public.diagnostic_reading TO service_role;
