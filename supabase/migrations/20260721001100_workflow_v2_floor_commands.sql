-- Workflow V2 commands (2/2): technician floor transitions, QC/safety
-- attempts, invoice issuance, and payment application. Each command is a
-- single transaction with actor validation, row locks, idempotency, and a
-- domain event.

-- Effective authorization for a job on the live confirmed estimate version.
CREATE OR REPLACE FUNCTION public.workflow_v2_job_authorization(p_job_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.decision
  FROM estimate_job_decision d
  JOIN estimate_version ev ON ev.estimate_version_id = d.estimate_version_id
  JOIN estimate e ON e.estimate_id = ev.estimate_id
  WHERE d.job_id = p_job_id
    AND ev.status IN ('presented', 'confirmed')
    AND e.status IN ('presented', 'confirmed')
  ORDER BY ev.version_no DESC, d.decided_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_job_authorization(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workflow_v2_job_authorization(uuid)
  TO authenticated, service_role;

-- Legacy-tolerant authorization: during rollout a job approved through the
-- old flow (job.status) counts as authorized when no V2 decision exists.
CREATE OR REPLACE FUNCTION public.workflow_v2_job_is_authorized(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v2_decision text;
  legacy_status text;
BEGIN
  v2_decision := public.workflow_v2_job_authorization(p_job_id);
  IF v2_decision IS NOT NULL THEN
    RETURN v2_decision = 'approved';
  END IF;
  SELECT status INTO legacy_status FROM job WHERE job_id = p_job_id;
  RETURN legacy_status IN (
    'approved', 'waiting_for_parts', 'ready_to_start', 'in_progress', 'completed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_job_is_authorized(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workflow_v2_job_is_authorized(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- pull_job_onto_bench: atomically park the current bench job (only after the
-- replacement is validated), start the new job, and open its timer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workflow_v2_pull_job_onto_bench(
  p_job_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor app_user;
  target job;
  wo work_order;
  bench job;
  parked_job_id uuid := NULL;
  has_attendance boolean;
  parts_blocked boolean;
BEGIN
  actor := public.workflow_v2_require_staff_actor(
    p_actor_user_id,
    ARRAY['technician', 'head_tech', 'owner', 'manager']
  );

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM domain_event WHERE idempotency_key = p_idempotency_key
  ) THEN
    RETURN jsonb_build_object('job_id', p_job_id, 'replayed', true);
  END IF;

  SELECT * INTO target FROM job WHERE job_id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND'; END IF;

  SELECT * INTO wo FROM work_order WHERE work_order_id = target.work_order_id
  FOR UPDATE;
  IF wo.status IN ('completed', 'cancelled') OR wo.status = 'on_hold' THEN
    RAISE EXCEPTION 'WORK_ORDER_NOT_WORKABLE';
  END IF;

  IF target.assigned_technician_id IS NOT NULL
    AND target.assigned_technician_id <> actor.user_id
    AND actor.role NOT IN ('owner', 'manager')
  THEN
    RAISE EXCEPTION 'JOB_ASSIGNED_TO_OTHER_TECH';
  END IF;

  IF NOT public.workflow_v2_job_is_authorized(p_job_id) THEN
    RAISE EXCEPTION 'JOB_NOT_AUTHORIZED';
  END IF;

  IF target.status NOT IN ('approved', 'ready_to_start') THEN
    RAISE EXCEPTION 'JOB_NOT_PULLABLE';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM job_part_requirement r
    WHERE r.job_id = p_job_id
      AND r.state NOT IN ('received', 'allocated', 'installed', 'waived', 'cancelled')
  ) INTO parts_blocked;
  IF parts_blocked OR EXISTS (
    SELECT 1 FROM job_blocker b
    WHERE b.job_id = p_job_id AND b.kind = 'parts' AND b.cleared_at IS NULL
  ) THEN
    RAISE EXCEPTION 'JOB_WAITING_FOR_PARTS';
  END IF;

  -- Attendance: technician must be clocked in (when the table exists).
  SELECT EXISTS (
    SELECT 1 FROM time_clock_entry t
    WHERE t.user_id = actor.user_id AND t.clock_out_at IS NULL
  ) INTO has_attendance;
  IF NOT has_attendance AND actor.role IN ('technician', 'head_tech') THEN
    RAISE EXCEPTION 'NOT_CLOCKED_IN_FOR_JOB';
  END IF;

  -- Current bench job (open timer) parks only because the replacement is valid.
  SELECT j.* INTO bench
  FROM job_time_entry t
  JOIN job j ON j.job_id = t.job_id
  WHERE t.user_id = actor.user_id AND t.ended_at IS NULL
  FOR UPDATE OF j;

  IF FOUND THEN
    IF bench.job_id = p_job_id THEN
      RETURN jsonb_build_object('job_id', p_job_id, 'replayed', true);
    END IF;
    UPDATE job_time_entry SET ended_at = now()
    WHERE user_id = actor.user_id AND ended_at IS NULL;

    UPDATE job SET
      status = 'ready_to_start',
      work_state = 'ready',
      floor_parked_at = now(),
      floor_park_reason = 'swapped',
      floor_wait_owner = 'technician',
      updated_at = now()
    WHERE job_id = bench.job_id;

    INSERT INTO job_blocker (job_id, location_id, kind, owner, reason, opened_by_user_id)
    VALUES (bench.job_id, wo.location_id, 'swapped', 'technician',
            'Swapped for another bike', actor.user_id)
    ON CONFLICT DO NOTHING;
    parked_job_id := bench.job_id;
  END IF;

  UPDATE job SET
    status = 'in_progress',
    work_state = 'in_progress',
    assigned_technician_id = COALESCE(target.assigned_technician_id, actor.user_id),
    started_at = COALESCE(target.started_at, now()),
    floor_parked_at = NULL,
    floor_park_reason = NULL,
    floor_wait_owner = NULL,
    updated_at = now()
  WHERE job_id = p_job_id;

  UPDATE job_blocker SET cleared_at = now(), cleared_by_user_id = actor.user_id
  WHERE job_id = p_job_id AND cleared_at IS NULL AND kind IN ('swapped', 'tool', 'other');

  INSERT INTO job_time_entry (job_id, user_id, location_id)
  VALUES (p_job_id, actor.user_id, wo.location_id);

  PERFORM public.workflow_v2_append_event(
    'job', p_job_id, target.work_order_id,
    'job_pulled_onto_bench', 'staff', actor.user_id,
    jsonb_build_object('previous_status', target.status),
    jsonb_build_object('parked_job_id', parked_job_id),
    p_idempotency_key
  );

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'parked_job_id', parked_job_id,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_pull_job_onto_bench(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_v2_pull_job_onto_bench(uuid, uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- park_job: stop the bench timer and record who owns the wait.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workflow_v2_park_job(
  p_job_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_owner text,
  p_note text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor app_user;
  target job;
  wo_location uuid;
BEGIN
  actor := public.workflow_v2_require_staff_actor(
    p_actor_user_id,
    ARRAY['technician', 'head_tech', 'owner', 'manager']
  );
  IF p_reason NOT IN ('parts', 'approval', 'tool', 'other', 'swapped') THEN
    RAISE EXCEPTION 'INVALID_PARK_REASON';
  END IF;
  IF p_owner NOT IN ('front_desk', 'technician', 'parts', 'qc') THEN
    RAISE EXCEPTION 'INVALID_WAIT_OWNER';
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM domain_event WHERE idempotency_key = p_idempotency_key
  ) THEN
    RETURN jsonb_build_object('job_id', p_job_id, 'replayed', true);
  END IF;

  SELECT * INTO target FROM job WHERE job_id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND'; END IF;
  IF target.status <> 'in_progress' THEN
    RAISE EXCEPTION 'JOB_NOT_ON_BENCH';
  END IF;
  IF target.assigned_technician_id <> actor.user_id
    AND actor.role NOT IN ('owner', 'manager')
  THEN
    RAISE EXCEPTION 'JOB_ASSIGNED_TO_OTHER_TECH';
  END IF;

  SELECT location_id INTO wo_location FROM work_order
  WHERE work_order_id = target.work_order_id;

  UPDATE job_time_entry SET ended_at = now()
  WHERE job_id = p_job_id AND ended_at IS NULL;

  UPDATE job SET
    status = CASE WHEN p_reason = 'parts'
      THEN 'waiting_for_parts' ELSE 'ready_to_start' END,
    work_state = CASE WHEN p_reason = 'parts' THEN 'planned' ELSE 'ready' END,
    floor_parked_at = now(),
    floor_park_reason = p_reason,
    floor_wait_owner = CASE WHEN p_owner = 'technician'
      THEN 'technician' ELSE 'front_desk' END,
    updated_at = now()
  WHERE job_id = p_job_id;

  INSERT INTO job_blocker (job_id, location_id, kind, owner, reason, opened_by_user_id)
  VALUES (p_job_id, wo_location, p_reason, p_owner, p_note, actor.user_id)
  ON CONFLICT DO NOTHING;

  PERFORM public.workflow_v2_append_event(
    'job', p_job_id, target.work_order_id,
    'job_parked', 'staff', actor.user_id,
    jsonb_build_object('previous_status', target.status),
    jsonb_build_object('reason', p_reason, 'owner', p_owner, 'note', p_note),
    p_idempotency_key
  );

  RETURN jsonb_build_object('job_id', p_job_id, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_park_job(uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_v2_park_job(uuid, uuid, text, text, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- complete_job_and_assign_qc: gate-checked completion plus atomic QC
-- assignment. Candidate must not have worked any job on the visit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workflow_v2_complete_job_and_assign_qc(
  p_job_id uuid,
  p_actor_user_id uuid,
  p_qc_candidate_id uuid DEFAULT NULL,
  p_proof_exception boolean DEFAULT false,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor app_user;
  target job;
  wo work_order;
  unchecked_count integer;
  uninstalled_count integer;
  has_proof boolean;
  open_active_jobs integer;
  qc_assignee uuid := NULL;
BEGIN
  actor := public.workflow_v2_require_staff_actor(
    p_actor_user_id,
    ARRAY['technician', 'head_tech', 'owner', 'manager']
  );

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM domain_event WHERE idempotency_key = p_idempotency_key
  ) THEN
    RETURN jsonb_build_object('job_id', p_job_id, 'replayed', true);
  END IF;

  SELECT * INTO target FROM job WHERE job_id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND'; END IF;
  IF target.status <> 'in_progress' THEN
    RAISE EXCEPTION 'JOB_NOT_IN_PROGRESS';
  END IF;
  IF target.assigned_technician_id <> actor.user_id
    AND actor.role NOT IN ('owner', 'manager')
  THEN
    RAISE EXCEPTION 'JOB_ASSIGNED_TO_OTHER_TECH';
  END IF;

  SELECT * INTO wo FROM work_order WHERE work_order_id = target.work_order_id
  FOR UPDATE;

  -- Completion gates (server-authoritative).
  SELECT COUNT(*) INTO unchecked_count
  FROM job_checklist_item
  WHERE job_id = p_job_id AND checked_at IS NULL;
  IF unchecked_count > 0 THEN
    RAISE EXCEPTION 'JOB_CHECKLIST_INCOMPLETE';
  END IF;

  SELECT COUNT(*) INTO uninstalled_count
  FROM part
  WHERE job_id = p_job_id
    AND status NOT IN ('installed', 'not_required', 'cancelled');
  IF uninstalled_count > 0 THEN
    RAISE EXCEPTION 'JOB_PARTS_NOT_INSTALLED';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM intake_photo
    WHERE work_order_id = target.work_order_id
      AND category = 'job_proof'
      AND (job_id = p_job_id OR job_id IS NULL)
  ) INTO has_proof;
  IF NOT has_proof AND NOT p_proof_exception THEN
    RAISE EXCEPTION 'JOB_PROOF_REQUIRED';
  END IF;

  UPDATE job_time_entry SET ended_at = now()
  WHERE job_id = p_job_id AND ended_at IS NULL;

  UPDATE job SET
    status = 'completed',
    work_state = 'completed',
    completed_at = now(),
    floor_parked_at = NULL,
    floor_park_reason = NULL,
    floor_wait_owner = NULL,
    updated_at = now()
  WHERE job_id = p_job_id;

  UPDATE job_blocker SET cleared_at = now(), cleared_by_user_id = actor.user_id
  WHERE job_id = p_job_id AND cleared_at IS NULL;

  -- Visit-level QC once no active authorized work remains.
  SELECT COUNT(*) INTO open_active_jobs
  FROM job
  WHERE work_order_id = target.work_order_id
    AND status IN (
      'approved', 'waiting_for_parts', 'ready_to_start', 'in_progress'
    );

  IF open_active_jobs = 0 THEN
    IF p_qc_candidate_id IS NOT NULL THEN
      -- Candidate must be an active tech who worked no job on this visit.
      PERFORM public.workflow_v2_require_staff_actor(
        p_qc_candidate_id, ARRAY['technician', 'head_tech', 'owner', 'manager']
      );
      IF EXISTS (
        SELECT 1 FROM job j
        WHERE j.work_order_id = target.work_order_id
          AND j.assigned_technician_id = p_qc_candidate_id
      ) OR EXISTS (
        SELECT 1 FROM job_time_entry t
        JOIN job j ON j.job_id = t.job_id
        WHERE j.work_order_id = target.work_order_id
          AND t.user_id = p_qc_candidate_id
      ) THEN
        RAISE EXCEPTION 'QC_CANDIDATE_WORKED_ON_VISIT';
      END IF;
      qc_assignee := p_qc_candidate_id;
    END IF;

    UPDATE work_order SET
      quality_check_assigned_to = qc_assignee,
      updated_at = now()
    WHERE work_order_id = target.work_order_id;
  END IF;

  PERFORM public.workflow_v2_append_event(
    'job', p_job_id, target.work_order_id,
    'job_completed', 'staff', actor.user_id,
    jsonb_build_object('previous_status', target.status),
    jsonb_build_object(
      'qc_assigned_to', qc_assignee,
      'visit_work_remaining', open_active_jobs
    ),
    p_idempotency_key
  );

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'qc_assigned_to', qc_assignee,
    'visit_work_remaining', open_active_jobs,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_complete_job_and_assign_qc(
  uuid, uuid, uuid, boolean, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_v2_complete_job_and_assign_qc(
  uuid, uuid, uuid, boolean, text
) TO service_role;

-- ---------------------------------------------------------------------------
-- record_qc_attempt / record_safety_attempt: immutable attempts; rework
-- reopens targeted jobs without erasing original completion evidence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workflow_v2_record_qc_attempt(
  p_work_order_id uuid,
  p_actor_user_id uuid,
  p_outcome text,
  p_scope_hash text,
  p_notes text DEFAULT NULL,
  p_checklist jsonb DEFAULT NULL,
  p_rework_job_ids uuid[] DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- The QC performer must not have worked any job on this visit.
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
    performed_by_user_id, assigned_to_user_id
  ) VALUES (
    p_work_order_id, wo.location_id, p_scope_hash, p_outcome, p_checklist,
    p_notes, actor.user_id, wo.quality_check_assigned_to
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
    -- Targeted rework: reopen only the named jobs; original completion
    -- timestamps stay on record (domain_event + attempt preserve history).
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
      'rework_job_ids', to_jsonb(COALESCE(p_rework_job_ids, ARRAY[]::uuid[]))
    ),
    p_idempotency_key
  );

  RETURN jsonb_build_object(
    'attempt_id', attempt_id_out,
    'outcome', p_outcome,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_record_qc_attempt(
  uuid, uuid, text, text, text, jsonb, uuid[], text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_v2_record_qc_attempt(
  uuid, uuid, text, text, text, jsonb, uuid[], text
) TO service_role;

CREATE OR REPLACE FUNCTION public.workflow_v2_record_safety_attempt(
  p_work_order_id uuid,
  p_actor_user_id uuid,
  p_outcome text,
  p_scope_hash text,
  p_notes text DEFAULT NULL,
  p_checklist jsonb DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor app_user;
  wo work_order;
  attempt_id_out uuid;
BEGIN
  -- Safety is the head tech's call (owner/manager may override, audited).
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
    performed_by_user_id
  ) VALUES (
    p_work_order_id, wo.location_id, p_scope_hash, p_outcome, p_checklist,
    p_notes, actor.user_id
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
    jsonb_build_object('attempt_id', attempt_id_out, 'scope_hash', p_scope_hash),
    p_idempotency_key
  );

  RETURN jsonb_build_object(
    'attempt_id', attempt_id_out,
    'outcome', p_outcome,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_record_safety_attempt(
  uuid, uuid, text, text, text, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_v2_record_safety_attempt(
  uuid, uuid, text, text, text, jsonb, text
) TO service_role;

-- ---------------------------------------------------------------------------
-- issue_invoice_from_confirmed_scope: copy the approved jobs of the
-- confirmed estimate version into an immutable issued invoice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workflow_v2_issue_invoice(
  p_work_order_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor app_user;
  wo work_order;
  version estimate_version;
  invoice_id_out uuid;
  approved_subtotal bigint := 0;
  approved_tax bigint := 0;
  invoice_no text;
  line record;
  replay_result jsonb;
BEGIN
  actor := public.workflow_v2_require_staff_actor(
    p_actor_user_id,
    ARRAY['owner', 'manager', 'service_advisor', 'admin']
  );

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM domain_event WHERE idempotency_key = p_idempotency_key
  ) THEN
    SELECT jsonb_build_object('invoice_id', i.invoice_id, 'replayed', true)
    INTO replay_result
    FROM invoice i
    WHERE i.work_order_id = p_work_order_id AND i.status <> 'void'
    ORDER BY i.created_at DESC LIMIT 1;
    RETURN COALESCE(
      replay_result,
      jsonb_build_object('invoice_id', NULL, 'replayed', true)
    );
  END IF;

  SELECT * INTO wo FROM work_order WHERE work_order_id = p_work_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND'; END IF;

  SELECT ev.* INTO version
  FROM estimate_version ev
  JOIN estimate e ON e.estimate_id = ev.estimate_id
  WHERE e.work_order_id = p_work_order_id
    AND ev.status = 'confirmed'
  ORDER BY ev.version_no DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_CONFIRMED_ESTIMATE';
  END IF;

  -- Approved scope totals: each estimate_job total is subtotal + tax with
  -- per-job tax already rounded at estimate time.
  SELECT
    COALESCE(SUM(ej.total_cents - ej.tax_cents), 0),
    COALESCE(SUM(ej.tax_cents), 0)
  INTO approved_subtotal, approved_tax
  FROM estimate_job ej
  JOIN estimate_job_decision d
    ON d.estimate_version_id = ej.estimate_version_id AND d.job_id = ej.job_id
  WHERE ej.estimate_version_id = version.estimate_version_id
    AND d.decision = 'approved';

  invoice_no := wo.work_order_number || '-INV-' || to_char(now(), 'YYYYMMDDHH24MISS');

  INSERT INTO invoice (
    work_order_id, location_id, estimate_version_id, invoice_number, status,
    subtotal_cents, tax_cents, total_cents, balance_cents,
    issued_at, created_by_user_id
  ) VALUES (
    p_work_order_id, wo.location_id, version.estimate_version_id, invoice_no,
    'issued', approved_subtotal, approved_tax,
    approved_subtotal + approved_tax, approved_subtotal + approved_tax,
    now(), actor.user_id
  )
  RETURNING invoice_id INTO invoice_id_out;

  FOR line IN
    SELECT el.*
    FROM estimate_line el
    JOIN estimate_job_decision d
      ON d.estimate_version_id = el.estimate_version_id AND d.job_id = el.job_id
    WHERE el.estimate_version_id = version.estimate_version_id
      AND d.decision = 'approved'
    ORDER BY el.position
  LOOP
    INSERT INTO invoice_line (
      invoice_id, job_id, kind, description, quantity,
      unit_amount_cents, extended_amount_cents,
      tax_code, tax_rate_bps, tax_amount_cents, position
    ) VALUES (
      invoice_id_out, line.job_id, line.kind, line.description, line.quantity,
      line.unit_amount_cents, line.extended_amount_cents,
      line.tax_code, line.tax_rate_bps, line.tax_amount_cents, line.position
    );
  END LOOP;

  PERFORM public.workflow_v2_append_event(
    'invoice', invoice_id_out, p_work_order_id,
    'invoice_issued', 'staff', actor.user_id,
    NULL,
    jsonb_build_object(
      'invoice_number', invoice_no,
      'estimate_version_id', version.estimate_version_id,
      'total_cents', approved_subtotal + approved_tax
    ),
    p_idempotency_key
  );

  RETURN jsonb_build_object(
    'invoice_id', invoice_id_out,
    'invoice_number', invoice_no,
    'total_cents', approved_subtotal + approved_tax,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_issue_invoice(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_v2_issue_invoice(uuid, uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- apply_payment_event: idempotent by provider transaction id; allocates to
-- the invoice and recomputes balance/status in one transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workflow_v2_apply_payment_event(
  p_provider text,
  p_provider_transaction_id text,
  p_work_order_id uuid,
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_status text,
  p_received_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing payment;
  payment_id_out uuid;
  inv invoice;
  allocated bigint;
BEGIN
  IF p_status NOT IN (
    'pending', 'succeeded', 'failed', 'voided', 'partially_refunded', 'refunded'
  ) THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_STATUS';
  END IF;

  SELECT * INTO existing FROM payment
  WHERE provider = p_provider
    AND provider_transaction_id = p_provider_transaction_id;
  IF FOUND THEN
    RETURN jsonb_build_object('payment_id', existing.payment_id, 'replayed', true);
  END IF;

  SELECT * INTO inv FROM invoice WHERE invoice_id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;

  INSERT INTO payment (
    work_order_id, provider, provider_transaction_id,
    amount_cents, status, received_at
  ) VALUES (
    p_work_order_id, p_provider, p_provider_transaction_id,
    p_amount_cents, p_status, p_received_at
  )
  RETURNING payment_id INTO payment_id_out;

  IF p_status = 'succeeded' THEN
    INSERT INTO payment_allocation (payment_id, invoice_id, amount_cents)
    VALUES (payment_id_out, p_invoice_id, p_amount_cents);

    SELECT COALESCE(SUM(amount_cents), 0) INTO allocated
    FROM payment_allocation WHERE invoice_id = p_invoice_id;

    UPDATE invoice SET
      balance_cents = GREATEST(0, total_cents - allocated),
      status = CASE
        WHEN total_cents - allocated <= 0 THEN 'paid'
        ELSE 'partially_paid'
      END,
      paid_at = CASE WHEN total_cents - allocated <= 0 THEN now() ELSE paid_at END
    WHERE invoice_id = p_invoice_id;
  END IF;

  PERFORM public.workflow_v2_append_event(
    'payment', payment_id_out, p_work_order_id,
    'payment_' || p_status, 'webhook', NULL,
    NULL,
    jsonb_build_object(
      'provider', p_provider,
      'transaction_id', p_provider_transaction_id,
      'amount_cents', p_amount_cents,
      'invoice_id', p_invoice_id
    ),
    p_provider || ':' || p_provider_transaction_id || ':' || p_status
  );

  RETURN jsonb_build_object('payment_id', payment_id_out, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_apply_payment_event(
  text, text, uuid, uuid, bigint, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_v2_apply_payment_event(
  text, text, uuid, uuid, bigint, text, timestamptz
) TO service_role;
