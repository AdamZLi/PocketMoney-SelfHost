# PocketMoney

A self-hosted personal finance app that imports bank transactions, cleans messy merchant names, categorizes spending, and uses AI to help you review and organize your finances.

## What It Does

- **Import bank transactions** — upload CSV/XLSX from any bank. The app parses, deduplicates, and stages transactions for review before committing.
- **Clean merchant names** — raw bank strings like `"DEBIT PURCHASE APLPAY COSTCO WHC #0482 ISSAQUAH WA"` get cleaned to `"Costco"` using alias rules (exact match and contains) plus generic normalization.
- **Source name visibility** — the original bank string is preserved and visible on every transaction, the import staging table, and the alias management page. You can always cross-reference with your bank statement.
- **Categorize spending** — rule-based auto-categorization during import, with AI-powered fallback for uncategorized transactions.
- **AI review agent** — scans transactions and proposes category + treatment changes with confidence scores. Learns from your accept/override decisions over time.
- **Transaction treatments** — mark transactions as normal, excluded, refundable, reimbursable, amortized, or split. Treatments flow through to dashboard and trend calculations.
- **Spending trends** — visualize spending over time with treatment-aware calculations.
- **Merchant alias management** — create rules that map raw bank names to clean display names. Search rules, expand to see which bank strings matched, reassign mismatches with retroactive updates.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Routing | React Router v6 |
| Data fetching | TanStack React Query |
| Backend | Supabase (PostgREST API) |
| Database | PostgreSQL (hosted by Supabase) |
| Edge functions | Supabase Edge Functions (Deno) |
| AI | Google Gemini 2.0 Flash via OpenRouter |
| Testing | Vitest + React Testing Library |
| Hosting | Vercel (frontend) + Supabase (backend) |

## Project Structure

```
src/
├── pages/          # Route pages (Dashboard, Transactions, Import, Aliases, etc.)
├── components/     # Shared UI components
├── lib/            # Domain logic (merchant cleaning, categorization, treatments)
├── hooks/          # Custom React hooks
├── integrations/   # Supabase client + auto-generated types
└── test/           # Test utilities and generators

supabase/
├── migrations/     # PostgreSQL schema migrations
└── functions/      # Edge functions (AI categorization, AI review)

docs/
├── architecture.md # System architecture (living doc, updated per feature)
├── features.md     # Feature summary in plain English (living doc)
├── features/       # Per-feature specs, designs, and review summaries
│   ├── personas.md
│   └── YYYY.M.DD-[feature-name]/
│       ├── spec.md
│       ├── design.md
│       ├── build-plan.md
│       └── review-summary.md
└── agents/         # AI agent specs (review agent)
```

## Local Development

1. Copy `.env.example` to `.env` and fill in your Supabase credentials
2. Install dependencies: `npm install`
3. Start dev server: `npm run dev`

## Commands

```bash
npm run dev          # Start dev server on port 8080
npm run build        # Production build
npm run lint         # ESLint check
npm run test         # Run all tests
```

## Deployment

- **Frontend:** Connected to Vercel via GitHub. Auto-deploys on push to `main`.
- **Edge Functions:** Deploy with `supabase functions deploy`
- **Database:** Apply migrations with `supabase db push`

## Feature Development Workflow

Features go through a structured pipeline with specialized AI agents:

1. **PM Spec Agent** — drafts a product spec from a feature idea
2. **Designer Agent** — reviews the spec for design gaps, then creates a design doc with wireframes
3. **Review Summary** — consolidates key decisions for user approval
4. **Build Planner Agent** — creates a step-by-step execution plan organized by user outcome
5. **Implementation** — coding follows the plan; architecture + feature docs are updated
