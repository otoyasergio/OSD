# OTOMOTO Workshop Management App V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the OTOMOTO internal workshop management web app (Safari on Mac/iPad) so staff can run the full repair workflow—customers, bikes, location-scoped work orders, inspections, recommendations, parts, QC, pickup—with timeline + owner-only audit logging and no invoicing.

**Architecture:** Next.js App Router + TypeScript + Tailwind; Supabase for Postgres, email/password Auth, and photo Storage. All mutations go through server services that enforce permission → business rule → write → work-order timeline (if applicable) → global audit_log → `recalculateWorkOrderStatus`. Multi-location via `location` + `user_location` + active-location cookie; customers/bikes company-wide; WOs numbered per location (`WO-1001`).

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS, Zod, Supabase JS (`@supabase/ssr`, `@supabase/supabase-js`), Vitest (unit), Playwright optional for Safari smoke later.

**Spec:** `docs/superpowers/specs/2026-07-08-otomoto-workshop-management-design.md`  
**Build sheet:** Desktop `OTOMOTO Full Build Spec Document` (schema, seeds, acceptance tests 1–17)

---

## File structure (create as tasks progress)

```
app/
  layout.tsx
  page.tsx                          # redirect to /dashboard or /login
  login/page.tsx
  (app)/layout.tsx                  # auth gate + shell + location switcher
  (app)/dashboard/page.tsx
  (app)/customers/page.tsx
  (app)/customers/new/page.tsx
  (app)/customers/[customer_id]/page.tsx
  (app)/motorcycles/page.tsx
  (app)/motorcycles/[motorcycle_id]/page.tsx
  (app)/work_orders/page.tsx
  (app)/work_orders/new/page.tsx
  (app)/work_orders/[work_order_id]/page.tsx
  (app)/work_orders/[work_order_id]/inspection/page.tsx
  (app)/technician/page.tsx
  (app)/settings/services/page.tsx
  (app)/settings/inspection_template/page.tsx
  (app)/settings/users/page.tsx
  (app)/settings/locations/page.tsx
  (app)/settings/audit/page.tsx
  auth/callback/route.ts
  api/health/route.ts
components/
  layout/AppShell.tsx
  layout/LocationSwitcher.tsx
  layout/Nav.tsx
  status/StatusBadge.tsx
  status/FlagBadges.tsx
  forms/*.tsx
  tables/*.tsx
  work_orders/*.tsx
  inspections/*.tsx
  jobs/*.tsx
  recommendations/*.tsx
  parts/*.tsx
  photos/*.tsx
  timeline/TimelineList.tsx
  audit/AuditLogTable.tsx
lib/
  database/types.ts                 # generated or hand-written DB types
  database/supabase-server.ts
  database/supabase-browser.ts
  database/supabase-admin.ts        # service role for privileged ops only if needed
  auth/session.ts                   # getCurrentAppUser, requireUser
  auth/location-cookie.ts           # get/set active location
  permissions/index.ts
  permissions/checks.ts
  validation/schemas.ts
  status/labels.ts
  status/recalculateWorkOrderStatus.ts
  timeline/events.ts
  timeline/addTimelineEvent.ts
  audit/addAuditLog.ts
  services/customers.ts
  services/motorcycles.ts
  services/serviceCatalogue.ts
  services/workOrders.ts
  services/jobs.ts
  services/inspections.ts
  services/recommendations.ts
  services/parts.ts
  services/photos.ts
  services/notes.ts
  services/quality.ts
  services/users.ts
  services/locations.ts
  services/dashboard.ts
supabase/
  migrations/001_initial_schema.sql
  migrations/002_locations_and_wo_numbers.sql
  migrations/003_audit_log.sql
  migrations/004_seed_services.sql
  migrations/005_seed_inspection_template.sql
  migrations/006_rls_policies.sql
  seed/dev_owner.sql                # optional local seed user mapping notes
tests/
  unit/permissions.test.ts
  unit/recalculateWorkOrderStatus.test.ts
  unit/validation.test.ts
  unit/workOrderNumber.test.ts
vitest.config.ts
.env.local.example
README.md
```

---

## Phase 0 — Project foundation

### Task 1: Scaffold Next.js app

**Files:**
- Create: entire Next.js project at repo root (alongside existing `docs/`)
- Create: `.env.local.example`, `README.md`, `vitest.config.ts`

- [ ] **Step 1: Scaffold**

```bash
cd "/Users/segio/OTOMOTO SERVICE APP"
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --turbopack --yes
```

If create-next-app refuses non-empty dir, scaffold into a temp folder and move files up, keeping `docs/` and `.git/`.

- [ ] **Step 2: Install dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr zod
npm install -D vitest @vitejs/plugin-react jsdom @types/node
```

- [ ] **Step 3: Add Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Add env example**

Create `.env.local.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Create `README.md` with: project purpose, Safari Mac/iPad target, how to copy `.env.local.example` → `.env.local`, how to apply migrations, `npm run dev`, `npm test`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Tailwind, Vitest, and Supabase deps"
```

---

### Task 2: Supabase client helpers

**Files:**
- Create: `lib/database/supabase-server.ts`
- Create: `lib/database/supabase-browser.ts`
- Create: `lib/database/types.ts` (minimal stub types; expand as schema lands)

- [ ] **Step 1: Create browser client**

```ts
// lib/database/supabase-browser.ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 2: Create server client**

```ts
// lib/database/supabase-server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component; ignore if middleware will refresh.
          }
        },
      },
    }
  );
}
```

- [ ] **Step 3: Stub types file**

```ts
// lib/database/types.ts
export type UserRole =
  | "owner"
  | "manager"
  | "service_advisor"
  | "technician"
  | "admin";

export type UserStatus = "active" | "inactive" | "suspended";

export type WorkOrderStatus =
  | "draft"
  | "open"
  | "inspection_in_progress"
  | "waiting_for_customer_approval"
  | "waiting_for_parts"
  | "ready_for_technician"
  | "in_progress"
  | "quality_check"
  | "ready_for_pickup"
  | "completed"
  | "cancelled"
  | "on_hold";

export type JobStatus =
  | "draft"
  | "waiting_for_approval"
  | "approved"
  | "declined"
  | "waiting_for_parts"
  | "ready_to_start"
  | "in_progress"
  | "completed"
  | "cancelled";

export type PartStatus =
  | "needed"
  | "in_stock"
  | "ordered"
  | "installed"
  | "not_required"
  | "cancelled";

export type InspectionResultStatus =
  | "ok"
  | "future_attention"
  | "immediate_attention";

export type RecommendationSeverity =
  | "future_attention"
  | "immediate_attention"
  | "safety_critical";

export type RecommendationStatus =
  | "pending"
  | "approved"
  | "declined"
  | "converted_to_job"
  | "deferred";
```

