# Handoff: Technician Workflow — assigned → complete

## Overview

Redesign of the floor technician's screen (`/technician`, the "Tech floor" / "Jobs" page). The goal is to fix a confusing work-order experience: techs couldn't tell what to do next, there were too many stages and buttons, the docket/work-order/job hierarchy was muddled, waiting states had no clear owner, and peer-QC / safety felt bolted on.

The redesign reframes the whole screen around one idea: **a technician works _bikes_, not work orders.** One ordered line (the docket), one clear next action at a time, every waiting state has an owner, and peer QC is just another card in the line.

## About the design files

The files in `prototypes/` are **design references created in HTML** (a small streaming component runtime). They show intended look and behavior — **they are not production code to copy**. The task is to **recreate these designs in the OTOMOTO Next.js codebase** using its existing patterns: React Server Components + client components, server actions in `app/(app)/technician/floor-actions.ts`, and the `.floor-*` class system already in `app/globals.css`. Do **not** introduce a new styling system — extend the existing one.

Open `prototypes/Tech Workflow Redesign.dc.html` in a browser to interact with all three takes. `prototypes/Current Tech Floor.dc.html` is a faithful recreation of today's screen for before/after comparison. (Both need `support.js`, included alongside them; they were authored in a component tool but render as plain HTML.)

## Fidelity

**High-fidelity.** Colors, typography, spacing, tap targets, and interactions are final. Recreate pixel-accurately with the codebase's components. One deliberate exception: the shop asked for a **monochrome black/white/grey** treatment for the floor (see Design Tokens) — this overrides the app's usual orange/teal accents **on this screen only**. Confirm with the team whether monochrome should stay scoped to the floor or roll wider before touching shared tokens.

## The three takes (pick one, or splice)

All three share the same data model and the same reframe; they differ only in how the work surface is laid out. Prototype ids are shown as badges (`1a`, `1b`, `1c`).

- **1a — The Spine.** Work surface is a 3-phase vertical spine: **Check in → Wrench → Wrap up**. Only the active phase expands to show its steps; the rest are collapsed circles. A persistent bottom dock always shows the single next action. Queue is split into labelled lanes (On the bench / Up next / Waiting / Checks for you / Done today). _Best when you want the fewest visible controls and a strong sense of progress._
- **1b — The Run Sheet.** No stages at all — the job is **one numbered checklist** top to bottom; the next incomplete row is highlighted and carries an inline action button. A progress bar + count sits above the dock. Queue is one flat numbered line. _Best when techs think in "just give me the list."_
- **1c — The Pit Board.** Built for constant interruption. A fixed 3-button command bar is **always present and always the same: Go · Park · Swap.** Go advances the current step; Park saves your spot + pauses the clock with a reason; Swap parks the bench bike and pulls another in one tap. A "Who owns the wait" panel names who's responsible for every blocked bike. _Best given the shop's reality of juggling ~3 bikes with frequent interruptions._

**Recommendation:** 1c's command model + 1a's phase spine is the strongest combination for a gloves-on iPad. Confirm direction before full build.

## Domain rules baked into the design (important)

- **Jobs are assigned by admin staff** (service advisor / manager / owner). They **drag jobs into a technician's docket and set the order** (this already exists server-side — see `TechnicianDocketList` reorder controls and `moveDocketJob` in `lib/technician/docketOrder`). Techs do **not** self-pull or "accept" work. A newly assigned bike simply **appears** in the tech's line; the tech only acknowledges it ("Got it"), then pulls it onto the bench when ready. Never use "accept" / "add to my line" copy that implies the tech chose it. (Self-pull is already disabled: `canPullJob()` returns `false`.)
- A tech may have ~3 bikes going; triage model, interruptions are the norm — **Park and Swap must be one or two taps.**
- Primary device: **iPad, portrait, gloves on.** Minimum tap target 44px; the design uses 52–76px for primary actions.
- Full lifecycle: `assigned → pull onto bench → inspect → work → proof → complete → peer QC → head-tech safety → ready for pickup`. The tech owns everything up to complete, plus **peer QC when assigned to them**; head-tech safety and pickup are downstream and shown as read-only pipeline chips.

## Screens / views

### 1. Tech floor (the whole screen)

