-- Time clock kiosk role, staff PIN hashes, punch/break photos.

ALTER TABLE app_user
  DROP CONSTRAINT IF EXISTS app_user_role_check;

ALTER TABLE app_user
  ADD CONSTRAINT app_user_role_check CHECK (role IN (
    'owner',
    'manager',
    'service_advisor',
    'technician',
    'head_tech',
    'admin',
    'time_clock_kiosk'
  ));

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS time_clock_pin_hash text,
  ADD COLUMN IF NOT EXISTS time_clock_pin_updated_at timestamptz;

ALTER TABLE time_clock_entry
  ADD COLUMN IF NOT EXISTS clock_in_photo_path text,
  ADD COLUMN IF NOT EXISTS clock_out_photo_path text;

ALTER TABLE time_clock_break
  ADD COLUMN IF NOT EXISTS break_start_photo_path text,
  ADD COLUMN IF NOT EXISTS break_end_photo_path text;

CREATE INDEX IF NOT EXISTS idx_app_user_time_clock_pin_hash
  ON app_user (time_clock_pin_hash)
  WHERE time_clock_pin_hash IS NOT NULL AND status = 'active';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'time-clock-photos',
  'time-clock-photos',
  false,
  3145728,
  ARRAY['image/jpeg', 'image/webp', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS time_clock_photos_select ON storage.objects;
CREATE POLICY time_clock_photos_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'time-clock-photos'
    AND is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'time_clock_kiosk')
  );

DROP POLICY IF EXISTS time_clock_photos_insert ON storage.objects;
CREATE POLICY time_clock_photos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'time-clock-photos'
    AND is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'time_clock_kiosk')
  );

DROP POLICY IF EXISTS time_clock_photos_update ON storage.objects;
CREATE POLICY time_clock_photos_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'time-clock-photos'
    AND is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  )
  WITH CHECK (
    bucket_id = 'time-clock-photos'
    AND is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS time_clock_photos_delete ON storage.objects;
CREATE POLICY time_clock_photos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'time-clock-photos'
    AND is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );

-- Extend staff punch policies to include kiosk role.
DROP POLICY IF EXISTS time_clock_insert_scoped ON time_clock_entry;
CREATE POLICY time_clock_insert_scoped ON time_clock_entry
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
    AND (
      user_id = current_app_user_id()
      OR current_app_user_role() IN (
        'owner', 'manager', 'service_advisor', 'admin', 'time_clock_kiosk'
      )
    )
  );

DROP POLICY IF EXISTS time_clock_update_scoped ON time_clock_entry;
CREATE POLICY time_clock_update_scoped ON time_clock_entry
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
    AND (
      user_id = current_app_user_id()
      OR current_app_user_role() IN (
        'owner', 'manager', 'service_advisor', 'admin', 'time_clock_kiosk'
      )
    )
  )
  WITH CHECK (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
    AND (
      user_id = current_app_user_id()
      OR current_app_user_role() IN (
        'owner', 'manager', 'service_advisor', 'admin', 'time_clock_kiosk'
      )
    )
  );

DROP POLICY IF EXISTS time_clock_break_insert ON time_clock_break;
CREATE POLICY time_clock_break_insert ON time_clock_break
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM time_clock_entry e
      WHERE e.entry_id = time_clock_break.entry_id
        AND (
          e.user_id = current_app_user_id()
          OR current_app_user_role() IN (
            'owner', 'manager', 'service_advisor', 'admin', 'time_clock_kiosk'
          )
        )
    )
  );

DROP POLICY IF EXISTS time_clock_break_update ON time_clock_break;
CREATE POLICY time_clock_break_update ON time_clock_break
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM time_clock_entry e
      WHERE e.entry_id = time_clock_break.entry_id
        AND (
          e.user_id = current_app_user_id()
          OR current_app_user_role() IN (
            'owner', 'manager', 'service_advisor', 'admin', 'time_clock_kiosk'
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM time_clock_entry e
      WHERE e.entry_id = time_clock_break.entry_id
        AND (
          e.user_id = current_app_user_id()
          OR current_app_user_role() IN (
            'owner', 'manager', 'service_advisor', 'admin', 'time_clock_kiosk'
          )
        )
    )
  );
