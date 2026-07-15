-- ON CONFLICT checks conflict rows against SELECT RLS. Assignment actors must
-- not be able to read a technician's alert, so deduplicate by catching the
-- partial unique-index violation instead.
CREATE OR REPLACE FUNCTION public.create_staff_assignment_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  target_work_order_id uuid;
  target_technician_id uuid;
  target_location_id uuid;
  assigning_user_id uuid;
  assigning_user_role text;
BEGIN
  IF TG_TABLE_NAME = 'job' THEN
    IF NEW.assigned_technician_id IS NULL THEN
      RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
      AND NEW.assigned_technician_id IS NOT DISTINCT FROM OLD.assigned_technician_id
    THEN
      RETURN NEW;
    END IF;

    target_work_order_id := NEW.work_order_id;
    target_technician_id := NEW.assigned_technician_id;
  ELSE
    target_work_order_id := NEW.work_order_id;
    target_technician_id := NEW.technician_id;
  END IF;

  assigning_user_id := public.current_app_user_id();
  assigning_user_role := public.current_app_user_role();

  IF assigning_user_id IS NULL
    OR assigning_user_id = target_technician_id
    OR assigning_user_role NOT IN ('owner', 'manager', 'service_advisor', 'admin')
  THEN
    RETURN NEW;
  END IF;

  SELECT wo.location_id
  INTO target_location_id
  FROM public.work_order wo
  WHERE wo.work_order_id = target_work_order_id;

  IF target_location_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.staff_notification (
      recipient_user_id,
      actor_user_id,
      location_id,
      work_order_id,
      kind
    )
    VALUES (
      target_technician_id,
      assigning_user_id,
      target_location_id,
      target_work_order_id,
      'work_order_assigned'
    );
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_staff_assignment_notification()
  FROM PUBLIC, anon, authenticated, service_role;

-- The trigger only needs these canonical assignment fields. Keep system IDs,
-- timestamps, and read state out of the assigner's INSERT privilege.
REVOKE INSERT ON TABLE public.staff_notification FROM authenticated;
GRANT INSERT (
  recipient_user_id,
  actor_user_id,
  location_id,
  work_order_id,
  kind
) ON TABLE public.staff_notification TO authenticated;
