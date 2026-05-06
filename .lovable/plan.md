## What you're actually seeing

Two symptoms, **one underlying cause**:

1. The "State Farm" row says **`Insurance → Restaurants`** with the reason *"A&W is a global fast food brand."*
2. Open the same row in the editor: it says **AI proposal · Applied** (i.e. no diff).

These two views read from the same array (`previewItems`) and look up the proposal the same way:

```ts
const proposal = previewItems.find((p) => p.txnId === t.id);
```

If both views agreed on a single proposal, they'd show consistent diffs. They don't — which means **`previewItems` contains more than one entry for the same `txnId`**, and `.find()` returns the first one in each context.

## Why duplicate entries get into `previewItems`

The agent (Gemini, called from `supabase/functions/review-transactions/index.ts`) is asked for "exactly one proposal per input transaction" and we trust the model to honour that. We don't validate. The frontend then iterates the returned `proposals` array and pushes one `PreviewItem` per proposal, with no de-dupe by `txnId`:

```ts
for (const p of proposals) {
  const t = chunk.find((x) => x.id === p.id);
  if (!t) continue;
  …
  items.push({ txnId: t.id, …, reason: p.reason ?? "" });
}
```

So when the model duplicates an id (or hallucinates a reason from a neighbouring row), we faithfully render both — one as a "no change" Insurance verdict, the other as a wrong "Restaurants / A&W" verdict. Different views surface different copies, hence the contradiction.

The same hole also lets through:
- proposals whose `id` doesn't exist in the input batch (model hallucinates a uuid),
- reasons that talk about a totally different merchant than the row's name.

## Proposed systematic fix

Three layers — server hardens, client hardens, UI degrades gracefully.

### 1. Server: validate + dedupe in `review-transactions/index.ts`

After parsing `proposals` from the tool call:

- **Reject unknown ids.** Build `validInputIds = new Set(batch.map(t => t.id))`; drop any `p.id` not in it (today we silently keep them; client filters them out by `chunk.find`, which lets the duplicates survive).
- **De-dupe by id.** If the model returns the same id twice, keep one entry and pick deterministically (e.g. the one with higher confidence, or the one whose `reason` token-overlaps the merchant name).
- **Reason ↔ merchant sanity check.** For each surviving proposal, compare `reason` against the input txn's `name` (and account name): tokenise both, lower-case, strip punctuation. If the reason contains a *brand-like* token (capitalised word ≥ 3 chars, or a word from a small known-brands list) that does not appear in the merchant string, **downgrade `confidence` to ≤ 0.4** and prepend a marker like `"⚠ unverified"` to the reason. This automatically pushes the row from High → Low and forces a human eyeball.
- **Increase logs.** When we drop or downgrade, `console.warn` with both the txn name and the offending reason so we can monitor model drift over time.

### 2. Client: dedupe + prefer the explanatory proposal

In `Transactions.tsx` after collecting `items`, before `setPreviewItems`:

- Group `items` by `txnId`. Where there are duplicates:
  - Prefer the entry whose `reason` mentions a token from `t.name` (avoids the "A&W on State Farm" case).
  - Otherwise prefer the higher-confidence entry that proposes a real change over a "no change" one (so the user sees the actionable copy, not a stale "applied" one).
- Same lookup in the editor and the list now returns the same proposal, so the "Applied" state is always consistent with the diff arrow shown on the row.

### 3. UI: surface uncertainty when the agent is suspect

- In the row's reason line, if the server flagged the proposal as `unverified`, render the row in the **Low confidence** bucket regardless of the model's stated number, and show a small `⚠ Reason may not match merchant — please verify` hint above the diff arrows.
- In the editor's AI-proposal card, when `unverified`, show the same hint and disable the auto-mark-reviewed shortcut until the user explicitly accepts or dismisses it.

### Files we'd touch

- `supabase/functions/review-transactions/index.ts` — id validation, dedupe, reason ↔ merchant check, downgrade rule, structured logs.
- `src/pages/Transactions.tsx` — dedupe in the proposals → `previewItems` loop; thread an `unverified` flag through `PreviewItem`; render the warning in the row + editor card; force unverified items into the Low bucket.
- `docs/agents/review-agent.md` and `docs/agents/review-agent.system-prompt.md` — document the new validation gate and the "reason MUST mention a token from the merchant name" rule (cheap nudge for the model itself).

### Out of scope for this fix

- Switching models, adding a second-pass verification call, or rebuilding the agent harness — keep this surgical.
- Any change to how feedback is stored. The `agent_feedback` writes already key on `merchant_name` from the txn (not from the model), so dedupe there isn't needed.

### Quick verification plan after implementation

1. Re-run "Scan & review" against the same 81 transactions.
2. Confirm State Farm now shows either: (a) a single Insurance verdict with no diff, or (b) a single Restaurants verdict marked `⚠ unverified` and parked in the Low-confidence bucket.
3. Open the row and confirm the editor's AI-proposal card matches the list (no more "Applied" mismatch).
4. Spot-check three other rows with brand names in their merchant string (Venmo, Foodcellar, Con Ed) to ensure they aren't falsely flagged unverified.
