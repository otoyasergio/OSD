# OTOMOTO Workshop Management App

Workshop management application for OTOMOTO service operations—customers, bikes, location-scoped work orders, inspections, recommendations, parts, QC, and pickup—in one place. No invoicing in V1.

## Target platforms

Primary target is **Safari on Mac and iPad**. Layout and interactions should be tested on those browsers. Safari on iPhone should remain usable but is secondary.

## Getting started

You need a **live Supabase project**. Do not invent credentials; copy them from the Supabase dashboard.

### 1. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open **Project Settings → API** and note:
   - Project URL
   - `anon` (public) key
   - `service_role` key (server-only; never expose in the browser)

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Fill in `.env.local` with your real project URL and keys:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 3. Apply migrations (001 → 007 in order)

Migrations live in `supabase/migrations/`. Apply them **in numeric order**:

| Order | File |
|------:|------|
| 1 | `001_initial_schema.sql` |
| 2 | `002_locations_and_wo_numbers.sql` |
| 3 | `003_audit_log.sql` |
| 4 | `004_seed_services.sql` |
| 5 | `005_seed_inspection_template.sql` |
| 6 | `006_rls_policies.sql` (also creates the private `intake-photos` storage bucket) |
| 7 | `007_mint_work_order_number.sql` |

**Option A — Supabase CLI** (after `npx supabase link`):

```bash
npx supabase db push
```

**Option B — SQL editor:** paste and run each file in the Supabase SQL Editor, one after another.

**Authorization note:** Role checks in `lib/permissions` (server actions) are the source of truth. RLS policies are defense in depth.

### 4. Create an Auth user and bootstrap data

1. In Supabase Dashboard → **Authentication → Users**, create a user (email + password). Copy the user’s UUID (`auth.users.id`).
2. In the SQL Editor, run `supabase/seed/dev_bootstrap.sql` (creates Toronto / `TOR` + `work_order_sequence`).
3. Uncomment and edit the Auth → `app_user` → `user_location` block at the bottom of that file (replace `<AUTH_USER_UUID>` and email), then run it.
4. Optional: uncomment the second location / technician blocks in the same file for multi-location and permission acceptance tests.

### 5. Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the Auth user you created.

### 6. Safari notes

- Prefer **Safari on Mac** for front-office flows and **Safari on iPad** for technician / floor flows.
- Confirm login, location switcher, create work order, inspection auto-save, photo upload from camera roll, approval, parts order block, QC, and complete.
- If cookies or auth redirects misbehave, confirm `.env.local` URL matches the project and that you are not mixing `localhost` with a different host.

### 7. Acceptance (Task 35)

Walk the checklist in [`docs/superpowers/acceptance/v1-checklist.md`](./docs/superpowers/acceptance/v1-checklist.md) (build-sheet Tests 1–17 plus design extras). Task 35 is not done until that live pass succeeds.

## Tests

```bash
npm test
```

Watch mode:

```bash
npm run test:watch
```

## Build

```bash
npm run build
```

## Documentation

- Design: [`docs/superpowers/specs/`](./docs/superpowers/specs/)
- Implementation plan: [`docs/superpowers/plans/`](./docs/superpowers/plans/)
- V1 acceptance checklist: [`docs/superpowers/acceptance/v1-checklist.md`](./docs/superpowers/acceptance/v1-checklist.md)
