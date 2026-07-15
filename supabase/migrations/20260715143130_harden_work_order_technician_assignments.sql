-- Assignment writes must match the app rule: technicians cannot self-pull.
-- Also add UPDATE support so setting an already-associated technician as the
-- primary technician can safely refresh the assignment row.
DROP POLICY IF EXISTS work_order_technician_write
  ON public.work_order_technician;

CREATE POLICY work_order_technician_insert_assigner
  ON public.work_order_technician
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
    AND assigned_by_user_id = (SELECT public.current_app_user_id())
    AND EXISTS (
      SELECT 1
      FROM public.work_order wo
      JOIN public.user_location technician_location
        ON technician_location.location_id = wo.location_id
       AND technician_location.user_id = work_order_technician.technician_id
      JOIN public.app_user technician
        ON technician.user_id = technician_location.user_id
      WHERE wo.work_order_id = work_order_technician.work_order_id
        AND wo.location_id IN (SELECT public.user_location_ids())
        AND technician.status = 'active'
        AND technician.role IN ('technician', 'head_tech')
    )
  );

CREATE POLICY work_order_technician_update_assigner
  ON public.work_order_technician
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
    AND public.work_order_in_user_locations(work_order_id)
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
    AND assigned_by_user_id = (SELECT public.current_app_user_id())
    AND EXISTS (
      SELECT 1
      FROM public.work_order wo
      JOIN public.user_location technician_location
        ON technician_location.location_id = wo.location_id
       AND technician_location.user_id = work_order_technician.technician_id
      JOIN public.app_user technician
        ON technician.user_id = technician_location.user_id
      WHERE wo.work_order_id = work_order_technician.work_order_id
        AND wo.location_id IN (SELECT public.user_location_ids())
        AND technician.status = 'active'
        AND technician.role IN ('technician', 'head_tech')
    )
  );
