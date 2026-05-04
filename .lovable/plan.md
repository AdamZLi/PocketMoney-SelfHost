# Handling non-recurring expenses

The core idea: add an explicit **treatment** to each transaction that tells trends/budgets *how* to count it, not just *whether*. Today there's only a binary `excluded` flag — that's too blunt for the cases you described.

## The five treatments

| Treatment | What it means | Example | Trend impact |
|---|---|---|---|
| **Normal** | Default, counts in the month it occurred | Groceries | Full amount, that month |
| **Excluded (one-off)** | Real cash out, but not part of "lifestyle spend" | Wedding gift, moving fee | Hidden from trends/budget; visible in transactions |
| **Refundable** | Money you expect back in full | Security deposit | Hidden from trends; tracked in a "Pending refund" pile until matched |
| **Reimbursable / split** | You paid, but someone owes you part or all | Group dinner, work travel | Only your share counts in trends; remainder goes to follow-up pile |
| **Amortize over N months** | Lumpy purchase smoothed across months | Annual flight, hotel | Spread evenly across N months in trends; raw transaction hidden from monthly totals |

Plus a **"refund of …"** link: when a credit hits your account that looks like a refund of an existing charge, auto-detect and propose linking them; the linked pair nets to zero in trends.

## User experience

### A. Tagging a transaction (the main flow)

On any transaction row, next to the category dropdown, a small **"Treatment"** chip:

```text
 Date     Merchant        Category    Treatment        Amount
 Mar 12   United Airlines Travel      [ Normal  ▾ ]    -$840.00
```

Click the chip → a compact popover (not a full dialog) opens with the five options as cards. Pick one → an inline mini-form appears for that treatment's details:

- **Refundable** → one field: "Expected refund date" (optional). Done.
- **Split / reimbursable** → two fields: "Your share" (amount or %) + "Owed by" (free text name). Auto-suggests 50% as a starting point.
- **Amortize** → one field: "Spread over [12] months starting [Mar 2026]". Live preview underneath: "≈ $70/mo Mar 2026 → Feb 2027".
- **Excluded** → optional "Reason" note.

Save → the chip on the row updates to a colored pill: `Refundable · pending`, `Split · $40 of $120`, `Amortized · 12 mo`. The amount in the row is struck through and the **effective monthly amount** is shown beside it in muted text. No page reload, just the row re-renders.

A toast offers: *"Always treat United Airlines as amortized over 12 months? [Yes, remember]"* — same pattern as the existing categorization rule prompt.

### B. Bulk action

Same treatment picker is available from the bulk-edit toolbar that already appears when rows are selected. Useful for tagging an entire trip's worth of transactions at once.

### C. Follow-up pile (the "Review" badge)

The amber **Review** badge in the Transactions toolbar (already there for duplicates) becomes a tabbed drawer when clicked:

```text
 ┌─ Review ───────────────────────────────────────────┐
 │  [ Duplicates 2 ] [ Refunds 3 ] [ Owed to me 4 ]   │
 │                                                     │
 │  Refundable · pending                               │
 │  ──────────────────────────────────────────────     │
 │  Jan 4   Greystar Apartments        $2,400.00       │
 │  "Security deposit"                                 │
 │           [ Mark refunded ] [ Link to txn ] [ ✕ ]   │
 │                                                     │
 │  Feb 18  Airbnb                       $350.00       │
 │           [ Mark refunded ] [ Link to txn ] [ ✕ ]   │
 └─────────────────────────────────────────────────────┘
```

- **Mark refunded / settled** → clears the follow-up flag; if the user picked "Link to txn" first, the two transactions are linked and net to zero.
- **✕** → cancel follow-up (treats as resolved without a linked refund).
- Items older than 30 days get a small "30d+" pill so they're easy to spot.

### D. Refund auto-detection

When a credit (positive amount) lands on import, the existing duplicate-review card on the import page gains a new section:

```text
 ┌─ Possible refunds detected ─────────────────────────┐
 │  Mar 20  Best Buy        +$129.00                   │
 │  Looks like a refund of:                            │
 │   Mar 5  Best Buy        -$129.00 (Electronics)     │
 │  [ Link as refund ] [ Not a refund ]                │
 └─────────────────────────────────────────────────────┘
```

Linking marks the original as `refunded` and they net to zero in trends. Both rows still appear in the transaction log so the audit trail is intact.

For older transactions (already in the DB), a **"Detect refunds"** button on the Transactions page runs the same heuristic over the last 90 days and surfaces a preview-then-apply card (same pattern as the AI scan).

### E. Trends page changes

A subtle legend control above the chart:

```text
 Spending by month            [Show one-off & amortized: ◯ Off]
```

When **off** (default): trends show only normal + your-share + amortized slices. The huge United Airlines spike disappears and instead becomes a quiet $70/mo bump across 12 months.

When **on**: trends show raw amounts so power users can sanity-check.

Hovering a month tooltip shows a breakdown:
```text
 March 2026
 Normal spend       $2,140
 Amortized          $   70   (United Airlines, 1 of 12)
 ─────────────────────────
 Total              $2,210
```

### F. Visual language summary

| State | Where it shows | Style |
|---|---|---|
| Treatment chip | Transaction row | Small pill, neutral when "Normal", colored + icon for others |
| Excluded from trends | Transaction row amount | Strikethrough on raw amount, effective amount shown next to it |
| Follow-up needed | Toolbar badge + row icon | Amber, with count |
| Linked refund | Both rows | Small chain-link icon; clicking jumps to the partner |

## What gets built (technical)

### 1. Schema
- `transactions.treatment` enum: `normal | excluded | refundable | reimbursable | amortized`
- `transactions.treatment_meta` jsonb — per-treatment fields (expected refund, your share, owed by, months, start date, reason)
- `transactions.linked_txn_id` (nullable self-FK) for refund pairs
- `transactions.review_kind` enum on the existing `needs_review` flag: `duplicate | refund_pending | reimbursement_pending` so the follow-up pile is one unified queue
- Migrate existing `excluded = true` → `treatment = 'excluded'`

### 2. Single source of truth for trends
Helper `effectiveMonthlyContribution(txn, monthIso)` in `src/lib/trends.ts`:
- `normal` → full amount in `date`'s month
- `excluded` / `refundable` → 0
- `reimbursable` → `your_share` in that month
- `amortized` → `amount/months` for each month between `start_date` and `start_date + N`
- Linked refund pairs → 0 on both sides

Both Trends and Dashboard import this helper; nothing else touches the rule.

### 3. UI surfaces
- Treatment popover component (reused on row + bulk toolbar)
- Refund-suggestion card on Import + standalone "Detect refunds" preview on Transactions
- Tabbed Review drawer replacing the current single-purpose duplicate filter
- Trends legend toggle + month-breakdown tooltip

### 4. Amortization in SQL is awkward — done client-side in the trends aggregator. Fine for our data sizes.

## What I'd ship first vs. later

**Phase 1 (MVP):** treatments, row-level picker, trends/dashboard rewrite, follow-up tabs with mark-settled.

**Phase 2:** refund auto-detection (import + standalone) and "remember this treatment for merchant" rules.

**Phase 3:** multi-person splits, reminders for stale follow-ups, dashboard widgets for "money owed to you".

## Open questions worth deciding

1. **Amortization direction** — forward only (Jan flight → Jan–Dec), or also backward? Forward is simpler and matches typical budgeting tools.
2. **Refundable visibility in trends** — hide entirely (default) or show as a separate "pending outflow" line until refunded?
3. **Default amortization period** — 12 months or prompt the user every time? I'd default to 12 with one click to change.
