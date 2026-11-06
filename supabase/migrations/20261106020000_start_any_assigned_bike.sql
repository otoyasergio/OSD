-- Docket order is the display order. A technician can start any bike
-- assigned to them when their bench is empty. One running clock remains.

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
  has_attendance boolean;
  tool_blocked boolean;
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
    IF bench.job_id = p_job_id THEN
      RETURN jsonb_build_object('job_id', p_job_id, 'replayed', true);
    END IF;
    IF bench.work_order_id <> target.work_order_id THEN
      RAISE EXCEPTION 'START_BENCH_OCCUPIED';
    END IF;
    same_bike := true;
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

  IF same_bike THEN
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
    AND kind = 'approval';

  INSERT INTO job_time_entry (job_id, user_id, location_id)
  VALUES (p_job_id, actor.user_id, wo.location_id);

  PERFORM public.workflow_v2_append_event(
    'job', p_job_id, target.work_order_id,
    'job_pulled_onto_bench', 'staff', actor.user_id,
    jsonb_build_object('previous_status', target.status),
    jsonb_build_object('parked_job_id', NULL),
    p_idempotency_key
  );

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'parked_job_id', NULL,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_pull_job_onto_bench(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_v2_pull_job_onto_bench(uuid, uuid, text)
  TO service_role;
