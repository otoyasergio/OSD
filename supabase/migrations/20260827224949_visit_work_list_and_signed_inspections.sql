-- Visit work list: job.origin + tech signatures on arrival inspection, QC, and final inspection.

-- ---------------------------------------------------------------------------
-- job.origin — customer_request | recommendation | shop_added
-- ---------------------------------------------------------------------------
ALTER TABLE public.job
  ADD COLUMN IF NOT EXISTS origin text;

UPDATE public.job
  SET origin = 'recommendation'
  WHERE origin IS NULL
    AND job_id IN (
      SELECT converted_job_id
      FROM public.recommendation
      WHERE converted_job_id IS NOT NULL
    );

UPDATE public.job
  SET origin = 'customer_request'
  WHERE origin IS NULL;

ALTER TABLE public.job
  ALTER COLUMN origin SET DEFAULT 'shop_added';

ALTER TABLE public.job
  ALTER COLUMN origin SET NOT NULL;

ALTER TABLE public.job
  DROP CONSTRAINT IF EXISTS job_origin_check;

ALTER TABLE public.job
  ADD CONSTRAINT job_origin_check
  CHECK (origin IN ('customer_request', 'recommendation', 'shop_added'));

COMMENT ON COLUMN public.job.origin IS
  'How the job entered the visit: customer_request (intake), recommendation (finding), or shop_added (office).';

-- ---------------------------------------------------------------------------
-- Immutable QC / safety attempt evidence (created here if Workflow V2 never landed)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quality_check_attempt (
  attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.work_order(work_order_id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.location(location_id) ON DELETE RESTRICT,
  scope_hash text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('passed', 'failed')),
  checklist jsonb,
  notes text,
  performed_by_user_id uuid NOT NULL REFERENCES public.app_user(user_id) ON DELETE RESTRICT,
  assigned_to_user_id uuid REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  performed_at timestamptz NOT NULL DEFAULT now(),
  signature_storage_path text
);

CREATE INDEX IF NOT EXISTS idx_quality_check_attempt_wo
  ON public.quality_check_attempt (work_order_id, performed_at DESC);

CREATE TABLE IF NOT EXISTS public.safety_check_attempt (
  attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.work_order(work_order_id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.location(location_id) ON DELETE RESTRICT,
  scope_hash text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('passed', 'failed')),
  checklist jsonb,
  notes text,
  performed_by_user_id uuid NOT NULL REFERENCES public.app_user(user_id) ON DELETE RESTRICT,
  performed_at timestamptz NOT NULL DEFAULT now(),
  signature_storage_path text
);

CREATE INDEX IF NOT EXISTS idx_safety_check_attempt_wo
  ON public.safety_check_attempt (work_order_id, performed_at DESC);

ALTER TABLE public.quality_check_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_check_attempt ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quality_check_attempt_select ON public.quality_check_attempt;
CREATE POLICY quality_check_attempt_select ON public.quality_check_attempt
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
  );

DROP POLICY IF EXISTS quality_check_attempt_insert ON public.quality_check_attempt;
CREATE POLICY quality_check_attempt_insert ON public.quality_check_attempt
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
  );

DROP POLICY IF EXISTS safety_check_attempt_select ON public.safety_check_attempt;
CREATE POLICY safety_check_attempt_select ON public.safety_check_attempt
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
  );

DROP POLICY IF EXISTS safety_check_attempt_insert ON public.safety_check_attempt;
CREATE POLICY safety_check_attempt_insert ON public.safety_check_attempt
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
  );

-- Append-only when the V2 reject helper exists; otherwise skip (no UPDATE/DELETE policies).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'workflow_v2_reject_evidence_mutation'
  ) THEN
    DROP TRIGGER IF EXISTS trg_quality_check_attempt_append_only ON public.quality_check_attempt;
    CREATE TRIGGER trg_quality_check_attempt_append_only
      BEFORE UPDATE OR DELETE ON public.quality_check_attempt
      FOR EACH ROW EXECUTE FUNCTION public.workflow_v2_reject_evidence_mutation();

    DROP TRIGGER IF EXISTS trg_safety_check_attempt_append_only ON public.safety_check_attempt;
    CREATE TRIGGER trg_safety_check_attempt_append_only
      BEFORE UPDATE OR DELETE ON public.safety_check_attempt
      FOR EACH ROW EXECUTE FUNCTION public.workflow_v2_reject_evidence_mutation();
  END IF;
