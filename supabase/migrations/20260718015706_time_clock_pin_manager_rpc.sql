-- Allow owner/manager to set/clear staff time-clock PINs without full app_user UPDATE.

CREATE OR REPLACE FUNCTION public.set_app_user_time_clock_pin(
  p_user_id uuid,
  p_pin_hash text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_active_app_user() THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF current_app_user_role() NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE app_user
  SET
    time_clock_pin_hash = p_pin_hash,
    time_clock_pin_updated_at = now()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_app_user_time_clock_pin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_app_user_time_clock_pin(uuid, text) TO authenticated;
