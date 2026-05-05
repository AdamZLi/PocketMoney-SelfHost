# AI Review Agent — Plan

## Goal

Replace the current "suggest categories" flow with a dedicated **AI Review Agent** that, for each transaction in the scan:

1. Proposes a **category** (from the user's taxonomy)
2. Proposes a **treatment** (`normal`, `excluded`, `refundable`, `reimbursable`, `amortized`) with the meta needed to apply it
3. Returns a **confidence score 0–1** with brief reasoning
4. Learns from the user's accept/reject choices so future suggestions improve

The preview panel groups proposals into **High / Medium / Low** confidence buckets, auto-marks high-confidence items as reviewed, and lets the user one-click expand each bucket to verify or override.

---

## 1. Agent specification (for your review BEFORE implementation)

Two new docs in `docs/agents/`:

### `docs/agents/review-agent.md`

- Mission, scope, inputs/outputs
- Confidence rubric (high ≥0.9, medium 0.5–0.9, low <0.5) with concrete examples
- Treatment decision rules (when to suggest refundable vs reimbursable vs amortized vs normal vs excluded)
- Learning loop: how `transaction_edits` + a new `agent_feedback` table feed back into the prompt
- Failure / fallback behavior (null category, "normal" treatment as safe default)

### `docs/agents/review-agent.system-prompt.md`

The full system prompt the edge function will send. Draft outline:

```text
You are the Review Agent — a specialized personal-finance review assistant.
For each transaction you receive, return:
  - category_id (from the provided taxonomy, or null)
  - treatment ("normal" | "excluded" | "refundable" | "reimbursable" | "amortized")
  - treatment_meta (only the fields the chosen treatment needs)
  - confidence (0..1)
  - reason (≤140 chars, plain language)

Confidence rubric:
  ≥ 0.90  Strong evidence: exact merchant match in user history, or
          unambiguous brand (Netflix, Uber, Whole Foods…). Auto-applies.
  0.50–0.89 Plausible but ambiguous merchant or amount pattern. Needs review.
  < 0.50  Unknown merchant, no history, conflicting signals. Needs review.

Treatment heuristics:
  refundable    — large purchase from retailer with return policy, recent date,
                  user history shows similar pattern returned
  reimbursable  — work travel, group dinners, shared subscriptions
  amortized     — annual subscriptions, insurance premiums, travel, large purchase
  excluded      — internal transfers, credit-card payments, stock buys
  split         — split with friends on group activities, rent, large appliances
  normal        — default

Learning input you receive:
  - past_corrections: list of {merchant, ai_suggested, user_chose, field}
  - user_treatments_history: how often this merchant was given each treatment

Hard rules:
  - Only return category_ids from the provided list.
  - Never invent treatments outside the enum.
  - If unsure on category, return null and confidence ≤ 0.4.
  - Output exactly via the submit_review tool call. No prose.
```

You'll review and edit both files; implementation begins only after sign-off.

---

## 2. Backend — new edge function

`supabase/functions/review-transactions/index.ts`

- Replaces `suggest-categories` for the scan flow (old function kept for backward compat for now).
- Inputs:
  - `transactions`: `{id, name, amount, date, account_id}[]`
  - `categories`: full taxonomy
  - `existing`: per-txn `{category_id, treatment, treatment_meta}` so the agent can decide whether to propose a *change*
- Pulls per-txn context server-side:
  - Recent `transaction_edits` for the same merchant (what the user changed last time)
  - Past treatments distribution for that merchant
  - Recent `agent_feedback` rows (see below)
- Calls Lovable AI Gateway (`google/gemini-3-flash-preview` default; configurable) with a `submit_review` tool whose schema includes `category_id`, `treatment`, `treatment_meta`, `confidence`, `reason`.
- Validates output (enum check, valid category id, treatment_meta fields match the chosen treatment), and clamps confidence.
- Returns `{ proposals: [...], skipped: [...] }`.

### Schema migration

New table `agent_feedback`:


| col            | type                                           |
| -------------- | ---------------------------------------------- |
| id             | uuid pk                                        |
| transaction_id | uuid                                           |
| merchant_name  | text                                           |
| field          | text (`category` or `treatment`)               |
| ai_value       | jsonb                                          |
| ai_confidence  | numeric                                        |
| user_action    | text (`accepted` / `overridden` / `dismissed`) |
| user_value     | jsonb (null if accepted)                       |
| created_at     | timestamptz default now()                      |


Open RLS (matches existing project pattern).

This table is what the agent reads on subsequent runs to "remember" user preferences.

---

## 3. Frontend — preview UI changes

In `src/pages/Transactions.tsx` scan panel, the **preview stage** becomes:

```text
┌─ Preview proposed changes ──────────────────────┐
│ 122 transactions reviewed by AI                 │
│                                                 │
│  ● High confidence   80 items   [auto-marked ✓] │  ← green
│     ▸ Click to expand and verify                │
│                                                 │
│  ● Medium confidence 30 items   [needs review]  │  ← yellow
│     ▾ expanded list of rows shown               │
│        ☐ Trader Joe's   $42  Groceries · normal │
│        ☐ Best Buy      $610  Electronics ·     │
│                              refundable (45d)   │
│                                                 │
│  ● Low confidence    12 items   [needs review]  │  ← red
│     ▾ expanded list                             │
│                                                 │
│  [ Apply 122 changes ]   [ Back ]               │
└─────────────────────────────────────────────────┘
```

- Buckets are collapsible; high-confidence is collapsed by default, medium + low expanded by default.
- Each row shows: merchant, amount, **category change** (`old → new`), **treatment change** (`old → new`), and a one-line AI reason on hover.
- Each row has a checkbox. High-confidence items default checked + `reviewed=true` on apply. Medium/low default checked but `reviewed=false`, so the user is nudged to look at them after.
- Per-row inline edit: click the proposed category or treatment to override before applying.

Bucket colors come from semantic tokens (no hardcoded colors). Plan adds these tokens to `index.css`:

- `--confidence-high` (green family)
- `--confidence-medium` (amber)
- `--confidence-low` (red)
…with matching `bg-*/10` surfaces and `text-*` foregrounds.

---

## 4. Apply step

When the user clicks **Apply**:

For each accepted proposal:

1. Update `transactions` with new `category_id`, `treatment`, `treatment_meta`, and `reviewed = (bucket === "high")`, `reviewed_at = now()`.
2. Insert into `transaction_edits` (existing audit trail).
3. Insert into `agent_feedback` with `user_action = "accepted"` (or `"overridden"` if the user changed the AI value before applying, capturing both `ai_value` and `user_value`).
4. Skipped (unchecked) items get `agent_feedback` with `user_action = "dismissed"`.

This is what closes the learning loop.

---

## 5. Toolbar & wording

- Button label stays **"AI scan & review"**.
- Summary stage shows breakdown: `High 80 · Medium 30 · Low 12 · Overridden 5`.

---

## Technical notes

- New files:
  - `docs/agents/review-agent.md`
  - `docs/agents/review-agent.system-prompt.md`
  - `supabase/functions/review-transactions/index.ts`
- Migration: `agent_feedback` table + open RLS.
- Edited: `src/pages/Transactions.tsx` (scan panel preview + apply), `src/index.css` (confidence tokens), `tailwind.config.ts` (expose tokens).
- `src/lib/treatments.ts` already defines the `Treatment` enum and meta — agent output reuses it directly.
- Old `suggest-categories` function is kept untouched for now; we can delete it in a follow-up once the new flow is verified.

---

## Deliverable order after approval

1. Write `docs/agents/review-agent.md` + `review-agent.system-prompt.md` and **stop for your review**.
2. After you sign off on the agent doc, run the migration, build the edge function, then update the Transactions UI.