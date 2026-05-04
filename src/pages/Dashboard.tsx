import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, fmtDate, fmtMonthYear } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingDown, Wallet, Tag } from "lucide-react";
import { effectiveMonthlyContribution } from "@/lib/treatments";

const Dashboard = () => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const { data: txns = [] } = useQuery({
    queryKey: ["txns", "month", monthStart],
    queryFn: async () => {
      // Look back 24 months to capture amortized purchases that contribute to this month.
      const lookback = new Date(now.getFullYear(), now.getMonth() - 24, 1).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("transactions")
        .select("id,date,name,amount,excluded,treatment,treatment_meta,linked_txn_id,category_id,categories(name,parent_category,color)")
        .gte("date", lookback)
        .order("date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: recent = [] } = useQuery({
    queryKey: ["txns", "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id,date,name,amount,categories(name,color),accounts(name,mask)")
        .order("date", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  const monthIso = monthStart.slice(0, 7);
  let total = 0;
  const byParent = new Map<string, number>();
  for (const t of txns as any[]) {
    const eff = effectiveMonthlyContribution(
      {
        date: t.date,
        amount: Number(t.amount),
        treatment: t.treatment,
        treatment_meta: t.treatment_meta,
        linked_txn_id: t.linked_txn_id,
        excluded: t.excluded,
      },
      monthIso,
    );
    if (eff <= 0) continue;
    total += eff;
    const p = t.categories?.parent_category ?? t.categories?.name ?? "Uncategorized";
    byParent.set(p, (byParent.get(p) ?? 0) + eff);
  }
  const parentList = [...byParent.entries()].sort((a, b) => b[1] - a[1]);
  const maxParent = parentList[0]?.[1] ?? 1;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <p className="text-sm text-muted-foreground">{fmtMonthYear(now)}</p>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <TrendingDown className="h-4 w-4" /> Spent this month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{fmtCurrency(total)}</div>
            <p className="text-xs text-muted-foreground mt-1">{txns.length} transactions</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Tag className="h-4 w-4" /> Top category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{parentList[0]?.[0] ?? "—"}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {parentList[0] ? fmtCurrency(parentList[0][1]) : "No data yet"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Categories tracked
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{parentList.length}</div>
            <p className="text-xs text-muted-foreground mt-1">parent groups this month</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Spend by parent category</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {parentList.length === 0 && (
            <p className="text-sm text-muted-foreground">Import a file or add transactions to see breakdown.</p>
          )}
          {parentList.map(([name, val]) => (
            <div key={name}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium">{name}</span>
                <span className="text-muted-foreground">{fmtCurrency(val)}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full"
                  style={{ width: `${(val / maxParent) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent transactions</CardTitle></CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            <div className="divide-y">
              {(recent as any[]).map((t) => (
                <div key={t.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="font-medium text-sm">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(t.date)} · {t.accounts?.name ?? "—"}{t.accounts?.mask ? ` ····${t.accounts.mask}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium tabular-nums">{fmtCurrency(Number(t.amount))}</div>
                    <div className="text-xs text-muted-foreground">{t.categories?.name ?? "Uncategorized"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
