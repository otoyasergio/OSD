-- RLS helpers: resolve current app_user from Supabase Auth session.
-- Authorization truth remains in lib/permissions (server actions); RLS is defense in depth.

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id FROM app_user
  WHERE auth_user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_app_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM app_user
  WHERE auth_user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_active_app_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_app_user_id() IS NOT NULL;
$$;

-- Enable RLS on all application tables
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer ENABLE ROW LEVEL SECURITY;
ALTER TABLE motorcycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE motorcycle_service_information ENABLE ROW LEVEL SECURITY;
ALTER TABLE service ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_technician ENABLE ROW LEVEL SECURITY;
ALTER TABLE job ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_template_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation ENABLE ROW LEVEL SECURITY;
ALTER TABLE part ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_photo ENABLE ROW LEVEL SECURITY;
ALTER TABLE technician_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE location ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_location ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Operational tables: active authenticated app users may read
CREATE POLICY app_user_select ON app_user FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY customer_select ON customer FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY motorcycle_select ON motorcycle FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY motorcycle_service_information_select ON motorcycle_service_information FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY service_select ON service FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY work_order_select ON work_order FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY work_order_technician_select ON work_order_technician FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY job_select ON job FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY inspection_select ON inspection FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY inspection_template_item_select ON inspection_template_item FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY inspection_result_select ON inspection_result FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY recommendation_select ON recommendation FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY part_select ON part FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY intake_photo_select ON intake_photo FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY technician_note_select ON technician_note FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY timeline_event_select ON timeline_event FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY location_select ON location FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY user_location_select ON user_location FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY work_order_sequence_select ON work_order_sequence FOR SELECT TO authenticated
  USING (is_active_app_user());

-- Operational tables: active authenticated app users may insert/update
CREATE POLICY customer_write ON customer FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY customer_update ON customer FOR UPDATE TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

CREATE POLICY motorcycle_write ON motorcycle FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY motorcycle_update ON motorcycle FOR UPDATE TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

CREATE POLICY motorcycle_service_information_write ON motorcycle_service_information FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY motorcycle_service_information_update ON motorcycle_service_information FOR UPDATE TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

CREATE POLICY service_write ON service FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY service_update ON service FOR UPDATE TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

CREATE POLICY work_order_write ON work_order FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY work_order_update ON work_order FOR UPDATE TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

CREATE POLICY work_order_technician_write ON work_order_technician FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY job_write ON job FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY job_update ON job FOR UPDATE TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

CREATE POLICY inspection_write ON inspection FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY inspection_update ON inspection FOR UPDATE TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

CREATE POLICY inspection_template_item_write ON inspection_template_item FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY inspection_template_item_update ON inspection_template_item FOR UPDATE TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

CREATE POLICY inspection_result_write ON inspection_result FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY inspection_result_update ON inspection_result FOR UPDATE TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

CREATE POLICY recommendation_write ON recommendation FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY recommendation_update ON recommendation FOR UPDATE TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

CREATE POLICY part_write ON part FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY part_update ON part FOR UPDATE TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

CREATE POLICY intake_photo_write ON intake_photo FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY technician_note_write ON technician_note FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY timeline_event_write ON timeline_event FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY location_write ON location FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY location_update ON location FOR UPDATE TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

CREATE POLICY user_location_write ON user_location FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY user_location_delete ON user_location FOR DELETE TO authenticated
  USING (is_active_app_user());

CREATE POLICY work_order_sequence_write ON work_order_sequence FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY work_order_sequence_update ON work_order_sequence FOR UPDATE TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

-- audit_log: owner-only SELECT; all active users may INSERT (server writes on every mutation)
CREATE POLICY audit_log_select_owner ON audit_log FOR SELECT TO authenticated
  USING (current_app_user_role() = 'owner');

CREATE POLICY audit_log_insert ON audit_log FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

-- Storage bucket for intake photos (private; authenticated read/write under work_order_id paths)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'intake-photos',
  'intake-photos',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY intake_photos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'intake-photos' AND is_active_app_user());

CREATE POLICY intake_photos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'intake-photos' AND is_active_app_user());

CREATE POLICY intake_photos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'intake-photos' AND is_active_app_user())
  WITH CHECK (bucket_id = 'intake-photos' AND is_active_app_user());

CREATE POLICY intake_photos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'intake-photos' AND is_active_app_user());
