-- Workflow V2 phase 3/7: immutable estimates, per-job customer decisions,
-- and one aggregate confirmation per presented version.

CREATE TABLE IF NOT EXISTS estimate (
  estimate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES work_order(work_order_id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES location(location_id) ON DELETE RESTRICT,
  estimate_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'presented', 'confirmed', 'superseded', 'void')
  ),
  currency text NOT NULL DEFAULT 'CAD',
  current_version_id uuid,
  created_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  presented_at timestamptz,
  confirmed_at timestamptz,
  superseded_at timestamptz,
  voided_at timestamptz
);

-- One live estimate document per work order.
CREATE UNIQUE INDEX IF NOT EXISTS uq_estimate_live_per_work_order
  ON estimate (work_order_id)
  WHERE status IN ('draft', 'presented', 'confirmed');

CREATE UNIQUE INDEX IF NOT EXISTS uq_estimate_number
  ON estimate (estimate_number);

CREATE TABLE IF NOT EXISTS estimate_version (
  estimate_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES estimate(estimate_id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'presented', 'confirmed', 'superseded', 'void')
  ),
  subtotal_cents bigint NOT NULL DEFAULT 0,
  discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents bigint NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents bigint NOT NULL DEFAULT 0,
  deposit_required_cents bigint CHECK (
    deposit_required_cents IS NULL OR deposit_required_cents >= 0
  ),
  terms_version text,
  content_hash text,
  created_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  presented_at timestamptz,
  finalized_at timestamptz,
  UNIQUE (estimate_id, version_no)
);

-- Exactly one live presented version per estimate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_estimate_version_presented
  ON estimate_version (estimate_id)
  WHERE status = 'presented';

ALTER TABLE estimate
  DROP CONSTRAINT IF EXISTS estimate_current_version_fk;
