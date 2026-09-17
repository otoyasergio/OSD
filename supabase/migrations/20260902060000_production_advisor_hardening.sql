-- Production advisor hardening (Supabase security + performance advisors,
-- 2026-09-02 audit). Every change here was verified against the live schema.

-- 1) `job` carried two identical btree(work_order_id) indexes
--    (idx_job_work_order from performance_indexes, idx_job_work_order_id from
--    a later migration). Keep one; the duplicate only taxed writes on the
--    busiest table.
drop index if exists public.idx_job_work_order;

-- 2) Foreign keys that real query paths filter or join on. Deliberately NOT
--    indexing the ~85 cold audit/actor columns the advisor also lists —
--    app_user rows are never deleted, so those indexes would only slow writes.
create index if not exists idx_job_service_id on public.job (service_id);
create index if not exists idx_phone_call_work_order_id on public.phone_call (work_order_id);
create index if not exists idx_estimate_job_job_id on public.estimate_job (job_id);
create index if not exists idx_estimate_line_job_id on public.estimate_line (job_id);

-- 3) time_clock_entry had two permissive SELECT policies, so every row read
--    evaluated both. Merge into one policy with identical union semantics:
--    peers see open punches at their location; owners/managers and the row
--    owner see everything at their location.
drop policy if exists time_clock_select_open_peers on public.time_clock_entry;
drop policy if exists time_clock_select_scoped on public.time_clock_entry;
create policy time_clock_select_scoped on public.time_clock_entry
  for select to authenticated
  using (
    is_active_app_user()
    and location_id in (select user_location_ids())
    and (
      clock_out_at is null
      or user_id = current_app_user_id()
      or current_app_user_role() = any (array['owner'::text, 'manager'::text])
    )
  );

-- 4) Pin search_path on the workflow-v2 guard triggers (advisor 0011,
--    function_search_path_mutable). Bodies reference public tables only.
alter function public.workflow_v2_reject_presented_mutation() set search_path = 'public';
alter function public.workflow_v2_reject_evidence_mutation() set search_path = 'public';

-- 5) SECURITY DEFINER functions reachable by anon via PostgREST RPC
--    (advisor 0028). chat_clear_hidden_on_message only ever runs as a
--    trigger — verified triggers still fire with EXECUTE revoked.
--    set_app_user_time_clock_pin re-checks the caller internally (owner or
--    manager) and stays callable by authenticated, which the manager PIN UI
--    uses; anon has no business reaching either.
revoke execute on function public.chat_clear_hidden_on_message() from public, anon, authenticated;
revoke execute on function public.set_app_user_time_clock_pin(uuid, text) from public, anon;
