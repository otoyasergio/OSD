-- Service advisors, admins, and the time-clock kiosk can punch other staff
-- out (time_clock_update_scoped). Postgres also checks the new row against
-- SELECT policies and rejects the update when that row would disappear.
-- Closed punches were visible only to the subject and to owners/managers, so
-- an advisor sign-out failed with:
--   new row violates row-level security policy for table "time_clock_entry"
-- Sign-in still worked, because a new open punch stays visible.
--
-- Give those same roles read access to punches at their locations so closing
-- one stays visible. Floor techs still see only open punches for other people.

DROP POLICY IF EXISTS time_clock_select_scoped ON public.time_clock_entry;
CREATE POLICY time_clock_select_scoped ON public.time_clock_entry
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
    AND (
      clock_out_at IS NULL
      OR user_id = (SELECT public.current_app_user_id())
      OR (SELECT public.current_app_user_role()) = ANY (
        ARRAY[
          'owner'::text,
          'manager'::text,
          'service_advisor'::text,
          'admin'::text,
          'time_clock_kiosk'::text
        ]
      )
    )
  );
