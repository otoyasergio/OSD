# OTOMOTO Workshop Management App — V1 Design

**Date:** 2026-07-08  
**Status:** Approved for implementation planning  
**Source:** OTOMOTO Full Build Spec Document + clarifying decisions

## 1. Objective

Build an internal workshop management system for OTOMOTO to replace paper work orders and improve communication between front office and technicians.

This app manages **repair workflow only**. Invoicing and payments stay in existing external software. The work order stores `external_invoice_number` as a reference.

### Primary outcomes

Staff must always be able to answer: which bikes are in the shop, who owns them, what was requested, what inspection found, what needs approval, what parts are needed/ordered/installed, who is responsible, what is complete / ready for pickup, and what happened when (with who).

### Core principle

No meaningful action happens without a timestamp, a user, and a visible workflow consequence. Every meaningful mutation also writes an owner-only global audit log entry.

## 2. Scope

### In V1

- Users and roles, multi-location access
- Customers and motorcycles (company-wide)
- Motorcycle service information
- Work orders (location-scoped), jobs, service catalogue
- Inspections, editable inspection template, inspection results
- Recommendations (convert to jobs; never deleted)
- Parts on jobs, intake photos, technician notes
- Work-order timeline + owner-only full audit log
- Dashboard, technician view, quality check, ready for pickup, completed archive

### Out of V1

Invoicing, payments, accounting, customer portal, SMS/email automation, supplier ordering integration, inventory management, payroll, warranty automation, marketing, online booking, full reporting engine.

## 3. Decisions (beyond build sheet)

| Topic | Decision |
|-------|----------|
| Backend | Supabase (Postgres, Auth, Storage) — project created during setup |
| Auth | Email + password |
| Work order numbers | Sequential per location (`WO-1001`, …) |
| Locations | Multi-location from day one |
| User ↔ location | Many-to-many; users switch active location in-app |
| Customers / motorcycles | Shared company-wide |
| Work orders / dashboard | Scoped to active location |
| Audit | Every meaningful action logged; global audit log **owner-only** |
| Architecture approach | Spec-faithful app + thin multi-location layer (Approach A) |
| Service catalogue / inspection template | Company-wide in V1 |
| Client platform | Web app in Safari on Mac + iPad (usable on iPhone); not a native App Store app in V1 |

## 4. Architecture

### Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS + operational component UI
- PostgreSQL via Supabase
- Supabase Auth (email/password)
- Supabase Storage (intake photos)
- Server Actions / service layer for mutations
- Server-side validation + role-based access control

### Client platform (Apple-first web)

- Primary targets: **Safari on Mac** (front office) and **Safari on iPad** (technicians / floor)
- Secondary: Safari on iPhone (usable, not the primary layout target)
- Responsive operational UI with large tap targets; no native Mac/iOS app in V1
- Test critical flows in Safari (auth, photo upload, inspection auto-save, location switcher)

### Runtime

```
Safari (Mac / iPad / iPhone)
  → Next.js App Router
  → Server Actions / services
  → Supabase Auth + Postgres (+ Storage)
```

### Central modules

- `lib/permissions` — all permission decisions
- `lib/status` — `recalculateWorkOrderStatus`
- `lib/timeline` — work-order timeline events
- `lib/audit` — global owner-only audit log
- `lib/validation` — shared schemas
- `lib/services` — domain mutations

### Mutation transaction order

1. Validate permission  
2. Validate business rule  
3. Save data  
4. Add work-order timeline event (when work-order related)  
5. Add global audit log entry (always for meaningful actions)  
6. Recalculate work order status (when relevant)  
7. Return updated work order summary  

Actions that must run in a DB transaction (from build sheet):  
`createWorkOrder`, `convertRecommendationToJob`, `updateJobStatus`, `updatePartStatus`, `completeInspection`, `completeQualityCheck`, `markReadyForPickup`, `completeWorkOrder`, `cancelWorkOrder`.

## 5. Data model

### Base schema

Use the build sheet PostgreSQL schema as the starting migration for:

`app_user`, `customer`, `motorcycle`, `motorcycle_service_information`, `service`, `work_order`, `work_order_technician`, `job`, `inspection`, `inspection_template_item`, `inspection_result`, `recommendation`, `part`, `intake_photo`, `technician_note`, `timeline_event`

Plus indexes and seed data for services and inspection template items as specified.

### Extensions

#### `location`

- `location_id` uuid PK  
- `name` text NOT NULL  
- `code` text NOT NULL UNIQUE (e.g. `TOR`)  
- `status` text NOT NULL (`active` | `inactive`)  
- timestamps  

