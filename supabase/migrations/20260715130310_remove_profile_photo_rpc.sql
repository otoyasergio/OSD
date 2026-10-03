-- Profile path writes are performed by the authenticated server action through
-- the server-only admin client. Remove the exposed privileged RPC so clients
-- cannot call a SECURITY DEFINER function directly.
DROP FUNCTION IF EXISTS public.set_own_profile_photo_path(text);
