import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar, X, ArrowUpRight, ArrowDownRight, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { CategoryCombobox } from "@/components/CategoryCombobox";
import { TreatmentPicker } from "@/components/TreatmentPicker";
import type { Treatment, TreatmentMeta } from "@/lib/treatments";
import { toast } from "@/hooks/use-toast";
import { effectiveMonthlyContribution } from "@/lib/treatments";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Treemap,
} from "recharts";

type RangeKey = "3" | "6" | "12" | "ytd" | "all";

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
  reviewed: boolean;
  reviewed_at: string | null;
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
  const [rangeKey, setRangeKey] = useState<RangeKey>("12");
  const [accountId, setAccountId] = useState<string>("all");
  const [categoryBucket, setCategoryBucket] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [showRaw, setShowRaw] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const qc = useQueryClient();

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () =>
      (await supabase.from("accounts").select("id,name,mask").order("name")).data ?? [],
  });

  const { data: categoriesList = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () =>
      (await supabase.from("categories").select("id,name,parent_category").order("name")).data ?? [],
  });

  const { data: minDateRow } = useQuery({
    queryKey: ["txn-min-date"],
    queryFn: async () => {
      const { data } = await supabase.from("transactions").select("date").order("date", { ascending: true }).limit(1);
      return data?.[0]?.date as string | undefined;
    },
  });

  const range = useMemo(() => {
    if (dateFrom || dateTo) {
      const from =
        dateFrom ||
        new Date(new Date().getFullYear() - 5, 0, 1).toISOString().slice(0, 10);
      const to = dateTo || new Date().toISOString().slice(0, 10);
      return { from, to };
    }
    const today = new Date();
    const to = today.toISOString().slice(0, 10);
    if (rangeKey === "ytd") {
      return { from: new Date(today.getFullYear(), 0, 1).toISOString().slice(0, 10), to };
    }
    if (rangeKey === "all") {
      return { from: minDateRow ?? new Date(2000, 0, 1).toISOString().slice(0, 10), to };
    }
    const n = Number(rangeKey);
    const since = new Date(today);
    since.setMonth(since.getMonth() - (n - 1));
    since.setDate(1);
    return { from: since.toISOString().slice(0, 10), to };
  }, [rangeKey, dateFrom, dateTo, minDateRow]);

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
          .select("id,name,date,amount,excluded,account_id,category_id,treatment,treatment_meta,linked_txn_id,reviewed,reviewed_at,categories(name,parent_category)")
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

  const rangeLabelMap: Record<RangeKey, string> = {
    "3": "Last 3 months", "6": "Last 6 months", "12": "Last 12 months", ytd: "Year to date", all: "All time",
  };
  const dateRangeLabel =
    dateFrom || dateTo
      ? `${dateFrom ? fmtDate(dateFrom) : "…"} → ${dateTo ? fmtDate(dateTo) : "…"}`
      : rangeLabelMap[rangeKey];

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
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Visualization</p>
          <h1 className="text-3xl font-medium tracking-tight mt-2">Spending over time</h1>
        </div>
        {!(dateFrom || dateTo) && (
          <div className="inline-flex items-center rounded-full border border-border/70 bg-muted/30 p-0.5">
            {([
              { k: "3", label: "3M" },
              { k: "6", label: "6M" },
              { k: "12", label: "12M" },
              { k: "ytd", label: "YTD" },
              { k: "all", label: "All time" },
            ] as { k: RangeKey; label: string }[]).map(({ k, label }) => (
              <button
                key={k}
                onClick={() => setRangeKey(k)}
                className={`h-7 px-3 rounded-full text-xs font-medium tabular-nums transition-colors ${
                  rangeKey === k
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
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
                  onClick={(e: any) => {
                    const lbl = e?.activeLabel;
                    if (!lbl) return;
                    const row = chartData.find((r: any) => r.label === lbl);
                    if (row?.month) setSelectedMonth(row.month);
                  }}
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
                    interval={0}
                    tick={({ x, y, payload }: any) => {
                      const row = chartData.find((r: any) => r.label === payload.value);
                      const isActive = row?.month && selectedMonth === row.month;
                      return (
                        <g
                          transform={`translate(${x},${y})`}
                          style={{ cursor: "pointer" }}
                          onClick={() => row?.month && setSelectedMonth(row.month)}
                        >
                          <rect x={-22} y={-2} width={44} height={20} fill="transparent" />
                          <text
                            x={0}
                            y={12}
                            textAnchor="middle"
                            fontSize={11}
                            fill={isActive ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"}
                            fontWeight={isActive ? 600 : 400}
                          >
                            {payload.value}
                          </text>
                        </g>
                      );
                    }}
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

      <CategoryTreemap
        rows={rows}
        buckets={buckets}
        showRaw={showRaw}
        categoryOrder={categories}
      />

      <MonthBreakdown
        month={selectedMonth}
        rows={rows}
        showRaw={showRaw}
        categories={categoriesList as any}
        onClose={() => setSelectedMonth(null)}
      />
    </div>
  );
};

function CategoryTreemap({
  rows,
  buckets,
  showRaw,
  categoryOrder,
}: {
  rows: Row[];
  buckets: string[];
  showRaw: boolean;
  categoryOrder: string[];
}) {
  const colorFor = (name: string) => {
    const i = categoryOrder.indexOf(name);
    return i === -1 ? NEUTRAL : PALETTE[i % PALETTE.length];
  };

  const { data, total } = useMemo(() => {
    const totals = new Map<string, number>();
    const counts = new Map<string, number>();
    const bucketSet = new Set(buckets);
    for (const r of rows) {
      const cat = bucketName(r);
      let contributed = 0;
      if (showRaw) {
        if (!bucketSet.has(monthKey(r.date))) continue;
        const a = Number(r.amount);
        if (!isFinite(a) || a <= 0 || r.excluded) continue;
        contributed = a;
      } else {
        for (const mk of buckets) {
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
          if (eff > 0) contributed += eff;
        }
      }
      if (contributed <= 0) continue;
      totals.set(cat, (totals.get(cat) ?? 0) + contributed);
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    const total = [...totals.values()].reduce((a, b) => a + b, 0);
    const data = [...totals.entries()]
      .map(([name, value]) => ({ name, size: value, count: counts.get(name) ?? 0 }))
      .sort((a, b) => b.size - a.size);
    return { data, total };
  }, [rows, buckets, showRaw]);

  if (data.length === 0) return null;

  const TreemapCell = (props: any) => {
    const { x, y, width, height, name, size } = props;
    if (typeof name !== "string") return null;
    const fill = colorFor(name);
    const pct = total > 0 ? (size / total) * 100 : 0;
    const showLabel = width >= 80 && height >= 40;
    const showFull = width >= 120;
    const charBudget = Math.max(1, Math.floor((width - 16) / 7));
    const truncatedName = name.length > charBudget ? name.slice(0, charBudget - 1) + "…" : name;
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          style={{ fill, stroke: "hsl(var(--background))", strokeWidth: 2 }}
        />
        {showLabel && (
          <text
            x={x + 10}
            y={y + 22}
            fill="#fff"
            fontSize={12}
            fontWeight={600}
            style={{ pointerEvents: "none" }}
          >
            <tspan x={x + 10} dy={0}>{truncatedName}</tspan>
            {showFull && (
              <>
                <tspan x={x + 10} dy={16} fontWeight={500} fontSize={11} opacity={0.95}>
                  {fmtCurrency(size)}
                </tspan>
                <tspan x={x + 10} dy={14} fontWeight={400} fontSize={10} opacity={0.85}>
                  {pct.toFixed(1)}%
                </tspan>
              </>
            )}
          </text>
        )}
      </g>
    );
  };

  const TreemapTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload;
    if (!p) return null;
    const pct = total > 0 ? (p.size / total) * 100 : 0;
    return (
      <div className="rounded-xl border border-border/60 bg-background/95 backdrop-blur shadow-xl p-4 min-w-[220px]">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorFor(p.name) }} />
          <span className="text-sm font-medium">{p.name}</span>
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between gap-4">
            <span>Total</span>
            <span className="tabular-nums text-foreground">{fmtCurrency(p.size)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Share</span>
            <span className="tabular-nums text-foreground">{pct.toFixed(1)}%</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Transactions</span>
            <span className="tabular-nums text-foreground">{p.count}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="mt-14 pt-10 border-t border-border/60">
      <div className="mb-6">
        <h2 className="text-base font-medium">Composition</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Spend by category for the selected period
        </p>
      </div>
      <div className="h-[420px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={data}
            dataKey="size"
            nameKey="name"
            stroke="hsl(var(--background))"
            isAnimationActive={false}
            content={<TreemapCell />}
          >
            <Tooltip content={<TreemapTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function MonthBreakdown({
  month,
  rows,
  showRaw,
  categories,
  onClose,
}: {
  month: string | null;
  rows: Row[];
  showRaw: boolean;
  categories: { id: string; name: string; parent_category: string | null }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();

  async function updateField(id: string, field: string, oldVal: any, newVal: any) {
    const { error } = await supabase.from("transactions").update({ [field]: newVal } as any).eq("id", id);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    await supabase.from("transaction_edits").insert({
      transaction_id: id, field_changed: field, old_value: oldVal, new_value: newVal,
    });
    qc.invalidateQueries({ queryKey: ["trends"] });
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
    toast({ title: treatment === "normal" ? "Treatment cleared" : `Set to ${treatment}` });
    qc.invalidateQueries({ queryKey: ["trends"] });
  }

  async function toggleReviewed(id: string, next: boolean) {
    const { error } = await supabase
      .from("transactions")
      .update({ reviewed: next, reviewed_at: next ? new Date().toISOString() : null } as any)
      .eq("id", id);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["trends"] });
  }

  const breakdown = useMemo(() => {
    if (!month) return null;
    type Item = {
      row: Row;
      effective: number;
      note?: string;
    };
    const byCat = new Map<string, { total: number; items: Item[] }>();
    let total = 0;
    for (const r of rows) {
      const cat = r.categories?.parent_category || r.categories?.name || "Uncategorized";
      let v = 0;
      let note: string | undefined;
      if (showRaw) {
        if (monthKey(r.date) !== month) continue;
        const a = Number(r.amount);
        if (!isFinite(a) || a <= 0) continue;
        v = a;
      } else {
        v = effectiveMonthlyContribution(
          {
            date: r.date,
            amount: Number(r.amount),
            treatment: (r.treatment as any) ?? "normal",
            treatment_meta: r.treatment_meta ?? {},
            linked_txn_id: r.linked_txn_id,
            excluded: r.excluded,
          },
          month,
        );
        if (v <= 0) continue;
        if (monthKey(r.date) !== month) {
          note = `from ${monthFull(monthKey(r.date))}`;
        }
      }
      const cur = byCat.get(cat) ?? { total: 0, items: [] };
      cur.total += v;
      cur.items.push({ row: r, effective: v, note });
      byCat.set(cat, cur);
      total += v;
    }
    const cats = [...byCat.entries()]
      .map(([name, v]) => ({
        name,
        total: v.total,
        items: v.items.sort((a, b) => b.effective - a.effective),
      }))
      .sort((a, b) => b.total - a.total);
    return { total, cats };
  }, [month, rows, showRaw]);

  if (!month || !breakdown) return null;

  return (
    <section className="mt-14 pt-10 border-t border-border/60">
      <div className="flex items-end justify-between mb-6 gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Breakdown</p>
          <h2 className="text-2xl font-medium tracking-tight mt-2">{monthFull(month)}</h2>
          <p className="text-sm text-muted-foreground mt-1 tabular-nums">
            {fmtCurrency(breakdown.total)} total · {breakdown.cats.length} categories
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground">
          <X className="h-3.5 w-3.5 mr-1" /> Close
        </Button>
      </div>

      {breakdown.cats.length === 0 ? (
        <p className="text-sm text-muted-foreground">No spending in this month.</p>
      ) : (
        <div className="space-y-8">
          {breakdown.cats.map((c) => (
            <div key={c.name}>
              <div className="flex items-baseline justify-between border-b border-border/50 pb-2 mb-3">
                <h3 className="text-sm font-medium">{c.name}</h3>
                <div className="text-sm tabular-nums">
                  {fmtCurrency(c.total)}
                  <span className="text-xs text-muted-foreground ml-2">
                    {breakdown.total > 0
                      ? `${((c.total / breakdown.total) * 100).toFixed(0)}%`
                      : ""}
                  </span>
                </div>
              </div>
              <div>
                {c.items.map((it, idx) => {
                  const t = it.row;
                  const raw = Number(t.amount);
                  const muted = (t.treatment ?? "normal") !== "normal" && Math.abs(it.effective) !== Math.abs(raw);
                  return (
                    <div
                      key={`${t.id}-${idx}`}
                      className="grid grid-cols-[80px_1fr_180px_140px_100px_120px] gap-3 items-center py-2.5 border-b border-border/30 text-sm"
                    >
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {fmtDate(t.date)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate">{t.name}</div>
                        {it.note && (
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {it.note}
                          </div>
                        )}
                      </div>
                      <CategoryCombobox
                        value={t.category_id}
                        categories={categories}
                        onChange={(v) => updateField(t.id, "category_id", t.category_id, v)}
                      />
                      <TreatmentPicker
                        treatment={(t.treatment ?? "normal") as Treatment}
                        meta={(t.treatment_meta ?? {}) as TreatmentMeta}
                        amount={raw}
                        date={t.date}
                        onSave={(treatment, meta) => updateTreatment(t.id, treatment, meta)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={`h-7 px-2 gap-1.5 justify-start font-normal text-xs ${
                          t.reviewed ? "text-emerald-700 hover:text-emerald-700" : "text-muted-foreground"
                        }`}
                        onClick={() => toggleReviewed(t.id, !t.reviewed)}
                      >
                        {t.reviewed ? (
                          <><Check className="h-3.5 w-3.5" /> Reviewed</>
                        ) : (
                          <><span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40" /> Mark</>
                        )}
                      </Button>
                      <div className="text-right">
                        <div className={`tabular-nums font-medium ${muted ? "text-muted-foreground" : ""}`}>
                          {fmtCurrency(it.effective)}
                        </div>
                        {muted && (
                          <div className="text-[10px] tabular-nums text-muted-foreground mt-0.5">
                            of {fmtCurrency(Math.abs(raw))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default Trends;
