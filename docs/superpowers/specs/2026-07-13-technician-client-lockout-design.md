# Technician client lockout

**Date:** 2026-07-13  
**Status:** Approved for implementation

## Problem

Technicians can open Customers and Motorcycles, search the client directory, and see customer name/phone/email on work-order and floor surfaces. Only documents and billing are role-gated today. Client CRM and PII must be front-office only.

## Decisions locked

| Decision                 | Choice                                                     |
| ------------------------ | ---------------------------------------------------------- |
| Approach                 | App-layer gates + RLS on `customer` (approach 2)           |
| Who can view clients     | owner, manager, service_advisor, admin                     |
| Technician client access | None — no CRM routes, no search hits, no name/phone/email  |
| Floor identity           | Motorcycle / unit label only                               |
| `motorcycle` table RLS   | Unchanged — active staff can still read bike/unit for jobs |
| Documents / billing      | Already blocked for technicians — no change                |

## Permissions

New helper: `canViewClients(role)` — true for owner, manager, service_advisor, admin; false for technician.

Used for:

- Sidebar Clients → Records (Customers, Motorcycles)
- Page redirects on `/customers/*` and `/motorcycles/*`
- Customer and motorcycle directory services (list, search, count, get-by-id)
- Customer hits in global search
- Any server action that exposes customer directory data

Existing write gates (`canAdminHelpCreateRecords`, document helpers) stay as they are.

## UI

- Hide Customers and Motorcycles nav links when `!canViewClients(role)`.
- Redirect unauthorized visits to `/dashboard` (same pattern as billing).
- Technician-facing surfaces must not show customer name, phone, email, or links to `/customers/...`:
  - Technician floor / assigned jobs
  - Work order cards and headers when the viewer is a technician
  - Parts board rows for technicians
  - Inspection headers for technicians
- Those surfaces show motorcycle label only (make/model/year/plate or existing bike label helpers).

## Services

- `lib/services/customers.ts` — gate reads (`countCustomers`, `searchCustomers`, `getCustomerById`) with `canViewClients`; writes already gated.
- `lib/services/motorcycles.ts` — gate directory reads used as CRM; create/update remain on existing helpers.
- `lib/services/clientGarage.ts`, `listWorkOrdersForCustomer` — unreachable without customer profile access; still throw `FORBIDDEN` if called without `canViewClients`.
- `lib/services/globalSearch.ts` / search actions — omit customer (and motorcycle CRM) results for technicians.
- Technician / floor / dashboard / parts / inspection loaders — do not select or map customer PII for technician callers; use motorcycle labels only.

## Database (RLS)

New migration (pattern from `033_customer_document_rls_roles.sql`):

- `customer` SELECT, INSERT, UPDATE: require `is_active_app_user()` and `current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')`.
- Technicians cannot read `customer` via the Data API even if the UI is bypassed.
- `motorcycle` policies unchanged so assigned jobs still resolve bike/unit.
- Service-role paths (if any) continue to bypass RLS.

## Testing

- Unit: `canViewClients` matrix; technician sidebar has no `/customers` or `/motorcycles`.
- Unit/service: technician paths do not expose `customer_label` / phone / email.
- Manual: technician login cannot open CRM URLs; floor shows bike only; front office unchanged.

## Out of scope

- Restricting motorcycle SELECT by assignment
- Hiding bike/unit identifiers from technicians
- Changing admin role beyond including them in `canViewClients`
- Portal / customer-facing apps
