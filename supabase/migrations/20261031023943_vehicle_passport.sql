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
GRANT SELECT, INSERT, UPDATE ON TABLE public.vehicle_passport TO authenticated;
GRANT ALL ON TABLE public.vehicle_passport TO service_role;

REVOKE ALL ON TABLE public.vehicle_passport_snapshot FROM PUBLIC;
REVOKE ALL ON TABLE public.vehicle_passport_snapshot FROM anon;
REVOKE ALL ON TABLE public.vehicle_passport_snapshot FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.vehicle_passport_snapshot TO authenticated;
GRANT ALL ON TABLE public.vehicle_passport_snapshot TO service_role;

REVOKE ALL ON TABLE public.vehicle_passport_snapshot_source FROM PUBLIC;
REVOKE ALL ON TABLE public.vehicle_passport_snapshot_source FROM anon;
REVOKE ALL ON TABLE public.vehicle_passport_snapshot_source FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.vehicle_passport_snapshot_source TO authenticated;
GRANT ALL ON TABLE public.vehicle_passport_snapshot_source TO service_role;

REVOKE ALL ON TABLE public.vehicle_passport_share FROM PUBLIC;
REVOKE ALL ON TABLE public.vehicle_passport_share FROM anon;
REVOKE ALL ON TABLE public.vehicle_passport_share FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.vehicle_passport_share TO authenticated;
GRANT ALL ON TABLE public.vehicle_passport_share TO service_role;
