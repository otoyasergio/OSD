# Attendance / ESA Phase A design

**Date:** 2026-07-15  
**Status:** Approved for implementation

## Goal

Harden the existing day-level attendance clock for Ontario-ready payroll visibility: meal breaks, weekly overtime flags (44h), timesheet submit/approve, all-staff clock UI, and soft-void retention instead of hard deletes.

Keep job labour clocking out of this phase (see Phase B spec).

## Permissions

| Action                                                                | Roles                                                           |
| --------------------------------------------------------------------- | --------------------------------------------------------------- |
| Clock self in/out / start/end break                                   | any active staff                                                |
| View own week + submit timesheet                                      | any active staff                                                |
| View all location timesheets / export CSV / approve / reject / reopen | owner, manager                                                  |
| Create / edit / void punches                                          | owner, manager (locked when week is `approved` unless reopened) |

## Data model

### `time_clock_entry` (existing + `voided_at`)

- Add `voided_at timestamptz` nullable.
- Open-punch unique index excludes voided rows.
- Queries for hours ignore voided rows.
- Manager “delete” sets `voided_at` (soft void) instead of hard delete.

### `time_clock_break`

| Column                      | Notes                                      |
| --------------------------- | ------------------------------------------ |
| `break_id`                  | uuid PK                                    |
| `entry_id`                  | FK → `time_clock_entry`                    |
| `break_type`                | `meal` \| `other` (default `meal`)         |
| `break_start_at`            | timestamptz                                |
| `break_end_at`              | nullable while on break                    |
| Unique open break per entry | partial index where `break_end_at IS NULL` |

Unpaid by default. Paid hours = punch span − completed unpaid break spans.

### `timesheet_week`

| Column                                               | Notes                                             |
| ---------------------------------------------------- | ------------------------------------------------- |
| `timesheet_week_id`                                  | uuid PK                                           |
| `user_id`, `location_id`                             | staff + shop                                      |
| `week_start_date`                                    | date (Monday, America/Toronto shop week)          |
| `status`                                             | `open` \| `submitted` \| `approved` \| `rejected` |
| `submitted_at`, `approved_by`, `approved_at`, `note` | workflow                                          |

Unique `(user_id, location_id, week_start_date)`.

## Paid hours & OT

- Shop week: Mon–Sun America/Toronto (existing helpers).
- OT threshold: **44 hours/week** (Ontario default). Configurable constant in shared code.
- Regular ms = min(paid_ms, 44h); OT ms = max(0, paid_ms − 44h).
- Soft ESA nudge: if clocked in ≥ 5 consecutive hours without a completed meal break, UI shows non-blocking reminder (no auto-deduct).

## UI

- **Time clock** nav for all active staff (not floor-tech only).
- Widget: clock in/out + Start/End meal break when punched in.
- Clock page: month calendar + “My timesheet” week submit.
- Manager timesheets: OT badges, approval status per staff, approve/reject/reopen; richer CSV.

## CSV columns

`employee,user_id,date,clock_in,clock_out,gross_hours,unpaid_break_minutes,paid_hours,notes,status,week_approval`

Plus summary rows or per-employee week footer with regular/OT when exporting.

## Out of scope (Phase A)

Pay rates, payroll API sync, PTO/vacation ledger, shift scheduling, kiosk PIN, buddy-punch prevention, WO-level job clocking.
