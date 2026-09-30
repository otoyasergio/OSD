-- Bike-profile documents (registration, ownership, insurance photos, etc.).
-- Survives visit cancellation — pinned to motorcycle_id, not work_order.

CREATE TABLE public.motorcycle_document (
  document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  motorcycle_id uuid NOT NULL REFERENCES public.motorcycle (motorcycle_id) ON DELETE CASCADE,
  title text NOT NULL,
  notes text,
  storage_bucket text NOT NULL DEFAULT 'motorcycle-documents',
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  file_size integer,
  uploaded_by_user_id uuid REFERENCES public.app_user (user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_motorcycle_document_motorcycle_created
  ON public.motorcycle_document (motorcycle_id, created_at DESC);

COMMENT ON TABLE public.motorcycle_document IS
  'Front-office photos/PDFs of bike documents (registration, title, insurance). Independent of work orders.';

ALTER TABLE public.motorcycle_document ENABLE ROW LEVEL SECURITY;

-- Same front-office roles as customer_document.
CREATE POLICY motorcycle_document_select ON public.motorcycle_document
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );

CREATE POLICY motorcycle_document_insert ON public.motorcycle_document
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );

CREATE POLICY motorcycle_document_delete ON public.motorcycle_document
  FOR DELETE TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );

GRANT SELECT, INSERT, DELETE ON TABLE public.motorcycle_document TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'motorcycle-documents',
  'motorcycle-documents',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY motorcycle_documents_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'motorcycle-documents'
    AND is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );

CREATE POLICY motorcycle_documents_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'motorcycle-documents'
    AND is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );

CREATE POLICY motorcycle_documents_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'motorcycle-documents'
    AND is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  )
  WITH CHECK (
    bucket_id = 'motorcycle-documents'
    AND is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );

CREATE POLICY motorcycle_documents_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'motorcycle-documents'
    AND is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );
