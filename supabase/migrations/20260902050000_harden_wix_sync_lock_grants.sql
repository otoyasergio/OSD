-- Harden cron lock RPCs: service_role only (not anon/authenticated via PostgREST).

REVOKE ALL ON FUNCTION public.try_wix_contacts_sync_lock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_wix_contacts_sync_lock() TO service_role;

REVOKE ALL ON FUNCTION public.release_wix_contacts_sync_lock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_wix_contacts_sync_lock() TO service_role;
