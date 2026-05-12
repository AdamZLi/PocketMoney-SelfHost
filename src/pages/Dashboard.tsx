import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, fmtMonthYear } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { TrendingDown, Wallet, Tag, ArrowUpRight, Pencil } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { effectiveMonthlyContribution, type Treatment, type TreatmentMeta } from "@/lib/treatments";
import { CategoryCombobox } from "@/components/CategoryCombobox";
import { TreatmentPicker } from "@/components/TreatmentPicker";
import { toast } from "@/hooks/use-toast";

const Dashboard = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const { data: txns = [] } = useQuery({
    queryKey: ["txns", "month", monthStart],
    queryFn: async () => {
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

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("id,name,parent_category").order("name")).data ?? [],
  });

  const { data: recent = [] } = useQuery({
    queryKey: ["txns", "recent-to-review"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id,date,name,amount,reviewed,reviewed_at,treatment,treatment_meta,category_id,categories(name,color),accounts(name,mask)")
        .eq("reviewed", false)
        .order("date", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function updateField(id: string, field: string, oldVal: any, newVal: any) {
    const { error } = await supabase.from("transactions").update({ [field]: newVal } as any).eq("id", id);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    await supabase.from("transaction_edits").insert({
      transaction_id: id, field_changed: field, old_value: oldVal, new_value: newVal,
    });
    qc.invalidateQueries({ queryKey: ["txns"] });
  }

  async function updateTreatment(id: string, treatment: Treatment, meta: TreatmentMeta) {
    const { error } = await supabase
      .from("transactions")
      .update({ treatment, treatment_meta: meta as any } as any)
      .eq("id", id);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    await supabase.from("transaction_edits").insert({
      transaction_id: id, field_changed: "treatment", old_value: null, new_value: treatment,
    });
    qc.invalidateQueries({ queryKey: ["txns"] });
  }

  async function toggleReviewed(id: string, next: boolean) {
    const { error } = await supabase
      .from("transactions")
      .update({ reviewed: next, reviewed_at: next ? new Date().toISOString() : null } as any)
      .eq("id", id);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["txns"] });
  }

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
    <div className="p-6 xl:p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <p className="text-sm text-muted-foreground">{fmtMonthYear(now)}</p>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="min-w-0">
          <CardHeader className="pb-2 p-4 xl:p-6 xl:pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <TrendingDown className="h-4 w-4" /> Spent this month
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 xl:p-6 xl:pt-0">
            <div className="text-2xl xl:text-3xl font-semibold">{fmtCurrency(total)}</div>
            <p className="text-xs text-muted-foreground mt-1">{txns.length} transactions</p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="pb-2 p-4 xl:p-6 xl:pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Tag className="h-4 w-4" /> Top category
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 xl:p-6 xl:pt-0">
            <div className="text-2xl font-semibold truncate">{parentList[0]?.[0] ?? "—"}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {parentList[0] ? fmtCurrency(parentList[0][1]) : "No data yet"}
            </p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="pb-2 p-4 xl:p-6 xl:pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Categories tracked
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 xl:p-6 xl:pt-0">
            <div className="text-2xl xl:text-3xl font-semibold">{parentList.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="hidden xl:inline">parent groups this month</span>
              <span className="xl:hidden">groups</span>
            </p>
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
              <div className="flex justify-between text-sm mb-1 gap-2">
                <span className="font-medium truncate max-w-[160px] xl:max-w-[240px]" title={name}>{name}</span>
                <span className="text-muted-foreground shrink-0">{fmtCurrency(val)}</span>
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
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Recent transactions to review</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Latest unreviewed transactions. Check them off as you go.
            </p>
          </div>
          <Link
            to="/transactions"
            className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            View all <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">All caught up — nothing left to review.</p>
          ) : (
            (() => {
              const today = new Date(); today.setHours(0, 0, 0, 0);
              const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
              const dayLabel = (dk: string) => {
                const [y, m, d] = dk.split("-").map(Number);
                const dt = new Date(y, m - 1, d);
                if (dt.getTime() === today.getTime()) return "Today";
                if (dt.getTime() === yesterday.getTime()) return "Yesterday";
                return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
              };
              const days = new Map<string, any[]>();
              for (const t of recent as any[]) {
                const dk = String(t.date).slice(0, 10);
                if (!days.has(dk)) days.set(dk, []);
                days.get(dk)!.push(t);
              }
              const GRID_WIDE = "grid-cols-[24px_1fr_180px_140px_120px_28px]";
              const GRID_NARROW = "grid-cols-[24px_1fr_140px_100px_28px]";
              return (
                <div className="@container">
                  {[...days.entries()].map(([dk, rows]) => (
                    <div key={dk}>
                      <div className="px-1 pt-4 pb-2 first:pt-0">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {dayLabel(dk)}
                        </span>
                      </div>
                      {rows.map((t: any) => (
                        <div
                          key={t.id}
                          className={`group grid ${GRID_NARROW} @[800px]:${GRID_WIDE} gap-4 px-1 py-2.5 border-b border-border/40 items-center hover:bg-muted/20 transition-colors`}
                        >
                          <Checkbox
                            checked={!!t.reviewed}
                            onCheckedChange={(v) => toggleReviewed(t.id, !!v)}
                            title="Mark as reviewed"
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate" title={t.name}>{t.name}</div>
                            {t.accounts?.name && (
                              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                                {t.accounts.name}{t.accounts.mask ? ` ····${t.accounts.mask}` : ""}
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <CategoryCombobox
                              value={t.category_id}
                              categories={categories as any}
                              onChange={(v) => updateField(t.id, "category_id", t.category_id, v)}
                            />
                          </div>
                          <div className="hidden @[800px]:block">
                            <TreatmentPicker
                              treatment={(t.treatment ?? "normal") as Treatment}
                              meta={(t.treatment_meta ?? {}) as TreatmentMeta}
                              amount={Number(t.amount)}
                              date={t.date}
                              onSave={(treatment, meta) => updateTreatment(t.id, treatment, meta)}
                            />
                          </div>
                          <div className="text-sm font-medium tabular-nums text-right">
                            {fmtCurrency(Number(t.amount))}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                            onClick={() => navigate(`/transactions?edit=${t.id}`)}
                            title="Edit transaction"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })()
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