#### `user_location`

- `user_id` → `app_user`  
- `location_id` → `location`  
- PK `(user_id, location_id)`  
- User must have ≥1 location to use the app  

#### `work_order` additions

- `location_id` uuid NOT NULL → `location`  
- `work_order_number` text NOT NULL (display number, e.g. `WO-1001`)  
- UNIQUE `(location_id, work_order_number)`  

#### `work_order_sequence`

- `location_id` uuid PK → `location`  
- `next_number` integer NOT NULL DEFAULT 1001  
- Used inside `createWorkOrder` to mint numbers safely  

#### `audit_log` (owner-only)

- `audit_log_id` uuid PK  
- `actor_user_id` uuid → `app_user`  
- `location_id` uuid nullable → `location` (active location context when applicable)  
- `action` text NOT NULL  
- `entity_type` text NOT NULL  
- `entity_id` uuid nullable  
- `description` text NOT NULL  
- `old_value` jsonb  
- `new_value` jsonb  
- `created_at` timestamptz NOT NULL DEFAULT now()  

**Relationship to timeline:**  
- `timeline_event` = staff-visible history on a work order  
- `audit_log` = company-wide trace of every meaningful action; UI restricted to `owner`

### Scoping rules

| Entity | Scope |
|--------|--------|
| Customer, motorcycle, service info | Company-wide |
| Service catalogue, inspection template | Company-wide |
| Users | Company-wide accounts; access via role + locations |
| Work orders, jobs, inspections, parts, photos, notes, WO timeline | Belong to a work order → one location |
| Dashboard / WO lists / technician queue | Active location only |
| Customer/bike history | May show WOs from other locations (read) |

### Database rules (from build sheet, retained)

- One work order = one customer visit  
- Creating a work order auto-creates one inspection + result rows from active template (with snapshots)  
- One requested service = one job; parts belong to jobs only  
- Parts never ordered before customer approval  
- Inspection statuses: OK / Future Attention / Immediate Attention (blank = incomplete, not a fourth status)  
- Recommendations never deleted; conversion keeps original + `converted_job_id`  
- VIN/colour optional; missing VIN flagged in UI  
- Mileage on work order, not motorcycle  
- No hard delete for operational records in V1  

## 6. Auth and permissions

### Auth flow

1. Supabase Auth email/password sign-in  
2. Map to `app_user` by `auth_user_id` (or email on first link)  
3. Require `status = active`  
4. Load role + assigned locations  
5. Require active location in session (cookie); default to first assigned location  
6. Block inactive/suspended users  

### Roles

`owner` | `manager` | `service_advisor` | `technician` | `admin`

Permission matrix follows the build sheet. Additional V1 rules:

- Only **owner** can view/search the global audit log  
- Only **owner** manages users by default; owner also manages locations  
- Manager/owner may override work-order status locks as specified  
- Technician cannot record customer approval, complete work orders, manage catalogue/users, or delete records  

All checks go through `lib/permissions` — not ad hoc in components.

## 7. Screens and navigation

### App shell

- Nav: Dashboard, Work Orders, Customers, Motorcycles, Technician, Settings  
- Location switcher always visible (assigned locations only)  
- Operational UI: fast, plain, large tap targets, status always visible  
- Layout tuned for Mac desktop widths and iPad portrait/landscape; avoid hover-only actions 

### Screens

1. **Dashboard** — location-scoped cards, table, filters, flags (per build sheet)  
2. **Customers** — search/create/edit; motorcycles; history via bikes  
3. **Motorcycles** — search/create/edit; service info; history; missing VIN warning  
4. **Motorcycle service information** — reusable parts/specs profile  
5. **Create work order** — customer/bike select-or-create; invoice #; mileage; services; primary tech; creates WO + inspection + jobs + timeline + audit under active location  
6. **Work order detail** — header + tabs: Overview, Jobs, Inspection, Recommendations, Parts, Intake Photos, Technician Notes, Timeline, Service Information + completion actions  
7–13. Jobs, Inspection, Recommendations, Parts, Photos, Notes, Timeline — as build sheet  
14. **Technician view** — assigned work for active location  
15. **Service catalogue** — owner/manager  
16. **Inspection template admin** — owner/manager; deactivate not delete; snapshots protect history  
17. **Users** — owner  
18. **Locations** — owner (create/edit locations; assign users)  
19. **Audit log** — owner only  

Work order number shown in UI is `work_order_number` (e.g. `WO-1001`), not the UUID.

## 8. Workflow and status

### Normal flow

