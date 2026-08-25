-- Ontario ESA-oriented staff EE profiles: employment record, notes, documents.

CREATE TABLE IF NOT EXISTS staff_employment_record (
  user_id uuid PRIMARY KEY REFERENCES app_user (user_id) ON DELETE CASCADE,
  legal_name text,
  home_address text,
  employment_start_date date,
  date_of_birth date,
  employment_end_date date,
  job_title text,
  regular_work_day_hours numeric(4, 2),
  regular_work_week_hours numeric(5, 2),
  pay_type text CHECK (pay_type IS NULL OR pay_type IN ('hourly', 'salary')),
  emergency_contact_name text,
  emergency_contact_phone text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS staff_note (
  note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
  body text NOT NULL,
  created_by_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_staff_note_user
  ON staff_note (user_id, created_at DESC)
  WHERE voided_at IS NULL;

CREATE TABLE IF NOT EXISTS staff_document (
  document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'employment_agreement',
    'excess_hours_agreement',
    'overtime_averaging_agreement',
    'wage_statement',
    'leave_record',
    'vacation_record',
    'termination_statement',
    'policy_ack',
    'other'
  )),
  storage_bucket text NOT NULL DEFAULT 'staff-documents',
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  file_size integer,
  uploaded_by_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retention_until date,
  voided_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_staff_document_user
  ON staff_document (user_id, created_at DESC)
  WHERE voided_at IS NULL;

ALTER TABLE staff_employment_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_document ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_employment_record_select ON staff_employment_record
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );

CREATE POLICY staff_employment_record_insert ON staff_employment_record
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );

CREATE POLICY staff_employment_record_update ON staff_employment_record
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  )
  WITH CHECK (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );

CREATE POLICY staff_note_select ON staff_note
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );

CREATE POLICY staff_note_insert ON staff_note
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );

CREATE POLICY staff_note_update ON staff_note
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  )
  WITH CHECK (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );

CREATE POLICY staff_document_select ON staff_document
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );

CREATE POLICY staff_document_insert ON staff_document
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );

CREATE POLICY staff_document_update ON staff_document
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  )
  WITH CHECK (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'staff-documents',
  'staff-documents',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY staff_documents_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'staff-documents'
    AND is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );

CREATE POLICY staff_documents_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'staff-documents'
    AND is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );

CREATE POLICY staff_documents_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'staff-documents'
    AND is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  )
  WITH CHECK (
    bucket_id = 'staff-documents'
    AND is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );

CREATE POLICY staff_documents_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'staff-documents'
    AND is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );
