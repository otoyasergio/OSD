-- RLS hardening: fix mutable search_path on mint helper; revoke anon/public
-- EXECUTE on SECURITY DEFINER helpers (defense in depth for Data API RPC).

CREATE OR REPLACE FUNCTION mint_work_order_number(p_location_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF NOT is_active_app_user() THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  INSERT INTO work_order_sequence (location_id, next_number)
  VALUES (p_location_id, 1001)
  ON CONFLICT (location_id) DO NOTHING;

  UPDATE work_order_sequence
  SET next_number = next_number + 1
  WHERE location_id = p_location_id
  RETURNING next_number - 1 INTO n;

  RETURN 'WO-' || n::text;
END;
$$;

-- Ensure RLS helpers keep a fixed search_path (already set in 006; reaffirm).
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id FROM app_user
  WHERE auth_user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_app_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM app_user
  WHERE auth_user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_active_app_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_app_user_id() IS NOT NULL;
$$;

-- Revoke broad EXECUTE; grant only to authenticated (RLS + app RPC) and service_role.
REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_app_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_app_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mint_work_order_number(uuid) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.current_app_user_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_app_user_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_active_app_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.mint_work_order_number(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_app_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_app_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mint_work_order_number(uuid) TO authenticated, service_role;

-- app_user writes: owner-only (matches lib/services/users.ts requireOwner).
CREATE POLICY app_user_insert_owner ON app_user
  FOR INSERT TO authenticated
  WITH CHECK (current_app_user_role() = 'owner');

CREATE POLICY app_user_update_owner ON app_user
  FOR UPDATE TO authenticated
  USING (current_app_user_role() = 'owner')
  WITH CHECK (current_app_user_role() = 'owner');

-- audit_log: append-only (deny UPDATE/DELETE for authenticated).
CREATE POLICY audit_log_no_update ON audit_log
  FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY audit_log_no_delete ON audit_log
  FOR DELETE TO authenticated
  USING (false);
