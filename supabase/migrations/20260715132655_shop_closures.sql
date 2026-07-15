-- Location-specific holidays and special closure dates used by intake defaults.
CREATE TABLE public.shop_closure (
  location_id uuid NOT NULL REFERENCES public.location(location_id) ON DELETE CASCADE,
  closure_date date NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_closure_pkey PRIMARY KEY (location_id, closure_date),
  CONSTRAINT shop_closure_reason_length CHECK (
    reason IS NULL OR char_length(reason) <= 120
  )
);

COMMENT ON TABLE public.shop_closure IS
  'Location-specific holidays and special closure dates skipped by intake completion defaults.';

-- New Supabase projects no longer auto-expose public tables. Keep grants explicit
-- and minimal; row access is further restricted by RLS below.
REVOKE ALL ON TABLE public.shop_closure FROM anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.shop_closure TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.shop_closure TO service_role;

ALTER TABLE public.shop_closure ENABLE ROW LEVEL SECURITY;

CREATE POLICY shop_closure_select_location ON public.shop_closure
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND location_id IN (SELECT public.user_location_ids())
  );

CREATE POLICY shop_closure_insert_manager ON public.shop_closure
  FOR INSERT TO authenticated
  WITH CHECK (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
    AND location_id IN (SELECT public.user_location_ids())
  );

CREATE POLICY shop_closure_delete_manager ON public.shop_closure
  FOR DELETE TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager')
    AND location_id IN (SELECT public.user_location_ids())
  );
