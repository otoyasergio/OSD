-- Desk alerts when a bike becomes ready for pickup.
-- Widen staff_notification.kind and notify owner/manager/advisor/admin at the WO location.

ALTER TABLE public.staff_notification
  DROP CONSTRAINT IF EXISTS staff_notification_kind_check;

ALTER TABLE public.staff_notification
  ADD CONSTRAINT staff_notification_kind_check
  CHECK (kind IN ('work_order_assigned', 'ready_for_pickup'));

-- SECURITY DEFINER: QC pass is often a floor tech; existing INSERT RLS only
-- allows front-office → technician assignment inserts.
CREATE OR REPLACE FUNCTION public.create_ready_for_pickup_staff_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recipient RECORD;
  actor uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'ready_for_pickup' THEN
    RETURN NEW;
  END IF;

  actor := public.current_app_user_id();

  FOR recipient IN
    SELECT u.user_id
    FROM public.app_user u
    JOIN public.user_location ul ON ul.user_id = u.user_id
    WHERE ul.location_id = NEW.location_id
      AND u.status = 'active'
      AND u.role IN ('owner', 'manager', 'service_advisor', 'admin')
  LOOP
    BEGIN
      INSERT INTO public.staff_notification (
        recipient_user_id,
        actor_user_id,
        location_id,
        work_order_id,
        kind
      )
      VALUES (
        recipient.user_id,
        actor,
        NEW.location_id,
        NEW.work_order_id,
        'ready_for_pickup'
      );
    EXCEPTION
      WHEN unique_violation THEN
        NULL;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_ready_for_pickup_staff_notifications()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS create_ready_for_pickup_staff_notifications
  ON public.work_order;

CREATE TRIGGER create_ready_for_pickup_staff_notifications
  AFTER UPDATE OF status ON public.work_order
  FOR EACH ROW
  EXECUTE FUNCTION public.create_ready_for_pickup_staff_notifications();
