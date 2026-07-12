# Before-arrival process (client contact → counter)

**Date:** 2026-07-12  
**Status:** Draft for user review  
**Extends:** [2026-07-08-otomoto-workshop-management-design.md](./2026-07-08-otomoto-workshop-management-design.md)  
**Related:** Wix Bookings calendar sync (separate brainstorm / upcoming spec)

## Problem

Before the bike is at the counter, the shop mixes phone, Wix online booking, and walk-ins. Today that causes double entry, calendar drift between systems, and arrival surprise (staff don’t know who is coming or what was promised). V1 workshop flow starts at intake; this design covers everything from first contact until intake begins.

## Decisions locked

| Decision | Choice |
|----------|--------|
| Journey scope | Before arrival only — ends when intake starts (photos/contract), not repair/billing |
| Channels | Even mix: phone, Wix, walk-in — all first-class |
| Prep depth | Channel-dependent: booked/called pre-create more; walk-ins start at the counter |
| Primary pains | Double entry, calendar chaos, and arrival surprise (all) |
| Booked visit artifact | Draft work order created at booking time |
| Approach | **A** — book → draft WO immediately; walk-ins use existing intake wizard |

## Approach

**Book → draft WO immediately.** Phone or Wix booking matches/creates customer (and motorcycle when known), creates an **appointment**, and creates a linked **draft work order**. On arrival, staff open that WO and run intake. Walk-ins skip the appointment requirement and use today’s create-WO wizard (optional same-day calendar block so the day stays visible).

## Process

### Scheduled (phone or Wix)

1. Capture who, phone/email, bike (if known), reason, date/time  
2. Match or create **customer**; create/link **motorcycle** when known  
3. Create **appointment** (push/sync to Wix when online booking or when in-app booking should appear on Wix)  
4. Create **draft work order** linked to the appointment  
5. Customer arrives → staff **Arrive** on the appointment → open linked draft WO → intake photos / contract  
6. Shop floor continues with the existing board (inspect → approve → parts → work → QC → pickup)

### Walk-in

1. No prior appointment required  
2. Create WO via existing intake wizard (customer → bike → visit → photos)  
3. Optional: create a same-day calendar block so capacity isn’t invisible  

### Hard edges

- **Starts:** first contact (call, Wix book, or walk-in)  
- **Ends:** draft WO opened at the counter and intake begun  
- **Out of this process:** inspection, approval, Square billing, repair, QC, pickup (already specified elsewhere)

## Data model

### Appointment (new)

| Field | Notes |
|-------|--------|
| `appointment_id` | PK |
| `location_id` | Required; scoped like work orders |
| `starts_at` / `ends_at` | Slot |
| `status` | `scheduled` \| `arrived` \| `cancelled` \| `no_show` |
| `channel` | `phone` \| `wix` \| `walk_in` \| `otomoto` |
| `customer_id` | Required once identity is known |
| `motorcycle_id` | Nullable until known; required before finishing intake |
| `reason` / notes | Why they’re coming |
| `wix_booking_id` | Nullable; idempotency key for Wix sync |
| `work_order_id` | Linked draft WO (set immediately for phone/Wix) |
| `created_by_user_id` | Nullable for pure Wix inbound |
| timestamps | `created_at`, `updated_at` |

### Work order (existing)

- Created as status `draft` from booking (promoted to `open` on **Arrive**, then normal recalc applies)  
- Carries reason into visit notes / requested services when known  
- Intake photos remain required at arrival (same six-slot rules as today)  
- Future-dated draft WOs do **not** clutter the live in-shop board until **Arrive**

### Customer / motorcycle (existing)

- Match by phone/email when possible; create if new  
- Bike optional at booking; required before finishing intake for a real visit  

### Rules

1. One active appointment → at most one draft WO  
2. Cancel / no-show appointment → set linked draft WO to `cancelled` (not left on the live board)  
3. Rebook → new appointment + new draft WO (do not revive a cancelled draft)  
4. Wix sync unit is the **appointment**; the WO follows appointment create/cancel  
5. Duplicate Wix webhooks are idempotent on `wix_booking_id`  

## Staff UI

### Calendar

- Day/week view of all appointments (all channels)  
- Create booking from calendar → same draft-WO path as phone  
- Appointment panel: customer, bike, reason, linked draft WO, actions **Arrive** / **Cancel** / **No-show**

### Phone book flow

- Short form: who, phone, bike (optional), reason, slot  
- Saves appointment + draft WO; pushes to Wix when sync is enabled  

### Wix inbound

- Webhook/sync creates appointment + draft WO automatically  
- Appears on calendar / upcoming list — no retyping  

### Arrival / walk-in

- Scheduled: **Arrive** → appointment `arrived`; draft WO status → `open` and appears on Intake board → photos/contract  
- Walk-in: existing Create work order wizard; optional same-day calendar block  
- Same-day walk-in with an existing appointment → offer to open that draft WO instead of creating a second  

## Cancel, no-show, errors

| Case | Behavior |
|------|----------|
| Cancel | Appointment `cancelled` → linked draft WO → `cancelled` → sync cancel to Wix when applicable |
| No-show | Appointment `no_show` → linked draft WO → `cancelled`; retain history on customer |
| Wix sync failure | Appointment (and draft WO) still saved in OTOMOTO; flag “not synced” for retry |
| Duplicate webhook | No second appointment/WO |
| Unknown bike at booking | Draft WO allowed; motorcycle required before finishing intake |

## Permissions

- Create/edit appointments and book-from-calendar: same roles that create work orders today (advisor+; owners/managers)  
- Arrive / cancel / no-show: same  
- Technicians: read calendar for awareness; do not create bookings unless product later expands  
- Foreign-location appointments: read-only / blocked writes like work orders  

## Testing (acceptance sketch)

1. Phone book → appointment + draft WO; customer matched by phone  
2. Wix booking inbound → same; second identical webhook does not duplicate  
3. Arrive → WO appears on Intake; photos/contract path works  
4. Cancel booking → draft WO leave live board; Wix cancel when synced  
5. Walk-in → create WO without appointment; optional same-day block  
6. Walk-in same day as existing appointment → prompt to use existing draft WO  

## Out of scope

- Full shop-floor repair/billing lifecycle (already specified)  
- Detailed Wix bidirectional sync protocol (companion calendar spec)  
- SMS reminders / marketing campaigns  
- Deposits at booking time (billing lifecycle can attach later)  
- Softphone / call recording  

## Implementation notes

- Prefer a dedicated `appointment` table over overloading `work_order` dates alone  
- Timeline/audit: appointment created/arrived/cancelled/no_show; WO created from booking  
- Keep intake photo and contract gates on the arrival path, not at booking time  
- Board filter: hide future `draft` WOs linked to `scheduled` appointments until Arrive  
- Coordinate with Wix calendar work so appointment is the shared sync entity  
