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
  revocation_reason text
    CHECK (
      revocation_reason IS NULL
      OR revocation_reason IN (
        'manual',
        'replaced',
        'superseded',
        'ownership_transfer'
      )
    ),
  created_by_user_id uuid
    REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_passport_share_seven_day_expiry
    CHECK (expires_at = created_at + interval '7 days'),
  CONSTRAINT vehicle_passport_share_revocation_complete CHECK (
    (
      revoked_at IS NULL
      AND revoked_by_user_id IS NULL
      AND revocation_reason IS NULL
    )
    OR
    (
      revoked_at IS NOT NULL
      AND revocation_reason IS NOT NULL
    )
  )
);

CREATE INDEX idx_vehicle_passport_share_active_token
  ON public.vehicle_passport_share (token_hash, expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_vehicle_passport_share_snapshot
  ON public.vehicle_passport_share (snapshot_id, created_at DESC);

-- Ownership is a mutable pointer on motorcycle. Revoke all current share
-- grants in the same transaction whenever that pointer changes, regardless
-- of which application path performed the transfer.
CREATE OR REPLACE FUNCTION public.vehicle_passport_revoke_on_owner_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id uuid;
BEGIN
  IF OLD.customer_id IS NOT DISTINCT FROM NEW.customer_id THEN
    RETURN NEW;
  END IF;

  v_actor_user_id := public.current_app_user_id();
  UPDATE public.vehicle_passport_share AS share
  SET
    revoked_at = now(),
    revoked_by_user_id = v_actor_user_id,
    revocation_reason = 'ownership_transfer'
  FROM public.vehicle_passport_snapshot AS snapshot
  JOIN public.vehicle_passport AS passport
    ON passport.passport_id = snapshot.passport_id
  WHERE share.snapshot_id = snapshot.snapshot_id
    AND passport.motorcycle_id = NEW.motorcycle_id
    AND share.revoked_at IS NULL;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.vehicle_passport_revoke_on_owner_change()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_vehicle_passport_revoke_on_owner_change
  AFTER UPDATE OF customer_id ON public.motorcycle
  FOR EACH ROW
  WHEN (OLD.customer_id IS DISTINCT FROM NEW.customer_id)
  EXECUTE FUNCTION public.vehicle_passport_revoke_on_owner_change();

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

-- Build one canonical, private source document. The public snapshot builder
-- maps this allowlist into an even narrower customer-facing schema.
CREATE OR REPLACE FUNCTION public.vehicle_passport_build_source(
  p_motorcycle_id uuid,
  p_location_ids uuid[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'motorcycle',
    (
      SELECT jsonb_build_object(
        'year', motorcycle.year,
        'make', motorcycle.make,
        'model', motorcycle.model,
        'vin', motorcycle.vin,
        'colour', motorcycle.colour
      )
      FROM public.motorcycle
      WHERE motorcycle.motorcycle_id = p_motorcycle_id
    ),
    'work_orders',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'work_order_id', work_order.work_order_id,
            'work_order_number', work_order.work_order_number,
            'status', work_order.status,
            'completed_at', work_order.completed_at,
            'mileage', work_order.mileage,
            'mileage_unit', work_order.mileage_unit,
            'location_name', location.name,
            'jobs',
            COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'job_id', job.job_id,
                    'public_service_name', service.name,
                    'status', job.status,
                    'part_requirements',
                    COALESCE(
                      (
                        SELECT jsonb_agg(
                          jsonb_build_object(
                            'description', requirement.description,
                            'part_number', requirement.part_number,
                            'quantity_installed', requirement.quantity_installed,
                            'state', requirement.state
                          )
                          ORDER BY requirement.requirement_id
                        )
                        FROM public.job_part_requirement AS requirement
                        WHERE requirement.job_id = job.job_id
                      ),
                      '[]'::jsonb
                    )
                  )
                  ORDER BY job.job_id
                )
                FROM public.job
                JOIN public.service
                  ON service.service_id = job.service_id
                WHERE job.work_order_id = work_order.work_order_id
              ),
              '[]'::jsonb
            )
          )
          ORDER BY work_order.completed_at, work_order.work_order_id
        )
        FROM public.work_order
        JOIN public.location
          ON location.location_id = work_order.location_id
        WHERE work_order.motorcycle_id = p_motorcycle_id
          AND work_order.status = 'completed'
          AND work_order.location_id = ANY(p_location_ids)
      ),
      '[]'::jsonb
    ),
    'customers',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'first_name', customer.first_name,
            'last_name', customer.last_name,
            'phone', customer.phone,
            'email', customer.email,
            'address', customer.address
          )
          ORDER BY customer.customer_id
        )
        FROM public.customer
        WHERE customer.customer_id IN (
          SELECT motorcycle.customer_id
          FROM public.motorcycle
          WHERE motorcycle.motorcycle_id = p_motorcycle_id
          UNION
          SELECT DISTINCT work_order.customer_id
          FROM public.work_order
          WHERE work_order.motorcycle_id = p_motorcycle_id
            AND work_order.status = 'completed'
            AND work_order.location_id = ANY(p_location_ids)
        )
      ),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.vehicle_passport_build_source(uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.read_vehicle_passport_source(
  p_motorcycle_id uuid
)
RETURNS TABLE (
  source jsonb,
  source_sha256 text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source jsonb;
  v_location_ids uuid[];
BEGIN
  IF NOT public.is_active_app_user()
     OR public.current_app_user_role()
       NOT IN ('owner', 'manager', 'service_advisor') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  v_location_ids := ARRAY(SELECT public.user_location_ids());
  IF cardinality(v_location_ids) = 0 THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  v_source := public.vehicle_passport_build_source(
    p_motorcycle_id,
    v_location_ids
  );
  IF v_source -> 'motorcycle' = 'null'::jsonb THEN
    RAISE EXCEPTION 'MOTORCYCLE_NOT_FOUND';
  END IF;

  RETURN QUERY
  SELECT
    v_source,
    encode(digest(v_source::text, 'sha256'), 'hex');
END;
$$;

REVOKE ALL ON FUNCTION public.read_vehicle_passport_source(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_vehicle_passport_source(uuid)
  TO authenticated;

-- Publish the passport, source links, previous-version supersession, and audit
-- record in one transaction. Only the trusted service role may call this
-- command; the supplied actor is validated against the active staff registry.
CREATE OR REPLACE FUNCTION public.publish_vehicle_passport_snapshot(
  p_actor_user_id uuid,
  p_motorcycle_id uuid,
  p_passport_number text,
  p_expected_version integer,
  p_payload jsonb,
  p_payload_sha256 text,
  p_source_sha256 text,
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
  v_source jsonb;
  v_source_sha256 text;
  v_location_ids uuid[];
BEGIN
  SELECT user_id
  INTO v_actor_user_id
  FROM public.app_user
  WHERE user_id = p_actor_user_id
    AND status = 'active'
    AND role IN ('owner', 'manager', 'service_advisor');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT COALESCE(array_agg(location_id ORDER BY location_id), ARRAY[]::uuid[])
  INTO v_location_ids
  FROM public.user_location
  WHERE user_id = v_actor_user_id;
  IF cardinality(v_location_ids) = 0 THEN
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

  -- Freeze every row that can affect the source projection. Lock ordering is
  -- deterministic and starts with motorcycle, matching share creation.
  PERFORM 1
  FROM public.work_order
  WHERE motorcycle_id = p_motorcycle_id
    AND location_id = ANY(v_location_ids)
  ORDER BY work_order_id
  FOR UPDATE;

  PERFORM 1
  FROM public.job
  WHERE work_order_id IN (
    SELECT work_order_id
    FROM public.work_order
    WHERE motorcycle_id = p_motorcycle_id
      AND location_id = ANY(v_location_ids)
  )
  ORDER BY job_id
  FOR UPDATE;

  PERFORM 1
  FROM public.job_part_requirement
  WHERE job_id IN (
    SELECT job.job_id
    FROM public.job
    JOIN public.work_order
      ON work_order.work_order_id = job.work_order_id
    WHERE work_order.motorcycle_id = p_motorcycle_id
      AND work_order.location_id = ANY(v_location_ids)
  )
  ORDER BY requirement_id
  FOR UPDATE;

  PERFORM 1
  FROM public.location
  WHERE location_id IN (
    SELECT work_order.location_id
    FROM public.work_order
    WHERE work_order.motorcycle_id = p_motorcycle_id
      AND work_order.location_id = ANY(v_location_ids)
  )
  ORDER BY location_id
  FOR SHARE;

  PERFORM 1
  FROM public.service
  WHERE service_id IN (
    SELECT job.service_id
    FROM public.job
    JOIN public.work_order
      ON work_order.work_order_id = job.work_order_id
    WHERE work_order.motorcycle_id = p_motorcycle_id
      AND work_order.location_id = ANY(v_location_ids)
  )
  ORDER BY service_id
  FOR SHARE;

  PERFORM 1
  FROM public.customer
  WHERE customer_id IN (
    SELECT motorcycle.customer_id
    FROM public.motorcycle
    WHERE motorcycle.motorcycle_id = p_motorcycle_id
    UNION
    SELECT DISTINCT work_order.customer_id
    FROM public.work_order
    WHERE work_order.motorcycle_id = p_motorcycle_id
      AND work_order.status = 'completed'
      AND work_order.location_id = ANY(v_location_ids)
  )
  ORDER BY customer_id
  FOR SHARE;

  v_source := public.vehicle_passport_build_source(
    p_motorcycle_id,
    v_location_ids
  );
  v_source_sha256 := encode(digest(v_source::text, 'sha256'), 'hex');
  IF v_source_sha256 <> p_source_sha256 THEN
    RAISE EXCEPTION 'PASSPORT_SOURCE_CHANGED';
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
    AND location_id = ANY(v_location_ids)
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
      revoked_by_user_id = v_actor_user_id,
      revocation_reason = 'superseded'
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
  uuid, uuid, text, integer, jsonb, text, text, timestamptz, uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_vehicle_passport_snapshot(
  uuid, uuid, text, integer, jsonb, text, text, timestamptz, uuid[]
) TO service_role;

CREATE OR REPLACE FUNCTION public.create_vehicle_passport_share(
  p_actor_user_id uuid,
  p_snapshot_id uuid,
  p_expected_customer_id uuid,
  p_token_hash text
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
  v_motorcycle_id uuid;
  v_current_customer_id uuid;
  v_share_id uuid;
  v_now timestamptz := now();
  v_expires_at timestamptz;
BEGIN
  SELECT user_id
  INTO v_actor_user_id
  FROM public.app_user
  WHERE user_id = p_actor_user_id
    AND status = 'active'
    AND role IN ('owner', 'manager', 'service_advisor');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'PASSPORT_SHARE_INVALID';
  END IF;
  v_expires_at := v_now + interval '7 days';

  -- Resolve the lock target, then lock in the same motorcycle -> passport ->
  -- snapshot order as publication. The expected owner check prevents a grant
  -- requested before transfer from committing afterward.
  SELECT passport.passport_id, passport.motorcycle_id
  INTO v_passport_id, v_motorcycle_id
  FROM public.vehicle_passport_snapshot AS snapshot
  JOIN public.vehicle_passport AS passport
    ON passport.passport_id = snapshot.passport_id
  WHERE snapshot.snapshot_id = p_snapshot_id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PASSPORT_SNAPSHOT_NOT_CURRENT';
  END IF;

  SELECT customer_id
  INTO v_current_customer_id
  FROM public.motorcycle
  WHERE motorcycle_id = v_motorcycle_id
  FOR UPDATE;
  IF NOT FOUND OR v_current_customer_id <> p_expected_customer_id THEN
    RAISE EXCEPTION 'PASSPORT_OWNER_CHANGED';
  END IF;

  PERFORM 1
  FROM public.vehicle_passport
  WHERE passport_id = v_passport_id
    AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PASSPORT_SNAPSHOT_NOT_CURRENT';
  END IF;

  PERFORM 1
  FROM public.vehicle_passport_snapshot
  WHERE snapshot_id = p_snapshot_id
    AND passport_id = v_passport_id
    AND superseded_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PASSPORT_SNAPSHOT_NOT_CURRENT';
  END IF;

  UPDATE public.vehicle_passport_share
  SET
    revoked_at = v_now,
    revoked_by_user_id = v_actor_user_id,
    revocation_reason = 'replaced'
  WHERE snapshot_id = p_snapshot_id
    AND revoked_at IS NULL;

  INSERT INTO public.vehicle_passport_share (
    snapshot_id,
    token_hash,
    expires_at,
    created_by_user_id,
    created_at
  )
  VALUES (
    p_snapshot_id,
    p_token_hash,
    v_expires_at,
    v_actor_user_id,
    v_now
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
      'expires_at', v_expires_at
    )
  );

  RETURN QUERY SELECT v_share_id, v_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_vehicle_passport_share(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_vehicle_passport_share(
  uuid, uuid, uuid, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_vehicle_passport_share(
  p_actor_user_id uuid,
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
  SELECT user_id
  INTO v_actor_user_id
  FROM public.app_user
  WHERE user_id = p_actor_user_id
    AND status = 'active'
    AND role IN ('owner', 'manager', 'service_advisor');
  IF NOT FOUND THEN
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
      revoked_by_user_id = v_actor_user_id,
      revocation_reason = 'manual'
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

REVOKE ALL ON FUNCTION public.revoke_vehicle_passport_share(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_vehicle_passport_share(uuid, uuid)
  TO service_role;

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
