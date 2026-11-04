-- The shop hourly rate is an owner-only setting. RLS on location is row
-- based and lets any active staff member update the row (phone, mailbox and
-- address fields are edited by other roles), so the rate column gets its own
-- column-level guard: a staff session that is not an owner cannot change it.
-- Service-role and migration sessions carry no user JWT and are not guarded.

CREATE OR REPLACE FUNCTION public.guard_location_hourly_rate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.hourly_rate IS NOT DISTINCT FROM OLD.hourly_rate THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.current_app_user_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'SHOP_RATE_WRITE_FORBIDDEN';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS location_hourly_rate_owner_only ON public.location;
CREATE TRIGGER location_hourly_rate_owner_only
  BEFORE UPDATE OF hourly_rate ON public.location
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_location_hourly_rate();