END $$;

-- Columns may already exist if tables were created by an earlier V2 migration.
ALTER TABLE public.quality_check_attempt
  ADD COLUMN IF NOT EXISTS signature_storage_path text;

ALTER TABLE public.safety_check_attempt
  ADD COLUMN IF NOT EXISTS signature_storage_path text;

ALTER TABLE public.inspection
  ADD COLUMN IF NOT EXISTS signature_storage_path text;

COMMENT ON COLUMN public.inspection.signature_storage_path IS
  'Drawn tech signature (inspection-signatures bucket) required to complete the arrival report.';

COMMENT ON COLUMN public.quality_check_attempt.signature_storage_path IS
  'Drawn peer/office QC signature path in inspection-signatures.';

COMMENT ON COLUMN public.safety_check_attempt.signature_storage_path IS
  'Drawn head-tech final inspection signature path in inspection-signatures.';

-- ---------------------------------------------------------------------------
-- Storage bucket for inspection sign-offs
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspection-signatures',
  'inspection-signatures',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS inspection_signatures_select ON storage.objects;
CREATE POLICY inspection_signatures_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'inspection-signatures' AND is_active_app_user());

DROP POLICY IF EXISTS inspection_signatures_insert ON storage.objects;
CREATE POLICY inspection_signatures_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'inspection-signatures' AND is_active_app_user());

-- ---------------------------------------------------------------------------
-- Optionally patch V2 RPCs when they already exist (signature path param)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'workflow_v2_record_qc_attempt'
  ) THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.workflow_v2_record_qc_attempt(
  p_work_order_id uuid,
  p_actor_user_id uuid,
  p_outcome text,
  p_scope_hash text,
  p_notes text DEFAULT NULL,
  p_checklist jsonb DEFAULT NULL,
  p_rework_job_ids uuid[] DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_signature_storage_path text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  actor app_user;
  wo work_order;
  attempt_id_out uuid;
  rework_id uuid;
BEGIN
  actor := public.workflow_v2_require_staff_actor(
    p_actor_user_id,
    ARRAY['technician', 'head_tech', 'owner', 'manager', 'service_advisor']
  );
  IF p_outcome NOT IN ('passed', 'failed') THEN
    RAISE EXCEPTION 'INVALID_OUTCOME';
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM domain_event WHERE idempotency_key = p_idempotency_key
  ) THEN
    RETURN jsonb_build_object('work_order_id', p_work_order_id, 'replayed', true);
  END IF;

  SELECT * INTO wo FROM work_order WHERE work_order_id = p_work_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND'; END IF;

  IF actor.role IN ('technician', 'head_tech') AND (
    EXISTS (
      SELECT 1 FROM job j
      WHERE j.work_order_id = p_work_order_id
        AND j.assigned_technician_id = actor.user_id
    ) OR EXISTS (
      SELECT 1 FROM job_time_entry t
      JOIN job j ON j.job_id = t.job_id
      WHERE j.work_order_id = p_work_order_id AND t.user_id = actor.user_id
    )
  ) THEN
    RAISE EXCEPTION 'QC_CANNOT_CHECK_OWN_WORK';
  END IF;

  INSERT INTO quality_check_attempt (
    work_order_id, location_id, scope_hash, outcome, checklist, notes,
    performed_by_user_id, assigned_to_user_id, signature_storage_path
  ) VALUES (
    p_work_order_id, wo.location_id, p_scope_hash, p_outcome, p_checklist,
    p_notes, actor.user_id, wo.quality_check_assigned_to, p_signature_storage_path
  )
  RETURNING attempt_id INTO attempt_id_out;

  IF p_outcome = 'passed' THEN
    UPDATE work_order SET
      quality_checked_at = now(),
      quality_checked_by_user_id = actor.user_id,
      quality_check_notes = p_notes,
      updated_at = now()
    WHERE work_order_id = p_work_order_id;
  ELSE
    IF p_rework_job_ids IS NOT NULL THEN
      FOREACH rework_id IN ARRAY p_rework_job_ids LOOP
        UPDATE job SET
          status = 'ready_to_start',
          work_state = 'ready',
          updated_at = now()
        WHERE job_id = rework_id AND work_order_id = p_work_order_id;
      END LOOP;
    END IF;
    UPDATE work_order SET
      quality_checked_at = NULL,
      quality_checked_by_user_id = NULL,
      quality_check_notes = p_notes,
      quality_check_assigned_to = NULL,
      updated_at = now()
    WHERE work_order_id = p_work_order_id;
  END IF;

  PERFORM public.workflow_v2_append_event(
    'work_order', p_work_order_id, p_work_order_id,
    CASE WHEN p_outcome = 'passed' THEN 'qc_passed' ELSE 'qc_failed' END,
    'staff', actor.user_id,
    NULL,
    jsonb_build_object(
      'attempt_id', attempt_id_out,
      'scope_hash', p_scope_hash,
      'rework_job_ids', to_jsonb(COALESCE(p_rework_job_ids, ARRAY[]::uuid[])),
      'signature_storage_path', p_signature_storage_path
    ),
    p_idempotency_key
  );

  RETURN jsonb_build_object(
    'attempt_id', attempt_id_out,
    'outcome', p_outcome,
    'replayed', false
  );
