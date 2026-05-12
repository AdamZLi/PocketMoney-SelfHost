import { supabase } from "@/integrations/supabase/client";
import { AliasRow, compileAliases, cleanMerchant } from "./cleanMerchant";

/**
 * Re-applies the merchant cleaner (alias table + generic normalization)
 * to every existing transaction. Updates rows whose cleaned name differs,
 * and logs the change to transaction_edits.
 *
 * Returns the number of rows updated.
 */
export async function recleanAllTransactions(): Promise<number> {
  const { data: aliases } = await supabase
    .from("merchant_aliases")
    .select("id,pattern,match_type,display_name,priority,source");
  const compiled = compileAliases((aliases ?? []) as AliasRow[]);

  const { data, error } = await supabase
    .from("transactions")
    .select("id,name,raw_row,raw_merchant_name")
    .limit(10000);
  if (error) throw error;

  const updates: { id: string; oldName: string; newName: string; rawMerchantName: string }[] = [];
  for (const t of data ?? []) {
    const r = t.raw_row as any;
    const raw =
      r?.Name ?? r?.name ??
      r?.Description ?? r?.description ??
      r?.Merchant ?? r?.merchant ??
      t.name;
    const rawStr = String(raw ?? t.name);
    const cleaned = cleanMerchant(rawStr, compiled);
    const nameChanged = cleaned && cleaned !== t.name;
    const rawMissing = !t.raw_merchant_name && rawStr;
    if (nameChanged || rawMissing) {
      updates.push({ id: t.id, oldName: t.name, newName: cleaned || t.name, rawMerchantName: rawStr });
    }
  }
  if (updates.length === 0) return 0;

  for (let i = 0; i < updates.length; i += 200) {
    const slice = updates.slice(i, i + 200);
    await Promise.all(
      slice.map(u =>
        supabase.from("transactions").update({ name: u.newName, raw_merchant_name: u.rawMerchantName }).eq("id", u.id)
      )
    );
    await supabase.from("transaction_edits").insert(
      slice.filter(u => u.oldName !== u.newName).map(u => ({
        transaction_id: u.id,
        field_changed: "name",
        old_value: u.oldName as any,
        new_value: u.newName as any,
      }))
    );
  }
  return updates.length;
}

/** Extract raw merchant name from a raw_row JSONB object. */
function extractRawMerchant(rawRow: any): string | null {
  const val =
    rawRow?.Name ?? rawRow?.name ??
    rawRow?.Description ?? rawRow?.description ??
    rawRow?.Merchant ?? rawRow?.merchant ??
    null;
  return val != null ? String(val) : null;
}

/**
 * Backfill raw_merchant_name from raw_row for transactions that don't have it yet.
 * Does NOT change the display name. Intended as a one-time migration helper.
 */
export async function backfillRawMerchantNames(): Promise<number> {
  const { data, error } = await supabase
    .from("transactions")
    .select("id,raw_row")
    .is("raw_merchant_name", null)
    .not("raw_row", "is", null)
    .limit(10000);
  if (error) throw error;

  const updates: { id: string; rawMerchantName: string }[] = [];
  for (const t of data ?? []) {
    const raw = extractRawMerchant(t.raw_row as any);
    if (raw) {
      updates.push({ id: t.id, rawMerchantName: raw });
    }
  }
  if (updates.length === 0) return 0;

  for (let i = 0; i < updates.length; i += 200) {
    const slice = updates.slice(i, i + 200);
    await Promise.all(
      slice.map(u =>
        supabase.from("transactions").update({ raw_merchant_name: u.rawMerchantName }).eq("id", u.id)
      )
    );
  }
  return updates.length;
}

/**
 * Reassign all transactions matching a raw merchant name to a new display name.
 * Also handles pre-feature transactions (raw_merchant_name IS NULL) matched by name.
 */
export async function reassignRawName(
  rawMerchantName: string,
  newDisplayName: string,
): Promise<{ updatedWithRaw: number; updatedByName: number }> {
  // 1. Update transactions that have the raw_merchant_name stored
  const { data: withRaw, error: err1 } = await supabase
    .from("transactions")
    .update({ name: newDisplayName })
    .eq("raw_merchant_name", rawMerchantName)
    .select("id");
  if (err1) throw err1;

  // 2. Update pre-feature transactions matched by display name, and backfill raw_merchant_name
  const { data: byName, error: err2 } = await supabase
    .from("transactions")
    .update({ name: newDisplayName, raw_merchant_name: rawMerchantName })
    .eq("name", rawMerchantName)
    .is("raw_merchant_name", null)
    .select("id");
  if (err2) throw err2;

  return {
    updatedWithRaw: withRaw?.length ?? 0,
    updatedByName: byName?.length ?? 0,
  };
}

/**
 * Upsert an exact-match alias rule and reassign all matching transactions.
 */
export async function reassignAndCreateRule(
  rawMerchantName: string,
  newDisplayName: string,
): Promise<{ updatedWithRaw: number; updatedByName: number; ruleCreated: boolean }> {
  // Upsert exact-match alias (use pattern as the conflict key via onConflict)
  const { error: aliasErr } = await supabase
    .from("merchant_aliases")
    .upsert(
      {
        pattern: rawMerchantName,
        match_type: "exact",
        display_name: newDisplayName,
        priority: 1000,
        source: "user",
      },
      { onConflict: "pattern,match_type" }
    );
  if (aliasErr) throw aliasErr;

  const counts = await reassignRawName(rawMerchantName, newDisplayName);

  return {
    ...counts,
    ruleCreated: true,
  };
}
