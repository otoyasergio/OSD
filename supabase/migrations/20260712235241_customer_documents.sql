-- Customer profile documents: manual uploads + auto-filed drop-off agreements.

CREATE TABLE customer_document (
  document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customer (customer_id) ON DELETE CASCADE,
  title text NOT NULL,
  source text NOT NULL CHECK (source IN ('upload', 'drop_off_agreement')),
  work_order_id uuid REFERENCES work_order (work_order_id) ON DELETE SET NULL,
  agreement_id uuid UNIQUE REFERENCES drop_off_agreement (agreement_id) ON DELETE CASCADE,
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  file_size integer,
  uploaded_by_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_document_agreement_source_check CHECK (
    (source = 'drop_off_agreement' AND agreement_id IS NOT NULL)
    OR (source = 'upload' AND agreement_id IS NULL)
  )
);

CREATE INDEX idx_customer_document_customer_id
  ON customer_document (customer_id, created_at DESC);

CREATE INDEX idx_customer_document_work_order_id
  ON customer_document (work_order_id)
  WHERE work_order_id IS NOT NULL;

ALTER TABLE customer_document ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_document_select ON customer_document
  FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY customer_document_insert ON customer_document
  FOR INSERT TO authenticated
  WITH CHECK (is_active_app_user());

CREATE POLICY customer_document_delete ON customer_document
  FOR DELETE TO authenticated
  USING (is_active_app_user());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'customer-documents',
  'customer-documents',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY customer_documents_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'customer-documents' AND is_active_app_user());

CREATE POLICY customer_documents_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'customer-documents' AND is_active_app_user());

CREATE POLICY customer_documents_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'customer-documents' AND is_active_app_user())
  WITH CHECK (bucket_id = 'customer-documents' AND is_active_app_user());

CREATE POLICY customer_documents_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'customer-documents' AND is_active_app_user());

-- Backfill profile docs for agreements already on file.
INSERT INTO customer_document (
  customer_id,
  title,
  source,
  work_order_id,
  agreement_id,
  storage_bucket,
  storage_path,
  mime_type,
  file_size,
  uploaded_by_user_id,
  created_at
)
SELECT
  wo.customer_id,
  'Drop-off agreement — ' || wo.work_order_number || ' (' ||
    to_char(a.signed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || ')',
  'drop_off_agreement',
  a.work_order_id,
  a.agreement_id,
  'contract-signatures',
  a.signature_storage_path,
  CASE
    WHEN a.signature_storage_path ILIKE '%.png' THEN 'image/png'
    WHEN a.signature_storage_path ILIKE '%.jpg'
      OR a.signature_storage_path ILIKE '%.jpeg' THEN 'image/jpeg'
    WHEN a.signature_storage_path ILIKE '%.webp' THEN 'image/webp'
    ELSE 'image/png'
  END,
  NULL,
  a.signed_by_user_id,
  a.signed_at
FROM drop_off_agreement a
JOIN work_order wo ON wo.work_order_id = a.work_order_id
ON CONFLICT (agreement_id) DO NOTHING;
