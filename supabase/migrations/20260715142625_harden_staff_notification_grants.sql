-- Existing projects may still apply broad default table privileges before the
-- explicit grants in the creation migration. Revoke them, then opt in only to
-- the operations used by the notification service.
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
