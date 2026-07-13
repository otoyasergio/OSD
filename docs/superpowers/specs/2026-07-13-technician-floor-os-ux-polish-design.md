# Technician Floor OS UX polish design

**Date:** 2026-07-13  
**Status:** Draft — awaiting user review  
**Parent:** [2026-07-12-technician-floor-os-design.md](./2026-07-12-technician-floor-os-design.md)  
**Approach:** Stage rail + sticky CTA (Approach A)

## Goal

Make the Floor OS feel like one continuous shop-floor tool: calmer hierarchy, fewer taps to the next action, and a stage path instead of five equal tabs — without changing domain rules (gates, pull, peer QC, flags).

Primary client: Safari iPad landscape.

## Decisions

| Topic          | Choice                                              |
| -------------- | --------------------------------------------------- |
| Modes          | Stage rail: Inspect → Work → Proof → Done           |
| Parts          | Merged into **Work** (not a separate stage)         |
| QC / Notes     | Secondary actions (not on main rail)                |
| Primary action | Sticky dock at bottom of work surface               |
| Queue          | Active job marked **NOW**; hide empty lanes         |
| Scope          | UI polish only (`TechnicianFloorShell` + light CSS) |

## Stage rail

Replace Job / Inspection / Parts / QC / Notes tabs with:

1. **Inspect** — open fullscreen inspection or show complete state
2. **Work** — standard-work checklist + parts install
3. **Proof** — after photo and/or proof exception
4. **Done** — gate summary; Start/Complete live in the sticky dock

**Default stage:** first incomplete stage (inspect if needed → work if checklist/parts open → proof if needed → done).

**URL:** `?job=&wo=&stage=inspect|work|proof|done|qc` (QC reachable from secondary entry when assigned).

Tap any stage pill to jump. Completed stages show a check; current stage is filled (chrome/foreground).

## Sticky action dock

Fixed to the bottom of the work surface panel (content scrolls above):

| Context                | Primary                           | Secondary                 |
| ---------------------- | --------------------------------- | ------------------------- |
| Ready to pull          | Pull job                          | —                         |
| Assigned, not started  | Start job                         | Flag                      |
| In progress, gate fail | Complete (disabled) + reason text | Flag                      |
| In progress, gate ok   | Complete job                      | Flag                      |
| Peer QC assigned       | Pass QC                           | Fail QC (secondary style) |

Gate reason appears under the dock when Complete is disabled — plain language from existing complete-gate codes.

## NOW queue

- Priority lane: `in_progress` item rendered as **NOW** card (dark/chrome fill)
- Other priority items quieter
- Ready to pull / Needs QC / Flagged unchanged in meaning
- **Omit empty lanes** entirely (no “None” placeholders)

## iPad polish

- Checklist rows ≥ 48px; checkbox hit area ≥ 44×44
- Primary dock button ≥ 52px tall, flex-grow
- Stage pills ≥ 44px; horizontal scroll if narrow
- Queue cards ≥ 52px
- Header: “Tech floor” + time clock only (drop marketing subtitle)
- Accent amber reserved for NOW / warning gates
- Light transitions only (selected card, stage pill)

## Out of scope

- Schema, permissions, or gate logic changes
- Rewriting fullscreen inspection
- Bay map, dark theme, heavy animation
- Changing advisor/manager board beyond existing Admin flag highlight

## Success criteria

- Tech can Start/Complete/Pull/Pass without scrolling past the action
- Stage path reads as one job flow, not five destinations
- Empty lanes do not add visual noise
- Existing Floor OS actions and gates still work unchanged

## Implementation touchpoints

- Rewrite layout/interaction in [`components/technician/TechnicianFloorShell.tsx`](../../components/technician/TechnicianFloorShell.tsx)
- Optional small CSS helpers in `app/globals.css` (`.floor-*`)
- Map `stage` search param in [`app/(app)/technician/page.tsx`](<../../app/(app)/technician/page.tsx>)
- Derive default stage from surface fields already returned by `getTechnicianFloorOs`
