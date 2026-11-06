-- A technician can leave the bike on the bench and start another assigned
-- bike. The current clock parks as swapped. Park accepts the earlier stops
-- again: parts, approval, tool, and other. Closed and post-bay visits stay
-- unworkable. Parts still do not have to arrive before the clock starts.

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
  same_bike boolean := false;
  bench_open boolean := false;
  has_attendance boolean;
  tool_blocked boolean;
  parked_job_id uuid := NULL;
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
  IF wo.status IN (
    'completed',
    'cancelled',
    'on_hold',
    'safety_check',
    'ready_for_pickup',
    'in_storage',
    'insurance'
  ) THEN
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

  SELECT EXISTS (
    SELECT 1 FROM time_clock_entry t
    WHERE t.user_id = actor.user_id AND t.clock_out_at IS NULL
  ) INTO has_attendance;
  IF NOT has_attendance AND actor.role IN ('technician', 'head_tech') THEN
    RAISE EXCEPTION 'NOT_CLOCKED_IN_FOR_JOB';
  END IF;

  SELECT j.* INTO bench
  FROM job_time_entry t
  JOIN job j ON j.job_id = t.job_id
  WHERE t.user_id = actor.user_id AND t.ended_at IS NULL
  FOR UPDATE OF j;

  IF FOUND THEN
    bench_open := true;
    IF bench.job_id = p_job_id THEN
      RETURN jsonb_build_object('job_id', p_job_id, 'replayed', true);
    END IF;
    same_bike := bench.work_order_id = target.work_order_id;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM job j
    JOIN job_blocker b ON b.job_id = j.job_id
    WHERE j.work_order_id = target.work_order_id
      AND b.kind = 'tool'
      AND b.cleared_at IS NULL
  ) INTO tool_blocked;

  IF tool_blocked OR target.status = 'waiting_for_approval' THEN
    RAISE EXCEPTION 'START_WAITING';
  END IF;

  IF target.status NOT IN (
    'approved', 'ready_to_start', 'in_progress', 'waiting_for_parts'
  ) THEN
    RAISE EXCEPTION 'JOB_NOT_PULLABLE';
  END IF;

  IF bench_open AND NOT same_bike THEN
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
    VALUES (
      bench.job_id,
      wo.location_id,
      'swapped',
      'technician',
      'Swapped for another bike',
      actor.user_id
    )
    ON CONFLICT DO NOTHING;
    parked_job_id := bench.job_id;
  ELSIF same_bike THEN
    UPDATE job_time_entry SET ended_at = now()
    WHERE user_id = actor.user_id AND ended_at IS NULL;

    UPDATE job SET
      status = 'ready_to_start',
      work_state = 'ready',
      updated_at = now()
    WHERE job_id = bench.job_id;
  END IF;

  UPDATE job SET
    status = 'in_progress',
    work_state = 'in_progress',
    assigned_technician_id = COALESCE(target.assigned_technician_id, actor.user_id),
    started_at = COALESCE(target.started_at, now()),
    floor_acknowledged_at = COALESCE(target.floor_acknowledged_at, now()),
    floor_acknowledged_by = COALESCE(target.floor_acknowledged_by, actor.user_id),
    floor_parked_at = NULL,
    floor_park_reason = NULL,
    floor_wait_owner = NULL,
    updated_at = now()
  WHERE job_id = p_job_id;

  -- Parts stay recorded. Starting the bike does not pretend they arrived.
  UPDATE job_blocker SET cleared_at = now(), cleared_by_user_id = actor.user_id
  WHERE job_id = p_job_id
    AND cleared_at IS NULL
    AND kind IN ('approval', 'swapped', 'tool', 'other');

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
  IF p_reason NOT IN ('parts', 'approval', 'tool', 'other') THEN
    RAISE EXCEPTION 'PARK_REASON_NOT_ALLOWED';
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
