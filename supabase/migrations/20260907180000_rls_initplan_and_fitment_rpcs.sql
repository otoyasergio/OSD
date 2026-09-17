-- InitPlan-wrap hot RLS helpers and replace fitment year/make scans with
-- MIN/MAX + DISTINCT RPCs. Same pattern as 20260821170000_customer_search_performance.

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id FROM public.app_user
  WHERE auth_user_id = (SELECT auth.uid())
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
  SELECT role FROM public.app_user
  WHERE auth_user_id = (SELECT auth.uid())
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
  SELECT (SELECT public.current_app_user_id()) IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.user_location_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ul.location_id
  FROM public.user_location ul
  WHERE ul.user_id = (SELECT public.current_app_user_id());
$$;

REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_app_user_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_app_user() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_location_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_app_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_app_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_location_ids() TO authenticated, service_role;

-- Fitment year/make/model without paging 15k rows through PostgREST.
CREATE OR REPLACE FUNCTION public.fitment_year_bounds()
RETURNS TABLE (min_year integer, max_year integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT MIN(year_start)::integer, MAX(year_end)::integer
  FROM public.fitment_vehicle;
$$;

CREATE OR REPLACE FUNCTION public.fitment_makes_for_year(p_year integer)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT make
  FROM public.fitment_vehicle
  WHERE year_start <= p_year
    AND year_end >= p_year
    AND make IS NOT NULL
    AND btrim(make) <> ''
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.fitment_models_for_year_make(p_year integer, p_make text)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT model
  FROM public.fitment_vehicle
  WHERE year_start <= p_year
    AND year_end >= p_year
    AND lower(make) = lower(p_make)
    AND model IS NOT NULL
    AND btrim(model) <> ''
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.fitment_year_bounds() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fitment_makes_for_year(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fitment_models_for_year_make(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fitment_year_bounds() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fitment_makes_for_year(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fitment_models_for_year_make(integer, text) TO authenticated, service_role;
