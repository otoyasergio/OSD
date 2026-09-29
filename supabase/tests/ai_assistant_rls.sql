-- pgTAP: Ask OTOMOTO storage, integrity, grants, and read visibility.
-- Run via `supabase test db` against the isolated local stack.
begin;
select plan(67);

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

insert into public.location (location_id, name, code, status)
values
  (
    '10000000-0000-0000-0000-000000000001',
    'Assistant Test Toronto',
    'AIT',
    'active'
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'Assistant Test Other',
    'AIO',
    'active'
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    'Assistant Test Inactive',
    'AII',
    'inactive'
  );

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
  ),
  (
    '20000000-0000-0000-0000-000000000006',
    '30000000-0000-0000-0000-000000000006',
    'Quality', 'Tech', 'assistant-qc@otomoto.invalid', 'technician', 'active'
  ),
  (
    '20000000-0000-0000-0000-000000000007',
    '30000000-0000-0000-0000-000000000007',
    'Job', 'Tech', 'assistant-job@otomoto.invalid', 'technician', 'active'
  ),
  (
    '20000000-0000-0000-0000-000000000008',
    '30000000-0000-0000-0000-000000000008',
    'No Membership', 'Tech', 'assistant-no-membership@otomoto.invalid',
    'technician', 'active'
  ),
  (
    '20000000-0000-0000-0000-000000000009',
    '30000000-0000-0000-0000-000000000009',
    'Closed Shop', 'Tech', 'assistant-inactive-location@otomoto.invalid',
    'technician', 'active'
  );

insert into public.user_location (user_id, location_id)
select user_id, '10000000-0000-0000-0000-000000000001'
from public.app_user
where user_id between
  '20000000-0000-0000-0000-000000000001'
  and '20000000-0000-0000-0000-000000000007';

insert into public.user_location (user_id, location_id)
values (
  '20000000-0000-0000-0000-000000000009',
  '10000000-0000-0000-0000-000000000003'
);

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
  primary_technician_id, quality_check_assigned_to
) values
  (
    '70000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'AI-TEST-1', 'open',
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000006'
  ),
  (
    '70000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'AI-TEST-2', 'open', null, null
  ),
  (
    '70000000-0000-0000-0000-000000000003',
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    'AI-TEST-3', 'open',
    '20000000-0000-0000-0000-000000000008', null
  ),
  (
    '70000000-0000-0000-0000-000000000004',
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'AI-TEST-4', 'safety_check', null, null
  ),
  (
    '70000000-0000-0000-0000-000000000005',
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000003',
    'AI-TEST-5', 'open',
    '20000000-0000-0000-0000-000000000009', null
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
    '20000000-0000-0000-0000-000000000007'
  ),
  (
    '80000000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    'Assistant second job', 'in_progress', null
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
    'shop', 'technical', 'ready', 'inspection_completed',
    '80000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003'
  ),
  (
    '90000000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000002',
    null, '10000000-0000-0000-0000-000000000001',
    'shop', 'technical', 'ready', null, null,
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
  ),
  (
    '90000000-0000-0000-0000-000000000006',
    '70000000-0000-0000-0000-000000000001',
    '80000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'teach', 'technical', 'ready', null, null,
    '20000000-0000-0000-0000-000000000003'
  ),
  (
    '90000000-0000-0000-0000-000000000007',
    '70000000-0000-0000-0000-000000000005',
    null, '10000000-0000-0000-0000-000000000003',
    'shop', 'technical', 'ready', null, null,
    '20000000-0000-0000-0000-000000000003'
  );

