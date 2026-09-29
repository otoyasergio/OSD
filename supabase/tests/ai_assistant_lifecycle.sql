-- pgTAP: atomic Ask OTOMOTO generation lifecycle and service-role boundary.
-- Run only against the isolated local stack with `supabase test db`.
begin;
select plan(38);

select has_column(
  'public',
  'ai_assistant_message',
  'parent_user_message_id',
  'assistant messages have an explicit parent user turn'
);
select has_column(
  'public',
  'ai_assistant_message',
  'requested_provider_model',
  'requested and resolved provider models are persisted separately'
);
select has_column(
  'public',
  'ai_assistant_message',
  'generation_attempt_id',
  'generation attempts have a CAS claim token'
);
select ok(
  to_regclass('public.uq_ai_assistant_message_parent_user') is not null,
  'one assistant placeholder is allowed per explicit user turn'
);

select has_function(
  'public',
  'ask_otomoto_begin_turn',
  array['uuid', 'uuid', 'uuid', 'text', 'jsonb'],
  'atomic begin-turn RPC exists'
);
select has_function(
  'public',
  'ask_otomoto_complete_turn',
  array[
    'uuid', 'uuid', 'uuid', 'text', 'jsonb', 'text', 'text', 'text', 'text',
    'text', 'integer', 'integer', 'timestamptz', 'text'
  ],
  'atomic complete-turn RPC exists'
);
select has_function(
  'public',
  'ask_otomoto_fail_turn',
  array['uuid', 'uuid', 'uuid', 'text'],
  'CAS failure RPC exists'
);
select has_function(
  'public',
  'ask_otomoto_claim_retry',
  array['uuid', 'uuid', 'interval'],
  'latest-turn retry claim RPC exists'
);
select is(
  (
    select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'ai_assistant_validate_promoted_note_policy'
  ),
  false,
  'AI promotion policy trigger runs as the invoking session'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.ask_otomoto_begin_turn(uuid,uuid,uuid,text,jsonb)',
    'EXECUTE'
  ),
  'service role can begin a turn'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.ask_otomoto_begin_turn(uuid,uuid,uuid,text,jsonb)',
    'EXECUTE'
  ),
  'authenticated cannot execute begin-turn'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.ask_otomoto_begin_turn(uuid,uuid,uuid,text,jsonb)',
    'EXECUTE'
  ),
  'anon cannot execute begin-turn'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.ask_otomoto_complete_turn(uuid,uuid,uuid,text,jsonb,text,text,text,text,text,integer,integer,timestamptz,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.ask_otomoto_fail_turn(uuid,uuid,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.ask_otomoto_claim_retry(uuid,uuid,interval)',
    'EXECUTE'
  ),
  'authenticated cannot execute lifecycle write RPCs'
);

insert into public.location (location_id, name, code, status)
values (
  '11000000-0000-4000-8000-000000000001',
  'Lifecycle Test Shop',
  'ALT',
  'active'
);

insert into public.app_user (
  user_id, auth_user_id, first_name, last_name, email, role, status
) values (
  '21000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  'Lifecycle', 'Tech', 'lifecycle-tech@otomoto.invalid', 'technician', 'active'
);

insert into public.user_location (user_id, location_id)
values (
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001'
);

insert into public.customer (customer_id, first_name, last_name, email)
values (
  '41000000-0000-4000-8000-000000000001',
  'Lifecycle', 'Customer', 'lifecycle-customer@otomoto.invalid'
);

insert into public.motorcycle (
  motorcycle_id, customer_id, year, make, model
) values (
  '51000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  2026, 'Test', 'Lifecycle'
);

insert into public.service (service_id, name)
values (
  '61000000-0000-4000-8000-000000000001',
  'Lifecycle diagnostics service'
);

