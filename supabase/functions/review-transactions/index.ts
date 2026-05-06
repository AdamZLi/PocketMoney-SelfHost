// Edge function: AI Review Agent.
// For each input transaction, proposes category_id + treatment + confidence
// using the user's history (transaction_edits, agent_feedback) as memory.
//
// The agent spec lives in docs/agents/review-agent.md
// The system prompt lives in docs/agents/review-agent.system-prompt.md
// Bump PROMPT_VERSION when the system prompt below changes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const PROMPT_VERSION = "2026-05-05.v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TREATMENTS = ["normal", "excluded", "refundable", "reimbursable", "amortized"] as const;
type Treatment = (typeof TREATMENTS)[number];

interface TxnInput {
  id: string;
  name: string;
  amount?: number;
  date?: string;
  current_category_id?: string | null;
  current_treatment?: Treatment | null;
  account_name?: string | null;
}
interface CategoryInput {
  id: string;
  name: string;
  parent_category?: string | null;
}

const SYSTEM_PROMPT = `You are the Review Agent — a specialized personal-finance assistant whose only
job is to review imported bank transactions for a single user and propose,
for each transaction:

  1. category_id      — chosen from the provided taxonomy, or null
  2. treatment        — one of: normal | excluded | refundable | reimbursable | amortized
  3. treatment_meta   — only the fields the chosen treatment requires
  4. confidence       — a calibrated number in [0, 1]
  5. reason           — a short plain-language reason (≤140 chars)

You do NOT apply changes. You only propose.

CONFIDENCE RUBRIC (calibrate carefully — the UI relies on this):
  ≥ 0.90  HIGH    — Auto-applied. Use only for exact merchant match in
                    merchant_history (sample_size ≥ 3, consistent), or
                    unambiguous global brands (Netflix, Spotify, Uber, Lyft,
                    Whole Foods, Trader Joe's, Starbucks, Amazon Prime…).
  0.50–0.89 MEDIUM — Plausible but not certain.
  < 0.50  LOW     — Unknown merchant, opaque description, conflicting signals.

If a past_corrections entry conflicts with what you'd otherwise propose, move
toward the user's prior correction AND cap confidence at 0.50.

TREATMENT HEURISTICS (default is "normal"):
  excluded     — internal transfers, credit-card payments, brokerage moves.
                 meta: { "reason": "<short>" }
  refundable   — large retail purchase within return window, or matches the
                 user's prior refundable patterns.
                 meta: { "refund_status": "pending" } (+ optional expected_refund_date)
  reimbursable — work travel, group dinners, shared subscriptions.
                 meta: { "reimbursement_status": "pending" } (+ optional your_share, owed_by)
  amortized    — annual subscriptions, insurance premiums, large one-offs.
                 meta: { "amort_mode": "calendar_year" } or
                       { "amort_mode": "custom", "months": <int>, "start_date": "YYYY-MM" }
  normal       — everything else. meta: {}

You MUST NOT output "split".

HARD RULES:
- Output ONLY via the submit_review tool. No prose.
- Exactly one proposal per input transaction, keyed by the original id.
- category_id MUST be null or an id from the provided categories list.
- treatment MUST be one of the five enum values above.
- treatment_meta MUST only contain keys allowed for the chosen treatment.
- If unsure on category, return null and confidence ≤ 0.40.
- reason ≤ 140 characters, plain English, no emoji.`;

