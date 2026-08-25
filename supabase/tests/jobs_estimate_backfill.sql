-- pgTAP: Workflow V2 backfill idempotency and mapping correctness.
begin;
select plan(12);

-- Fixture: one legacy work order with mixed-status jobs.
with loc as (
  insert into location (name, code) values ('Backfill Test', 'BF')
  returning location_id
), cust as (
  insert into customer (first_name, last_name, email)
  values ('Backfill', 'Customer', 'backfill@otomoto.invalid')
  returning customer_id
), moto as (
  insert into motorcycle (customer_id, year, make, model)
  select customer_id, 2020, 'Test', 'Backfill' from cust
  returning motorcycle_id
), wo as (
  insert into work_order (motorcycle_id, location_id, work_order_number, status)
  select m.motorcycle_id, l.location_id, 'WO-BF-0001', 'in_progress'
  from moto m, loc l
  returning work_order_id
), svc as (
  insert into service (name, standard_price, estimated_labour)
  values ('Backfill Service', 100, 1)
  returning service_id
)
insert into job (
  work_order_id, service_id, service_name_snapshot,
  standard_price_snapshot, estimated_labour_snapshot, status
)
select wo.work_order_id, svc.service_id, x.name, x.price, 1, x.status
from wo, svc, (values
  ('Job approved', 100.00, 'approved'),
  ('Job waiting parts', 50.00, 'waiting_for_parts'),
  ('Job in progress', 75.50, 'in_progress'),
  ('Job waiting approval', 25.00, 'waiting_for_approval')
) as x(name, price, status);

-- Dry run reports without writing facets.
select is(
  (public.workflow_v2_backfill_batch(10, false) ->> 'work_orders_processed')::int > 0,
  true,
  'dry run processes pending work orders'
);
select is(
  (select count(*)::int from work_order
   where work_order_number = 'WO-BF-0001' and lifecycle_state is not null),
  0,
  'dry run leaves lifecycle_state untouched'
);

-- Apply migrates facets.
select is(
  (public.workflow_v2_backfill_batch(1000, true) ->> 'work_orders_processed')::int > 0,
  true,
  'apply processes the work order'
);
select is(
  (select lifecycle_state from work_order where work_order_number = 'WO-BF-0001'),
  'active',
  'in_progress maps to active lifecycle'
);
select is(
  (select work_state from job where service_name_snapshot = 'Job approved'),
  'planned',
  'approved maps to planned work state'
);
select is(
  (select work_state from job where service_name_snapshot = 'Job in progress'),
  'in_progress',
  'in_progress maps to in_progress work state'
);
select is(
  (select pricing_mode from job where service_name_snapshot = 'Job approved'),
  'fixed_package',
  'legacy flat price maps to fixed_package'
);
select is(
  (select count(*)::int from job_blocker b
   join job j on j.job_id = b.job_id
   where j.service_name_snapshot = 'Job waiting parts'
     and b.kind = 'parts' and b.cleared_at is null),
  1,
  'waiting_for_parts creates an open parts blocker'
);
select is(
  (select count(*)::int from job_labor_plan p
   join job j on j.job_id = p.job_id
   where j.service_name_snapshot = 'Job approved'),
  1,
  'labour snapshot becomes a labour plan row'
);

-- Idempotency: a second apply run processes nothing and changes nothing.
select is(
  (public.workflow_v2_backfill_batch(1000, true) ->> 'work_orders_processed')::int,
  0,
  'second apply run is a no-op'
);
select is(
  (select count(*)::int from job_blocker b
   join job j on j.job_id = b.job_id
   join work_order w on w.work_order_id = j.work_order_id
   where w.work_order_number = 'WO-BF-0001' and b.cleared_at is null),
  1,
  'no duplicate blockers after re-run'
);
select is(
  (select count(*)::int from job_labor_plan p
   join job j on j.job_id = p.job_id
   join work_order w on w.work_order_id = j.work_order_id
   where w.work_order_number = 'WO-BF-0001'),
  4,
  'no duplicate labour plans after re-run'
);

select * from finish();
rollback;
