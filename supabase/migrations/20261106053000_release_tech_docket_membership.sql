-- Control Center can take a bike off a technician. The tech docket still
-- lists a visit while a work_order_technician row remains, and there was no
-- DELETE policy, so the front office could not clear that membership.

DROP POLICY IF EXISTS work_order_technician_delete_assigner
  ON public.work_order_technician;

CREATE POLICY work_order_technician_delete_assigner
  ON public.work_order_technician
  FOR DELETE
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
  );
