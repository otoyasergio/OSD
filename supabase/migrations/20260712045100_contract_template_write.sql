-- Allow authenticated staff to publish new drop-off agreement template versions.

CREATE POLICY drop_off_agreement_template_insert ON drop_off_agreement_template
  FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY drop_off_agreement_template_update ON drop_off_agreement_template
  FOR UPDATE TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());
