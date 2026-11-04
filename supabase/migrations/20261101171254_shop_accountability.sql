-- Advisor of record, Ontario authorization snapshot, purchasing evidence,
-- final-check record, and handover. Legal parameters are append-only.

ALTER TABLE public.work_order
  ADD COLUMN IF NOT EXISTS advisor_user_id uuid REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS maximum_authorization_cents bigint,
  ADD COLUMN IF NOT EXISTS maximum_authorized_at timestamptz,
  ADD COLUMN IF NOT EXISTS maximum_authorized_by_user_id uuid REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estimate_declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS applied_legal_parameter_id uuid,
  ADD COLUMN IF NOT EXISTS keys_note text,
  ADD COLUMN IF NOT EXISTS accessories_note text,
  ADD COLUMN IF NOT EXISTS bike_spot text,
  ADD COLUMN IF NOT EXISTS authorized_approver_name text,
  ADD COLUMN IF NOT EXISTS authorized_collector_name text,
  ADD COLUMN IF NOT EXISTS declined_safety_ack_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_safety_ack_signer text,
  ADD COLUMN IF NOT EXISTS declined_safety_ack_items text;

ALTER TABLE public.work_order
  DROP CONSTRAINT IF EXISTS work_order_maximum_authorization_nonnegative;
ALTER TABLE public.work_order
  ADD CONSTRAINT work_order_maximum_authorization_nonnegative
  CHECK (maximum_authorization_cents IS NULL OR maximum_authorization_cents >= 0);

