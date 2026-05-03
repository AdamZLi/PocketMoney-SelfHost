# Test Specification

Regression test suites for the Personal Finance App. Run after each major upgrade.

## Tooling
- Vitest + @testing-library/react (configured in `vitest.config.ts`)
- Mock Supabase client and edge function responses
- Fixture files in `src/test/fixtures/` (sample CSV, XLSX, PDF)

## Run Policy
| Trigger | Suites |
|---|---|
| Pre-commit / CI | Smoke + Unit |
| Feature PR merge | Full Phase 1 |
| Major release / phase upgrade | All suites + manual checklist |

## Suites

### S1. Smoke (~30s)
- App boots, all routes render without console errors
- Supabase client initialized
- Dashboard loads with empty state
- **FR coverage:** baseline

### S2. Import
- Sample CSV parses to expected row count
- Schema auto-detected; account "American Express Gold Card / 1007" auto-created (FR-IM-2, FR-IM-3)
- Re-importing the same file produces 0 new rows (FR-IM-5)
- XLSX fixture parses identically to CSV equivalent (FR-IM-1)
- PDF edge function returns normalized rows from mocked AI response (FR-IM-4)
- Malformed file → user error; no DB writes (FR-IM-8)
- Review screen edits applied on confirm (FR-IM-6, FR-IM-7)

### S3. Categorization
- File-provided category trusted; new category auto-created (FR-CAT-2)
- Rule match beats AI fallback (FR-CAT-2)
- User rule (priority 10) beats seed rule (priority 50) (FR-CAT-2)
- AI fallback only invoked for uncategorized rows; low-confidence flagged (FR-CAT-3, FR-CAT-4)
- "Create rule from merchant" persists & applies to subsequent rows (FR-CAT-5)

### S4. Transactions
- Filter/sort/search by all supported fields (FR-TX-1)
- Inline edit persists; writes `transaction_edits` row (FR-TX-2, FR-TX-5)
- Bulk edit updates all selected rows (FR-TX-3)
- Excluded txn removed from dashboard totals but visible in list (FR-TX-4)

### S5. Accounts
- CRUD; `(name, mask)` uniqueness enforced (FR-ACC-1, FR-ACC-2)
- Soft-delete preserves transactions (FR-ACC-3)

### S6. Categories & Rules
- CRUD categories with parent/child (FR-CATM-1)
- Rule CRUD; priority order respected (FR-CATM-2)
- Deleting in-use category prompts reassignment (FR-CATM-3)

### S7. Dashboard
- MTD totals match seeded fixture (FR-DASH-1)
- Excluded omitted, by-parent-category sums correct (FR-DASH-2)
- Recent 10 ordered correctly (FR-DASH-3)

### S8. Schema / Migration Guard
- DB schema snapshot — fails on unexpected drift
- Phase 1.5 columns present: `accounts.plaid_account_id`, `transactions.plaid_transaction_id`, `transaction_edits` table (FR-DATA-3)

### S9. Edge Function Contracts
- `parse-pdf-statement`: input/output schema validation
- `categorize-transactions`: schema + 402/429 surfaced as user-friendly errors

## Manual Pre-Release Checklist
- [ ] Import the user's real sample CSV — row count, accounts, and totals look right
- [ ] Spot-check 5 randomly chosen transactions' categories
- [ ] Dashboard MTD vs hand calculation
- [ ] Create a rule from a merchant; re-import; verify rule applied
- [ ] Lighthouse a11y score ≥ 90 on `/transactions`
