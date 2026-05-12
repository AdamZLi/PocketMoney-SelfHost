# Responsive Graceful Collapse — Design Document (Desktop Only)

**Source spec:** `docs/features/2026.5.11-responsive-graceful-collapse/spec.md`
**Status:** Reviewed

**Scope:** Desktop only. No mobile or tablet breakpoints. Minimum supported width: **900px**. Optimized range: **900px–1920px**.

**Problem:** When the desktop browser window narrows (e.g., side-by-side windows, smaller monitors), fixed-width columns in the transaction table overflow, the review panel crowds content, badges/text clip mid-word, and the sidebar consumes a disproportionate share of the viewport. The layout never adapts — it simply breaks.

**Design goal:** Within the desktop range, content should fluidly compress and progressively hide less-important details so the layout never breaks — even at 900px wide.

---

## 1. User Flow

This is passive behavior — the user resizes their browser and the layout adapts without interaction.

```
Wide desktop (≥1280px)              Narrow desktop (900–1279px)
──────────────────────              ───────────────────────────
Full sidebar (160px+)           →   Sidebar collapses to icon-only (48px)
6-column transaction table      →   5-column (date column hides)
Category + amount in bar chart  →   Category truncates, amount stays
Review panel (400px fixed)      →   Review panel (320px, badges condense)
p-8 page padding                →   p-6 page padding
All badge text visible          →   Long badges truncate with ellipsis
3 stat cards side-by-side       →   3 stat cards (internal padding reduces)
```

**Decision points:**
- User can manually toggle sidebar expanded ↔ collapsed at any width via a chevron button.
- Sidebar preference persists in localStorage. If the user manually expanded it, it stays expanded even at narrow widths (their choice — no forced override).

---

## 2. Component Breakdown

### 2a. Sidebar — Two-Mode Collapse

**Current:** Always expanded, resizable from 160–480px, never collapses.
**Proposed:** Two modes — **expanded** (icons + labels, 160px) and **collapsed** (icons only, 48px).

```
Wide desktop (expanded, 160px)       Narrow desktop (collapsed, 48px)

┌──────────────────┐                 ┌──────┐
│ 🏠  Dashboard    │                 │  🏠  │
│ 💳  Transactions │                 │  💳  │
│ 📥  Import       │                 │  📥  │
│ 📊  Trends       │                 │  📊  │
│ 🏷️  Categories   │                 │  🏷️  │
│ 🔗  Aliases      │                 │  🔗  │
│ 💰  Accounts     │                 │  💰  │
│ 📋  Review       │                 │  📋  │
│                  │                 │      │
│                  │                 │      │
│  « Collapse      │                 │  »   │
└──────────────────┘                 └──────┘
```

- **Toggle button:** Chevron `«` at bottom of sidebar when expanded; `»` when collapsed. Always visible.
- **Auto-collapse trigger:** When viewport < 1280px and user hasn't manually set a preference, sidebar auto-collapses.
- **Hover reveal (collapsed mode):** Hovering over a collapsed icon shows a tooltip with the page label (e.g., "Transactions"). No fly-out menu — just a tooltip.
- **Reuses:** existing `NavLink` items, existing sidebar container, existing resize handle (removed in collapsed mode).
- **New:** collapse toggle button, icon-only layout mode.

### 2b. Dashboard Stat Cards — Fluid Compression

**Current:** `grid-cols-1 sm:grid-cols-3` with fixed internal padding.
**Proposed:** Stay 3-column at all desktop widths. Reduce internal padding and font sizes at narrow widths.

```
Wide desktop (≥1280px)
┌─────────────────┬─────────────────┬─────────────────┐
│ ↗ Spent this    │ 🏷 Top category │ 📁 Categories   │
│   month         │                 │    tracked      │
│                 │                 │                 │
│ $1,300.80       │ Household       │ 8               │
│ 1000 txns       │ $661.59         │ parent groups   │
│                 │                 │ this month      │
└─────────────────┴─────────────────┴─────────────────┘

Narrow desktop (900–1279px)
┌────────────┬────────────┬────────────┐
│ ↗ Spent    │ 🏷 Top     │ 📁 Cats    │
│            │   category │   tracked  │
│ $1,300.80  │ Household  │ 8          │
│ 1000 txns  │ $661.59    │ groups     │
└────────────┴────────────┴────────────┘
```

