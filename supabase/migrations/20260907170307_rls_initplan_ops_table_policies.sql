-- InitPlan-wrap remaining operational RLS helpers.

-- timeline_event
DROP POLICY IF EXISTS timeline_event_select_location ON public.timeline_event;
CREATE POLICY timeline_event_select_location ON public.timeline_event
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND public.work_order_in_user_locations(work_order_id)
  );

DROP POLICY IF EXISTS timeline_event_insert_location ON public.timeline_event;
CREATE POLICY timeline_event_insert_location ON public.timeline_event
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND public.work_order_in_user_locations(work_order_id)
  );

-- part
DROP POLICY IF EXISTS part_select_location ON public.part;
CREATE POLICY part_select_location ON public.part
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND EXISTS (
      SELECT 1
      FROM public.job j
      WHERE j.job_id = part.job_id
        AND public.work_order_in_user_locations(j.work_order_id)
    )
  );

DROP POLICY IF EXISTS part_insert_location ON public.part;
CREATE POLICY part_insert_location ON public.part
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND EXISTS (
      SELECT 1
      FROM public.job j
      WHERE j.job_id = part.job_id
        AND public.work_order_in_user_locations(j.work_order_id)
    )
  );

DROP POLICY IF EXISTS part_update_location ON public.part;
CREATE POLICY part_update_location ON public.part
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND EXISTS (
      SELECT 1
      FROM public.job j
      WHERE j.job_id = part.job_id
        AND public.work_order_in_user_locations(j.work_order_id)
    )
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND EXISTS (
      SELECT 1
      FROM public.job j
      WHERE j.job_id = part.job_id
        AND public.work_order_in_user_locations(j.work_order_id)
    )
  );

-- recommendation
DROP POLICY IF EXISTS recommendation_select ON public.recommendation;
CREATE POLICY recommendation_select ON public.recommendation
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS recommendation_write ON public.recommendation;
CREATE POLICY recommendation_write ON public.recommendation
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS recommendation_update ON public.recommendation;
CREATE POLICY recommendation_update ON public.recommendation
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_active_app_user()))
  WITH CHECK ((SELECT public.is_active_app_user()));

-- technician_note
DROP POLICY IF EXISTS technician_note_select ON public.technician_note;
CREATE POLICY technician_note_select ON public.technician_note
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS technician_note_write ON public.technician_note;
CREATE POLICY technician_note_write ON public.technician_note
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_active_app_user()));

-- fitment + parts catalog
DROP POLICY IF EXISTS fitment_vehicle_select ON public.fitment_vehicle;
CREATE POLICY fitment_vehicle_select ON public.fitment_vehicle
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS parts_canada_catalog_select ON public.parts_canada_catalog;
CREATE POLICY parts_canada_catalog_select ON public.parts_canada_catalog
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

-- work_order_technician select (write policies already wrap helpers)
DROP POLICY IF EXISTS work_order_technician_select ON public.work_order_technician;
CREATE POLICY work_order_technician_select ON public.work_order_technician
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

-- time_clock: keep the live role list (advisor / admin / kiosk punches).
DROP POLICY IF EXISTS time_clock_select_scoped ON public.time_clock_entry;
CREATE POLICY time_clock_select_scoped ON public.time_clock_entry
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
    AND (
      clock_out_at IS NULL
      OR user_id = (SELECT public.current_app_user_id())
      OR (SELECT public.current_app_user_role()) = ANY (ARRAY['owner'::text, 'manager'::text])
    )
  );

DROP POLICY IF EXISTS time_clock_insert_scoped ON public.time_clock_entry;
CREATE POLICY time_clock_insert_scoped ON public.time_clock_entry
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
    AND (
      user_id = (SELECT public.current_app_user_id())
      OR (SELECT public.current_app_user_role()) = ANY (
        ARRAY['owner'::text, 'manager'::text, 'service_advisor'::text, 'admin'::text, 'time_clock_kiosk'::text]
      )
    )
  );

DROP POLICY IF EXISTS time_clock_update_scoped ON public.time_clock_entry;
CREATE POLICY time_clock_update_scoped ON public.time_clock_entry
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
    AND (
      user_id = (SELECT public.current_app_user_id())
      OR (SELECT public.current_app_user_role()) = ANY (
        ARRAY['owner'::text, 'manager'::text, 'service_advisor'::text, 'admin'::text, 'time_clock_kiosk'::text]
      )
    )
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
    AND (
      user_id = (SELECT public.current_app_user_id())
      OR (SELECT public.current_app_user_role()) = ANY (
        ARRAY['owner'::text, 'manager'::text, 'service_advisor'::text, 'admin'::text, 'time_clock_kiosk'::text]
      )
    )
  );

DROP POLICY IF EXISTS time_clock_delete_scoped ON public.time_clock_entry;
CREATE POLICY time_clock_delete_scoped ON public.time_clock_entry
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
    AND (SELECT public.current_app_user_role()) = ANY (ARRAY['owner'::text, 'manager'::text])
  );
