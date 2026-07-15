# Owner/manager timesheets design

**Date:** 2026-07-12  
**Status:** Approved for implementation

## Goal

Harden the existing day-level attendance clock for payroll visibility: who is punched in, daily/weekly hours, and manager corrections for missed punches. Keep `/technician` clock in/out and job est-vs-actual unchanged.

## Permissions

| Action                         | Roles                |
| ------------------------------ | -------------------- |
| View timesheets / export CSV   | owner, manager       |
| Create / edit / delete punches | owner, manager       |
| Clock self in/out              | any staff (existing) |

## Data model

Reuse `time_clock_entry`. RLS update: owner/manager may insert, update, and delete any row (techs keep self insert/update). No schema column changes.

## UI

- Settings link → `/settings/timesheets`
- Open punches strip
- Week picker (Mon–Sun, America/Toronto)
- Per-user weekly totals + daily breakdown
- Entry list with add / edit / delete
- CSV export for the selected week

## Out of scope

WO-level job clocking, break types, commissions, kiosks, flat-rate engines.
