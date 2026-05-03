import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar, X } from "lucide-react";
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
  account_id: string | null;
  category_id: string | null;
  categories: { name: string | null; parent_category: string | null } | null;
};

const monthKey = (d: string) => d.slice(0, 7);
const monthLabel = (k: string) => {
  const [y, m] = k.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });
};
const bucketName = (r: Row) =>
  r.categories?.parent_category || r.categories?.name || "Uncategorized";

const Trends = () => {
  const [months, setMonths] = useState(12);
  const [accountId, setAccountId] = useState<string>("all");
  const [categoryBucket, setCategoryBucket] = useState<string>("all"); // by display bucket name
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () =>
      (await supabase.from("accounts").select("id,name,mask").order("name")).data ?? [],
  });

  // Effective range
  const range = useMemo(() => {
    if (dateFrom || dateTo) {
      const from =
        dateFrom ||
        new Date(new Date().getFullYear() - 5, 0, 1).toISOString().slice(0, 10);
      const to = dateTo || new Date().toISOString().slice(0, 10);
      return { from, to };
    }
    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1));
    since.setDate(1);
    return { from: since.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };
  }, [months, dateFrom, dateTo]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["trends", "monthly", range.from, range.to, accountId],
    queryFn: async () => {
      let q = supabase
        .from("transactions")
        .select("date,amount,excluded,account_id,category_id,categories(name,parent_category)")
        .gte("date", range.from)
        .lte("date", range.to)
        .eq("excluded", false)
        .order("date", { ascending: true });
      if (accountId !== "all") q = q.eq("account_id", accountId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  // Build month buckets for the effective range.
  const buckets = useMemo(() => {
    const out: string[] = [];
    const f = new Date(range.from);
    const t = new Date(range.to);
    const cur = new Date(f.getFullYear(), f.getMonth(), 1);
    const end = new Date(t.getFullYear(), t.getMonth(), 1);
    while (cur <= end) {
      out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }, [range.from, range.to]);

  // All available bucket names (independent of categoryBucket filter, so the dropdown is stable).
  const allBuckets = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of rows) {
      const a = Number(r.amount);
      if (!isFinite(a) || a <= 0) continue;
      const b = bucketName(r);
      totals.set(b, (totals.get(b) ?? 0) + a);
    }
    return [...totals.entries()].sort((x, y) => y[1] - x[1]).map(([n]) => n);
  }, [rows]);

  const { chartData, categories, totalsByMonth } = useMemo(() => {
    const totals = new Map<string, Map<string, number>>();
    const catTotals = new Map<string, number>();
    for (const m of buckets) totals.set(m, new Map());

    for (const r of rows) {
      const amt = Number(r.amount);
      if (!isFinite(amt) || amt <= 0) continue;
      const k = monthKey(r.date);
      if (!totals.has(k)) continue;
      const cat = bucketName(r);
      totals.get(k)!.set(cat, (totals.get(k)!.get(cat) ?? 0) + amt);
      catTotals.set(cat, (catTotals.get(cat) ?? 0) + amt);
    }

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
        row[`__top__${c}`] = cum;
      }
      row.__total = sum;
      totalsByMonth.set(mk, sum);
      return row;
    });

    return { chartData: data, categories: cats, totalsByMonth };
  }, [rows, buckets, categoryBucket]);

  const grandTotal = [...totalsByMonth.values()].reduce((a, b) => a + b, 0);
  const nonZero = [...totalsByMonth.values()].filter((v) => v > 0);
  const avg = nonZero.length ? grandTotal / nonZero.length : 0;
  const lastTwo = [...totalsByMonth.values()].slice(-2);
  const mom =
    lastTwo.length === 2 && lastTwo[0] > 0
      ? ((lastTwo[1] - lastTwo[0]) / lastTwo[0]) * 100
      : null;

  const dateRangeLabel =
    dateFrom || dateTo
      ? `${dateFrom ? fmtDate(dateFrom) : "…"} → ${dateTo ? fmtDate(dateTo) : "…"}`
      : `Last ${months}m`;

  const activeFilters =
    (accountId !== "all" ? 1 : 0) +
    (categoryBucket !== "all" ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0);

  const renderTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const segs = payload
      .filter((p: any) => !p.dataKey?.startsWith?.("__"))
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
        <div className="mt-2 pt-2 border-t text-[10px] uppercase tracking-wider text-muted-foreground">
          Click a segment to filter
        </div>
      </div>
    );
  };

  const handleBarClick = (cat: string) => {
    setCategoryBucket((cur) => (cur === cat ? "all" : cat));
  };

  return (
    <div className="max-w-7xl mx-auto px-8 py-12 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm text-muted-foreground">Visualizations</p>
          <h1 className="text-2xl font-medium tracking-tight">Spending trends</h1>
        </div>
        {dateFrom || dateTo ? null : (
          <div className="flex items-center gap-1 text-sm">
            <span className="text-muted-foreground mr-1">Range</span>
            {[3, 6, 12, 24].map((n) => (
              <button
                key={n}
                onClick={() => setMonths(n)}
                className={`h-8 px-3 rounded-md text-sm transition-colors ${
                  months === n
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted/60"
                }`}
              >
                {n}m
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Filter toolbar — mirrors Transactions */}
      <div className="flex items-center gap-2 flex-wrap">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-9 text-muted-foreground font-normal">
              <Calendar className="h-3.5 w-3.5 mr-2" />
              {dateRangeLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9" />
            </div>
            {(dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => { setDateFrom(""); setDateTo(""); }}
              >
                Clear custom range
              </Button>
            )}
          </PopoverContent>
        </Popover>

        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="h-9 w-auto gap-2 border-0 bg-transparent text-muted-foreground font-normal hover:bg-muted/50 focus:ring-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All accounts</SelectItem>
            {accounts.map((a: any) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}{a.mask ? ` ····${a.mask}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={categoryBucket} onValueChange={setCategoryBucket}>
          <SelectTrigger className="h-9 w-auto gap-2 border-0 bg-transparent text-muted-foreground font-normal hover:bg-muted/50 focus:ring-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {allBuckets.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {activeFilters > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-muted-foreground"
            onClick={() => {
              setAccountId("all");
              setCategoryBucket("all");
              setDateFrom("");
              setDateTo("");
            }}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Reset
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Total ({buckets.length}m)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">{fmtCurrency(grandTotal)}</div>
            {categoryBucket !== "all" && (
              <p className="text-xs text-muted-foreground mt-1 truncate">in {categoryBucket}</p>
            )}
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
            <p className="text-xs text-muted-foreground mt-1">vs previous month</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>
            {categoryBucket === "all"
              ? "Monthly expenditure by category"
              : `Monthly expenditure · ${categoryBucket}`}
          </CardTitle>
          {categoryBucket !== "all" && (
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setCategoryBucket("all")}>
              <X className="h-3.5 w-3.5 mr-1" /> Show all categories
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[460px] flex items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : categories.length === 0 ? (
            <div className="h-[460px] flex items-center justify-center text-sm text-muted-foreground">
              No transactions in this range.
            </div>
          ) : (
            <div className="h-[480px] w-full">
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
                  <Tooltip content={renderTooltip} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} />
                  {categories.map((c, i) => (
                    <Bar
                      key={c}
                      dataKey={c}
                      stackId="exp"
                      fill={PALETTE[i % PALETTE.length]}
                      radius={i === categories.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                      maxBarSize={56}
                      cursor="pointer"
                      onClick={() => handleBarClick(c)}
                    />
                  ))}
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
                    wrapperStyle={{ fontSize: 12, paddingTop: 12, cursor: "pointer" }}
                    payload={categories.map((c, i) => ({
                      value: c,
                      type: "square",
                      id: c,
                      color: PALETTE[i % PALETTE.length],
                      dataKey: c,
                    }))}
                    onClick={(e: any) => e?.dataKey && handleBarClick(String(e.dataKey))}
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
