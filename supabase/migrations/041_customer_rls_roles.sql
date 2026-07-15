-- Align customer RLS with canViewClients:
-- owner, manager, service_advisor, admin may read/write.
-- Technicians have no access to customer rows (defense in depth).

DROP POLICY IF EXISTS customer_select ON customer;
CREATE POLICY customer_select ON customer
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

DROP POLICY IF EXISTS customer_write ON customer;
CREATE POLICY customer_write ON customer
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

DROP POLICY IF EXISTS customer_update ON customer;
CREATE POLICY customer_update ON customer
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  )
  WITH CHECK (
    is_active_app_user()
    AND current_app_user_role() IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );
