# Technician Floor OS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a Lean/Six Sigma tech Floor OS on `/technician` and connect it to advisor/manager surfaces (board flags, QC override, flag clear).

**Architecture:** Expand technician queue aggregates; migration `036` for checklist items, job proof photos, admin flags, and QC assignee; gate job complete and peer QC in services; rebuild `/technician` as hybrid shell; wire `buildWorkOrderFlags` + Overview for other roles.

**Tech Stack:** Next.js App Router, Supabase, Vitest

**Specs:**

- `docs/superpowers/specs/2026-07-12-technician-floor-os-design.md`

---

## Status

Implemented in app code. Apply migration `036_technician_floor_os.sql` to the Supabase project before using Floor OS features in production/staging.

## Locked decisions

- Checklist: `job_checklist_item` with 3 default SOP steps seeded on job create
- Proof: `job_proof` photo category + optional `proof_exception` note
- Admin flags: `admin_flag` table; board label `Admin flag`
- Peer QC: `quality_check_assigned_to` auto-assign; tech pass/fail; managers retain override
- One in-progress job per tech; Flag stops active job back to `ready_to_start`

## Key files

| File                                                           | Responsibility         |
| -------------------------------------------------------------- | ---------------------- |
| `supabase/migrations/036_technician_floor_os.sql`              | Schema + RLS           |
| `lib/services/technicianFloor.ts`                              | Four-lane Floor OS DTO |
| `components/technician/TechnicianFloorShell.tsx`               | Hybrid UI              |
| `lib/services/peerQc.ts` / `adminFlags.ts` / `jobChecklist.ts` | Domain services        |
| `lib/status/jobCompleteGate.ts` / `peerQcAssigner.ts`          | Pure helpers           |

## Cross-role wiring

- Tech: `/technician` Floor OS
- Advisor/manager: Admin flag badge on board/header; clear flags + QC override on Overview
- Peer QC assignee shown on Overview Completion section
