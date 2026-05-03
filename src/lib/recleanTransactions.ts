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
    .select("id,name,raw_row")
    .limit(10000);
  if (error) throw error;

  const updates: { id: string; oldName: string; newName: string }[] = [];
  for (const t of data ?? []) {
    const r = t.raw_row as any;
    const raw =
      r?.Name ?? r?.name ??
      r?.Description ?? r?.description ??
      r?.Merchant ?? r?.merchant ??
      t.name;
    const cleaned = cleanMerchant(String(raw ?? t.name), compiled);
    if (cleaned && cleaned !== t.name) {
      updates.push({ id: t.id, oldName: t.name, newName: cleaned });
    }
  }
  if (updates.length === 0) return 0;

  for (let i = 0; i < updates.length; i += 200) {
    const slice = updates.slice(i, i + 200);
    await Promise.all(
      slice.map(u =>
        supabase.from("transactions").update({ name: u.newName }).eq("id", u.id)
      )
    );
    await supabase.from("transaction_edits").insert(
      slice.map(u => ({
        transaction_id: u.id,
        field_changed: "name",
        old_value: u.oldName as any,
        new_value: u.newName as any,
      }))
    );
  }
  return updates.length;
}
