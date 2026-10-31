-- Privacy-safe vehicle passports.
--
-- Operational work orders remain authoritative. A passport snapshot is an
-- immutable, allowlisted presentation of completed service facts. Public
-- readers never query operational or customer tables directly.

CREATE TABLE public.vehicle_passport (
  passport_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  motorcycle_id uuid NOT NULL UNIQUE
    REFERENCES public.motorcycle(motorcycle_id) ON DELETE RESTRICT,
  passport_number text NOT NULL UNIQUE
    CHECK (passport_number ~ '^OTO-[A-Z0-9]{8}$'),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  created_by_user_id uuid
    REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vehicle_passport_motorcycle
  ON public.vehicle_passport (motorcycle_id);

CREATE TABLE public.vehicle_passport_snapshot (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_id uuid NOT NULL
    REFERENCES public.vehicle_passport(passport_id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 text NOT NULL
    CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  coverage_through timestamptz NOT NULL,
  created_by_user_id uuid
    REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by_snapshot_id uuid
    REFERENCES public.vehicle_passport_snapshot(snapshot_id) ON DELETE RESTRICT,
  CONSTRAINT vehicle_passport_snapshot_supersession_complete CHECK (
    (superseded_at IS NULL AND superseded_by_snapshot_id IS NULL)
    OR
    (superseded_at IS NOT NULL AND superseded_by_snapshot_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_vehicle_passport_snapshot_version
  ON public.vehicle_passport_snapshot (passport_id, version);
CREATE INDEX idx_vehicle_passport_snapshot_current
  ON public.vehicle_passport_snapshot (passport_id, issued_at DESC)
  WHERE superseded_at IS NULL;

CREATE TABLE public.vehicle_passport_snapshot_source (
  snapshot_source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL
    REFERENCES public.vehicle_passport_snapshot(snapshot_id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL
    REFERENCES public.work_order(work_order_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_vehicle_passport_snapshot_source_work_order
    UNIQUE (snapshot_id, work_order_id)
);

CREATE INDEX idx_vehicle_passport_snapshot_source_work_order
  ON public.vehicle_passport_snapshot_source (work_order_id, snapshot_id);

CREATE TABLE public.vehicle_passport_share (
  share_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL
    REFERENCES public.vehicle_passport_snapshot(snapshot_id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by_user_id uuid
    REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  created_by_user_id uuid
    REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_passport_share_expiry_after_creation
    CHECK (expires_at > created_at),
  CONSTRAINT vehicle_passport_share_revoker_present CHECK (
    revoked_at IS NULL OR revoked_by_user_id IS NOT NULL
  )
);

CREATE INDEX idx_vehicle_passport_share_active_token
  ON public.vehicle_passport_share (token_hash, expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_vehicle_passport_share_snapshot
  ON public.vehicle_passport_share (snapshot_id, created_at DESC);

-- The payload and its evidence links are evidence. A snapshot may only move
-- once from current to superseded; it can never be rewritten or deleted.
CREATE OR REPLACE FUNCTION public.vehicle_passport_protect_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PASSPORT_SNAPSHOT_IMMUTABLE';
  END IF;

  IF OLD.snapshot_id IS DISTINCT FROM NEW.snapshot_id
    OR OLD.passport_id IS DISTINCT FROM NEW.passport_id
    OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD.payload IS DISTINCT FROM NEW.payload
    OR OLD.payload_sha256 IS DISTINCT FROM NEW.payload_sha256
    OR OLD.coverage_through IS DISTINCT FROM NEW.coverage_through
    OR OLD.created_by_user_id IS DISTINCT FROM NEW.created_by_user_id
    OR OLD.issued_at IS DISTINCT FROM NEW.issued_at
    OR OLD.superseded_at IS NOT NULL
    OR NEW.superseded_at IS NULL
    OR NEW.superseded_by_snapshot_id IS NULL
  THEN
    RAISE EXCEPTION 'PASSPORT_SNAPSHOT_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.vehicle_passport_protect_snapshot() FROM PUBLIC;

CREATE TRIGGER trg_vehicle_passport_snapshot_immutable
  BEFORE UPDATE OR DELETE ON public.vehicle_passport_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_passport_protect_snapshot();

CREATE OR REPLACE FUNCTION public.vehicle_passport_reject_source_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'PASSPORT_SNAPSHOT_SOURCE_IMMUTABLE';
END;
$$;

REVOKE ALL ON FUNCTION public.vehicle_passport_reject_source_mutation() FROM PUBLIC;

CREATE TRIGGER trg_vehicle_passport_snapshot_source_immutable
  BEFORE UPDATE OR DELETE ON public.vehicle_passport_snapshot_source
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_passport_reject_source_mutation();

-- Publish the passport, source links, previous-version supersession, and audit
-- record in one transaction. Caller-provided actor ids are deliberately
-- avoided: the authenticated app user is resolved inside the command.
CREATE OR REPLACE FUNCTION public.publish_vehicle_passport_snapshot(
  p_motorcycle_id uuid,
  p_passport_number text,
  p_expected_version integer,
  p_payload jsonb,
  p_payload_sha256 text,
  p_coverage_through timestamptz,
  p_work_order_ids uuid[]
)
RETURNS TABLE (
  published_snapshot_id uuid,
  published_passport_id uuid,
  published_passport_number text,
  published_version integer,
  published_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id uuid;
  v_passport_id uuid;
  v_passport_number text;
  v_passport_status text;
  v_previous_snapshot_id uuid;
  v_previous_version integer;
  v_next_version integer;
  v_snapshot_id uuid;
  v_issued_at timestamptz;
  v_requested_source_count integer;
  v_valid_source_count integer;
BEGIN
  v_actor_user_id := public.current_app_user_id();
  IF v_actor_user_id IS NULL
     OR NOT public.is_active_app_user()
     OR public.current_app_user_role()
       NOT IN ('owner', 'manager', 'service_advisor') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  v_issued_at := (p_payload ->> 'issued_at')::timestamptz;
  IF v_issued_at < now() - interval '10 minutes'
     OR v_issued_at > now() + interval '1 minute'
     OR (p_payload ->> 'coverage_through')::timestamptz
       IS DISTINCT FROM p_coverage_through THEN
    RAISE EXCEPTION 'PASSPORT_TIMESTAMP_INVALID';
  END IF;

  IF p_work_order_ids IS NULL OR cardinality(p_work_order_ids) = 0 THEN
    RAISE EXCEPTION 'PASSPORT_SOURCE_REQUIRED';
  END IF;

  PERFORM 1
  FROM public.motorcycle
  WHERE motorcycle_id = p_motorcycle_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MOTORCYCLE_NOT_FOUND';
  END IF;

  SELECT
    passport_id,
    passport_number,
    status
  INTO
    v_passport_id,
    v_passport_number,
    v_passport_status
  FROM public.vehicle_passport
  WHERE motorcycle_id = p_motorcycle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.vehicle_passport (
      motorcycle_id,
      passport_number,
      created_by_user_id
    )
    VALUES (
      p_motorcycle_id,
      p_passport_number,
      v_actor_user_id
    )
    RETURNING passport_id, passport_number, status
    INTO v_passport_id, v_passport_number, v_passport_status;
  END IF;

  IF v_passport_status <> 'active' THEN
    RAISE EXCEPTION 'PASSPORT_SUSPENDED';
  END IF;

  SELECT snapshot_id, version
  INTO v_previous_snapshot_id, v_previous_version
  FROM public.vehicle_passport_snapshot
  WHERE passport_id = v_passport_id
  ORDER BY version DESC
  LIMIT 1
  FOR UPDATE;

  v_next_version := COALESCE(v_previous_version, 0) + 1;
  IF p_expected_version <> v_next_version
     OR (p_payload ->> 'report_version')::integer <> v_next_version THEN
    RAISE EXCEPTION 'PASSPORT_VERSION_CONFLICT';
  END IF;
  IF p_payload ->> 'passport_number' <> v_passport_number THEN
    RAISE EXCEPTION 'PASSPORT_NUMBER_CONFLICT';
  END IF;

  SELECT COUNT(*)
  INTO v_requested_source_count
  FROM (
    SELECT DISTINCT work_order_id
    FROM unnest(p_work_order_ids) AS requested(work_order_id)
  ) AS distinct_requested;

  SELECT COUNT(*)
  INTO v_valid_source_count
  FROM public.work_order
  WHERE work_order_id = ANY(p_work_order_ids)
    AND motorcycle_id = p_motorcycle_id
    AND status = 'completed'
    AND completed_at IS NOT NULL
    AND completed_at <= p_coverage_through;

  IF v_requested_source_count <> v_valid_source_count THEN
    RAISE EXCEPTION 'PASSPORT_SOURCE_INVALID';
  END IF;

  INSERT INTO public.vehicle_passport_snapshot (
    passport_id,
    version,
    payload,
    payload_sha256,
    coverage_through,
    created_by_user_id,
    issued_at
  )
  VALUES (
    v_passport_id,
    v_next_version,
    p_payload,
    p_payload_sha256,
    p_coverage_through,
    v_actor_user_id,
    v_issued_at
  )
  RETURNING snapshot_id INTO v_snapshot_id;

  INSERT INTO public.vehicle_passport_snapshot_source (
    snapshot_id,
    work_order_id
  )
  SELECT v_snapshot_id, work_order_id
  FROM (
    SELECT DISTINCT work_order_id
    FROM unnest(p_work_order_ids) AS requested(work_order_id)
  ) AS distinct_sources;

  IF v_previous_snapshot_id IS NOT NULL THEN
    UPDATE public.vehicle_passport_snapshot
    SET
      superseded_at = v_issued_at,
      superseded_by_snapshot_id = v_snapshot_id
    WHERE snapshot_id = v_previous_snapshot_id;

    UPDATE public.vehicle_passport_share
    SET
      revoked_at = v_issued_at,
      revoked_by_user_id = v_actor_user_id
    WHERE snapshot_id = v_previous_snapshot_id
      AND revoked_at IS NULL;
  END IF;

  UPDATE public.vehicle_passport
  SET updated_at = v_issued_at
  WHERE passport_id = v_passport_id;

  INSERT INTO public.audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    description,
    old_value,
    new_value
  )
  VALUES (
    v_actor_user_id,
    'vehicle_passport_published',
    'vehicle_passport',
    v_passport_id,
    format('Vehicle passport %s version %s published', v_passport_number, v_next_version),
    CASE
      WHEN v_previous_snapshot_id IS NULL THEN NULL
      ELSE jsonb_build_object('snapshot_id', v_previous_snapshot_id)
    END,
    jsonb_build_object(
      'snapshot_id', v_snapshot_id,
      'version', v_next_version,
      'coverage_through', p_coverage_through,
      'payload_sha256', p_payload_sha256
    )
  );

  RETURN QUERY
  SELECT
    v_snapshot_id,
    v_passport_id,
    v_passport_number,
    v_next_version,
    v_issued_at;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_vehicle_passport_snapshot(
  uuid, text, integer, jsonb, text, timestamptz, uuid[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_vehicle_passport_snapshot(
  uuid, text, integer, jsonb, text, timestamptz, uuid[]
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_vehicle_passport_share(
  p_snapshot_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS TABLE (
  created_share_id uuid,
  created_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id uuid;
  v_passport_id uuid;
  v_share_id uuid;
  v_now timestamptz := now();
BEGIN
  v_actor_user_id := public.current_app_user_id();
  IF v_actor_user_id IS NULL
     OR NOT public.is_active_app_user()
     OR public.current_app_user_role()
       NOT IN ('owner', 'manager', 'service_advisor') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_expires_at <= v_now
     OR p_expires_at > v_now + interval '8 days' THEN
    RAISE EXCEPTION 'PASSPORT_SHARE_INVALID';
  END IF;

  SELECT passport.passport_id
  INTO v_passport_id
  FROM public.vehicle_passport_snapshot AS snapshot
  JOIN public.vehicle_passport AS passport
    ON passport.passport_id = snapshot.passport_id
  WHERE snapshot.snapshot_id = p_snapshot_id
    AND snapshot.superseded_at IS NULL
    AND passport.status = 'active'
  FOR UPDATE OF snapshot, passport;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PASSPORT_SNAPSHOT_NOT_CURRENT';
  END IF;

  UPDATE public.vehicle_passport_share
  SET
    revoked_at = v_now,
    revoked_by_user_id = v_actor_user_id
  WHERE snapshot_id = p_snapshot_id
    AND revoked_at IS NULL;

  INSERT INTO public.vehicle_passport_share (
    snapshot_id,
    token_hash,
    expires_at,
    created_by_user_id
  )
  VALUES (
    p_snapshot_id,
    p_token_hash,
    p_expires_at,
    v_actor_user_id
  )
  RETURNING share_id INTO v_share_id;

  INSERT INTO public.audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    description,
    new_value
  )
  VALUES (
    v_actor_user_id,
    'vehicle_passport_share_created',
    'vehicle_passport_share',
    v_share_id,
    'A seven-day vehicle passport share was created',
    jsonb_build_object(
      'passport_id', v_passport_id,
      'snapshot_id', p_snapshot_id,
      'expires_at', p_expires_at
    )
  );

  RETURN QUERY SELECT v_share_id, p_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_vehicle_passport_share(
  uuid, text, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_vehicle_passport_share(
  uuid, text, timestamptz
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revoke_vehicle_passport_share(
  p_share_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id uuid;
  v_passport_id uuid;
  v_snapshot_id uuid;
  v_revoked_at timestamptz;
BEGIN
  v_actor_user_id := public.current_app_user_id();
  IF v_actor_user_id IS NULL
     OR NOT public.is_active_app_user()
     OR public.current_app_user_role()
       NOT IN ('owner', 'manager', 'service_advisor') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT
    passport.passport_id,
    share.snapshot_id,
    share.revoked_at
  INTO
    v_passport_id,
    v_snapshot_id,
    v_revoked_at
  FROM public.vehicle_passport_share AS share
  JOIN public.vehicle_passport_snapshot AS snapshot
    ON snapshot.snapshot_id = share.snapshot_id
  JOIN public.vehicle_passport AS passport
    ON passport.passport_id = snapshot.passport_id
  WHERE share.share_id = p_share_id
  FOR UPDATE OF share;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PASSPORT_SHARE_NOT_FOUND';
  END IF;

  IF v_revoked_at IS NULL THEN
    UPDATE public.vehicle_passport_share
    SET
      revoked_at = now(),
      revoked_by_user_id = v_actor_user_id
    WHERE share_id = p_share_id;

    INSERT INTO public.audit_log (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      description,
      new_value
    )
    VALUES (
      v_actor_user_id,
      'vehicle_passport_share_revoked',
      'vehicle_passport_share',
      p_share_id,
      'Vehicle passport share revoked',
      jsonb_build_object(
        'passport_id', v_passport_id,
        'snapshot_id', v_snapshot_id
      )
    );
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_vehicle_passport_share(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_vehicle_passport_share(uuid)
  TO authenticated, service_role;

ALTER TABLE public.vehicle_passport ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_passport_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_passport_snapshot_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_passport_share ENABLE ROW LEVEL SECURITY;

CREATE POLICY vehicle_passport_select ON public.vehicle_passport
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role())
      IN ('owner', 'manager', 'service_advisor')
  );
CREATE POLICY vehicle_passport_insert ON public.vehicle_passport
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role())
      IN ('owner', 'manager', 'service_advisor')
  );
CREATE POLICY vehicle_passport_update ON public.vehicle_passport
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role())
      IN ('owner', 'manager', 'service_advisor')
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role())
      IN ('owner', 'manager', 'service_advisor')
  );

CREATE POLICY vehicle_passport_snapshot_select
  ON public.vehicle_passport_snapshot
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role())
      IN ('owner', 'manager', 'service_advisor')
  );
CREATE POLICY vehicle_passport_snapshot_insert
  ON public.vehicle_passport_snapshot
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role())
      IN ('owner', 'manager', 'service_advisor')
  );
CREATE POLICY vehicle_passport_snapshot_update
  ON public.vehicle_passport_snapshot
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role())
      IN ('owner', 'manager', 'service_advisor')
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role())
      IN ('owner', 'manager', 'service_advisor')
  );

CREATE POLICY vehicle_passport_snapshot_source_select
  ON public.vehicle_passport_snapshot_source
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role())
      IN ('owner', 'manager', 'service_advisor')
  );
CREATE POLICY vehicle_passport_snapshot_source_insert
  ON public.vehicle_passport_snapshot_source
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role())
      IN ('owner', 'manager', 'service_advisor')
  );