- Cards use `min-w-0` so text truncates rather than overflows.
- Dollar amount uses `text-2xl` at wide, `text-xl` at narrow.
- Subtitle text ("parent groups this month") shortens to "groups" at narrow.

### 2c. Transaction Table — Progressive Column Hiding

**Current:** Hardcoded grid `[24px_1fr_180px_140px_120px_28px]` — 6 fixed columns that overflow.
**Proposed:** Two tiers based on available content width.

```
Wide desktop — all 6 columns
┌──┬──────────────────┬──────────────┬────────────┬──────────┬──┐
│✓ │ Trader Joe's     │ Food & Drink │ Apr 11     │  -$45.20 │⋯ │
│  │                  │              │            │          │  │
├──┼──────────────────┼──────────────┼────────────┼──────────┼──┤
│✓ │ Target           │ Shopping     │ Apr 19     │  -$12.99 │⋯ │
└──┴──────────────────┴──────────────┴────────────┴──────────┴──┘
 24px    1fr              180px         140px        120px   28px


Narrow desktop — date column hidden, category shrinks
┌──┬──────────────────┬──────────────┬──────────┬──┐
│✓ │ Trader Joe's     │ Food & Drink │  -$45.20 │⋯ │
│  │                  │              │          │  │
├──┼──────────────────┼──────────────┼──────────┼──┤
│✓ │ Target           │ Shopping     │  -$12.99 │⋯ │
└──┴──────────────────┴──────────────┴──────────┴──┘
 24px    1fr              140px         100px   28px
```

- **Column hide priority** (hide first → last): date → category shrinks → everything else stays.
- Date column hides below 1280px content width (not viewport — account for sidebar).
- Category column shrinks from 180px → 140px and truncates long names with ellipsis + tooltip.
- Amount column shrinks from 120px → 100px.
- Name column (`1fr`) always fills remaining space; truncates with ellipsis.
- Checkbox (24px) and actions (28px) never hide.

### 2d. Review Panel — Fluid Width with Content Condensing

**Current:** Fixed-width side panel with `sm:max-w-md` (~448px). Badges and account names clip.
**Proposed:** Panel width is fluid: `min(400px, 35vw)` with a floor of 320px.

```
Wide desktop — review panel at 400px
┌──────────────────────────┬──────────────────────────────┐
│                          │ ✕  Review proposed changes   │
│  main content            │ 28 of 28 changes selected.   │
│  (transactions table)    │ All 43 considered txns will  │
│                          │ be marked as reviewed.       │
│                          ├──────────────────────────────┤
│                          │ ● Potential duplicates       │
│                          │   9 groups  ⚠ NEEDS REVIEW  │
│                          │ ┌────────────────────────┐   │
│                          │ │ 2 matching  Cross-acct │✓│ │
│                          │ │                        │  │ │
│                          │ │ Apr 11  Trader Joe's   │  │ │
│                          │ │         scanned        │  │ │
│                          │ │─────────────────────── │  │ │
│                          │ │ Apr 11  Trader Joe's   │  │ │
│                          │ │  (Amex Gold)  existing │  │ │
│                          │ └────────────────────────┘   │
└──────────────────────────┴──────────────────────────────┘

Narrow desktop — review panel at 320px, badges condense
┌──────────────────────┬──────────────────────────┐
│                      │ ✕  Review proposed changes│
│  main content        │ 28 of 28 selected.       │
│                      ├──────────────────────────┤
│                      │ ● Potential duplicates    │
│                      │   9 groups  ⚠ REVIEW     │
│                      │ ┌────────────────────┐   │
│                      │ │ 2 matching  X-acct │✓│ │
│                      │ │                    │  │ │
│                      │ │ Apr 11  Trader...  │  │ │
│                      │ │         scanned    │  │ │
│                      │ │─────────────────── │  │ │
│                      │ │ Apr 11  Trader...  │  │ │
│                      │ │  (Amex…)  existing │  │ │
│                      │ └────────────────────┘   │
└──────────────────────┴──────────────────────────┘
```

