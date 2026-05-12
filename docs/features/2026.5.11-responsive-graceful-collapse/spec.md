# Responsive Graceful Collapse Specification

**Version:** 1.2  
**Author:** PMSpec Agent  
**Date:** 2025-07-11  
**Status:** Reviewed  
**Target Persona:** Adam — Solo Self-Hoster  
**Companion Design Doc:** `design.md` (same directory)

---

## Problem Statement

When Adam resizes his browser window narrower than ~1280px (e.g., side-by-side windows, smaller monitors), the PocketWise Insights layout breaks rather than adapts. Transaction table columns overflow, the review panel crowds content, badges clip mid-word, and the sidebar consumes disproportionate space. There is no graceful degradation — fixed widths simply break.

**Current state:** A rigid desktop layout optimized for ~1920px that overflows or clips at narrower widths.  
**Desired state:** A fluid desktop layout (900–1920px) that progressively compresses and hides less-important details so the interface never breaks, even at 900px.

---

## Goals & Non-Goals

**Goals:**
1. The app layout adapts fluidly from 1920px down to 900px with no overflow, clipping, or broken layouts.
2. The sidebar, transaction table, review panel, and stat cards each degrade gracefully at defined thresholds.
3. Adam's manual preferences (e.g., sidebar state) are respected and persisted.

**Non-Goals:**
1. Mobile or tablet support — minimum supported width is 900px.
2. Redesigning any component's functionality — this is purely a layout adaptation feature.
3. Supporting viewports below 900px — content may break below this floor.

---

## Product Decisions

### Decision 1: Sidebar — Replace resize handle with collapse toggle

**Chosen:** Option A — Replace. The sidebar has exactly two modes: **expanded (160px)** and **collapsed (48px, icons only)**. The existing drag-to-resize handle (160–480px) is removed.

**Rationale:** Adam values efficiency over complexity. Two predictable modes with a single toggle are faster to use than a drag handle with infinite states. The drag handle's custom widths (200px, 300px, etc.) provided marginal value — most width between 160–480px is wasted space. A clean toggle is more keyboard-accessible and reduces interaction states the system must handle.

### Decision 2: Review panel — Auto-collapse sidebar when panel opens

**Chosen:** Option B — When the review panel opens and the viewport is narrow enough that main content would drop below 500px, the sidebar auto-collapses to icon-only (48px), freeing ~112px for content.

**Rationale:** When Adam opens the review panel, his intent is to review — the sidebar is secondary. Auto-collapsing protects layout quality without forcing the review panel to shrink (which would hurt readability of duplicate groups). Adam can always re-expand the sidebar manually if needed. This avoids the "accept the cramped layout" trap of Option C and the panel-shrinking tradeoff of Option A.

**Constraint:** If Adam has manually expanded the sidebar, the auto-collapse still fires when the review panel opens at narrow widths. The sidebar returns to its previous state when the panel closes.

### Decision 3: Date column hide — Use container queries

**Chosen:** Option B — The transaction table's date column hides based on **content area width** (CSS container query at 1280px content width), not viewport width.

**Rationale:** Because the sidebar can be either 160px or 48px, a viewport-based media query would cause the date column to disappear at inconsistent points depending on sidebar state. Container queries respond to the actual available space, making the behavior predictable regardless of sidebar state. Browser support is ~95%, which is acceptable for a self-hosted app where Adam controls the browser.

---

## User Stories & Experience

**US-1: Passive layout adaptation**  
As Adam, I want the layout to adapt automatically when I resize my browser so that I never see overflow, clipping, or broken layouts.  
- *Happy path:* Adam drags his browser from 1920px to 1000px. Sidebar collapses, date column hides, padding tightens — all without interaction.  
- *Edge case:* Adam rapidly resizes the window. Transitions complete smoothly without layout jank.

**US-2: Sidebar toggle**  
As Adam, I want to manually collapse or expand the sidebar so that I can control how much screen space it uses.  
- *Happy path:* Adam clicks the chevron toggle — sidebar collapses with a brief animation, content area expands.  
- *Edge case:* Adam manually expands the sidebar at 1000px width. It stays expanded (his preference wins) even though auto-collapse would normally trigger.

**US-3: Review panel at narrow widths**  
As Adam, I want to open the review panel without the main content becoming unusably cramped.  
- *Happy path:* At 1100px viewport with sidebar expanded, Adam opens the review panel. Sidebar auto-collapses to 48px, giving the content area ~732px (1100 - 48 - 320).  
- *Edge case:* Adam re-expands the sidebar while the review panel is open. The layout gets tight (~420px content) but is allowed — his manual choice wins.

**US-4: Transaction table readability at narrow widths**  
As Adam, I want the transaction table to remain usable when space is tight, even if some columns are hidden.  
- *Happy path:* At narrow content width, the date column hides automatically. The remaining 5 columns (checkbox, name, category, amount, actions) have adequate space.  
- *Edge case:* Adam has the sidebar manually expanded at 1000px viewport — less content space, but container query still accurately hides the date column based on actual available width.

---

## Acceptance Criteria

