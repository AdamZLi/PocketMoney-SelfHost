// Edge function: AI-powered expense categorization.
// Receives a list of merchants and the available categories, returns
// suggested category_id for each. Uses Google Gemini with tool
// calling for structured output. The model is acting as a specialized
// personal-expense categorization agent.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface MerchantInput {
  id: string; // transaction id (caller-defined opaque id)
  name: string;
  amount?: number;
  rule_category_id?: string | null; // Pre-existing rule-based category
}
interface CategoryInput {
  id: string;
  name: string;
  parent_category?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY is not configured");

    const body = await req.json();
    const merchants: MerchantInput[] = Array.isArray(body?.merchants)
      ? body.merchants
      : [];
    const categories: CategoryInput[] = Array.isArray(body?.categories)
      ? body.categories
      : [];

    if (merchants.length === 0 || categories.length === 0) {
      return new Response(JSON.stringify({ suggestions: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Separate merchants: those with rule-based categories and those needing AI
    const merchantsToProcess = merchants.filter((m) => !m.rule_category_id);
    const preCategorized = merchants
      .filter((m) => m.rule_category_id)
      .map((m) => ({
        id: m.id,
        category_id: m.rule_category_id,
        confidence: "high",
      }));

    if (merchantsToProcess.length === 0) {
      return new Response(JSON.stringify({ suggestions: preCategorized }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cap batch size to keep latency reasonable.
    const batch = merchantsToProcess.slice(0, 200);

    const categoryList = categories
      .map((c) =>
        c.parent_category
          ? `- ${c.name} (${c.parent_category}) [id=${c.id}]`
          : `- ${c.name} [id=${c.id}]`,
      )
      .join("\n");

    const merchantList = batch
      .map(
        (m) =>
          `- id=${m.id} | "${m.name}"${
            m.amount != null ? ` | amount=${m.amount}` : ""
          }`,
      )
      .join("\n");

    const systemPrompt = `You are a specialized personal-finance expense categorization agent.
Your only job is to assign each merchant transaction to the single best-fitting category from the provided taxonomy.

Rules:
- ALWAYS pick a category from the provided list using its exact id.
- If a merchant clearly does not fit any category, return category_id = null.
- Prefer specific over generic categories (e.g. "Groceries" over "Shopping").
- Use the merchant brand knowledge you have (e.g. "Uber" → Transportation, "Netflix" → Subscriptions, "Whole Foods" → Groceries).
- Do not invent new categories. Do not guess wildly — null is acceptable.
- Be concise: only return the structured tool call, no prose.`;

    const userPrompt = `Available categories:
${categoryList}

Categorize these merchants:
${merchantList}`;

    const aiResp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GOOGLE_AI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "assign_categories",
                description:
                  "Return a category assignment for each input merchant.",
                parameters: {
                  type: "object",
                  properties: {
                    suggestions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: {
                            type: "string",
                            description: "Merchant id from the input list",
                          },
                          category_id: {
                            type: ["string", "null"],
                            description:
                              "Chosen category id, or null if no good match",
                          },
                          confidence: {
                            type: "string",
                            enum: ["low", "medium", "high"],
                          },
                        },
                        required: ["id", "category_id", "confidence"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["suggestions"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "assign_categories" },
          },
        }),
      },
    );

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(
          JSON.stringify({
            error: "Rate limited. Please wait a moment and try again.",
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      if (aiResp.status === 402) {
        return new Response(
          JSON.stringify({
            error:
              "AI credits exhausted. Add funds in Settings → Workspace → Usage.",
          }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const errText = await aiResp.text();
      console.error("AI gateway error", aiResp.status, errText);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const aiData = await aiResp.json();
    const toolCall =
      aiData?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let suggestions: any[] = [];
    if (toolCall) {
      try {
        const parsed = JSON.parse(toolCall);
        if (Array.isArray(parsed?.suggestions)) {
          suggestions = parsed.suggestions;
        }
      } catch (e) {
        console.error("Failed to parse tool arguments", e, toolCall);
      }
    }

    // Filter to valid category ids only.
    const validIds = new Set(categories.map((c) => c.id));
    const cleaned = suggestions
      .filter((s) => s && typeof s.id === "string")
      .map((s) => ({
        id: s.id,
        category_id:
          s.category_id && validIds.has(s.category_id) ? s.category_id : null,
        confidence: s.confidence ?? "low",
      }));

    return new Response(JSON.stringify({ suggestions: [...preCategorized, ...cleaned] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-categories error", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