END;
$body$;
$fn$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'workflow_v2_record_safety_attempt'
  ) THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.workflow_v2_record_safety_attempt(
  p_work_order_id uuid,
  p_actor_user_id uuid,
  p_outcome text,
  p_scope_hash text,
  p_notes text DEFAULT NULL,
  p_checklist jsonb DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_signature_storage_path text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  actor app_user;
  wo work_order;
  attempt_id_out uuid;
BEGIN
  actor := public.workflow_v2_require_staff_actor(
    p_actor_user_id,
    ARRAY['head_tech', 'owner', 'manager']
  );
  IF p_outcome NOT IN ('passed', 'failed') THEN
    RAISE EXCEPTION 'INVALID_OUTCOME';
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM domain_event WHERE idempotency_key = p_idempotency_key
  ) THEN
    RETURN jsonb_build_object('work_order_id', p_work_order_id, 'replayed', true);
  END IF;

  SELECT * INTO wo FROM work_order WHERE work_order_id = p_work_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND'; END IF;
  IF wo.quality_checked_at IS NULL THEN
    RAISE EXCEPTION 'SAFETY_REQUIRES_QC_PASS';
  END IF;

  INSERT INTO safety_check_attempt (
    work_order_id, location_id, scope_hash, outcome, checklist, notes,
    performed_by_user_id, signature_storage_path
  ) VALUES (
    p_work_order_id, wo.location_id, p_scope_hash, p_outcome, p_checklist,
    p_notes, actor.user_id, p_signature_storage_path
  )
  RETURNING attempt_id INTO attempt_id_out;

  IF p_outcome = 'passed' THEN
    UPDATE work_order SET
      safety_checked_at = now(),
      safety_checked_by_user_id = actor.user_id,
      safety_check_notes = p_notes,
      updated_at = now()
    WHERE work_order_id = p_work_order_id;
  ELSE
    UPDATE work_order SET
      safety_checked_at = NULL,
      safety_checked_by_user_id = NULL,
      safety_check_notes = p_notes,
      updated_at = now()
    WHERE work_order_id = p_work_order_id;
  END IF;

  PERFORM public.workflow_v2_append_event(
    'work_order', p_work_order_id, p_work_order_id,
    CASE WHEN p_outcome = 'passed' THEN 'safety_passed' ELSE 'safety_failed' END,
    'staff', actor.user_id,
    NULL,
    jsonb_build_object(
      'attempt_id', attempt_id_out,
      'scope_hash', p_scope_hash,
      'signature_storage_path', p_signature_storage_path
    ),
    p_idempotency_key
  );

  RETURN jsonb_build_object(
    'attempt_id', attempt_id_out,
    'outcome', p_outcome,
    'replayed', false
  );
END;
$body$;
$fn$;
  END IF;
END $$;
