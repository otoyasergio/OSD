-- Self-service profile photos for every active staff account.
-- The bucket is private: active staff may view photos, while only the owner of
-- a user-id folder may write or remove objects in that folder.

ALTER TABLE public.app_user
  ADD COLUMN IF NOT EXISTS profile_photo_path text;

ALTER TABLE public.app_user
  DROP CONSTRAINT IF EXISTS app_user_profile_photo_path_owned;

ALTER TABLE public.app_user
  ADD CONSTRAINT app_user_profile_photo_path_owned CHECK (
    profile_photo_path IS NULL
    OR (
      split_part(profile_photo_path, '/', 1) = user_id::text
      AND char_length(profile_photo_path) <= 300
      AND position('..' in profile_photo_path) = 0
    )
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-photos',
  'profile-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS profile_photos_select ON storage.objects;
CREATE POLICY profile_photos_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND public.is_active_app_user()
  );

DROP POLICY IF EXISTS profile_photos_insert ON storage.objects;
CREATE POLICY profile_photos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND public.is_active_app_user()
    AND (storage.foldername(name))[1] = public.current_app_user_id()::text
  );

DROP POLICY IF EXISTS profile_photos_update ON storage.objects;
CREATE POLICY profile_photos_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND public.is_active_app_user()
    AND (storage.foldername(name))[1] = public.current_app_user_id()::text
  )
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND public.is_active_app_user()
    AND (storage.foldername(name))[1] = public.current_app_user_id()::text
  );

DROP POLICY IF EXISTS profile_photos_delete ON storage.objects;
CREATE POLICY profile_photos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND public.is_active_app_user()
    AND (storage.foldername(name))[1] = public.current_app_user_id()::text
  );

-- A narrow RPC avoids granting self-service UPDATE access to every app_user
-- column (which would let a client change its own role or status).
CREATE OR REPLACE FUNCTION public.set_own_profile_photo_path(p_storage_path text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT u.user_id
  INTO v_user_id
  FROM public.app_user AS u
  WHERE u.auth_user_id = auth.uid()
    AND u.status = 'active'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_storage_path IS NOT NULL AND (
    char_length(p_storage_path) > 300
    OR position('..' in p_storage_path) > 0
    OR p_storage_path !~ (
      '^' || v_user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$'
    )
  ) THEN
    RAISE EXCEPTION 'INVALID_PROFILE_PHOTO_PATH';
  END IF;

  UPDATE public.app_user
  SET profile_photo_path = p_storage_path,
      updated_at = now()
  WHERE user_id = v_user_id;

  RETURN p_storage_path;
END;
$$;

REVOKE ALL ON FUNCTION public.set_own_profile_photo_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_own_profile_photo_path(text)
  TO authenticated, service_role;
