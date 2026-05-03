ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS review_reason text;
CREATE INDEX IF NOT EXISTS idx_transactions_needs_review ON public.transactions(needs_review) WHERE needs_review = true;