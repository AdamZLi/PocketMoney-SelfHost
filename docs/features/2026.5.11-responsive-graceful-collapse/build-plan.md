# Build Plan: Responsive Graceful Collapse

**Source spec:** `docs/features/2026.5.11-responsive-graceful-collapse/spec.md`
**Source design:** `docs/features/2026.5.11-responsive-graceful-collapse/design.md`
**Date:** 2025-07-11

## Summary (plain English)

When Adam resizes his browser window narrower, the app currently breaks — columns overflow, text clips, and the sidebar eats too much space. This feature makes the layout gracefully adapt from 1920px down to 900px. The sidebar switches between a full-label mode (160px) and an icon-only mode (48px) with a single toggle button. The transaction table automatically hides the date column when space is tight. The review panel becomes fluid-width and auto-collapses the sidebar when it opens at narrow widths. Stat cards, charts, and page padding all compress smoothly. Adam never sees broken layouts again.

## Execution Steps

### Step 1: Install container queries plugin and add Tailwind config

**What happens:** Nothing visible yet — this installs the CSS container query tooling needed for the transaction table's date column to hide based on *content area* width (not window width).

**Technical implementation:**
- Run `npm install @tailwindcss/container-queries`
- `tailwind.config.ts`: Add `require("@tailwindcss/container-queries")` to `plugins` array (alongside existing `tailwindcss-animate`)

**Depends on:** None
**Verify:** `npm run build` succeeds with no errors.

---

### Step 2: Sidebar two-mode collapse with toggle and persistence

**What happens:** The sidebar's drag-to-resize handle is replaced with a simple collapse/expand toggle button (chevron at the bottom). The sidebar is either 160px (full labels) or 48px (icons only). When the window is narrower than 1280px, it auto-collapses. Adam's manual preference is saved in localStorage and wins over auto-behavior.

**Technical implementation:**
- `src/components/AppLayout.tsx`:
  - Remove: `MIN_WIDTH`, `MAX_WIDTH`, `DEFAULT_WIDTH` constants, drag resize state (`isDragging` ref), `mousemove`/`mouseup` listeners, `<div role="separator">` resize handle, `sidebarWidth` number state.
  - Add: `isCollapsed` boolean state. Load initial from `localStorage.getItem("ledger.sidebarCollapsed")`. If no stored preference, derive from `window.innerWidth < 1280`.
  - Add: `useEffect` with `resize` listener: if no manual preference stored, auto-collapse below 1280px / auto-expand above. If user has manually set a preference (flag in state or localStorage key exists), skip auto-behavior. When auto-collapsed state clears (viewport widens), remove the stored preference so auto-behavior resumes.
  - Add: Toggle button at sidebar bottom — `«` chevron when expanded, `»` when collapsed. `onClick`: flip `isCollapsed`, write `"ledger.sidebarCollapsed"` to localStorage, set `manualPreference` flag. `aria-label="Collapse sidebar"` / `"Expand sidebar"`, `aria-expanded`.
  - Sidebar `<aside>`: replace inline `style={{ width }}` with `w-[160px]` / `w-[48px]` class toggle. Add `transition-[width] duration-200 ease-out`. Add `motion-reduce:transition-none`.
  - Nav items: when collapsed, hide label text (`opacity-0 w-0 overflow-hidden` with transition), show only icon. Each `<NavLink>` gets `aria-label={label}`. Add `title={label}` tooltip (or shadcn `<Tooltip>` with 300ms delay) on icons when collapsed.
  - During transition: add `pointer-events-none` on sidebar for 200ms.
  - Export `isCollapsed` and `setIsCollapsed` via React context (`SidebarContext`) so `Transactions.tsx` can snapshot/restore for review panel auto-collapse.

**Depends on:** None
**Verify:** Resize browser across 1280px boundary — sidebar auto-collapses/expands. Click toggle — sidebar toggles and stays on reload. Hover collapsed icons — tooltips appear after 300ms. Tab to toggle button — Enter/Space works.

---

### Step 3: Transaction table progressive column hiding with container queries

**What happens:** When the content area (not the window) gets narrower than 1280px, the date column disappears automatically and the category column shrinks. The table never overflows.