- **Shell:** reuse `AppShell` (dark sidebar `--chrome` #0b1220, top bar). Sidebar nav for floor techs: the item currently labelled **"Technician"** should read **"Jobs"**, grouped under a **"Docket"** heading (was "Staffing"), and the Docket group should sit **above** Communication/Messages. (See `components/layout/SidebarNav.tsx` → `buildNavCategories`, and the `staffingLinks` / category order.)
- **Layout:** two-column split, `grid-template-columns: ~296–312px 1fr`, 14px gap, 14px padding. Left = queue/docket (scrolls independently); right = work surface (`border: 2px solid #0a0a0a; border-radius: 14px`) with its own scroll body and a flex-shrink:0 dock pinned at the bottom. On a real iPad portrait (768–834px wide) the split still holds; below that, stack with the surface on top.
- **Header strip inside the surface region:** `OTOMOTO · TECH FLOOR` wordmark (IBM Plex Mono, 14px, .14em tracking) + user chip.

### 2. Queue / docket (left column)

- **1a lanes:** section label (IBM Plex Mono, 11px, 700, .1em, `#52525b`) over stacked cards. "On the bench" card is solid black (`#0a0a0a`, text `#fafafa`); "Up next" cards white with `2px solid #d4d4d8`; "Waiting" cards `2px dashed #a1a1aa` on `#f4f4f5` (muted, because nothing is required of the tech); "Checks for you" cards white with `2px solid #0a0a0a` and a ⚑ glyph.
- **1b/1c flat line:** numbered pill (`30px` circle, mono) + model + sub + a right-aligned **stamp** chip. Stamp vocabulary and styling:
  - `NOW` — black fill, white text (bike on the bench)
  - `PAUSED` — white fill, black border/text
  - `NEXT` — white fill, grey border
  - `HOLD` — grey fill `#f4f4f5`, muted text (waiting; nothing for the tech)
  - `CHECK` — white fill, black border (peer QC assigned to this tech)
  - `NEW` — black fill (just assigned by admin, not yet acknowledged)
  - `DONE` — grey, muted
- Selected card gets a focus ring: `box-shadow: 0 0 0 3px #fafafa, 0 0 0 6px #0a0a0a`.

### 3. Work surface (right column)

Header block: bike model (25–30px, 700, `-0.02em`), then a meta line `WO-#### · <job> · <customer> [· <promise time>]`. WO number in a black chip or mono; promise time underlined/emphasised in black. A running **timer** chip (mono, `#f4f4f5` bg, `#d4d4d8` border) shows only while a bike is on the bench or parked. A one-line **note** banner (left border `4px solid #0a0a0a`, `#f4f4f5` bg) narrates the last action ("Parked: 'Parts not here.' Your spot is saved and the clock is paused.").

Body depends on state:

- **On the bench →** the step list (1a: grouped into 3 phases; 1b: numbered rows; 1c: flat rows). Each step row: 34–40px rounded checkbox glyph, label, optional sub, optional right tag (`PART · IN STOCK`, `PHOTO`). Done = black-filled box with ✓ and muted label. The next open step is highlighted (`border #0a0a0a`, bg `#f4f4f5`).
- **Photo/proof step →** encouraged, not gated. Shows skip chips ("Nothing visible to show", "Camera busy", "Customer in a hurry"); skipping records the reason and marks the step `skipped` (→ glyph), which still satisfies completion. (Matches the requested "encouraged, easy to skip with a reason" rule — note this is looser than today's `jobCompleteGate` which requires a proof photo or exception note; align the gate accordingly.)
- **Peer QC (assigned to this tech) →** 3-item judgement checklist (Work matches approval / Proof photos tell the story / Safe to ride out). Dock shows **Pass QC** (enabled only when all 3 are checked) and **Fail** (opens a reason sheet). This replaces the bolted-on QC stage — it's just another card in the line.
- **Waiting / Not started / Done / QC-passed / QC-failed →** a centered "plate" card: mono kicker, headline, one sentence, and where relevant a read-only pipeline (`WRENCH → PEER QC → SAFETY → PICKUP`, completed steps filled black).

### 4. Bottom dock (right column, pinned)

Always present when a bike is selected. Left: contextual secondary buttons (**Park ⏸** while on the bench; **Fail ✗** during QC). Right (flex:1): the single **primary action** as a big 64px button with a `0 4px 0 0` hard shadow that presses down on `:active`. The primary label is always the literal next move: `Pull onto the bench ▶`, `Done: <step> ✓`, `Add after photo ✓`, `Complete job ✓✓`, `Pass QC — vouch for it ✓`, `Resume ▶`, `Got it — it's in my line →`. A muted sub-line under the dock explains the consequence ("Hands it to peer QC — your clock stops").

### 5. Overlays (bottom sheets)

`position: absolute; inset:0` scrim `rgb(10 10 10 / .6)`, sheet slides from bottom (`border-radius: 18px 18px 0 0`, 20px padding). Three: **Park** (grid of reasons: Parts not here / Needs approval / Tool or lift busy / Other interruption), **Fail** (QC fail reasons), **Swap** (1c only — list of next/parked bikes to jump to). Tapping the scrim closes.

## Interactions & behavior

- **Assigned bike (banner in 1a / `NEW` card):** admin has dropped it in. Tech taps **Got it →** to acknowledge; status `offered → next`. No clock starts.
- **Pull onto bench:** `next → bench`, timer starts (1 s tick). If another bike was on the bench it auto-parks (`bench → waiting`, reason "Parked — swapped bikes", spot saved).
- **Advance a step:** tap the row or the dock primary → marks the next open step done; photo step can be skipped with a reason (→ `skipped`).
- **Complete:** enabled only when 0 open steps remain → `bench → done`, timer stops, note "moves to peer QC." Dock then offers to pull the next bike.
- **Park:** opens reason sheet → `bench → waiting`, `paused = true`, timer freezes, front desk "owns the wait" unless reason is "Other interruption" (then the tech owns it).
- **Swap (1c):** parks bench bike + pulls chosen bike in one action.
- **Peer QC:** toggle 3 checks → Pass (`check → qcpassed`, pipeline advances to Safety) or Fail (reason sheet → `check → qcfailed`, returns to the original tech's line).
- **Timer:** `setInterval` 1 s; only the on-bench, non-paused bike increments. Format `H:MM:SS`.

## State management

Per-bike record: `{ id, model, wo, job, customer, promised, status, paused, secs, steps[], qc[], others, waitReason, waitOwner }`.
`status ∈ { offered, next, bench, waiting, check, done, qcpassed, qcfailed }`. Screen state: `benchId`, `sel` (selected bike), `note`, `overlay ∈ { null, park, fail, swap }`. Step: `{ label, sub?, tag?, phase (0|1|2), state ∈ {open,done,skipped}, photo? }`. QC item: `{ label, state ∈ {open,done} }`.
In the real app these map to `work_order` / `job` / `job_checklist_item` / peer-QC rows; timer maps to `job_time_entry` segments (see `formatLabourComparison`). Fetch via the existing `getTechnicianFloorOs` / `getTechnicianDocket` services; mutate via `floor-actions.ts` server actions.

## Design tokens (monochrome floor treatment)

- Ink / primary: `#0a0a0a` · near-black surfaces text on: `#fafafa`
- Greys: `#18181b`, `#27272a`, `#3f3f46`, `#52525b`, `#71717a`, `#a1a1aa`, `#d4d4d8`, `#e4e4e7`, `#f4f4f5`
- Page bg: `#fafafa` · card bg: `#ffffff` · sidebar/chrome: `#0b1220` (unchanged from app)
- Borders: hairline `#e4e4e7`, medium `#d4d4d8`, strong/active `#0a0a0a`; waiting = `dashed #a1a1aa`
- Radius: cards 12–14px, rows 10px, chips/pills 999px, sheets 18px top
- Type: **Space Grotesk** 400–700 (UI), **IBM Plex Mono** 600–700 (WO #s, labels, timers, stamps). Sizes: bike title 25–30px/700, step label 15.5–16.5px/600, section label 11px/700 .1em uppercase, meta 13–14px.
- Tap targets: primary dock 64px, phase circles 46px, step boxes 34–40px, chips 36px. Never below 44px for a real control.
- Primary-button press: `box-shadow: 0 4px 0 0 <grey>` → `:active { transform: translateY(2px); box-shadow: none }`.
- Selected ring: `0 0 0 3px #fafafa, 0 0 0 6px #0a0a0a`. Overlay scrim: `rgb(10 10 10 / .6)`.

## Assets

- `prototypes/assets/otomoto-logo.png` — OTOMOTO wordmark (already in repo at `public/otomoto-logo.png`). Use the repo copy.
- Icons in the prototypes are inline copies of the app's existing **lucide-react** set (wrench, package, message-square, settings, bell, chevrons). Use `lucide-react` in the real build — don't hand-draw.
- Bike thumbnails are placeholders; wire to the existing intake-photo storage URLs (`listIntakePhotos`).

## Files to reference / touch in the codebase

- `components/technician/TechnicianFloorShell.tsx` — the screen being replaced (stage rail + sticky dock live here today).
- `components/technician/TechnicianDocketList.tsx` — queue rows + admin reorder controls (keep; restyle).
- `app/(app)/technician/floor-actions.ts` — server actions (pull/start/complete/pause/resume/flag/proof/QC/safety) the new dock buttons call.
- `app/(app)/technician/page.tsx` — data fetch + stage routing.
- `lib/services/technicianFloor.ts`, `lib/services/technicianDocket.ts` — data shape (`FloorOsSurface`, `DocketItem`).
- `lib/status/jobCompleteGate.ts` — completion rules; loosen proof-photo requirement to match "skip with a reason."
- `lib/technician/floorStage.ts` — current stage model (being simplified).
- `components/layout/SidebarNav.tsx` — rename "Technician" → "Jobs", regroup under "Docket".
- `app/globals.css` — `.floor-*` classes; extend for the new surface/dock/lanes.
- Prototypes: `prototypes/Tech Workflow Redesign.dc.html` (three takes), `prototypes/Current Tech Floor.dc.html` (before).

## Using this in Cursor

1. Unzip this folder into the repo root (e.g. `OTOMOTO SERVICE APP/design_handoff_tech_workflow/`).
2. Open the repo in Cursor. Open `prototypes/Tech Workflow Redesign.dc.html` in a browser side-by-side for reference.
3. Point Cursor at this README plus the files listed above, e.g.: _"Recreate take 1c from `design_handoff_tech_workflow/README.md` in `TechnicianFloorShell.tsx`, using our existing `.floor-*` styles and the server actions in `floor-actions.ts`. Keep the monochrome tokens from the README. Don't add self-pull — jobs are assigned by admin."_
4. Build one take first, screenshot on an iPad-portrait viewport, compare against the prototype, iterate.
