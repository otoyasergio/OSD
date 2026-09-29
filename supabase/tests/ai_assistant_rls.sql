-- pgTAP: Ask OTOMOTO storage, integrity, grants, and read visibility.
-- Run via `supabase test db` against the isolated local stack.
begin;
select plan(27);

select has_table('public', 'ai_assistant_thread', 'assistant thread table exists');
select has_table('public', 'ai_assistant_message', 'assistant message table exists');
select has_table('public', 'ai_assistant_message_photo', 'assistant photo join exists');
select has_column(
  'public',
  'technician_note',
  'source_ai_message_id',
  'technician notes can trace a reviewed assistant message'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.ai_assistant_thread'::regclass),
  'thread RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.ai_assistant_message'::regclass),
  'message RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.ai_assistant_message_photo'::regclass),
  'message photo RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'public.ai_assistant_thread', 'SELECT')
    and not has_table_privilege('anon', 'public.ai_assistant_thread', 'INSERT')
    and not has_table_privilege('anon', 'public.ai_assistant_thread', 'UPDATE')
    and not has_table_privilege('anon', 'public.ai_assistant_thread', 'DELETE')
    and not has_table_privilege('anon', 'public.ai_assistant_message', 'SELECT')
    and not has_table_privilege('anon', 'public.ai_assistant_message', 'INSERT')
    and not has_table_privilege('anon', 'public.ai_assistant_message', 'UPDATE')
    and not has_table_privilege('anon', 'public.ai_assistant_message', 'DELETE')
    and not has_table_privilege('anon', 'public.ai_assistant_message_photo', 'SELECT')
    and not has_table_privilege('anon', 'public.ai_assistant_message_photo', 'INSERT')
    and not has_table_privilege('anon', 'public.ai_assistant_message_photo', 'UPDATE')
    and not has_table_privilege('anon', 'public.ai_assistant_message_photo', 'DELETE'),
  'anon has no assistant table access'
);
select ok(
  has_table_privilege('authenticated', 'public.ai_assistant_thread', 'SELECT')
    and not has_table_privilege('authenticated', 'public.ai_assistant_thread', 'INSERT')
    and not has_table_privilege('authenticated', 'public.ai_assistant_thread', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.ai_assistant_thread', 'DELETE'),
  'authenticated has read-only thread access'
);
select ok(
  has_table_privilege('authenticated', 'public.ai_assistant_message', 'SELECT')
    and not has_table_privilege('authenticated', 'public.ai_assistant_message', 'INSERT')
    and not has_table_privilege('authenticated', 'public.ai_assistant_message', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.ai_assistant_message', 'DELETE'),
  'authenticated has read-only message access'
);
select ok(
  has_table_privilege('authenticated', 'public.ai_assistant_message_photo', 'SELECT')
    and not has_table_privilege('authenticated', 'public.ai_assistant_message_photo', 'INSERT')
    and not has_table_privilege('authenticated', 'public.ai_assistant_message_photo', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.ai_assistant_message_photo', 'DELETE'),
  'authenticated has read-only photo-link access'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'ai_assistant_thread',
        'ai_assistant_message',
        'ai_assistant_message_photo'
      )
      and cmd <> 'SELECT'
  ),
  0,
  'new tables expose no authenticated write policies'
);
select ok(
  has_table_privilege('service_role', 'public.ai_assistant_thread', 'SELECT')
    and has_table_privilege('service_role', 'public.ai_assistant_thread', 'INSERT')
    and has_table_privilege('service_role', 'public.ai_assistant_thread', 'UPDATE')
    and has_table_privilege('service_role', 'public.ai_assistant_thread', 'DELETE')
    and has_table_privilege('service_role', 'public.ai_assistant_message', 'SELECT')
    and has_table_privilege('service_role', 'public.ai_assistant_message', 'INSERT')
    and has_table_privilege('service_role', 'public.ai_assistant_message', 'UPDATE')
    and has_table_privilege('service_role', 'public.ai_assistant_message', 'DELETE')
    and has_table_privilege(
      'service_role',
      'public.ai_assistant_message_photo',
      'SELECT'
    )
    and has_table_privilege(
      'service_role',
      'public.ai_assistant_message_photo',
      'INSERT'
    )
    and has_table_privilege(
      'service_role',
      'public.ai_assistant_message_photo',
      'UPDATE'
    )
    and has_table_privilege(
      'service_role',
      'public.ai_assistant_message_photo',
      'DELETE'
    ),
  'service role has full data access'
);

insert into public.location (location_id, name, code)
values
  ('10000000-0000-0000-0000-000000000001', 'Assistant Test Toronto', 'AIT'),
  ('10000000-0000-0000-0000-000000000002', 'Assistant Test Other', 'AIO');

insert into public.app_user (
  user_id, auth_user_id, first_name, last_name, email, role, status
) values
  (
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'Assigned', 'Tech', 'assistant-assigned@otomoto.invalid', 'technician', 'active'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000002',
    'Unassigned', 'Tech', 'assistant-unassigned@otomoto.invalid', 'technician', 'active'
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000003',
    'Service', 'Advisor', 'assistant-advisor@otomoto.invalid', 'service_advisor', 'active'
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    '30000000-0000-0000-0000-000000000004',
    'Head', 'Tech', 'assistant-head@otomoto.invalid', 'head_tech', 'active'
  ),
  (
    '20000000-0000-0000-0000-000000000005',
    '30000000-0000-0000-0000-000000000005',
    'Inactive', 'Tech', 'assistant-inactive@otomoto.invalid', 'technician', 'inactive'
  );

insert into public.user_location (user_id, location_id)
select user_id, '10000000-0000-0000-0000-000000000001'
from public.app_user
where user_id between
  '20000000-0000-0000-0000-000000000001'
  and '20000000-0000-0000-0000-000000000005';

insert into public.customer (
  customer_id, first_name, last_name, email
) values (
  '40000000-0000-0000-0000-000000000001',
  'Assistant', 'Customer', 'assistant-customer@otomoto.invalid'
);

insert into public.motorcycle (
  motorcycle_id, customer_id, year, make, model
) values (
  '50000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  2026, 'Test', 'Bike'
);

insert into public.service (service_id, name)
values (
  '60000000-0000-0000-0000-000000000001',
  'Assistant test service'
);

insert into public.work_order (
  work_order_id, motorcycle_id, location_id, work_order_number, status,
  primary_technician_id
) values
  (
    '70000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'AI-TEST-1', 'open',
    '20000000-0000-0000-0000-000000000001'
  ),
  (
    '70000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'AI-TEST-2', 'open', null
  ),
  (
    '70000000-0000-0000-0000-000000000003',
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    'AI-TEST-3', 'open', null
  ),
  (
    '70000000-0000-0000-0000-000000000004',
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'AI-TEST-4', 'safety_check', null
  );

insert into public.job (
  job_id, work_order_id, service_id, service_name_snapshot, status,
  assigned_technician_id
) values
  (
    '80000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    'Assistant test service', 'in_progress',
    '20000000-0000-0000-0000-000000000001'
  ),
  (
    '80000000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    'Assistant second job', 'in_progress',
    '20000000-0000-0000-0000-000000000002'
  );

insert into public.ai_assistant_thread (
  ai_assistant_thread_id, work_order_id, job_id, location_id, mode, audience,
  status, trigger_type, trigger_entity_id, created_by_user_id
) values
  (
    '90000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001',
    '80000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'shop', 'technical', 'ready', 'job_started',
    '80000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003'
  ),
  (
    '90000000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000002',
    null, '10000000-0000-0000-0000-000000000001',
    'advisor', 'technical', 'ready', null, null,
    '20000000-0000-0000-0000-000000000003'
  ),
  (
    '90000000-0000-0000-0000-000000000003',
    '70000000-0000-0000-0000-000000000001',
    null, '10000000-0000-0000-0000-000000000001',
    'advisor', 'front_office', 'ready', null, null,
    '20000000-0000-0000-0000-000000000003'
  ),
  (
    '90000000-0000-0000-0000-000000000004',
    '70000000-0000-0000-0000-000000000003',
    null, '10000000-0000-0000-0000-000000000002',
    'shop', 'technical', 'ready', null, null,
    '20000000-0000-0000-0000-000000000003'
  ),
  (
    '90000000-0000-0000-0000-000000000005',
    '70000000-0000-0000-0000-000000000004',
    null, '10000000-0000-0000-0000-000000000001',
    'shop', 'technical', 'ready', null, null,
    '20000000-0000-0000-0000-000000000003'
  );

insert into public.ai_assistant_message (
  ai_assistant_message_id, thread_id, role, body, generation_status
) values
  (
    'a0000000-0000-0000-0000-000000000001',
    '90000000-0000-0000-0000-000000000001',
    'assistant', 'Assigned thread', 'ready'
  ),
  (
    'a0000000-0000-0000-0000-000000000002',
    '90000000-0000-0000-0000-000000000004',
    'assistant', 'Foreign location thread', 'ready'
  );

insert into public.intake_photo (
  photo_id, work_order_id, job_id, uploaded_by_user_id, storage_path, category
) values
  (
    'b0000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001',
    '80000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'assistant-test/same-job.jpg', 'job_work'
  ),
  (
    'b0000000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000002',
    null,
    '20000000-0000-0000-0000-000000000001',
    'assistant-test/other-wo.jpg', 'other'
  ),
  (
    'b0000000-0000-0000-0000-000000000003',
    '70000000-0000-0000-0000-000000000001',
    '80000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    'assistant-test/other-job.jpg', 'job_proof'
  );

select lives_ok(
  $$
    insert into public.ai_assistant_message_photo (
      message_id, photo_id, sort_order, purpose
    ) values (
      'a0000000-0000-0000-0000-000000000001',
      'b0000000-0000-0000-0000-000000000001',
      0, 'diagnostic_context'
    )
  $$,
  'same-work-order and same-job photo can be linked'
);
select throws_ok(
  $$
    insert into public.ai_assistant_message_photo (
      message_id, photo_id, sort_order, purpose
    ) values (
      'a0000000-0000-0000-0000-000000000001',
      'b0000000-0000-0000-0000-000000000002',
      1, 'diagnostic_context'
    )
  $$,
  'AI_ASSISTANT_PHOTO_WORK_ORDER_MISMATCH',
  'photo from another work order is rejected'
);
select throws_ok(
  $$
    insert into public.ai_assistant_message_photo (
      message_id, photo_id, sort_order, purpose
    ) values (
      'a0000000-0000-0000-0000-000000000001',
      'b0000000-0000-0000-0000-000000000003',
      1, 'diagnostic_context'
    )
  $$,
  'AI_ASSISTANT_PHOTO_JOB_MISMATCH',
  'job work/proof photo from another job is rejected'
);
select throws_ok(
  $$
    insert into public.ai_assistant_thread (
      work_order_id, job_id, location_id, mode, audience, status,
      trigger_type, trigger_entity_id
    ) values (
      '70000000-0000-0000-0000-000000000001',
      '80000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'shop', 'technical', 'pending', 'job_started',
      '80000000-0000-0000-0000-000000000001'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "uq_ai_assistant_thread_trigger_identity"',
  'trigger identity is idempotently unique'
);

select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer from public.ai_assistant_thread),
  1,
  'assigned technician reads only their assigned technical thread'
);
select is(
  (select count(*)::integer from public.ai_assistant_message),
  1,
  'message visibility resolves through the assigned parent thread'
);
select is(
  (select count(*)::integer from public.ai_assistant_message_photo),
  1,
  'photo visibility resolves through the assigned parent thread'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000002',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer from public.ai_assistant_thread),
  1,
  'unassigned technician cannot read another work order but sees their job assignment'
);
select is(
  (
    select count(*)::integer
    from public.ai_assistant_thread
    where audience = 'front_office'
  ),
  0,
  'floor roles cannot read front-office threads'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000003',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer from public.ai_assistant_thread),
  4,
  'service advisor reads both audiences only at their location'
);
select is(
  (
    select count(*)::integer
    from public.ai_assistant_thread
    where location_id = '10000000-0000-0000-0000-000000000002'
  ),
  0,
  'location membership isolates assistant threads'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000004',
  true
);
set local role authenticated;
select is(
  (
    select count(*)::integer
    from public.ai_assistant_thread
    where ai_assistant_thread_id = '90000000-0000-0000-0000-000000000005'
  ),
  1,
  'head tech can read unassigned safety-check technical thread'
);
select is(
  (
    select count(*)::integer
    from public.ai_assistant_thread
    where audience = 'front_office'
  ),
  0,
  'head tech cannot read front-office threads'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000005',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer from public.ai_assistant_thread),
  0,
  'inactive staff cannot read assistant threads'
);
reset role;

select * from finish();
rollback;
