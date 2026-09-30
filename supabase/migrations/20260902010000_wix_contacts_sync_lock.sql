-- Prevent overlapping Wix contacts cron runs (every 4 minutes on Vercel Pro).

CREATE OR REPLACE FUNCTION public.try_wix_contacts_sync_lock()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_try_advisory_lock(hashtext('wix_contacts_sync'));
$$;

CREATE OR REPLACE FUNCTION public.release_wix_contacts_sync_lock()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_advisory_unlock(hashtext('wix_contacts_sync'));
$$;

REVOKE ALL ON FUNCTION public.try_wix_contacts_sync_lock() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_wix_contacts_sync_lock() TO service_role;

REVOKE ALL ON FUNCTION public.release_wix_contacts_sync_lock() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_wix_contacts_sync_lock() TO service_role;
