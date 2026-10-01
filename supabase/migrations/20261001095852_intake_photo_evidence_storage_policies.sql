-- Tighten intake evidence DELETE to owner/manager + location, replace
-- broad intake-photos object policies, and drop authenticated object UPDATE.
-- Location-scoped SELECT/INSERT stay: intake_photo_select_location /
-- intake_photo_insert_location. No intake_photo UPDATE policy is added.

CREATE OR REPLACE FUNCTION public.intake_photo_object_in_user_locations(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN object_name IS NULL OR btrim(object_name) = '' THEN false
    WHEN split_part(object_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.work_order_in_user_locations(split_part(object_name, '/', 1)::uuid)
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.intake_photo_object_in_user_locations(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.intake_photo_object_in_user_locations(text) TO authenticated, service_role;

DROP POLICY IF EXISTS intake_photo_delete ON public.intake_photo;
DROP POLICY IF EXISTS intake_photo_delete_location ON public.intake_photo;
DROP POLICY IF EXISTS intake_photo_delete_owner_manager ON public.intake_photo;

CREATE POLICY intake_photo_delete_owner_manager ON public.intake_photo
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) = ANY (ARRAY['owner'::text, 'manager'::text])
    AND public.work_order_in_user_locations(work_order_id)
  );

UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
WHERE id = 'intake-photos';

DROP POLICY IF EXISTS intake_photos_select ON storage.objects;
DROP POLICY IF EXISTS intake_photos_insert ON storage.objects;
DROP POLICY IF EXISTS intake_photos_update ON storage.objects;
DROP POLICY IF EXISTS intake_photos_delete ON storage.objects;
DROP POLICY IF EXISTS intake_photos_select_location ON storage.objects;
DROP POLICY IF EXISTS intake_photos_insert_location ON storage.objects;
DROP POLICY IF EXISTS intake_photos_delete_owner_manager ON storage.objects;

CREATE POLICY intake_photos_select_location ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'intake-photos'
    AND (SELECT public.is_active_app_user())
    AND public.intake_photo_object_in_user_locations(name)
  );

CREATE POLICY intake_photos_insert_location ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'intake-photos'
    AND (SELECT public.is_active_app_user())
    AND public.intake_photo_object_in_user_locations(name)
  );

CREATE POLICY intake_photos_delete_owner_manager ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'intake-photos'
    AND (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) = ANY (ARRAY['owner'::text, 'manager'::text])
    AND public.intake_photo_object_in_user_locations(name)
  );
