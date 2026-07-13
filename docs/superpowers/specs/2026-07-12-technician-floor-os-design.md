# Technician Floor OS design

**Date:** 2026-07-12  
**Status:** Draft — awaiting user review  
**Approach:** Single Floor OS on `/technician` (hybrid queue + work surface)

## Goal

Make the technician day easy, sensible, and satisfying enough that techs actually use it — shaped by Toyota/Lean one-piece flow and Six Sigma standard work / built-in quality.

Primary client: Safari on iPad (landscape). Mac/desktop remains usable; deep links to existing work-order routes stay.

## Decisions (from design workshop)

| Topic         | Choice                                                                  |
| ------------- | ----------------------------------------------------------------------- |
| Layout        | Hybrid: left/top queue + focused work surface                           |
| Assignment    | Advisors assign priority; free techs may pull ready work                |
| Blocked work  | Soft flag + note; tech keeps flowing; **highlighted for admin**         |
| Job complete  | Checklist + proof (after photo or exception note)                       |
| Scope         | Full tech day: home + inspection + parts + QC handoff                   |
| Quality check | Peer tech (not the worker); auto-rotate among clocked-in eligible techs |
| Time          | Day clock (payroll) + automatic job timers while In Progress            |

## Lean / Six Sigma mapping

| Principle        | Product behavior                                            |
| ---------------- | ----------------------------------------------------------- |
| One-piece flow   | Stay in Floor OS; finish open unit before hunting the board |
| Standard work    | Checklist + proof gate before Complete                      |
| Pull system      | Ready-to-pull lane when free; advisors still push priority  |
| Built-in quality | Peer QC by a different tech; fail returns with reason       |
| Visual control   | Admin-highlighted flags; clear queue lanes                  |
| Reduce variation | Same complete gate and QC path for every job                |

## Core value stream

```
Clock in
  → Open assigned priority OR pull ready
  → Inspection (if WO needs it)
  → Do job (checklist + auto job timer)
  → Parts install / proof
  → Complete job (gate)
  → When all jobs done → Needs QC (auto-assign peer)
  → Peer QC pass → ready-for-pickup path (front office)
  → Peer QC fail → return to original tech + admin flag
  → Next
```

Blocked at any point: **Flag for admin** (reason + optional note) → tech continues other work → admin sees highlight until cleared.

## Floor OS layout

### Shell: `/technician`

**Header:** location context, day clock elapsed, clocked-in state, clock out.

**Queue lanes (left on landscape; stacked above work surface on narrow):**

1. **Priority (assigned)** — advisor-assigned jobs for this tech; active job emphasized
2. **Ready to pull** — jobs/WOs at ready-for-tech (or job `ready_to_start`) with no assignee (or pullable per rules below)
3. **Needs QC (you)** — peer QC auto-assigned to this tech
4. **Flagged** — this tech’s open admin flags (also mirrored on admin surfaces)

**Work surface modes (tabs):** Job · Inspection · Parts · QC · Notes

Selecting a queue item opens the matching mode with one primary CTA and secondary Flag.

### Work surface — Job mode

- Vehicle / WO identity, service name, est vs live job timer
- Checklist (from service/job template or existing job todo)
- Parts to install (mark installed)
- Proof slot: after photo required unless exception note
- Actions: **Start** / **Complete** (gated) / **Flag for admin**

### Work surface — Inspection mode

- Embed or deep-link the existing fullscreen inspection flow inside the shell when possible
- Completing inspection returns to Floor OS queue (not a dead-end)

### Work surface — Parts mode

- Parts for the open job/WO that tech may install
- Clear empty / waiting-parts states with Flag CTA

### Work surface — QC mode

- Short peer QC checklist for the assigned WO
- Pass / Fail (+ reason on fail)
- Cannot open QC for work the current user performed (server-enforced)

### Work surface — Notes mode

- Existing technician notes types; Flag creates a structured flag note + highlight record

## Assignment & pull rules

- Advisors/managers retain assign-to-job / WO technician assignment (priority push).
- Clocked-in technicians may **pull** a ready job: sets `assigned_technician_id` to self when job is pullable.
- Pullable means: job status in `approved` / `ready_to_start` (and WO not blocked by unsigned contract / waiting approval / cancelled), and unassigned (or policy: only unassigned).
- Pull does not steal another tech’s in-progress job.
- Only one job may be `in_progress` per tech at a time. To switch: **Complete** the current job, or **Flag for admin** (stops the job timer, returns that job to `ready_to_start` while remaining assigned, opens the admin highlight).

## Complete job gate (Six Sigma)

Complete is allowed only when:

1. All checklist items checked
2. All required parts for the job marked installed (if any)
3. After photo attached **or** exception note recorded for incomplete/odd proof
4. Job was started (has `started_at`); completing stops timer and records actual labour via existing labour comparison path where applicable

