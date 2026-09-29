# Ask OTOMOTO

Ask OTOMOTO is a staff drafting assistant for the Toronto operation of **OTOMOTO
TORONTO MOTO INC.** “Ask OTOMOTO” and “Toronto Moto” are UI trade names. Ottawa is
inactive and is not an operating shop or an alternate data source.

## Architecture and data flow

- Next.js server actions authorize the signed-in staff member, shape a bounded
  work-order/job context, remove unnecessary customer data, and call the OpenAI
  Responses API.
- Conversation history is app-owned in Supabase
  (`ai_assistant_thread`, `ai_assistant_message`, and selected-photo links).
  Provider conversation state and `previous_response_id` are not used.
- Every provider request sets `store: false`. This prevents response storage for
  later retrieval through the API. It does not mean zero provider retention:
  OpenAI abuse-monitoring logs may retain request/response content for up to 30
  days unless the account has an applicable approved retention control.
- The output is parsed against a strict schema and checked by application safety
  policy before it is shown or stored. Unsafe output is withheld.
- `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are server-only. Never expose
  either through `NEXT_PUBLIC_*`, browser code, logs, screenshots, or test
  artifacts.

The current default is the rolling latest alias `gpt-6-astra`.
`OTOMOTO_DIAGNOSTICS_MODEL` is an emergency server-side override. Each successful
message stores both the requested alias and the provider-resolved model plus the
prompt version. The model-change audit records a resolved-model change. Review
those actual resolved values; an alias name alone is not an audit. Any alias,
resolved-model, prompt, schema, or policy change requires the full live-model
acceptance suite and qualified shop review again before release.

## Context, photos, and sources

Technical and front-office contexts are separately allow-listed. Technical mode
does not receive customer pricing or authorization fields. Customer contact data,
full VIN, storage URLs, signatures, and unrelated work orders are excluded.

Vision receives only photos a staff member explicitly selects for the current
turn. It does not scan the gallery. A turn is limited to three eligible inspection
or job photos; each needs a bounded purpose. Images are validated, resized, and
sent as current-turn evidence. A photo cannot establish torque, pressure, hidden
wear, fluid condition, electrical operation, or legal compliance.

The following resources are missing and must not be claimed as consulted:

- the OTOMOTO 2026 tree (`OTOMOTO_Universal_Diagnostic_Tree_2026.docx`);
- the official Visual Motorcycle Inspection Report;
- the backup Universal Motorcycle Diagnostic Decision Tree;
- exact-model OEM manuals, wiring diagrams, and superseding bulletins; and
- the ten PDFs from the earlier local Codex plugin.

There is no live web, OEM portal, recall, Transport Canada, or Ontario
law/inspection retrieval. Relevant output must say **not checked**, **not
accessible**, or **not verified** rather than infer a result.

Future authorized references require a separately reviewed implementation:
confirm licensing and revision/market applicability, register an allow-listed
source with authority/version/page metadata, extract only the needed bounded
passage server-side, include it in the shaped context, update the prompt version,
and rerun all verification. Do not add broad search, automatic browsing, or RAG
under this feature.

## Access and workflow boundaries

- `/shop`, `/teach`, and `/report` are technical. `/intake` and `/advisor` are
  front-office.
- Office roles can read both audiences for an authorized work order. Floor roles
  can read technical threads only when assignment rules permit it. Thread reads
  remain bound to the exact work order and, where applicable, job and location.
- A foreign-location work order is read-only. Completed/cancelled work orders are
  read-only. Owner role preview is also read-only and remains attributed to the
  owner.
- Ottawa being inactive grants no access and must not be treated as a live shop.

Completing an arrival inspection can seed a technical review. Completing a job can
seed a closure review. These triggers are fail-open for the underlying shop
workflow: assistant/provider failure must not undo inspection or job completion.
The assistant thread records a safe failure and can be retried independently.

All output is an **AI draft — staff review required**. A technical draft may seed
an editable technician-note review, but the staff member must edit, confirm, and
save it as their own note. The verified note is authoritative; the AI draft is
not.

Ask OTOMOTO never automatically:

- sends a customer message;
- approves or authorizes work;
- orders parts;
- records a test as performed;
- changes job/work-order state;
- completes an inspection, checklist, workflow gate, QC, or final inspection;
- certifies roadworthiness; or
- approves pickup or release.

## Lifecycle, retention, and operational states

Begin, complete, fail, and retry database functions atomically claim a generation
attempt. They are executable only by `service_role`; browser roles have read-only
table access controlled by RLS. A work-order deletion cascades its threads and
messages. Message deletion cascades selected-photo links; image bytes remain under
their normal photo retention. Deleting a source message clears note provenance
rather than deleting the staff note. No separate assistant time-based retention
policy currently exists.

The send limit is 12 turns per minute per staff ID, implemented in process memory.
It is **per process**, not a distributed global limit; multiple server instances
can each admit traffic. Use platform firewall or a shared rate-limit store before
treating it as an account-wide control.

The UI distinguishes:

- pending/generating, with bounded polling and a “still working” state;
- ready history, requested evidence, and copy;
- safe failed/withheld output with retry where authorized;
- unavailable/stale/unauthorized selected threads without leaking content; and
- missing or invalid OpenAI configuration. Configuration errors disable new
  generation but keep existing history and copy available.

## Setup and verification

Apply these Ask OTOMOTO migrations in filename order before deploying matching
code:

1. `20260929030828_create_ai_assistant_storage.sql`
2. `20260929045500_guard_ai_note_promotion_uniqueness.sql`
3. `20260929051836_ask_otomoto_atomic_lifecycle.sql`
4. `20260929060837_ask_otomoto_atomic_seed_begin.sql`
5. `20260929062500_add_ai_assistant_closure_phase.sql`

First verify them against an isolated local/QA database. Against a linked
**non-production** Supabase project, regenerate types with `npm run db:types` and
review the diff; do not generate against production as the first check.

Configure and validate a Vercel Preview separately with server-only keys and its
own migrated **non-production** Supabase project. The keyed Preview must not use
the production database.

Stateful Playwright must not target that keyed Preview: it runs only against a
local or disposable remote QA app. `NEXT_PUBLIC_SUPABASE_*` values are embedded
at build time; changing them in the `next start` environment does **not** retarget
an existing build.

For a local stateful run, use this order:

1. create/migrate the dedicated non-production database;
2. export `TEST_SUPABASE_URL`, `TEST_SUPABASE_PUBLISHABLE_KEY` (or the local
   anon equivalent), `TEST_SUPABASE_ANON_KEY`, and
   `TEST_SUPABASE_SERVICE_ROLE_KEY`;
3. export a new nonempty server-only `E2E_ENV_GUARD_SECRET`;
4. set `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from those isolated `TEST_*` values,
   then run `npm run build`;
