## What's broken

The month dropdown in **AI scan & review** is built from the `txns` query (line 1212), but `txns`:

1. Is **capped at 500 rows** (`.limit(500)` at line 443), and
2. Is **filtered by the user's current page filters** (search, account, category, dateFrom/dateTo, etc.).

So `allMonthOpts` only contains months found in those 500 currently-loaded rows. In the screenshot that's exactly 6 months (Dec 2025 → May 2026), which means `monthOpts.length === allMonthOpts.length` and `hiddenCount === 0` — so the "Show N more months" link is correctly hidden, but for the wrong reason: the older months were never available to count in the first place.

## Fix

There's already a query that has the right data: `monthSummary` (lines 472–501). It paginates through **all** transactions (bypassing the 1000-row cap), and returns `{ month, total, reviewed }` per `YYYY-MM` for the entire dataset, independent of page filters.

In the configure block, replace the `txns`-derived month stats with `monthSummary`:

```ts
const allMonthOpts = monthSummary.map(s => ({
  ym: s.month,
  total: s.total,
  unreviewed: s.total - s.reviewed,
}));
// (already sorted desc by month in the query)
const monthOpts = scanShowAllMonths ? allMonthOpts : allMonthOpts.slice(0, 6);
const hiddenCount = allMonthOpts.length - monthOpts.length;
```

This makes the dropdown show every month that exists in the database, the unreviewed counts match what the user sees on the Review page, and "Show N more months" appears whenever there are more than 6 months of history.

Also apply the same source to `resetScanDialog`'s default-month logic (which currently scans `txns` to pick the most-unreviewed recent month) so the preselected month is correct on first open.

### Files to touch

- `src/pages/Transactions.tsx` only — the configure block (~lines 1209–1224) and `resetScanDialog`.

No backend, query, or data-model changes.
