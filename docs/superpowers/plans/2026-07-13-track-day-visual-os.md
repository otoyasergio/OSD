# Track Day Visual OS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved Track Day brand and calm photo-forward UI across the staff app without changing workflows.

**Architecture:** Replace design tokens and fonts first, add shared `StageChip` + `PhotoActionCard` primitives, restyle AppShell/board/Floor/WO surfaces to use them, and collapse dashboard chrome into a More panel. Keep existing data services and actions.

**Tech Stack:** Next.js App Router, CSS variables in `app/globals.css`, `next/font` (Space Grotesk + IBM Plex Mono), Lucide React icons, existing dashboard/Floor components.

**Spec:** [docs/superpowers/specs/2026-07-13-track-day-visual-os-design.md](../specs/2026-07-13-track-day-visual-os-design.md)

---

## File map

| File                                                 | Responsibility                                   |
| ---------------------------------------------------- | ------------------------------------------------ |
| `app/layout.tsx`                                     | Load Space Grotesk + IBM Plex Mono               |
| `app/globals.css`                                    | Track Day tokens, card/board/floor/motion styles |
| `package.json`                                       | Add `lucide-react`                               |
| `components/ui/StageChip.tsx`                        | Mono stage pill                                  |
| `components/ui/PhotoActionCard.tsx`                  | Photo + body + primary/secondary actions         |
| `components/layout/AppShell.tsx`                     | Dark chrome, larger wordmark treatment           |
| `components/layout/SidebarNav.tsx`                   | Lucide icons beside labels                       |
| `lib/status/pipeline.ts`                             | `GALLERY_BOARD_COLUMNS` (4 wide stages)          |
| `components/work_orders/ShopBoard.tsx`               | Use gallery columns + photo cards                |
| `components/work_orders/WorkOrderCard.tsx`           | Photo-action layout                              |
| `app/(app)/dashboard/page.tsx` (+ filter components) | Default calm chrome; More panel                  |
| `components/technician/TechnicianFloorShell.tsx`     | Track Day tokens / thumbs                        |
| `components/work_orders/WorkOrderHeader.tsx`         | Photo-forward, stage chip                        |
| `components/ui/EmptyState.tsx`                       | Track Day wash                                   |

---

### Task 1: Fonts, Lucide, and Track Day tokens

**Files:**

- Modify: `app/layout.tsx`
- Modify: `app/globals.css` (token block at top + `@theme`)
- Modify: `package.json` (via npm install)
- Test: `tests/unit/trackDayTokens.test.ts` (assert CSS file contains key token strings via fs read)

- [ ] **Step 1: Install lucide-react**

```bash
cd "/Users/segio/OTOMOTO SERVICE APP" && npm install lucide-react
```

Expected: `lucide-react` in `package.json` dependencies.

- [ ] **Step 2: Write failing token smoke test**

Create `tests/unit/trackDayTokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Track Day tokens", () => {
  it("defines Track Day chrome and signals in globals.css", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain("--chrome: #0b1220");
    expect(css).toContain("--accent: #f97316");
    expect(css).toContain("--signal-teal:");
    expect(css).toContain("--status-waiting: #0891b2");
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
npx vitest run tests/unit/trackDayTokens.test.ts
```

- [ ] **Step 4: Update fonts in `app/layout.tsx`**

Replace Geist with:

```tsx
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});
```

Apply both variables on `<html>`. Keep Geist variables only if something still references them; prefer migrating `--font-geist-*` usages in CSS to `--font-sans` / `--font-mono`.

- [ ] **Step 5: Update CSS tokens in `app/globals.css` `:root`**

Set at minimum:

```css
--chrome: #0b1220;
--chrome-elevated: #111827;
--chrome-foreground: #f8fafc;
--chrome-muted: #94a3b8;
--chrome-border: #1f2937;
--background: #f8fafc;
--foreground: #0f172a;
--card: #ffffff;
--accent: #f97316;
--accent-hover: #ea580c;
--accent-foreground: #111827;
--accent-muted: #ffedd5;
--signal-teal: #0f766e;
--signal-teal-bright: #14b8a6;
--status-waiting: #0891b2;
--status-waiting-bg: #ecfeff;
--status-waiting-fg: #155e75;
--font-sans: var(--font-sans), ui-sans-serif, system-ui, sans-serif;
--font-mono: var(--font-mono), ui-monospace, monospace;
```