- "Cross-account" badge → "X-acct" below 360px panel width.
- "NEEDS REVIEW" badge → "REVIEW" below 360px.
- Merchant names truncate with ellipsis; full name on hover tooltip.
- Account name in parentheses truncates: "(American Express Gold Card)" → "(Amex…)".
- Summary text condenses: drops "All 43 considered transactions (15 no-change) will be marked as reviewed when you confirm." → "28 of 28 selected." at narrow.

### 2e. Page Padding — Responsive Scale

**Current:** `p-8 max-w-6xl` everywhere.
**Proposed:** `p-6 xl:p-8 max-w-6xl` — slightly tighter at default, full padding on wide screens.

### 2f. Category Bar Chart — Truncation

**Current:** Full category names always shown; amount right-aligned.
**Proposed:** Category name truncates at narrow widths; amount always visible.

```
Wide desktop
│ Car & Transport                              $6.00 │
│ ●                                                  │
│──────────────── track ─────────────────────────────│

Narrow desktop
│ Car & Tran...                                $6.00 │
│ ●                                                  │
```

- Category label: `max-w-[160px] xl:max-w-[240px]` with `truncate`. Full name in `title` tooltip.
- Amount always visible, right-aligned, never truncates.

---

## 3. States & Edge Cases

| State | Behavior |
|-------|----------|
| **Sidebar manually expanded + window narrows below 1280px** | Sidebar stays expanded (user preference wins). Content area compresses. |
| **Sidebar auto-collapsed + window widens above 1280px** | Sidebar auto-expands (no manual pref stored). |
| **User manually collapses sidebar** | Stores `sidebar: collapsed` in localStorage. Stays collapsed at all widths until user toggles back. |
| **Transaction table with long merchant name + narrow viewport** | Name column truncates with ellipsis. Full name in `title` attr / hover tooltip. |
| **Review panel open + sidebar expanded at narrow width** | Content area gets squeezed (sidebar 160px + panel 320px = 480px chrome). Main content min-width: 420px. If viewport < 900px, panel overlaps with higher z-index. |
| **Category bar chart with 15+ categories** | Already scrollable — no change needed. Labels truncate per 2f. |
| **Stat card dollar value > $99,999** | Font scales down from `text-2xl` to `text-xl` automatically via `text-2xl xl:text-3xl`. Truncation not needed — 6-digit values fit at `text-xl`. |
| **Badge text truncation edge case** | "Cross-account" → "X-acct" transition happens at panel width ≤360px (CSS container query or JS width check). |
| **Review panel: 0 duplicates, 0 proposals** | Existing empty state behavior preserved — no responsive change needed. |

---

## 4. Interaction Patterns

**Sidebar collapse toggle:**
- Click `«` chevron → sidebar animates from 160px → 48px over 200ms (ease-out). Main content area expands to fill freed space.
- Click `»` chevron → sidebar animates from 48px → 160px over 200ms (ease-out). Main content area shrinks.
- During animation: `pointer-events: none` on sidebar to prevent accidental clicks.
- Sidebar nav labels fade out (opacity 1→0 over first 100ms of collapse), icons remain.

**Sidebar icon hover (collapsed mode):**
- Hover on icon → tooltip appears after 300ms delay, positioned to the right of the icon.
- Tooltip shows page label (e.g., "Transactions").
- No fly-out sub-menus.

**Transaction date column hide:**
- Pure CSS — no animation. At the breakpoint, column switches from visible to `display: none`. Grid template adjusts from 6-col to 5-col.
- No user toggle — this is automatic based on available content width.

**Review panel badge condensing:**
- Text swap happens via CSS (`content` or conditional rendering based on panel width).
- No animation — instant swap at width threshold.

