## Answer first

The earlier change applies to **every** merchant during import — not just those two. `cleanMerchant()` runs on every row in `parseFile.ts` and uses generic rules (strip processor prefixes like `TST*`/`SQ *`, drop store numbers `#13078`, drop reference IDs like `P730740576`, drop URLs, title-case ALL-CAPS) plus a small hard-coded brand map (Walgreens, LinkedIn, Amazon, Uber, etc.).

Two gaps to close:
1. The brand map is baked into code — you can't edit it.
2. Cleaning happens at parse time only, so already-imported transactions keep their messy names, and there's no way to teach the system a new alias.

## Plan

### 1. New `merchant_aliases` table

User-managed mapping from a pattern (substring or regex, case-insensitive) to a clean display name, with priority for tie-breaking.

```text
merchant_aliases
  id, pattern, match_type (contains|exact|regex),
  display_name, priority, source (user|seed),
  created_at, updated_at
```

Seed it with the brands currently hardcoded in `cleanMerchant.ts` (`source = 'seed'`) so users can edit/disable them.

### 2. Refactored cleaner (`src/lib/cleanMerchant.ts`)

Pipeline applied to every raw merchant string:

1. **Alias lookup** — check `merchant_aliases` (highest priority match wins). If hit → return `display_name`.
2. **Generic normalization** (when no alias matches):
   - Strip processor/channel prefixes: `TST*`, `SQ *`, `SP *`, `PAYPAL *`, `PP*`, `IN *`, `POS`, `DEBIT`, `CHECKCARD`, `RECURRING`, `PURCHASE`
   - Strip URLs / domains (`HELP.UBER.COM`, `AMAZON.COM`)
   - Strip store/location codes: `#13078`, `STORE 1234`, trailing 4+ digit runs
   - Strip reference IDs: `P730740576`, `*A12B3`, long alnum tokens (8+ chars mixed letters+digits)
   - Strip trailing `CITY ST` (2-letter state) and corporate suffixes (`LLC`, `INC`, `CORP`)
   - Collapse separators (`*`, `_`, multiple spaces)
   - Title-case if input is ALL CAPS; preserve mixed-case input (so "LinkedIn" stays "LinkedIn")
3. **Fallback** — if normalization empties the string, return original trimmed.

Cleaner is async and accepts a preloaded alias list so it can run in batches without re-querying per row.

### 3. Apply during import (existing behavior, improved)

`parseFile.ts` will load aliases once per import and pass them into `normalizeRow`. Same as today, but driven by the editable table.

### 4. New page: `/aliases` (Merchant Aliases editor)

CRUD UI similar to `Categories.tsx`:
- List of aliases (pattern, type, display name, priority, source, edit/delete)
- Add new alias form
- "Test" input box: type a raw merchant string, see what it cleans to in real time
- "Apply to existing transactions" button — runs the cleaner across all `transactions.name` values and updates rows whose cleaned name differs (logged to `transaction_edits` so the audit trail captures it)

Add a sidebar entry in `AppLayout` for "Aliases".

### 5. Quick-add from Transactions page

On the transactions list, add a small "Clean as…" action in the row menu so when you spot a messy name you can one-click create an alias mapping `raw → your chosen display name` and re-run the cleaner.

### 6. Tests / docs

- Unit tests in `src/lib/__tests__/cleanMerchant.test.ts` covering: prefixes, store numbers, ref IDs, URLs, mixed-case preservation, alias override.
- Update `docs/PRD.md` (`FR-CAT` → add `FR-MERCH` section) and `docs/TEST_SPEC.md` regression suite.

## Technical details

- Alias matching uses a single pre-sorted (by priority desc) array; first match wins. Regex patterns are compiled once with `new RegExp(pattern, 'i')` inside a try/catch (invalid regex disables that row with a warning in the editor).
- "Apply to existing" runs client-side in batches of 500 with `supabase.from('transactions').update({name}).eq('id', id)` — small dataset, no edge function needed for Phase 1.
- RLS: same `phase1_open_all` permissive policy as other tables (will tighten in Phase 1.5 with auth).
- No schema changes to `transactions` — only the `name` column gets rewritten in place; `raw_row` JSONB still holds the original.
