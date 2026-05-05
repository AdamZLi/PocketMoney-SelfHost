CREATE TABLE public.agent_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id uuid,
  merchant_name text,
  field text NOT NULL,
  ai_value jsonb,
  ai_confidence numeric,
  user_action text NOT NULL,
  user_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "phase1_open_all" ON public.agent_feedback
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_agent_feedback_merchant ON public.agent_feedback (merchant_name);
CREATE INDEX idx_agent_feedback_created ON public.agent_feedback (created_at DESC);