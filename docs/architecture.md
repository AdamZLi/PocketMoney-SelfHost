# PocketMoney Architecture

*Last updated: 2025-05-10*
*Updated by: Build Planner Agent*

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  React SPA (Vite + React Router v6)                       │  │
│  │  TanStack Query ← cache / fetch layer                     │  │
│  └──────────────────────┬────────────────────────────────────┘  │
└─────────────────────────┼───────────────────────────────────────┘
                          │ HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Supabase Platform                          │
│                                                                 │
│  ┌──────────────┐    ┌──────────────────────────────────────┐  │
│  │  PostgREST   │◄──►│          PostgreSQL                   │  │
│  │  (REST API)  │    │  tables · enums · RLS policies        │  │
│  └──────────────┘    └──────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Edge Functions (Deno runtime)                            │  │
│  │  ┌─────────────────────┐  ┌────────────────────────────┐ │  │
│  │  │ suggest-categories  │  │ review-transactions        │ │  │
│  │  └────────┬────────────┘  └──────────┬─────────────────┘ │  │
│  └───────────┼──────────────────────────┼───────────────────┘  │
└──────────────┼──────────────────────────┼───────────────────────┘
               │                          │
               ▼                          ▼
      ┌────────────────────────────────────────┐
      │  OpenRouter API → Google Gemini 2.0    │
      │  Flash                                 │
      └────────────────────────────────────────┘
