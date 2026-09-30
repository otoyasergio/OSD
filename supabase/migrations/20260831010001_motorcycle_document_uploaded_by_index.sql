-- Cover the uploaded_by FK for staff deletes / lookups.
CREATE INDEX IF NOT EXISTS idx_motorcycle_document_uploaded_by
  ON public.motorcycle_document (uploaded_by_user_id)
  WHERE uploaded_by_user_id IS NOT NULL;
