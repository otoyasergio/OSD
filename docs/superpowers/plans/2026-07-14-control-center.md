# Service Control Center Implementation Plan

See also: [design spec](../specs/2026-07-14-control-center-design.md)

Implemented on `feature/control-center` (from `feature/wix-crm-merge`).

## Delivered

- `/control-center` page + `ControlCenterShell` (DnD, timers, realtime)
- `getControlCenterData`, assign/unassign all active jobs, `opened_at` Open action
- Migration `044_work_order_opened_at.sql`
- Nav link under Shop floor
- Unit tests for at-risk, availability, timers, assignment shape
