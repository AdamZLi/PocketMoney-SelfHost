# Copilot Instructions

## Commands

```bash
npm run dev          # Start dev server on port 8080
npm run build        # Production build
npm run lint         # ESLint check
npm run test         # Run all tests once
npm run test:watch   # Run tests in watch mode
npx vitest src/path/to/file.test.ts  # Run a single test file
```

Edge functions (Deno, deployed separately):
```bash
supabase functions deploy       # Deploy all edge functions
supabase db push                # Apply database migrations
```

## Architecture

React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui frontend. Supabase backend (PostgreSQL + Edge Functions). AI features use Google Gemini 2.0 Flash.

### Path alias

`@/*` maps to `src/*` (configured in `vite.config.ts` and `tsconfig.app.json`).

### Routing

React Router v6 with all pages nested under `AppLayout` (sidebar layout). Routes: `/` Dashboard, `/transactions`, `/import`, `/accounts`, `/categories`, `/aliases`, `/trends`, `/review`.

### Data layer

- **Supabase client**: typed singleton at `src/integrations/supabase/client.ts` — always import as `import { supabase } from "@/integrations/supabase/client"`.
- **Types**: auto-generated DB types in `src/integrations/supabase/types.ts`. Do not hand-edit; regenerate with the Supabase CLI.
- **Data fetching**: TanStack React Query throughout. No raw `useEffect` fetch patterns.

### Transaction treatments

Transactions carry a `treatment` enum (`normal | excluded | refundable | reimbursable | amortized | split`) and an optional `treatment_meta` JSONB field. This system drives trend/budget calculations via `src/lib/treatments.ts` — the single source of truth for `effectiveMonthlyContribution()`. Both the Dashboard and Trends pages consume this function; keep all treatment math here.

### Key domain libraries

- `src/lib/categorize.ts` — rule-based categorization (priority-ordered contains/equals/regex matching against the `category_rules` table).
- `src/lib/cleanMerchant.ts` — normalizes raw merchant strings using the `merchant_aliases` table.
- `src/lib/treatments.ts` — treatment contribution logic (see above).
- `src/lib/parseFile.ts` — CSV/XLSX import parsing via PapaParse.

### Import flow

`src/pages/Import.tsx` orchestrates the full pipeline:
1. Parse file → normalize merchant names (aliases) → apply category rules → detect duplicates.
2. User reviews a staging table, optionally triggers AI categorization.
3. On commit, rows insert into `transactions` and feedback records into `agent_feedback`.

### AI edge functions

Two Supabase Edge Functions (Deno runtime) in `supabase/functions/`:
- `suggest-categories` — batch AI categorization during import (fallback after rule matching). Returns `category_id` directly; skips merchants that already have a rule-based category. Called from the import page.
- `review-transactions` — full review agent proposing category + treatment + confidence. Uses `agent_feedback` and transaction history as memory. Agent spec: `docs/agents/review-agent.md`.

Both require `OPENROUTER_API_KEY` as a Supabase secret. Called from the frontend via `supabase.functions.invoke("function-name", { body: {...} })`.

### Agent learning loop

When a user accepts or overrides an AI proposal, the result is written to the `agent_feedback` table (`field`, `ai_value`, `ai_confidence`, `user_value`, `user_action`). The review agent reads this at runtime to personalize future proposals.

## Conventions

- **UI components**: shadcn/ui in `src/components/ui/`. App-level components live in `src/components/`.
- **Hooks**: custom hooks in `src/hooks/`.
- **Testing**: Vitest + React Testing Library + jsdom. Unit tests in `src/lib/__tests__/`. Integration tests (live Supabase + Gemini) use `*.integration.test.ts` suffix. Test data generator at `src/test/generators/csvGenerator.ts` produces randomized Capital One-format CSVs. Setup file at `src/test/setup.ts`.
- **ESLint**: flat config in `eslint.config.js`. `@typescript-eslint/no-unused-vars` is turned off.

## Environment

Requires a `.env` file (see `.env.example`):
```
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_SUPABASE_PROJECT_ID=
```
