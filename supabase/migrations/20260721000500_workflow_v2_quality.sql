-- Workflow V2 phase 5/7: immutable QC and safety attempt evidence.
-- Failed attempts stay on record; rework produces new attempts against a
-- new scope hash instead of erasing history.

CREATE TABLE IF NOT EXISTS quality_check_attempt (
  attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES work_order(work_order_id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES location(location_id) ON DELETE RESTRICT,
  scope_hash text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('passed', 'failed')),
  checklist jsonb,
  notes text,
  performed_by_user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  assigned_to_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quality_check_attempt_wo
  ON quality_check_attempt (work_order_id, performed_at DESC);

CREATE TABLE IF NOT EXISTS safety_check_attempt (
  attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES work_order(work_order_id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES location(location_id) ON DELETE RESTRICT,
  scope_hash text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('passed', 'failed')),
  checklist jsonb,
  notes text,
  performed_by_user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safety_check_attempt_wo
  ON safety_check_attempt (work_order_id, performed_at DESC);

ALTER TABLE quality_check_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_check_attempt ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quality_check_attempt_select ON quality_check_attempt;
CREATE POLICY quality_check_attempt_select ON quality_check_attempt
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
  );

DROP POLICY IF EXISTS safety_check_attempt_select ON safety_check_attempt;
CREATE POLICY safety_check_attempt_select ON safety_check_attempt
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
  );

-- Attempts are append-only evidence.
DROP TRIGGER IF EXISTS trg_quality_check_attempt_append_only ON quality_check_attempt;
CREATE TRIGGER trg_quality_check_attempt_append_only
  BEFORE UPDATE OR DELETE ON quality_check_attempt
  FOR EACH ROW EXECUTE FUNCTION public.workflow_v2_reject_evidence_mutation();

DROP TRIGGER IF EXISTS trg_safety_check_attempt_append_only ON safety_check_attempt;
CREATE TRIGGER trg_safety_check_attempt_append_only
  BEFORE UPDATE OR DELETE ON safety_check_attempt
  FOR EACH ROW EXECUTE FUNCTION public.workflow_v2_reject_evidence_mutation();
