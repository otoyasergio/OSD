# Job labor clock Phase B design

**Date:** 2026-07-15  
**Status:** Approved for implementation

## Goal

Add a second clock for shop efficiency: technicians punch into specific jobs while on the attendance clock. Attendance (`time_clock_entry`) remains the payroll source of truth. Job timers (`job_time_entry`) never drive pay.

## Rules

- Floor tech must have an **open attendance punch** before starting a job timer (`NOT_CLOCKED_IN_FOR_JOB`).
- One open job timer per user (unique partial index).
- Start job / pull-and-start / switch: create or switch `job_time_entry`.
- Pause: end open segment without completing the job.
- Complete / cancel / admin-flag stop: end open segment for that job.
- Non–floor-tech status changes do not create job timers.

## Data model

`job_time_entry`: `job_id`, `user_id`, `location_id`, `started_at`, `ended_at`, `notes`.

## Labour display

Prefer sum of job time segments for actual hours; fall back to wall-clock `started_at` → `completed_at` when no segments exist (legacy jobs).

## Reports

Attendance hours vs job hours → efficiency % (job ÷ attendance).

## Out of scope

Flat-rate pay, commissions, auto-billing Square labor lines from punches.
