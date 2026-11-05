-- Owner-editable shop labour rate used by intake pricing.
-- Default matches the current Toronto shop rate ($156/h).

ALTER TABLE public.location
  ADD COLUMN IF NOT EXISTS hourly_rate numeric(10, 2);

UPDATE public.location
  SET hourly_rate = 156
  WHERE hourly_rate IS NULL;

ALTER TABLE public.location
  ALTER COLUMN hourly_rate SET DEFAULT 156,
  ALTER COLUMN hourly_rate SET NOT NULL;

ALTER TABLE public.location
  DROP CONSTRAINT IF EXISTS location_hourly_rate_positive;

ALTER TABLE public.location
  ADD CONSTRAINT location_hourly_rate_positive CHECK (hourly_rate > 0);

COMMENT ON COLUMN public.location.hourly_rate IS
  'Hourly shop labour rate in dollars. Owner sets this in Settings → Shop rate.';
