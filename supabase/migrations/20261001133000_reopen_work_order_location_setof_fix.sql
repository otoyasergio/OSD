-- user_location_ids() returns SETOF uuid, not uuid[].
-- The original reopen RPC used `= ANY (...)`, which raises Postgres 42809
-- as soon as recommendation reopen is invoked. Remotes that already applied
-- 20261001093658 need this CREATE OR REPLACE; fresh applies get the corrected
-- body from that file and this migration is a no-op replace.

CREATE OR REPLACE FUNCTION public.reopen_work_order_for_recommendation_work(
  p_work_order_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_role text;
  v_location uuid;
  v_has_job boolean;
BEGIN
  v_actor := public.current_app_user_id();
  v_role := public.current_app_user_role();
  IF v_actor IS NULL
     OR v_role IS NULL
     OR v_role NOT IN ('owner', 'manager', 'service_advisor') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT location_id
  INTO v_location
  FROM public.work_order
  WHERE work_order_id = p_work_order_id;

  IF v_location IS NULL THEN
    RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND';
  END IF;

  IF NOT (v_location IN (SELECT public.user_location_ids())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.job
    WHERE work_order_id = p_work_order_id
      AND origin = 'recommendation'
      AND status IN ('approved', 'ready_to_start')
      AND created_at > now() - interval '15 minutes'
  ) INTO v_has_job;

  IF NOT v_has_job THEN
    RAISE EXCEPTION 'REOPEN_REQUIRES_RECOMMENDATION_JOB';
  END IF;

  PERFORM set_config('app.checkout_reopen', '1', true);

  UPDATE public.work_order
  SET
    quality_checked_at = NULL,
    quality_checked_by_user_id = NULL,
    quality_check_notes = NULL,
    quality_check_assigned_to = NULL,
    safety_checked_at = NULL,
    safety_checked_by_user_id = NULL,
    safety_check_notes = NULL,
    ready_for_pickup_at = NULL,
    checkout_evidence_override_at = NULL,
    checkout_evidence_override_by_user_id = NULL,
    checkout_evidence_override_reason = NULL,
    updated_at = now()
  WHERE work_order_id = p_work_order_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_work_order_for_recommendation_work(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_work_order_for_recommendation_work(uuid)
  TO authenticated;