ALTER TABLE estimate
  ADD CONSTRAINT estimate_current_version_fk
  FOREIGN KEY (current_version_id)
  REFERENCES estimate_version(estimate_version_id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS estimate_job (
  estimate_job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_version_id uuid NOT NULL REFERENCES estimate_version(estimate_version_id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES job(job_id) ON DELETE CASCADE,
  display_order integer NOT NULL DEFAULT 0,
  title_snapshot text NOT NULL,
  description_snapshot text,
  pricing_mode_snapshot text NOT NULL CHECK (
    pricing_mode_snapshot IN ('itemized', 'fixed_package', 'no_charge')
  ),
  labor_cents bigint NOT NULL DEFAULT 0 CHECK (labor_cents >= 0),
  parts_cents bigint NOT NULL DEFAULT 0 CHECK (parts_cents >= 0),
  fees_cents bigint NOT NULL DEFAULT 0 CHECK (fees_cents >= 0),
  discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents bigint NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents bigint NOT NULL DEFAULT 0,
  UNIQUE (estimate_version_id, job_id)
);

CREATE TABLE IF NOT EXISTS estimate_line (
  estimate_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_version_id uuid NOT NULL REFERENCES estimate_version(estimate_version_id) ON DELETE CASCADE,
  job_id uuid REFERENCES job(job_id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('labor', 'part', 'fee', 'discount', 'package')),
  source_table text,
  source_id uuid,
  description text NOT NULL,
  quantity numeric(10, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_amount_cents bigint NOT NULL,
  extended_amount_cents bigint NOT NULL,
  tax_code text NOT NULL DEFAULT 'HST',
  tax_rate_bps integer NOT NULL DEFAULT 1300 CHECK (tax_rate_bps >= 0),
  tax_amount_cents bigint NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0,
  CONSTRAINT estimate_line_discount_sign CHECK (
    (kind = 'discount' AND extended_amount_cents <= 0)
    OR (kind <> 'discount' AND extended_amount_cents >= 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_estimate_line_version
  ON estimate_line (estimate_version_id, position);

CREATE TABLE IF NOT EXISTS estimate_job_decision (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_version_id uuid NOT NULL REFERENCES estimate_version(estimate_version_id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES job(job_id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved', 'declined', 'deferred')),
  decided_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL CHECK (
    actor_type IN ('customer_portal', 'staff', 'system_migration')
  ),
  actor_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  method text CHECK (
    method IS NULL OR method IN (
      'portal', 'in_person', 'phone', 'email', 'sms',
      'legacy_explicit', 'legacy_inferred'
    )
  ),
  reason text,
  portal_token_id uuid,
  signer_name text,
  signer_contact text,
  ip_address text,
  user_agent text,
  UNIQUE (estimate_version_id, job_id)
);

CREATE TABLE IF NOT EXISTS estimate_confirmation (
  confirmation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_version_id uuid NOT NULL UNIQUE REFERENCES estimate_version(estimate_version_id) ON DELETE CASCADE,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL CHECK (
    actor_type IN ('customer_portal', 'staff', 'system_migration')
  ),
  actor_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  portal_token_id uuid,
  method text,
  signer_name text,
  signer_contact text,
  ip_address text,
  user_agent text,
  decisions_hash text NOT NULL,
  content_hash text NOT NULL,
  totals_snapshot jsonb NOT NULL,
  terms_version text
);

-- RLS: estimates carry customer pricing — front office and admin only.
-- All writes happen inside SECURITY DEFINER commands / service role.
ALTER TABLE estimate ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_job_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_confirmation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estimate_select ON estimate;
CREATE POLICY estimate_select ON estimate
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
    AND location_id IN (SELECT public.user_location_ids())
  );

DROP POLICY IF EXISTS estimate_version_select ON estimate_version;
CREATE POLICY estimate_version_select ON estimate_version
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
    AND EXISTS (
      SELECT 1 FROM estimate e
      WHERE e.estimate_id = estimate_version.estimate_id
        AND e.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS estimate_job_select ON estimate_job;
CREATE POLICY estimate_job_select ON estimate_job
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
    AND EXISTS (
      SELECT 1
      FROM estimate_version ev
      JOIN estimate e ON e.estimate_id = ev.estimate_id
      WHERE ev.estimate_version_id = estimate_job.estimate_version_id
        AND e.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS estimate_line_select ON estimate_line;
CREATE POLICY estimate_line_select ON estimate_line
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
    AND EXISTS (
      SELECT 1
      FROM estimate_version ev
      JOIN estimate e ON e.estimate_id = ev.estimate_id
      WHERE ev.estimate_version_id = estimate_line.estimate_version_id
        AND e.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS estimate_job_decision_select ON estimate_job_decision;
CREATE POLICY estimate_job_decision_select ON estimate_job_decision
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
    AND EXISTS (
      SELECT 1
      FROM estimate_version ev
      JOIN estimate e ON e.estimate_id = ev.estimate_id
      WHERE ev.estimate_version_id = estimate_job_decision.estimate_version_id
        AND e.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS estimate_confirmation_select ON estimate_confirmation;
CREATE POLICY estimate_confirmation_select ON estimate_confirmation
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
    AND EXISTS (
      SELECT 1
      FROM estimate_version ev
      JOIN estimate e ON e.estimate_id = ev.estimate_id
      WHERE ev.estimate_version_id = estimate_confirmation.estimate_version_id
        AND e.location_id IN (SELECT public.user_location_ids())
    )
  );

-- Immutability: presented/confirmed versions and their children may never be
-- rewritten, even by definer commands — enforce at the database layer.
CREATE OR REPLACE FUNCTION public.workflow_v2_reject_presented_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_status text;
  target_version uuid;
BEGIN
  IF TG_TABLE_NAME = 'estimate_version' THEN
    IF TG_OP = 'DELETE' THEN
      version_status := OLD.status;
    ELSE
      version_status := OLD.status;
      -- Allow only the sanctioned status transitions on the version row itself.
      IF version_status = 'draft' THEN
        RETURN COALESCE(NEW, OLD);
      END IF;
      IF version_status = 'presented'
        AND NEW.status IN ('confirmed', 'superseded', 'void')
        AND NEW.subtotal_cents = OLD.subtotal_cents
        AND NEW.discount_cents = OLD.discount_cents
        AND NEW.tax_cents = OLD.tax_cents
        AND NEW.total_cents = OLD.total_cents
        AND COALESCE(NEW.content_hash, '') = COALESCE(OLD.content_hash, '')
      THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'ESTIMATE_VERSION_IMMUTABLE';
    END IF;
    IF version_status <> 'draft' THEN
      RAISE EXCEPTION 'ESTIMATE_VERSION_IMMUTABLE';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'DELETE' THEN
    target_version := OLD.estimate_version_id;
  ELSE
    target_version := NEW.estimate_version_id;
  END IF;

  PERFORM 1 FROM estimate_version ev
    WHERE ev.estimate_version_id = target_version
      AND ev.status <> 'draft';
  IF FOUND THEN
    RAISE EXCEPTION 'ESTIMATE_VERSION_IMMUTABLE';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_estimate_version_immutable ON estimate_version;
CREATE TRIGGER trg_estimate_version_immutable
  BEFORE UPDATE OR DELETE ON estimate_version
  FOR EACH ROW EXECUTE FUNCTION public.workflow_v2_reject_presented_mutation();

DROP TRIGGER IF EXISTS trg_estimate_job_immutable ON estimate_job;
CREATE TRIGGER trg_estimate_job_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON estimate_job
  FOR EACH ROW EXECUTE FUNCTION public.workflow_v2_reject_presented_mutation();

DROP TRIGGER IF EXISTS trg_estimate_line_immutable ON estimate_line;
CREATE TRIGGER trg_estimate_line_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON estimate_line
  FOR EACH ROW EXECUTE FUNCTION public.workflow_v2_reject_presented_mutation();

-- Decisions/confirmations are append-only evidence: no update or delete ever.
CREATE OR REPLACE FUNCTION public.workflow_v2_reject_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'WORKFLOW_EVIDENCE_APPEND_ONLY';
END;
$$;

DROP TRIGGER IF EXISTS trg_estimate_job_decision_append_only ON estimate_job_decision;
CREATE TRIGGER trg_estimate_job_decision_append_only
  BEFORE UPDATE OR DELETE ON estimate_job_decision
  FOR EACH ROW EXECUTE FUNCTION public.workflow_v2_reject_evidence_mutation();

DROP TRIGGER IF EXISTS trg_estimate_confirmation_append_only ON estimate_confirmation;
CREATE TRIGGER trg_estimate_confirmation_append_only
  BEFORE UPDATE OR DELETE ON estimate_confirmation
  FOR EACH ROW EXECUTE FUNCTION public.workflow_v2_reject_evidence_mutation();
