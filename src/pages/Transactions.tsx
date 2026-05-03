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
import { ArrowDown, ArrowUp, Trash2, Search, Calendar, X, Sparkles, Loader2 } from "lucide-react";
import { applyRules, type Rule } from "@/lib/categorize";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CategoryCombobox } from "@/components/CategoryCombobox";

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
  const [showExcluded, setShowExcluded] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ruleSuggestion, setRuleSuggestion] = useState<RuleSuggestion | null>(null);
  const [matchCount, setMatchCount] = useState<number>(0);
  const [applying, setApplying] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number; updated: number } | null>(null);

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
    qc.invalidateQueries({ queryKey: ["txns"] }); qc.invalidateQueries({ queryKey: ["categories", "usage"] });
  }

  // When a single transaction's category changes via the inline dropdown,
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
    (dateFrom || dateTo ? 1 : 0) +
    (showExcluded ? 1 : 0);

  return (
    <div className="max-w-6xl mx-auto px-8 py-12">
      {/* Title */}
      <div className="mb-10">
        <h1 className="text-2xl font-medium tracking-tight">Transactions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {txns.length} {txns.length === 1 ? "row" : "rows"}
          <span className="mx-2 text-border">·</span>
          {fmtCurrency(total)}
        </p>
      </div>

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

        <Button
          variant="ghost"
          size="sm"
          className={`h-9 font-normal ${showExcluded ? "text-foreground" : "text-muted-foreground"}`}
          onClick={() => setShowExcluded(v => !v)}
        >
          {showExcluded ? "Hide excluded" : "Show excluded"}
        </Button>

        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-muted-foreground"
            onClick={() => { setAccountId("all"); setCategoryId("all"); setDateFrom(""); setDateTo(""); setShowExcluded(false); }}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Reset
          </Button>
        )}
      </div>

      {/* Table */}
      <div>
        <div className="grid grid-cols-[24px_100px_1fr_180px_120px] gap-4 px-2 py-3 text-xs text-muted-foreground border-b">
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
          <span className="text-right">Amount</span>
        </div>

        <div>
          {(txns as any[]).map((t) => {
            const isSelected = selected.has(t.id);
            return (
              <div
                key={t.id}
                className={`group grid grid-cols-[24px_100px_1fr_180px_120px] gap-4 px-2 py-3.5 border-b border-border/50 items-center transition-colors ${
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
                <span className="text-sm text-right tabular-nums font-medium">
                  {fmtCurrency(Number(t.amount))}
                </span>
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
