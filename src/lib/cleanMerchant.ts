// Merchant string cleaner driven by an editable alias table.
//
// Pipeline:
//   1. Try alias match (highest priority wins; contains/exact/regex, all case-insensitive)
//   2. Generic normalization (strip processor prefixes, store numbers, ref ids, urls,
//      corporate suffixes, trailing CITY ST, collapse separators, title-case all-caps)
//   3. Fallback to original trimmed string if normalization empties it.

import { supabase } from "@/integrations/supabase/client";

export type AliasRow = {
  id: string;
  pattern: string;
  match_type: "contains" | "exact" | "regex";
  display_name: string;
  priority: number;
  source: "user" | "seed";
};

export type CompiledAlias = {
  row: AliasRow;
  test: (s: string) => boolean;
};

export function compileAliases(rows: AliasRow[]): CompiledAlias[] {
  return [...rows]
    .sort((a, b) => b.priority - a.priority)
    .map((row) => {
      let test: (s: string) => boolean;
      const p = row.pattern;
      if (row.match_type === "exact") {
        const lp = p.toLowerCase();
        test = (s) => s.toLowerCase() === lp;
      } else if (row.match_type === "regex") {
        try {
          const re = new RegExp(p, "i");
          test = (s) => re.test(s);
        } catch {
          test = () => false;
        }
      } else {
        const lp = p.toLowerCase();
        test = (s) => s.toLowerCase().includes(lp);
      }
      return { row, test };
    });
}

export async function loadAliases(): Promise<CompiledAlias[]> {
  const { data, error } = await supabase
    .from("merchant_aliases")
    .select("id,pattern,match_type,display_name,priority,source");
  if (error) throw error;
  return compileAliases((data ?? []) as AliasRow[]);
}

const PREFIXES: RegExp[] = [
  /^TST\*\s*/i,
  /^SQ\s*\*\s*/i,
  /^SP\s*\*\s*/i,
  /^PAYPAL\s*\*\s*/i,
  /^PP\s*\*\s*/i,
  /^IN\s*\*\s*/i,
  /^POS\s+/i,
  /^DEBIT\s+/i,
  /^CREDIT\s+/i,
  /^PURCHASE\s+/i,
  /^CHECKCARD\s+/i,
  /^RECURRING\s+/i,
  /^ACH\s+/i,
  /^APLPAY\s+/i,
  /^APPLE\s*PAY\s+/i,
  /^GOOGLE\s*PAY\s+/i,
  /^GPAY\s+/i,
];

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase())
    .replace(/'S\b/g, "'s");
}

export function genericNormalize(input: string): string {
  let s = String(input ?? "").trim();
  if (!s) return s;

  for (const re of PREFIXES) s = s.replace(re, "");

  // URLs / domains
  s = s.replace(/\b[\w.-]+\.(com|net|org|io|co|us|app|gov)(\/\S*)?/gi, "");
  // store numbers / hashes
  s = s.replace(/#\s*\d+/g, "");
  s = s.replace(/\bSTORE\s*#?\s*\d+/gi, "");
  // processor reference codes after a *
  s = s.replace(/\*[A-Z0-9]{4,}\b/gi, "");
  // ref ids like P730740576
  s = s.replace(/\b[A-Z]\d{6,}\b/g, "");
  // long alnum tokens
  s = s.replace(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,}\b/g, "");
  // long pure-numeric runs
  s = s.replace(/\b\d{4,}\b/g, "");
  // corporate suffixes
  s = s.replace(/\b(LLC|INC|CO|CORP|LTD|GMBH)\b\.?/gi, "");
  // trailing 2-letter state code
  s = s.replace(/\s[A-Z]{2}\s*$/, "");
  // collapse separators / whitespace
  s = s.replace(/[*_]+/g, " ").replace(/\s+/g, " ").trim();

  if (!s) return String(input ?? "").trim();

  const isAllCaps = s === s.toUpperCase();
  return isAllCaps ? titleCase(s) : s;
}

export function cleanMerchant(raw: string, aliases: CompiledAlias[] = []): string {
  if (!raw) return raw;
  const s = String(raw).trim();
  if (!s) return s;
  for (const a of aliases) {
    if (a.test(s)) return a.row.display_name;
  }
  return genericNormalize(s);
}
