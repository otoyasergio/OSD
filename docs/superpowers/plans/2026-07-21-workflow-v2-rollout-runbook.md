# Workflow V2 rollout runbook

**Scope:** migrating service.torontomoto.com from the legacy Jobs/Recommendations
workflow to Workflow V2 (immutable estimates, per-job authorization, one-action
Tech Floor). Production ships from `main` only via `npm run deploy:production`.

**Kill switch:** `JOBS_ESTIMATE_V2_KILL_SWITCH=1` (Vercel env) forces fully
legacy read/write instantly. Verify it before every gate advance.

## Flags

| Variable                          | Values                     | Meaning                             |
| --------------------------------- | -------------------------- | ----------------------------------- |
| `JOBS_ESTIMATE_V2_READ_MODE`      | `legacy` / `shadow` / `v2` | Which model serves reads            |
| `JOBS_ESTIMATE_V2_WRITE_MODE`     | `legacy` / `dual` / `v2`   | Which model accepts writes          |
| `JOBS_ESTIMATE_V2_LOCATION_CODES` | CSV of codes               | V2-read allow-list (empty = all)    |
| `JOBS_ESTIMATE_V2_KILL_SWITCH`    | `1`                        | Overrides everything back to legacy |

## Gate 0 — before any production change

- [ ] `feature/workflow-v2` reviewed and merged to `main`; tree clean; CI green
      (typecheck, lint, unit, build, chromium smoke, integration job).
- [ ] Remote migration inventory verified: `npx supabase migration list --linked`
      matches the repository (investigate any drift before proceeding).
- [ ] Supabase backup/PITR confirmed within the last 24h (Dashboard → Database →
      Backups). Record the restore point identifier here: ____________
- [ ] `npm run deploy:production` guard passes locally (main @ origin/main).

## Gate 1 — isolated QA environment green

Environment: local `supabase start` (CI) or a disposable QA project. Never the
production ref.

- [ ] `npx supabase db reset` applies all migrations from empty.
- [ ] `npx supabase test db` — pgTAP constraints/RLS/backfill suites pass.
- [ ] `TEST_SUPABASE_URL=... TEST_SUPABASE_SERVICE_ROLE_KEY=... npm run test:integration`
      — estimate/floor/reconciliation integration tests pass.
- [ ] Stateful browser suites on the built app:

```bash
E2E_ALLOW_MUTATION=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 \
npx playwright test --project=webkit-ipad-landscape --workers=1
```

- [ ] Race gate: `npx playwright test tests/e2e/realtime-races.spec.ts --project=chromium --repeat-each=20`
- [ ] Physical Safari on a Mac and a physical iPad complete one full journey
      (intake → estimate → decisions → floor → QC → invoice) — sign-off: ______

## Gate 2 — production schema (no behavior change)

1. Apply the eight `20260721*` migrations to production via
   `npx supabase db push --linked` during a quiet window. They are additive:
   the running legacy app is unaffected.
2. Immediately run Supabase advisors (security + performance) and record
   acceptance of any new findings.
3. Deploy current `main` (legacy read/write; flags unset). Verify the app
   works unchanged for 24h. Rollback = redeploy previous build (schema stays).

## Gate 3 — dual writes + shadow reads

1. Set `JOBS_ESTIMATE_V2_WRITE_MODE=dual`, `JOBS_ESTIMATE_V2_READ_MODE=shadow`;
   redeploy.
2. Run the backfill dry-run and review anomalies:

```bash
node scripts/reconcile-workflow-v2.mjs            # dry-run + anomaly report
```

3. Apply the backfill (all work orders, resumable batches):

```bash
WORKFLOW_V2_PRODUCTION_MIGRATION=1 node scripts/reconcile-workflow-v2.mjs --apply --allow-production
node scripts/reconcile-workflow-v2.mjs --verify   # parity: zero mismatches required
```

4. Hold for 24h. Pass criteria: zero `legacy_v2_mismatch` in verify output,
   zero duplicate tokens/timers/Square documents in Sentry/logs, no 5xx
   regressions.

## Gate 4 — synthetic canary

1. Seed the production `QA` location + synthetic users (never Toronto data):
   run `tests/e2e/fixtures/seedSyntheticShop.ts` seeding against production
   **only** with the QA location code and `.invalid` users, or create the QA
   location manually and exercise it by hand.
2. Set `JOBS_ESTIMATE_V2_READ_MODE=v2`, `JOBS_ESTIMATE_V2_LOCATION_CODES=QA`.
3. Run three complete synthetic journeys over two business days.
4. Pass criteria: no RLS leakage, no unauthorized invoicing, p95 page load
   < 2s, action response < 1.5s, no critical/serious accessibility findings,
   kill switch tested once (flip on → legacy serves → flip off).

## Gate 5 — staff cutover (migrate-all is already done)

The backfill in Gate 3 migrated every open work order; this gate only widens
who reads V2.

1. Set `JOBS_ESTIMATE_V2_LOCATION_CODES=QA,TOR` (all locations: empty list).
2. Keep `WRITE_MODE=dual` throughout the soak.
3. Monitor 72h: authorization mismatches, financial totals, rollup parity
   (`node scripts/reconcile-workflow-v2.mjs --verify` daily), Sentry, and the
   `workflow_v2_anomaly` table (must stay empty of blocking rows).

## Gate 6 — retire legacy writes (separate, later release)

- Only after ≥2 stable releases on V2 reads with dual writes.
- Set `JOBS_ESTIMATE_V2_WRITE_MODE=v2`; previous app versions must no longer
  be deployable (rollback window closes).
- Column/status removal is a separate irreversible project requiring an export
  and explicit owner sign-off. Not part of this rollout.

## Rollback at any gate

1. Set `JOBS_ESTIMATE_V2_KILL_SWITCH=1`; redeploy (or env-only restart).
2. Reads/writes return to legacy immediately; V2 tables retain all evidence.
3. Never delete estimate versions, decisions, confirmations, attempts,
   payments, or domain events during rollback.
4. Re-run `node scripts/reconcile-workflow-v2.mjs --verify` before retrying.

## Explicitly out of scope for this runbook

- Any mutating test against real Toronto customer records.
- Deploying from any branch other than clean, current `main`.
- Removing legacy columns or statuses.
