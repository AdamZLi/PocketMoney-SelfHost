
CREATE TYPE public.account_type AS ENUM ('credit_card','debit_card','checking','savings','cash','other');
CREATE TYPE public.txn_status AS ENUM ('pending','posted');
CREATE TYPE public.txn_source AS ENUM ('manual','import','plaid');
CREATE TYPE public.rule_match_type AS ENUM ('contains','equals','regex');
CREATE TYPE public.rule_source AS ENUM ('seed','user','learned');

CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  mask TEXT,
  type public.account_type NOT NULL DEFAULT 'other',
  institution TEXT,
  plaid_account_id TEXT,
  plaid_item_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_accounts_name_mask ON public.accounts(name, COALESCE(mask,''));

CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  parent_category TEXT,
  color TEXT,
  icon TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.category_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  match_type public.rule_match_type NOT NULL DEFAULT 'contains',
  pattern TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  source public.rule_source NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_category_rules_priority ON public.category_rules(priority);

CREATE TABLE public.plaid_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_name TEXT,
  access_token TEXT,
  cursor TEXT,
  status TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT,
  file_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  total_rows INT NOT NULL DEFAULT 0,
  imported_rows INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  name TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  status public.txn_status NOT NULL DEFAULT 'posted',
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  excluded BOOLEAN NOT NULL DEFAULT false,
  type TEXT,
  note TEXT,
  recurring TEXT,
  source public.txn_source NOT NULL DEFAULT 'manual',
  import_batch_id UUID REFERENCES public.import_batches(id) ON DELETE SET NULL,
  plaid_transaction_id TEXT UNIQUE,
  raw_row JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_txn_dedupe ON public.transactions(
  date, lower(name), amount, COALESCE(account_id::text,''), status
);
CREATE INDEX idx_txn_date ON public.transactions(date DESC);
CREATE INDEX idx_txn_account ON public.transactions(account_id);
CREATE INDEX idx_txn_category ON public.transactions(category_id);

CREATE TABLE public.transaction_tags (
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE TABLE public.transaction_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  field_changed TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_txn_edits_txn ON public.transaction_edits(transaction_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_accounts_updated BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_txn_updated BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plaid_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_edits ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['accounts','categories','tags','category_rules','plaid_items','import_batches','transactions','transaction_tags','transaction_edits'])
  LOOP
    EXECUTE format('CREATE POLICY "phase1_open_all" ON public.%I FOR ALL USING (true) WITH CHECK (true);', t);
  END LOOP;
END $$;

INSERT INTO public.categories (name, parent_category, color, icon) VALUES
  ('Groceries','Food & Drink','#10b981','shopping-basket'),
  ('Restaurants','Food & Drink','#f59e0b','utensils'),
  ('Transportation','Car & Transport','#3b82f6','car'),
  ('Shops','Shopping','#ec4899','shopping-bag'),
  ('Home','Household','#8b5cf6','home'),
  ('Bills & Utilities','Bills','#06b6d4','file-text'),
  ('Entertainment','Lifestyle','#f43f5e','film'),
  ('Health','Health','#22c55e','heart'),
  ('Travel','Travel','#0ea5e9','plane'),
  ('Subscriptions','Bills','#a855f7','repeat'),
  ('Income','Income','#16a34a','trending-up'),
  ('Transfers','Transfers','#64748b','arrow-left-right'),
  ('Other',NULL,'#94a3b8','circle');

INSERT INTO public.category_rules (category_id, match_type, pattern, priority, source)
SELECT c.id, 'contains', p.pattern, 50, 'seed'::public.rule_source
FROM public.categories c
JOIN (VALUES
  ('Restaurants','UBER EATS'),
  ('Restaurants','DOORDASH'),
  ('Restaurants','CHICK-FIL-A'),
  ('Restaurants','DUNKIN'),
  ('Transportation','UBER'),
  ('Transportation','LYFT'),
  ('Transportation','NYCT'),
  ('Groceries','TRADER JOE'),
  ('Groceries','WHOLE FOODS'),
  ('Shops','AMAZON'),
  ('Shops','TARGET'),
  ('Subscriptions','NETFLIX'),
  ('Subscriptions','SPOTIFY')
) AS p(cat, pattern) ON c.name = p.cat;