CREATE POLICY vehicle_passport_share_select ON public.vehicle_passport_share
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role())
      IN ('owner', 'manager', 'service_advisor')
  );
CREATE POLICY vehicle_passport_share_insert ON public.vehicle_passport_share
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role())
      IN ('owner', 'manager', 'service_advisor')
  );
CREATE POLICY vehicle_passport_share_update ON public.vehicle_passport_share
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role())
      IN ('owner', 'manager', 'service_advisor')
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role())
      IN ('owner', 'manager', 'service_advisor')
  );

REVOKE ALL ON TABLE public.vehicle_passport FROM PUBLIC;
REVOKE ALL ON TABLE public.vehicle_passport FROM anon;
REVOKE ALL ON TABLE public.vehicle_passport FROM authenticated;
GRANT SELECT ON TABLE public.vehicle_passport TO authenticated;
GRANT ALL ON TABLE public.vehicle_passport TO service_role;

REVOKE ALL ON TABLE public.vehicle_passport_snapshot FROM PUBLIC;
REVOKE ALL ON TABLE public.vehicle_passport_snapshot FROM anon;
REVOKE ALL ON TABLE public.vehicle_passport_snapshot FROM authenticated;
GRANT SELECT ON TABLE public.vehicle_passport_snapshot TO authenticated;
GRANT ALL ON TABLE public.vehicle_passport_snapshot TO service_role;

REVOKE ALL ON TABLE public.vehicle_passport_snapshot_source FROM PUBLIC;
REVOKE ALL ON TABLE public.vehicle_passport_snapshot_source FROM anon;
REVOKE ALL ON TABLE public.vehicle_passport_snapshot_source FROM authenticated;
GRANT SELECT ON TABLE public.vehicle_passport_snapshot_source TO authenticated;
GRANT ALL ON TABLE public.vehicle_passport_snapshot_source TO service_role;

REVOKE ALL ON TABLE public.vehicle_passport_share FROM PUBLIC;
REVOKE ALL ON TABLE public.vehicle_passport_share FROM anon;
REVOKE ALL ON TABLE public.vehicle_passport_share FROM authenticated;
GRANT SELECT ON TABLE public.vehicle_passport_share TO authenticated;
GRANT ALL ON TABLE public.vehicle_passport_share TO service_role;