Customer arrives → external invoice/estimate in existing software → create WO in app (active location) → intake photos → tech inspection → recommendations → front office converts to jobs → record approval on jobs → parts on approved jobs → assign/perform repair → QC → ready for pickup → release/complete.

### Flexible cases

Immediate approval (e.g. oil change), diagnostics needing approval before parts, inspections that pass or spawn more work, multi-job WOs, declined jobs while others continue, deferred recommendations, on hold, owner/manager override.

### `recalculateWorkOrderStatus`

Run after: job create/status change, part create/status change, inspection completion, QC, ready for pickup, WO completion.

Rules from build sheet retained (do not auto-change completed / cancelled / on_hold; priority for waiting approval, waiting parts, in progress, ready for technician, quality check, ready for pickup, etc.).

### Hard rules

1. Meaningful mutation → permission → write → timeline (if WO) → audit → status recalc when relevant  
2. Cannot order parts before job approval  
3. Recommendations never deleted  
4. Template edits do not rewrite old inspection snapshots  
5. No hard deletes for operational records  
6. No invoicing/payments/customer portal  
7. QC required before ready for pickup; all active jobs completed required for ready for pickup  
8. Complete requires `released_by_user_id`; sets `completed_at`  

## 9. Audit and timeline

### Work-order timeline

Staff-visible on each work order. Event types as listed in the build sheet (WO created/status changed, photos, inspection, jobs, approvals, recommendations, parts, QC, pickup, completion, etc.). Newest first by default; oldest-first toggle. Not deletable by normal users.

### Global audit log

Every meaningful create/update/status change across customers, motorcycles, work orders, jobs, parts, settings, users, locations, location switches, and auth-relevant account status changes.

- Owner-only UI  
- Filterable by date, user, location, entity type  
- Complements (does not replace) work-order timeline  

## 10. UI, validation, search

- Status badges with readable labels from build sheet  
- Confirmations: decline job, cancel job/WO, complete inspection with incomplete items, complete WO, convert recommendation  
- Warnings: missing VIN, missing external invoice #, no intake photos, incomplete inspection, waiting approval/parts, safety-critical recommendation, overdue  
- Inspection auto-save: immediate on status; debounce/blur on measurement/notes; saving/saved/error states  
- Search customers, motorcycles, work orders as specified  
- Dashboard filters as specified  

Validation rules follow the build sheet (customer phone-or-email, motorcycle year/make/model, decline reason, etc.).

## 11. Error and edge cases

- Permission or business-rule failure → clear error, full transaction rollback  
- Inspection auto-save failure → error state; preserve technician input  
- No assigned locations → block app until owner assigns  
- Suspended/inactive → cannot sign in  
- Location switch changes list/dashboard scope; does not move open work  
- Empty and loading states on operational lists  

## 12. File structure (guidance)

```
app/
  dashboard/
  customers/
  motorcycles/
  work_orders/
  technician/
  settings/
    services/
    inspection_template/
    users/
    locations/
    audit/
components/
lib/
  database/
  auth/
  permissions/
  validation/
  status/
  timeline/
  audit/
  services/
supabase/
  migrations/
```

## 13. Build phases

1. Foundation — project, schema (+ extensions), seed, auth, roles, permissions, locations  
2. Core records — customers, motorcycles, service info, service catalogue  
3. Work orders — list/create/detail, auto inspection, assignment, WO numbers  
4. Jobs — status, approval, status recalculation  
5. Inspection — template admin, screen, auto-save, complete  
6. Recommendations — create, from inspection, convert to job  
7. Parts — statuses, approval gate, installed tracking  
8. Photos and notes  
9. Timeline + global audit wiring on all mutations  
10. Dashboard and completion — QC, ready for pickup, complete, archive  

## 14. Acceptance criteria

Version 1 is done when OTOMOTO can run daily workshop workflow in the app instead of paper, including:

- Front office: customers, bikes, work orders, photos, convert recommendations, record approval, parts on approved jobs, QC, ready for pickup, complete/release  
- Technicians: inspections, recommendations, notes, start/complete assigned jobs, mark parts installed when assigned  
- Multi-location switch with location-scoped operational views  
- Sequential per-location work order numbers  
- Motorcycle history across visits  
- Work-order timeline + owner-only full audit log  
- Role enforcement  
- Records preserved (no hard deletes)  
- Build-sheet acceptance tests 1–17 still apply, plus: location switch scopes dashboard; WO numbers unique per location; non-owners cannot open audit log; ordering parts before approval still blocked  

## 15. Explicit non-goals reminder

Do not build invoicing, payments, customer portal, SMS/email automation, inventory, or skip timeline, audit, permissions, or work-order status recalculation.
