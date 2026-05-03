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

const Transactions = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState<string>("all");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [showExcluded, setShowExcluded] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await supabase.from("accounts").select("id,name,mask").order("name")).data ?? [],
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("id,name,parent_category").order("name")).data ?? [],
  });

  const { data: txns = [] } = useQuery({
    queryKey: ["txns", { search, accountId, categoryId, showExcluded }],
    queryFn: async () => {
      let q = supabase
        .from("transactions")
        .select("id,date,name,amount,status,excluded,note,category_id,account_id,categories(name,color),accounts(name,mask)")
        .order("date", { ascending: false })
        .limit(500);
      if (accountId !== "all") q = q.eq("account_id", accountId);
      if (categoryId !== "all") q = q.eq("category_id", categoryId);
      if (!showExcluded) q = q.eq("excluded", false);
      if (search) q = q.ilike("name", `%${search}%`);
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
    const { error } = await supabase.from("transactions").update({ [field]: newVal }).eq("id", id);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    await supabase.from("transaction_edits").insert({
      transaction_id: id, field_changed: field, old_value: oldVal, new_value: newVal,
    });
    qc.invalidateQueries({ queryKey: ["txns"] });
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground mt-1">{txns.length} rows · {fmtCurrency(total)} total</p>
        </div>
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b">
                <tr>
                  <th className="px-4 py-3 w-28">Date</th>
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
                  <tr key={t.id} className="hover:bg-muted/40">
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
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No transactions match.</td></tr>
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
