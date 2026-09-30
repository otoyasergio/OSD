-- Enable Realtime for staff assignment alerts (AppShell subscribe instead of 5s poll).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_notification;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