**Sidebar:**
- When viewport narrows below 1280px and no manual preference is stored, the sidebar auto-collapses to 48px (icons only).
- When viewport widens above 1280px and the sidebar was auto-collapsed (not manually collapsed), the sidebar auto-expands to 160px and the stored preference is cleared. If Adam manually collapsed the sidebar, that preference survives viewport changes — it is only cleared when Adam explicitly toggles the sidebar back to expanded.
- When Adam clicks the collapse/expand toggle, the preference persists in localStorage and overrides viewport-based auto-collapse. If localStorage is unavailable (e.g., private browsing) or contains an invalid/unrecognized value, treat as "no preference stored" and fall back to auto behavior.
- During collapse/expand animation (≤200ms), the main content area reflows continuously in sync with the sidebar width — no snap or delayed re-render.
- When the sidebar is collapsed, hovering an icon shows a tooltip with the page label after 300ms delay. Tooltip labels match the existing nav items: "Dashboard", "Transactions", "Import", "Trends", "Categories", "Aliases", "Accounts", "Review". The collapse toggle chevron also shows a tooltip: "Expand sidebar" (when collapsed) / "Collapse sidebar" (when expanded).
- The drag-to-resize handle is removed. Sidebar width is either 160px or 48px — no intermediate widths.
- The collapse toggle button has `aria-label="Collapse sidebar"` (when expanded) / `"Expand sidebar"` (when collapsed), plus `aria-expanded="true|false"`. Keyboard accessible via Tab → Enter/Space.
- When the sidebar collapses, nav links remain focusable. Each nav link uses `aria-label` matching the page name (e.g., "Transactions") so screen readers announce the label regardless of visual state.

**Review panel auto-collapse:**
- When the review panel opens and the resulting main content area would be less than 500px wide, the sidebar auto-collapses to 48px. This applies regardless of whether Adam had manually expanded the sidebar — the review panel auto-collapse is a stronger override than viewport-based auto-collapse.
- This trigger also fires during viewport resize: if the review panel is already open and Adam narrows the window such that content would drop below 500px, the sidebar auto-collapses at that point.
- When the review panel opens, the system snapshots the current sidebar state. When the review panel closes, the sidebar restores to that snapshot state — regardless of any manual toggles that happened while the panel was open.
- If Adam manually re-expands the sidebar while the review panel is open, the sidebar stays expanded for that panel session. If Adam then closes and re-opens the review panel, the auto-collapse fires again as a fresh event (with a new snapshot).

**Transaction table:**
- When the content area width drops below 1280px (measured via container query), the date column hides. Both the `<th>` header and all `<td>` cells hide together so the table structure remains semantically clean.
- When the content area width is at or above 1280px, the date column is visible.
- Date column show/hide is instant (no animation) — the column is removed from the DOM flow (e.g., `display: none`) so it is also removed from the accessibility tree. No `aria-hidden` needed.
- Category column shrinks from 180px to 140px at the same 1280px content-width threshold, with ellipsis truncation and a tooltip showing the full category name.
- If the transaction table is empty, the empty state spans all currently-visible columns dynamically.

**Stat cards:**
- Stat cards remain 3-column at all desktop widths. Internal padding reduces at viewport widths below 1280px. Dollar amounts scale from larger to slightly smaller text. Subtitle text condenses (e.g., "parent groups this month" → "groups").
- Cards use `min-w-0` so text truncates rather than overflows.

- **Stat cards:** Specific condensed copy for each card is defined in the companion design doc (Section 2b). The spec defers to the design doc as source of truth for card-level copy changes.

**General layout:**
- No horizontal overflow or content clipping at any viewport width between 900px and 1920px.
- Page padding scales from `p-8` (≥1280px) to `p-6` (<1280px).
- All text truncation includes a `title` attribute with full text. For badge abbreviations (e.g., "X-acct"), `aria-label` contains the full term ("Cross-account") regardless of visual text.
- All layout transitions (sidebar collapse, review panel resize, padding changes) respect `prefers-reduced-motion: reduce` — instant changes with no animation when this preference is set.

---

## Constraints & Considerations

- **Minimum viewport:** 900px. No guarantees below this width.
- **Browser support:** Container queries require ~95% browser support. Acceptable for self-hosted use.
- **Accessibility:** Collapse toggle must be keyboard-accessible (Tab → Enter/Space), with `aria-expanded` and state-dependent `aria-label`. All truncated text must include `title` attributes. Badge text changes must use `aria-label` with full text regardless of visual abbreviation. Nav links in collapsed sidebar retain `aria-label` with page name. Date column hides both `<th>` and `<td>` together for clean table semantics. No `aria-live` announcement for column show/hide — the table structure simply changes.
- **Reduced motion:** All layout transitions (sidebar, review panel, padding, column changes) respect `prefers-reduced-motion: reduce` with instant changes and no animation.
- **Focus indicators:** Focus outlines must remain fully visible at all widths, including the 48px collapsed sidebar where icons and the toggle are tightly packed. Focus indicators must not be clipped by adjacent elements.
- **900px floor with review panel:** At 900px viewport with sidebar collapsed (48px) and review panel at its floor (320px), the content area is ~532px. This is above the 500px minimum and is the tightest supported layout.
- **Performance:** Layout transitions (sidebar collapse, panel resize) should complete in ≤200ms with no visible jank.
- **Persistence:** Sidebar expanded/collapsed preference stored in localStorage. No server-side storage needed.

---

## Out of Scope

- Mobile or tablet breakpoints (below 900px)
- Sidebar fly-out menus in collapsed mode (tooltip only)
- Rearranging or redesigning component layouts (only compression and hiding)
- Changes to the review panel's content or functionality (only its width and text condensing)
