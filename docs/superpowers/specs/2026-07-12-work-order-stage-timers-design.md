# Work order stage timers design

**Date:** 2026-07-12  
**Status:** Approved for implementation  
**Related:** `2026-07-12-picked-up-filed-design.md` (pickup wait ends when filed)

## Goal

Show live (then frozen) elapsed time on work orders for two stages — **in shop** and **waiting for pickup** — with yellow/red aging based on promised finish and workload, so the floor can see bikes that are dragging without leaving the board.

## Decisions

| Topic             | Choice                                                 |
| ----------------- | ------------------------------------------------------ |
| Data              | Derive from existing timestamps — no new DB columns    |
| Surfaces          | Shop board / list cards **and** work-order header      |
| Aging             | Display + highlight (not alerts)                       |
| Shop thresholds   | Prefer `estimated_completion`; else job-count fallback |
| Pickup thresholds | Fixed 24h yellow / 72h red                             |
| Hold              | Timer keeps running; existing On hold flag unchanged   |

## Stages

### 1. In shop

- **Start:** `date_created` (fallback `created_at` if needed)
- **Stop / freeze:** when `ready_for_pickup_at` is set (client told bike is ready)
- **While running:** live elapsed; after ready: show frozen shop duration

### 2. Waiting pickup

- **Start:** `ready_for_pickup_at`
- **Stop / freeze:** when `completed_at` (picked up / filed)
- **While ready:** live elapsed; after complete: frozen pickup-wait duration
- **Before ready:** do not show this timer

## Aging rules

Centralize constants in one module (e.g. `lib/status/workOrderTimers.ts`) for easy tweaks.

### Shop (created → ready)

**When `estimated_completion` is set** (and status not terminal for shop phase):

- Compute promised window = ETA − created
- **Yellow** if remaining time ≤ 25% of promised window **or** remaining ≤ 4 hours
- **Red** if now ≥ ETA
- Otherwise neutral

**When ETA is missing**, use active (non-cancelled) job count:

| Active jobs | Yellow after | Red after |
| ----------- | ------------ | --------- |
| 0–1         | 1 day        | 3 days    |
| 2–3         | 2 days       | 5 days    |
| 4+          | 3 days       | 7 days    |

### Pickup wait (ready → completed)

- **Yellow** after 24 hours since `ready_for_pickup_at`
- **Red** after 72 hours
- Frozen duration after complete still shows final chip color based on that duration vs thresholds

### Interaction with existing Overdue flag

Keep `buildWorkOrderFlags` Overdue (past ETA) as today. Timer red when past ETA should align visually; no need to duplicate the flag text on the chip.

## UI

- Shared chip component: label (`In shop` / `Pickup wait`) + compact duration (`4h`, `1d 4h`)
- Colors: neutral / warning (yellow) / danger (red) using existing status CSS variables where possible
- Board/list cards: chips under bike/customer line
- Work-order header: same chips near status / dates
- Completed / filed views: optional frozen chips (nice-to-have if data already present; not required on Complete and filed list in v1)

## Data plumbing

Extend board/card and header payloads as needed with:

- `date_created` (or `created_at`)
- `ready_for_pickup_at`
- `completed_at`
- `estimated_completion`
- active job count (or jobs array already available)

Client tick: lightweight interval (e.g. 30–60s) or per-minute update for live chips; freeze when end timestamp present (no tick needed).

## Out of scope

- Settings UI for thresholds
- Push/SMS when aging hits red
- Pausing timers on `on_hold`
- Separate persisted duration columns / reporting warehouse
- Changing when `ready_for_pickup_at` is written (still QC → mark ready / board drop to pickup)

## Testing

- Unit: duration formatting; shop aging with ETA, without ETA by job count; pickup aging 24h/72h; freeze when end timestamps set
- Manual: create WO → see live shop chip; mark ready → shop freezes, pickup starts; complete → both frozen