CREATE INDEX IF NOT EXISTS idx_work_order_advisor
  ON public.work_order (advisor_user_id)
  WHERE advisor_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.legal_parameter (
  legal_parameter_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_at timestamptz NOT NULL,
  source_citation text NOT NULL,
  ceiling_bps integer NOT NULL CHECK (ceiling_bps >= 0 AND ceiling_bps <= 10000),
  estimate_fee_rule text NOT NULL,
  warranty_summary text NOT NULL,
  warranty_exemptions text NOT NULL,
  created_by_user_id uuid REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.legal_parameter IS
  'Append-only repair-authorization rules. A later row does not change the rule copied onto an earlier estimate.';

INSERT INTO public.legal_parameter (
  legal_parameter_id,
  effective_at,
  source_citation,
  ceiling_bps,
  estimate_fee_rule,
  warranty_summary,
  warranty_exemptions
) VALUES (
  '00000000-0000-4000-8000-000000000c30',
  '2002-07-30T00:00:00Z',
  'Consumer Protection Act, 2002, S.O. 2002, c. 30, and the repair-shop guidance published by the Province of Ontario. The Consumer Protection Act, 2023 is not in force.',
  1000,
  'An estimate fee is charged only when it was disclosed before the estimate was prepared. When the customer proceeds with the repair, the fee is not added to the invoice.',
  'Most repairs carry a minimum statutory warranty. This sentence is the rule in force on the effective date.',
  'Fluids, filters, lights, tires, and batteries are regulatory exemptions.'
) ON CONFLICT (legal_parameter_id) DO NOTHING;

ALTER TABLE public.work_order
  DROP CONSTRAINT IF EXISTS work_order_applied_legal_parameter_fk;
ALTER TABLE public.work_order
  ADD CONSTRAINT work_order_applied_legal_parameter_fk
  FOREIGN KEY (applied_legal_parameter_id)
  REFERENCES public.legal_parameter(legal_parameter_id)
  ON DELETE RESTRICT;

ALTER TABLE public.estimate
  ADD COLUMN IF NOT EXISTS legal_parameter_id uuid REFERENCES public.legal_parameter(legal_parameter_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS estimate_fee_cents bigint,
  ADD COLUMN IF NOT EXISTS estimate_fee_disclosed_at timestamptz;

ALTER TABLE public.estimate
  DROP CONSTRAINT IF EXISTS estimate_fee_nonnegative;
ALTER TABLE public.estimate
  ADD CONSTRAINT estimate_fee_nonnegative
  CHECK (estimate_fee_cents IS NULL OR estimate_fee_cents >= 0);

ALTER TABLE public.estimate_version
  ADD COLUMN IF NOT EXISTS legal_parameter_id uuid REFERENCES public.legal_parameter(legal_parameter_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS ceiling_bps integer,
  ADD COLUMN IF NOT EXISTS warranty_snapshot text;

ALTER TABLE public.purchase_order
  ADD COLUMN IF NOT EXISTS supplier_invoice_number text,
  ADD COLUMN IF NOT EXISTS supplier_invoice_total_cents bigint,
  ADD COLUMN IF NOT EXISTS freight_cents bigint NOT NULL DEFAULT 0;

ALTER TABLE public.purchase_order
  DROP CONSTRAINT IF EXISTS purchase_order_freight_nonnegative;
ALTER TABLE public.purchase_order
  ADD CONSTRAINT purchase_order_freight_nonnegative
  CHECK (freight_cents >= 0);

ALTER TABLE public.purchase_order
  DROP CONSTRAINT IF EXISTS purchase_order_invoice_nonnegative;
ALTER TABLE public.purchase_order
  ADD CONSTRAINT purchase_order_invoice_nonnegative
  CHECK (supplier_invoice_total_cents IS NULL OR supplier_invoice_total_cents >= 0);

ALTER TABLE public.purchase_order_line
  ADD COLUMN IF NOT EXISTS quantity_returned numeric(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS core_deadline date,
  ADD COLUMN IF NOT EXISTS supplier_credit_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_recovered_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz;

ALTER TABLE public.purchase_order_line
  DROP CONSTRAINT IF EXISTS purchase_order_line_return_nonnegative;
ALTER TABLE public.purchase_order_line
  ADD CONSTRAINT purchase_order_line_return_nonnegative
  CHECK (quantity_returned >= 0 AND supplier_credit_cents >= 0);

ALTER TABLE public.job_part_requirement
  ADD COLUMN IF NOT EXISTS fitment_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS fitment_confirmed_by_user_id uuid REFERENCES public.app_user(user_id) ON DELETE SET NULL;

ALTER TABLE public.inspection_result
  ADD COLUMN IF NOT EXISTS measurement_unit text,
  ADD COLUMN IF NOT EXISTS measurement_source text,
  ADD COLUMN IF NOT EXISTS angle_after_torque boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS replace_fastener boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.final_check (
  final_check_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL UNIQUE REFERENCES public.work_order(work_order_id) ON DELETE CASCADE,
  technician_user_id uuid NOT NULL REFERENCES public.app_user(user_id) ON DELETE RESTRICT,
  verifier_user_id uuid NOT NULL REFERENCES public.app_user(user_id) ON DELETE RESTRICT,
  road_test_result text NOT NULL CHECK (road_test_result IN ('pass', 'fail', 'not_performed')),
  mileage_out numeric,
  mileage_unit text,
  leaks text,
  warning_lights text,
  unresolved_defects text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  CONSTRAINT final_check_distinct_accounts CHECK (technician_user_id <> verifier_user_id),
  CONSTRAINT final_check_mileage_nonnegative CHECK (mileage_out IS NULL OR mileage_out >= 0)
);

CREATE TABLE IF NOT EXISTS public.install_task (
  install_task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id uuid NOT NULL UNIQUE REFERENCES public.job_part_requirement(requirement_id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES public.work_order(work_order_id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.location(location_id) ON DELETE RESTRICT,
  assigned_technician_id uuid REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_install_task_open
  ON public.install_task (location_id, created_at DESC)
  WHERE completed_at IS NULL;

ALTER TABLE public.legal_parameter ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.final_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.install_task ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS legal_parameter_select ON public.legal_parameter;
CREATE POLICY legal_parameter_select ON public.legal_parameter
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS legal_parameter_insert ON public.legal_parameter;
CREATE POLICY legal_parameter_insert ON public.legal_parameter
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS final_check_select ON public.final_check;
CREATE POLICY final_check_select ON public.final_check
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND EXISTS (
      SELECT 1 FROM public.work_order wo
      WHERE wo.work_order_id = final_check.work_order_id
        AND wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS final_check_insert ON public.final_check;
CREATE POLICY final_check_insert ON public.final_check
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner', 'manager', 'service_advisor', 'head_tech', 'technician', 'admin'
    )
    AND EXISTS (
      SELECT 1 FROM public.work_order wo
      WHERE wo.work_order_id = final_check.work_order_id
        AND wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS final_check_update ON public.final_check;
CREATE POLICY final_check_update ON public.final_check
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner', 'manager', 'service_advisor', 'head_tech', 'technician', 'admin'
    )
    AND EXISTS (
      SELECT 1 FROM public.work_order wo
      WHERE wo.work_order_id = final_check.work_order_id
        AND wo.location_id IN (SELECT public.user_location_ids())
    )
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND EXISTS (
      SELECT 1 FROM public.work_order wo
      WHERE wo.work_order_id = final_check.work_order_id
        AND wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS install_task_select ON public.install_task;
CREATE POLICY install_task_select ON public.install_task
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
  );

DROP POLICY IF EXISTS install_task_insert ON public.install_task;
CREATE POLICY install_task_insert ON public.install_task
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN ('owner', 'manager', 'service_advisor', 'admin')
    AND location_id IN (SELECT public.user_location_ids())
  );

DROP POLICY IF EXISTS install_task_update ON public.install_task;
CREATE POLICY install_task_update ON public.install_task
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
  );

DROP POLICY IF EXISTS purchase_order_insert ON public.purchase_order;
CREATE POLICY purchase_order_insert ON public.purchase_order
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN ('owner', 'manager', 'service_advisor', 'admin')
    AND location_id IN (SELECT public.user_location_ids())
  );

DROP POLICY IF EXISTS purchase_order_update ON public.purchase_order;
CREATE POLICY purchase_order_update ON public.purchase_order
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN ('owner', 'manager', 'service_advisor', 'admin')
    AND location_id IN (SELECT public.user_location_ids())
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
  );

DROP POLICY IF EXISTS purchase_order_line_insert ON public.purchase_order_line;
CREATE POLICY purchase_order_line_insert ON public.purchase_order_line
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN ('owner', 'manager', 'service_advisor', 'admin')
    AND EXISTS (
      SELECT 1 FROM public.purchase_order po
      WHERE po.purchase_order_id = purchase_order_line.purchase_order_id
        AND po.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS purchase_order_line_update ON public.purchase_order_line;
CREATE POLICY purchase_order_line_update ON public.purchase_order_line
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN ('owner', 'manager', 'service_advisor', 'admin')
    AND EXISTS (
      SELECT 1 FROM public.purchase_order po
      WHERE po.purchase_order_id = purchase_order_line.purchase_order_id
        AND po.location_id IN (SELECT public.user_location_ids())
    )
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND EXISTS (
      SELECT 1 FROM public.purchase_order po
      WHERE po.purchase_order_id = purchase_order_line.purchase_order_id
        AND po.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS part_receipt_insert ON public.part_receipt;
CREATE POLICY part_receipt_insert ON public.part_receipt
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN ('owner', 'manager', 'service_advisor', 'admin')
  );

DROP POLICY IF EXISTS job_part_requirement_insert ON public.job_part_requirement;
CREATE POLICY job_part_requirement_insert ON public.job_part_requirement
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN ('owner', 'manager', 'service_advisor', 'admin')
    AND EXISTS (
      SELECT 1
      FROM public.job j
      JOIN public.work_order wo ON wo.work_order_id = j.work_order_id
      WHERE j.job_id = job_part_requirement.job_id
        AND wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS job_part_requirement_update ON public.job_part_requirement;
CREATE POLICY job_part_requirement_update ON public.job_part_requirement
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN ('owner', 'manager', 'service_advisor', 'admin')
    AND EXISTS (
      SELECT 1
      FROM public.job j
      JOIN public.work_order wo ON wo.work_order_id = j.work_order_id
      WHERE j.job_id = job_part_requirement.job_id
        AND wo.location_id IN (SELECT public.user_location_ids())
    )
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND EXISTS (
      SELECT 1
      FROM public.job j
      JOIN public.work_order wo ON wo.work_order_id = j.work_order_id
      WHERE j.job_id = job_part_requirement.job_id
        AND wo.location_id IN (SELECT public.user_location_ids())
    )
  );

GRANT SELECT, INSERT ON TABLE public.legal_parameter TO authenticated;
GRANT ALL ON TABLE public.legal_parameter TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.final_check TO authenticated;
GRANT ALL ON TABLE public.final_check TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.install_task TO authenticated;
GRANT ALL ON TABLE public.install_task TO service_role;

REVOKE ALL ON TABLE public.legal_parameter FROM anon;
REVOKE ALL ON TABLE public.final_check FROM anon;
REVOKE ALL ON TABLE public.install_task FROM anon;

-- Accountability columns on work_order are authorization evidence. A session
-- with a user JWT may change them only from a front-office role; server-side
-- service-role writes carry no JWT and are already trusted. A recorded maximum
-- is always attributed to the session that recorded it.
CREATE OR REPLACE FUNCTION public.work_order_accountability_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_changing boolean;
  v_maximum_changing boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_maximum_changing :=
      NEW.maximum_authorization_cents IS DISTINCT FROM OLD.maximum_authorization_cents;
    v_changing :=
      v_maximum_changing
      OR NEW.advisor_user_id IS DISTINCT FROM OLD.advisor_user_id
      OR NEW.maximum_authorized_at IS DISTINCT FROM OLD.maximum_authorized_at
      OR NEW.maximum_authorized_by_user_id IS DISTINCT FROM OLD.maximum_authorized_by_user_id
      OR NEW.estimate_declined_at IS DISTINCT FROM OLD.estimate_declined_at
      OR NEW.applied_legal_parameter_id IS DISTINCT FROM OLD.applied_legal_parameter_id
      OR NEW.declined_safety_ack_at IS DISTINCT FROM OLD.declined_safety_ack_at
      OR NEW.declined_safety_ack_signer IS DISTINCT FROM OLD.declined_safety_ack_signer
      OR NEW.declined_safety_ack_items IS DISTINCT FROM OLD.declined_safety_ack_items;
  ELSE
    v_maximum_changing := NEW.maximum_authorization_cents IS NOT NULL;
    v_changing :=
      v_maximum_changing
      OR NEW.advisor_user_id IS NOT NULL
      OR NEW.maximum_authorized_at IS NOT NULL
      OR NEW.maximum_authorized_by_user_id IS NOT NULL
      OR NEW.estimate_declined_at IS NOT NULL
      OR NEW.applied_legal_parameter_id IS NOT NULL
      OR NEW.declined_safety_ack_at IS NOT NULL
      OR NEW.declined_safety_ack_signer IS NOT NULL
      OR NEW.declined_safety_ack_items IS NOT NULL;
  END IF;

  IF NOT v_changing THEN
    RETURN NEW;
  END IF;

  v_role := public.current_app_user_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'service_advisor', 'admin') THEN
    RAISE EXCEPTION 'ACCOUNTABILITY_WRITE_FORBIDDEN';
  END IF;

  IF v_maximum_changing AND NEW.maximum_authorization_cents IS NOT NULL THEN
    NEW.maximum_authorized_by_user_id := public.current_app_user_id();
    NEW.maximum_authorized_at := now();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.work_order_accountability_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS work_order_accountability_guard ON public.work_order;
CREATE TRIGGER work_order_accountability_guard
  BEFORE INSERT OR UPDATE ON public.work_order
  FOR EACH ROW
  EXECUTE FUNCTION public.work_order_accountability_guard();

-- Receiving evidence stays inside the receiver's locations.
DROP POLICY IF EXISTS part_receipt_select ON public.part_receipt;
CREATE POLICY part_receipt_select ON public.part_receipt
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN ('owner', 'manager', 'service_advisor', 'admin')
    AND EXISTS (
      SELECT 1
      FROM public.purchase_order_line pol
      JOIN public.purchase_order po ON po.purchase_order_id = pol.purchase_order_id
      WHERE pol.po_line_id = part_receipt.po_line_id
        AND po.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS part_receipt_insert ON public.part_receipt;
CREATE POLICY part_receipt_insert ON public.part_receipt
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN ('owner', 'manager', 'service_advisor', 'admin')
    AND (
      received_by_user_id IS NULL
      OR received_by_user_id = (SELECT public.current_app_user_id())
    )
    AND EXISTS (
      SELECT 1
      FROM public.purchase_order_line pol
      JOIN public.purchase_order po ON po.purchase_order_id = pol.purchase_order_id
      WHERE pol.po_line_id = part_receipt.po_line_id
        AND po.location_id IN (SELECT public.user_location_ids())
    )
  );

-- Whether a person clocked labour on any job of a visit. SECURITY DEFINER so
-- the final-check policy sees every entry, not only the rows the caller may read.
CREATE OR REPLACE FUNCTION public.user_clocked_work_order(p_user_id uuid, p_work_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.job_time_entry jte
    JOIN public.job j ON j.job_id = jte.job_id
    WHERE jte.user_id = p_user_id
      AND j.work_order_id = p_work_order_id
  );
$$;

REVOKE ALL ON FUNCTION public.user_clocked_work_order(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_clocked_work_order(uuid, uuid) TO authenticated, service_role;

-- The final check is a two-person record. The session that writes it is the
-- recorder, is never the technician, and is the verifier unless it belongs to
-- the front office. The verifier never clocked the visit.
DROP POLICY IF EXISTS final_check_insert ON public.final_check;
CREATE POLICY final_check_insert ON public.final_check
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner', 'manager', 'service_advisor', 'head_tech', 'technician', 'admin'
    )
    AND recorded_by_user_id = (SELECT public.current_app_user_id())
    AND technician_user_id <> (SELECT public.current_app_user_id())
    AND technician_user_id <> verifier_user_id
    AND (
      (SELECT public.current_app_user_role()) IN ('owner', 'manager', 'service_advisor', 'admin')
      OR verifier_user_id = (SELECT public.current_app_user_id())
    )
    AND NOT public.user_clocked_work_order(verifier_user_id, work_order_id)
    AND EXISTS (
      SELECT 1 FROM public.work_order wo
      WHERE wo.work_order_id = final_check.work_order_id
        AND wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS final_check_update ON public.final_check;
CREATE POLICY final_check_update ON public.final_check
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner', 'manager', 'service_advisor', 'head_tech', 'technician', 'admin'
    )
    AND EXISTS (
      SELECT 1 FROM public.work_order wo
      WHERE wo.work_order_id = final_check.work_order_id
        AND wo.location_id IN (SELECT public.user_location_ids())
    )
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND recorded_by_user_id = (SELECT public.current_app_user_id())
    AND technician_user_id <> (SELECT public.current_app_user_id())
    AND technician_user_id <> verifier_user_id
    AND (
      (SELECT public.current_app_user_role()) IN ('owner', 'manager', 'service_advisor', 'admin')
      OR verifier_user_id = (SELECT public.current_app_user_id())
    )
    AND NOT public.user_clocked_work_order(verifier_user_id, work_order_id)
    AND EXISTS (
      SELECT 1 FROM public.work_order wo
      WHERE wo.work_order_id = final_check.work_order_id
        AND wo.location_id IN (SELECT public.user_location_ids())
    )
  );
