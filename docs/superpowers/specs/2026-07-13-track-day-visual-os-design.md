# Track Day Visual OS — Design Spec

**Date:** 2026-07-13  
**Status:** Approved  
**Scope:** Whole-app visual redesign (identity, layout density, cards, chrome). No new workflows, schema, or role permissions.

## Problem

The app is operational and correct, but text-heavy and control-dense. Staff scan slowly. Status is mostly labels; photos are secondary; chrome fights the bike. We need a calmer, more visual shop floor without losing speed on iPad/Safari.

## Goals

1. Make status and stage readable at a glance (photo + color + short labels).
2. Cut default density: one primary next action; advanced controls under “More.”
3. Apply one coherent brand across AppShell, dashboard/board, Floor OS, and work-order surfaces.
4. Keep tap targets large and workflows unchanged.

## Non-goals

- New features, status machines, or permission changes.
- Marketing landing pages or customer portal rebrand (staff app only).
- Dark content canvas (full dark pit) or a light-only chrome.
- Heavy motion, glow effects, or purple/cream “AI default” aesthetics.

## Decisions (locked)

| Decision        | Choice                                                      |
| --------------- | ----------------------------------------------------------- |
| Scope           | Whole app                                                   |
| Visual language | Photos + icons + stage chips, lightly                       |
| Density         | Calm shop floor — hide advanced filters by default          |
| Approach        | Full brand redesign (not skin-only)                         |
| Brand           | **Track Day** — dark + teal + safety orange + mono wordmark |
| Home layout     | **Stage gallery board**                                     |
| Cards           | **Photo + action strip** (primary + secondary icon)         |
| Shell           | **Dark chrome / light bay**                                 |

## Brand identity — Track Day

### Tokens (replace / extend current zinc-amber system)

- **Chrome:** near-navy/black (`#0b1220` / `#111827`), light text, muted slate secondary.
- **Bay (main canvas):** light cool surface (`#f8fafc` / white cards), not warm cream.
- **Signal primary:** safety orange `#f97316` — primary CTAs, NOW/active, urgent accents.
- **Signal secondary:** teal `#0f766e` / `#14b8a6` — stage progress, selected, success-adjacent shop energy.
- **Status:** keep semantic danger/success/warning/info/waiting. Remap waiting from violet to a distinct slate-cyan (`#0891b2`) so brand stays teal/orange, not purple.
- **Type:** **IBM Plex Mono** (wordmark + stage pills) + **Space Grotesk** (titles/UI). Load via `next/font`. No Inter/Roboto/Arial/system-only stacks.
- **Radius / shadow:** slightly tighter industrial radii; soft elevation only under floating docks/modals.

### Wordmark

`OTOMOTO` in mono, tracked, on dark chrome. Brand must remain a hero-level signal in the shell (logo size/weight), not a tiny nav afterthought.

## Information architecture

### Stage gallery board (home / dashboard default)

Fewer, wider columns mapped to visit stages, e.g.:

1. Intake / waiting approval
2. In bay (ready + in progress)
3. QC
4. Ready for pickup

Each column: stage label + count + vertical stack of photo cards.  
Default chrome: search + location + “More” (filters, saved views, density, list mode).  
Board remains the default; list/cards modes stay available under More if already implemented.

### Floor OS

Keep hybrid queue + focused surface. Restyle to Track Day tokens; queue items become compact photo thumbs where available; stage rail and sticky dock use orange primary / teal selected. No workflow changes.

### Work order detail

Photo-forward header (intake strip or hero). Stage chip + one next-action line. Tabs stay; reduce competing text blocks in the header. Job cards use the same photo/action language at a smaller scale.

## Components

### Photo + action card

1. **Image:** intake/hero photo; if missing, branded teal→slate gradient placeholder with bike silhouette or initials — never empty gray.
2. **Body:** motorcycle title, customer subtitle, mono stage pill.
3. **Actions:** one primary text button (context: Open / Pull / Continue); one secondary icon button (Flag or overflow). No action sprawl on the card.
4. **Flags / andon:** thin orange or danger edge + icon; admin flag still highlighted for front office.

### Stage chip

Mono uppercase or tracked label; teal for active/selected, orange for NOW/urgent, muted for completed.

### Icon vocabulary

Use **Lucide React** for nav, flag, clock, QC, parts, and photos. Icons accompany labels in chrome; icon-only only for secondary card actions with `aria-label`.

### More panel

Collapses: filters, flag chips, saved views, density, view-mode toggles. Use an expandable panel under the dashboard header (not a modal that blocks the board).

### Empty states

Keep illustrated empty states; restyle to Track Day (teal wash, orange accent), fewer words.

## Motion

Ship 2–3 intentional motions only:

1. Column/content enter: short fade/slide (≤200ms).
2. Card press: subtle scale.
3. Sticky CTA dock: slide up on focus surfaces.

Respect `prefers-reduced-motion`.

## Accessibility & devices

- Safari Mac + iPad first; `--tap-min` ≥ 44px retained.
- Contrast: orange/teal on dark chrome and on light bay must meet WCAG AA for text/UI.
- Do not rely on color alone — stage pill text + icon.

## Rollout

1. **Tokens + chrome + typography** (globals, AppShell).
2. **Card primitive + stage chips + icons.**
3. **Dashboard stage gallery + More panel.**
4. **Floor OS + WO detail/header + JobCard alignment.**
5. **Empty states + motion polish.**

Ship behind no feature flag; visual-only, so progressive commits on the feature branch are fine.

## Success criteria

- Advisor can identify bike + stage from the board without reading a paragraph.
- Default dashboard shows far fewer controls than today before opening More.
- Floor, board, and WO detail feel like one product (tokens, cards, CTAs).
- Existing flows (pull, complete, QC, flags, filters) still work; filters reachable via More.

## References

- Prior Floor OS specs remain authoritative for technician workflow.
- This spec overrides visual language (zinc/amber-only) where they conflict; workflow text in those specs stays.
