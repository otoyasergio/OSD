-- Technician signature on inspection completion + storage bucket.

ALTER TABLE inspection
  ADD COLUMN IF NOT EXISTS technician_signature_storage_path text,
  ADD COLUMN IF NOT EXISTS technician_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS technician_signer_name text,
  ADD COLUMN IF NOT EXISTS technician_signed_by_user_id uuid REFERENCES app_user(user_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspection-signatures',
  'inspection-signatures',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS inspection_signatures_select ON storage.objects;
CREATE POLICY inspection_signatures_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'inspection-signatures'
    AND is_active_app_user()
  );

DROP POLICY IF EXISTS inspection_signatures_insert ON storage.objects;
CREATE POLICY inspection_signatures_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'inspection-signatures'
    AND is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin',
      'technician',
      'head_tech'
    )
  );
