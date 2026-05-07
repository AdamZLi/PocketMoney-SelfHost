## What's changing — category trends section

Add a new section to `src/pages/Trends.tsx`, placed directly below `<CategoryTreemap />` and above `<MonthBreakdown />`, called **"What's changing"** with a dynamic muted subtitle (e.g. *"vs. your 6-month average"* — see below).

### Window follows the page range toggle

This section uses the same `buckets` array already computed in `Trends` (driven by the 3M/6M/12M/YTD/All-time pill + custom date range). The subtitle reflects the actual window length:

| `buckets.length` (N) | Subtitle |
|---|---|
| ≥ 2 | `"vs. your N-month average"` |
| 1 | `"Not enough history yet"` (still render header, hide list) |

`current` = spend in the **last** bucket (most recent month in range).
`baseline` = average of the prior `N − 1` buckets.
The sparkline shows all `N` buckets (capped to the most recent 12 for visual clarity if `N > 12`).

The current month is **not** filtered out specifically — the user controls the window via the page toggle, so trust their selection. Note: if the most recent bucket is the in-progress current calendar month, the comparison may understate; that's an acceptable tradeoff for a single unified toggle.

### Data source

Reuse the existing `rows` already fetched in `Trends`. For each category bucket (`bucketName(r)`):

1. Build a `series: number[]` of length `buckets.length` honoring `showRaw` (same pattern as the bar chart and treemap, via `effectiveMonthlyContribution`).
2. `current = series[last]`, `baseline = mean(series[0 .. last-1])`.
3. `delta% = (current - baseline) / baseline * 100` (guard `baseline === 0` → `null`).
4. `avg = mean(series)` for the "avg $X / mo" line.

Respects `showRaw`. Respects the page's account filter (already baked into `rows`). Ignores the per-category dropdown.

### Sorting

Sort by `Math.abs(delta%)` descending. Rows with `null` delta sink to the bottom.

### Filter pills

Three pill toggles above the list, styled to match the existing range-pill (rounded-full, `bg-muted/30` track, active = `bg-background shadow-sm`):

- **All** (default)
- **Increasing** — `delta > +8%`
- **Decreasing** — `delta < -8%`

Sorting by `|delta|` still applies inside each filter.

### Row layout

Self-contained card (`rounded-xl border border-border/60 px-4 py-3`), 4 columns left → right (flex, items-center):

```
[●]  [Name + avg muted]                       [$ current + badge]   [sparkline 90×44]
 8       1fr                                          auto                  auto
```

- **Color dot**: 8px, `PALETTE[categoryOrder.indexOf(name)]` (matches bar chart / treemap). Falls back to `NEUTRAL`.
- **Name**: `text-[13px] font-semibold`. Below: `text-xs text-muted-foreground` `avg $X / mo`.
- **Current**: right-aligned `text-sm font-semibold tabular-nums`. Badge below it, right-aligned.
- **Sparkline**: Recharts `<LineChart>` in fixed `w-[90px] h-[44px]` container. No axes/grid/tooltip. `type="monotone"`, stroke 1.5px. Custom `dot` callback returns a filled `<circle>` only for the last index. Stroke color matches badge state.

### Badge thresholds

| Δ% | Badge |
|---|---|
| `> +8%` | red (`bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300`), `+X% vs avg` |
| `< -8%` | green (`bg-emerald-100 text-emerald-700` …), `-X% vs avg` |
| within ±8% | neutral (`bg-muted text-muted-foreground`), `~stable` |
| baseline = 0 | neutral, `new` |

Sparkline stroke uses red / green / gray correspondingly.

### Click behavior

No category detail route exists. Render rows as non-interactive `<div>` for now. Leave `// TODO: link to category detail when implemented` comment.

### Empty / loading

- Loading: `"Loading…"` placeholder, ~120px tall.
- `buckets.length < 2` or no qualifying categories: section header + single muted line "Not enough history yet."

### Implementation notes (technical)

- New child component `CategoryTrends` in `src/pages/Trends.tsx` (mirroring `CategoryTreemap`), props: `{ rows: Row[]; buckets: string[]; showRaw: boolean; categoryOrder: string[] }`.
- One `useMemo` builds `Array<{ name; series:number[]; current; baseline; avg; delta:number|null }>`, then filtered + sorted.
- Local `useState<"all"|"up"|"down">("all")` for the filter pills.
- `LineChart`, `Line` added to existing recharts import.

### Out of scope

- No changes to bar chart, treemap, breakdown, filter bar, or stats row.
- No new routes or category detail page.
- No DB changes.
