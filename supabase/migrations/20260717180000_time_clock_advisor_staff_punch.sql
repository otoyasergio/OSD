-- Allow service advisors (with owners/managers) to punch staff in/out at their location.
-- Used by Control Center "Signed in" toggle.

DROP POLICY IF EXISTS time_clock_insert_scoped ON time_clock_entry;
CREATE POLICY time_clock_insert_scoped ON time_clock_entry
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
    AND (
      user_id = current_app_user_id()
      OR current_app_user_role() IN ('owner', 'manager', 'service_advisor')
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
      OR current_app_user_role() IN ('owner', 'manager', 'service_advisor')
    )
  )
  WITH CHECK (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
    AND (
      user_id = current_app_user_id()
      OR current_app_user_role() IN ('owner', 'manager', 'service_advisor')
    )
  );

-- Advisors signing staff out must close open meal breaks on that punch.
DROP POLICY IF EXISTS time_clock_break_update ON time_clock_break;
CREATE POLICY time_clock_break_update ON time_clock_break
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM time_clock_entry e
      WHERE e.entry_id = time_clock_break.entry_id
        AND (
          e.user_id = current_app_user_id()
          OR current_app_user_role() IN ('owner', 'manager', 'service_advisor')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM time_clock_entry e
      WHERE e.entry_id = time_clock_break.entry_id
        AND (
          e.user_id = current_app_user_id()
          OR current_app_user_role() IN ('owner', 'manager', 'service_advisor')
        )
    )
  );

-- Advisors signing staff out must end open job timers for that tech.
DROP POLICY IF EXISTS job_time_update ON job_time_entry;
CREATE POLICY job_time_update ON job_time_entry
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND (
      user_id = current_app_user_id()
      OR current_app_user_role() IN ('owner', 'manager', 'service_advisor')
    )
  )
  WITH CHECK (
    is_active_app_user()
    AND (
      user_id = current_app_user_id()
      OR current_app_user_role() IN ('owner', 'manager', 'service_advisor')
    )
  );
