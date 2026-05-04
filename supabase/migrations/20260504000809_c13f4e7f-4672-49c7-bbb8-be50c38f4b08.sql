-- Treatment enum
DO $$ BEGIN
  CREATE TYPE public.txn_treatment AS ENUM ('normal','excluded','refundable','reimbursable','amortized');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.review_kind AS ENUM ('duplicate','refund_pending','reimbursement_pending');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS treatment public.txn_treatment NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS treatment_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_txn_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_kind public.review_kind;

-- Migrate existing excluded rows
UPDATE public.transactions
   SET treatment = 'excluded'
 WHERE excluded = true AND treatment = 'normal';

CREATE INDEX IF NOT EXISTS idx_transactions_treatment ON public.transactions(treatment) WHERE treatment <> 'normal';
CREATE INDEX IF NOT EXISTS idx_transactions_linked_txn ON public.transactions(linked_txn_id) WHERE linked_txn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_review_kind ON public.transactions(review_kind) WHERE review_kind IS NOT NULL;