import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

// Distinct, theme-friendly palette (HSL strings).
const PALETTE = [
  "hsl(217 91% 60%)",
  "hsl(142 71% 45%)",
  "hsl(38 92% 50%)",
  "hsl(346 87% 60%)",
  "hsl(262 83% 65%)",
  "hsl(173 80% 40%)",
  "hsl(24 95% 58%)",
  "hsl(199 89% 55%)",
  "hsl(291 64% 58%)",
  "hsl(84 65% 50%)",
  "hsl(0 72% 60%)",
  "hsl(45 93% 47%)",
];

type Row = {
  date: string;
  amount: number;
  excluded: boolean;
  categories: { name: string | null; parent_category: string | null } | null;
};

const monthKey = (d: string) => d.slice(0, 7); // YYYY-MM
const monthLabel = (k: string) => {
  const [y, m] = k.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });
};

const Trends = () => {
  const [months, setMonths] = useState(12);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["trends", "monthly", months],
    queryFn: async () => {
      const since = new Date();
      since.setMonth(since.getMonth() - (months - 1));
      since.setDate(1);
      const sinceStr = since.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("transactions")
        .select("date,amount,excluded,categories(name,parent_category)")
        .gte("date", sinceStr)
        .eq("excluded", false)
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const { chartData, categories, totalsByMonth } = useMemo(() => {
    // Build all month buckets (even empty ones).
    const buckets: string[] = [];
    const start = new Date();
    start.setMonth(start.getMonth() - (months - 1));
    start.setDate(1);
    for (let i = 0; i < months; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      buckets.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    const totals = new Map<string, Map<string, number>>(); // month -> cat -> sum
    const catTotals = new Map<string, number>();
    for (const m of buckets) totals.set(m, new Map());

    for (const r of rows) {
      const amt = Number(r.amount);
      if (!isFinite(amt) || amt <= 0) continue; // expenditures only (positive amount)
      const k = monthKey(r.date);
      if (!totals.has(k)) continue;
      const cat =
        r.categories?.parent_category ||
        r.categories?.name ||
        "Uncategorized";
      const m = totals.get(k)!;
      m.set(cat, (m.get(cat) ?? 0) + amt);
      catTotals.set(cat, (catTotals.get(cat) ?? 0) + amt);
    }

    // Order categories by overall size (desc) so largest stacks at the bottom.
    const cats = [...catTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    const totalsByMonth = new Map<string, number>();
    const data = buckets.map((mk) => {
      const row: Record<string, any> = { month: mk, label: monthLabel(mk) };
      let sum = 0;
      let cum = 0;
      for (const c of cats) {
        const v = totals.get(mk)!.get(c) ?? 0;
        row[c] = v;
        sum += v;
        cum += v;
        // Cumulative top-edge of each stacked segment — used for dotted trend lines.
        row[`__top__${c}`] = cum;
      }
      row.__total = sum;
      totalsByMonth.set(mk, sum);
      return row;
    });

    return { chartData: data, categories: cats, totalsByMonth };
  }, [rows, months]);

  const grandTotal = [...totalsByMonth.values()].reduce((a, b) => a + b, 0);
  const avg = totalsByMonth.size ? grandTotal / totalsByMonth.size : 0;
  const lastTwo = [...totalsByMonth.values()].slice(-2);
  const mom =
    lastTwo.length === 2 && lastTwo[0] > 0
      ? ((lastTwo[1] - lastTwo[0]) / lastTwo[0]) * 100
      : null;

  const renderTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    // Only the bar segments (not the dotted top-edge lines).
    const segs = payload
      .filter((p: any) => !p.dataKey?.startsWith("__"))
      .filter((p: any) => Number(p.value) > 0)
      .sort((a: any, b: any) => b.value - a.value);
    const total = segs.reduce((s: number, p: any) => s + Number(p.value), 0);
    return (
      <div className="rounded-md border bg-popover text-popover-foreground shadow-md p-3 min-w-[220px]">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-sm font-semibold">{label}</span>
          <span className="text-sm tabular-nums font-medium">{fmtCurrency(total)}</span>
        </div>
        <div className="space-y-1">
          {segs.map((p: any) => (
            <div key={p.dataKey} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 truncate">
                <span
                  className="inline-block h-2 w-2 rounded-sm shrink-0"
                  style={{ background: p.color }}
                />
                <span className="truncate">{p.dataKey}</span>
              </span>
              <span className="tabular-nums text-muted-foreground ml-3">
                {fmtCurrency(Number(p.value))}
              </span>
            </div>
          ))}
          {segs.length === 0 && (
            <div className="text-xs text-muted-foreground">No spend</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm text-muted-foreground">Visualizations</p>
          <h1 className="text-3xl font-semibold tracking-tight">Spending trends</h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Range</span>
          {[6, 12, 24].map((n) => (
            <button
              key={n}
              onClick={() => setMonths(n)}
              className={`h-8 px-3 rounded-md border transition-colors ${
                months === n
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted/50"
              }`}
            >
              {n}m
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Total ({months}m)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">{fmtCurrency(grandTotal)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Monthly average
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">{fmtCurrency(avg)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Month-over-month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-semibold tabular-nums ${
                mom == null ? "" : mom > 0 ? "text-destructive" : "text-primary"
              }`}
            >
              {mom == null ? "—" : `${mom > 0 ? "+" : ""}${mom.toFixed(1)}%`}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              vs previous month
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Monthly expenditure by category</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[420px] flex items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : categories.length === 0 ? (
            <div className="h-[420px] flex items-center justify-center text-sm text-muted-foreground">
              No transactions in this range yet.
            </div>
          ) : (
            <div className="h-[460px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 16, right: 24, bottom: 8, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) =>
                      v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                    }
                  />
                  <Tooltip
                    content={renderTooltip}
                    cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                  />
                  {categories.map((c, i) => (
                    <Bar
                      key={c}
                      dataKey={c}
                      stackId="exp"
                      fill={PALETTE[i % PALETTE.length]}
                      radius={
                        i === categories.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]
                      }
                      maxBarSize={56}
                    />
                  ))}
                  {/* Dotted lines connecting each category's stacked top edge across months. */}
                  {categories.map((c, i) => (
                    <Line
                      key={`line-${c}`}
                      type="monotone"
                      dataKey={`__top__${c}`}
                      stroke={PALETTE[i % PALETTE.length]}
                      strokeWidth={1.25}
                      strokeDasharray="3 3"
                      dot={false}
                      activeDot={false}
                      legendType="none"
                      isAnimationActive={false}
                    />
                  ))}
                  <Legend
                    verticalAlign="bottom"
                    iconType="square"
                    wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Trends;
