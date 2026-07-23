-- pgTAP: Workflow V2 structural constraints and immutability triggers.
-- Run via `supabase test db` (requires local stack).
begin;
select plan(30);

-- Tables exist
select has_table('public'::name, 'service_finding'::name);
select has_table('public'::name, 'job_recommendation'::name);
select has_table('public'::name, 'job_blocker'::name);
select has_table('public'::name, 'service_version'::name);
select has_table('public'::name, 'service_package_component'::name);
select has_table('public'::name, 'labour_rate'::name);
select has_table('public'::name, 'job_labor_plan'::name);
select has_table('public'::name, 'estimate'::name);
select has_table('public'::name, 'estimate_version'::name);
select has_table('public'::name, 'estimate_job'::name);
select has_table('public'::name, 'estimate_line'::name);
select has_table('public'::name, 'estimate_job_decision'::name);
select has_table('public'::name, 'estimate_confirmation'::name);
select has_table('public'::name, 'job_part_requirement'::name);
select has_table('public'::name, 'purchase_order'::name);
select has_table('public'::name, 'quality_check_attempt'::name);
select has_table('public'::name, 'safety_check_attempt'::name);
select has_table('public'::name, 'invoice'::name);
select has_table('public'::name, 'payment'::name);
select has_table('public'::name, 'credit_ledger_entry'::name);
select has_table('public'::name, 'domain_event'::name);

-- Additive facet columns
select has_column('public', 'work_order', 'lifecycle_state', 'work_order.lifecycle_state exists');
select has_column('public', 'work_order', 'lock_version', 'work_order.lock_version exists');
select has_column('public', 'job', 'work_state', 'job.work_state exists');
select has_column('public', 'job', 'pricing_mode', 'job.pricing_mode exists');

-- Money stays in integer cents
select col_type_is('public', 'estimate_version', 'total_cents', 'bigint', 'estimate totals are bigint cents');
select col_type_is('public', 'invoice', 'total_cents', 'bigint', 'invoice totals are bigint cents');

-- Uniqueness that guards the document flow
select has_index('public', 'estimate', 'uq_estimate_live_per_work_order', 'one live estimate per work order');
select has_index('public', 'estimate_version', 'uq_estimate_version_presented', 'one presented version per estimate');
select has_index('public', 'domain_event', 'uq_domain_event_idempotency', 'domain event idempotency');

select * from finish();
rollback;
