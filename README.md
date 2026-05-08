# PocketWise

Personal finance tracker — import, categorize, and review your transactions with AI-powered insights.

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend:** Supabase (PostgreSQL + Edge Functions)
- **AI:** Google Gemini 2.0 Flash via Google AI Studio
- **Hosting:** Vercel (frontend) + Supabase (backend)

## Local Development

1. Copy `.env.example` to `.env` and fill in your Supabase credentials
2. Install dependencies: `npm install`
3. Start dev server: `npm run dev`

## Deployment

- Frontend: Connected to Vercel via GitHub. Auto-deploys on push to `main`.
- Edge Functions: Deploy with `supabase functions deploy`
- Database: Apply migrations with `supabase db push`