insert into public.work_order (
  work_order_id, motorcycle_id, location_id, work_order_number, status,
  primary_technician_id
) values (
  '71000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'AI-LIFECYCLE-1', 'in_progress',
  '21000000-0000-4000-8000-000000000001'
);

insert into public.job (
  job_id, work_order_id, service_id, service_name_snapshot, status
) values (
  '81000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  'Lifecycle diagnostics service', 'in_progress'
);

insert into public.ai_assistant_thread (
  ai_assistant_thread_id, work_order_id, job_id, location_id, mode, audience,
  status, created_by_user_id
) values (
  '91000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'shop', 'technical', 'pending',
  '21000000-0000-4000-8000-000000000001'
);

insert into public.intake_photo (
  photo_id, work_order_id, job_id, storage_path, category
) values
  (
    'b1000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'assistant-test/lifecycle.jpg', 'job_work'
  ),
  (
    'b1000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'assistant-test/lifecycle-2.jpg', 'job_work'
  );

select throws_like(
  $$
    select *
    from public.ask_otomoto_begin_turn(
      '91000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001',
      'This insert must roll back',
      '[
        {"photo_id":"b1000000-0000-4000-8000-000000000001","purpose":"first","sort_order":0},
        {"photo_id":"b1000000-0000-4000-8000-000000000002","purpose":"duplicate sort","sort_order":0}
      ]'::jsonb
    )
  $$,
  '%duplicate key value violates unique constraint%',
  'photo-link constraint failure rolls back the whole begin command'
);
select is(
  (
    select count(*)::integer
    from public.ai_assistant_message
    where thread_id = '91000000-0000-4000-8000-000000000001'
  ),
  0,
  'partial begin leaves no user or assistant message'
);
select is(
  (
    select status
    from public.ai_assistant_thread
    where ai_assistant_thread_id = '91000000-0000-4000-8000-000000000001'
  ),
  'pending',
  'partial begin leaves thread state unchanged'
);

create temporary table first_turn as
select *
from public.ask_otomoto_begin_turn(
  '91000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  'Original staff diagnostic request',
  '[{"photo_id":"b1000000-0000-4000-8000-000000000001","purpose":"selected evidence","sort_order":0}]'::jsonb
);

select ok(
  user_message_id is not null
    and assistant_message_id is not null
    and generation_attempt_id is not null,
  'begin returns both explicit message IDs and the attempt claim'
)
from first_turn;
select is(
  (
    select count(*)::integer
    from public.ai_assistant_message
    where thread_id = '91000000-0000-4000-8000-000000000001'
  ),
  2,
  'begin inserts exactly one user and one assistant message'
);
select ok(
  (
    select assistant.parent_user_message_id = first_turn.user_message_id
    from first_turn
    join public.ai_assistant_message as assistant
      on assistant.ai_assistant_message_id = first_turn.assistant_message_id
  ),
  'assistant placeholder points to the exact user message'
);
select ok(
  (
    select assistant.created_at > parent.created_at
    from first_turn
    join public.ai_assistant_message as assistant
      on assistant.ai_assistant_message_id = first_turn.assistant_message_id
    join public.ai_assistant_message as parent
      on parent.ai_assistant_message_id = first_turn.user_message_id
  ),
  'atomic begin gives the assistant a deterministic position after its parent'
);
select is(
  (
    select count(*)::integer
    from first_turn
    join public.ai_assistant_message_photo as link
      on link.message_id = first_turn.user_message_id
  ),
  1,
  'selected photo link is part of the atomic begin'
);
select is(
  (
    select status
    from public.ai_assistant_thread
    where ai_assistant_thread_id = '91000000-0000-4000-8000-000000000001'
  ),
  'generating',
  'begin claims the thread'
);
select throws_ok(
  $$
    select *
    from public.ask_otomoto_begin_turn(
      '91000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001',
      'Concurrent duplicate request',
      '[]'::jsonb
    )
  $$,
  'P0001',
  'ASK_OTOMOTO_THREAD_BUSY',
  'a simultaneous begin cannot claim a generating thread'
);
select is(
  (
    select count(*)::integer
    from public.ai_assistant_message
    where thread_id = '91000000-0000-4000-8000-000000000001'
  ),
  2,
  'rejected concurrent begin creates no partial messages'
);

