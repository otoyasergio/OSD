-- pgTAP: platform hardening privileges and operational indexes.
begin;
select plan(12);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.workflow_v2_job_authorization(uuid)',
    'EXECUTE'
  ),
  'authenticated cannot call workflow authorization detail helper'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.workflow_v2_job_is_authorized(uuid)',
    'EXECUTE'
  ),
  'authenticated cannot call workflow authorization boolean helper'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.mint_work_order_number(uuid)',
    'EXECUTE'
  ),
  'authenticated cannot consume work-order sequence numbers'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.workflow_v2_job_authorization(uuid)',
    'EXECUTE'
  ),
  'service role can call workflow authorization detail helper'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.workflow_v2_job_is_authorized(uuid)',
    'EXECUTE'
  ),
  'service role can call workflow authorization boolean helper'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.mint_work_order_number(uuid)',
    'EXECUTE'
  ),
  'service role can mint work-order numbers'
);

select ok(
  not has_table_privilege('anon', 'public.square_webhook_event', 'SELECT')
    and not has_table_privilege('anon', 'public.square_webhook_event', 'INSERT')
    and not has_table_privilege('anon', 'public.square_webhook_event', 'UPDATE')
    and not has_table_privilege('anon', 'public.square_webhook_event', 'DELETE')
    and not has_table_privilege('anon', 'public.square_webhook_event', 'TRUNCATE'),
  'anonymous clients have no Square webhook event privileges'
);
select ok(
  not has_table_privilege('authenticated', 'public.square_webhook_event', 'SELECT')
    and not has_table_privilege(
      'authenticated',
      'public.square_webhook_event',
      'INSERT'
    )
    and not has_table_privilege(
      'authenticated',
      'public.square_webhook_event',
      'UPDATE'
    )
    and not has_table_privilege(
      'authenticated',
      'public.square_webhook_event',
      'DELETE'
    )
    and not has_table_privilege(
      'authenticated',
      'public.square_webhook_event',
      'TRUNCATE'
    ),
  'signed-in clients have no Square webhook event privileges'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.square_webhook_event'::regclass
  ),
  'Square webhook event RLS remains enabled'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'square_webhook_event'
      and policyname = 'square_webhook_event_no_client_access'
  ),
  'Square webhook event denial policy exists'
);

select is(
  (
    select relreplident::text
    from pg_class
    where oid = 'public.staff_notification'::regclass
  ),
  'f',
  'staff notification uses FULL replica identity'
);

select is(
  (
    select count(*)::integer
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'idx_technician_note_job_id',
        'idx_chat_attachment_message_id',
        'idx_chat_call_conversation_id',
        'idx_recommendation_inspection_result_id'
      )
  ),
  4,
  'targeted relationship indexes exist'
);

select * from finish();
rollback;
