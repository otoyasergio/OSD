-- pgTAP: Workflow V2 RLS coverage — every V2 table has RLS enabled and no
-- authenticated write policies (writes flow through definer commands only).
begin;
select plan(37);

-- RLS enabled on every V2 table
select ok(
  (select relrowsecurity from pg_class where relname = 'service_finding'),
  'service_finding RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'job_recommendation'),
  'job_recommendation RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'job_blocker'),
  'job_blocker RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'service_version'),
  'service_version RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'service_package_component'),
  'service_package_component RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'labour_rate'),
  'labour_rate RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'job_labor_plan'),
  'job_labor_plan RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'estimate'),
  'estimate RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'estimate_version'),
  'estimate_version RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'estimate_job'),
  'estimate_job RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'estimate_line'),
  'estimate_line RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'estimate_job_decision'),
  'estimate_job_decision RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'estimate_confirmation'),
  'estimate_confirmation RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'job_part_requirement'),
  'job_part_requirement RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'purchase_order'),
  'purchase_order RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'purchase_order_line'),
  'purchase_order_line RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'part_receipt'),
  'part_receipt RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'part_allocation'),
  'part_allocation RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'quality_check_attempt'),
  'quality_check_attempt RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'safety_check_attempt'),
  'safety_check_attempt RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'invoice'),
  'invoice RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'invoice_line'),
  'invoice_line RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'payment_request'),
  'payment_request RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'payment'),
  'payment RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'credit_ledger_entry'),
  'credit_ledger_entry RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'credit_application'),
  'credit_application RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'payment_allocation'),
  'payment_allocation RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'external_billing_document'),
  'external_billing_document RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'integration_event'),
  'integration_event RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where relname = 'domain_event'),
  'domain_event RLS enabled'
);

-- No authenticated INSERT/UPDATE/DELETE policies exist on V2 tables.
select is(
  (
    select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in (
        'service_finding', 'job_recommendation', 'job_blocker',
        'service_version', 'service_package_component', 'labour_rate',
        'job_labor_plan', 'estimate', 'estimate_version', 'estimate_job',
        'estimate_line', 'estimate_job_decision', 'estimate_confirmation',
        'job_part_requirement', 'purchase_order', 'purchase_order_line',
        'part_receipt', 'part_allocation', 'quality_check_attempt',
        'safety_check_attempt', 'invoice', 'invoice_line', 'payment_request',
        'payment', 'credit_ledger_entry', 'credit_application',
        'payment_allocation', 'external_billing_document',
        'integration_event', 'domain_event'
      )
      and cmd <> 'SELECT'
  ),
  0,
  'no client write policies on any V2 table'
);

-- Immutability trigger behavior (superuser bypasses RLS, triggers still fire).
select lives_ok(
  $$
    insert into domain_event (
      aggregate_type, aggregate_id, event_type, actor_type
    ) values ('test', gen_random_uuid(), 'test_event', 'system')
  $$,
  'domain events can be appended'
);
select throws_ok(
  $$ update domain_event set event_type = 'rewritten' $$,
  'WORKFLOW_EVIDENCE_APPEND_ONLY',
  'domain events cannot be updated'
);
select throws_ok(
  $$ delete from domain_event $$,
  'WORKFLOW_EVIDENCE_APPEND_ONLY',
  'domain events cannot be deleted'
);

-- Presented estimate versions reject content mutation.
select lives_ok(
  $$
    with loc as (
      insert into location (name, code) values ('RLS Test', 'RT')
      returning location_id
    ), cust as (
      insert into customer (first_name, last_name, email)
      values ('Test', 'Customer', 'rls-test@otomoto.invalid')
      returning customer_id
    ), moto as (
      insert into motorcycle (customer_id, year, make, model)
      select customer_id, 2024, 'Test', 'Bike' from cust
      returning motorcycle_id
    ), wo as (
      insert into work_order (motorcycle_id, location_id, work_order_number, status)
      select m.motorcycle_id, l.location_id, 'WO-RLS-TEST', 'open'
      from moto m, loc l
      returning work_order_id, location_id
    ), est as (
      insert into estimate (work_order_id, location_id, estimate_number)
      select work_order_id, location_id, 'WO-RLS-TEST-E1' from wo
      returning estimate_id
    )
    insert into estimate_version (
      estimate_id, version_no, status, subtotal_cents, tax_cents, total_cents,
      content_hash, presented_at
    )
    select estimate_id, 1, 'presented', 1000, 130, 1130, 'hash-1', now()
    from est
  $$,
  'presented estimate version can be created'
);
select throws_ok(
  $$
    update estimate_version
    set total_cents = 999
    where content_hash = 'hash-1'
  $$,
  'ESTIMATE_VERSION_IMMUTABLE',
  'presented estimate totals cannot change'
);
select throws_ok(
  $$
    insert into estimate_line (
      estimate_version_id, kind, description, quantity,
      unit_amount_cents, extended_amount_cents
    )
    select estimate_version_id, 'fee', 'late add', 1, 100, 100
    from estimate_version where content_hash = 'hash-1'
  $$,
  'ESTIMATE_VERSION_IMMUTABLE',
  'lines cannot be added to a presented version'
);

select * from finish();
rollback;
