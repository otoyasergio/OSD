-- Allow authenticated app users to delete intake_photo rows.
-- App-layer canDeleteIntakePhoto still restricts to owner/manager.
CREATE POLICY intake_photo_delete ON intake_photo
  FOR DELETE TO authenticated
  USING (is_active_app_user());
