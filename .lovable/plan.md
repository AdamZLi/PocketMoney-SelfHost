## Trends → Visualization: add category Treemap

### Scope

1. **Rename page title** from "Trends" → "Visualization" (eyebrow + H1). Keep nav label and `/trends` route as-is.
2. **Update the time-range toggle** to: `3M / 6M / 12M / YTD / All time`. Default `12M`. Both the bar chart and the new treemap read from this single toggle.
3. **Add a Treemap section** directly below the existing monthly bar chart.

### Time range toggle

- Options: `3M`, `6M`, `12M`, `YTD`, `All time`. Default `12M`.
- `3M / 6M / 12M`: last N months including current.
- `YTD`: Jan 1 of current year → today.
- `All time`: from the earliest transaction date in the DB → today (one-time `min(date)` query, cached).
- Custom date popover continues to override the pill.
- Both bar chart and treemap derive from the same `range`.

### Treemap

**Aggregation** (over the same `range` and loaded `rows`):
- Per category bucket (`parent_category || name || "Uncategorized"`):
  - `total`: respects `showRaw` toggle (raw positive amounts when on; sum of `effectiveMonthlyContribution` across the window's months when off — same logic as bar chart).
  - `count`: number of transactions contributing > 0 in the window.
  - `pct`: total / grand total.
- Skips excluded rows and non-positive amounts.
- Respects the page's account filter. Ignores the per-category dropdown (a single-category treemap is meaningless).

**Colors:** Reuse the page's existing `categories` array order + `PALETTE` / `NEUTRAL` so each category's fill matches the bar chart.

**Rendering** (Recharts `<Treemap>` + custom `content`):
- Label rules by cell `width` × `height`:
  - `width < 80 || height < 40` → no label
  - `80 ≤ width < 120` → category name only (truncated)
  - `width ≥ 120` → name + dollar total + percent, stacked
- White text with a subtle shadow for legibility.

**Tooltip:** Same style as the bar chart's tooltip card; shows category name, total spend, % of total, transaction count.

**Layout:** Full-width section, ~420px tall, no card chrome. Section header `Composition` with a short subtitle. Placed directly below the bar chart `<section>`.

### Files to edit

- `src/pages/Trends.tsx` — rename header; replace pill values; extend `range` memo for `YTD` and `All time`; add new treemap `<section>` below the bar chart.