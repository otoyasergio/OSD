-- Latest stored reading for each motorcycle. Staff use it to see who needs a call.
-- security_invoker keeps the underlying row security policies in force.

CREATE VIEW public.bike_link_latest_reading
WITH (security_invoker = true) AS
SELECT DISTINCT ON (motorcycle_id)
  reading_id,
  motorcycle_id,
  source,
  place_name,
  odometer,
  battery_volts,
  fault_codes,
  recorded_at
FROM public.bike_link_reading
ORDER BY motorcycle_id, recorded_at DESC, reading_id DESC;

COMMENT ON VIEW public.bike_link_latest_reading IS
  'Newest bike-link reading per motorcycle.';

GRANT SELECT ON public.bike_link_latest_reading TO authenticated;
