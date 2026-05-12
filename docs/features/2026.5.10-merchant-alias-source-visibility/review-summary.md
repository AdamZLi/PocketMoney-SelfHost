# Review Summary

**Feature:** Merchant Alias Source Visibility & Exact-Match Rules  
**Spec:** `docs/features/2026.5.10-merchant-alias-source-visibility/spec.md`  
**Design:** `docs/features/2026.5.10-merchant-alias-source-visibility/design.md`

## Problem

Bank transaction names are messy strings like `"Google&Youtubepremium.co/helppay#"`. Today the app pattern-matches them to clean display names, but broad patterns silently swallow unrelated merchants — and the original bank string disappears, making it impossible to audit matches or reconcile with a bank statement.

## Experience

**Before:** Adam imports a CSV. The app quietly maps merchant names using pattern rules. He sees clean names but has no idea what the bank actually sent. If YouTube Premium shows as "Google," he can't tell. Fixing it means creating a new pattern and hoping it doesn't break other matches. Past transactions stay wrong.

**After:** The raw bank string is visible everywhere — during import, on the alias page, and on transactions. Adam can spot mismatches instantly, reassign a raw name to the correct alias in one click, and all past transactions with that string update automatically. Exact-match rules override patterns for specific bank strings.

## Example

> **Example:** Adam imports his Capital One CSV. In the staging table, he sees Source Name `"Google&Youtubepremium.co/helppay#"` matched to "Google." He clicks the merchant cell, selects "YouTube Premium." The row updates. On commit, an exact-match rule is created — next month's import gets it right automatically. He visits the Alias page, expands "Google," and scans matched source names to catch other mismatches.

## Key Decisions

**1. Source Name column always visible on import**
- **Options:** A) Always show B) Toggle to show/hide C) Show only when raw ≠ merchant
- **Decision:** Always show
- **Why:** Visibility is the core feature — hiding it defeats the purpose

**2. Matched source names load lazily**
- **Options:** A) Lazy load on row expand B) Eager load with alias list
- **Decision:** Lazy load on expand
- **Why:** Keeps alias page fast; Adam only inspects a few aliases at a time

**3. Raw names appear under current alias only**
- **Options:** A) Current alias only B) All historically matched aliases
- **Decision:** Current alias only
- **Why:** Adam needs current accuracy, not historical breadcrumbs

**4. Copy-to-clipboard on alias page**
- **Options:** A) Transaction detail only B) Also on alias page matched names
- **Decision:** Both locations
- **Why:** Bank reconciliation shouldn't require navigating to individual transactions

**5. Raw name display length**
- **Options:** A) Always full B) Always truncated C) Context-dependent
- **Decision:** Full on alias page; truncated at 60 chars on import table with tooltip
- **Why:** Alias page is for deep audit; import table is for quick mismatch spotting

**6. Retroactive updates include pre-feature transactions**
- **Options:** A) Only transactions with stored raw names B) Also match older transactions by `name` field
- **Decision:** Match by `name` field and backfill
- **Why:** Maximizes correction coverage for existing data

## Pending Decisions

None — all decisions resolved.
