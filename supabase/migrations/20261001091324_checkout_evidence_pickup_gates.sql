-- Five-photo checkout handoff gate. Existing rows stay
-- checkout_evidence_required=false so historical work orders are not blocked.

ALTER TABLE public.intake_photo
  DROP CONSTRAINT IF EXISTS intake_photo_category_check;

ALTER TABLE public.intake_photo
  ADD CONSTRAINT intake_photo_category_check CHECK (category IN (
    'front',
    'rear',
    'left_side',
    'right_side',
    'odometer',
    'vin',
    'damage',
    'accessories',
    'fuel_level',
    'other',
    'inspection_tires',
    'inspection_brakes',
    'inspection_forks',
    'inspection_item',
    'job_proof',
    'job_work',
    'checkout_front',
    'checkout_rear',
    'checkout_left_side',
    'checkout_right_side',
    'checkout_odometer'
  ));

ALTER TABLE public.work_order
  ADD COLUMN IF NOT EXISTS checkout_evidence_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checkout_evidence_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_evidence_override_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checkout_evidence_override_reason text;

ALTER TABLE public.work_order
  DROP CONSTRAINT IF EXISTS work_order_checkout_evidence_override_all_or_nothing;

ALTER TABLE public.work_order
  ADD CONSTRAINT work_order_checkout_evidence_override_all_or_nothing CHECK (
    (
      checkout_evidence_override_at IS NULL
      AND checkout_evidence_override_by_user_id IS NULL
      AND checkout_evidence_override_reason IS NULL
    )
    OR (
      checkout_evidence_override_at IS NOT NULL
      AND checkout_evidence_override_by_user_id IS NOT NULL
      AND checkout_evidence_override_reason IS NOT NULL
      AND btrim(checkout_evidence_override_reason) <> ''
    )
  );

CREATE INDEX IF NOT EXISTS intake_photo_checkout_categories_idx
  ON public.intake_photo (work_order_id, category)
  WHERE category IN (
    'checkout_front',
    'checkout_rear',
    'checkout_left_side',
    'checkout_right_side',
    'checkout_odometer'
  );

CREATE INDEX IF NOT EXISTS work_order_checkout_evidence_override_by_user_id_idx
  ON public.work_order (checkout_evidence_override_by_user_id)
  WHERE checkout_evidence_override_by_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_work_order_checkout_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_role text;
  v_override_changing boolean;
  v_clearing boolean;
  v_covered integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_override_changing :=
      NEW.checkout_evidence_override_at IS DISTINCT FROM OLD.checkout_evidence_override_at
      OR NEW.checkout_evidence_override_by_user_id IS DISTINCT FROM OLD.checkout_evidence_override_by_user_id
      OR NEW.checkout_evidence_override_reason IS DISTINCT FROM OLD.checkout_evidence_override_reason;
  ELSE
    v_override_changing :=
      NEW.checkout_evidence_override_at IS NOT NULL
      OR NEW.checkout_evidence_override_by_user_id IS NOT NULL
      OR NEW.checkout_evidence_override_reason IS NOT NULL;
  END IF;

  IF v_override_changing THEN
    v_clearing :=
      NEW.checkout_evidence_override_at IS NULL
      AND NEW.checkout_evidence_override_by_user_id IS NULL
      AND (
        NEW.checkout_evidence_override_reason IS NULL
        OR btrim(NEW.checkout_evidence_override_reason) = ''
      );

    IF v_clearing THEN
      NEW.checkout_evidence_override_at := NULL;
      NEW.checkout_evidence_override_by_user_id := NULL;
      NEW.checkout_evidence_override_reason := NULL;
    ELSE
      v_role := public.current_app_user_role();
      v_actor := public.current_app_user_id();
      IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'CHECKOUT_EVIDENCE_OVERRIDE_FORBIDDEN';
      END IF;
      IF NEW.checkout_evidence_override_reason IS NULL
         OR btrim(NEW.checkout_evidence_override_reason) = '' THEN
        RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED';
      END IF;
      NEW.checkout_evidence_override_reason := btrim(NEW.checkout_evidence_override_reason);
      NEW.checkout_evidence_override_by_user_id := v_actor;
      NEW.checkout_evidence_override_at := now();
    END IF;
  END IF;

  IF NEW.checkout_evidence_required
     AND NEW.status IN ('ready_for_pickup', 'completed')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    IF NEW.checkout_evidence_override_at IS NULL THEN
      SELECT COUNT(DISTINCT category)
      INTO v_covered
      FROM public.intake_photo
      WHERE work_order_id = NEW.work_order_id
        AND category IN (
          'checkout_front',
          'checkout_rear',
          'checkout_left_side',
          'checkout_right_side',
          'checkout_odometer'
        );
      IF COALESCE(v_covered, 0) < 5 THEN
        RAISE EXCEPTION 'CHECKOUT_EVIDENCE_REQUIRED';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_order_checkout_evidence_guard ON public.work_order;

CREATE TRIGGER work_order_checkout_evidence_guard
  BEFORE INSERT OR UPDATE ON public.work_order
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_work_order_checkout_evidence();

REVOKE ALL ON FUNCTION public.enforce_work_order_checkout_evidence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_work_order_checkout_evidence() TO authenticated, service_role;
