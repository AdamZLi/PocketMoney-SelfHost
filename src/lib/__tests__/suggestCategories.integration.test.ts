/**
 * Live integration test for the suggest-categories edge function.
 * Calls the real Supabase edge function + OpenRouter API.
 *
 * Requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.
 * The edge function must have OPENROUTER_API_KEY configured.
 *
 * Run: npx vitest run src/lib/__tests__/suggestCategories.integration.test.ts
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Skip entire suite if env vars are missing
const canRun = !!SUPABASE_URL && !!SUPABASE_KEY;
const describeIf = canRun ? describe : describe.skip;

function getClient() {
  return createClient(SUPABASE_URL!, SUPABASE_KEY!);
}

// Realistic category list — mirrors what a real user would have
const CATEGORIES = [
  { id: "cat-groceries", name: "Groceries" },
  { id: "cat-dining", name: "Dining" },
  { id: "cat-subscriptions", name: "Subscriptions" },
  { id: "cat-transport", name: "Transportation" },
  { id: "cat-shopping", name: "Shopping" },
  { id: "cat-health", name: "Health Care" },
  { id: "cat-utilities", name: "Utilities" },
  { id: "cat-entertainment", name: "Entertainment" },
  { id: "cat-travel", name: "Travel" },
  { id: "cat-gas", name: "Gas & Auto" },
  { id: "cat-phone", name: "Phone & Internet" },
  { id: "cat-services", name: "Services" },
  { id: "cat-other", name: "Other" },
];

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

describeIf("suggest-categories (live integration)", () => {
  // Add delay between tests to avoid rate limiting
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it(
    "classifies a batch of merchants and returns valid output",
    async () => {
      const supabase = getClient();
      const merchants = [
        { id: "m1", name: "COSTCO WHOLESALE W524", amount: 125.5 },
        { id: "m2", name: "UBER   *TRIP", amount: 22.0 },
        { id: "m3", name: "OPENAI *CHATGPT SUBSCR", amount: 21.78 },
        { id: "m4", name: "FSI*CONED BILL PAYMENT", amount: 88.4 },
        { id: "m5", name: "GOOD BROTHERS BBQ", amount: 37.77 },
        { id: "m6", name: "CLASSPASS* MONTHLY", amount: 89.0 },
        { id: "m7", name: "APPLE STORE  #R415", amount: 1523.16 },
        { id: "m8", name: "AVIS RENT-A-CAR", amount: 299.02 },
        { id: "m9", name: "EXXON NYST #444", amount: 31.99 },
        { id: "m10", name: "MINT MOBILE", amount: 262.21 },
      ];

      const { data, error } = await supabase.functions.invoke(
        "suggest-categories",
        {
          body: { categories: CATEGORIES, merchants },
        },
      );

      if (error && (error as any)?.context?.status === 429) {
        console.warn("Rate limited — skipping assertion, retrying on next run");
        return;
      }

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(Array.isArray(data.suggestions)).toBe(true);

      const suggestions = data.suggestions as Array<{
        id: string;
        category_id: string | null;
        confidence: string;
      }>;

      // Output contract: every suggestion has the required keys
      for (const s of suggestions) {
        expect(typeof s.id).toBe("string");
        expect(
          s.category_id === null || CATEGORY_IDS.has(s.category_id),
        ).toBe(true);
        expect(["low", "medium", "high"]).toContain(s.confidence);
      }

      // Response count: at least as many suggestions as input merchants
      expect(suggestions.length).toBeGreaterThanOrEqual(merchants.length);

      // Known brands: at least 70% should get a non-null category
      const classified = suggestions.filter((s) => s.category_id !== null);
      expect(classified.length).toBeGreaterThanOrEqual(
        Math.floor(merchants.length * 0.7),
      );
    },
    60_000,
  );

  it(
    "respects rule_category_id passthrough",
    async () => {
      await delay(3000);
      const supabase = getClient();
      const merchants = [
        {
          id: "r1",
          name: "ALREADY CATEGORIZED",
          amount: 50,
          rule_category_id: "cat-groceries",
        },
        { id: "r2", name: "COSTCO WHOLESALE W524", amount: 100 },
      ];

      const { data, error } = await supabase.functions.invoke(
        "suggest-categories",
        {
          body: { categories: CATEGORIES, merchants },
        },
      );

      if (error && (error as any)?.context?.status === 429) {
        console.warn("Rate limited — skipping");
        return;
      }

      expect(error).toBeNull();
      const suggestions = data.suggestions as Array<{
        id: string;
        category_id: string | null;
        confidence: string;
      }>;

      // The pre-categorized merchant should pass through unchanged
      const r1 = suggestions.find((s) => s.id === "r1");
      expect(r1).toBeDefined();
      expect(r1!.category_id).toBe("cat-groceries");
      expect(r1!.confidence).toBe("high");
    },
    60_000,
  );

  it(
    "handles unknown/opaque merchants gracefully",
    async () => {
      await delay(3000);
      const supabase = getClient();
      const merchants = [
        { id: "u1", name: "SQ *4F8K2 LLC", amount: 38.2 },
        { id: "u2", name: "NCOURT *NYTULLYTOWN", amount: 214.98 },
      ];

      const { data, error } = await supabase.functions.invoke(
        "suggest-categories",
        {
          body: { categories: CATEGORIES, merchants },
        },
      );

      if (error && (error as any)?.context?.status === 429) {
        console.warn("Rate limited — skipping");
        return;
      }

      expect(error).toBeNull();
      const suggestions = data.suggestions as Array<{
        id: string;
        category_id: string | null;
        confidence: string;
      }>;

      // Should still return results (possibly with null category_id)
      expect(suggestions.length).toBeGreaterThanOrEqual(2);
      for (const s of suggestions) {
        expect(typeof s.id).toBe("string");
        // confidence should NOT be "high" for opaque merchants
        if (s.category_id === null) {
          expect(s.confidence).not.toBe("high");
        }
      }
    },
    60_000,
  );

  it(
    "returns empty suggestions for empty merchants",
    async () => {
      const supabase = getClient();

      const { data, error } = await supabase.functions.invoke(
        "suggest-categories",
        {
          body: { categories: CATEGORIES, merchants: [] },
        },
      );

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.suggestions).toEqual([]);
    },
    15_000,
  );
});