select lives_ok(
  format(
    $sql$
      select public.ask_otomoto_complete_turn(
        '91000000-0000-4000-8000-000000000001',
        %L,
        %L,
        'Rendered safe response',
        '{"type":"none","prompt":null}'::jsonb,
        'diagnosis',
        'model-alias',
        'model-resolved-1',
        'response-1',
        'prompt-v1',
        10,
        20,
        '2026-09-29T05:00:00Z'::timestamptz,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      )
    $sql$,
    (select assistant_message_id from first_turn),
    (select generation_attempt_id from first_turn)
  ),
  'complete atomically persists the response and readies the thread'
);
select ok(
  (
    select
      message.generation_status = 'ready'
      and message.body = 'Rendered safe response'
      and message.requested_provider_model = 'model-alias'
      and message.provider_model = 'model-resolved-1'
      and thread.status = 'ready'
      and thread.diagnostic_phase = 'diagnosis'
    from first_turn
    join public.ai_assistant_message as message
      on message.ai_assistant_message_id = first_turn.assistant_message_id
    join public.ai_assistant_thread as thread
      on thread.ai_assistant_thread_id = message.thread_id
  ),
  'complete stores requested/resolved models and matching ready states'
);
select throws_ok(
  format(
    $sql$
      insert into public.technician_note (
        work_order_id, job_id, created_by_user_id, note, note_type,
        source_ai_message_id
      ) values (
        '71000000-0000-4000-8000-000000000001',
        '81000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        'Must not satisfy proof',
        'proof_exception',
        %L
      )
    $sql$,
    (select assistant_message_id from first_turn)
  ),
  'P0001',
  'ASK_OTOMOTO_NOTE_TYPE_NOT_ALLOWED',
  'AI provenance cannot create a workflow-gating proof note'
);
select throws_ok(
  format(
    $sql$
      insert into public.technician_note (
        work_order_id, job_id, created_by_user_id, note, note_type,
        source_ai_message_id
      ) values (
        '71000000-0000-4000-8000-000000000001',
        null,
        '21000000-0000-4000-8000-000000000001',
        'Missing exact job',
        'diagnostic_finding',
        %L
      )
    $sql$,
    (select assistant_message_id from first_turn)
  ),
  'P0001',
  'ASK_OTOMOTO_NOTE_JOB_MISMATCH',
  'job-scoped AI provenance requires the exact non-null job'
);
select is(
  (
    select public.ask_otomoto_fail_turn(
      '91000000-0000-4000-8000-000000000001',
      assistant_message_id,
      generation_attempt_id,
      'DIAGNOSTICS_AI_PROVIDER_FAILED'
    )
    from first_turn
  ),
  false,
  'failure CAS cannot overwrite a ready response'
);
select is(
  (
    select body
    from first_turn
    join public.ai_assistant_message as message
      on message.ai_assistant_message_id = first_turn.assistant_message_id
  ),
  'Rendered safe response',
  'ready response remains intact after late failure'
);

create temporary table second_turn as
select *
from public.ask_otomoto_begin_turn(
  '91000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  'Retryable staff request',
  '[]'::jsonb
);

select is(
  (
    select public.ask_otomoto_fail_turn(
      '91000000-0000-4000-8000-000000000001',
      assistant_message_id,
      generation_attempt_id,
      'DIAGNOSTICS_AI_PROVIDER_UNAVAILABLE'
    )
    from second_turn
  ),
  true,
  'generating assistant can be failed exactly once'
);

create temporary table failed_retry as
select *
from public.ask_otomoto_claim_retry(
  '91000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  interval '270 seconds'
);

