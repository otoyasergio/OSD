-- Session advisory locks do not survive Supabase's pooled PostgREST
-- connections. try_lock and release_lock run on different backends, so
-- pg_advisory_unlock logs "you don't own a lock of type ExclusiveLock"
-- and the original backend keeps the lock. A one-row lease works across
-- those connections. The no-argument release stays so a cron that has not
-- picked up the token yet can still clear the row.

CREATE TABLE public.wix_contacts_sync_lock (
  lock_id text PRIMARY KEY,
  locked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.wix_contacts_sync_lock ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wix_contacts_sync_lock FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION public.try_wix_contacts_sync_lock();
DROP FUNCTION public.release_wix_contacts_sync_lock();

CREATE FUNCTION public.try_wix_contacts_sync_lock()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acquired_at timestamptz;
BEGIN
  INSERT INTO public.wix_contacts_sync_lock AS lock_row (lock_id, locked_at, expires_at)
  VALUES ('wix_contacts_sync', clock_timestamp(), clock_timestamp() + interval '8 minutes')
  ON CONFLICT (lock_id) DO UPDATE
    SET locked_at = excluded.locked_at,
        expires_at = excluded.expires_at
    WHERE lock_row.expires_at <= clock_timestamp()
  RETURNING locked_at INTO acquired_at;

  RETURN acquired_at;
END;
$$;

CREATE FUNCTION public.release_wix_contacts_sync_lock(p_locked_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.wix_contacts_sync_lock
  WHERE lock_id = 'wix_contacts_sync'
    AND locked_at = p_locked_at;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed > 0;
END;
$$;

CREATE FUNCTION public.release_wix_contacts_sync_lock()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.wix_contacts_sync_lock
  WHERE lock_id = 'wix_contacts_sync';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.try_wix_contacts_sync_lock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_wix_contacts_sync_lock() TO service_role;

REVOKE ALL ON FUNCTION public.release_wix_contacts_sync_lock(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_wix_contacts_sync_lock(timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.release_wix_contacts_sync_lock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_wix_contacts_sync_lock() TO service_role;
