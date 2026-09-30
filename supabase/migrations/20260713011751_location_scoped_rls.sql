-- Location-scoped RLS for operational work-order tables.
-- Authorization truth remains in lib/permissions + services; this tightens
-- defense-in-depth so a staff JWT cannot read/write other locations via the Data API.

CREATE OR REPLACE FUNCTION public.user_location_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ul.location_id
  FROM user_location ul
  WHERE ul.user_id = current_app_user_id();
$$;

REVOKE ALL ON FUNCTION public.user_location_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_location_ids() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.work_order_in_user_locations(p_work_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM work_order wo
    WHERE wo.work_order_id = p_work_order_id
      AND wo.location_id IN (SELECT public.user_location_ids())
  );
$$;

REVOKE ALL ON FUNCTION public.work_order_in_user_locations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_order_in_user_locations(uuid) TO authenticated, service_role;

-- work_order
DROP POLICY IF EXISTS work_order_select ON work_order;
DROP POLICY IF EXISTS work_order_write ON work_order;
DROP POLICY IF EXISTS work_order_update ON work_order;

CREATE POLICY work_order_select_location ON work_order
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
  );

CREATE POLICY work_order_insert_location ON work_order
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
  );

CREATE POLICY work_order_update_location ON work_order
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
  )
  WITH CHECK (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
  );

-- job
DROP POLICY IF EXISTS job_select ON job;
DROP POLICY IF EXISTS job_write ON job;
DROP POLICY IF EXISTS job_update ON job;

CREATE POLICY job_select_location ON job
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  );

CREATE POLICY job_insert_location ON job
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  );

CREATE POLICY job_update_location ON job
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  )
  WITH CHECK (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  );

-- inspection
DROP POLICY IF EXISTS inspection_select ON inspection;
DROP POLICY IF EXISTS inspection_write ON inspection;
DROP POLICY IF EXISTS inspection_update ON inspection;

CREATE POLICY inspection_select_location ON inspection
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  );

CREATE POLICY inspection_insert_location ON inspection
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  );

CREATE POLICY inspection_update_location ON inspection
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  )
  WITH CHECK (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  );

-- intake_photo
DROP POLICY IF EXISTS intake_photo_select ON intake_photo;
DROP POLICY IF EXISTS intake_photo_write ON intake_photo;
DROP POLICY IF EXISTS intake_photo_delete ON intake_photo;

CREATE POLICY intake_photo_select_location ON intake_photo
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  );

CREATE POLICY intake_photo_insert_location ON intake_photo
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  );

CREATE POLICY intake_photo_delete_location ON intake_photo
  FOR DELETE TO authenticated
  USING (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  );

-- timeline_event
DROP POLICY IF EXISTS timeline_event_select ON timeline_event;
DROP POLICY IF EXISTS timeline_event_write ON timeline_event;

CREATE POLICY timeline_event_select_location ON timeline_event
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  );

CREATE POLICY timeline_event_insert_location ON timeline_event
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND public.work_order_in_user_locations(work_order_id)
  );

-- part
DROP POLICY IF EXISTS part_select ON part;
DROP POLICY IF EXISTS part_write ON part;
DROP POLICY IF EXISTS part_update ON part;

CREATE POLICY part_select_location ON part
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND EXISTS (
      SELECT 1
      FROM job j
      WHERE j.job_id = part.job_id
        AND public.work_order_in_user_locations(j.work_order_id)
    )
  );

CREATE POLICY part_insert_location ON part
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND EXISTS (
      SELECT 1
      FROM job j
      WHERE j.job_id = part.job_id
        AND public.work_order_in_user_locations(j.work_order_id)
    )
  );

CREATE POLICY part_update_location ON part
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND EXISTS (
      SELECT 1
      FROM job j
      WHERE j.job_id = part.job_id
        AND public.work_order_in_user_locations(j.work_order_id)
    )
  )
  WITH CHECK (
    is_active_app_user()
    AND EXISTS (
      SELECT 1
      FROM job j
      WHERE j.job_id = part.job_id
        AND public.work_order_in_user_locations(j.work_order_id)
    )
  );

-- time_clock_entry
DROP POLICY IF EXISTS time_clock_select ON time_clock_entry;
DROP POLICY IF EXISTS time_clock_insert ON time_clock_entry;
DROP POLICY IF EXISTS time_clock_update ON time_clock_entry;
DROP POLICY IF EXISTS time_clock_delete ON time_clock_entry;

CREATE POLICY time_clock_select_scoped ON time_clock_entry
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
    AND (
      user_id = current_app_user_id()
      OR current_app_user_role() IN ('owner', 'manager')
    )
  );

CREATE POLICY time_clock_insert_scoped ON time_clock_entry
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
    AND (
      user_id = current_app_user_id()
      OR current_app_user_role() IN ('owner', 'manager')
    )
  );

CREATE POLICY time_clock_update_scoped ON time_clock_entry
  FOR UPDATE TO authenticated
  USING (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
    AND (
      user_id = current_app_user_id()
      OR current_app_user_role() IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
    AND (
      user_id = current_app_user_id()
      OR current_app_user_role() IN ('owner', 'manager')
    )
  );

CREATE POLICY time_clock_delete_scoped ON time_clock_entry
  FOR DELETE TO authenticated
  USING (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
    AND current_app_user_role() IN ('owner', 'manager')
  );
