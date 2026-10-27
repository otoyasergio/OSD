-- Finished bikes can sit in the building after work is done.
-- in_storage is operational (the card stays draggable). It is not picked up.

ALTER TABLE public.work_order
  DROP CONSTRAINT IF EXISTS work_order_status_check;

ALTER TABLE public.work_order
  ADD CONSTRAINT work_order_status_check CHECK (status IN (
    'draft',
    'open',
    'inspection_in_progress',
    'waiting_for_customer_approval',
    'waiting_for_parts',
    'ready_for_technician',
    'in_progress',
    'quality_check',
    'safety_check',
    'ready_for_pickup',
    'in_storage',
    'completed',
    'cancelled',
    'on_hold'
  ));

ALTER TABLE public.work_order
  ADD COLUMN IF NOT EXISTS stored_at timestamptz;

COMMENT ON COLUMN public.work_order.stored_at IS
  'When the bike was placed into storage. Cleared when the card leaves storage.';

CREATE INDEX IF NOT EXISTS idx_work_order_in_storage
  ON public.work_order (location_id, stored_at)
  WHERE status = 'in_storage';

-- New recommendation work reopens the visit. Clear the storage stamp too so
-- the bike does not keep a storage timer after it returns to the floor.
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
    checkout_evidence_override_at = NULL,
    checkout_evidence_override_by_user_id = NULL,
    checkout_evidence_override_reason = NULL,
    updated_at = now()
  WHERE work_order_id = p_work_order_id;

  RETURN FOUND;
END;
$$;