- [ ] **Step 4: Commit**

```bash
git add lib/database
git commit -m "chore: add Supabase browser/server clients and core type stubs"
```

---

## Phase 1 — Database schema and seeds

### Task 3: Initial schema migration (build sheet tables)

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

- [ ] **Step 1: Write migration**

Copy the full `CREATE TABLE` / index block from the build sheet into `001_initial_schema.sql`, starting with:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

Include exactly: `app_user`, `customer`, `motorcycle`, `motorcycle_service_information`, `service`, `work_order` (base columns from build sheet—location columns added in 002), `work_order_technician`, `job`, `inspection`, `inspection_template_item`, `inspection_result`, `recommendation`, `part`, `intake_photo`, `technician_note`, `timeline_event`, and all indexes from the build sheet.

**Important:** In `001`, create `work_order` **without** `location_id` / `work_order_number` yet if you prefer clean diffs—or include placeholder columns only in `002`. Prefer: `001` = build sheet as written; `002` = ALTER + new tables.

- [ ] **Step 2: Apply migration to Supabase**

Create a Supabase project in the dashboard (user action). Put URL/keys in `.env.local`. Apply via Supabase SQL editor or CLI:

```bash
# If supabase CLI linked:
npx supabase db push
# Or paste 001 into SQL editor and run
```

