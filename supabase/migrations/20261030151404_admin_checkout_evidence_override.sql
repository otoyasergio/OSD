-- Admin may record a checkout-evidence override, same as owner and manager,
-- so a Control Center move onto Ready or Complete is not rejected.

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
  v_reopen boolean;
  v_required boolean;
  v_covered integer;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.checkout_evidence_required IS DISTINCT FROM OLD.checkout_evidence_required THEN
    RAISE EXCEPTION 'CHECKOUT_EVIDENCE_REQUIRED_IMMUTABLE';
  END IF;

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
      v_role := public.current_app_user_role();
      v_reopen := coalesce(current_setting('app.checkout_reopen', true), '') = '1';
      IF NOT v_reopen AND (v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'admin')) THEN
        RAISE EXCEPTION 'CHECKOUT_EVIDENCE_OVERRIDE_FORBIDDEN';
      END IF;
      NEW.checkout_evidence_override_at := NULL;
      NEW.checkout_evidence_override_by_user_id := NULL;
      NEW.checkout_evidence_override_reason := NULL;
    ELSE
      v_role := public.current_app_user_role();
      v_actor := public.current_app_user_id();
      IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'admin') THEN
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

  v_required := NEW.checkout_evidence_required;
  IF TG_OP = 'UPDATE' THEN
    v_required := OLD.checkout_evidence_required OR NEW.checkout_evidence_required;
  END IF;

  IF v_required
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
