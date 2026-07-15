-- Cache stable authorization helpers once per statement in shop-closure RLS.
DROP POLICY IF EXISTS shop_closure_select_location ON public.shop_closure;
DROP POLICY IF EXISTS shop_closure_insert_manager ON public.shop_closure;
DROP POLICY IF EXISTS shop_closure_delete_manager ON public.shop_closure;

CREATE POLICY shop_closure_select_location ON public.shop_closure
  FOR SELECT TO authenticated
  USING (
    (SELECT is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
  );

CREATE POLICY shop_closure_insert_manager ON public.shop_closure
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT is_active_app_user())
    AND (SELECT current_app_user_role()) IN ('owner', 'manager')
    AND location_id IN (SELECT public.user_location_ids())
  );

CREATE POLICY shop_closure_delete_manager ON public.shop_closure
  FOR DELETE TO authenticated
  USING (
    (SELECT is_active_app_user())
    AND (SELECT current_app_user_role()) IN ('owner', 'manager')
    AND location_id IN (SELECT public.user_location_ids())
  );
