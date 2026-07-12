# Mobile responsive design — 2026-07-12

## Goal

Functional parity on phones, shop-floor iPads, and the customer portal. No full mobile redesign; horizontal scroll is acceptable where intentional (kanban, wide tables, WO tabs).

## Decisions (locked)

| Item | Choice |
|------|--------|
| Scope | Staff app + customer portal equally |
| Success bar | Functional parity, not optimized native-app UX |
| Mobile nav (<768px) | **B — hamburger drawer** (user confirmed) |
| Desktop nav (≥768px) | Unchanged left sidebar |

## Implementation

### 1. Viewport (`app/layout.tsx`)

Export Next.js `viewport` with `device-width`, `initialScale: 1`, `viewportFit: cover` for notched phones and correct scaling.

### 2. Hamburger drawer (`AppShell`, `SidebarNav`, `globals.css`)

**Mobile (<768px):**

- Slim `mobile-header`: logo + menu button (44px tap target).
- Sidebar becomes fixed off-canvas drawer; opens with `.sidebar-open` on shell.
- Semi-transparent backdrop closes drawer on tap.
- Drawer closes on route change and nav link click.
- Main content uses full width; topbar stacks search + location + user badge.

**Desktop (≥768px):** existing column layout unchanged.

### 3. Work order tabs (`WorkOrderTabs`, `globals.css`)

- Add `tab-bar-scroll` on narrow screens: single-row horizontal scroll, no wrap.
- Tabs keep 44px min height.

### 4. Signature canvas (`SignatureCanvas.tsx`)

- Size canvas from container width via `ResizeObserver`.
- Apply `devicePixelRatio` scaling for sharp strokes on retina phones/iPads.
- Pointer coordinates in CSS pixel space (post-`ctx.scale`).

### 5. Contract & portal

- Contract form: full-width fields on narrow screens; prose scrolls inside card.
- Portal page: safe-area padding (`env(safe-area-inset-*)`) on container.

### 6. Overflow hardening

- Topbar: full-width search on mobile; actions wrap.
- Audit log table: use shared `data-table-wrap` pattern.

## Out of scope

- Bottom tab bar, separate mobile routes
- Kanban touch-drag redesign (horizontal scroll retained)
- Playwright/viewport E2E suite (manual QA at 320 / 375 / 768px)

## Verify

1. Phone width (~375px): menu opens drawer; all nav links reachable; no horizontal page overflow except intentional scroll regions.
2. iPad (~768px+): desktop sidebar visible; inspection fullscreen unchanged.
3. `/c/[token]`: contract signing + estimate readable; signature drawable.
4. WO detail: tabs scroll horizontally on phone.