**Technical implementation:**
- `src/pages/Transactions.tsx`:
  - Wrap the transaction table's parent container with `@container` class (from `@tailwindcss/container-queries`).
  - Replace the hardcoded `GRID` constant. Use two grid templates:
    - Wide: `grid-cols-[24px_1fr_180px_140px_120px_28px]` (6 columns — adds actions column and date column)
    - Narrow: `grid-cols-[24px_1fr_140px_100px_28px]` (5 columns — no date)
  - Apply via container query: `@[1280px]:grid-cols-[24px_1fr_180px_140px_120px_28px]` on the grid rows.
  - Date `<th>` and `<td>` cells: `hidden @[1280px]:block` (or `@[1280px]:table-cell`). Use `display: none` below threshold — no `aria-hidden` needed since it's removed from DOM flow.
  - Category column cells: add `truncate` class + `title={fullCategoryName}` for tooltip.
  - Name column: ensure `min-w-0 truncate` with `title` attribute.
  - Note: The current GRID is 5 columns (`24px_1fr_180px_140px_120px` — checkbox, name, category, treatment, amount). The date column needs to be *added* as a new column that hides at narrow widths. If date column doesn't exist in current table, add it at position 4 (after category) with date values from transaction data.

**Depends on:** Step 1 (container queries plugin)
**Verify:** With sidebar expanded (160px) at 1440px viewport, date column visible. Collapse sidebar — more space, still visible. Narrow to 1100px — date column hides. Category names truncate with tooltip on hover.

---

### Step 4: Review panel fluid width + sidebar auto-collapse on panel open

**What happens:** The review panel's width becomes fluid (`min(400px, 35vw)`, floor 320px) instead of fixed. When the panel opens and the main content would get too cramped (<500px), the sidebar auto-collapses to make room. When the panel closes, the sidebar returns to its previous state.

**Technical implementation:**
- `src/pages/Transactions.tsx`:
  - Remove: scan panel drag-resize handle, `scanPanelWidth` state, `MIN/MAX/DEFAULT` constants, `mousemove`/`mouseup` listeners, `localStorage` read/write for `"ledger.scanPanelWidth"`.
  - Replace panel width with CSS: `width: min(400px, 35vw)` with `min-width: 320px`. Apply via inline style or Tailwind arbitrary: `w-[min(400px,35vw)] min-w-[320px]`.
  - Remove the `<div role="separator">` resize handle from the panel.
  - Add sidebar auto-collapse logic:
    - Import `SidebarContext` (from Step 2).
    - When scan panel opens (`showScanPanel` becomes true): calculate `viewportWidth - sidebarWidth - panelWidth`. If result < 500px, snapshot current `isCollapsed` state into a `useRef`, then call `setIsCollapsed(true)`.
    - Also add this check to the viewport resize handler: if panel is open and content < 500px, auto-collapse.
    - When panel closes: restore sidebar to snapshot value.
    - If Adam manually toggles sidebar while panel is open, let it happen (his choice wins). On close, still restore to *snapshot* value (pre-panel state).
  - Badge condensing (review panel content):
    - "Cross-account" → "X-acct": use panel width check or container query at 360px. Add `aria-label="Cross-account"` regardless.
    - "NEEDS REVIEW" → "REVIEW": same threshold.
    - Merchant names: `truncate` + `title` attribute.
    - Summary text: condense at narrow panel width.

**Depends on:** Step 2 (sidebar context)
**Verify:** Open review panel at 1100px viewport with sidebar expanded — sidebar auto-collapses. Close panel — sidebar restores. At 1400px, sidebar stays expanded when panel opens (enough room). Badge text condenses at narrow widths. Panel width shrinks fluidly as viewport narrows, never below 320px.

---

### Step 5: Page padding responsive scale

**What happens:** Page content areas get slightly tighter padding at narrow widths (p-6 instead of p-8), giving content more room without looking cramped.

**Technical implementation:**
- `src/pages/Dashboard.tsx`, `src/pages/Transactions.tsx`, and all other page files (`Import.tsx`, `Trends.tsx`, `Categories.tsx`, `Aliases.tsx`, `Accounts.tsx`, `Review.tsx`):
  - Find the main content wrapper `<div>` with `p-8` class.
  - Replace `p-8` with `p-6 xl:p-8`.

**Depends on:** None
**Verify:** At 1400px viewport, padding is p-8 (32px). At 1200px, padding is p-6 (24px). Visual check — content doesn't feel cramped.

---

### Step 6: Stat cards and bar chart fluid sizing

**What happens:** The three stat cards on the dashboard reduce their internal padding and font sizes at narrow widths. Category bar chart labels truncate instead of overflowing.

**Technical implementation:**
- `src/pages/Dashboard.tsx`:
  - Stat cards: Add `min-w-0` to each `<Card>`. Change value text from `text-3xl` to `text-2xl xl:text-3xl`. Change subtitle copy: wrap in conditional — full text at `xl:` and short text ("groups" instead of "parent groups this month") at default. Reduce `CardHeader`/`CardContent` padding at narrow: `p-4 xl:p-6`.
  - Category bar chart labels: Add `max-w-[160px] xl:max-w-[240px] truncate` to category name `<span>`. Add `title={fullCategoryName}` for tooltip. Amount stays right-aligned, never truncates.

