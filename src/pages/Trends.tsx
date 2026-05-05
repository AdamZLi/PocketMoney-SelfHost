import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar, X, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { effectiveMonthlyContribution } from "@/lib/treatments";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

// Refined, restrained palette — soft jewel tones rather than saturated primaries.
const PALETTE = [
  "hsl(221 70% 56%)",
  "hsl(160 55% 45%)",
  "hsl(35 85% 58%)",
  "hsl(345 75% 60%)",
  "hsl(265 60% 62%)",
  "hsl(190 65% 48%)",
  "hsl(20 80% 60%)",
  "hsl(140 40% 50%)",
  "hsl(290 50% 60%)",
  "hsl(45 80% 55%)",
  "hsl(210 50% 55%)",
  "hsl(0 65% 62%)",
];
const NEUTRAL = "hsl(var(--muted-foreground) / 0.25)";

type Row = {
  id: string;
  name: string;
  date: string;
  amount: number;
  excluded: boolean;
  account_id: string | null;
  category_id: string | null;
  treatment: string | null;
  treatment_meta: any;
  linked_txn_id: string | null;
  categories: { name: string | null; parent_category: string | null } | null;
};

const monthKey = (d: string) => d.slice(0, 7);
const monthShort = (k: string) => {
  const [y, m] = k.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, {
    month: "short",
  });
};
const monthFull = (k: string) => {
  const [y, m] = k.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
};
const bucketName = (r: Row) =>
  r.categories?.parent_category || r.categories?.name || "Uncategorized";

