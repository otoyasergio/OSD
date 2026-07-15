-- Technician Floor OS: checklist, job proof photos, admin flags, peer QC assignee.

-- job checklist items (standard work)
CREATE TABLE job_checklist_item (
  job_checklist_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES job(job_id) ON DELETE CASCADE,
  title text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  checked_at timestamptz,
  checked_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_checklist_item_job_id ON job_checklist_item (job_id);

ALTER TABLE job_checklist_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_checklist_item_select_location ON job_checklist_item
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND EXISTS (
      SELECT 1 FROM job j
      WHERE j.job_id = job_checklist_item.job_id
        AND public.work_order_in_user_locations(j.work_order_id)
    )
  );

CREATE POLICY job_checklist_item_insert_location ON job_checklist_item
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND EXISTS (
      SELECT 1 FROM job j
      WHERE j.job_id = job_checklist_item.job_id
        AND public.work_order_in_user_locations(j.work_order_id)
    )
  );

CREATE POLICY job_checklist_item_update_location ON job_checklist_item
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND EXISTS (
      SELECT 1 FROM job j
      WHERE j.job_id = job_checklist_item.job_id
        AND public.work_order_in_user_locations(j.work_order_id)
    )
  )
  WITH CHECK (
    is_active_app_user()
    AND EXISTS (
      SELECT 1 FROM job j
      WHERE j.job_id = job_checklist_item.job_id
        AND public.work_order_in_user_locations(j.work_order_id)
    )
  );

-- job proof photos
ALTER TABLE intake_photo
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES job(job_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_intake_photo_job_id
  ON intake_photo (job_id)
  WHERE job_id IS NOT NULL;

ALTER TABLE intake_photo
  DROP CONSTRAINT IF EXISTS intake_photo_category_check;

ALTER TABLE intake_photo
  ADD CONSTRAINT intake_photo_category_check CHECK (category IN (
    'front',
    'rear',
    'left_side',
    'right_side',
    'odometer',
    'vin',
    'damage',
    'accessories',
    'fuel_level',
    'other',
    'inspection_tires',
    'inspection_brakes',
    'inspection_forks',
    'inspection_item',
    'job_proof'
  ));

-- proof exception note type
ALTER TABLE technician_note
  DROP CONSTRAINT IF EXISTS technician_note_note_type_check;

ALTER TABLE technician_note
  ADD CONSTRAINT technician_note_note_type_check CHECK (note_type IN (
    'general',
    'diagnostic_finding',
    'customer_concern_confirmed',
    'customer_concern_not_found',
    'parts_issue',
    'road_test',
    'quality_check',
    'internal_warning',
    'proof_exception'
  ));

-- admin andon flags
CREATE TABLE admin_flag (
  admin_flag_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES work_order(work_order_id) ON DELETE CASCADE,
  job_id uuid REFERENCES job(job_id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN (
    'parts',
    'approval',
    'tool',
    'quality',
    'other'
  )),
  note text,
  created_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  cleared_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL
);

CREATE INDEX idx_admin_flag_work_order_id ON admin_flag (work_order_id);
CREATE INDEX idx_admin_flag_open ON admin_flag (work_order_id)
  WHERE cleared_at IS NULL;

ALTER TABLE admin_flag ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_flag_select_location ON admin_flag
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  );

CREATE POLICY admin_flag_insert_location ON admin_flag
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  );

CREATE POLICY admin_flag_update_location ON admin_flag
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  )
  WITH CHECK (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  );

-- peer QC assignee
ALTER TABLE work_order
  ADD COLUMN IF NOT EXISTS quality_check_assigned_to uuid
    REFERENCES app_user(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_order_quality_check_assigned_to
  ON work_order (quality_check_assigned_to)
  WHERE quality_check_assigned_to IS NOT NULL;

-- Allow any staff at the location to see who is currently clocked in (peer QC).
CREATE POLICY time_clock_select_open_peers ON time_clock_entry
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
    AND clock_out_at IS NULL
  );