**Depends on:** None
**Verify:** At 1000px viewport with sidebar collapsed: stat cards show shortened text, smaller values. Bar chart labels truncate with tooltip. No overflow anywhere.

---

### Step 7: Reduced motion and accessibility pass

**What happens:** Users who prefer reduced motion see instant layout changes with no animations. All truncated text has proper tooltips. Focus indicators work at all widths.

**Technical implementation:**
- `src/components/AppLayout.tsx`: Sidebar transition already uses `motion-reduce:transition-none` (from Step 2). Verify `pointer-events-none` during animation is skipped when reduced motion.
- All truncated text elements: audit for `title` attribute presence.
- Sidebar collapsed icons: verify `aria-label` on each `<NavLink>`.
- Badge abbreviations ("X-acct"): verify `aria-label="Cross-account"`.
- Focus indicators: test at 48px sidebar width — ensure focus rings aren't clipped by overflow hidden.

**Depends on:** Steps 2, 3, 4, 6
**Verify:** Enable `prefers-reduced-motion: reduce` in browser DevTools → sidebar toggle is instant. Tab through collapsed sidebar — all items announced correctly. Hover any truncated text — tooltip shows full value.

---

### Step 8: Update architecture doc and feature summary, mark spec/design as Implemented

**What happens:** Documentation is updated to reflect the new responsive behavior so future changes don't conflict.

**Technical implementation:**
- `docs/architecture.md`:
  - Components section: Add note to `AppLayout.tsx` — "Sidebar two-mode collapse (160px/48px) with SidebarContext"
  - Add `@tailwindcss/container-queries` to Tech Stack libraries
  - Recent Changes: "2025-07-11: Added responsive graceful collapse — sidebar two-mode toggle, transaction table container-query column hiding, fluid review panel with sidebar auto-collapse, responsive padding/cards/charts"
- `docs/features.md`:
  - Under a new "🖥️ Responsive Layout" section: "Desktop layout adapts fluidly from 1920px to 900px. Sidebar collapses to icon-only mode at narrow widths or via manual toggle. Transaction table hides the date column when space is tight. Review panel width adjusts fluidly and auto-collapses the sidebar to make room. Stat cards, chart labels, and page padding compress gracefully."
  - Update "Last updated" date.
- `docs/features/2026.5.11-responsive-graceful-collapse/spec.md`: Change `**Status:** Reviewed` → `**Status:** Implemented`
- `docs/features/2026.5.11-responsive-graceful-collapse/design.md`: Change `**Status:** Reviewed` → `**Status:** Implemented`

**Depends on:** Steps 1–7
**Verify:** Read docs — changes are present and accurate.

## Wiring Checklist

- [ ] Sidebar toggle button in `AppLayout.tsx` sets `isCollapsed` state and writes to `localStorage("ledger.sidebarCollapsed")`
- [ ] `SidebarContext` in `AppLayout.tsx` exposes `isCollapsed` and `setIsCollapsed` to child routes
- [ ] `Transactions.tsx` imports `SidebarContext` to read/write sidebar state for review panel auto-collapse
- [ ] Review panel open handler in `Transactions.tsx` snapshots sidebar state into `useRef`, calls `setIsCollapsed(true)` when content < 500px
- [ ] Review panel close handler in `Transactions.tsx` restores sidebar from snapshot ref
- [ ] Viewport resize listener in `AppLayout.tsx` auto-collapses/expands sidebar based on 1280px threshold (when no manual preference)
- [ ] Viewport resize listener in `Transactions.tsx` checks content < 500px when review panel is open → auto-collapses sidebar
- [ ] Transaction table container (`@container` class) in `Transactions.tsx` enables container queries for date column show/hide
- [ ] Date column `<th>` and `<td>` in `Transactions.tsx` use `hidden @[1280px]:block` for container-query-based visibility
- [ ] Category cells in `Transactions.tsx` use `truncate` + `title` for tooltip
- [ ] Stat card subtitles in `Dashboard.tsx` render condensed copy below `xl:` breakpoint
- [ ] Bar chart category labels in `Dashboard.tsx` use `truncate` + `title` + `max-w-[160px] xl:max-w-[240px]`
- [ ] Badge text in review panel conditionally renders "X-acct" / "REVIEW" at narrow width with `aria-label` preserving full text
- [ ] All page wrappers use `p-6 xl:p-8` instead of `p-8`
- [ ] Sidebar transition uses `motion-reduce:transition-none`
