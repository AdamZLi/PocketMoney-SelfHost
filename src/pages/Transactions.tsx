import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import { ArrowDown, ArrowUp, Trash2, Search, Calendar, X, Sparkles, Loader2, Undo2, CheckCircle2, Flag, Check, CalendarCheck } from "lucide-react";
import { applyRules, type Rule } from "@/lib/categorize";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CategoryCombobox } from "@/components/CategoryCombobox";
import { TreatmentPicker } from "@/components/TreatmentPicker";
import { effectiveMonthlyContribution, treatmentLabel, type Treatment, type TreatmentMeta } from "@/lib/treatments";

type RuleSuggestion = {
  txnId: string;
  merchantName: string;
  categoryId: string;
  categoryName: string;
};

const Transactions = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState<string>("all");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [treatment, setTreatment] = useState<string>("all");
  
  const [reviewOnly, setReviewOnly] = useState(false);
  const [reviewedFilter, setReviewedFilter] = useState<"all" | "reviewed" | "not_reviewed">("all");
  const [month, setMonth] = useState<string>("all"); // 'all' or 'YYYY-MM'
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ruleSuggestion, setRuleSuggestion] = useState<RuleSuggestion | null>(null);
  const [matchCount, setMatchCount] = useState<number>(0);
  const [applying, setApplying] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanCategoryId, setScanCategoryId] = useState<string>("uncategorized");
  const [scanAccountId, setScanAccountId] = useState<string>("all");
  const [scanFrom, setScanFrom] = useState<string>("");
  const [scanTo, setScanTo] = useState<string>("");
  type PreviewItem = {
    txnId: string;
    name: string;
    oldCategoryId: string | null;
    newCategoryId: string;
    newCategoryName: string;
    source: "rule" | "ai";
  };
  type ScanStage = "configure" | "previewing" | "preview" | "applying" | "summary";
  const [scanStage, setScanStage] = useState<ScanStage>("configure");
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);
  const [scanTotalConsidered, setScanTotalConsidered] = useState(0);
  const [excludedFromPreview, setExcludedFromPreview] = useState<Set<string>>(new Set());
  const [lastApplied, setLastApplied] = useState<PreviewItem[] | null>(null);
  const [reverting, setReverting] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await supabase.from("accounts").select("id,name,mask").order("name")).data ?? [],
  });
  const { data: categoriesRaw = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("id,name,parent_category").order("name")).data ?? [],
  });
  // Frequency map: how many transactions use each category. Drives the ordering
  // of the category combobox so the most-used categories surface first.
  const { data: categoryUsage = {} } = useQuery({
    queryKey: ["categories", "usage"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("category_id")
        .not("category_id", "is", null)
        .limit(10000);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        const id = (row as any).category_id as string | null;
        if (!id) continue;
        counts[id] = (counts[id] ?? 0) + 1;
      }
      return counts;
    },
  });
  const categories = useMemo(() => {
    const arr = [...(categoriesRaw as any[])];
    arr.sort((a, b) => {
      const ua = (categoryUsage as Record<string, number>)[a.id] ?? 0;
      const ub = (categoryUsage as Record<string, number>)[b.id] ?? 0;
      if (ub !== ua) return ub - ua;
      return a.name.localeCompare(b.name);
    });
    return arr;
  }, [categoriesRaw, categoryUsage]);

  // Compute effective date range, honoring month selection.
  const monthRange = useMemo(() => {
    if (month === "all") return null;
    const [y, m] = month.split("-").map(Number);
    const from = `${month}-01`;
    const last = new Date(y, m, 0).getDate();
    const to = `${month}-${String(last).padStart(2, "0")}`;
    return { from, to };
  }, [month]);

  const effectiveFrom = monthRange?.from ?? dateFrom;
  const effectiveTo = monthRange?.to ?? dateTo;

  const { data: txns = [] } = useQuery({
    queryKey: ["txns", { search, accountId, categoryId, treatment, reviewOnly, reviewedFilter, month, dateFrom, dateTo, sortDir }],
    queryFn: async () => {
      let q = supabase
        .from("transactions")
        .select("id,date,name,amount,status,excluded,note,category_id,account_id,needs_review,review_reason,reviewed,reviewed_at,treatment,treatment_meta,linked_txn_id,categories(name,color),accounts(name,mask)")
        .order("date", { ascending: sortDir === "asc" })
        .limit(500);
      if (accountId !== "all") q = q.eq("account_id", accountId);
      if (categoryId !== "all") q = q.eq("category_id", categoryId);
      if (treatment !== "all") q = q.eq("treatment", treatment as any);
      if (reviewOnly) q = q.eq("needs_review", true);
      if (reviewedFilter === "reviewed") q = q.eq("reviewed", true);
      else if (reviewedFilter === "not_reviewed") q = q.eq("reviewed", false);
      if (search) q = q.ilike("name", `%${search}%`);
      if (effectiveFrom) q = q.gte("date", effectiveFrom);
      if (effectiveTo) q = q.lte("date", effectiveTo);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Count of transactions needing review (drives the badge in the toolbar).
  const { data: reviewCount = 0 } = useQuery({
    queryKey: ["txns", "review-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("needs_review", true);
      return count ?? 0;
    },
  });

  // Per-month review summary: list of months with reviewed/total counts.
  const { data: monthSummary = [] } = useQuery({
    queryKey: ["txns", "month-review-summary"],
    queryFn: async () => {
      // Paginate to bypass 1000-row cap.
      const PAGE = 1000;
      const all: { date: string; reviewed: boolean }[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("transactions")
          .select("date,reviewed")
          .order("date", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = (data ?? []) as any[];
        all.push(...batch);
        if (batch.length < PAGE) break;
      }
      const map = new Map<string, { total: number; reviewed: number }>();
      for (const r of all) {
        const k = String(r.date).slice(0, 7);
        const cur = map.get(k) ?? { total: 0, reviewed: 0 };
        cur.total += 1;
        if (r.reviewed) cur.reviewed += 1;
        map.set(k, cur);
      }
      return [...map.entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([k, v]) => ({ month: k, total: v.total, reviewed: v.reviewed }));
    },
  });

  async function toggleReviewed(id: string, next: boolean) {
    const { error } = await supabase
      .from("transactions")
      .update({ reviewed: next, reviewed_at: next ? new Date().toISOString() : null } as any)
      .eq("id", id);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["txns"] });
  }

  async function markMonthReviewed(targetMonth: string, next: boolean) {
    if (targetMonth === "all") return;
    const [y, m] = targetMonth.split("-").map(Number);
    const from = `${targetMonth}-01`;
    const last = new Date(y, m, 0).getDate();
    const to = `${targetMonth}-${String(last).padStart(2, "0")}`;
    const { error, count } = await supabase
      .from("transactions")
      .update({ reviewed: next, reviewed_at: next ? new Date().toISOString() : null } as any, { count: "exact" })
      .gte("date", from)
      .lte("date", to);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    toast({
      title: next ? `Marked ${targetMonth} as reviewed` : `Cleared review on ${targetMonth}`,
      description: `${count ?? 0} transaction${(count ?? 0) === 1 ? "" : "s"} updated.`,
    });
    qc.invalidateQueries({ queryKey: ["txns"] });
  }

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
    qc.invalidateQueries({ queryKey: ["txns"] }); qc.invalidateQueries({ queryKey: ["categories", "usage"] });
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
    qc.invalidateQueries({ queryKey: ["txns"] });
    qc.invalidateQueries({ queryKey: ["txns", "review-count"] });
  }
  // offer to create a rule that applies the same category to every other
  // transaction with the same merchant name.
  async function handleCategoryChange(t: any, newCatId: string | null) {
    await updateField(t.id, "category_id", t.category_id, newCatId);
    if (!newCatId) return;
    const cat = (categories as any[]).find((c) => c.id === newCatId);
    if (!cat) return;
    // Count other transactions sharing this merchant name (case-insensitive equals).
    const { count } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .ilike("name", t.name)
      .neq("id", t.id);
    setMatchCount(count ?? 0);
    setRuleSuggestion({
      txnId: t.id,
      merchantName: t.name,
      categoryId: newCatId,
      categoryName: cat.name,
    });
  }

  async function applyRuleToAll() {
    if (!ruleSuggestion) return;
    setApplying(true);
    try {
      const { merchantName, categoryId: catId, categoryName } = ruleSuggestion;
      // 1. Insert (or upsert-equivalent) a categorization rule for this merchant.
      //    Use equals match on the exact merchant name so we don't over-match.
      const { data: existing } = await supabase
        .from("category_rules")
        .select("id")
        .eq("pattern", merchantName)
        .eq("match_type", "equals")
        .limit(1);
      if (existing && existing.length > 0) {
        await supabase
          .from("category_rules")
          .update({ category_id: catId, priority: 10, source: "user" })
          .eq("id", existing[0].id);
      } else {
        await supabase.from("category_rules").insert({
          category_id: catId,
          pattern: merchantName,
          match_type: "equals",
          priority: 10,
          source: "user",
        });
      }
      // 2. Update every existing matching transaction.
      const { data: matched } = await supabase
        .from("transactions")
        .select("id,category_id")
        .ilike("name", merchantName);
      const ids = (matched ?? []).map((m: any) => m.id);
      if (ids.length > 0) {
        await supabase
          .from("transactions")
          .update({ category_id: catId } as any)
          .in("id", ids);
        await supabase.from("transaction_edits").insert(
          (matched ?? [])
            .filter((m: any) => m.category_id !== catId)
            .map((m: any) => ({
              transaction_id: m.id,
              field_changed: "category_id",
              old_value: m.category_id,
              new_value: catId,
            }))
        );
      }
      toast({
        title: "Rule applied",
        description: `${categoryName} set on ${ids.length} transaction${ids.length === 1 ? "" : "s"}.`,
      });
      qc.invalidateQueries({ queryKey: ["txns"] }); qc.invalidateQueries({ queryKey: ["categories", "usage"] });
      qc.invalidateQueries({ queryKey: ["rules"] });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setApplying(false);
      setRuleSuggestion(null);
    }
  }

  // Step 1: build a preview of changes without writing anything to the DB.
  // Rule-based matches always take precedence; the AI agent only sees
  // merchants that no rule could resolve.
  async function buildScanPreview() {
    if (scanning) return;
    setScanning(true);
    setScanStage("previewing");
    setScanProgress({ done: 0, total: 0 });
    setPreviewItems([]);
    setExcludedFromPreview(new Set());
    try {
      let q = supabase
        .from("transactions")
        .select("id,name,category_id")
        .eq("excluded", false);
      if (scanCategoryId === "uncategorized") q = q.is("category_id", null);
      else if (scanCategoryId !== "all") q = q.eq("category_id", scanCategoryId);
      if (scanAccountId !== "all") q = q.eq("account_id", scanAccountId);
      if (scanFrom) q = q.gte("date", scanFrom);
      if (scanTo) q = q.lte("date", scanTo);
      const { data: pending, error } = await q;
      if (error) throw error;
      const list = (pending ?? []) as { id: string; name: string; category_id: string | null }[];
      setScanTotalConsidered(list.length);
      if (list.length === 0) {
        toast({ title: "Nothing to scan", description: "No transactions match the selected filters." });
        setScanStage("configure");
        return;
      }

      const { data: ruleRows } = await supabase
        .from("category_rules")
        .select("id,category_id,match_type,pattern,priority");
      const rules: Rule[] = (ruleRows ?? []) as any;
      const catName = (id: string) =>
        (categories as any[]).find((c) => c.id === id)?.name ?? "Unknown";

      const items: PreviewItem[] = [];
      const byName = new Map<string, { id: string; name: string; category_id: string | null }[]>();

      for (const t of list) {
        const cat = applyRules(t.name, rules);
        if (cat) {
          if (cat !== t.category_id) {
            items.push({
              txnId: t.id,
              name: t.name,
              oldCategoryId: t.category_id,
              newCategoryId: cat,
              newCategoryName: catName(cat),
              source: "rule",
            });
          }
        } else {
          const key = t.name.trim().toLowerCase();
          if (!byName.has(key)) byName.set(key, []);
          byName.get(key)!.push(t);
        }
      }

      const remaining = [...byName.values()].map((g) => g[0]);
      setScanProgress({ done: 0, total: remaining.length });

      const CHUNK = 50;
      for (let i = 0; i < remaining.length; i += CHUNK) {
        const chunk = remaining.slice(i, i + CHUNK);
        const { data: aiData, error: aiErr } = await supabase.functions.invoke(
          "suggest-categories",
          {
            body: {
              merchants: chunk.map((m) => ({ id: m.id, name: m.name })),
              categories: (categories as any[]).map((c) => ({
                id: c.id,
                name: c.name,
                parent_category: c.parent_category,
              })),
            },
          },
        );
        if (aiErr) {
          toast({ title: "AI scan paused", description: aiErr.message, variant: "destructive" });
          break;
        }
        const suggestions: { id: string; category_id: string | null }[] =
          aiData?.suggestions ?? [];

        for (const s of suggestions) {
          if (!s.category_id) continue;
          const repr = chunk.find((m) => m.id === s.id);
          if (!repr) continue;
          const groupKey = repr.name.trim().toLowerCase();
          const group = byName.get(groupKey) ?? [repr];
          for (const t of group) {
            if (t.category_id === s.category_id) continue;
            items.push({
              txnId: t.id,
              name: t.name,
              oldCategoryId: t.category_id,
              newCategoryId: s.category_id,
              newCategoryName: catName(s.category_id),
              source: "ai",
            });
          }
        }
        setScanProgress({ done: Math.min(remaining.length, i + chunk.length), total: remaining.length });
      }

      setPreviewItems(items);
      setScanStage("preview");
    } catch (e: any) {
      toast({ title: "Scan failed", description: e.message ?? String(e), variant: "destructive" });
      setScanStage("configure");
    } finally {
      setScanning(false);
    }
  }

  // Step 2: apply the previewed changes (minus any user-deselected ones).
  async function applyScanPreview() {
    const toApply = previewItems.filter((p) => !excludedFromPreview.has(p.txnId));
    if (toApply.length === 0) {
      toast({ title: "Nothing to apply" });
      return;
    }
    setScanStage("applying");
    setScanning(true);
    setScanProgress({ done: 0, total: toApply.length });
    try {
      const byCat = new Map<string, PreviewItem[]>();
      for (const p of toApply) {
        if (!byCat.has(p.newCategoryId)) byCat.set(p.newCategoryId, []);
        byCat.get(p.newCategoryId)!.push(p);
      }
      let done = 0;
      for (const [catId, group] of byCat) {
        const ids = group.map((g) => g.txnId);
        const { error: upErr } = await supabase
          .from("transactions")
          .update({ category_id: catId } as any)
          .in("id", ids);
        if (upErr) throw upErr;
        await supabase.from("transaction_edits").insert(
          group.map((g) => ({
            transaction_id: g.txnId,
            field_changed: "category_id",
            old_value: g.oldCategoryId,
            new_value: catId,
          })),
        );
        done += ids.length;
        setScanProgress({ done, total: toApply.length });
      }
      setLastApplied(toApply);
      setScanStage("summary");
      qc.invalidateQueries({ queryKey: ["txns"] });
      qc.invalidateQueries({ queryKey: ["categories", "usage"] });
    } catch (e: any) {
      toast({ title: "Apply failed", description: e.message ?? String(e), variant: "destructive" });
      setScanStage("preview");
    } finally {
      setScanning(false);
    }
  }

  // Revert: restore each previously-changed transaction to its prior category.
  async function revertLastScan() {
    if (!lastApplied || lastApplied.length === 0) return;
    setReverting(true);
    try {
      const byOld = new Map<string | null, string[]>();
      for (const p of lastApplied) {
        const k = p.oldCategoryId;
        if (!byOld.has(k)) byOld.set(k, []);
        byOld.get(k)!.push(p.txnId);
      }
      for (const [oldCat, ids] of byOld) {
        const { error } = await supabase
          .from("transactions")
          .update({ category_id: oldCat } as any)
          .in("id", ids);
        if (error) throw error;
        await supabase.from("transaction_edits").insert(
          lastApplied
            .filter((p) => p.oldCategoryId === oldCat)
            .map((p) => ({
              transaction_id: p.txnId,
              field_changed: "category_id",
              old_value: p.newCategoryId,
              new_value: oldCat,
            })),
        );
      }
      toast({ title: "Reverted", description: `${lastApplied.length} transaction${lastApplied.length === 1 ? "" : "s"} restored.` });
      setLastApplied(null);
      setScanOpen(false);
      qc.invalidateQueries({ queryKey: ["txns"] });
      qc.invalidateQueries({ queryKey: ["categories", "usage"] });
    } catch (e: any) {
      toast({ title: "Revert failed", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setReverting(false);
    }
  }

  function resetScanDialog() {
    setScanStage("configure");
    setPreviewItems([]);
    setExcludedFromPreview(new Set());
    setScanProgress(null);
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
    await supabase.from("transaction_edits").delete().in("transaction_id", ids);
    await supabase.from("transaction_tags").delete().in("transaction_id", ids);
    const { error } = await supabase.from("transactions").delete().in("id", ids);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Deleted ${ids.length} transaction${ids.length === 1 ? "" : "s"}` });
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["txns"] }); qc.invalidateQueries({ queryKey: ["categories", "usage"] });
  }

  async function bulkUpdate(field: string, value: any, label: string) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const { error } = await supabase.from("transactions").update({ [field]: value } as any).in("id", ids);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    await supabase.from("transaction_edits").insert(
      ids.map(id => ({ transaction_id: id, field_changed: field, old_value: null as any, new_value: value as any }))
    );
    toast({ title: `${label} applied to ${ids.length} transaction${ids.length === 1 ? "" : "s"}` });
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["txns"] }); qc.invalidateQueries({ queryKey: ["categories", "usage"] });
  }

  const dateRangeLabel = dateFrom || dateTo
    ? `${dateFrom ? fmtDate(dateFrom) : "…"} → ${dateTo ? fmtDate(dateTo) : "…"}`
    : "Any date";

  const activeFilterCount =
    (accountId !== "all" ? 1 : 0) +
    (categoryId !== "all" ? 1 : 0) +
    (treatment !== "all" ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0);

  return (
    <div className="max-w-6xl mx-auto px-8 py-12">
      {/* Title */}
      <div className="mb-10 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {txns.length} {txns.length === 1 ? "row" : "rows"}
            <span className="mx-2 text-border">·</span>
            {fmtCurrency(total)}
            {scanning && scanProgress && (
              <>
                <span className="mx-2 text-border">·</span>
                <span className="text-foreground/70">
                  {scanStage === "applying" ? "Applying" : "Scanning"} {scanProgress.done}/{scanProgress.total}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastApplied && lastApplied.length > 0 && scanStage !== "summary" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={revertLastScan}
              disabled={reverting}
              className="h-9 gap-2 text-muted-foreground"
            >
              {reverting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
              Undo last scan
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => { resetScanDialog(); setScanOpen(true); }}
            disabled={scanning}
            className="h-9 gap-2"
          >
            {scanning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {scanning ? "Scanning…" : "AI scan & categorize"}
          </Button>
        </div>
      </div>

      <Dialog
        open={scanOpen}
        onOpenChange={(o) => {
          if (scanning) return;
          setScanOpen(o);
          if (!o) resetScanDialog();
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          {scanStage === "configure" && (
            <>
              <DialogHeader>
                <DialogTitle>AI scan & categorize</DialogTitle>
                <DialogDescription>
                  Choose which transactions to analyze. Existing rules apply first; the AI agent only categorizes the rest. You'll preview changes before anything is saved.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Category</Label>
                  <Select value={scanCategoryId} onValueChange={setScanCategoryId}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="uncategorized">Uncategorized only</SelectItem>
                      <SelectItem value="all">All transactions</SelectItem>
                      {(categories as any[]).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Account</Label>
                  <Select value={scanAccountId} onValueChange={setScanAccountId}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All accounts</SelectItem>
                      {(accounts as any[]).map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}{a.mask ? ` ····${a.mask}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <Input type="date" value={scanFrom} onChange={(e) => setScanFrom(e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Input type="date" value={scanTo} onChange={(e) => setScanTo(e.target.value)} className="h-9" />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setScanOpen(false)}>Cancel</Button>
                <Button onClick={buildScanPreview} className="gap-2">
                  <Sparkles className="h-3.5 w-3.5" />
                  Preview changes
                </Button>
              </DialogFooter>
            </>
          )}

          {scanStage === "previewing" && (
            <>
              <DialogHeader>
                <DialogTitle>Analyzing transactions…</DialogTitle>
                <DialogDescription>
                  Applying rules and asking the AI agent to categorize the remaining merchants.
                </DialogDescription>
              </DialogHeader>
              <div className="py-6 space-y-3">
                <Progress
                  value={scanProgress && scanProgress.total > 0
                    ? (scanProgress.done / scanProgress.total) * 100
                    : 5}
                />
                <p className="text-xs text-muted-foreground text-center">
                  {scanProgress
                    ? `${scanProgress.done} / ${scanProgress.total} merchant groups analyzed`
                    : "Loading transactions…"}
                </p>
              </div>
            </>
          )}

          {scanStage === "preview" && (
            <>
              <DialogHeader>
                <DialogTitle>Review proposed changes</DialogTitle>
                <DialogDescription>
                  {previewItems.length === 0
                    ? "No category changes are needed."
                    : `${previewItems.length - excludedFromPreview.size} of ${previewItems.length} change${previewItems.length === 1 ? "" : "s"} selected, from ${scanTotalConsidered} transaction${scanTotalConsidered === 1 ? "" : "s"} considered. Uncheck any you'd like to skip.`}
                </DialogDescription>
              </DialogHeader>
              {previewItems.length > 0 && (
                <ScrollArea className="max-h-80 pr-3 border-y">
                  <div className="divide-y">
                    {previewItems.map((p) => {
                      const checked = !excludedFromPreview.has(p.txnId);
                      const oldName = p.oldCategoryId
                        ? ((categories as any[]).find((c) => c.id === p.oldCategoryId)?.name ?? "—")
                        : "Uncategorized";
                      return (
                        <label
                          key={p.txnId}
                          className="flex items-center gap-3 py-2.5 cursor-pointer"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              setExcludedFromPreview((prev) => {
                                const next = new Set(prev);
                                if (v) next.delete(p.txnId);
                                else next.add(p.txnId);
                                return next;
                              });
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm truncate">{p.name}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {oldName} → <span className="text-foreground/80">{p.newCategoryName}</span>
                            </div>
                          </div>
                          <Badge variant={p.source === "rule" ? "secondary" : "outline"} className="text-[10px] uppercase tracking-wide">
                            {p.source}
                          </Badge>
                        </label>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setScanStage("configure")}>Back</Button>
                <Button
                  onClick={applyScanPreview}
                  disabled={previewItems.length - excludedFromPreview.size === 0}
                  className="gap-2"
                >
                  Apply {previewItems.length - excludedFromPreview.size} change{previewItems.length - excludedFromPreview.size === 1 ? "" : "s"}
                </Button>
              </DialogFooter>
            </>
          )}

          {scanStage === "applying" && (
            <>
              <DialogHeader>
                <DialogTitle>Applying changes…</DialogTitle>
                <DialogDescription>Updating your transactions.</DialogDescription>
              </DialogHeader>
              <div className="py-6 space-y-3">
                <Progress
                  value={scanProgress && scanProgress.total > 0
                    ? (scanProgress.done / scanProgress.total) * 100
                    : 5}
                />
                <p className="text-xs text-muted-foreground text-center">
                  {scanProgress ? `${scanProgress.done} / ${scanProgress.total} updated` : "Starting…"}
                </p>
              </div>
            </>
          )}

          {scanStage === "summary" && lastApplied && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-foreground/80" />
                  Scan complete
                </DialogTitle>
                <DialogDescription>
                  Categorized {lastApplied.length} transaction{lastApplied.length === 1 ? "" : "s"} out of {scanTotalConsidered} considered.
                </DialogDescription>
              </DialogHeader>
              <div className="py-2 grid grid-cols-3 gap-3">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Applied</div>
                  <div className="text-xl font-medium">{lastApplied.length}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">By rules</div>
                  <div className="text-xl font-medium">{lastApplied.filter((p) => p.source === "rule").length}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">By AI</div>
                  <div className="text-xl font-medium">{lastApplied.filter((p) => p.source === "ai").length}</div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={revertLastScan}
                  disabled={reverting}
                  className="gap-2"
                >
                  {reverting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                  Revert all
                </Button>
                <Button onClick={() => { setScanOpen(false); resetScanDialog(); }}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 border-0 bg-muted/50 focus-visible:bg-background focus-visible:ring-1"
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-9 text-muted-foreground font-normal">
              <Calendar className="h-3.5 w-3.5 mr-2" />
              {dateRangeLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From</label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9" />
            </div>
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                Clear
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
              <SelectItem key={a.id} value={a.id}>{a.name}{a.mask ? ` ····${a.mask}` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="h-9 w-auto gap-2 border-0 bg-transparent text-muted-foreground font-normal hover:bg-muted/50 focus:ring-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c: any) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={treatment} onValueChange={setTreatment}>
          <SelectTrigger className="h-9 w-auto gap-2 border-0 bg-transparent text-muted-foreground font-normal hover:bg-muted/50 focus:ring-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All treatments</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="excluded">Excluded (one-off)</SelectItem>
            <SelectItem value="refundable">Refundable</SelectItem>
            <SelectItem value="reimbursable">Reimbursable / split</SelectItem>
            <SelectItem value="amortized">Amortized</SelectItem>
          </SelectContent>
        </Select>

        {reviewCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className={`h-9 font-normal gap-1.5 ${reviewOnly ? "text-amber-700" : "text-muted-foreground"}`}
            onClick={() => setReviewOnly(v => !v)}
          >
            <Flag className="h-3.5 w-3.5" />
            Review
            <Badge variant="outline" className="ml-0.5 h-5 px-1.5 text-[10px] border-amber-500/60 text-amber-700">
              {reviewCount}
            </Badge>
          </Button>
        )}

        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-muted-foreground"
            onClick={() => { setAccountId("all"); setCategoryId("all"); setTreatment("all"); setDateFrom(""); setDateTo(""); }}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Reset
          </Button>
        )}
      </div>

      {/* Table */}
      <div>
        <div className="grid grid-cols-[24px_100px_1fr_180px_140px_120px] gap-4 px-2 py-3 text-xs text-muted-foreground border-b">
          <Checkbox
            checked={txns.length > 0 && selected.size === txns.length}
            onCheckedChange={(v) => toggleAll(!!v)}
          />
          <button
            type="button"
            onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
            className="inline-flex items-center gap-1 hover:text-foreground text-left"
          >
            Date {sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          </button>
          <span>Merchant</span>
          <span>Category</span>
          <span>Treatment</span>
          <span className="text-right">Amount</span>
        </div>

        <div>
          {(txns as any[]).map((t) => {
            const isSelected = selected.has(t.id);
            return (
              <div
                key={t.id}
                className={`group grid grid-cols-[24px_100px_1fr_180px_140px_120px] gap-4 px-2 py-3.5 border-b border-border/50 items-center transition-colors ${
                  isSelected ? "bg-muted/40" : "hover:bg-muted/20"
                } ${t.excluded ? "opacity-50" : ""}`}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(v) => toggleOne(t.id, !!v)}
                  className={isSelected ? "" : "opacity-0 group-hover:opacity-100 data-[state=checked]:opacity-100 transition-opacity"}
                />
                <span className="text-sm text-muted-foreground tabular-nums">{fmtDate(t.date)}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{t.name}</span>
                    {t.status === "pending" && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">pending</span>
                    )}
                  </div>
                  {t.accounts?.name && (
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {t.accounts.name}{t.accounts.mask ? ` ····${t.accounts.mask}` : ""}
                    </div>
                  )}
                </div>
                <CategoryCombobox
                  value={t.category_id}
                  categories={categories as any}
                  onChange={(v) => handleCategoryChange(t, v)}
                />
                <TreatmentPicker
                  treatment={(t.treatment ?? "normal") as Treatment}
                  meta={(t.treatment_meta ?? {}) as TreatmentMeta}
                  amount={Number(t.amount)}
                  date={t.date}
                  onSave={(treatment, meta) => updateTreatment(t.id, treatment, meta)}
                />
                {(() => {
                  const raw = Number(t.amount);
                  const eff = effectiveMonthlyContribution(
                    {
                      date: t.date,
                      amount: raw,
                      treatment: t.treatment,
                      treatment_meta: t.treatment_meta,
                      linked_txn_id: t.linked_txn_id,
                      excluded: t.excluded,
                    },
                    t.date.slice(0, 7),
                  );
                  const muted = (t.treatment ?? "normal") !== "normal" && Math.abs(eff) !== Math.abs(raw);
                  return (
                    <div className="text-right">
                      <div className={`text-sm tabular-nums font-medium ${muted ? "line-through text-muted-foreground" : ""}`}>
                        {fmtCurrency(raw)}
                      </div>
                      {muted && (
                        <div className="text-[10px] tabular-nums text-muted-foreground mt-0.5">
                          eff {fmtCurrency(Math.sign(raw) * Math.abs(eff))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
          {txns.length === 0 && (
            <div className="py-20 text-center text-sm text-muted-foreground">No transactions match.</div>
          )}
        </div>
      </div>

      {/* Floating bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 rounded-full border bg-background/95 backdrop-blur px-2 py-1.5 shadow-lg">
          <span className="text-sm font-medium px-3">{selected.size} selected</span>
          <div className="h-5 w-px bg-border" />

          <div className="w-44">
            <CategoryCombobox
              value={null}
              categories={categories as any}
              onChange={(v) => bulkUpdate("category_id", v, "Category")}
              placeholder="Set category"
              triggerClassName="ml-0"
            />
          </div>

          <Button size="sm" variant="ghost" className="h-8" onClick={() => bulkUpdate("excluded", true, "Exclude")}>Exclude</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => bulkUpdate("excluded", false, "Include")}>Include</Button>

          <div className="h-5 w-px bg-border" />

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10">
                <Trash2 className="h-3.5 w-3.5" />
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

          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setSelected(new Set())}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Suggest a categorization rule when a single transaction is recategorized */}
      {/* Lightweight, non-blocking suggestion that appears after recategorizing.
          Auto-dismisses if ignored; never blocks the rest of the UI. */}
      {ruleSuggestion && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 w-[340px] rounded-xl border border-border/70 bg-background/95 backdrop-blur shadow-lg p-4 animate-in slide-in-from-bottom-2 fade-in"
        >
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="text-sm font-medium leading-snug">
              Apply to all{" "}
              <span className="text-foreground/70">"{ruleSuggestion.merchantName}"</span>?
            </div>
            <button
              onClick={() => !applying && setRuleSuggestion(null)}
              className="text-muted-foreground hover:text-foreground -mr-1 -mt-0.5"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {matchCount === 0
              ? `No other matches yet — a rule will tag future ones as ${ruleSuggestion.categoryName}.`
              : `Set ${matchCount} other ${matchCount === 1 ? "transaction" : "transactions"} to ${ruleSuggestion.categoryName} and remember this for future imports.`}
          </p>
          <div className="mt-3 flex items-center justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={applying}
              onClick={() => setRuleSuggestion(null)}
            >
              Just this one
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={applying}
              onClick={applyRuleToAll}
            >
              {applying ? "Applying…" : "Apply to all"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Transactions;
