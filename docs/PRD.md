# Personal Finance App — Product Requirements (PRD)

> Living document. Phase 1 is in scope and built; Phase 1.5+ is referenced for design intent.

## 1. Overview & Goals
A personal finance application to track and understand spending, then expand to cash flow and investments. Built in phases, each producing a usable product.

- **Phase 1 (current):** Expenditure tracking with multi-format import and automatic categorization.
- **Phase 1.5:** Authentication, Plaid bank connections, auto-learning categorization & tagging.
- **Phase 2:** Visualizations and budgeting.
- **Phase 3:** Cash flow.
- **Phase 4:** Investments & assets / net worth.

## 2. Personas
- **Phase 1 user:** A single individual using the app locally. No login. Uploads CSV/XLSX/PDF reports from banks and credit cards.
- **Phase 1.5+ user:** Authenticated individual who connects financial institutions directly via Plaid.

## 3. Functional Requirements (Phase 1)

### 3.1 Import (FR-IM-*)
- **FR-IM-1** Accept CSV, XLSX, and PDF uploads.
- **FR-IM-2** Auto-detect the canonical schema (matches the user's sample CSV: `date, name, amount, status, category, parent category, excluded, tags, type, account, account mask, note, recurring`). Custom column mapping UI shown if auto-detect fails.
- **FR-IM-3** Auto-create accounts found in the file (matched by `name + mask`).
- **FR-IM-4** PDFs are parsed by an edge function using Lovable AI, returning normalized rows.
- **FR-IM-5** Dedupe within a batch and against existing rows on `(date, lower(name), amount, account_id, status)`.
- **FR-IM-6** Show a Review screen after parse: editable rows, proposed categories, ability to drop or modify rows before commit.
- **FR-IM-7** On confirm, bulk insert linked to an `import_batch` record.
- **FR-IM-8** Malformed file / parse error must be surfaced clearly with no partial DB writes.

### 3.2 Categorization (FR-CAT-*)
- **FR-CAT-1** Seed taxonomy mirrors the user's sample CSV's parent → child structure plus standard categories.
- **FR-CAT-2** Precedence: file's category (if present) > user rule > seed rule > AI fallback.
- **FR-CAT-3** AI fallback uses OpenRouter `openrouter/free` with tool calling, returning `{category, confidence}` for each uncategorized row.
- **FR-CAT-4** Rows with confidence < 0.6 are flagged for user review.
- **FR-CAT-5** "Create rule from merchant" persists a `category_rules` row (source = `user`, priority = 10) when user overrides a category.

### 3.3 Transactions (FR-TX-*)
- **FR-TX-1** Searchable, filterable, sortable list (by date range, account, category, status, tags, excluded).
- **FR-TX-2** Inline edit of category, account, excluded, note, tags.
- **FR-TX-3** Bulk edit (category / excluded / add tag) on selected rows.
- **FR-TX-4** Excluded transactions are omitted from dashboard totals but visible in the list.
- **FR-TX-5** Every user edit writes one `transaction_edits` row (per field) for Phase 1.5 auto-learning.

### 3.4 Accounts (FR-ACC-*)
- **FR-ACC-1** CRUD: name, mask, type, institution.
- **FR-ACC-2** `(name, mask)` is unique.
- **FR-ACC-3** Soft-delete via `is_active = false` (preserve transactions).

### 3.5 Categories & Rules (FR-CATM-*)
- **FR-CATM-1** CRUD categories with parent_category, color, icon.
- **FR-CATM-2** CRUD rules with match_type (contains/equals/regex), pattern, priority.
- **FR-CATM-3** Deleting a category in use prompts reassignment.

### 3.6 Dashboard (FR-DASH-*)
- **FR-DASH-1** Month-to-date total spend (excluded txns omitted).
- **FR-DASH-2** Spend by parent category (current month).
- **FR-DASH-3** Recent transactions (last 10).

### 3.7 Data (FR-DATA-*)
- **FR-DATA-1** Schema mirrors the user's CSV.
- **FR-DATA-2** Every imported row preserves the original payload in `raw_row` (jsonb).
- **FR-DATA-3** `transactions.plaid_transaction_id` and `accounts.plaid_account_id` exist now to allow Phase 1.5 wiring without migration.

## 4. Non-Functional Requirements
- **Performance:** 3,000-row transaction list renders in < 2s.
- **Accessibility:** Keyboard nav for tables; ARIA labels on interactive elements.
- **Data safety:** Destructive actions (delete account/category, drop import batch) require confirmation.

## 5. Out of Scope (Phase 1)
Charts beyond simple totals, cash flow, investments, multi-currency, Plaid, auth, auto-learning. See `BACKLOG.md`.

## 6. Acceptance Criteria
Each FR-ID maps to one or more test cases in `TEST_SPEC.md`.