**Window resize during panel open:**
- Panel width transitions smoothly (CSS `transition: width 200ms`).
- Content reflows naturally. Truncation kicks in as panel narrows.

---

## 5. Content & Copy

| Element | Wide (≥1280px) | Narrow (900–1279px) |
|---------|----------------|---------------------|
| Sidebar collapse button tooltip | "Collapse sidebar" | "Expand sidebar" |
| Sidebar nav item tooltip (collapsed) | — (labels visible) | "Dashboard", "Transactions", etc. |
| Review panel summary | "28 of 28 changes selected. All 43 considered transactions (15 no-change) will be marked as reviewed when you confirm." | "28 of 28 selected." |
| "Cross-account" badge | "Cross-account" | "X-acct" |
| "NEEDS REVIEW" badge | "NEEDS REVIEW" | "REVIEW" |
| Truncated merchant name tooltip | — (full text visible) | Full merchant name, e.g. "Ros Niyom Thai Restalong Island City" |
| Truncated account name | "(American Express Gold Card)" | "(Amex…)" |
| Truncated category label | "Car & Transport" | "Car & Tran…" (tooltip: "Car & Transport") |
| Stat card subtitle | "parent groups this month" | "groups" |

---

## 6. Accessibility Notes

- **Sidebar collapse button:** `aria-label="Collapse sidebar"` / `"Expand sidebar"`. `aria-expanded="true|false"`. Keyboard accessible via Tab → Enter/Space.
- **Sidebar icons (collapsed mode):** Each icon retains `aria-label` matching the page name. Screen readers announce "Dashboard", not just the icon.
- **Truncated text:** All truncated elements (`text-overflow: ellipsis`) include `title` attribute with full text. Screen readers read full text, not truncated.
- **Hidden date column:** Column header and cells use `aria-hidden` when hidden to keep the table semantically clean. Screen reader table navigation skips the hidden column.
- **Review panel badge changes:** Badge text changes ("Cross-account" → "X-acct") use `aria-label="Cross-account"` regardless of visual text, so screen readers always hear the full term.
- **Reduced motion:** Sidebar collapse animation respects `prefers-reduced-motion: reduce` — instant width change, no transition.
- **Focus management:** Collapsing sidebar does not steal focus. Focus remains on whatever element the user was interacting with.

---

## 7. Resolved Design Decisions

All product decisions have been resolved by the PMSpec agent. See `spec.md` for full rationale.

1. **Sidebar: Replace resize handle with collapse toggle.** The drag-to-resize handle is removed. Sidebar has exactly two modes: expanded (160px) and collapsed (48px icons only). A single chevron toggle switches between them. Rationale: two predictable modes are faster and more keyboard-accessible than infinite drag states.

2. **Review panel: Auto-collapse sidebar when panel opens.** When the review panel opens and content area would drop below 500px, the sidebar auto-collapses to 48px. The previous sidebar state is snapshotted and restored when the panel closes. If the user manually re-expands the sidebar while the panel is open, their choice wins for that session.

3. **Date column: Use container queries.** The date column hides based on content area width (container query at 1280px), not viewport width. This ensures the column responds to actual available space regardless of sidebar state. Browser support (~95%) is acceptable for self-hosted use.

---

## Breakpoint Summary

| Content Width | Sidebar | Txn Table | Review Panel | Padding | Bar Chart Labels |
|---------------|---------|-----------|--------------|---------|-----------------|
| ≥1280px | Expanded (160px) | Full 6-col | 400px | p-8 | Full names |
| 900–1279px | Icon-only (48px) | 5-col (no date) | 320px, badges condensed | p-6 | Truncated at 160px |

---

## Implementation Priority

1. **Sidebar collapse** — highest impact, frees ~112px of content space immediately
2. **Transaction table column hiding** — fixes the primary overflow issue from the screenshots
3. **Review panel fluid width + badge condensing** — fixes the second screenshot's issues
4. **Page padding scale** — quick win
5. **Stat card + bar chart fluid sizing** — minor polish
