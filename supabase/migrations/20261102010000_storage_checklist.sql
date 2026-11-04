-- Storage placement records how long the bike stays and the monthly rate after that date.

ALTER TABLE public.work_order
  ADD COLUMN IF NOT EXISTS storage_pickup_by date,
  ADD COLUMN IF NOT EXISTS storage_monthly_cents integer;

ALTER TABLE public.work_order
  DROP CONSTRAINT IF EXISTS work_order_storage_monthly_cents_check;

ALTER TABLE public.work_order
  ADD CONSTRAINT work_order_storage_monthly_cents_check
  CHECK (storage_monthly_cents IS NULL OR storage_monthly_cents >= 0);

COMMENT ON COLUMN public.work_order.storage_pickup_by IS
  'Toronto calendar date the included storage is up. Cleared when the bike leaves storage.';

COMMENT ON COLUMN public.work_order.storage_monthly_cents IS
  'Monthly storage charge in cents after storage_pickup_by. Zero is a real no-charge answer.';

-- Reopening for new recommendation work must drop the storage terms with the stamp.
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
    quality_check_waived = false,
    safety_checked_at = NULL,
    safety_checked_by_user_id = NULL,
    safety_check_notes = NULL,
    ready_for_pickup_at = NULL,
    stored_at = NULL,
    storage_pickup_by = NULL,
    storage_monthly_cents = NULL,
    checkout_evidence_override_at = NULL,
    checkout_evidence_override_by_user_id = NULL,
    checkout_evidence_override_reason = NULL,
    updated_at = now()
  WHERE work_order_id = p_work_order_id;

  RETURN FOUND;
END;
$$;
