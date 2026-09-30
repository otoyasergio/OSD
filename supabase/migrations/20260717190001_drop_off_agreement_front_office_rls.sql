-- Drop-off agreements: front office + admin only (floor techs must have no access).

DROP POLICY IF EXISTS drop_off_agreement_select ON drop_off_agreement;
CREATE POLICY drop_off_agreement_select ON drop_off_agreement
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
  );

DROP POLICY IF EXISTS drop_off_agreement_write ON drop_off_agreement;
CREATE POLICY drop_off_agreement_write ON drop_off_agreement
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
  );

DROP POLICY IF EXISTS drop_off_agreement_update ON drop_off_agreement;
CREATE POLICY drop_off_agreement_update ON drop_off_agreement
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
  )
  WITH CHECK (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
  );

-- Signature images in storage: same role gate.
DROP POLICY IF EXISTS contract_signatures_select ON storage.objects;
CREATE POLICY contract_signatures_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'contract-signatures'
    AND is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
  );

DROP POLICY IF EXISTS contract_signatures_insert ON storage.objects;
CREATE POLICY contract_signatures_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'contract-signatures'
    AND is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
  );
