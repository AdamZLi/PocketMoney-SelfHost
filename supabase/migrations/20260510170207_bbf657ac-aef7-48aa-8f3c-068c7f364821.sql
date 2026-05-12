-- Add raw_merchant_name column to transactions for source name visibility
ALTER TABLE public.transactions ADD COLUMN raw_merchant_name TEXT;

-- Index for querying transactions by raw merchant name (used by matched names panel and reassignment)
CREATE INDEX idx_transactions_raw_merchant_name ON public.transactions(raw_merchant_name);

-- Backfill raw_merchant_name from raw_row JSONB for existing transactions
UPDATE public.transactions
SET raw_merchant_name = COALESCE(
  raw_row->>'Name',
  raw_row->>'name',
  raw_row->>'Description',
  raw_row->>'description',
  raw_row->>'Merchant',
  raw_row->>'merchant',
  raw_row->>'Transaction Description',
  raw_row->>'PayeeName'
)
WHERE raw_row IS NOT NULL AND raw_merchant_name IS NULL;
