# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server on port 8080
npm run build        # Production build
npm run lint         # ESLint check
npm run test         # Run all tests once
npm run test:watch   # Run tests in watch mode
npx vitest src/path/to/file.test.ts  # Run a single test file
```

## Architecture

### Stack
React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui. Backend is Supabase (PostgreSQL + Edge Functions). AI agents use Google Gemini 2.0 Flash via the Google AI Studio API.

### Path alias
`@/*` maps to `src/*` throughout the codebase.

### Routing
React Router with all pages nested under `AppLayout` (sidebar layout). Routes: `/` Dashboard, `/transactions`, `/import`, `/accounts`, `/categories`, `/aliases`, `/trends`, `/review`.

### Data fetching
TanStack React Query throughout. The Supabase client is a typed singleton at `src/integrations/supabase/client.ts` — import it as `import { supabase } from "@/integrations/supabase/client"`. TypeScript types for all tables are auto-generated in `src/integrations/supabase/types.ts`.

### Key libraries
- `src/lib/categorize.ts` — rule-based transaction categorization (priority-ordered contains/equals/regex matching against `category_rules` table)
- `src/lib/cleanMerchant.ts` — normalizes raw merchant strings using the `merchant_aliases` table
- `src/lib/treatments.ts` — `effectiveMonthlyContribution()` calculates how each treatment type contributes to monthly spending (excluded = 0, amortized = spread across months, etc.)
- `src/lib/parseFile.ts` — parses CSV/XLSX import files via PapaParse

### Transaction treatments
Transactions have a `treatment` enum: `normal | excluded | refundable | reimbursable | amortized | split`. Each treatment has an optional `treatment_meta` JSONB field for extra context (e.g. `owed_by`, `amort_mode`, `months`). This system drives how transactions appear in trend/budget calculations.

### AI edge functions
Three Supabase Edge Functions (Deno) in `supabase/functions/`:
- `categorize-transactions` — batch categorization during CSV import (fallback after rule matching)
- `suggest-categories` — per-merchant category suggestions
- `review-transactions` — full review agent; proposes category + treatment + confidence using `agent_feedback` and reviewed transaction history as memory

All three require `OPENROUTER_API_KEY` as a Supabase secret. Called from the frontend via `supabase.functions.invoke("function-name", { body: {...} })`.

### Import flow
`src/pages/Import.tsx` orchestrates the full import pipeline:
1. Parse file → normalize merchant names (aliases) → apply category rules → detect duplicates
2. User reviews staging table, optionally triggers AI categorization
3. On commit, rows are written to `transactions` and feedback is recorded in `agent_feedback`

### Agent learning loop
When a user accepts or overrides an AI proposal, the result is written to the `agent_feedback` table (`field`, `ai_value`, `ai_confidence`, `user_value`, `user_action`). The `review-transactions` edge function reads this table at runtime to personalize future proposals.

## Environment
Requires a `.env` file (see `.env.example`):
```
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_SUPABASE_PROJECT_ID=
```
