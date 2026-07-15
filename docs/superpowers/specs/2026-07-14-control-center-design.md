# Service Control Center — Design Spec

Approved 2026-07-14 from the Service Control Center design handoff.

## Goal

Front-office (owner / manager / service advisor) **Control Center** at `/control-center`: a live dispatch board. Unassigned bikes sit in a carousel; drag onto a technician to assign. Live time-in-shop and work timers. Role-specific KPIs.

## Decisions

| Topic        | Choice                                                                                |
| ------------ | ------------------------------------------------------------------------------------- |
| Scope        | Full UI fidelity in one PR                                                            |
| Route        | `/control-center` beside `/dashboard`                                                 |
| Role UI      | No Owner/Manager/Advisor switcher — real session role                                 |
| Availability | Derived: Off / Busy / Available from clock + active jobs (no persist, no click cycle) |
| Assign       | All **active** jobs on the WO → tech; do **not** change `primary_technician_id`       |
| Work timer   | `work_order.opened_at` only; Open starts timer; **no** pause/resume                   |
| At risk      | Overdue **or** safety-critical **or** last job activity idle ≥ 3 days                 |
| Live         | Supabase realtime on `work_order` / `job` → `router.refresh()`                        |
| DnD          | `@dnd-kit` (ShopBoard pattern)                                                        |
| Branch       | `feature/control-center` from `feature/wix-crm-merge`                                 |

## Architecture

- Server page loads `getControlCenterData` (+ owner report metrics when allowed).
- Client `ControlCenterShell`: DnD, 1s timer tick, realtime subscribe.
- Assign/unassign via server actions wrapping job assignment helpers.
- Open sets `opened_at` if null.

## UI

Reuse AppShell, `PageHeader`, `.stat-card`, stage chips, PhotoActionCard media patterns, design tokens in `globals.css`. Layout: header + Live pill → KPI strip → bikes carousel (pool) → tech grid.

## Out of scope

Role switcher, pause/resume, persisted availability, mutating `primary_technician_id`, replacing `/dashboard`.