UI: disabled Complete with plain language reason. Server rejects incomplete gates.

## Peer QC

- Trigger: WO derives or moves to `quality_check` when all actionable jobs are completed (align with existing `recalculateWorkOrderStatus`, plus explicit handoff if needed for clarity).
- **Auto-assign:** among active, clocked-in technicians at the location who did **not** complete any of the WO’s jobs (or were not assigned workers on those jobs). Prefer least-loaded (fewest open QC + jobs).
- Managers/advisors may override QC assignee.
- Pass: existing ready-for-pickup path (front office owns pickup/file).
- Fail: WO/jobs return to working tech’s queue with fail reason; open admin flag; job(s) reopened or WO held in a “QC failed” visible state until rework complete.
- Permission change: technicians gain `canPerformPeerQualityCheck` for assigned peer QC only; manager-only exclusive QC is no longer the only path (managers may still override / perform QC).

## Admin flags (soft andon)

- Tech selects reason: `parts` | `approval` | `tool` | `quality` | `other` + optional free text.
- Persisted as structured technician note and/or dedicated flag row linked to WO (and job if selected).
- Admin surfaces (dashboard board cards, WO header): persistent **highlight** until an owner/manager/advisor clears the flag.
- Tech is not blocked from other queue items.

## Time

- Keep day-level `time_clock_entry` on Floor OS header (existing clock actions).
- While a job is `in_progress`, show live job timer from `started_at`; on complete, freeze duration into actual labour fields already used by est-vs-actual.
- Out of scope: break types, pay-per-job engines, changing manager timesheet approval UX (see timesheets design).

## Permissions summary

| Action                                    | Technician | Advisor / Manager / Owner        |
| ----------------------------------------- | ---------- | -------------------------------- |
| Clock in/out                              | Yes        | Yes                              |
| See own queue / Floor OS                  | Yes        | Optional (ops may use dashboard) |
| Pull ready job                            | Yes (self) | Assign any                       |
| Start/complete own assigned job           | Yes (gate) | Yes                              |
| Flag for admin                            | Yes        | Clear flags                      |
| Peer QC (assigned, not own work)          | Yes        | Yes + override assignee          |
| Complete WO / ready for pickup / file     | No         | Yes                              |
| Order parts / billing / edit WO structure | No         | Per existing checks              |

## Architecture

### Primary surface

Rewrite/expand `app/(app)/technician/page.tsx` into Floor OS. Keep `/work_orders/[id]/*` and inspection routes for deep links and non-tech roles.

### Building blocks

| Unit                             | Responsibility                                       |
| -------------------------------- | ---------------------------------------------------- |
| `TechnicianFloorShell`           | Hybrid layout, header clock, mode routing            |
| `TechQueue`                      | Four lanes + selection                               |
| `TechWorkSurface`                | Mode host (Job / Inspection / Parts / QC / Notes)    |
| `JobCompleteGate`                | Client + server validation for checklist/proof/parts |
| `PeerQcAssigner`                 | Pure + service: pick eligible clocked-in tech        |
| `AdminFlagHighlight`             | Flag create/clear + board/header presentation        |
| `lib/services/technician.ts`     | Queue aggregates for Floor OS                        |
| Jobs / quality / labour services | Pull, complete gate, peer QC, timers                 |

### Data (expected)

- Reuse jobs, WO status derivation, technician notes, photos, time clock.
- Likely additions: admin flag entity or typed note + `cleared_at` / `cleared_by`; QC assignee on WO or QC session; proof photo linkage on job complete; checklist completion persistence if not already first-class.
- Exact schema decided in implementation plan with migrations; this design requires the behaviors above, not a specific table name.

## Error handling

- Pull fails if job taken / not ready → toast + refresh queue.
- Complete gate fail → server error code mapped to UI reason.
- No eligible peer for QC → leave in Needs QC unassigned + admin highlight “QC unassigned”.
- Offline / action fail → keep draft checklist local where inspection already does; otherwise show retry.
- Cannot QC own work → hard server deny.

## Testing

- Unit: PeerQcAssigner eligibility & rotation; complete gate; pull permissions; flag highlight state.
- Unit/integration: WO status after last job + QC pass/fail.
- UI smoke (iPad width): queue selection, mode switch, gated Complete, Flag visible on admin card.
- Permission tests updated for peer QC and pull.

## Out of scope

- Bay/stall map
- Pay-per-job / flat-rate payroll engines
- Customer-facing QC
- Replacing manager timesheets UI
- Shop board touch-drag redesign
- Replacing advisor intake / approval flows

## Success criteria

- Tech can run a full day without needing the shop kanban for routine work.
- Completing a job without checklist/proof is impossible.
- Peer QC is always a different tech when someone eligible is clocked in.
- Admin sees and can clear tech flags without stopping the tech’s other work.
- Day clock and job timers both visible and correct on the Floor OS.
