-- Restrict signed drop-off agreement content to front office (+ admin).
-- Floor techs must not read signatures / initials / storage paths.
-- Existence checks for workflow gates use work_order_has_drop_off_agreement().

CREATE OR REPLACE FUNCTION public.work_order_has_drop_off_agreement(p_work_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.drop_off_agreement
    WHERE work_order_id = p_work_order_id
  );
$$;

REVOKE ALL ON FUNCTION public.work_order_has_drop_off_agreement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_order_has_drop_off_agreement(uuid) TO authenticated;

DROP POLICY IF EXISTS drop_off_agreement_select ON drop_off_agreement;
CREATE POLICY drop_off_agreement_select ON drop_off_agreement
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );

-- Insert remains for roles that can sign in the app (front office + admin create path).
DROP POLICY IF EXISTS drop_off_agreement_insert ON drop_off_agreement;
CREATE POLICY drop_off_agreement_insert ON drop_off_agreement
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );

DROP POLICY IF EXISTS contract_signatures_select ON storage.objects;
CREATE POLICY contract_signatures_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'contract-signatures'
    AND is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );

DROP POLICY IF EXISTS contract_signatures_insert ON storage.objects;
CREATE POLICY contract_signatures_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'contract-signatures'
    AND is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );
