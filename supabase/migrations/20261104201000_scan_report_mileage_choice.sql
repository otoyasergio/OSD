-- Remember when a tech keeps the work-order mileage instead of the scan report.
-- A newer report is a new row, so the question can come back.

ALTER TABLE public.scan_report
  ADD COLUMN mileage_choice text;

ALTER TABLE public.scan_report
  ADD CONSTRAINT scan_report_mileage_choice_check
  CHECK (mileage_choice IS NULL OR mileage_choice = 'keep');