const Trends = () => {
  const [months, setMonths] = useState(12);
  const [accountId, setAccountId] = useState<string>("all");
  const [categoryBucket, setCategoryBucket] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [showRaw, setShowRaw] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () =>
      (await supabase.from("accounts").select("id,name,mask").order("name")).data ?? [],
  });

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
    queryKey: ["trends", "monthly", range.from, range.to, accountId, showRaw],
    queryFn: async () => {
      // For amortized purchases, we may need data older than the visible range
      // (a flight purchased 6 months ago that amortizes into this month).
      const lookback = new Date(range.from);
      lookback.setMonth(lookback.getMonth() - 24);
      const fetchFrom = lookback.toISOString().slice(0, 10);
      // Paginate to bypass Supabase's default 1000-row cap.
      const PAGE = 1000;
      const all: Row[] = [];
      for (let from = 0; ; from += PAGE) {
        let q = supabase
          .from("transactions")
          .select("id,name,date,amount,excluded,account_id,category_id,treatment,treatment_meta,linked_txn_id,categories(name,parent_category)")
          .gte("date", fetchFrom)
          .lte("date", range.to)
          .order("date", { ascending: true })
          .range(from, from + PAGE - 1);
        if (accountId !== "all") q = q.eq("account_id", accountId);
        const { data, error } = await q;
        if (error) throw error;
        const batch = (data ?? []) as unknown as Row[];
        all.push(...batch);
        if (batch.length < PAGE) break;
      }
      return all;
    },
  });

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
      const cat = bucketName(r);
      // Each row contributes to potentially multiple months (amortization).
      // The helper handles all treatments uniformly.
      for (const mk of buckets) {
        let v: number;
        if (showRaw) {
          if (monthKey(r.date) !== mk) continue;
          const a = Number(r.amount);
          if (!isFinite(a) || a <= 0) continue;
          v = a;
        } else {
          const eff = effectiveMonthlyContribution(
            {
              date: r.date,
              amount: Number(r.amount),
              treatment: (r.treatment as any) ?? "normal",
              treatment_meta: r.treatment_meta ?? {},
              linked_txn_id: r.linked_txn_id,
              excluded: r.excluded,
            },
            mk,
          );
          if (eff <= 0) continue;
          v = eff;
        }
        totals.get(mk)!.set(cat, (totals.get(mk)!.get(cat) ?? 0) + v);
        catTotals.set(cat, (catTotals.get(cat) ?? 0) + v);
      }
    }

    const cats = [...catTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    const totalsByMonth = new Map<string, number>();
    const data = buckets.map((mk) => {
      const row: Record<string, any> = { month: mk, label: monthShort(mk), full: monthFull(mk) };
      let sum = 0;
      for (const c of cats) {
        const v = totals.get(mk)!.get(c) ?? 0;
        row[c] = v;
        sum += v;
      }
      row.__total = sum;
      totalsByMonth.set(mk, sum);
      return row;
    });

    return { chartData: data, categories: cats, totalsByMonth };
  }, [rows, buckets, showRaw]);

  const grandTotal = [...totalsByMonth.values()].reduce((a, b) => a + b, 0);
  const lastTwo = [...totalsByMonth.values()].slice(-2);
  const mom =
    lastTwo.length === 2 && lastTwo[0] > 0
      ? ((lastTwo[1] - lastTwo[0]) / lastTwo[0]) * 100
      : null;

  // Per-category total + monthly series honoring filter (for single-category view)
  const { focusedTotal, focusedAvg } = useMemo(() => {
    const series =
      categoryBucket === "all"
        ? [...totalsByMonth.values()]
        : chartData.map((r: any) => Number(r[categoryBucket]) || 0);
    const total = series.reduce((s, v) => s + v, 0);
    const active = series.filter((v) => v > 0);
    return {
      focusedTotal: total,
      focusedAvg: active.length ? total / active.length : 0,
    };
  }, [categoryBucket, chartData, totalsByMonth]);

  const nonZero = categoryBucket === "all"
    ? [...totalsByMonth.values()].filter((v) => v > 0)
    : chartData.map((r: any) => Number(r[categoryBucket]) || 0).filter((v) => v > 0);

  const dateRangeLabel =
    dateFrom || dateTo
      ? `${dateFrom ? fmtDate(dateFrom) : "…"} → ${dateTo ? fmtDate(dateTo) : "…"}`
      : `Last ${months} months`;

  const activeFilters =
    (accountId !== "all" ? 1 : 0) +
    (categoryBucket !== "all" ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0);

  const handleBarClick = (cat: string) => {
    setCategoryBucket((cur) => (cur === cat ? "all" : cat));
  };

  const renderTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const segs = payload
      .filter((p: any) => !String(p.dataKey ?? "").startsWith("__"))
      .filter((p: any) => Number(p.value) > 0)
      .sort((a: any, b: any) => b.value - a.value);
    const total = segs.reduce((s: number, p: any) => s + Number(p.value), 0);
    const full = chartData.find((r: any) => r.label === label)?.full ?? label;
    return (
      <div className="rounded-xl border border-border/60 bg-background/95 backdrop-blur shadow-xl p-4 min-w-[240px]">
        <div className="flex items-baseline justify-between mb-3 gap-4">
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{full}</span>
          <span className="text-base tabular-nums font-semibold">{fmtCurrency(total)}</span>
        </div>
        <div className="space-y-1.5">
          {segs.map((p: any) => (
            <div key={p.dataKey} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2.5 truncate">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ background: p.color }}
                />
                <span className="truncate text-foreground/80">{p.dataKey}</span>
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

  // Stat block — borderless, type-led
  const Stat = ({
    label, value, sub, accent,
  }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: "up" | "down" }) => (
    <div>
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <div className="text-3xl font-medium tracking-tight tabular-nums">{value}</div>
        {accent === "up" && <ArrowUpRight className="h-4 w-4 text-destructive" />}
        {accent === "down" && <ArrowDownRight className="h-4 w-4 text-emerald-500" />}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-8 py-12">
      {/* Title + range pills */}
      <header className="flex items-end justify-between gap-6 flex-wrap mb-10">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Trends</p>
          <h1 className="text-3xl font-medium tracking-tight mt-2">Spending over time</h1>
        </div>
        {!(dateFrom || dateTo) && (
          <div className="inline-flex items-center rounded-full border border-border/70 bg-muted/30 p-0.5">
            {[3, 6, 12, 24].map((n) => (
              <button
                key={n}
                onClick={() => setMonths(n)}
                className={`h-7 px-3 rounded-full text-xs font-medium tabular-nums transition-colors ${
                  months === n
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {n}M
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Filters — quiet ghost row */}
      <div className="flex items-center gap-1 flex-wrap mb-12 -ml-2 text-sm">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 text-muted-foreground hover:text-foreground font-normal">
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

        <span className="text-border">·</span>

        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="h-8 w-auto gap-2 border-0 bg-transparent text-muted-foreground hover:text-foreground font-normal focus:ring-0 px-2">
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

        <span className="text-border">·</span>

        <Select value={categoryBucket} onValueChange={setCategoryBucket}>
          <SelectTrigger className="h-8 w-auto gap-2 border-0 bg-transparent text-muted-foreground hover:text-foreground font-normal focus:ring-0 px-2">
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
          <>
            <span className="text-border">·</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground hover:text-foreground font-normal"
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
          </>
        )}
      </div>

      {/* Stats — borderless, type-led, clean spacing */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-12 mb-14 pb-12 border-b border-border/60">
        <Stat
          label={categoryBucket === "all" ? "Total spend" : categoryBucket}
          value={fmtCurrency(focusedTotal)}
          sub={`${buckets.length} ${buckets.length === 1 ? "month" : "months"}`}
        />
        <Stat
          label="Monthly average"
          value={fmtCurrency(focusedAvg)}
          sub={nonZero.length ? `across ${nonZero.length} active months` : "no activity"}
        />
        <Stat
          label="Month over month"
          value={mom == null ? "—" : `${mom > 0 ? "+" : ""}${mom.toFixed(1)}%`}
          accent={mom == null ? undefined : mom > 0 ? "up" : "down"}
          sub="vs previous month"
        />
      </div>

      {/* Chart — no card chrome */}
      <section>
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="text-base font-medium">
              {categoryBucket === "all" ? "By category" : categoryBucket}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {categoryBucket === "all"
                ? "Click a segment to focus a category"
                : "Showing one category — others dimmed"}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Switch checked={showRaw} onCheckedChange={setShowRaw} />
            Show raw (one-off & full lump sums)
          </label>
        </div>

        {isLoading ? (
          <div className="h-[420px] flex items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : categories.length === 0 ? (
          <div className="h-[420px] flex items-center justify-center text-sm text-muted-foreground">
            No transactions in this range.
          </div>
        ) : (
          <>
            <div className="h-[420px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 24, right: 8, bottom: 8, left: 0 }}
                  barCategoryGap="28%"
                >
                  <CartesianGrid
                    strokeDasharray="2 4"
                    stroke="hsl(var(--border))"
                    vertical={false}
                    strokeOpacity={0.6}
                  />
                  <XAxis
                    dataKey="label"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    dy={8}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tickCount={5}
                    tickFormatter={(v) =>
                      v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v)
                    }
                  />
                  <Tooltip
                    content={renderTooltip}
                    cursor={{ fill: "hsl(var(--muted) / 0.35)", radius: 6 }}
                  />
                  {categories.map((c, i) => {
                    const dim = categoryBucket !== "all" && categoryBucket !== c;
                    const color = dim ? NEUTRAL : PALETTE[i % PALETTE.length];
                    return (
                      <Bar
                        key={c}
                        dataKey={c}
                        stackId="exp"
                        fill={color}
                        radius={i === categories.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                        maxBarSize={44}
                        cursor="pointer"
                        onClick={() => handleBarClick(c)}
                        isAnimationActive={false}
                      />
                    );
                  })}
                  {categoryBucket === "all" && (
                    <Line
                      type="monotone"
                      dataKey="__total"
                      name="Total"
                      stroke="hsl(var(--foreground))"
                      strokeWidth={1.5}
                      strokeDasharray="3 4"
                      dot={{ r: 2.5, fill: "hsl(var(--foreground))", strokeWidth: 0 }}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  )}
                  {categoryBucket !== "all" && categories.map((c, i) => {
                    if (c !== categoryBucket) return null;
                    return (
                      <Line
                        key={`line-${c}`}
                        type="monotone"
                        dataKey={c}
                        stroke={PALETTE[i % PALETTE.length]}
                        strokeWidth={1.5}
                        strokeDasharray="3 4"
                        dot={{ r: 2.5, fill: PALETTE[i % PALETTE.length], strokeWidth: 0 }}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                      />
                    );
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Custom legend — clickable chips, ordered by total */}
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
              {categories.map((c, i) => {
                const active = categoryBucket === "all" || categoryBucket === c;
                return (
                  <button
                    key={c}
                    onClick={() => handleBarClick(c)}
                    className={`group inline-flex items-center gap-2 text-xs transition-opacity ${
                      active ? "opacity-100" : "opacity-40 hover:opacity-70"
                    }`}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: PALETTE[i % PALETTE.length] }}
                    />
                    <span className="text-foreground/80 group-hover:text-foreground">{c}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
};

export default Trends;
