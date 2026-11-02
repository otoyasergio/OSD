-- Floor tablets and the office work order stay open for hours. A new
-- technician note has to reach the other screen without a reload.
-- REPLICA IDENTITY FULL keeps work_order_id on the realtime payload so the
-- subscription can filter to the bike that is open.
ALTER TABLE public.technician_note REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.technician_note;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