select ok(
  (
    select
      failed_retry.user_message_id = second_turn.user_message_id
      and failed_retry.assistant_message_id = second_turn.assistant_message_id
      and message.generation_status = 'generating'
    from failed_retry
    cross join second_turn
    join public.ai_assistant_message as message
      on message.ai_assistant_message_id = failed_retry.assistant_message_id
  ),
  'failed retry reuses the exact parent and assistant without duplicate user text'
);

update public.ai_assistant_message
set updated_at = clock_timestamp() - interval '4 minutes'
where ai_assistant_message_id = (select assistant_message_id from second_turn);

select throws_ok(
  $$
    select *
    from public.ask_otomoto_claim_retry(
      '91000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001',
      interval '270 seconds'
    )
  $$,
  'P0001',
  'ASK_OTOMOTO_RETRY_NOT_FOUND',
  'maximum configured two-attempt timeout plus margin is not stale at four minutes'
);

update public.ai_assistant_message
set
  updated_at = clock_timestamp() - interval '5 minutes',
  phase = 'repair_in_progress'
where ai_assistant_message_id = (select assistant_message_id from second_turn);

create temporary table stale_retry as
select *
from public.ask_otomoto_claim_retry(
  '91000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  interval '270 seconds'
);

select throws_ok(
  format(
    $sql$
      select public.ask_otomoto_complete_turn(
        '91000000-0000-4000-8000-000000000001',
        %L,
        %L,
        'Late stale worker output',
        null,
        'diagnosis',
        'model-alias',
        'model-resolved-stale',
        'response-stale',
        'prompt-v1',
        null,
        null,
        now(),
        null
      )
    $sql$,
    (select assistant_message_id from failed_retry),
    (select generation_attempt_id from failed_retry)
  ),
  'P0001',
  'ASK_OTOMOTO_COMPLETE_CONFLICT',
  'a superseded stale attempt cannot complete after retry reclaims the turn'
);

select ok(
  (
    select
      stale_retry.user_message_id = second_turn.user_message_id
      and stale_retry.assistant_message_id = second_turn.assistant_message_id
      and message.phase = 'repair_in_progress'
    from stale_retry
    cross join second_turn
    join public.ai_assistant_message as message
      on message.ai_assistant_message_id = stale_retry.assistant_message_id
  ),
  'stale-generating retry recovers the same turn and preserves phase'
);

insert into public.ai_assistant_message (
  thread_id, role, body, generation_status, created_by_user_id, created_at, updated_at
) values (
  '91000000-0000-4000-8000-000000000001',
  'user', 'Later message blocks retrying an older assistant', 'ready',
  '21000000-0000-4000-8000-000000000001',
  clock_timestamp() + interval '1 second',
  clock_timestamp() + interval '1 second'
);

select throws_ok(
  $$
    select *
    from public.ask_otomoto_claim_retry(
      '91000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001',
      interval '0 seconds'
    )
  $$,
  'P0001',
  'ASK_OTOMOTO_RETRY_NOT_FOUND',
  'retry refuses an older assistant when it is not the latest message'
);
select throws_ok(
  $$
    select public.ask_otomoto_complete_turn(
      '91000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000099',
      'a2000000-0000-4000-8000-000000000099',
      'Must not persist',
      null,
      'diagnosis',
      'model-alias',
      'model-resolved',
      'response-missing',
      'prompt-v1',
      null,
      null,
      now(),
      null
    )
  $$,
  'P0001',
  'ASK_OTOMOTO_COMPLETE_CONFLICT',
  'complete requires the exact generating assistant CAS'
);
select is(
  (
    select generation_status
    from second_turn
    join public.ai_assistant_message as message
      on message.ai_assistant_message_id = second_turn.assistant_message_id
  ),
  'generating',
  'failed complete leaves the actual generating assistant unchanged'
);

select * from finish();
rollback;
