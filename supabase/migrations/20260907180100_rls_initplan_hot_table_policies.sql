-- InitPlan-wrap hot-table RLS so is_active_app_user() runs once per query.

DROP POLICY IF EXISTS app_user_select ON public.app_user;
CREATE POLICY app_user_select ON public.app_user
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS app_user_insert_owner ON public.app_user;
CREATE POLICY app_user_insert_owner ON public.app_user
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.current_app_user_role()) = 'owner');

DROP POLICY IF EXISTS app_user_update_owner ON public.app_user;
CREATE POLICY app_user_update_owner ON public.app_user
  FOR UPDATE TO authenticated
  USING ((SELECT public.current_app_user_role()) = 'owner')
  WITH CHECK ((SELECT public.current_app_user_role()) = 'owner');

-- user_location
DROP POLICY IF EXISTS user_location_select ON public.user_location;
CREATE POLICY user_location_select ON public.user_location
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS user_location_write ON public.user_location;
CREATE POLICY user_location_write ON public.user_location
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS user_location_delete ON public.user_location;
CREATE POLICY user_location_delete ON public.user_location
  FOR DELETE TO authenticated
  USING ((SELECT public.is_active_app_user()));

-- location
DROP POLICY IF EXISTS location_select ON public.location;
CREATE POLICY location_select ON public.location
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS location_write ON public.location;
CREATE POLICY location_write ON public.location
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS location_update ON public.location;
CREATE POLICY location_update ON public.location
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_active_app_user()))
  WITH CHECK ((SELECT public.is_active_app_user()));

-- motorcycle
DROP POLICY IF EXISTS motorcycle_select ON public.motorcycle;
CREATE POLICY motorcycle_select ON public.motorcycle
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS motorcycle_write ON public.motorcycle;
CREATE POLICY motorcycle_write ON public.motorcycle
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS motorcycle_update ON public.motorcycle;
CREATE POLICY motorcycle_update ON public.motorcycle
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_active_app_user()))
  WITH CHECK ((SELECT public.is_active_app_user()));

-- motorcycle_service_information
DROP POLICY IF EXISTS motorcycle_service_information_select ON public.motorcycle_service_information;
CREATE POLICY motorcycle_service_information_select ON public.motorcycle_service_information
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS motorcycle_service_information_write ON public.motorcycle_service_information;
CREATE POLICY motorcycle_service_information_write ON public.motorcycle_service_information
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS motorcycle_service_information_update ON public.motorcycle_service_information;
CREATE POLICY motorcycle_service_information_update ON public.motorcycle_service_information
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_active_app_user()))
  WITH CHECK ((SELECT public.is_active_app_user()));

-- service
DROP POLICY IF EXISTS service_select ON public.service;
CREATE POLICY service_select ON public.service
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS service_write ON public.service;
CREATE POLICY service_write ON public.service
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS service_update ON public.service;
CREATE POLICY service_update ON public.service
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_active_app_user()))
  WITH CHECK ((SELECT public.is_active_app_user()));

-- work_order
DROP POLICY IF EXISTS work_order_select_location ON public.work_order;
CREATE POLICY work_order_select_location ON public.work_order
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
  );

DROP POLICY IF EXISTS work_order_insert_location ON public.work_order;
CREATE POLICY work_order_insert_location ON public.work_order
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
  );

DROP POLICY IF EXISTS work_order_update_location ON public.work_order;
CREATE POLICY work_order_update_location ON public.work_order
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
  );

-- job
DROP POLICY IF EXISTS job_select_location ON public.job;
CREATE POLICY job_select_location ON public.job
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND public.work_order_in_user_locations(work_order_id)
  );

DROP POLICY IF EXISTS job_insert_location ON public.job;
CREATE POLICY job_insert_location ON public.job
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND public.work_order_in_user_locations(work_order_id)
  );

DROP POLICY IF EXISTS job_update_location ON public.job;
CREATE POLICY job_update_location ON public.job
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND public.work_order_in_user_locations(work_order_id)
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND public.work_order_in_user_locations(work_order_id)
  );

-- inspection
DROP POLICY IF EXISTS inspection_select_location ON public.inspection;
CREATE POLICY inspection_select_location ON public.inspection
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND public.work_order_in_user_locations(work_order_id)
  );

DROP POLICY IF EXISTS inspection_insert_location ON public.inspection;
CREATE POLICY inspection_insert_location ON public.inspection
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND public.work_order_in_user_locations(work_order_id)
  );

DROP POLICY IF EXISTS inspection_update_location ON public.inspection;
CREATE POLICY inspection_update_location ON public.inspection
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND public.work_order_in_user_locations(work_order_id)
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND public.work_order_in_user_locations(work_order_id)
  );

-- inspection_result
DROP POLICY IF EXISTS inspection_result_select ON public.inspection_result;
CREATE POLICY inspection_result_select ON public.inspection_result
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS inspection_result_write ON public.inspection_result;
CREATE POLICY inspection_result_write ON public.inspection_result
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_active_app_user()));

DROP POLICY IF EXISTS inspection_result_update ON public.inspection_result;
CREATE POLICY inspection_result_update ON public.inspection_result
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_active_app_user()))
  WITH CHECK ((SELECT public.is_active_app_user()));

-- intake_photo
DROP POLICY IF EXISTS intake_photo_select_location ON public.intake_photo;
CREATE POLICY intake_photo_select_location ON public.intake_photo
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND public.work_order_in_user_locations(work_order_id)
  );

DROP POLICY IF EXISTS intake_photo_insert_location ON public.intake_photo;
CREATE POLICY intake_photo_insert_location ON public.intake_photo
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND public.work_order_in_user_locations(work_order_id)
  );

DROP POLICY IF EXISTS intake_photo_delete_location ON public.intake_photo;
CREATE POLICY intake_photo_delete_location ON public.intake_photo
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND public.work_order_in_user_locations(work_order_id)
  );
