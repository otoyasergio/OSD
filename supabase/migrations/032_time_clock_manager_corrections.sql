-- Allow owners/managers to correct timesheet punches (insert/update/delete any row).
-- Technicians keep self-service insert/update for their own punches.

DROP POLICY IF EXISTS time_clock_insert ON time_clock_entry;
CREATE POLICY time_clock_insert ON time_clock_entry
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = current_app_user_id()
    OR current_app_user_role() IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS time_clock_update ON time_clock_entry;
CREATE POLICY time_clock_update ON time_clock_entry
  FOR UPDATE TO authenticated
  USING (
    user_id = current_app_user_id()
    OR current_app_user_role() IN ('owner', 'manager')
  )
  WITH CHECK (
    user_id = current_app_user_id()
    OR current_app_user_role() IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS time_clock_delete ON time_clock_entry;
CREATE POLICY time_clock_delete ON time_clock_entry
  FOR DELETE TO authenticated
  USING (current_app_user_role() IN ('owner', 'manager'));
