-- Align customer_document RLS with app permissions:
-- view/upload: owner, manager, service_advisor, admin
-- delete: owner, manager
-- Portal auto-file uses the service role (bypasses RLS).

DROP POLICY IF EXISTS customer_document_select ON customer_document;
CREATE POLICY customer_document_select ON customer_document
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

DROP POLICY IF EXISTS customer_document_insert ON customer_document;
CREATE POLICY customer_document_insert ON customer_document
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

DROP POLICY IF EXISTS customer_document_delete ON customer_document;
CREATE POLICY customer_document_delete ON customer_document
  FOR DELETE TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS customer_documents_select ON storage.objects;
CREATE POLICY customer_documents_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'customer-documents'
    AND is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );

DROP POLICY IF EXISTS customer_documents_insert ON storage.objects;
CREATE POLICY customer_documents_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'customer-documents'
    AND is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );

DROP POLICY IF EXISTS customer_documents_update ON storage.objects;
CREATE POLICY customer_documents_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'customer-documents'
    AND is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  )
  WITH CHECK (
    bucket_id = 'customer-documents'
    AND is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );

DROP POLICY IF EXISTS customer_documents_delete ON storage.objects;
CREATE POLICY customer_documents_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'customer-documents'
    AND is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
  );