insert into public.ai_assistant_message (
  ai_assistant_message_id, thread_id, role, body, generation_status, phase
) values
  (
    'a0000000-0000-0000-0000-000000000001',
    '90000000-0000-0000-0000-000000000001',
    'assistant', 'Assigned thread', 'ready', 'diagnosis'
  ),
  (
    'a0000000-0000-0000-0000-000000000002',
    '90000000-0000-0000-0000-000000000004',
    'assistant', 'Foreign location thread', 'ready', 'diagnosis'
  ),
  (
    'a0000000-0000-0000-0000-000000000003',
    '90000000-0000-0000-0000-000000000002',
    'assistant', 'Unassigned work order', 'ready', 'information_needed'
  ),
  (
    'a0000000-0000-0000-0000-000000000004',
    '90000000-0000-0000-0000-000000000003',
    'assistant', 'Front office draft', 'ready', 'diagnosis'
  ),
  (
    'a0000000-0000-0000-0000-000000000005',
    '90000000-0000-0000-0000-000000000001',
    'user', 'Technician input', 'ready', 'information_needed'
  ),
  (
    'a0000000-0000-0000-0000-000000000006',
    '90000000-0000-0000-0000-000000000001',
    'assistant', null, 'generating', 'diagnosis'
  ),
  (
    'a0000000-0000-0000-0000-000000000007',
    '90000000-0000-0000-0000-000000000006',
    'assistant', 'Other job output', 'ready', 'repair_planning'
  ),
  (
    'a0000000-0000-0000-0000-000000000008',
    '90000000-0000-0000-0000-000000000005',
    'assistant', 'Safety output', 'ready', 'verification'
  ),
  (
    'a0000000-0000-0000-0000-000000000009',
    '90000000-0000-0000-0000-000000000007',
    'assistant', 'Inactive location output', 'ready', 'diagnosis'
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

select throws_ok(
  $$
    insert into public.ai_assistant_thread (
      work_order_id, location_id, mode, audience
    ) values (
      '70000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'shop', 'front_office'
    )
  $$,
  '23514',
  'new row for relation "ai_assistant_thread" violates check constraint "ai_assistant_thread_mode_audience_check"',
  'technical mode cannot be persisted as front-office'
);
select throws_ok(
  $$
    insert into public.ai_assistant_thread (
      work_order_id, location_id, mode, audience
    ) values (
      '70000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'advisor', 'technical'
    )
  $$,
  '23514',
  'new row for relation "ai_assistant_thread" violates check constraint "ai_assistant_thread_mode_audience_check"',
  'front-office mode cannot be persisted as technical'
);
select throws_ok(
  $$
    insert into public.ai_assistant_thread (
      work_order_id, location_id, mode, audience,
      trigger_type, trigger_entity_id
    ) values (
      '70000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'shop', 'technical',
      'arbitrary_event', '80000000-0000-0000-0000-000000000001'
    )
  $$,
  '23514',
  'new row for relation "ai_assistant_thread" violates check constraint "ai_assistant_thread_trigger_type_check"',
  'unplanned trigger types are rejected'
);
select throws_ok(
  $$
    insert into public.ai_assistant_thread (
      work_order_id, location_id, mode, audience, diagnostic_phase
    ) values (
      '70000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'shop', 'technical', 'guessing'
    )
  $$,
  '23514',
  'new row for relation "ai_assistant_thread" violates check constraint "ai_assistant_thread_diagnostic_phase_check"',
  'thread diagnostic phase is constrained'
);
select throws_ok(
  $$
    insert into public.ai_assistant_message (
      thread_id, role, body, generation_status, phase
    ) values (
      '90000000-0000-0000-0000-000000000001',
      'assistant', 'Invalid phase', 'ready', 'guessing'
    )
  $$,
  '23514',
  'new row for relation "ai_assistant_message" violates check constraint "ai_assistant_message_phase_check"',
  'message phase is constrained'
);
select throws_ok(
  $$
    insert into public.ai_assistant_message (
      thread_id, role, generation_status, phase
    ) values (
      '90000000-0000-0000-0000-000000000001',
      'assistant', 'ready', 'diagnosis'
    )
  $$,
  '23514',
  'new row for relation "ai_assistant_message" violates check constraint "ai_assistant_message_generation_payload_check"',
  'ready messages require a body'
);
select throws_ok(
  $$
    insert into public.ai_assistant_message (
      thread_id, role, generation_status, phase
    ) values (
      '90000000-0000-0000-0000-000000000001',
      'assistant', 'failed', 'diagnosis'
    )
  $$,
  '23514',
  'new row for relation "ai_assistant_message" violates check constraint "ai_assistant_message_generation_payload_check"',
  'failed messages require a safe error code'
);
select lives_ok(
  $$
    insert into public.ai_assistant_message (
      ai_assistant_message_id, thread_id, role, generation_status, phase,
      safe_error_code
    ) values (
      'a0000000-0000-0000-0000-00000000000a',
      '90000000-0000-0000-0000-000000000001',
      'assistant', 'policy_withheld', 'diagnosis', 'UNSAFE_OUTPUT_WITHHELD'
    )
  $$,
  'policy-withheld output persists only a safe failure state'
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
    update public.ai_assistant_thread
    set job_id = '80000000-0000-0000-0000-000000000002'
    where ai_assistant_thread_id = '90000000-0000-0000-0000-000000000001'
  $$,
  'AI_ASSISTANT_THREAD_SCOPE_IMMUTABLE',
  'thread scope cannot be arbitrarily reparented'
);
select throws_ok(
  $$
    update public.ai_assistant_message
    set thread_id = '90000000-0000-0000-0000-000000000006'
    where ai_assistant_message_id = 'a0000000-0000-0000-0000-000000000001'
  $$,
  'AI_ASSISTANT_MESSAGE_THREAD_IMMUTABLE',
  'message cannot be arbitrarily reparented'
);
select throws_ok(
  $$
    update public.intake_photo
    set work_order_id = '70000000-0000-0000-0000-000000000002'
    where photo_id = 'b0000000-0000-0000-0000-000000000001'
  $$,
  'AI_ASSISTANT_PHOTO_WORK_ORDER_MISMATCH',
  'linked photo cannot be moved to another work order'
);
select throws_ok(
  $$
    update public.intake_photo
    set job_id = '80000000-0000-0000-0000-000000000002'
    where photo_id = 'b0000000-0000-0000-0000-000000000001'
  $$,
  'AI_ASSISTANT_PHOTO_JOB_MISMATCH',
  'linked job photo cannot be moved to another job'
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
      'shop', 'technical', 'pending', 'inspection_completed',
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
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.ai_assistant_thread),
  2,
  'primary-only technician reads technical threads for their work order'
);
select is(
  (select count(*)::integer from public.ai_assistant_message),
  5,
  'message visibility resolves through the assigned parent thread'
);
select is(
  (select count(*)::integer from public.ai_assistant_message_photo),
  1,
  'photo visibility resolves through the assigned parent thread'
);
select throws_ok(
  $$
    insert into public.ai_assistant_thread (
      work_order_id, location_id, mode, audience
    ) values (
      '70000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'shop', 'technical'
    )
  $$,
  '42501',
  'permission denied for table ai_assistant_thread',
  'authenticated caller cannot actually insert a thread'
);
select throws_ok(
  $$
    insert into public.ai_assistant_message (
      thread_id, role, body, generation_status
    ) values (
      '90000000-0000-0000-0000-000000000001',
      'user', 'forged', 'ready'
    )
  $$,
  '42501',
  'permission denied for table ai_assistant_message',
  'authenticated caller cannot actually insert a message'
);
select throws_ok(
  $$
    insert into public.ai_assistant_message_photo (
      message_id, photo_id, sort_order, purpose
    ) values (
      'a0000000-0000-0000-0000-000000000001',
      'b0000000-0000-0000-0000-000000000001',
      99, 'forged'
    )
  $$,
  '42501',
  'permission denied for table ai_assistant_message_photo',
  'authenticated caller cannot actually insert a photo link'
);
select throws_ok(
  $$
    update public.ai_assistant_thread
    set status = 'archived'
    where ai_assistant_thread_id = '90000000-0000-0000-0000-000000000001'
  $$,
  '42501',
  'permission denied for table ai_assistant_thread',
  'authenticated caller cannot actually update a thread'
);
select throws_ok(
  $$
    delete from public.ai_assistant_thread
    where ai_assistant_thread_id = '90000000-0000-0000-0000-000000000001'
  $$,
  '42501',
  'permission denied for table ai_assistant_thread',
  'authenticated caller cannot actually delete a thread'
);
select lives_ok(
  $$
    insert into public.technician_note (
      work_order_id, job_id, created_by_user_id, note, source_ai_message_id
    ) values (
      '70000000-0000-0000-0000-000000000001',
      '80000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'Reviewed ready assistant output',
      'a0000000-0000-0000-0000-000000000001'
    )
  $$,
  'viewable ready technical assistant output can be cited'
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
  0,
  'truly unassigned technician cannot read technical threads'
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
select is(
  (select count(*)::integer from public.ai_assistant_message),
  0,
  'unassigned technician cannot read assistant messages'
);
select is(
  (select count(*)::integer from public.ai_assistant_message_photo),
  0,
  'unassigned technician cannot read assistant photo links'
);
select throws_ok(
  $$
    insert into public.technician_note (
      work_order_id, job_id, created_by_user_id, note, source_ai_message_id
    ) values (
      '70000000-0000-0000-0000-000000000001',
      '80000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      'Forged inaccessible source',
      'a0000000-0000-0000-0000-000000000001'
    )
  $$,
  'AI_ASSISTANT_NOTE_SOURCE_NOT_VIEWABLE',
  'authenticated caller cannot cite an inaccessible assistant message'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000006',
  true
);
set local role authenticated;
select is(
  (
    select count(*)::integer
    from public.ai_assistant_thread
    where work_order_id = '70000000-0000-0000-0000-000000000001'
  ),
  2,
  'QC-only technician reads WO-level technical sharing'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000007',
  true
);
set local role authenticated;
select is(
  (
    select count(*)::integer
    from public.ai_assistant_thread
    where work_order_id = '70000000-0000-0000-0000-000000000001'
  ),
  2,
  'job-assigned technician reads WO-level technical sharing'
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
  5,
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
    where ai_assistant_thread_id = '90000000-0000-0000-0000-000000000002'
  ),
  0,
  'head tech without assignment cannot read non-safety thread'
);
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
  '30000000-0000-0000-0000-000000000008',
  true
);
set local role authenticated;
select is(
  (
    select count(*)::integer
    from public.ai_assistant_thread
    where ai_assistant_thread_id = '90000000-0000-0000-0000-000000000004'
  ),
  0,
  'technician assignment at a non-member location does not grant access'
);
select is(
  (
    select count(*)::integer
    from public.ai_assistant_message
    where ai_assistant_message_id = 'a0000000-0000-0000-0000-000000000002'
  ),
  0,
  'non-member technician cannot read the foreign-location message'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000009',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer from public.ai_assistant_thread),
  0,
  'membership and assignment at an inactive location do not grant access'
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

select throws_ok(
  $$
    insert into public.technician_note (
      work_order_id, job_id, note, source_ai_message_id
    ) values (
      '70000000-0000-0000-0000-000000000002',
      null,
      'Forged cross-work-order provenance',
      'a0000000-0000-0000-0000-000000000001'
    )
  $$,
  'AI_ASSISTANT_NOTE_WORK_ORDER_MISMATCH',
  'assistant note provenance cannot cross work orders'
);
select throws_ok(
  $$
    insert into public.technician_note (
      work_order_id, job_id, note, source_ai_message_id
    ) values (
      '70000000-0000-0000-0000-000000000001',
      '80000000-0000-0000-0000-000000000002',
      'Forged cross-job provenance',
      'a0000000-0000-0000-0000-000000000001'
    )
  $$,
  'AI_ASSISTANT_NOTE_JOB_MISMATCH',
  'assistant note provenance cannot cross jobs when both are scoped'
);
select throws_ok(
  $$
    insert into public.technician_note (
      work_order_id, job_id, note, source_ai_message_id
    ) values (
      '70000000-0000-0000-0000-000000000001',
      '80000000-0000-0000-0000-000000000001',
      'Forged user-message provenance',
      'a0000000-0000-0000-0000-000000000005'
    )
  $$,
  'AI_ASSISTANT_NOTE_SOURCE_NOT_ASSISTANT',
  'technician note provenance requires assistant output'
);
select throws_ok(
  $$
    insert into public.technician_note (
      work_order_id, job_id, note, source_ai_message_id
    ) values (
      '70000000-0000-0000-0000-000000000001',
      '80000000-0000-0000-0000-000000000001',
      'Forged non-ready provenance',
      'a0000000-0000-0000-0000-000000000006'
    )
  $$,
  'AI_ASSISTANT_NOTE_SOURCE_NOT_READY',
  'technician note provenance requires ready output'
);
select throws_ok(
  $$
    insert into public.technician_note (
      work_order_id, note, source_ai_message_id
    ) values (
      '70000000-0000-0000-0000-000000000001',
      'Forged front-office provenance',
      'a0000000-0000-0000-0000-000000000004'
    )
  $$,
  'AI_ASSISTANT_NOTE_SOURCE_NOT_TECHNICAL',
  'front-office drafts cannot become technician-note provenance'
);

set local role service_role;
select lives_ok(
  $$
    insert into public.technician_note (
      work_order_id, job_id, note, source_ai_message_id
    ) values (
      '70000000-0000-0000-0000-000000000001',
      '80000000-0000-0000-0000-000000000001',
      'Server-reviewed provenance',
      'a0000000-0000-0000-0000-000000000001'
    )
  $$,
  'service-role note write supports valid provenance'
);
reset role;

insert into public.work_order (
  work_order_id, motorcycle_id, location_id, work_order_number, status
) values
  (
    '70000000-0000-0000-0000-000000000006',
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'AI-DELETE-JOB', 'open'
  ),
  (
    '70000000-0000-0000-0000-000000000007',
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'AI-DELETE-WO', 'open'
  );

insert into public.job (
  job_id, work_order_id, service_id, service_name_snapshot, status
) values
  (
    '80000000-0000-0000-0000-000000000006',
    '70000000-0000-0000-0000-000000000006',
    '60000000-0000-0000-0000-000000000001',
    'Delete job test', 'draft'
  ),
  (
    '80000000-0000-0000-0000-000000000007',
    '70000000-0000-0000-0000-000000000007',
    '60000000-0000-0000-0000-000000000001',
    'Delete work order test', 'draft'
  );

insert into public.ai_assistant_thread (
  ai_assistant_thread_id, work_order_id, job_id, location_id, mode, audience
) values
  (
    '90000000-0000-0000-0000-000000000008',
    '70000000-0000-0000-0000-000000000006',
    '80000000-0000-0000-0000-000000000006',
    '10000000-0000-0000-0000-000000000001',
    'shop', 'technical'
  ),
  (
    '90000000-0000-0000-0000-000000000009',
    '70000000-0000-0000-0000-000000000007',
    '80000000-0000-0000-0000-000000000007',
    '10000000-0000-0000-0000-000000000001',
    'shop', 'technical'
  );

insert into public.ai_assistant_message (
  ai_assistant_message_id, thread_id, role, body, generation_status
) values
  (
    'a0000000-0000-0000-0000-00000000000b',
    '90000000-0000-0000-0000-000000000008',
    'assistant', 'Delete job message', 'ready'
  ),
  (
    'a0000000-0000-0000-0000-00000000000c',
    '90000000-0000-0000-0000-000000000009',
    'assistant', 'Delete work order message', 'ready'
  );

insert into public.intake_photo (
  photo_id, work_order_id, job_id, storage_path, category
) values
  (
    'b0000000-0000-0000-0000-000000000006',
    '70000000-0000-0000-0000-000000000006',
    '80000000-0000-0000-0000-000000000006',
    'assistant-test/delete-job.jpg', 'job_work'
  ),
  (
    'b0000000-0000-0000-0000-000000000007',
    '70000000-0000-0000-0000-000000000007',
    '80000000-0000-0000-0000-000000000007',
    'assistant-test/delete-wo.jpg', 'job_work'
  );

insert into public.ai_assistant_message_photo (
  message_id, photo_id, purpose
) values
  (
    'a0000000-0000-0000-0000-00000000000b',
    'b0000000-0000-0000-0000-000000000006',
    'deletion_test'
  ),
  (
    'a0000000-0000-0000-0000-00000000000c',
    'b0000000-0000-0000-0000-000000000007',
    'deletion_test'
  );

select lives_ok(
  $$
    delete from public.job
    where job_id = '80000000-0000-0000-0000-000000000006'
  $$,
  'deleting a scoped job succeeds'
);
select ok(
  (
    select job_id is null
    from public.ai_assistant_thread
    where ai_assistant_thread_id = '90000000-0000-0000-0000-000000000008'
  )
  and (
    select job_id is null
    from public.intake_photo
    where photo_id = 'b0000000-0000-0000-0000-000000000006'
  ),
  'job deletion clears thread and linked-photo job scope'
);
select is(
  (
    select count(*)::integer
    from public.ai_assistant_message_photo
    where photo_id = 'b0000000-0000-0000-0000-000000000006'
  ),
  1,
  'job deletion preserves the photo link'
);
select lives_ok(
  $$
    delete from public.intake_photo
    where photo_id = 'b0000000-0000-0000-0000-000000000006'
  $$,
  'deleting an intake photo cascades its assistant link'
);
select is(
  (
    select count(*)::integer
    from public.ai_assistant_message_photo
    where photo_id = 'b0000000-0000-0000-0000-000000000006'
  ),
  0,
  'photo deletion removes the assistant join row'
);
select lives_ok(
  $$
    delete from public.work_order
    where work_order_id = '70000000-0000-0000-0000-000000000007'
  $$,
  'deleting a work order cascades assistant and photo records'
);
select is(
  (
    select count(*)::integer
    from public.ai_assistant_thread
    where ai_assistant_thread_id = '90000000-0000-0000-0000-000000000009'
  )
  + (
    select count(*)::integer
    from public.ai_assistant_message
    where ai_assistant_message_id = 'a0000000-0000-0000-0000-00000000000c'
  )
  + (
    select count(*)::integer
    from public.ai_assistant_message_photo
    where photo_id = 'b0000000-0000-0000-0000-000000000007'
  )
  + (
    select count(*)::integer
    from public.intake_photo
    where photo_id = 'b0000000-0000-0000-0000-000000000007'
  ),
  0,
  'work-order cascade leaves no assistant or photo rows'
);

select * from finish();
rollback;
