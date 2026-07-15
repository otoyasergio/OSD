-- Persistent, user-scoped alerts for motorcycle/work-order assignments.
CREATE TABLE public.staff_notification (
  staff_notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL
    REFERENCES public.app_user (user_id) ON DELETE CASCADE,
  actor_user_id uuid
    REFERENCES public.app_user (user_id) ON DELETE SET NULL,
  location_id uuid NOT NULL
    REFERENCES public.location (location_id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL
    REFERENCES public.work_order (work_order_id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'work_order_assigned'
    CHECK (kind IN ('work_order_assigned')),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One pending alert per technician/work order. After it is read, a later
-- reassignment can produce a fresh alert.
CREATE UNIQUE INDEX staff_notification_unread_assignment_unique
  ON public.staff_notification (recipient_user_id, work_order_id, kind)
  WHERE read_at IS NULL;

CREATE INDEX staff_notification_recipient_unread_created_idx
  ON public.staff_notification (recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX staff_notification_actor_idx
  ON public.staff_notification (actor_user_id);

CREATE INDEX staff_notification_location_idx
  ON public.staff_notification (location_id);

CREATE INDEX staff_notification_work_order_idx
  ON public.staff_notification (work_order_id);

ALTER TABLE public.staff_notification ENABLE ROW LEVEL SECURITY;

-- Recipients can only read their own alerts.
CREATE POLICY staff_notification_select_recipient
  ON public.staff_notification
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND recipient_user_id = (SELECT public.current_app_user_id())
  );

-- Front-office roles may create assignment alerts only for an active floor
-- technician who belongs to the same location as the work order.
CREATE POLICY staff_notification_insert_assigner
  ON public.staff_notification
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND actor_user_id = (SELECT public.current_app_user_id())
    AND (SELECT public.current_app_user_role()) IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
    AND location_id IN (SELECT public.user_location_ids())
    AND EXISTS (
      SELECT 1
      FROM public.work_order wo
      WHERE wo.work_order_id = staff_notification.work_order_id
        AND wo.location_id = staff_notification.location_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.app_user recipient
      JOIN public.user_location recipient_location
        ON recipient_location.user_id = recipient.user_id
      WHERE recipient.user_id = staff_notification.recipient_user_id
        AND recipient.status = 'active'
        AND recipient.role IN ('technician', 'head_tech')
        AND recipient_location.location_id = staff_notification.location_id
    )
  );

-- UPDATE also needs SELECT under RLS. Column-level privileges below ensure a
-- recipient can only mark read_at and cannot rewrite ownership or references.
CREATE POLICY staff_notification_update_recipient
  ON public.staff_notification
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND recipient_user_id = (SELECT public.current_app_user_id())
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND recipient_user_id = (SELECT public.current_app_user_id())
  );

-- Explicit Data API exposure: no anonymous access and no app-level deletes.
REVOKE ALL ON TABLE public.staff_notification FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.staff_notification TO authenticated;
GRANT INSERT (
  recipient_user_id,
  actor_user_id,
  location_id,
  work_order_id,
  kind
) ON TABLE public.staff_notification TO authenticated;
GRANT UPDATE (read_at) ON TABLE public.staff_notification TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_notification TO service_role;

-- Generate the alert in the same database statement that creates the docket
-- assignment. This covers intake, work-order assignment, Control Center
-- dispatch, and individual job assignment without relying on every caller to
-- remember a second write.
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

  -- Technician self-pulls and system/service-role writes are not staff handoffs.
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

  -- ON CONFLICT would require the assigner to have SELECT access to the
  -- recipient's row, which correctly fails our recipient-only SELECT policy.
  -- Catch the unique violation instead so deduplication does not weaken RLS.
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

CREATE TRIGGER create_notification_from_work_order_technician
  AFTER INSERT OR UPDATE ON public.work_order_technician
  FOR EACH ROW
  EXECUTE FUNCTION public.create_staff_assignment_notification();

CREATE TRIGGER create_notification_from_job_assignment
  AFTER UPDATE OF assigned_technician_id ON public.job
  FOR EACH ROW
  EXECUTE FUNCTION public.create_staff_assignment_notification();
