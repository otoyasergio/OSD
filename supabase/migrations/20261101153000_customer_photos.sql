-- One private portrait per customer. Front office may read and replace it.
-- Technicians have no customer-table or bucket access, so they never receive the file.
-- Stored JPEG only; phone HEIC is canonicalized before upload.

ALTER TABLE public.customer
  ADD COLUMN IF NOT EXISTS photo_path text;

ALTER TABLE public.customer
  DROP CONSTRAINT IF EXISTS customer_photo_path_owned;

ALTER TABLE public.customer
  ADD CONSTRAINT customer_photo_path_owned CHECK (
    photo_path IS NULL
    OR (
      char_length(photo_path) <= 300
      AND position('..' in photo_path) = 0
      AND photo_path ~ (
        '^' || customer_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'
      )
    )
  );

COMMENT ON COLUMN public.customer.photo_path IS
  'Private staff portrait in the customer-photos bucket. Not synced to Wix or shown to customers.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'customer-photos',
  'customer-photos',
  false,
  5242880,
  ARRAY['image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS customer_photos_select ON storage.objects;
CREATE POLICY customer_photos_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'customer-photos'
    AND (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );

DROP POLICY IF EXISTS customer_photos_insert ON storage.objects;
CREATE POLICY customer_photos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'customer-photos'
    AND (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );

DROP POLICY IF EXISTS customer_photos_update ON storage.objects;
CREATE POLICY customer_photos_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'customer-photos'
    AND (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  )
  WITH CHECK (
    bucket_id = 'customer-photos'
    AND (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );

DROP POLICY IF EXISTS customer_photos_delete ON storage.objects;
CREATE POLICY customer_photos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'customer-photos'
    AND (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );
