-- Block checkout-category intake_photo INSERTs until every active job is
-- completed and QC is stamped. Raw PostgREST/RPC cannot pre-seed evidence.
-- Also cap emergency override reasons at 500 characters.

CREATE OR REPLACE FUNCTION public.enforce_checkout_photo_insert_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_qc_at timestamptz;
  v_qc_by uuid;
  v_incomplete integer;
  v_active integer;
BEGIN
  IF NEW.category NOT IN (
    'checkout_front',
    'checkout_rear',
    'checkout_left_side',
    'checkout_right_side',
    'checkout_odometer'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT wo.quality_checked_at, wo.quality_checked_by_user_id
  INTO v_qc_at, v_qc_by
  FROM public.work_order AS wo
  WHERE wo.work_order_id = NEW.work_order_id;

  IF v_qc_at IS NULL OR v_qc_by IS NULL THEN
    RAISE EXCEPTION 'CHECKOUT_EVIDENCE_NOT_READY';
  END IF;

  SELECT
    COUNT(*) FILTER (
      WHERE job.status NOT IN ('cancelled', 'declined')
        AND job.status IS DISTINCT FROM 'completed'
    ),
    COUNT(*) FILTER (
      WHERE job.status NOT IN ('cancelled', 'declined')
    )
  INTO v_incomplete, v_active
  FROM public.job AS job
  WHERE job.work_order_id = NEW.work_order_id;

  IF COALESCE(v_active, 0) = 0 OR COALESCE(v_incomplete, 0) > 0 THEN
    RAISE EXCEPTION 'CHECKOUT_EVIDENCE_NOT_READY';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS intake_photo_checkout_insert_ready ON public.intake_photo;

CREATE TRIGGER intake_photo_checkout_insert_ready
  BEFORE INSERT ON public.intake_photo
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_checkout_photo_insert_ready();

REVOKE ALL ON FUNCTION public.enforce_checkout_photo_insert_ready() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_checkout_photo_insert_ready() TO authenticated, service_role;

ALTER TABLE public.work_order
  DROP CONSTRAINT IF EXISTS work_order_checkout_evidence_override_reason_length;

ALTER TABLE public.work_order
  ADD CONSTRAINT work_order_checkout_evidence_override_reason_length
  CHECK (
    checkout_evidence_override_reason IS NULL
    OR char_length(checkout_evidence_override_reason) <= 500
  );