5. only after that build succeeds, run stateful Playwright with
   `E2E_ALLOW_MUTATION=1`.

In the normal local path, the Playwright web-server configuration starts that
exact build with `npm run start`, maps only the test service-role value into the
server process, and clears AI, Twilio, and Resend credentials. Do not reuse an
already-running server in mutation mode.

Before seeding, global setup calls the E2E-only guarded fingerprint endpoint.
The endpoint exists only in mutation mode with a matching
`E2E_ENV_GUARD_SECRET`; it returns only a SHA-256 Supabase-target fingerprint
and provider-configured booleans. Global setup compares that fingerprint with
`TEST_SUPABASE_URL` and requires all outbound booleans to be false. A mismatch
means the app must be rebuilt with the isolated values.

For `PLAYWRIGHT_SKIP_WEBSERVER=1`, the disposable remote QA deployment must use
the same guard secret as the runner, a dedicated migrated non-production
Supabase project, and disabled OpenAI/Twilio/Resend credentials. The same
fingerprint preflight runs before any remote QA mutation.

Then run:

1. pgTAP (`supabase test db`) on an isolated local/QA database;
2. `npm run test:integration` with explicit `TEST_SUPABASE_*` credentials;
3. stateful Playwright with an isolated QA database and
   `E2E_ALLOW_MUTATION=1`, against the unconfigured local/disposable QA app;
4. the opt-in fictional live-model suite from the
   [acceptance worksheet](./ask-otomoto-acceptance.md), treating automated
   results as heuristic screening rather than reviewer approval;
5. manual Safari checks on iPad and desktop; and
6. qualified technician and service-advisor review/signoff.

The integration job in `.github/workflows/ci.yml` currently has
`continue-on-error: true`. Until it becomes required, successful pgTAP and
integration runs remain a mandatory, manually confirmed release gate.

Any blocking failure stops release. Production database migrations are not part
of Preview or verification. During a separately approved production rollout,
apply the verified migration files to the production database in the order
above. Confirm that migration step succeeded before the separate production code
deployment from `main`:

```bash
git checkout main
git pull --ff-only origin main
npm run deploy:production
```

Do not run that production step from a feature branch, and do not deploy as part
of verification.
