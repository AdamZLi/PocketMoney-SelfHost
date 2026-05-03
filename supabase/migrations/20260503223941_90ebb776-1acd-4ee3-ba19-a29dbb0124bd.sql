DROP INDEX IF EXISTS public.idx_txn_dedupe;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_dedupe_unique UNIQUE NULLS NOT DISTINCT (date, name, amount, account_id, status);