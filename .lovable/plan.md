## Personal Finance App — Phase 1 + Specs & Backlog

In addition to building Phase 1, three living documents will be created in the repo:

- `docs/PRD.md` — functional requirements (PM spec)
- `docs/TEST_SPEC.md` — test suites to run after each major upgrade
- `docs/BACKLOG.md` — product backlog for Phase 1.5+

---

## Phase 1 — Expenditures (build now)

### Data model (Lovable Cloud)

Mirrors your sample CSV columns:

- **accounts** — id, name, mask, type (credit_card, debit, checking, savings, cash), institution, plaid_account_id, plaid_item_id, is_active
- **categories** — id, name, parent_category, color, icon
- **tags** — id, name
- **transaction_tags** — transaction_id, tag_id
- **category_rules** — id, category_id, match_type, pattern, priority, source (user/seed/learned)
- **transactions** — id, date, name, amount, status, category_id, account_id, excluded, type, note, recurring, source, import_batch_id, plaid_transaction_id (unique), raw_row (jsonb), created_at, updated_at
- **transaction_edits** — id, transaction_id, field_changed, old_value, new_value, changed_at  *(audit log feeding Phase 1.5 auto-learning)*
- **import_batches** — id, filename, file_type, status, total_rows, imported_rows, created_at
- **plaid_items** — *(Phase 1.5 placeholder)*

Seed categories from your CSV's parent → child structure (Food & Drink → Groceries/Restaurants, Car & Transport → Transportation, Shopping → Shops, Household → Home), plus Bills, Entertainment, Health, Travel, Subscriptions, Income, Transfers, Other.

### Import pipeline
1. Upload CSV / XLSX / PDF
2. Parse (papaparse / SheetJS in-browser; PDFs via edge function + Lovable AI)
3. Normalize + dedupe (date + name + amount + account+mask + status); auto-create accounts found in the file
4. Categorize: trust file's category if present → rules → AI fallback (`google/gemini-3-flash-preview` w/ tool calling)
5. Review screen (editable; "create rule from merchant"); user edits log to `transaction_edits`
6. Bulk insert linked to import batch

### App structure
- `/` Dashboard, `/transactions`, `/import`, `/accounts`, `/categories`

### Phase 1.5 readiness baked in
Plaid columns on accounts/transactions, `transaction_edits` audit table, single normalize+categorize+upsert path used by both imports and (future) Plaid sync, single-user now but RLS-ready for `user_id` migration.

---

## Deliverable: `docs/PRD.md` (Functional Requirements)

Sections:

1. **Overview & goals** — personal finance tracking, phased roadmap
2. **Personas** — single user (Phase 1), authenticated multi-source user (Phase 1.5+)
3. **Phase 1 functional requirements** (each with FR-ID for traceability):
   - FR-IM-* Import: file types accepted, schema auto-detection, account auto-creation, dedupe rules, error handling, batch review/cancel
   - FR-CAT-* Categorization: seed taxonomy, rule precedence (file > user rule > seed rule > AI), AI fallback contract, confidence thresholds for review flag
   - FR-TX-* Transactions: list/filter/sort/search, inline edit, bulk edit, exclude toggle, tag management, edit audit logging
   - FR-ACC-* Accounts: CRUD, mask handling, account type validation, soft-delete (preserve history)
   - FR-CATM-* Category management: CRUD, parent/child, color/icon, rule CRUD
   - FR-DASH-* Dashboard: month-to-date totals, by parent category, recent activity, excluded handling
   - FR-DATA-* Data: schema mirrors sample CSV; all imports preserve `raw_row`
4. **Non-functional requirements** — performance (3k rows < 2s render), accessibility (keyboard nav, ARIA), data safety (no destructive ops without confirm)
5. **Roadmap & out-of-scope** — explicit Phase 1.5+ items
6. **Acceptance criteria** — Given/When/Then per FR-ID, used directly by TEST_SPEC

---

## Deliverable: `docs/TEST_SPEC.md` (Regression Test Suites)

Organized as suites to run after each major upgrade. Implemented progressively as features are built.

**Tooling**: Vitest + @testing-library/react (already configured); MSW for Supabase/edge mocks; small fixture CSV/XLSX/PDF files in `src/test/fixtures/`.

**Suites**:

1. **Smoke suite** (run after every change, ~30s)
   - App boots, routes render, no console errors
   - Supabase client initialized
2. **Import suite**
   - Parse the provided sample CSV → row count matches
   - Auto-detect schema; auto-create accounts (e.g., "American Express Gold Card / 1007")
   - Dedupe: re-importing same file produces 0 new rows
   - XLSX fixture parses identically to CSV equivalent
   - PDF edge function: mocked AI response → normalized rows
   - Malformed file → user-visible error, no DB writes
3. **Categorization suite**
   - File-provided category trusted; new category created if unseen
   - Rule match beats AI fallback
   - User-defined rule beats seed rule (priority)
   - AI fallback called only for uncategorized rows; low-confidence flagged for review
   - "Create rule from merchant" persists and applies to future rows
4. **Transactions suite**
   - List filter/sort/search across date, account, category, tags, status, excluded
   - Inline edit persists; writes `transaction_edits` row
   - Bulk edit (category/tag/excluded) updates all selected
   - Exclude toggle removes from dashboard totals
5. **Accounts suite**
   - CRUD; mask uniqueness per account name; soft-delete preserves transactions
   - Account type validation
6. **Categories & rules suite**
   - CRUD categories with parent/child
   - Rule CRUD; priority ordering respected
   - Deleting category in use prompts reassignment
7. **Dashboard suite**
   - MTD totals match seeded fixture
   - Excluded txns omitted; pending vs posted handled per spec
8. **Schema/migration suite**
   - DB schema snapshot test (fails on unexpected drift)
   - Required columns for Phase 1.5 (`plaid_*`, `transaction_edits`) exist
9. **Edge function contract suite**
   - `parse-pdf-statement` and `categorize-transactions`: input/output schema validation, 402/429 surfaced as user-friendly errors

**Run policy**:
- Pre-commit/CI: Smoke + unit tests
- Before merging a feature PR: full Phase 1 suite
- Before each release / "major upgrade": all suites + manual checklist (real sample CSV import, dashboard spot-check)

---

## Deliverable: `docs/BACKLOG.md` (Product Backlog)

### Phase 1.5 — Auth, Bank Connections, Auto-Learning
- Email/password + Google login
- `user_id` on all tables; RLS enabled; data migration to first user
- Plaid Link: link/exchange/sync (cursor-based incremental)
- Auto-create accounts from Plaid into existing `accounts` table
- **Auto-learning categorization & tagging**
  - Mine `transaction_edits` for merchant→category, merchant→tag, amount-range→category patterns
  - Auto-promote high-confidence patterns to `category_rules` (source=`learned`)
  - Suggest tags on new txns; auto-apply above confidence threshold
  - "Apply learned rule to past transactions" prompt
  - Settings page to view/edit/disable learned rules

### Phase 2 — Visualizations
Trends, top-N merchants, recurring detection, anomalies, budgets

### Phase 3 — Cash Flow
Income vs. expense, projections, recurring bills calendar

### Phase 4 — Investments & Assets
Manual holdings, Plaid Investments, net worth dashboard

Each backlog item links back to FR-IDs in PRD.md (added when promoted into a phase).

---

### Technical notes
- React + Tailwind + shadcn, tanstack-query, papaparse, SheetJS
- Edge functions: `parse-pdf-statement`, `categorize-transactions`
- Lovable Cloud (DB + transient PDF storage)
- Vitest already configured; MSW added for mocking
