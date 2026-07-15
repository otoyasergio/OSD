ALTER TABLE public.motorcycle
  ADD COLUMN odometer_unit text NOT NULL DEFAULT 'km';

ALTER TABLE public.motorcycle
  ADD CONSTRAINT motorcycle_odometer_unit_check
  CHECK (odometer_unit IN ('km', 'mi'));

COMMENT ON COLUMN public.motorcycle.odometer_unit IS
  'Preferred unit for this motorcycle odometer: km or mi.';
