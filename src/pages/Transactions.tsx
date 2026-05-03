import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const Transactions = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState<string>("all");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [showExcluded, setShowExcluded] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await supabase.from("accounts").select("id,name,mask").order("name")).data ?? [],
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("id,name,parent_category").order("name")).data ?? [],
  });

  const { data: txns = [] } = useQuery({
    queryKey: ["txns", { search, accountId, categoryId, showExcluded, dateFrom, dateTo, sortDir }],
    queryFn: async () => {
      let q = supabase
        .from("transactions")
        .select("id,date,name,amount,status,excluded,note,category_id,account_id,categories(name,color),accounts(name,mask)")
        .order("date", { ascending: sortDir === "asc" })
        .limit(500);
      if (accountId !== "all") q = q.eq("account_id", accountId);
      if (categoryId !== "all") q = q.eq("category_id", categoryId);
      if (!showExcluded) q = q.eq("excluded", false);
      if (search) q = q.ilike("name", `%${search}%`);
      if (dateFrom) q = q.gte("date", dateFrom);
      if (dateTo) q = q.lte("date", dateTo);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const total = useMemo(
    () => (txns as any[]).filter(t => !t.excluded).reduce((s, t) => s + Number(t.amount), 0),
    [txns]
  );

  async function updateField(id: string, field: string, oldVal: any, newVal: any) {
    const { error } = await supabase.from("transactions").update({ [field]: newVal } as any).eq("id", id);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    await supabase.from("transaction_edits").insert({
      transaction_id: id, field_changed: field, old_value: oldVal, new_value: newVal,
    });
    qc.invalidateQueries({ queryKey: ["txns"] });
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }
  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set((txns as any[]).map(t => t.id)) : new Set());
  }

  async function deleteSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    // transaction_tags / transaction_edits cascade via FK ON DELETE CASCADE on transaction_id (edits has no FK; clean it manually)
    await supabase.from("transaction_edits").delete().in("transaction_id", ids);
    await supabase.from("transaction_tags").delete().in("transaction_id", ids);
    const { error } = await supabase.from("transactions").delete().in("id", ids);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Deleted ${ids.length} transaction${ids.length === 1 ? "" : "s"}` });
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["txns"] });
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground mt-1">{txns.length} rows · {fmtCurrency(total)} total</p>
        </div>
        {selected.size > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="h-4 w-4 mr-1" />
                Delete {selected.size} selected
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {selected.size} transaction{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the selected rows along with their tags and edit history. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={deleteSelected}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Input placeholder="Search merchant…" value={search} onChange={e => setSearch(e.target.value)} />
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Account" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All accounts</SelectItem>
                {accounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}{a.mask ? ` ····${a.mask}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={showExcluded} onCheckedChange={v => setShowExcluded(!!v)} />
              Show excluded
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3 items-center">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From</label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <div className="flex gap-2 md:col-span-2 md:justify-end pt-5">
              {(dateFrom || dateTo) && (
                <button
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                  onClick={() => { setDateFrom(""); setDateTo(""); }}
                >
                  Clear date range
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <Checkbox
                      checked={txns.length > 0 && selected.size === txns.length}
                      onCheckedChange={(v) => toggleAll(!!v)}
                    />
                  </th>
                  <th className="px-4 py-3 w-32">
                    <button
                      type="button"
                      onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      Date {sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                    </button>
                  </th>
                  <th className="px-4 py-3">Merchant</th>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-center">Excluded</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(txns as any[]).map((t) => (
                  <tr key={t.id} className={`hover:bg-muted/40 ${selected.has(t.id) ? "bg-muted/30" : ""}`}>
                    <td className="px-4 py-2.5">
                      <Checkbox
                        checked={selected.has(t.id)}
                        onCheckedChange={(v) => toggleOne(t.id, !!v)}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(t.date)}</td>
                    <td className="px-4 py-2.5 font-medium">{t.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {t.accounts?.name ?? "—"}{t.accounts?.mask ? ` ····${t.accounts.mask}` : ""}
                    </td>
                    <td className="px-4 py-2.5">
                      <Select
                        value={t.category_id ?? "none"}
                        onValueChange={(v) => updateField(t.id, "category_id", t.category_id, v === "none" ? null : v)}
                      >
                        <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— None —</SelectItem>
                          {categories.map((c: any) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={t.status === "pending" ? "outline" : "secondary"}>{t.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtCurrency(Number(t.amount))}</td>
                    <td className="px-4 py-2.5 text-center">
                      <Checkbox
                        checked={t.excluded}
                        onCheckedChange={(v) => updateField(t.id, "excluded", t.excluded, !!v)}
                      />
                    </td>
                  </tr>
                ))}
                {txns.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No transactions match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Transactions;
