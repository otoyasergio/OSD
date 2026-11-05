-- Technician floor queue.
-- A bike leaves the line only for a tool stop, or when nothing left can be worked.
-- Pull never writes a swapped park. Park accepts only tool and leaves the visit status.

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
  queue_user uuid;
  next_work_order uuid;
  same_bike boolean := false;
  has_attendance boolean;
  parts_blocked boolean;
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
    SELECT 1 FROM job_part_requirement r
    WHERE r.job_id = p_job_id
      AND r.state NOT IN ('received', 'allocated', 'installed', 'waived', 'cancelled')
  ) OR EXISTS (
    SELECT 1 FROM part p
    WHERE p.job_id = p_job_id
      AND p.status IN ('needed', 'ordered')
  ) INTO parts_blocked;

  SELECT EXISTS (
    SELECT 1
    FROM job j
    JOIN job_blocker b ON b.job_id = j.job_id
    WHERE j.work_order_id = target.work_order_id
      AND b.kind = 'tool'
      AND b.cleared_at IS NULL
  ) INTO tool_blocked;

  IF tool_blocked
    OR parts_blocked
    OR target.status IN ('waiting_for_approval', 'waiting_for_parts')
  THEN
    RAISE EXCEPTION 'START_WAITING';
  END IF;

  IF target.status NOT IN ('approved', 'ready_to_start', 'in_progress') THEN
    RAISE EXCEPTION 'JOB_NOT_PULLABLE';
  END IF;

  queue_user := COALESCE(target.assigned_technician_id, actor.user_id);

  IF NOT same_bike THEN
    SELECT bike.work_order_id INTO next_work_order
    FROM (
      SELECT j.work_order_id, MIN(j.docket_position) AS position
      FROM job j
      WHERE j.assigned_technician_id = queue_user
        AND j.status NOT IN ('completed', 'cancelled', 'declined', 'draft')
        AND NOT EXISTS (
          SELECT 1
          FROM job sibling
          JOIN job_blocker b ON b.job_id = sibling.job_id
          WHERE sibling.work_order_id = j.work_order_id
            AND b.kind = 'tool'
            AND b.cleared_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM job_time_entry t
          JOIN job running ON running.job_id = t.job_id
          WHERE t.user_id = actor.user_id
            AND t.ended_at IS NULL
            AND running.work_order_id = j.work_order_id
        )
        AND EXISTS (
          SELECT 1
          FROM job workable
          WHERE workable.work_order_id = j.work_order_id
            AND workable.assigned_technician_id = queue_user
            AND workable.status IN ('approved', 'ready_to_start', 'in_progress')
            AND NOT EXISTS (
              SELECT 1 FROM part p
              WHERE p.job_id = workable.job_id
                AND p.status IN ('needed', 'ordered')
            )
        )
      GROUP BY j.work_order_id
    ) bike
    ORDER BY bike.position NULLS LAST
    LIMIT 1;

    IF next_work_order IS NULL OR next_work_order <> target.work_order_id THEN
      RAISE EXCEPTION 'START_NOT_NEXT';
    END IF;
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

  UPDATE job_blocker SET cleared_at = now(), cleared_by_user_id = actor.user_id
  WHERE job_id = p_job_id
    AND cleared_at IS NULL
    AND kind IN ('approval', 'parts');

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
  IF p_reason IS DISTINCT FROM 'tool' THEN
    RAISE EXCEPTION 'PARK_REASON_NOT_ALLOWED';
  END IF;
  IF p_owner IS DISTINCT FROM 'technician' THEN
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
    floor_parked_at = now(),
    floor_park_reason = 'tool',
    floor_wait_owner = 'technician',
    updated_at = now()
  WHERE job_id = p_job_id;

  INSERT INTO job_blocker (job_id, location_id, kind, owner, reason, opened_by_user_id)
  VALUES (p_job_id, wo_location, 'tool', 'technician', p_note, actor.user_id)
  ON CONFLICT DO NOTHING;

  PERFORM public.workflow_v2_append_event(
    'job', p_job_id, target.work_order_id,
    'job_parked', 'staff', actor.user_id,
    jsonb_build_object('previous_status', target.status),
    jsonb_build_object('reason', 'tool', 'owner', 'technician', 'note', p_note),
    p_idempotency_key
  );

  RETURN jsonb_build_object('job_id', p_job_id, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_park_job(uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_v2_park_job(uuid, uuid, text, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.workflow_v2_clear_tool_wait(
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

  IF target.assigned_technician_id <> actor.user_id
    AND actor.role NOT IN ('owner', 'manager')
  THEN
    RAISE EXCEPTION 'JOB_ASSIGNED_TO_OTHER_TECH';
  END IF;

  IF target.floor_park_reason IS DISTINCT FROM 'tool' AND NOT EXISTS (
    SELECT 1 FROM job_blocker b
    WHERE b.job_id = p_job_id AND b.kind = 'tool' AND b.cleared_at IS NULL
  ) THEN
    RAISE EXCEPTION 'TOOL_WAIT_NOT_OPEN';
  END IF;

  UPDATE job SET
    status = CASE WHEN status = 'in_progress' THEN 'ready_to_start' ELSE status END,
    work_state = CASE WHEN status = 'in_progress' THEN 'ready' ELSE work_state END,
    floor_parked_at = NULL,
    floor_park_reason = NULL,
    floor_wait_owner = NULL,
    updated_at = now()
  WHERE job_id = p_job_id;

  UPDATE job_blocker SET cleared_at = now(), cleared_by_user_id = actor.user_id
  WHERE job_id = p_job_id AND kind = 'tool' AND cleared_at IS NULL;

  PERFORM public.workflow_v2_append_event(
    'job', p_job_id, target.work_order_id,
    'floor_wait_cleared', 'staff', actor.user_id,
    jsonb_build_object('reason', 'tool'),
    jsonb_build_object('reason', 'tool'),
    p_idempotency_key
  );

  RETURN jsonb_build_object('job_id', p_job_id, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_v2_clear_tool_wait(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_v2_clear_tool_wait(uuid, uuid, text)
  TO service_role;

-- Close leftover swap and other stops. Do not start any job clock.
UPDATE job_blocker
SET cleared_at = now()
WHERE cleared_at IS NULL
  AND kind IN ('swapped', 'other');

UPDATE job
SET
  floor_parked_at = NULL,
  floor_park_reason = NULL,
  floor_wait_owner = NULL,
  updated_at = now()
WHERE floor_park_reason IN ('swapped', 'other');
