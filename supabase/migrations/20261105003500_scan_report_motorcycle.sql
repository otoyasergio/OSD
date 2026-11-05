-- A TopGuru report belongs to the bike, even when no visit is open.

ALTER TABLE public.scan_report
  ADD COLUMN motorcycle_id uuid REFERENCES public.motorcycle(motorcycle_id) ON DELETE SET NULL;

CREATE INDEX scan_report_motorcycle_received_idx
  ON public.scan_report (motorcycle_id, received_at DESC)
  WHERE motorcycle_id IS NOT NULL;

COMMENT ON COLUMN public.scan_report.motorcycle_id IS
  'Bike this report was filed on. Set from the VIN even when no work order is open.';
