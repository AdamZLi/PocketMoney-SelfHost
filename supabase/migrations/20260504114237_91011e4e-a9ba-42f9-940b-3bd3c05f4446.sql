ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reviewed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_transactions_reviewed ON public.transactions (reviewed);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions (date);