function normalizeMerchant(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function sanitizeMeta(treatment: Treatment, meta: any): Record<string, unknown> {
  const m = meta && typeof meta === "object" ? meta : {};
  switch (treatment) {
    case "excluded":
      return { reason: typeof m.reason === "string" ? m.reason : "Excluded" };
    case "refundable":
      return {
        refund_status: m.refund_status === "received" ? "received" : "pending",
        ...(typeof m.expected_refund_date === "string" ? { expected_refund_date: m.expected_refund_date } : {}),
      };
    case "reimbursable":
      return {
        reimbursement_status: m.reimbursement_status === "settled" ? "settled" : "pending",
        ...(typeof m.your_share === "number" ? { your_share: m.your_share } : {}),
        ...(typeof m.owed_by === "string" ? { owed_by: m.owed_by } : {}),
      };
    case "amortized": {
      if (m.amort_mode === "custom" && Number.isFinite(m.months)) {
        return {
          amort_mode: "custom",
          months: Math.max(1, Math.floor(m.months)),
          ...(typeof m.start_date === "string" ? { start_date: m.start_date } : {}),
        };
      }
      return { amort_mode: "calendar_year" };
    }
    case "normal":
    default:
      return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json();
    const transactions: TxnInput[] = Array.isArray(body?.transactions) ? body.transactions : [];
    const categories: CategoryInput[] = Array.isArray(body?.categories) ? body.categories : [];

    if (transactions.length === 0 || categories.length === 0) {
      return new Response(JSON.stringify({ proposals: [], skipped: [], prompt_version: PROMPT_VERSION }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const batch = transactions.slice(0, 200);
    const validIds = new Set(categories.map((c) => c.id));
    const merchantNames = [...new Set(batch.map((t) => normalizeMerchant(t.name)))];

    // Build memory: past corrections + per-merchant treatment/category history.
    const { data: feedbackRows } = await sb
      .from("agent_feedback")
      .select("merchant_name, field, ai_value, user_value, user_action, created_at")
      .in("merchant_name", merchantNames)
      .eq("user_action", "overridden")
      .order("created_at", { ascending: false })
      .limit(200);

    // Past treatment + category distribution from prior transactions of same merchant.
    const merchantHistory: Record<string, { categories: Record<string, number>; treatments: Record<string, number>; sample: number }> = {};
    for (const m of merchantNames) {
      merchantHistory[m] = { categories: {}, treatments: {}, sample: 0 };
    }
    if (merchantNames.length > 0) {
      const { data: histRows } = await sb
        .from("transactions")
        .select("name, category_id, treatment")
        .in("name", batch.map((t) => t.name))
        .eq("reviewed", true)
        .limit(1000);
      for (const r of histRows ?? []) {
        const k = normalizeMerchant((r as any).name);
        const h = merchantHistory[k];
        if (!h) continue;
        h.sample += 1;
        const c = (r as any).category_id;
        if (c) h.categories[c] = (h.categories[c] ?? 0) + 1;
        const tr = (r as any).treatment ?? "normal";
        h.treatments[tr] = (h.treatments[tr] ?? 0) + 1;
      }
    }

    const categoryList = categories
      .map((c) =>
        c.parent_category
          ? `- ${c.name} (${c.parent_category}) [id=${c.id}]`
          : `- ${c.name} [id=${c.id}]`,
      )
      .join("\n");

    const txnList = batch
      .map((t) => {
        return `- id=${t.id} | "${t.name}"${t.amount != null ? ` | amount=${t.amount}` : ""}${
          t.date ? ` | date=${t.date}` : ""
        }${t.account_name ? ` | account="${t.account_name}"` : ""}${
          t.current_category_id ? ` | current_category_id=${t.current_category_id}` : ""
        }${t.current_treatment ? ` | current_treatment=${t.current_treatment}` : ""}`;
      })
      .join("\n");

    const corrections = (feedbackRows ?? []).slice(0, 60).map((r: any) => ({
      merchant: r.merchant_name,
      field: r.field,
      ai_value: r.ai_value,
      user_chose: r.user_value,
    }));

    const memoryBlock = JSON.stringify({
      past_corrections: corrections,
      merchant_history: Object.fromEntries(
        Object.entries(merchantHistory).filter(([_, v]) => v.sample > 0),
      ),
    });

    const userPrompt = `Available categories:\n${categoryList}\n\nMemory:\n${memoryBlock}\n\nReview these transactions:\n${txnList}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: body?.model || "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_review",
              description: "Return one proposal per input transaction.",
              parameters: {
                type: "object",
                properties: {
                  proposals: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        category_id: { type: ["string", "null"] },
                        treatment: { type: "string", enum: [...TREATMENTS] },
                        treatment_meta: { type: "object" },
                        confidence: { type: "number", minimum: 0, maximum: 1 },
                        reason: { type: "string" },
                      },
                      required: ["id", "category_id", "treatment", "treatment_meta", "confidence", "reason"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["proposals"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit_review" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited. Please wait a moment and try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiResp.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add funds in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResp.json();
    const argStr = aiData?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let proposals: any[] = [];
    if (argStr) {
      try {
        const parsed = JSON.parse(argStr);
        if (Array.isArray(parsed?.proposals)) proposals = parsed.proposals;
      } catch (e) {
        console.error("Failed to parse tool args", e);
      }
    }

    // Index inputs by id for validation + reason/merchant cross-check.
    const inputById = new Map(batch.map((t) => [t.id, t] as const));
    const STOP = new Set([
      "the","a","an","of","and","or","for","to","in","on","at","by","is","are",
      "was","were","be","with","from","as","that","this","it","its","into",
      "merchant","payment","transaction","card","purchase","charge","store",
      "global","brand","fast","food","provider","major","utility","p2p",
      "transfer","consistent","history","grocery","groceries","restaurant",
      "restaurants","insurance",
    ]);
    const tokenize = (s: string): string[] =>
      String(s ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9& ]+/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP.has(w));

    const seen = new Set<string>();
    const cleaned: Array<{
      id: string;
      category_id: string | null;
      treatment: Treatment;
      treatment_meta: Record<string, unknown>;
      confidence: number;
      reason: string;
      unverified: boolean;
    }> = [];

    for (const p of proposals) {
      if (!p || typeof p.id !== "string") continue;
      const inputTxn = inputById.get(p.id);
      if (!inputTxn) {
        console.warn("review-transactions: dropping proposal with unknown id", p.id, p.reason);
        continue;
      }
      if (seen.has(p.id)) {
        console.warn("review-transactions: dropping duplicate proposal for id", p.id, p.reason);
        continue;
      }
      seen.add(p.id);

      const treatment: Treatment = TREATMENTS.includes(p.treatment) ? p.treatment : "normal";
      const cat = p.category_id && validIds.has(p.category_id) ? p.category_id : null;
      let confidence = Number(p.confidence);
      if (!Number.isFinite(confidence)) confidence = 0.3;
      confidence = Math.max(0, Math.min(1, confidence));
      if (!cat) confidence = Math.min(confidence, 0.4);
      let reason = String(p.reason ?? "").slice(0, 140);

      // Reason ↔ merchant sanity check. If the reason mentions a substantive
      // word that doesn't appear in the merchant name (or account name), the
      // model likely cross-referenced the wrong row. Downgrade and flag.
      const merchantTokens = new Set([
        ...tokenize(inputTxn.name ?? ""),
        ...tokenize(inputTxn.account_name ?? ""),
      ]);
      const reasonTokens = tokenize(reason);
      const overlap = reasonTokens.some((w) => merchantTokens.has(w));
      // Only flag when the reason actually has substantive tokens to compare.
      const unverified = reasonTokens.length > 0 && !overlap && merchantTokens.size > 0;
      if (unverified) {
        console.warn(
          "review-transactions: reason↔merchant mismatch",
          { id: p.id, merchant: inputTxn.name, reason },
        );
        confidence = Math.min(confidence, 0.4);
      }

      cleaned.push({
        id: p.id,
        category_id: cat,
        treatment,
        treatment_meta: sanitizeMeta(treatment, p.treatment_meta),
        confidence,
        reason,
        unverified,
      });
    }

    const returnedIds = new Set(cleaned.map((c) => c.id));
    const skipped = batch.filter((t) => !returnedIds.has(t.id)).map((t) => t.id);

    return new Response(
      JSON.stringify({ proposals: cleaned, skipped, prompt_version: PROMPT_VERSION }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("review-transactions error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
