// Edge function: classify uncategorized transactions using Lovable AI tool calling.
// Input:  { categories: string[], transactions: [{ row, name, amount }] }
// Output: { results: [{ row, category, confidence }] }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { categories, transactions } = await req.json();
    if (!Array.isArray(categories) || !Array.isArray(transactions)) {
      return new Response(JSON.stringify({ error: "Invalid body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

    const sys = `You categorize personal finance transactions. Pick exactly one category from this list for each transaction. Use "Other" if none fit. Allowed categories: ${categories.join(", ")}.`;
    const user = `Classify these transactions and return confidence 0-1:\n${transactions.map((t: any) => `#${t.row} ${t.name} $${t.amount}`).join("\n")}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        tools: [{
          type: "function",
          function: {
            name: "submit_classifications",
            description: "Submit category classifications.",
            parameters: {
              type: "object",
              properties: {
                results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      row: { type: "number" },
                      category: { type: "string", enum: categories },
                      confidence: { type: "number", minimum: 0, maximum: 1 },
                    },
                    required: ["row", "category", "confidence"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["results"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "submit_classifications" } },
      }),
    });

    if (resp.status === 429 || resp.status === 402) {
      return new Response(JSON.stringify({
        error: resp.status === 402 ? "AI credits exhausted. Add funds in Settings → Workspace → Usage." : "Rate limited; try again shortly.",
      }), { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`AI gateway ${resp.status}: ${t}`);
    }
    const data = await resp.json();
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const parsed = args ? JSON.parse(args) : { results: [] };

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("categorize-transactions error", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