Wire body/`@theme` font families to Space Grotesk / IBM Plex Mono. Remap amber-only accents used for primary buttons toward orange; keep success/danger semantics.

- [ ] **Step 6: Re-run token test — expect PASS**

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json app/layout.tsx app/globals.css tests/unit/trackDayTokens.test.ts
git commit -m "feat: add Track Day tokens, fonts, and Lucide"
```

---

### Task 2: StageChip + PhotoActionCard primitives

**Files:**

- Create: `components/ui/StageChip.tsx`
- Create: `components/ui/PhotoActionCard.tsx`
- Modify: `app/globals.css` (`.stage-chip`, `.photo-action-card*`)
- Test: `tests/unit/stageChip.test.ts` (pure class helper if extracted) OR render-free export test for `stageChipTone`

- [ ] **Step 1: Add tone helper + test**

In `components/ui/StageChip.tsx`:

```tsx
export type StageChipTone = "teal" | "orange" | "muted" | "danger";

export function stageChipClass(tone: StageChipTone): string {
  return `stage-chip stage-chip--${tone}`;
}
```

Test:

```ts
import { stageChipClass } from "@/components/ui/StageChip";
expect(stageChipClass("orange")).toBe("stage-chip stage-chip--orange");
```

- [ ] **Step 2: Implement `StageChip` and `PhotoActionCard`**

`PhotoActionCard` props:

- `href: string`
- `photoUrl?: string | null`
- `title: string`
- `subtitle: string`
- `stageLabel: string`
- `stageTone?: StageChipTone`
- `primaryLabel: string` (shown; navigation via `href`)
- `flagged?: boolean`
- `compact?: boolean`

Structure: Link wrapping card; image/placeholder; body with title/subtitle/`StageChip`; footer with primary label text and optional Flag icon (`lucide-react` `Flag`) when `flagged`.

CSS: `.photo-action-card`, `--photo` aspect ~16/10, placeholder gradient using `--signal-teal` → slate, press scale under `@media (prefers-reduced-motion: no-preference)`.

- [ ] **Step 3: Run unit test PASS + Commit**

```bash
git commit -m "feat: add StageChip and PhotoActionCard primitives"
```

---

### Task 3: AppShell + Sidebar icons

**Files:**

- Modify: `components/layout/AppShell.tsx`
- Modify: `components/layout/SidebarNav.tsx`
- Modify: `app/globals.css` (brand wordmark size)

- [ ] **Step 1: SidebarNav — add Lucide icons per route**

Map paths to icons (`LayoutDashboard`, `Wrench`, `Users`, `Bike`, `ClipboardList`, etc.). Render icon + label in each nav link. Keep existing hrefs/permissions.

- [ ] **Step 2: AppShell brand**

Increase logo/wordmark presence: keep image if present, add mono “OTOMOTO” text treatment class `.brand-wordmark` using `var(--font-mono)`. Ensure mobile header matches.

- [ ] **Step 3: Manual smoke** — `npm run build` or typecheck if available.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: Track Day chrome and nav icons"
```

---

### Task 4: Gallery board columns + WorkOrderCard

**Files:**

- Modify: `lib/status/pipeline.ts` — add `GALLERY_BOARD_COLUMNS`
- Modify: `components/work_orders/ShopBoard.tsx` — prefer gallery columns when density/view allows (default)
- Modify: `components/work_orders/WorkOrderCard.tsx` — photo-action layout; `showPhoto` default true on board
- Test: `tests/unit/pipeline.test.ts` — assert gallery column count and status coverage

- [ ] **Step 1: Add `GALLERY_BOARD_COLUMNS`**