```

## Tech Stack

| Layer      | Technology                                          |
|------------|-----------------------------------------------------|
| Frontend   | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Routing    | React Router v6 (nested under `AppLayout`)          |
| Data fetch | TanStack React Query (no raw `useEffect` fetches)   |
| Backend    | Supabase (PostgREST auto-generated REST API)        |
| Database   | PostgreSQL (hosted by Supabase, RLS enabled)         |
| Edge funcs | Supabase Edge Functions (Deno runtime)               |
| AI         | Google Gemini 2.0 Flash via OpenRouter               |
| Testing    | Vitest + React Testing Library + jsdom               |
| Path alias | `@/*` → `src/*`                                     |

## Data Model

```
┌──────────────────┐       ┌──────────────────┐
│    accounts       │       │    categories     │
│──────────────────│       │──────────────────│
│ id (PK)          │       │ id (PK)          │
│ name             │       │ name             │
│ type (enum)      │       │ parent_id (FK)───┤◄─┐ self-ref
└────────┬─────────┘       └────────┬─────────┘  │
         │                          │             │
         │ account_id (FK)          │ category_id (FK)
         ▼                          ▼
┌──────────────────────────────────────────────────────────┐
│                      transactions                         │
│──────────────────────────────────────────────────────────│
│ id (PK)          │ name              │ amount             │
│ date             │ account_id (FK)───┤ category_id (FK)───┤
│ treatment (enum) │ treatment_meta    │ raw_row (JSONB)    │
│ raw_merchant_name│ source (enum)     │ status (enum)      │
│ review_kind      │ import_batch_id   │ owed_by (FK)───────┤
└──────────┬───────┴───────────────────┴────────────────────┘
           │                                    │
           │ transaction_id (FK)                │ owed_by (FK)
           ▼                                    ▼
┌───────────────────┐  ┌──────────────────┐  ┌─────────────┐
│ transaction_edits │  │ transaction_tags  │  │   people    │
│───────────────────│  │──────────────────│  │─────────────│
│ id (PK)           │  │ transaction_id───┤  │ id (PK)     │
│ transaction_id    │  │ tag_id───────────┤  │ name        │
│ field, old, new   │  └──────────────────┘  └─────────────┘
└───────────────────┘           │
                                ▼
┌──────────────────┐   ┌──────────────────┐
│ agent_feedback   │   │      tags        │
│──────────────────│   │──────────────────│
│ id (PK)          │   │ id (PK)          │
│ transaction_id   │   │ name             │
│ merchant_name    │   └──────────────────┘
│ field            │
│ ai_value/conf    │   ┌──────────────────┐
│ user_action/val  │   │  import_batches  │
└──────────────────┘   │──────────────────│
                       │ id (PK)          │
┌──────────────────┐   │ file_name        │
│ merchant_aliases │   │ row_count        │
│──────────────────│   └──────────────────┘
│ id (PK)          │
│ pattern          │   ┌──────────────────┐
│ match_type       │   │  category_rules  │
│ display_name     │   │──────────────────│
│ priority         │   │ id (PK)          │
│ source           │   │ pattern          │
└──────────────────┘   │ match_type       │
                       │ category_id (FK) │
┌──────────────────┐   │ priority         │
│   plaid_items    │   └──────────────────┘
│──────────────────│
│ id (PK)          │
│ institution_name │
└──────────────────┘
```

**Tables**: accounts, agent_feedback, categories, category_rules, import_batches, merchant_aliases, people, plaid_items, tags, transaction_edits, transaction_tags, transactions (12 tables + 2 junction tables)

**Key enums**: `txn_treatment` (normal | excluded | refundable | reimbursable | amortized | split), `txn_status` (pending | posted), `review_kind` (duplicate | refund_pending | reimbursement_pending), `alias_match_type` / `rule_match_type` (contains | exact | regex)

## Pages

| Route            | Component          | Purpose                                    |
|------------------|--------------------|--------------------------------------------|
| `/`              | `Dashboard.tsx`    | Monthly spending summary, category breakdown|
| `/transactions`  | `Transactions.tsx` | Browse, search, edit, AI review             |
| `/import`        | `Import.tsx`       | CSV/XLSX upload → staging → commit pipeline |
| `/accounts`      | `Accounts.tsx`     | Manage bank accounts                        |
| `/categories`    | `Categories.tsx`   | Category taxonomy editor                    |
| `/aliases`       | `Aliases.tsx`      | Merchant alias rules management             |
| `/trends`        | `Trends.tsx`       | Spending trends over time with treatments   |
| `/review`        | `Review.tsx`       | AI-proposed changes review panel            |
| `*`              | `NotFound.tsx`     | 404 fallback                                |

## Key Data Flows

### Import Pipeline

```
┌────────────┐    ┌───────────┐    ┌────────────────┐    ┌──────────────┐
│ File Upload │───►│ parseFile │───►│ cleanMerchant  │───►│ applyRules   │
│ (CSV/XLSX)  │    │ PapaParse │    │ (alias table)  │    │ (cat. rules) │
└────────────┘    └───────────┘    └────────────────┘    └──────┬───────┘
                                                                │
                  ┌───────────────────────────────────────┐     │
                  │         Staging Table (in-memory)      │◄────┘
                  │  _categorized_by: file|rule|ai|none    │
                  └────────────┬──────────────┬────────────┘
                               │              │
                     ┌─────────▼──────┐  ┌────▼──────────────┐
                     │ Detect dupes   │  │ AI categorization  │
                     │ (findDupGroups)│  │ (suggest-categories│
                     └─────────┬──────┘  │  edge function)    │
                               │         └────┬──────────────┘
                               ▼              ▼
                  ┌───────────────────────────────────────┐
                  │         User Review & Edit             │
                  │  merge/keep/flag dupes, fix categories │
                  └────────────────────┬──────────────────┘
                                       │ Commit
                                       ▼
                  ┌───────────────────────────────────────┐
                  │  INSERT → transactions + agent_feedback│
                  └───────────────────────────────────────┘
```

### Merchant Cleaning

```
  Raw bank string (e.g. "DEBIT PURCHASE APLPAY COSTCO WHC #0482 ISSAQUAH WA")
          │
          ▼
  ┌─────────────────────────┐
  │ 1. Alias match          │  merchant_aliases table (priority-sorted)
  │    exact → contains →   │  First match wins → return display_name
  │    regex                │
  └──────────┬──────────────┘
             │ no match
             ▼
  ┌─────────────────────────┐
  │ 2. Generic normalize    │  Strip prefixes (TST*, SQ*, APLPAY...)
  │    - Remove URLs        │  Remove store #s, ref IDs, corp suffixes
  │    - Remove ref codes   │  Strip trailing CITY ST
  │    - Title-case if      │  Collapse separators
  │      ALL CAPS           │
  └──────────┬──────────────┘
             │
             ▼
  Result: "Costco Whc"
```

### AI Review Loop

```
  ┌──────────────┐     ┌─────────────────────┐     ┌─────────────────┐
  │ Transactions  │────►│ review-transactions  │────►│ Gemini 2.0 Flash│
  │ (batch)       │     │ (Edge Function)      │     │ via OpenRouter   │
  └──────────────┘     └─────────┬───────────┘     └────────┬────────┘
                                 │                          │
                    reads ───────┤    ┌─────────────────────┘
                                 ▼    ▼
                    ┌──────────────────────────┐
                    │ Proposals                 │
                    │ category + treatment +    │
                    │ confidence + reason       │
                    └─────────────┬────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │ User: accept / override   │
                    │ / dismiss                 │
                    └─────────────┬────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │ agent_feedback table      │◄──── read by next
                    │ (field, ai_value,         │      review cycle
                    │  user_action, user_value) │      (learning loop)
                    └──────────────────────────┘
```

## Key Libraries

| File                       | Purpose                                                    |
|----------------------------|------------------------------------------------------------|
| `src/lib/parseFile.ts`     | CSV/XLSX import parsing via PapaParse                      |
| `src/lib/cleanMerchant.ts` | Merchant string normalization using alias table + generics |
| `src/lib/categorize.ts`    | Rule-based categorization (contains/exact/regex matching)  |
| `src/lib/treatments.ts`    | Treatment contribution logic (`effectiveMonthlyContribution()`) |
| `src/lib/dedup.ts`         | Duplicate transaction detection across staged + existing   |
| `src/lib/format.ts`        | Display formatting (`fmtCurrency`, `fmtDate`)             |
| `src/lib/utils.ts`         | General utilities (cn class merger, etc.)                  |
| `src/lib/recleanTransactions.ts` | Bulk re-clean existing transactions with updated aliases |

## Components

### App-Level Components

| Component                    | Purpose                                           |
|------------------------------|---------------------------------------------------|
| `AppLayout.tsx`              | Sidebar layout wrapper for all routes              |
| `NavLink.tsx`                | Sidebar navigation link                            |
| `CategoryCombobox.tsx`       | Category picker with search                        |
| `TreatmentPicker.tsx`        | Treatment enum selector                            |
| `OwedByCombobox.tsx`         | Person picker for reimbursable transactions        |
| `TransactionEditSheet.tsx`   | Slide-out panel for editing a single transaction   |
| `AliasReassignCombobox.tsx`  | Reassign merchant alias from import staging        |
| `MatchedRawNamesPanel.tsx`   | Shows raw bank names matched by an alias pattern   |
| `MerchantNameInput.tsx`      | Merchant name input with alias awareness           |

### UI Primitives (`src/components/ui/`)

shadcn/ui component library — 30+ components including Button, Card, Dialog, Select, Badge, Progress, Command, Popover, Table, Toast, etc.

## Edge Functions

| Function              | Purpose                                        | Called From       |
|-----------------------|------------------------------------------------|-------------------|
| `suggest-categories`  | Batch AI categorization during import (fallback after rule matching) | Import page |
| `review-transactions` | Full review agent: category + treatment + confidence proposals       | Transactions page |

Both require `OPENROUTER_API_KEY` as a Supabase secret.

## Component Hierarchy

```
Dashboard.tsx
  ├── Summary cards (Spent this month, Top category, Categories tracked)
  ├── Spend by parent category (bar chart)
  └── Recent transactions to review
      ├── Checkbox (mark reviewed)
      ├── CategoryCombobox (per row)
      └── TreatmentPicker (per row)

Import.tsx
  ├── File upload card (CSV/XLSX drag-and-drop)
  ├── DupGroupRow (duplicate review — keep all / merge / flag)
  ├── Staging table
  │   ├── Merchant name (click to edit)
  │   ├── AliasReassignCombobox (inline merchant correction)
  │   ├── Source Name column (raw bank string)
  │   ├── Category Select (per row)
  │   └── Drop/Keep toggle
  ├── AI categorize button → progress card
  └── Commit import button

Transactions.tsx
  ├── Filter toolbar (search, date range, month, account, category, treatment, reviewed)
  ├── Transaction list (grouped by date)
  │   ├── Inline rename flow → alias creation prompt
  │   ├── CategoryCombobox (per row)
  │   └── TreatmentPicker (per row)
  ├── Detail panel (slide-over)
  │   ├── MerchantNameInput (autocomplete from alias display names)
  │   ├── CategoryCombobox
  │   ├── TreatmentPicker
  │   └── Raw source name (copy-to-clipboard)
  ├── Alias creation prompt (Dialog — after rename, offers to create rule)
  ├── Add transaction dialog
  └── AI scan dialog (batch review with accept/override/dismiss per proposal)

Aliases.tsx
  ├── Add rule form (sentence-style: "If source name [contains|is exactly] X → display as Y")
  ├── Search filter
  ├── Apply to existing transactions button
  └── Rules table
      ├── Inline-editable pattern + display name
      └── Expandable rows → MatchedRawNamesPanel
          ├── Filter (for >10 names)
          ├── Raw name rows (count, copy button)
          └── AliasReassignCombobox + confirmation panel
```

## AI Agent Architecture

### suggest-categories (Import)

| Aspect   | Detail |
|----------|--------|
| Input    | Merchant list (`id`, `name`, `amount`, optional `rule_category_id`) + full category taxonomy |
| Skips    | Merchants that already have a `rule_category_id` (rule-based match) |
| Output   | `{ id, category_id, confidence: "low"│"medium"│"high" }` per merchant |
| Model    | Gemini 2.0 Flash via OpenRouter (`openrouter/free`) |
| Tool     | `assign_categories` — structured tool call, one assignment per merchant |
| Retry    | Exponential backoff on 429 (up to 3 retries) |
| Batch cap| 200 merchants per call |

### review-transactions (Review)

| Aspect   | Detail |
|----------|--------|
| Input    | Transaction batch (`id`, `name`, `amount`, `date`, `account_name`, `current_category_id`, `current_treatment`) + category taxonomy |
| Context  | **agent_feedback** — past corrections where `user_action = 'overridden'`, keyed by normalized merchant name (up to 200 rows). **merchant_history** — category/treatment distribution from reviewed transactions of the same merchant (up to 1000 rows) |
| Output   | Per transaction: `category_id`, `treatment`, `treatment_meta`, `confidence` (0–1), `reason` (≤140 chars), `unverified` flag |
| Tool     | `submit_review` — structured tool call, one proposal per transaction |
| Validation | Drops unknown IDs, duplicates. Caps confidence at 0.40 if `category_id` is null. Cross-checks reason tokens against merchant name — downgrades + flags `unverified` on mismatch |
| Batch cap| 200 transactions per call |

### Learning Loop

```
User accepts/overrides AI proposal
  → INSERT into agent_feedback (field, ai_value, ai_confidence, user_value, user_action)
  → Next review-transactions call reads agent_feedback for matching merchants
  → If past correction conflicts with model output → cap confidence at 0.50
```

The `agent_feedback` table stores: `transaction_id`, `merchant_name` (normalized), `field` (category_id│treatment), `ai_value`, `ai_confidence`, `user_value`, `user_action` (accepted│overridden│dismissed), and `created_at`.

## Merchant Alias Reassignment Flow

```
User expands alias row in Aliases page
  → MatchedRawNamesPanel loads raw_merchant_name values for that display_name
  → User clicks Reassign (⇄) on a specific raw name
    → AliasReassignCombobox opens (search existing aliases or type new name)
    → User selects target display name
    → Fetch affected count: transactions with matching raw_merchant_name
        + pre-feature transactions matched by name (raw_merchant_name IS NULL)
    → Show confirmation: "N transactions will update"
    → User confirms
      → reassignAndCreateRule(rawName, newDisplayName)
        1. Upsert exact-match alias (pattern=rawName, match_type="exact", priority=1000)
        2. UPDATE transactions SET name=newDisplayName WHERE raw_merchant_name=rawName
        3. UPDATE pre-feature transactions SET name=newDisplayName, raw_merchant_name=rawName
           WHERE name=rawName AND raw_merchant_name IS NULL
      → Invalidate caches: matched_raw_names, merchant_aliases, transactions
      → Toast: "Reassigned 'X' → 'Y'. N transactions updated."
```

## React Query Cache Keys

| Key | Data | Invalidated by |
|-----|------|----------------|
| `["txns", {filters…}]` | Filtered transaction list | Transaction edits, imports, rename, reassign, review |
| `["txns", "month", date]` | Dashboard monthly transactions | Transaction edits, treatment changes, review |
| `["txns", "recent-to-review"]` | Dashboard unreviewed list | Transaction edits, review toggle |
| `["txns", "review-count"]` | Unreviewed count badge | AI scan accept/dismiss |
| `["txns", "month-review-summary"]` | Monthly review progress | Batch review, inline review |
| `["categories"]` | Category taxonomy | Category CRUD, import (auto-create) |
| `["categories", "full"]` | Categories with rule counts | Category CRUD |
| `["categories", "usage"]` | Category usage counts | Transaction edits, AI review |
| `["rules"]` | Category rules | Rule CRUD, alias-triggered re-categorization |
| `["merchant_aliases"]` | All alias rules | Alias CRUD, reassign |
| `["merchant_aliases_combobox"]` | Alias display names (import) | — (static during import) |
| `["merchant_aliases_list"]` | Alias list (reassign panel) | — (fetched on demand) |
| `["matched_raw_names", name]` | Raw names for one alias | Reassign |
| `["alias_display_names"]` | Autocomplete for MerchantNameInput | — |
| `["accounts"]` | Account list | Account CRUD, import |
| `["accounts", "full"]` | Accounts with metadata | Account CRUD |
| `["people"]` | People list (owed_by) | Person CRUD |
| `["review", …]` | Review page sections | Treatment changes, settle/receive actions |
| `["trends", "monthly", …]` | Trend chart data | Treatment/category edits on Trends page |
| `["txn-edit", id]` | Single transaction (edit sheet) | Save from edit sheet |
| `["txn-min-date"]` | Earliest transaction date (Trends) | — |

## Client-Side State Patterns

- **Server state**: TanStack React Query for all Supabase data. No raw `useEffect` fetch patterns anywhere.
- **UI state**: `useState` for filters, expanded rows, editing targets, form drafts, dialog open/close.
- **Cache invalidation**: `qc.invalidateQueries({ queryKey: [...] })` after every mutation. Broad prefix invalidation (e.g., `["txns"]`) is common to cover all filtered variants.
- **Optimistic updates**: None — all mutations await the server response before updating UI.
- **Derived state**: `useMemo` for filtered/sorted/grouped lists (e.g., filtered aliases, date-grouped transactions, dup group directives).
- **URL state**: Search params for deep-linking (e.g., `?edit=<id>` opens detail panel on Transactions page).

## Recent Changes

- 2025-05-10: Added `raw_merchant_name` column to transactions, `MatchedRawNamesPanel`, `AliasReassignCombobox`, `MerchantNameInput` components
- 2025-05-05: Created `agent_feedback` table with RLS policies and merchant/created indexes
