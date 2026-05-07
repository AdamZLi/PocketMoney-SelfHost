import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CategoryCombobox } from "@/components/CategoryCombobox";
import { TreatmentPicker } from "@/components/TreatmentPicker";
import { type Treatment, type TreatmentMeta } from "@/lib/treatments";
import { fmtDate } from "@/lib/format";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Props = {
  txnId: string | null;
  onClose: () => void;
  onSaved?: () => void;
};

export function TransactionEditSheet({ txnId, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState({ name: "", date: "", amount: "", note: "" });
  const [saving, setSaving] = useState(false);

  const { data: txn, isLoading } = useQuery({
    queryKey: ["txn-edit", txnId],
    enabled: !!txnId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select(
          "id,date,name,amount,note,reviewed,reviewed_at,treatment,treatment_meta,category_id,excluded,accounts(name,mask)",
        )
        .eq("id", txnId!)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () =>
      (await supabase.from("categories").select("id,name,parent_category").order("name")).data ?? [],
  });

  useEffect(() => {
    if (!txn) return;
    setDraft({
      name: txn.name ?? "",
      date: txn.date ?? "",
      amount: txn.amount != null ? String(txn.amount) : "",
      note: txn.note ?? "",
    });
  }, [txn]);

  if (!txnId) return null;

  async function patch(updates: Record<string, any>) {
    const { error } = await supabase.from("transactions").update(updates as any).eq("id", txnId!);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["txn-edit", txnId] });
    qc.invalidateQueries({ queryKey: ["txns"] });
    qc.invalidateQueries({ queryKey: ["review"] });
    onSaved?.();
    return true;
  }

  async function save() {
    if (!txn) return;
    setSaving(true);
    const updates: Record<string, any> = {};
    const newName = draft.name.trim();
    if (newName && newName !== txn.name) updates.name = newName;
    if (draft.date && draft.date !== txn.date) updates.date = draft.date;
    const amt = Number(draft.amount);
    if (Number.isFinite(amt) && amt !== Number(txn.amount)) updates.amount = amt;
    const newNote = draft.note.trim() || null;
    if ((newNote ?? null) !== (txn.note ?? null)) updates.note = newNote;
    if (Object.keys(updates).length === 0) {
      setSaving(false);
      onClose();
      return;
    }
    const ok = await patch(updates);
    setSaving(false);
    if (ok) {
      toast({ title: "Saved" });
      onClose();
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-black/30 animate-in fade-in"
        onClick={() => { if (!saving) onClose(); }}
      />
      <aside
        className="fixed top-0 right-0 z-40 h-screen w-full sm:max-w-md border-l bg-background shadow-xl flex flex-col animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-label="Edit transaction"
      >
        <div className="flex items-start justify-between px-6 pt-6 pb-2">
          <div>
            <h2 className="text-lg font-semibold">Edit transaction</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Update merchant, date, amount, category, treatment, note, and review state.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 -mr-2 -mt-2 shrink-0"
            onClick={() => { if (!saving) onClose(); }}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {(isLoading || !txn) ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 space-y-5 py-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Merchant name</Label>
                <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Date</Label>
                  <Input
                    type="date"
                    value={draft.date}
                    onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={draft.amount}
                    onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
                    className="tabular-nums"
                  />
                </div>
              </div>

              {txn.accounts?.name && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Account</Label>
                  <div className="text-sm">
                    {txn.accounts.name}{txn.accounts.mask ? ` ····${txn.accounts.mask}` : ""}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Category</Label>
                <CategoryCombobox
                  value={txn.category_id}
                  categories={categories as any}
                  onChange={(v) => { patch({ category_id: v }); }}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Treatment</Label>
                <TreatmentPicker
                  treatment={(txn.treatment ?? "normal") as Treatment}
                  meta={(txn.treatment_meta ?? {}) as TreatmentMeta}
                  amount={Number(txn.amount)}
                  date={txn.date}
                  onSave={(treatment, meta) => patch({ treatment, treatment_meta: meta })}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Note</Label>
                <Textarea
                  rows={4}
                  placeholder="Add a note about this transaction…"
                  value={draft.note}
                  onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                />
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Reviewed</div>
                  <div className="text-xs text-muted-foreground">
                    {txn.reviewed && txn.reviewed_at ? `Marked ${fmtDate(txn.reviewed_at)}` : "Not yet reviewed"}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={txn.reviewed ? "secondary" : "outline"}
                  onClick={() =>
                    patch({
                      reviewed: !txn.reviewed,
                      reviewed_at: !txn.reviewed ? new Date().toISOString() : null,
                    })
                  }
                >
                  {txn.reviewed ? (<><Check className="h-3.5 w-3.5 mr-1.5" />Reviewed</>) : "Mark as reviewed"}
                </Button>
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Excluded from totals</div>
                  <div className="text-xs text-muted-foreground">Hide this transaction from spend summaries.</div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={txn.excluded ? "secondary" : "outline"}
                  onClick={() => patch({ excluded: !txn.excluded })}
                >
                  {txn.excluded ? "Excluded" : "Exclude"}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-6 py-4 bg-background">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Save changes
              </Button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
