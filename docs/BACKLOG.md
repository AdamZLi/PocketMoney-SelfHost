# Product Backlog

> Phase 1 items are tracked in `PRD.md`. This file tracks Phase 1.5 and beyond.

## Phase 1.5 — Auth, Bank Connections, Auto-Learning

### Authentication
- Email/password + Google login (Lovable Cloud)
- Add `user_id UUID` to all tables; migrate existing data to first user
- Replace permissive RLS policies with `auth.uid() = user_id`
- Auth pages: `/auth/login`, `/auth/signup`, `/auth/reset-password`

### Plaid (Bank Connections)
- Plaid Link integration: link token → public token exchange
- Edge functions: `plaid-link-token`, `plaid-exchange-token`, `plaid-sync`
- Cursor-based incremental sync (manual button + scheduled)
- Auto-create accounts from Plaid into existing `accounts` table (institution + mask)
- Securely store `plaid_items.access_token` (server-only access via stricter RLS)
- Manual + automated sync trigger; show last-synced timestamp per item

### Auto-Learning Categorization & Tagging
- Mine `transaction_edits` for patterns:
  - merchant → category
  - merchant → tag
  - amount-range + merchant → category
- Auto-promote high-confidence patterns into `category_rules` (source = `learned`)
- Suggest tags on new transactions based on past behavior
  - Confirm-first UX initially; auto-apply above confidence threshold
- "Apply learned rule to past transactions" prompt when a new pattern emerges
- Settings page: view, edit, disable learned rules

## Phase 2 — Visualizations
- Trend charts (monthly spend, by category, by account)
- Top-N merchants
- Recurring transaction detection
- Anomaly highlights
- Budgets per category with progress bars

## Phase 3 — Cash Flow
- Income vs. expenses over time
- Net cash flow projections
- Recurring bills calendar

## Phase 4 — Investments & Assets
- Manual holdings + valuations
- Plaid Investments integration
- Net worth dashboard combining all phases

---

Each backlog item gets FR-IDs assigned in `PRD.md` when promoted into the next active phase.
