# Technician Client Lockout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Technicians cannot access clients or any client PII; floor surfaces show motorcycle/unit labels only.

**Architecture:** Add `canViewClients` (front office + admin). Gate CRM nav/pages/services and global search. Redact customer fields on technician-facing loaders and WO UI. Tighten `customer` RLS to non-technician roles; leave `motorcycle` readable for bike/unit.

**Tech Stack:** Next.js App Router, Supabase RLS, Vitest permission/nav tests

**Spec:** `docs/superpowers/specs/2026-07-13-technician-client-lockout-design.md`

---

### File map

| File                                                           | Responsibility                                |
| -------------------------------------------------------------- | --------------------------------------------- |
| `lib/permissions/checks.ts`                                    | `canViewClients`                              |
| `tests/unit/permissions.test.ts`                               | Permission matrix                             |
| `tests/unit/sidebarNav.test.ts`                                | Tech nav has no CRM links                     |
| `components/layout/SidebarNav.tsx`                             | Hide Customers/Motorcycles                    |
| `lib/services/customers.ts`                                    | Gate reads                                    |
| `lib/services/motorcycles.ts`                                  | Gate directory reads                          |
| `lib/services/clientGarage.ts`                                 | Gate                                          |
| `lib/services/filedWorkOrders.ts`                              | Gate customer WO list                         |
| `lib/services/globalSearch.ts`                                 | Skip CRM results for techs                    |
| `app/(app)/customers/**`                                       | Redirect if !canViewClients                   |
| `app/(app)/motorcycles/**`                                     | Redirect if !canViewClients                   |
| `lib/services/technician.ts` / `technicianFloor.ts`            | No customer_label                             |
| `lib/services/dashboard.ts`, `partsBoard.ts`, `inspections.ts` | Redact for techs                              |
| `components/work_orders/WorkOrderHeader.tsx` + WO page         | Hide customer + motorcycle CRM link for techs |
| `supabase/migrations/041_customer_rls_roles.sql`               | Role-scoped customer RLS                      |

### Task 1: Permission + nav

- [ ] Add `canViewClients` = FRONT_OFFICE || admin
- [ ] Tests: tech false; owner/manager/advisor/admin true
- [ ] Sidebar: Records links only if `canViewClients`
- [ ] Sidebar test: technician has no `/customers` or `/motorcycles`

### Task 2: CRM pages + services

- [ ] Gate `countCustomers`, `searchCustomers`, `getCustomerById`
- [ ] Gate motorcycle directory reads similarly
- [ ] Gate `clientGarage` + `listWorkOrdersForCustomer`
- [ ] Redirect all `/customers/*` and `/motorcycles/*` pages

### Task 3: Search + floor redaction

- [ ] `searchAll`: if !canViewClients, skip customer/motorcycle CRM hits; WO meta bike-only
- [ ] Technician/floor services: empty `customer_label` / use bike subtitle
- [ ] Dashboard/parts/inspection: omit customer name for technician role
- [ ] `WorkOrderHeader`: accept `canViewClients`; hide customer block and motorcycle profile link when false

### Task 4: RLS migration

- [ ] `041_customer_rls_roles.sql` — SELECT/INSERT/UPDATE require role IN (owner, manager, service_advisor, admin)

### Task 5: Verify

- [ ] Run `npx vitest run tests/unit/permissions.test.ts tests/unit/sidebarNav.test.ts`
- [ ] Confirm no customer PII paths remain for technician in grepped floor services
