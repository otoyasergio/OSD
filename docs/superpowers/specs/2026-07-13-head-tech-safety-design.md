# Head Tech Safety Environment

**Date:** 2026-07-13  
**Status:** Approved for implementation

## Problem

Pedram is Head Tech and the only person who may pass safety after QC. The shop needs a Head Tech role, a dedicated safety stage in the visit pipeline, and a Safeties lane on the technician floor. Head Tech must not see customer PII.

## Decisions locked

| Decision             | Choice                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Approach             | New WO status `safety_check` between QC and pickup                                               |
| Role                 | New `head_tech` (Pedram); inherits technician floor + Safeties                                   |
| Client PII           | None — same `canViewClients` lockout as technician                                               |
| When safety required | Active **Safety Inspection** job on WO, unless office overrides                                  |
| Office override      | Force require **or** waive                                                                       |
| Fail                 | Recommendations required → `waiting_for_customer_approval`; re-enter QC then safety after rework |
| Pass                 | Stamp safety → `ready_for_pickup`                                                                |

## Flow placement

Visit order:

Intake → Inspection → Approval → Parts → In shop → QC → **Safety** → Pickup → Completed

After QC completes: if safety required and not waived → `safety_check`; else → `ready_for_pickup` (current behavior).

## Role and permissions

- Extend `UserRole` / DB CHECK / Zod / user admin UI with `head_tech`.
- `canPerformSafetyCheck(role)` → `head_tech` only.
- `canOverrideSafetyRequirement(role)` → owner, manager, service_advisor.
- Treat `head_tech` like `technician` for: pull job, complete job, peer QC, parts board, floor, CRM lockout (`canViewClients` false), inspection complete, recommendations (create allowed for fail path; convert still front office).

## Data model

- `app_user.role` CHECK includes `head_tech`.
- `work_order.status` CHECK includes `safety_check`.
- Columns on `work_order`:
  - `safety_checked_at timestamptz`
  - `safety_checked_by_user_id` FK → `app_user`
  - `safety_check_notes text`
  - `safety_required boolean null` — null = default (derive from Safety Inspection job); true = force
  - `safety_waived boolean not null default false`

Helper: `isSafetyRequired(wo, jobs)` — true if `safety_required === true` OR (not waived AND any non-cancelled job linked to service named `Safety Inspection`).

On fail: clear `quality_checked_at` / `quality_checked_by_user_id` / peer QC assignee (and any safety fields) so the visit re-derives through work → QC → safety after customer re-approval and rework.

## Head Tech environment

Same `/technician` floor with an extra **Safeties** lane (WOs in `safety_check`). Selecting a Safety item opens a Safety stage: read-only inspection report, notes, Pass / Fail. Fail requires ≥1 recommendation. Regular tech work unchanged. Office require/waive on WO Overview only.

## Testing

- Permissions matrix for `head_tech`
- Recalc: with Safety Inspection job → `safety_check`; waived → pickup; forced without job → `safety_check`
- Pass/fail service paths
- Floor: Safeties lane only for `head_tech`
- No customer PII on head_tech floor paths

## Out of scope

- Road-test stage, multi–head-tech load balancing, Head Tech CRM access, renaming the Safety Inspection catalogue service
