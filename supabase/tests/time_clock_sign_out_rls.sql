-- pgTAP: roles that may punch other staff out must be able to close a punch.
-- Postgres rejects the update when the closed row would fail SELECT.
begin;
select plan(5);

insert into public.location (location_id, name, code, status)
values (
  'c1000000-0000-0000-0000-000000000001',
  'Clock Sign-Out Test',
  'CLK',
  'active'
);

insert into public.app_user (
  user_id, auth_user_id, first_name, last_name, email, role, status
) values
  (
    'c2000000-0000-0000-0000-000000000001',
    'c3000000-0000-0000-0000-000000000001',
    'Clock', 'Advisor', 'clock-signout-advisor@otomoto.invalid',
    'service_advisor', 'active'
  ),
  (
    'c2000000-0000-0000-0000-000000000002',
    'c3000000-0000-0000-0000-000000000002',
    'Clock', 'Tech', 'clock-signout-tech@otomoto.invalid',
    'technician', 'active'
  ),
  (
    'c2000000-0000-0000-0000-000000000003',
    'c3000000-0000-0000-0000-000000000003',
    'Clock', 'Subject', 'clock-signout-subject@otomoto.invalid',
    'technician', 'active'
  );

insert into public.user_location (user_id, location_id)
values
  (
    'c2000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000001'
  ),
  (
    'c2000000-0000-0000-0000-000000000002',
    'c1000000-0000-0000-0000-000000000001'
  ),
  (
    'c2000000-0000-0000-0000-000000000003',
    'c1000000-0000-0000-0000-000000000001'
  );

insert into public.time_clock_entry (
  entry_id, user_id, location_id, clock_in_at
) values (
  'c4000000-0000-0000-0000-000000000001',
  'c2000000-0000-0000-0000-000000000003',
  'c1000000-0000-0000-0000-000000000001',
  timestamptz '2026-10-23 12:00:00+00'
);

select set_config(
  'request.jwt.claim.sub',
  'c3000000-0000-0000-0000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$
    update public.time_clock_entry
    set clock_out_at = clock_in_at + interval '8 hours'
    where entry_id = 'c4000000-0000-0000-0000-000000000001'
  $$,
  'service advisor can sign a technician out'
);

select ok(
  (
    select clock_out_at is not null
    from public.time_clock_entry
    where entry_id = 'c4000000-0000-0000-0000-000000000001'
  ),
  'closed punch stays visible to the advisor who signed them out'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  'c3000000-0000-0000-0000-000000000002',
  true
);
set local role authenticated;

select is(
  (
    select count(*)::integer
    from public.time_clock_entry
    where entry_id = 'c4000000-0000-0000-0000-000000000001'
  ),
  0,
  'a floor tech cannot read another person''s closed punch'
);

reset role;
insert into public.time_clock_entry (
  entry_id, user_id, location_id, clock_in_at
) values (
  'c4000000-0000-0000-0000-000000000002',
  'c2000000-0000-0000-0000-000000000003',
  'c1000000-0000-0000-0000-000000000001',
  timestamptz '2026-10-23 13:00:00+00'
);

select set_config(
  'request.jwt.claim.sub',
  'c3000000-0000-0000-0000-000000000002',
  true
);
set local role authenticated;

select lives_ok(
  $$
    update public.time_clock_entry
    set clock_out_at = clock_in_at + interval '1 hour'
    where entry_id = 'c4000000-0000-0000-0000-000000000002'
  $$,
  'a floor tech update of someone else''s punch does not raise'
);

select is(
  (
    select clock_out_at is null
    from public.time_clock_entry
    where entry_id = 'c4000000-0000-0000-0000-000000000002'
  ),
  true,
  'a floor tech still cannot sign another technician out'
);

select * from finish();
rollback;
