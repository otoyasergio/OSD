-- Retire Ottawa (OTT) and fold its shop records into Toronto (TOR).
-- Idempotent: no-ops when OTT is missing, already inactive, or TOR is absent.

create or replace function public.user_location_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select ul.location_id
  from user_location ul
  join location loc on loc.location_id = ul.location_id
  where ul.user_id = current_app_user_id()
    and loc.status = 'active';
$$;

do $$
declare
  ott uuid;
  tor uuid;
begin
  select location_id into tor from public.location where code = 'TOR';
  select location_id into ott from public.location where code = 'OTT';

  if tor is null or ott is null or ott = tor then
    return;
  end if;

  -- Toronto already issued some of the same ticket numbers. Keep Ottawa's
  -- original digits visible with an -OTT suffix so the unique
  -- (location_id, work_order_number) index is not violated.
  update public.work_order wo
  set work_order_number = wo.work_order_number || '-OTT'
  where wo.location_id = ott
    and wo.work_order_number not like '%-OTT'
    and exists (
      select 1
      from public.work_order tor_wo
      where tor_wo.location_id = tor
        and tor_wo.work_order_number = wo.work_order_number
    );

  update public.appointment set location_id = tor where location_id = ott;
  update public.audit_log set location_id = tor where location_id = ott;
  update public.estimate set location_id = tor where location_id = ott;
  update public.invoice set location_id = tor where location_id = ott;
  update public.job_blocker set location_id = tor where location_id = ott;
  update public.job_time_entry set location_id = tor where location_id = ott;
  update public.labour_rate set location_id = tor where location_id = ott;
  update public.phone_call set location_id = tor where location_id = ott;
  update public.purchase_order set location_id = tor where location_id = ott;
  update public.quality_check_attempt set location_id = tor where location_id = ott;
  update public.safety_check_attempt set location_id = tor where location_id = ott;
  update public.service_finding set location_id = tor where location_id = ott;
  update public.shop_closure set location_id = tor where location_id = ott;
  update public.staff_notification set location_id = tor where location_id = ott;
  update public.staff_voice_presence set location_id = tor where location_id = ott;
  update public.time_clock_entry set location_id = tor where location_id = ott;
  update public.timesheet_week set location_id = tor where location_id = ott;
  update public.ux_event set location_id = tor where location_id = ott;
  update public.work_order set location_id = tor where location_id = ott;

  insert into public.user_location (user_id, location_id)
  select user_id, tor
  from public.user_location
  where location_id = ott
  on conflict (user_id, location_id) do nothing;

  delete from public.user_location where location_id = ott;

  update public.location
  set status = 'inactive', updated_at = now()
  where location_id = ott
    and status is distinct from 'inactive';
end $$;
