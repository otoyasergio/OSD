-- Customer typeahead was scanning ~4.7k Wix contacts under per-row RLS helpers.
-- Wrap RLS in SELECT (initplan once per query) and add trigram + name-sort indexes.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_customer_last_first
  ON public.customer (last_name, first_name);

CREATE INDEX IF NOT EXISTS idx_customer_first_name_trgm
  ON public.customer USING gin (first_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customer_last_name_trgm
  ON public.customer USING gin (last_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customer_email_trgm
  ON public.customer USING gin (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customer_phone_trgm
  ON public.customer USING gin (phone gin_trgm_ops);

DROP POLICY IF EXISTS customer_select ON public.customer;
CREATE POLICY customer_select ON public.customer
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );

DROP POLICY IF EXISTS customer_write ON public.customer;
CREATE POLICY customer_write ON public.customer
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );

DROP POLICY IF EXISTS customer_update ON public.customer;
CREATE POLICY customer_update ON public.customer
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) IN (
      'owner',
      'manager',
      'service_advisor',
      'admin'
    )
  );
