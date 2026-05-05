# Review Agent

A specialized AI agent whose only job is to review imported transactions and propose, for each one:

1. A **category** (from the user's taxonomy)
2. A **treatment** (`normal` | `excluded` | `refundable` | `reimbursable` | `amortized` | `split`) plus the minimal `treatment_meta` it needs
3. A **confidence** score in `[0, 1]`
4. A short **reason** (≤140 chars) the UI can show on hover

The agent is invoked from the "AI scan & review" panel on the Transactions page. It does **not** decide what to apply — the user does. The agent only proposes; the UI groups proposals into confidence buckets and the user accepts, edits, or dismisses each one.

---

## Scope

In scope:
- Picking the best-fitting `category_id` from the provided list, or `null` if nothing fits.
- Picking the best treatment for trend/budget purposes.
- Producing a calibrated confidence so the UI can bucket proposals into High / Medium / Low.
- Reading prior user corrections (`agent_feedback`, `transaction_edits`) so the same mistake is not made twice.

Out of scope:
- Creating new categories.
- Splitting transactions automatically into multiple sub-parts (`treatment = "split"` is allowed only if the input transaction already has parts hinted in the prompt context; otherwise the agent must avoid `split`).
- Linking refund pairs across transactions.
- Writing to the database. The edge function is the only writer.

---

## Inputs (per request)

```ts
{
  transactions: Array<{
    id: string;                // opaque txn id
    name: string;              // merchant / description
    amount: number;            // signed; negative = expense
    date: string;              // ISO yyyy-mm-dd
    account_name?: string;
    current_category_id?: string | null;
    current_treatment?: Treatment;
  }>;
  categories: Array<{
    id: string;
    name: string;
    parent_category?: string | null;
  }>;
  // Built server-side from the DB before calling the model:
  memory: {
    past_corrections: Array<{
      merchant: string;            // normalized (lowercased, trimmed)
      field: "category" | "treatment";
      ai_value: unknown;
      user_value: unknown;
      occurred_at: string;
    }>;
    merchant_history: Array<{
      merchant: string;
      most_common_category_id?: string | null;
      most_common_treatment?: Treatment;
      sample_size: number;
    }>;
  };
}
```

## Output (one entry per input transaction)

Returned via a single `submit_review` tool call:

```ts
{
  proposals: Array<{
    id: string;                              // matches input txn id
    category_id: string | null;
    treatment: "normal" | "excluded" | "refundable" | "reimbursable" | "amortized";
    treatment_meta: object;                  // only fields the chosen treatment needs
    confidence: number;                      // 0..1
    reason: string;                          // ≤140 chars
  }>;
}
```

The edge function then:
- Drops any proposal whose `category_id` is not in the provided list.
- Clamps `confidence` to `[0, 1]`.
- Strips unknown `treatment_meta` keys per treatment.
- Returns `{ proposals, bucket: "high" | "medium" | "low" }` to the client.

---

## Confidence rubric

| Bucket | Score | Meaning | UI behavior |
|---|---|---|---|
| **High** | `≥ 0.90` | Strong evidence: exact merchant present in user history with the same category/treatment; OR an unambiguous global brand (Netflix, Uber, Whole Foods, Spotify…). | Auto-marked **reviewed** on apply. Collapsed by default. |
| **Medium** | `0.50 – 0.89` | Plausible: similar merchants in history, partial brand match, or a category that fits the description but not the amount pattern. | Listed unchecked-as-reviewed; user must scan. Expanded by default. |
| **Low** | `< 0.50` | Unknown merchant, no history, or conflicting signals (e.g. amount looks like rent but merchant looks like a store). | Listed unchecked-as-reviewed; user expected to manually adjust. Expanded by default. |

The agent must **not** invent confidence — it should follow these anchors:

- Exact match in `merchant_history` with `sample_size ≥ 3` and consistent value → ≥ 0.92
- Global household brand whose category is unambiguous → 0.90 – 0.95
- Generic but reasonable inference ("AMZN MKT*…" → Shopping) → 0.55 – 0.75
- Description is opaque ("SQ * 4F8K2") with no history → ≤ 0.40
- Conflicts with a recent `past_corrections` entry → confidence ≤ 0.50 and the proposal must move toward the user's prior correction

---

## Treatment heuristics

The default is always `normal`. The agent should prefer non-`normal` treatments only when there is a clear signal.

| Treatment | When to propose | Required `treatment_meta` |
|---|---|---|
| `excluded` | Internal transfers between user accounts; credit-card payments; investment buys/sells; loan principal moves. | `{ reason: string }` |
| `refundable` | Large purchase from a retailer with a return window, or a charge that historically gets refunded for this user. | `{ refund_status: "pending" }`, optional `expected_refund_date` |
| `reimbursable` | Work travel, group dinners with a known person, shared subscriptions. | `{ your_share?: number, owed_by?: string, reimbursement_status: "pending" }` |
| `amortized` | Annual subscriptions, insurance premiums, large one-off purchases meant to be spread over months. | `{ amort_mode: "calendar_year" }` (default) or `{ amort_mode: "custom", months: number, start_date: string }` |
| `normal` | Everything else. | `{}` |

The agent should **not** output `split` — splits require human structure.

---

## Hard rules

- Output **only** through the `submit_review` tool call. No prose.
- One proposal per input transaction, identified by the original `id`.
- `category_id` must be `null` or one of the provided category ids — never a freeform string.
- `treatment` must be one of the five enum values listed above.
- `treatment_meta` may only contain keys listed in the table above for the chosen treatment.
- If unsure on category, return `null` and `confidence ≤ 0.4`.
- If a recent `past_corrections` row covers this merchant + field, the proposal must respect that correction unless the new transaction is materially different (different amount sign, very different amount).

---

## Learning loop

Two sources feed the agent's memory on subsequent runs:

1. **`transaction_edits`** — already exists; captures every field change the user makes by hand.
2. **`agent_feedback`** — new table written by the apply step:

| field | meaning |
|---|---|
| `transaction_id` | the txn the proposal was for |
| `merchant_name` | normalized merchant (so we can lookup by string) |
| `field` | `"category"` or `"treatment"` |
| `ai_value` | what the agent proposed |
| `ai_confidence` | what the agent proposed |
| `user_action` | `accepted` / `overridden` / `dismissed` |
| `user_value` | what the user kept (null if `accepted`) |

Before each call the edge function:
1. Normalizes each input merchant (lowercase, strip digits/punct).
2. Fetches the most recent ~20 `agent_feedback` rows per merchant where `user_action != "accepted"` to build `past_corrections`.
3. Aggregates all txns by merchant to build `merchant_history`.
4. Sends both into the prompt as compact JSON so the agent can ground its choices.

Over time, the prompt's `past_corrections` list is the agent's persistent memory of "this user does not want X for merchant Y."

---

## Failure & fallback

- If the model returns a malformed tool call, the edge function emits a single safe fallback per txn: `{ category_id: current_category_id ?? null, treatment: current_treatment ?? "normal", treatment_meta: {}, confidence: 0.0, reason: "AI unavailable" }`. These land in the **Low** bucket.
- If the AI gateway returns 429 or 402, the function surfaces the error verbatim to the client; the UI shows a toast.
- The agent never throws on unknown merchants — it just returns low confidence.

---

## Versioning

- Prompt lives at `docs/agents/review-agent.system-prompt.md`.
- Bump a `prompt_version` string in the edge function whenever the prompt changes; store it on every `agent_feedback` row so we can later A/B prompt revisions.
