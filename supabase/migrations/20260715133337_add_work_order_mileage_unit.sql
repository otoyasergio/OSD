ALTER TABLE public.work_order
  ADD COLUMN mileage_unit text NOT NULL DEFAULT 'km';

ALTER TABLE public.work_order
  ADD CONSTRAINT work_order_mileage_unit_check
  CHECK (mileage_unit IN ('km', 'mi'));

COMMENT ON COLUMN public.work_order.mileage_unit IS
  'Unit recorded with the work-order odometer reading: km or mi.';
