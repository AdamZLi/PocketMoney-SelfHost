// Rule-based categorization. Higher priority = lower number wins.
export type Rule = {
  id: string;
  category_id: string;
  match_type: "contains" | "equals" | "regex";
  pattern: string;
  priority: number;
};

export function applyRules(name: string, rules: Rule[]): string | null {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  const upper = name.toUpperCase();
  for (const r of sorted) {
    const p = r.pattern.toUpperCase();
    if (r.match_type === "equals" && upper === p) return r.category_id;
    if (r.match_type === "contains" && upper.includes(p)) return r.category_id;
    if (r.match_type === "regex") {
      try {
        if (new RegExp(r.pattern, "i").test(name)) return r.category_id;
      } catch { /* skip bad regex */ }
    }
  }
  return null;
}
