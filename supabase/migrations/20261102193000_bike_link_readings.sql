-- Bike link. A plug on the motorcycle stores kilometers, battery voltage,
-- and fault codes. The shop bay, the client's home, or a partner stop
-- delivers that same reading. The app compares it with the service interval.

CREATE TABLE public.bike_link_schedule (
  motorcycle_id uuid PRIMARY KEY
    REFERENCES public.motorcycle(motorcycle_id) ON DELETE CASCADE,
  interval_distance integer NOT NULL,
  interval_days integer NOT NULL,
  last_service_odometer integer,
  last_service_on date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid
    REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  CONSTRAINT bike_link_schedule_interval_distance
    CHECK (interval_distance BETWEEN 100 AND 100000),
  CONSTRAINT bike_link_schedule_interval_days
    CHECK (interval_days BETWEEN 30 AND 1095),
  CONSTRAINT bike_link_schedule_last_odometer
    CHECK (
      last_service_odometer IS NULL
      OR last_service_odometer BETWEEN 0 AND 999999
    )
);

COMMENT ON TABLE public.bike_link_schedule IS
  'Per-bike service interval. Blank last-service fields fall back to the last completed visit.';

CREATE TABLE public.bike_link_reading (
  reading_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  motorcycle_id uuid NOT NULL
    REFERENCES public.motorcycle(motorcycle_id) ON DELETE CASCADE,
  source text NOT NULL
    CHECK (source IN ('shop_bay', 'home', 'partner')),
  place_name text,
  odometer integer,
  battery_volts numeric(4, 1),
  fault_codes text[] NOT NULL DEFAULT '{}',
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid
    REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  CONSTRAINT bike_link_reading_place_name
    CHECK (place_name IS NULL OR char_length(btrim(place_name)) BETWEEN 1 AND 80),
  CONSTRAINT bike_link_reading_odometer
    CHECK (odometer IS NULL OR odometer BETWEEN 0 AND 999999),
  CONSTRAINT bike_link_reading_battery
    CHECK (battery_volts IS NULL OR (battery_volts >= 8 AND battery_volts <= 16)),
  CONSTRAINT bike_link_reading_has_signal
    CHECK (
      odometer IS NOT NULL
      OR battery_volts IS NOT NULL
      OR cardinality(fault_codes) > 0
    )
);

CREATE INDEX idx_bike_link_reading_motorcycle_recorded
  ON public.bike_link_reading (motorcycle_id, recorded_at DESC);

COMMENT ON TABLE public.bike_link_reading IS
  'One stored check from a bike plug. source is shop_bay, home, or partner.';

ALTER TABLE public.bike_link_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bike_link_reading ENABLE ROW LEVEL SECURITY;

CREATE POLICY bike_link_schedule_select ON public.bike_link_schedule
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

CREATE POLICY bike_link_schedule_insert ON public.bike_link_schedule
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_active_app_user()));

CREATE POLICY bike_link_schedule_update ON public.bike_link_schedule
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_active_app_user()))
  WITH CHECK ((SELECT public.is_active_app_user()));

CREATE POLICY bike_link_reading_select ON public.bike_link_reading
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

CREATE POLICY bike_link_reading_insert ON public.bike_link_reading
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_active_app_user()));

GRANT SELECT, INSERT, UPDATE ON TABLE public.bike_link_schedule TO authenticated;
GRANT SELECT, INSERT ON TABLE public.bike_link_reading TO authenticated;
