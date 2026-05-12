# Review Summary

**Feature:** Responsive Graceful Collapse  
**Spec:** `docs/features/2026.5.11-responsive-graceful-collapse/spec.md` | **Design:** `docs/features/2026.5.11-responsive-graceful-collapse/design.md`

## Problem

When Adam resizes his browser below ~1280px (side-by-side windows, smaller monitors), the PocketWise Insights layout breaks — table columns overflow, badges clip, and the sidebar eats the viewport. The layout has no graceful degradation; it's optimized for 1920px and breaks everywhere else.

## Experience

**Before:** The desktop layout is rigid. Narrowing the browser causes transaction table columns to overflow their container, the review panel crowds main content until text clips mid-word, and the sidebar consumes disproportionate space. Adam has to keep his browser near full-width to use the app comfortably.

**After:** The layout fluidly adapts from 1920px down to 900px. The sidebar collapses to icons, the date column hides when space is tight, the review panel shrinks and condenses badges, and padding scales down — all automatically. Adam can comfortably use the app in a half-screen window without anything breaking.

## Example

> **Example:** Adam is reviewing transactions side-by-side with his bank's website, so his browser is ~1100px wide. The sidebar auto-collapses to icon-only (48px), freeing space for the transaction table. The date column is hidden since the content area is below 1280px, but name, category, and amount remain readable. He clicks "Review" in the sidebar — the review panel opens at 320px and the layout has ~732px for content. Duplicate groups are legible, badges read "X-acct" and "REVIEW" instead of their full text. He clicks the sidebar expand chevron to check navigation — it expands, the layout tightens, and when he closes the review panel, everything restores.

## Key Decisions

**1. Sidebar: Replace resize handle with collapse toggle**
- **Options:** A) Replace drag handle with two-mode toggle (160px / 48px). B) Keep drag handle AND add collapse toggle.
- **Decision:** Option A — two modes only, drag handle removed.
- **Why:** Two predictable modes are faster and more keyboard-accessible than a drag handle with infinite states that provided marginal value.

**2. Review panel: Auto-collapse sidebar when panel opens**
- **Options:** A) Enforce minimum content width by shrinking the review panel further. B) Auto-collapse sidebar to 48px when content would drop below 500px. C) Accept the tight layout.
- **Decision:** Option B — auto-collapse sidebar, with snapshot/restore on panel close.
- **Why:** When Adam opens the review panel his intent is to review — the sidebar is secondary, and auto-collapsing protects layout quality without shrinking the panel's readable area.

**3. Date column hide: Container queries over media queries**
- **Options:** A) Viewport-based media query at 1280px. B) Content-area container query at 1280px.
- **Decision:** Option B — container query based on actual content area width.
- **Why:** With sidebar at either 160px or 48px, viewport-based queries would hide the date column at inconsistent points; container queries respond to actual available space.

**4. Manual preference behavior (resolved during design review)**
- **Options:** A) Manual collapse preference is permanent across all viewport changes. B) Crossing 1280px on widen clears all preferences.
- **Decision:** Manual collapse preference survives viewport changes; only auto-collapse state is cleared on widen above 1280px. Review panel auto-collapse overrides manual preference but restores via snapshot on panel close.
- **Why:** If Adam deliberately collapsed at a wide viewport, wiping that choice on resize would be frustrating. But when the review panel needs space, layout quality takes priority temporarily.

## Pending Decisions

None — all decisions resolved.