```ts
export const GALLERY_BOARD_COLUMNS = [
  {
    id: "intake",
    label: "Intake",
    statuses: [
      "draft",
      "open",
      "inspection_in_progress",
      "waiting_for_customer_approval",
    ] as WorkOrderStatus[],
  },
  {
    id: "in_bay",
    label: "In bay",
    statuses: [
      "waiting_for_parts",
      "ready_for_technician",
      "in_progress",
    ] as WorkOrderStatus[],
  },
  {
    id: "qc",
    label: "QC",
    statuses: ["quality_check"] as WorkOrderStatus[],
  },
  {
    id: "ready",
    label: "Ready",
    statuses: ["ready_for_pickup", "completed"] as WorkOrderStatus[],
  },
] as const;
```

Keep `SHOP_BOARD_COLUMNS` for “More → detailed columns” if needed; default board uses gallery.

On-hold: show in In bay with flagged styling OR keep a slim on_hold bucket under More — default: include `on_hold` in In bay and rely on flag edge.

- [ ] **Step 2: Update pipeline tests** for 4 columns + every operational status mapped.

- [ ] **Step 3: Restyle `WorkOrderCard`** to photo-top + action strip (Open primary; Flag icon if flags length). Use `StageChip` with short label from pipeline stage.

- [ ] **Step 4: `ShopBoard` uses `GALLERY_BOARD_COLUMNS` by default; pass `showPhoto`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: stage gallery board and photo-action WO cards"
```

---

### Task 5: Dashboard calm chrome (More panel)

**Files:**

- Modify: `app/(app)/dashboard/page.tsx`
- Modify: `components/work_orders/DashboardFilterChips.tsx` (or create `DashboardMorePanel.tsx`)
- Modify: `components/work_orders/BoardPrefsControls.tsx`, `DashboardViewToggle.tsx`, `SavedViewsBar.tsx` — render inside More by default

- [ ] **Step 1: Create client `DashboardMorePanel`**

Collapsed by default. Toggle button “More”. When open, show filters, flag chips, saved views, view toggle, density.

- [ ] **Step 2: Dashboard page default**

Header: title + search context already in shell. Body: More toggle + board. Do not show full filter row unless More open.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: collapse dashboard controls into More panel"
```

---

### Task 6: Floor OS + WO header Track Day pass

**Files:**

- Modify: `components/technician/TechnicianFloorShell.tsx` + floor CSS
- Modify: `components/work_orders/WorkOrderHeader.tsx`
- Modify: `components/jobs/JobCard.tsx` (visual only — fewer competing styles; keep actions)

- [ ] **Step 1: Floor** — primary dock buttons use `--accent` orange; selected stage teal; queue cards get optional thumb if URL available later (skip data plumbing if photo not on floor DTO — use teal placeholder). Flag banner uses orange border.

- [ ] **Step 2: WorkOrderHeader** — emphasize photo strip/hero, one `StageChip`, one next-action line; reduce header text blocks.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: Track Day Floor OS and work order header"
```

---

### Task 7: Empty states, motion, verification

**Files:**

- Modify: `components/ui/EmptyState.tsx` + CSS
- Modify: `app/globals.css` (motion utilities)
- Run: full unit tests + lint

- [ ] **Step 1: Restyle empty state wash to teal/orange.**

- [ ] **Step 2: Add `.td-enter` fade and `.photo-action-card:active` scale with `prefers-reduced-motion` guard.

- [ ] **Step 3: Run**

```bash
npx vitest run tests/unit
npx tsc --noEmit
```

Fix failures.

- [ ] **Step 4: Final commit**

```bash
git commit -m "feat: Track Day empty states and motion polish"
```

---

## Spec coverage checklist

| Spec item                      | Task      |
| ------------------------------ | --------- |
| Tokens / fonts / waiting cyan  | 1         |
| StageChip + PhotoActionCard    | 2         |
| Dark chrome / icons / wordmark | 3         |
| Gallery board + photo cards    | 4         |
| More panel / calm density      | 5         |
| Floor + WO detail visual       | 6         |
| Empty states + motion          | 7         |
| No workflow/schema changes     | All tasks |

## Execution

User requested implement immediately → use **subagent-driven-development** (or inline executing-plans) and commit per task.