Expected: all tables exist; no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/001_initial_schema.sql
git commit -m "feat(db): add initial workshop schema from build sheet"
```

---

### Task 4: Locations, WO numbers, audit_log

**Files:**
- Create: `supabase/migrations/002_locations_and_wo_numbers.sql`
- Create: `supabase/migrations/003_audit_log.sql`

- [ ] **Step 1: Write locations migration**

```sql
-- supabase/migrations/002_locations_and_wo_numbers.sql
CREATE TABLE location (
    location_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    code text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_location (
    user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    location_id uuid NOT NULL REFERENCES location(location_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, location_id)
);

CREATE TABLE work_order_sequence (
    location_id uuid PRIMARY KEY REFERENCES location(location_id) ON DELETE CASCADE,
    next_number integer NOT NULL DEFAULT 1001
);

ALTER TABLE work_order
    ADD COLUMN location_id uuid REFERENCES location(location_id) ON DELETE RESTRICT,
    ADD COLUMN work_order_number text;

-- Greenfield: enforce NOT NULL immediately after columns are added.
-- (No legacy rows exist in V1 empty DB.)
ALTER TABLE work_order
    ALTER COLUMN location_id SET NOT NULL,
    ALTER COLUMN work_order_number SET NOT NULL;

CREATE UNIQUE INDEX uq_work_order_location_number
    ON work_order (location_id, work_order_number);

CREATE INDEX idx_work_order_location_id ON work_order(location_id);
CREATE INDEX idx_user_location_location_id ON user_location(location_id);
```

- [ ] **Step 2: Write audit_log migration**

```sql
-- supabase/migrations/003_audit_log.sql
CREATE TABLE audit_log (
    audit_log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    location_id uuid REFERENCES location(location_id) ON DELETE SET NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    description text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX idx_audit_log_actor_user_id ON audit_log(actor_user_id);
CREATE INDEX idx_audit_log_location_id ON audit_log(location_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
```

- [ ] **Step 3: Apply 002 + 003**

Run in Supabase SQL editor / `db push`. Expected: tables exist; unique index on WO number per location.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/002_locations_and_wo_numbers.sql supabase/migrations/003_audit_log.sql
git commit -m "feat(db): add locations, per-location WO numbers, and audit_log"
```

---

### Task 5: Seed services and inspection template

**Files:**
- Create: `supabase/migrations/004_seed_services.sql`
- Create: `supabase/migrations/005_seed_inspection_template.sql`

- [ ] **Step 1: Copy seed INSERTs from build sheet** into `004` and `005` exactly (Oil Change … Custom Service; Exterior/Controls/… Road Test items).

- [ ] **Step 2: Apply seeds**

Expected: `SELECT count(*) FROM service` ≥ 12; `SELECT count(*) FROM inspection_template_item` ≥ 40.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/004_seed_services.sql supabase/migrations/005_seed_inspection_template.sql
git commit -m "feat(db): seed service catalogue and inspection template"
```

---

### Task 6: RLS baseline

**Files:**
- Create: `supabase/migrations/006_rls_policies.sql`

- [ ] **Step 1: Enable RLS** on all app tables.

- [ ] **Step 2: Policies (V1 pragmatic approach)**

Use authenticated role + `app_user` lookup:

```sql
-- Pattern: helper to resolve current app_user_id
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id FROM app_user
  WHERE auth_user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_app_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM app_user
  WHERE auth_user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$$;
```

Policies V1:
- Authenticated active users: SELECT on operational tables they need
- Mutations primarily via server using user session; tighten writes so only authenticated users with `current_app_user_id() IS NOT NULL` can INSERT/UPDATE
- `audit_log` SELECT: only when `current_app_user_role() = 'owner'`
- Storage bucket `intake-photos`: authenticated upload/read

Document in README that **authorization truth is still `lib/permissions` in server actions**; RLS is defense in depth.

- [ ] **Step 3: Create storage bucket** `intake-photos` (private) in Supabase dashboard; add policies for authenticated read/write under `{work_order_id}/...`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/006_rls_policies.sql
git commit -m "feat(db): enable RLS helpers and baseline policies including owner-only audit"
```

---

## Phase 2 — Auth, permissions, location context

### Task 7: Status labels module

**Files:**
- Create: `lib/status/labels.ts`
- Test: `tests/unit/validation.test.ts` (labels smoke) or include in permissions tests

- [ ] **Step 1: Implement labels**

```ts
// lib/status/labels.ts
import type { WorkOrderStatus, JobStatus, InspectionResultStatus, RecommendationSeverity } from "@/lib/database/types";

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  draft: "Draft",
  open: "Open",
  inspection_in_progress: "Inspection In Progress",
  waiting_for_customer_approval: "Waiting For Customer Approval",
  waiting_for_parts: "Waiting For Parts",
  ready_for_technician: "Ready For Technician",
  in_progress: "In Progress",
  quality_check: "Quality Check",
  ready_for_pickup: "Ready For Pickup",
  completed: "Completed",
  cancelled: "Cancelled",
  on_hold: "On Hold",
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  draft: "Draft",
  waiting_for_approval: "Waiting For Approval",
  approved: "Approved",
  declined: "Declined",
  waiting_for_parts: "Waiting For Parts",
  ready_to_start: "Ready To Start",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const INSPECTION_RESULT_LABELS: Record<InspectionResultStatus, string> = {
  ok: "OK",
  future_attention: "Future Attention",
  immediate_attention: "Immediate Attention",
};

export const RECOMMENDATION_SEVERITY_LABELS: Record<RecommendationSeverity, string> = {
  future_attention: "Future Attention",
  immediate_attention: "Immediate Attention",
  safety_critical: "Safety Critical",
};
```

- [ ] **Step 2: Commit**

```bash
git add lib/status/labels.ts
git commit -m "feat: add human-readable status labels"
```

---

### Task 8: Permissions module (TDD)

**Files:**
- Create: `lib/permissions/checks.ts`
- Create: `lib/permissions/index.ts`
- Test: `tests/unit/permissions.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/permissions.test.ts
import { describe, it, expect } from "vitest";
import {
  canRecordCustomerApproval,
  canManageUsers,
  canViewAuditLog,
  canOrderPart,
  canCompleteWorkOrder,
  canRunQualityCheck,
  canManageServiceCatalogue,
} from "@/lib/permissions/checks";

describe("permissions", () => {
  it("blocks technician from recording customer approval", () => {
    expect(canRecordCustomerApproval("technician")).toBe(false);
  });

  it("allows service_advisor to record customer approval", () => {
    expect(canRecordCustomerApproval("service_advisor")).toBe(true);
  });

  it("only owner can view audit log", () => {
    expect(canViewAuditLog("owner")).toBe(true);
    expect(canViewAuditLog("manager")).toBe(false);
    expect(canViewAuditLog("technician")).toBe(false);
  });

  it("only owner can manage users", () => {
    expect(canManageUsers("owner")).toBe(true);
    expect(canManageUsers("manager")).toBe(false);
  });

  it("owner and manager can manage service catalogue", () => {
    expect(canManageServiceCatalogue("owner")).toBe(true);
    expect(canManageServiceCatalogue("manager")).toBe(true);
    expect(canManageServiceCatalogue("service_advisor")).toBe(false);
  });

  it("technician cannot complete work order", () => {
    expect(canCompleteWorkOrder("technician")).toBe(false);
  });

  it("service_advisor can run quality check", () => {
    expect(canRunQualityCheck("service_advisor")).toBe(true);
    expect(canRunQualityCheck("technician")).toBe(false);
  });

  it("canOrderPart is true for front office roles", () => {
    expect(canOrderPart("service_advisor")).toBe(true);
    expect(canOrderPart("technician")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/unit/permissions.test.ts
```

Expected: FAIL (module not found / exports missing).

- [ ] **Step 3: Implement**

```ts
// lib/permissions/checks.ts
import type { UserRole } from "@/lib/database/types";

const FRONT_OFFICE: UserRole[] = ["owner", "manager", "service_advisor"];
const OWNERS: UserRole[] = ["owner"];
const OWNERS_MANAGERS: UserRole[] = ["owner", "manager"];
const QC_ROLES: UserRole[] = ["owner", "manager", "service_advisor"];

export function canCreateWorkOrder(role: UserRole) {
  return FRONT_OFFICE.includes(role) || role === "admin";
}
export function canEditWorkOrder(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canAssignTechnician(role: UserRole) {
  return OWNERS_MANAGERS.includes(role) || role === "service_advisor";
}
export function canRecordCustomerApproval(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canCompleteInspection(role: UserRole) {
  return role === "technician" || FRONT_OFFICE.includes(role);
}
export function canCreateRecommendation(role: UserRole) {
  return role === "technician" || FRONT_OFFICE.includes(role);
}
export function canConvertRecommendation(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canOrderPart(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canCompleteJob(role: UserRole) {
  return role === "technician" || FRONT_OFFICE.includes(role);
}
export function canRunQualityCheck(role: UserRole) {
  return QC_ROLES.includes(role);
}
export function canMarkReadyForPickup(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canCompleteWorkOrder(role: UserRole) {
  return FRONT_OFFICE.includes(role);
}
export function canManageServiceCatalogue(role: UserRole) {
  return OWNERS_MANAGERS.includes(role);
}
export function canManageInspectionTemplate(role: UserRole) {
  return OWNERS_MANAGERS.includes(role);
}
export function canManageUsers(role: UserRole) {
  return OWNERS.includes(role);
}
export function canManageLocations(role: UserRole) {
  return OWNERS.includes(role);
}
export function canViewAuditLog(role: UserRole) {
  return OWNERS.includes(role);
}
export function canOverrideWorkOrderStatus(role: UserRole) {
  return OWNERS_MANAGERS.includes(role);
}

/** Admin: limited operational help; no workflow override, no audit, no user/location admin. */
export function canAdminHelpCreateRecords(role: UserRole) {
  return role === "admin" || FRONT_OFFICE.includes(role);
}
```

```ts
// lib/permissions/index.ts
export * from "./checks";
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/unit/permissions.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/permissions tests/unit/permissions.test.ts
git commit -m "feat: add central role permission checks with unit tests"
```

---

### Task 9: Validation schemas (TDD)

**Files:**
- Create: `lib/validation/schemas.ts`
- Test: `tests/unit/validation.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/validation.test.ts
import { describe, it, expect } from "vitest";
import { customerSchema, motorcycleSchema } from "@/lib/validation/schemas";

describe("customerSchema", () => {
  it("requires phone or email", () => {
    const result = customerSchema.safeParse({
      first_name: "Ada",
      last_name: "Lovelace",
    });
    expect(result.success).toBe(false);
  });

  it("accepts phone only", () => {
    const result = customerSchema.safeParse({
      first_name: "Ada",
      last_name: "Lovelace",
      phone: "4165551212",
    });
    expect(result.success).toBe(true);
  });
});

describe("motorcycleSchema", () => {
  it("requires year make model customer", () => {
    const result = motorcycleSchema.safeParse({
      customer_id: "00000000-0000-0000-0000-000000000001",
      year: 2022,
      make: "Honda",
      model: "CBR600RR",
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- tests/unit/validation.test.ts
```

- [ ] **Step 3: Implement Zod schemas**

```ts
// lib/validation/schemas.ts
import { z } from "zod";

export const customerSchema = z
  .object({
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    phone: z.string().optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal("")),
    notes: z.string().optional().nullable(),
  })
  .refine((v) => Boolean(v.phone?.trim() || v.email?.trim()), {
    message: "Phone or email is required",
    path: ["phone"],
  });

export const motorcycleSchema = z.object({
  customer_id: z.string().uuid(),
  year: z.number().int().min(1900).max(2100),
  make: z.string().min(1),
  model: z.string().min(1),
  vin: z.string().optional().nullable(),
  colour: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const createWorkOrderSchema = z.object({
  motorcycle_id: z.string().uuid(),
  location_id: z.string().uuid(),
  external_invoice_number: z.string().optional().nullable(),
  mileage: z.number().int().nonnegative().optional().nullable(),
  estimated_completion: z.string().datetime().optional().nullable(),
  internal_notes: z.string().optional().nullable(),
  primary_technician_id: z.string().uuid().optional().nullable(),
  service_ids: z.array(z.string().uuid()).default([]),
});
```

Add further schemas in later tasks as needed (`approveJobSchema`, `partSchema`, etc.) in this same file.

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- tests/unit/validation.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/validation tests/unit/validation.test.ts
git commit -m "feat: add Zod validation schemas for customers and motorcycles"
```

---

### Task 10: Session + active location cookie

**Files:**
- Create: `lib/auth/session.ts`
- Create: `lib/auth/location-cookie.ts`
- Create: `middleware.ts` (refresh Supabase session)

- [ ] **Step 1: Location cookie helpers**

```ts
// lib/auth/location-cookie.ts
export const ACTIVE_LOCATION_COOKIE = "otomoto_active_location_id";

export function parseActiveLocationId(
  cookieHeader: string | undefined
): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ACTIVE_LOCATION_COOKIE}=`));
  return match ? decodeURIComponent(match.split("=")[1]!) : null;
}
```

- [ ] **Step 2: `getCurrentAppUser`**

```ts
// lib/auth/session.ts
import { createClient } from "@/lib/database/supabase-server";
import { cookies } from "next/headers";
import { ACTIVE_LOCATION_COOKIE } from "@/lib/auth/location-cookie";
import type { UserRole, UserStatus } from "@/lib/database/types";

export type AppUser = {
  user_id: string;
  auth_user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  location_ids: string[];
  active_location_id: string | null;
};

export async function getCurrentAppUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: user } = await supabase
    .from("app_user")
    .select("user_id, auth_user_id, first_name, last_name, email, role, status")
    .eq("auth_user_id", auth.user.id)
    .maybeSingle();

  if (!user || user.status !== "active") return null;

  const { data: locs } = await supabase
    .from("user_location")
    .select("location_id")
    .eq("user_id", user.user_id);

  const location_ids = (locs ?? []).map((l) => l.location_id);
  const cookieStore = await cookies();
  const cookieLoc = cookieStore.get(ACTIVE_LOCATION_COOKIE)?.value ?? null;
  const active_location_id =
    cookieLoc && location_ids.includes(cookieLoc)
      ? cookieLoc
      : location_ids[0] ?? null;

  return { ...user, location_ids, active_location_id };
}

export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentAppUser();
  if (!user) throw new Error("UNAUTHORIZED");
  if (!user.active_location_id) throw new Error("NO_LOCATION");
  return user;
}
```

- [ ] **Step 3: Middleware** for session refresh using `@supabase/ssr` pattern (standard Next.js Supabase middleware from docs). Protect `/(app)/*` by redirecting unauthenticated users to `/login`.

- [ ] **Step 4: Login page** at `app/login/page.tsx` — email/password form calling `supabase.auth.signInWithPassword`. On success redirect `/dashboard`.

- [ ] **Step 5: Manual check** — create Auth user in Supabase + matching `app_user` + `user_location` row; sign in on Safari.

- [ ] **Step 6: Commit**

```bash
git add lib/auth middleware.ts app/login
git commit -m "feat: add auth session, active location cookie, and login page"
```

---

### Task 11: App shell + location switcher

**Files:**
- Create: `components/layout/AppShell.tsx`, `Nav.tsx`, `LocationSwitcher.tsx`
- Create: `app/(app)/layout.tsx`
- Create: server action `app/(app)/actions/set-location.ts`

- [ ] **Step 1: Server action to set location**

```ts
"use server";
import { cookies } from "next/headers";
import { ACTIVE_LOCATION_COOKIE } from "@/lib/auth/location-cookie";
import { getCurrentAppUser } from "@/lib/auth/session";
import { addAuditLog } from "@/lib/audit/addAuditLog"; // stub until Task 12; or inline insert

export async function setActiveLocation(locationId: string) {
  const user = await getCurrentAppUser();
  if (!user) throw new Error("UNAUTHORIZED");
  if (!user.location_ids.includes(locationId)) throw new Error("FORBIDDEN");
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_LOCATION_COOKIE, locationId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  // audit: location_switched (wire fully in Task 12)
}
```

- [ ] **Step 2: Shell UI** — nav links per design; location `<select>` calling `setActiveLocation`; show user name/role.

- [ ] **Step 3: `(app)/layout.tsx`** — `requireUser()`; if `NO_LOCATION`, show “Contact owner to assign a location”; else render `AppShell`.

- [ ] **Step 4: Commit**

```bash
git add components/layout app/\(app\)
git commit -m "feat: add authenticated app shell and location switcher"
```

---

### Task 12: Timeline + audit helpers

**Files:**
- Create: `lib/timeline/addTimelineEvent.ts`
- Create: `lib/timeline/events.ts`
- Create: `lib/audit/addAuditLog.ts`

- [ ] **Step 1: Event type constants**

```ts
// lib/timeline/events.ts
export const TimelineEventType = {
  WORK_ORDER_CREATED: "Work Order Created",
  WORK_ORDER_STATUS_CHANGED: "Work Order Status Changed",
  EXTERNAL_INVOICE_NUMBER_ADDED: "External Invoice Number Added",
  INTAKE_PHOTO_UPLOADED: "Intake Photo Uploaded",
  INSPECTION_CREATED: "Inspection Created",
  INSPECTION_STARTED: "Inspection Started",
  INSPECTION_RESULT_UPDATED: "Inspection Result Updated",
  INSPECTION_COMPLETED: "Inspection Completed",
  JOB_CREATED: "Job Created",
  JOB_ASSIGNED: "Job Assigned",
  JOB_STATUS_CHANGED: "Job Status Changed",
  CUSTOMER_APPROVAL_RECORDED: "Customer Approval Recorded",
  CUSTOMER_DECLINE_RECORDED: "Customer Decline Recorded",
  RECOMMENDATION_CREATED: "Recommendation Created",
  RECOMMENDATION_STATUS_CHANGED: "Recommendation Status Changed",
  RECOMMENDATION_CONVERTED_TO_JOB: "Recommendation Converted To Job",
  PART_ADDED: "Part Added",
  PART_STATUS_CHANGED: "Part Status Changed",
  TECHNICIAN_ASSIGNED: "Technician Assigned",
  PRIMARY_TECHNICIAN_CHANGED: "Primary Technician Changed",
  TECHNICIAN_NOTE_ADDED: "Technician Note Added",
  SERVICE_INFORMATION_UPDATED: "Service Information Updated",
  QUALITY_CHECK_COMPLETED: "Quality Check Completed",
  READY_FOR_PICKUP: "Ready For Pickup",
  WORK_ORDER_COMPLETED: "Work Order Completed",
  WORK_ORDER_CANCELLED: "Work Order Cancelled",
  WORK_ORDER_PLACED_ON_HOLD: "Work Order Placed On Hold",
} as const;
```

- [ ] **Step 2: Insert helpers** (accept supabase client from caller so they participate in transactions when using RPC later; for V1, sequential inserts in service functions are OK if ordered carefully—prefer a Postgres function `create_work_order(...)` in a follow-up if race conditions appear).

```ts
// lib/timeline/addTimelineEvent.ts
type Args = {
  work_order_id: string;
  user_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id?: string | null;
  description: string;
  old_value?: unknown;
  new_value?: unknown;
};

export async function addTimelineEvent(
  supabase: any,
  args: Args
) {
  const { error } = await supabase.from("timeline_event").insert({
    work_order_id: args.work_order_id,
    user_id: args.user_id,
    event_type: args.event_type,
    entity_type: args.entity_type,
    entity_id: args.entity_id ?? null,
    description: args.description,
    old_value: args.old_value ?? null,
    new_value: args.new_value ?? null,
  });
  if (error) throw error;
}
```

```ts
// lib/audit/addAuditLog.ts
type Args = {
  actor_user_id: string | null;
  location_id?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  description: string;
  old_value?: unknown;
  new_value?: unknown;
};

export async function addAuditLog(supabase: any, args: Args) {
  const { error } = await supabase.from("audit_log").insert({
    actor_user_id: args.actor_user_id,
    location_id: args.location_id ?? null,
    action: args.action,
    entity_type: args.entity_type,
    entity_id: args.entity_id ?? null,
    description: args.description,
    old_value: args.old_value ?? null,
    new_value: args.new_value ?? null,
  });
  if (error) throw error;
}
```

- [ ] **Step 3: Wire location switch** to call `addAuditLog` with `action: "location_switched"`.

- [ ] **Step 4: Commit**

```bash
git add lib/timeline lib/audit
git commit -m "feat: add timeline and owner audit log write helpers"
```

---

### Task 13: `recalculateWorkOrderStatus` (TDD)

**Files:**
- Create: `lib/status/recalculateWorkOrderStatus.ts`
- Test: `tests/unit/recalculateWorkOrderStatus.test.ts`

- [ ] **Step 1: Write failing tests covering build-sheet rules**

```ts
// tests/unit/recalculateWorkOrderStatus.test.ts
import { describe, it, expect } from "vitest";
import { deriveWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";

describe("deriveWorkOrderStatus", () => {
  it("does not change completed", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "completed",
        jobs: [],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: true,
      })
    ).toBe("completed");
  });

  it("does not change cancelled", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "cancelled",
        jobs: [{ status: "approved" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: false,
      })
    ).toBe("cancelled");
  });

  it("does not change on_hold", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "on_hold",
        jobs: [{ status: "in_progress" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: false,
      })
    ).toBe("on_hold");
  });

  it("sets waiting_for_customer_approval when any job waiting", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "open",
        jobs: [{ status: "waiting_for_approval" }, { status: "approved" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: false,
      })
    ).toBe("waiting_for_customer_approval");
  });

  it("sets waiting_for_parts when approved job has needed/ordered parts", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "open",
        jobs: [{ status: "approved", job_id: "j1" }],
        parts: [{ job_id: "j1", status: "ordered" }],
        inspectionComplete: true,
        qualityCheckComplete: false,
      })
    ).toBe("waiting_for_parts");
  });

  it("sets in_progress when any job in_progress", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "ready_for_technician",
        jobs: [{ status: "in_progress" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: false,
      })
    ).toBe("in_progress");
  });

  it("sets quality_check when all active jobs completed and QC missing", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "in_progress",
        jobs: [{ status: "completed" }, { status: "declined" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: false,
      })
    ).toBe("quality_check");
  });

  it("sets ready_for_pickup when QC complete and not completed", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "quality_check",
        jobs: [{ status: "completed" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: true,
      })
    ).toBe("ready_for_pickup");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- tests/unit/recalculateWorkOrderStatus.test.ts
```

- [ ] **Step 3: Implement pure `deriveWorkOrderStatus` + async `recalculateWorkOrderStatus(supabase, workOrderId)` that loads jobs/parts/inspection/QC flags, derives status, updates `work_order` if changed, writes timeline + audit when status changes.

Active jobs = not `cancelled` and not `declined` for “all completed” checks (declined/cancelled remain visible but don’t block completion).

Priority order (after locked statuses):  
waiting_for_approval → waiting_for_parts → in_progress → ready_for_technician (all active approved/ready and no waiting parts) → quality_check → ready_for_pickup → else open / inspection_in_progress based on inspection.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/status/recalculateWorkOrderStatus.ts tests/unit/recalculateWorkOrderStatus.test.ts
git commit -m "feat: implement work order status recalculation with unit tests"
```

---

### Task 14: Work order number helper (TDD)

**Files:**
- Create: `lib/services/workOrderNumber.ts`
- Test: `tests/unit/workOrderNumber.test.ts`

- [ ] **Step 1: Test formatting**

```ts
import { describe, it, expect } from "vitest";
import { formatWorkOrderNumber } from "@/lib/services/workOrderNumber";

describe("formatWorkOrderNumber", () => {
  it("formats WO-1001", () => {
    expect(formatWorkOrderNumber(1001)).toBe("WO-1001");
  });
});
```

- [ ] **Step 2: Implement**

```ts
export function formatWorkOrderNumber(n: number) {
  return `WO-${n}`;
}
```

Minting logic lives in `createWorkOrder`: `SELECT next_number FROM work_order_sequence WHERE location_id = $1 FOR UPDATE` → use number → increment. Implement as SQL RPC:

```sql
-- add to new migration 007 if needed
CREATE OR REPLACE FUNCTION mint_work_order_number(p_location_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO work_order_sequence (location_id, next_number)
  VALUES (p_location_id, 1001)
  ON CONFLICT (location_id) DO NOTHING;

  UPDATE work_order_sequence
  SET next_number = next_number + 1
  WHERE location_id = p_location_id
  RETURNING next_number - 1 INTO n;

  RETURN 'WO-' || n::text;
END;
$$;
```

- [ ] **Step 3: Commit**

```bash
git add lib/services/workOrderNumber.ts tests/unit/workOrderNumber.test.ts supabase/migrations/007_mint_work_order_number.sql
git commit -m "feat: add per-location work order number minting"
```

---

## Phase 3 — Customers, motorcycles, service catalogue

### Task 15: Customer services + pages

**Files:**
- Create: `lib/services/customers.ts`
- Create: `app/(app)/customers/page.tsx`, `new/page.tsx`, `[customer_id]/page.tsx`
- Create: form components under `components/forms/`

- [ ] **Step 1: Implement `createCustomer` / `updateCustomer` / `searchCustomers`**

Each mutation: `requireUser` → permission (front office) → Zod → insert/update → `addAuditLog` (`customer_created` / `customer_updated`).

- [ ] **Step 2: UI** — search by first/last/phone/email; create/edit forms; detail shows motorcycles list (empty OK).

- [ ] **Step 3: Manual acceptance (Test 1)** — create customer without phone/email → error; with phone → appears in search.

- [ ] **Step 4: Commit**

```bash
git add lib/services/customers.ts app/\(app\)/customers components/forms
git commit -m "feat: add customer create, search, and detail pages"
```

---

### Task 16: Motorcycle + service information

**Files:**
- Create: `lib/services/motorcycles.ts`
- Create: motorcycle pages + service info edit on detail

- [ ] **Step 1: `createMotorcycle`** also inserts empty `motorcycle_service_information` row.

- [ ] **Step 2: `updateMotorcycleServiceInformation`** → audit + timeline if called with `work_order_id` context.

- [ ] **Step 3: UI** — missing VIN warning banner when `vin` null/blank.

- [ ] **Step 4: Manual acceptance (Test 2)**.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add motorcycles and service information profiles"
```

---

### Task 17: Service catalogue settings

**Files:**
- Create: `lib/services/serviceCatalogue.ts`
- Create: `app/(app)/settings/services/page.tsx`

- [ ] **Step 1: List/create/deactivate services; gate with `canManageServiceCatalogue`.**

- [ ] **Step 2: Audit each change; never hard-delete (set `active=false`).**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add service catalogue admin settings"
```

---

## Phase 4 — Work orders

### Task 18: Create work order (transactional)

**Files:**
- Create: `lib/services/workOrders.ts` (`createWorkOrder`, list, getDetail)
- Create: `app/(app)/work_orders/new/page.tsx`, `page.tsx`

- [ ] **Step 1: Implement `createWorkOrder`**

Pseudo-order inside one Postgres RPC preferred (`create_work_order_full`); if not, sequential with careful error handling:

1. Permission `canCreateWorkOrder`  
2. Validate schema; `location_id` must equal `user.active_location_id`  
3. `mint_work_order_number(location_id)`  
4. Insert `work_order` (status `open` or `draft` per product choice—use `open` when services selected)  
5. Insert `inspection`  
6. Insert `inspection_result` rows from active template with snapshots  
7. For each `service_id`, insert `job` with name/price/labour snapshots  
8. Timeline: WO created, inspection created, each job created  
9. Audit: `work_order_created`  
10. `recalculateWorkOrderStatus`  
11. Return `{ work_order_id, work_order_number }`

- [ ] **Step 2: New WO wizard UI** — select/create customer → select/create bike → invoice #, mileage, services multi-select, primary tech → submit.

- [ ] **Step 3: List page** — filter by active location only; show `work_order_number`, external invoice, customer, bike, status, tech, flags.

- [ ] **Step 4: Manual acceptance (Test 3)**.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: create location-scoped work orders with auto inspection and jobs"
```

---

### Task 19: Work order detail shell

**Files:**
- Create: `app/(app)/work_orders/[work_order_id]/page.tsx`
- Create: `components/work_orders/WorkOrderHeader.tsx`, tab components stubs

- [ ] **Step 1: Load WO with customer, motorcycle, jobs, flags.**

- [ ] **Step 2: Header fields** exactly as build sheet (number, invoice, status, customer contact, bike, VIN, colour, mileage, primary tech, ETA, created, flags).

- [ ] **Step 3: Tabs** Overview | Jobs | Inspection | Recommendations | Parts | Photos | Notes | Timeline | Service Info — render tab chrome and Overview first; Jobs–Timeline panels show “Coming in next tasks” placeholders until Tasks 20–27 replace them with real components.

- [ ] **Step 4: Guard** — if WO `location_id` ≠ active location, show read-only banner “This work order belongs to another location” (allow view for history from bike page; block mutations unless user switches location).

- [ ] **Step 5: Implement on Overview** `assignTechnicianToWorkOrder` (insert `work_order_technician`) and `setPrimaryTechnician` (update `primary_technician_id`) with permission `canAssignTechnician`, timeline events `TECHNICIAN_ASSIGNED` / `PRIMARY_TECHNICIAN_CHANGED`, and audit entries.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add work order detail header and tab shell"
```

---

## Phase 5 — Jobs and approvals

### Task 20: Job mutations

**Files:**
- Create: `lib/services/jobs.ts`
- Create: `components/jobs/JobCard.tsx`, `JobActions.tsx`

- [ ] **Step 1: Implement** `addJobToWorkOrder`, `assignTechnicianToJob`, `updateJobStatus`, `recordCustomerApproval`, `recordCustomerDecline`.

Rules:
- Approval sets `approved_by_customer_at`, `approval_method`, `approval_recorded_by_user_id`; timeline `CUSTOMER_APPROVAL_RECORDED`; audit  
- Decline requires `decline_reason`  
- Cancel requires note  
- Technician may only start/complete jobs where `assigned_technician_id === user.user_id`  
- Cannot `in_progress` unless `approved` or `ready_to_start`  
- Cannot `completed` unless assigned  
- Each status change → timeline + audit + `recalculateWorkOrderStatus`

- [ ] **Step 2: UI actions** with confirmation modals for decline/cancel.

- [ ] **Step 3: Manual Tests 4, 9, 15 (approval permission).**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add job lifecycle, approval, and decline flows"
```

---

## Phase 6 — Inspection

### Task 21: Inspection template admin

**Files:**
- Create: `lib/services/inspectionTemplate.ts`
- Create: `app/(app)/settings/inspection_template/page.tsx`

- [ ] **Step 1: CRUD-ish** — create/edit/reorder/deactivate; `canManageInspectionTemplate`; audit; no delete.

- [ ] **Step 2: Manual Test 17** (rename item; old inspection keeps snapshot).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add inspection template admin"
```

---

### Task 22: Inspection screen + auto-save

**Files:**
- Create: `lib/services/inspections.ts`
- Create: `app/(app)/work_orders/[work_order_id]/inspection/page.tsx`
- Create: `components/inspections/InspectionItemRow.tsx`

- [ ] **Step 1: `saveInspectionResult`** — update status/measurement/notes; timeline for significant changes; audit; show incomplete count.

- [ ] **Step 2: Client auto-save** — status on click immediate; measurement/notes debounce 400ms or onBlur; UI states saving | saved | error.

- [ ] **Step 3: `completeInspection`** — warn if incomplete; owner/manager may force; set `completed_at` / `completed_by_user_id`; timeline; recalc.

- [ ] **Step 4: Create Recommendation button** opens form (Task 23).

- [ ] **Step 5: Manual Tests 5, 6 partial.**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add inspection checklist UI with auto-save and completion"
```

---

## Phase 7 — Recommendations

### Task 23: Recommendations + convert to job

**Files:**
- Create: `lib/services/recommendations.ts`
- Create: `components/recommendations/*`

- [ ] **Step 1: `createRecommendation` / `createRecommendationFromInspectionResult`** — severity defaults from inspection status; link `inspection_result_id`.

- [ ] **Step 2: `updateRecommendationStatus`** — approve/decline/defer; never delete in UI.

- [ ] **Step 3: `convertRecommendationToJob`** (transaction): select service → create job (`waiting_for_approval` unless already approved) → set `converted_job_id` + status `converted_to_job` → timeline + audit → recalc.

- [ ] **Step 4: Safety critical** visual emphasis in UI.

- [ ] **Step 5: Manual Tests 6, 7, 16.**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add recommendations and convert-to-job flow"
```

---

## Phase 8 — Parts

### Task 24: Parts workflow

**Files:**
- Create: `lib/services/parts.ts`
- Create: `components/parts/*`

- [ ] **Step 1: `addPartToJob` / `updatePartStatus`**

Hard rule:

```ts
const ORDERABLE_JOB_STATUSES = [
  "approved",
  "waiting_for_parts",
  "ready_to_start",
  "in_progress",
] as const;

if (newStatus === "ordered" && !ORDERABLE_JOB_STATUSES.includes(job.status)) {
  throw new Error("Parts cannot be ordered before customer approval.");
}
```

Set `ordered_at` / `installed_at` appropriately; installed requires job assigned technician (build sheet); timeline + audit + recalc.

- [ ] **Step 2: Manual Tests 8, 10.**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add parts tracking with approval-before-order enforcement"
```

---

## Phase 9 — Photos and notes

### Task 25: Intake photos

**Files:**
- Create: `lib/services/photos.ts`
- Create: `components/photos/*`

- [ ] **Step 1: Upload** to Storage path `{work_order_id}/{category}/{uuid}.jpg`; insert `intake_photo`; timeline `INTAKE_PHOTO_UPLOADED`; audit.

- [ ] **Step 2: Grid + category filter; encourage required categories.**

- [ ] **Step 3: Flag** `No Intake Photos` on dashboard/header when count=0.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add intake photo upload and gallery"
```

---

### Task 26: Technician notes

**Files:**
- Create: `lib/services/notes.ts`
- Create: `components/work_orders/TechnicianNotes.tsx`

- [ ] **Step 1: Append-only `addTechnicianNote`**; no edit/delete UI; timeline + audit.

- [ ] **Step 2: Filter by job optional.**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add append-only technician notes"
```

---

## Phase 10 — Timeline UI + owner audit UI

### Task 27: Timeline tab

**Files:**
- Create: `components/timeline/TimelineList.tsx`

- [ ] **Step 1: List events newest first; toggle oldest first; read-only.**

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: add work order timeline view"
```

---

### Task 28: Owner audit log page

**Files:**
- Create: `app/(app)/settings/audit/page.tsx`
- Create: `components/audit/AuditLogTable.tsx`
- Create: `lib/services/audit.ts` (`listAuditLogs`)

- [ ] **Step 1: Gate page with `canViewAuditLog`; redirect others.**

- [ ] **Step 2: Filters** — date range, actor, location, entity_type.

- [ ] **Step 3: Verify RLS blocks non-owner SELECT.**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add owner-only global audit log UI"
```

---

## Phase 11 — Dashboard, technician view, completion

### Task 29: Dashboard

**Files:**
- Create: `lib/services/dashboard.ts`
- Create: `app/(app)/dashboard/page.tsx`
- Create: `components/status/FlagBadges.tsx`

- [ ] **Step 1: Counts** for cards scoped to `active_location_id` (open, waiting approval, waiting parts, ready for tech, in progress, QC, ready pickup, overdue, incomplete inspections, unassigned jobs).

- [ ] **Step 2: Table + filters** from build sheet; flags including safety-critical recommendation.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add location-scoped operational dashboard"
```

---

### Task 30: Technician view

**Files:**
- Create: `app/(app)/technician/page.tsx`

- [ ] **Step 1: Lists** assigned WOs/jobs for active location; deep links to inspection/jobs.

- [ ] **Step 2: Hide** approval/complete-WO actions via permissions in UI + server.

- [ ] **Step 3: Manual Test 15.**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add technician dashboard for assigned work"
```

---

### Task 31: Quality check, ready for pickup, complete

**Files:**
- Create: `lib/services/quality.ts`
- Wire actions on WO detail Overview tab

- [ ] **Step 1: `completeQualityCheck`** — permission; optional notes; set QC fields; timeline; audit; recalc.

- [ ] **Step 2: `markReadyForPickup`** — require all active jobs completed + QC; set `ready_for_pickup_at`; timeline; audit.

- [ ] **Step 3: `completeWorkOrder`** — require ready_for_pickup unless `canOverrideWorkOrderStatus`; set `released_by_user_id`, `pickup_notes`, `completed_at`, status `completed`; timeline; audit.

- [ ] **Step 4: `cancelWorkOrder` / `placeWorkOrderOnHold`** with confirmations.

- [ ] **Step 5: Manual Tests 11–14.**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add quality check, ready for pickup, and work order completion"
```

---

## Phase 12 — Users & locations admin

### Task 32: Locations admin

**Files:**
- Create: `lib/services/locations.ts`
- Create: `app/(app)/settings/locations/page.tsx`

- [ ] **Step 1: Owner creates location** → insert `location` + `work_order_sequence` row; audit.

- [ ] **Step 2: Assign users** via `user_location` edits; audit.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add owner location management"
```

---

### Task 33: Users admin

**Files:**
- Create: `lib/services/users.ts`
- Create: `app/(app)/settings/users/page.tsx`

- [ ] **Step 1: Owner creates `app_user`** after Auth user exists (document: create in Supabase Auth, then link `auth_user_id`, role, locations). Optional invite helper later—V1 can be manual link form.

- [ ] **Step 2: Suspend/inactivate blocks login via `getCurrentAppUser`.**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add owner user management"
```

---

## Phase 13 — Safari polish and definition of done

### Task 34: UI polish for Mac/iPad Safari

**Files:**
- Modify: global CSS / shell components

- [ ] **Step 1: Large tap targets (min ~44px) on technician actions.**

- [ ] **Step 2: No hover-only critical actions.**

- [ ] **Step 3: Test in Safari Mac + iPad**: login, location switch, create WO, inspection auto-save, photo upload from camera roll, approval, part order block, QC, complete.

- [ ] **Step 4: Commit**

```bash
git commit -m "fix: polish operational UI for Safari on Mac and iPad"
```

---

### Task 35: Acceptance checklist pass

- [ ] **Step 1: Run unit tests**

```bash
npm test
```

Expected: all PASS.

- [ ] **Step 2: Walk build-sheet Tests 1–17** plus design extras:
  - Location switch scopes dashboard
  - WO numbers unique per location (`WO-1001` can exist at two shops)
  - Non-owner cannot open `/settings/audit`
  - Parts order before approval blocked
  - Recommendations not deletable
  - Template rename does not rewrite old snapshots

- [ ] **Step 3: Final commit if fixes needed**

```bash
git commit -m "test: close V1 acceptance gaps from checklist"
```

---

## Testing conventions

- **Unit (Vitest):** permissions, status derivation, Zod schemas, WO number formatting — every pure function gets tests before implementation in its task.
- **Manual (Safari):** each phase ends with the matching acceptance tests from the build sheet.
- **Do not** claim a phase done without running the commands/tests listed in that task.

## Mutation checklist (every service writer)

Before merging any mutation service, confirm:

1. `requireUser()` + permission check  
2. Zod / business rules  
3. DB write  
4. Timeline if work-order related  
5. `addAuditLog` always  
6. `recalculateWorkOrderStatus` when listed in spec  
7. Clear error strings for blocked actions  

---

## Spec coverage map

| Spec area | Tasks |
|-----------|-------|
| Stack / Safari clients | 1, 34 |
| Schema + seeds + RLS | 3–6 |
| Auth / roles / locations | 8, 10–11, 32–33 |
| Permissions / validation / status | 7–9, 13–14 |
| Timeline + audit | 12, 27–28 |
| Customers / bikes / catalogue | 15–17 |
| Work orders + numbers | 14, 18–19 |
| Technician assignment on WO | 19 |
| Jobs / approval | 20 |
| Inspection | 21–22 |
| Recommendations | 23 |
| Parts | 24 |
| Photos / notes | 25–26 |
| Dashboard / tech / QC / complete | 29–31 |
| Acceptance | 35 |

---

## Out of scope (do not implement in this plan)

Invoicing, payments, customer portal, SMS/email automation, inventory, supplier integrations, native App Store apps, full analytics.
