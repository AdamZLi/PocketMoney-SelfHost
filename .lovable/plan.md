## Goal

Reduce the "AI scan & review" dialog to a near-one-click experience. Most users should see one meaningful choice — **which month** — with clear signal about how much work is left in each.

## New dialog layout

```
┌───────────────────────────────────────────┐
│  AI scan & review                      ✕  │
│  Pick a month. We'll review every         │
│  transaction you haven't checked yet.     │
│                                           │
│  Month                                    │
│  ┌─────────────────────────────────────┐  │
│  │ March 2026  · 42 left (88%)      ▾ │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  ▸ Advanced filters                       │
│                                           │
│                                           │
│            [ Cancel ]  [ ✦ Preview ]      │
└───────────────────────────────────────────┘
```

### Month dropdown (the one decision)

Each option shows the month plus how much is unreviewed, sorted by most-unreviewed first so the user's likely target is at the top:

- `March 2026 · 42 left (88%)`
- `February 2026 · 6 left (12%)`
- `January 2026 · All reviewed` (greyed, still selectable)

Compute counts client-side from the already-loaded `txns` array (group by `YYYY-MM`, count where `reviewed_at` is null vs total). No new query needed.

Default selection = the most recent month that still has unreviewed transactions. If none, default to the most recent month overall.

### Removed from the default view

- **Reviewed** dropdown — hard-coded to `unreviewed`. (Keep the state variable; just don't render the control.)
- **Account** dropdown — moved into Advanced.
- **Category** dropdown — moved into Advanced.

### Advanced filters (collapsed by default)

A single `<Collapsible>` labelled "Advanced filters" containing the existing Account, Category, and Reviewed selects. Closed on open; opening it doesn't change behaviour, just exposes the controls. When any advanced filter is set to a non-default value, show a small badge next to the trigger (e.g. `Advanced filters · 2`) so users don't forget hidden state.

### Result: clicks to launch a scan

Before: open dialog → (skip 3 selects most users don't touch) → pick month → Preview = **2 clicks minimum, often 5**.
After: open dialog → Preview = **1 click** (or 2 if changing month).

## Technical notes

Files: `src/pages/Transactions.tsx` only — pure presentation change in the `scanStage === "configure"` block (lines ~1147–1227).

- Build a `monthStats: { ym, total, unreviewed }[]` from `txns` once inside the IIFE.
- Replace `monthOpts.map(...)` with stat-aware items; format label as `${monthLabel(ym)} · ${unreviewed} left (${pct}%)` or `· All reviewed` when `unreviewed === 0`.
- Sort months by `unreviewed` desc, then date desc.
- On dialog open (`resetScanDialog`), set `scanMonth` to the first month with `unreviewed > 0`, and force `scanReviewed = "unreviewed"`.
- Wrap Account / Category / Reviewed selects in `Collapsible` from `@/components/ui/collapsible` (already in the project). Trigger row uses a chevron + "Advanced filters" + optional count badge.
- No backend / edge-function / data-model changes. `buildScanPreview` and downstream logic untouched.

## Out of scope

- Changing what "unreviewed" means or how rules are applied.
- Visual redesign of the preview/diff stage.
- Any change to the edge function or DB schema.
