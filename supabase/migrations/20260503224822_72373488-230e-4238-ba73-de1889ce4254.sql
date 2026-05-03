CREATE TYPE public.alias_match_type AS ENUM ('contains', 'exact', 'regex');
CREATE TYPE public.alias_source AS ENUM ('user', 'seed');

CREATE TABLE public.merchant_aliases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pattern TEXT NOT NULL,
  match_type public.alias_match_type NOT NULL DEFAULT 'contains',
  display_name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  source public.alias_source NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_merchant_aliases_priority ON public.merchant_aliases(priority DESC);

ALTER TABLE public.merchant_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY phase1_open_all ON public.merchant_aliases FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER touch_merchant_aliases
  BEFORE UPDATE ON public.merchant_aliases
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.merchant_aliases (pattern, match_type, display_name, priority, source) VALUES
  ('AMZN MKTP', 'contains', 'Amazon Marketplace', 200, 'seed'),
  ('AMAZON MKTPL', 'contains', 'Amazon Marketplace', 200, 'seed'),
  ('AMAZON.COM', 'contains', 'Amazon', 190, 'seed'),
  ('AMZN', 'contains', 'Amazon', 180, 'seed'),
  ('OPENAI', 'contains', 'OpenAI', 200, 'seed'),
  ('CHATGPT', 'contains', 'ChatGPT', 200, 'seed'),
  ('LINKEDIN', 'contains', 'LinkedIn', 200, 'seed'),
  ('WALGREENS', 'contains', 'Walgreens', 200, 'seed'),
  ('UBER EATS', 'contains', 'Uber Eats', 210, 'seed'),
  ('UBER', 'contains', 'Uber', 200, 'seed'),
  ('LYFT', 'contains', 'Lyft', 200, 'seed'),
  ('DOORDASH', 'contains', 'DoorDash', 200, 'seed'),
  ('GRUBHUB', 'contains', 'Grubhub', 200, 'seed'),
  ('NETFLIX', 'contains', 'Netflix', 200, 'seed'),
  ('SPOTIFY', 'contains', 'Spotify', 200, 'seed'),
  ('APPLE.COM/BILL', 'contains', 'Apple', 200, 'seed'),
  ('STARBUCKS', 'contains', 'Starbucks', 200, 'seed'),
  ('TRADER JOE', 'contains', 'Trader Joe''s', 200, 'seed'),
  ('WHOLEFDS', 'contains', 'Whole Foods', 200, 'seed'),
  ('WHOLE FOODS', 'contains', 'Whole Foods', 200, 'seed'),
  ('COSTCO', 'contains', 'Costco', 200, 'seed'),
  ('TARGET', 'contains', 'Target', 200, 'seed'),
  ('WALMART', 'contains', 'Walmart', 200, 'seed'),
  ('MINT MOBILE', 'contains', 'Mint Mobile', 200, 'seed'),
  ('COPILOT MONEY', 'contains', 'Copilot Money', 200, 'seed'),
  ('UNIQLO', 'contains', 'Uniqlo', 200, 'seed');