import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import { ArrowDown, ArrowUp, Trash2, Search, Calendar, X, Sparkles, Loader2, Undo2, CheckCircle2, Flag, Check, CalendarCheck, Pencil, Plus } from "lucide-react";
import { applyRules, type Rule } from "@/lib/categorize";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
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

  // Inline merchant rename
  const [renameTarget, setRenameTarget] = useState<{ id: string; oldName: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [aliasPrompt, setAliasPrompt] = useState<{ oldName: string; newName: string; matchCount: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [creatingAlias, setCreatingAlias] = useState(false);

  // Transaction details side panel
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [detailsRecord, setDetailsRecord] = useState<any | null>(null);
  const [detailsDraft, setDetailsDraft] = useState<{ name: string; date: string; note: string; amount: string }>({ name: "", date: "", note: "", amount: "" });
  const [detailsOriginalName, setDetailsOriginalName] = useState<string>("");
  const [savingDetails, setSavingDetails] = useState(false);

  // Manual transaction entry
  const [addOpen, setAddOpen] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const todayStr = new Date().toISOString().slice(0, 10);
  const [addForm, setAddForm] = useState({
    date: todayStr,
    name: "",
    amount: "",
    account_id: "none",
    category_id: "none",
    note: "",
  });

  function resetAddForm() {
    setAddForm({ date: todayStr, name: "", amount: "", account_id: "none", category_id: "none", note: "" });
  }

  async function submitAddTransaction() {
    const name = addForm.name.trim();
    const amt = Number(addForm.amount);
    if (!name) { toast({ title: "Merchant name required", variant: "destructive" }); return; }
    if (!addForm.date) { toast({ title: "Date required", variant: "destructive" }); return; }
    if (!Number.isFinite(amt) || amt === 0) { toast({ title: "Enter a non-zero amount", variant: "destructive" }); return; }
    setAddSaving(true);
    try {
      const { error } = await supabase.from("transactions").insert({
        date: addForm.date,
        name,
        amount: amt,
        account_id: addForm.account_id === "none" ? null : addForm.account_id,
        category_id: addForm.category_id === "none" ? null : addForm.category_id,
        note: addForm.note.trim() || null,
        source: "manual",
        status: "posted",
      } as any);
      if (error) throw error;
      toast({ title: "Transaction added" });
      setAddOpen(false);
      resetAddForm();
      qc.invalidateQueries({ queryKey: ["txns"] });
      qc.invalidateQueries({ queryKey: ["txns", "month-review-summary"] });
      qc.invalidateQueries({ queryKey: ["categories", "usage"] });
    } catch (e: any) {
      toast({ title: "Add failed", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setAddSaving(false);
    }
  }

  function openDetails(t: any) {
    setDetailsId(t.id);
    setDetailsRecord(t);
    setDetailsOriginalName(t.name);
    setDetailsDraft({
      name: t.name ?? "",
      date: t.date ?? "",
      note: t.note ?? "",
      amount: t.amount != null ? String(t.amount) : "",
    });
  }

  async function saveDetails() {
    if (!detailsId) return;
    const t = (txns as any[]).find((x) => x.id === detailsId);
    if (!t) return;
    const updates: Record<string, any> = {};
    const edits: { field_changed: string; old_value: any; new_value: any }[] = [];
    const newName = detailsDraft.name.trim();
    if (newName && newName !== t.name) {
      updates.name = newName;
      edits.push({ field_changed: "name", old_value: t.name, new_value: newName });
    }
    if (detailsDraft.date && detailsDraft.date !== t.date) {
      updates.date = detailsDraft.date;
      edits.push({ field_changed: "date", old_value: t.date, new_value: detailsDraft.date });
    }
    const newNote = detailsDraft.note ?? "";
    if ((t.note ?? "") !== newNote) {
      updates.note = newNote || null;
      edits.push({ field_changed: "note", old_value: t.note, new_value: newNote || null });
    }
    const parsedAmount = detailsDraft.amount.trim() === "" ? NaN : Number(detailsDraft.amount);
    if (!Number.isNaN(parsedAmount) && parsedAmount !== Number(t.amount)) {
      updates.amount = parsedAmount;
      edits.push({ field_changed: "amount", old_value: Number(t.amount), new_value: parsedAmount });
    }
    if (Object.keys(updates).length === 0) {
      setDetailsId(null);
      return;
    }
    setSavingDetails(true);
    try {
      const { error } = await supabase.from("transactions").update(updates as any).eq("id", detailsId);
      if (error) throw error;
      if (edits.length > 0) {
        await supabase.from("transaction_edits").insert(edits.map((e) => ({ transaction_id: detailsId, ...e })));
      }
      qc.invalidateQueries({ queryKey: ["txns"] });
      toast({ title: "Transaction updated" });
      // If the name changed, optionally offer the alias prompt as before.
      if (updates.name) {
        const { count } = await supabase
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .ilike("name", detailsOriginalName)
          .neq("id", detailsId);
        const matchCount = count ?? 0;
        setDetailsId(null);
        if (matchCount > 0) {
          setAliasPrompt({ oldName: detailsOriginalName, newName: updates.name, matchCount });
        }
      } else {
        setDetailsId(null);
      }
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setSavingDetails(false);
    }
  }

  async function submitRename() {
    if (!renameTarget) return;
    const newName = renameValue.trim();
    if (!newName || newName === renameTarget.oldName) { setRenameTarget(null); return; }
    setRenaming(true);
    try {
      const { error } = await supabase
        .from("transactions")
        .update({ name: newName } as any)
        .eq("id", renameTarget.id);
      if (error) throw error;
      await supabase.from("transaction_edits").insert({
        transaction_id: renameTarget.id,
        field_changed: "name",
        old_value: renameTarget.oldName as any,
        new_value: newName as any,
      });
      // Count other transactions with the same original name (case-insensitive).
      const { count } = await supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .ilike("name", renameTarget.oldName)
        .neq("id", renameTarget.id);
      qc.invalidateQueries({ queryKey: ["txns"] });
      const matchCount = count ?? 0;
      const oldName = renameTarget.oldName;
      setRenameTarget(null);
      setAliasPrompt({ oldName, newName, matchCount });
    } catch (e: any) {
      toast({ title: "Rename failed", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setRenaming(false);
    }
  }

  async function createAliasAndApply(applyToOthers: boolean) {
    if (!aliasPrompt) return;
    setCreatingAlias(true);
    try {
      const { oldName, newName } = aliasPrompt;
      // Upsert an alias row keyed on the original raw merchant string.
      const { data: existing } = await supabase
        .from("merchant_aliases")
        .select("id")
        .eq("pattern", oldName)
        .eq("match_type", "exact")
        .limit(1);
      if (existing && existing.length > 0) {
        await supabase
          .from("merchant_aliases")
          .update({ display_name: newName, priority: 1000, source: "user" })
          .eq("id", existing[0].id);
      } else {
        await supabase.from("merchant_aliases").insert({
          pattern: oldName,
          match_type: "exact",
          display_name: newName,
          priority: 1000,
          source: "user",
        });
      }
      let updated = 0;
      if (applyToOthers) {
        const { data: matched } = await supabase
          .from("transactions")
          .select("id,name")
          .ilike("name", oldName);
        const ids = (matched ?? []).map((m: any) => m.id);
        if (ids.length > 0) {
          await supabase.from("transactions").update({ name: newName } as any).in("id", ids);
          await supabase.from("transaction_edits").insert(
            (matched ?? []).map((m: any) => ({
              transaction_id: m.id,
              field_changed: "name",
              old_value: m.name,
              new_value: newName,
            }))
          );
          updated = ids.length;
        }
      }
      toast({
        title: "Alias saved",
        description: applyToOthers
          ? `Updated ${updated} matching transaction${updated === 1 ? "" : "s"}.`
          : "Future imports matching this merchant will use the new name.",
      });
      qc.invalidateQueries({ queryKey: ["txns"] });
    } catch (e: any) {
      toast({ title: "Alias failed", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setCreatingAlias(false);
      setAliasPrompt(null);
    }
  }

  // Open side panel from ?edit=<id> URL param (e.g., from Dashboard).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const editId = searchParams.get("edit");
    if (!editId || detailsId === editId) return;
    (async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id,date,name,amount,note,reviewed,reviewed_at,treatment,treatment_meta,linked_txn_id,category_id,excluded,accounts(name,mask)")
        .eq("id", editId)
        .maybeSingle();
      if (data) openDetails(data as any);
      const next = new URLSearchParams(searchParams);
      next.delete("edit");
      setSearchParams(next, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);


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
    qc.invalidateQueries({ queryKey: ["txns", "month-review-summary"] });
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
    qc.invalidateQueries({ queryKey: ["txns", "month-review-summary"] });
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
    (reviewedFilter !== "all" ? 1 : 0) +
    (month !== "all" ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0);

  const monthLabel = (k: string) => {
    const [y, m] = k.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, {
      month: "short",
      year: "numeric",
    });
  };
  const currentMonthSummary = month !== "all"
    ? (monthSummary as any[]).find((s) => s.month === month)
    : null;
  const currentMonthAllReviewed =
    !!currentMonthSummary &&
    currentMonthSummary.total > 0 &&
    currentMonthSummary.reviewed === currentMonthSummary.total;

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
            onClick={() => { resetAddForm(); setAddOpen(true); }}
            className="h-9 gap-2"
          >
            <Plus className="h-3.5 w-3.5" />
            Add transaction
          </Button>
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

      <Dialog open={addOpen} onOpenChange={(o) => { if (!addSaving) { setAddOpen(o); if (!o) resetAddForm(); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add transaction</DialogTitle>
            <DialogDescription>
              Log a transaction manually. Use a positive amount for expenses and a negative amount for income/refunds.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Date</Label>
                <Input
                  type="date"
                  value={addForm.date}
                  onChange={(e) => setAddForm((f) => ({ ...f, date: e.target.value }))}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={addForm.amount}
                  onChange={(e) => setAddForm((f) => ({ ...f, amount: e.target.value }))}
                  className="h-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Merchant</Label>
              <Input
                placeholder="e.g. Whole Foods"
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                className="h-9"
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Account</Label>
              <Select
                value={addForm.account_id}
                onValueChange={(v) => setAddForm((f) => ({ ...f, account_id: v }))}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No account</SelectItem>
                  {(accounts as any[]).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}{a.mask ? ` ····${a.mask}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Category</Label>
              <Select
                value={addForm.category_id}
                onValueChange={(v) => setAddForm((f) => ({ ...f, category_id: v }))}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Uncategorized</SelectItem>
                  {(categories as any[]).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Note (optional)</Label>
              <Input
                value={addForm.note}
                onChange={(e) => setAddForm((f) => ({ ...f, note: e.target.value }))}
                className="h-9"
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={addSaving}>Cancel</Button>
            <Button onClick={submitAddTransaction} disabled={addSaving} className="gap-2">
              {addSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add transaction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <SelectItem value="split">Split into parts</SelectItem>
          </SelectContent>
        </Select>

        {/* Reviewed filter — sits next to category/treatment */}
        <Select value={reviewedFilter} onValueChange={(v) => setReviewedFilter(v as any)}>
          <SelectTrigger className="h-9 w-auto gap-2 border-0 bg-transparent text-muted-foreground font-normal hover:bg-muted/50 focus:ring-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All review states</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
            <SelectItem value="not_reviewed">Not reviewed</SelectItem>
          </SelectContent>
        </Select>

        {/* Month selector with per-month review status */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-9 text-muted-foreground font-normal gap-1.5">
              <CalendarCheck className="h-3.5 w-3.5" />
              {month === "all" ? "All months" : monthLabel(month)}
              {currentMonthAllReviewed && <Check className="h-3.5 w-3.5 text-emerald-600" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-0">
            <div className="px-3 py-2 border-b text-xs text-muted-foreground flex items-center justify-between">
              <span>Filter by month</span>
              <button
                onClick={() => setMonth("all")}
                className="text-xs hover:text-foreground"
              >
                Clear
              </button>
            </div>
            <ScrollArea className="max-h-72">
              <div className="py-1">
                {(monthSummary as any[]).length === 0 && (
                  <div className="px-3 py-6 text-xs text-muted-foreground text-center">No data yet.</div>
                )}
                {(monthSummary as any[]).map((s) => {
                  const all = s.reviewed === s.total && s.total > 0;
                  const some = s.reviewed > 0 && !all;
                  const isActive = s.month === month;
                  return (
                    <button
                      key={s.month}
                      onClick={() => setMonth(s.month)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/60 ${
                        isActive ? "bg-muted/60" : ""
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {all ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : some ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        ) : (
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                        )}
                        {monthLabel(s.month)}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {s.reviewed}/{s.total}
                      </span>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>

        {month !== "all" && currentMonthSummary && (
          <Button
            variant={currentMonthAllReviewed ? "ghost" : "outline"}
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => markMonthReviewed(month, !currentMonthAllReviewed)}
          >
            <Check className="h-3.5 w-3.5" />
            {currentMonthAllReviewed ? "Unmark month" : "Mark month reviewed"}
          </Button>
        )}

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
            onClick={() => { setAccountId("all"); setCategoryId("all"); setTreatment("all"); setReviewedFilter("all"); setMonth("all"); setDateFrom(""); setDateTo(""); }}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Reset
          </Button>
        )}
      </div>

      {/* Table */}
      {(() => {
        const GRID = "grid-cols-[24px_1fr_180px_140px_120px]";
        // Group by month then by date.
        const months = new Map<string, { label: string; total: number; days: Map<string, any[]> }>();
        for (const t of txns as any[]) {
          const mk = String(t.date).slice(0, 7);
          const [y, mm] = mk.split("-").map(Number);
          if (!months.has(mk)) {
            months.set(mk, {
              label: new Date(y, mm - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
              total: 0,
              days: new Map(),
            });
          }
          const entry = months.get(mk)!;
          if (!t.excluded) entry.total += Number(t.amount);
          const dk = String(t.date).slice(0, 10);
          if (!entry.days.has(dk)) entry.days.set(dk, []);
          entry.days.get(dk)!.push(t);
        }

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        const dayLabel = (dk: string) => {
          const [y, m, d] = dk.split("-").map(Number);
          const dt = new Date(y, m - 1, d);
          if (dt.getTime() === today.getTime()) return "Today";
          if (dt.getTime() === yesterday.getTime()) return "Yesterday";
          return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
        };

        return (
          <div>
            <div className={`grid ${GRID} gap-4 px-2 py-3 text-xs text-muted-foreground border-b`}>
              <Checkbox
                checked={txns.length > 0 && (txns as any[]).every((t: any) => t.reviewed)}
                onCheckedChange={async (v) => {
                  const next = !!v;
                  await Promise.all((txns as any[])
                    .filter((t: any) => !!t.reviewed !== next)
                    .map((t: any) => toggleReviewed(t.id, next)));
                }}
                title="Mark all as reviewed"
              />
              <button
                type="button"
                onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
                className="inline-flex items-center gap-1 hover:text-foreground text-left"
              >
                Merchant {sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
              </button>
              <span>Category</span>
              <span>Treatment</span>
              <span className="text-right">Amount</span>
            </div>

            {[...months.entries()].map(([mk, m]) => (
              <div key={mk} className="mt-8 first:mt-4">
                <div className="flex items-baseline justify-between px-2 pb-3 border-b border-border/60">
                  <h2 className="text-2xl font-semibold tracking-tight">{m.label}</h2>
                  <span className="text-base font-semibold tabular-nums">{fmtCurrency(m.total)}</span>
                </div>
                {[...m.days.entries()].map(([dk, rows]) => (
                  <div key={dk}>
                    <div className="px-2 pt-5 pb-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {dayLabel(dk)}
                      </span>
                    </div>
                    {rows.map((t: any) => {
                      const isSelected = selected.has(t.id);
                      return (
                        <div
                          key={t.id}
                          className={`group grid ${GRID} gap-4 px-2 py-3 border-b border-border/40 items-center transition-colors ${
                            isSelected ? "bg-muted/40" : "hover:bg-muted/20"
                          } ${t.excluded ? "opacity-50" : ""}`}
                        >
                          <Checkbox
                            checked={!!t.reviewed}
                            onCheckedChange={(v) => toggleReviewed(t.id, !!v)}
                            title={t.reviewed && t.reviewed_at ? `Reviewed ${fmtDate(t.reviewed_at)}` : "Mark as reviewed"}
                          />
                          <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{t.name}</span>
                    {t.status === "pending" && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">pending</span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                      onClick={() => openDetails(t)}
                      title="Edit transaction"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
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
                  </div>
                ))}
              </div>
            ))}
            {txns.length === 0 && (
              <div className="py-20 text-center text-sm text-muted-foreground">No transactions match.</div>
            )}
          </div>
        );
      })()}

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

      {/* Transaction details side panel (non-modal: page behind stays scrollable) */}
      {(() => {
        const t = detailsId ? ((txns as any[]).find((x) => x.id === detailsId) ?? detailsRecord) : null;
        if (!t) return null;
        return (
          <aside
            className="fixed top-0 right-0 z-40 h-screen w-full sm:max-w-md border-l bg-background shadow-xl flex flex-col animate-in slide-in-from-right duration-200"
            role="dialog"
            aria-label="Edit transaction"
          >
            <div className="flex items-start justify-between px-6 pt-6 pb-2">
              <div>
                <h2 className="text-lg font-semibold">Edit transaction</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Update merchant, date, amount, category, treatment, note, and review state without leaving the list.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 -mr-2 -mt-2 shrink-0"
                onClick={() => { if (!savingDetails) setDetailsId(null); }}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 space-y-5 py-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Merchant name</Label>
                <Input
                  value={detailsDraft.name}
                  onChange={(e) => setDetailsDraft((d) => ({ ...d, name: e.target.value }))}
                />
                {detailsOriginalName && detailsOriginalName !== detailsDraft.name && (
                  <div className="text-[11px] text-muted-foreground">Original: {detailsOriginalName}</div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Date</Label>
                  <Input
                    type="date"
                    value={detailsDraft.date}
                    onChange={(e) => setDetailsDraft((d) => ({ ...d, date: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={detailsDraft.amount}
                    onChange={(e) => setDetailsDraft((d) => ({ ...d, amount: e.target.value }))}
                    className="tabular-nums"
                  />
                </div>
              </div>

              {t.accounts?.name && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Account</Label>
                  <div className="text-sm">
                    {t.accounts.name}{t.accounts.mask ? ` ····${t.accounts.mask}` : ""}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Category</Label>
                <CategoryCombobox
                  value={t.category_id}
                  categories={categories as any}
                  onChange={(v) => handleCategoryChange(t, v)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Treatment</Label>
                <TreatmentPicker
                  treatment={(t.treatment ?? "normal") as Treatment}
                  meta={(t.treatment_meta ?? {}) as TreatmentMeta}
                  amount={Number(t.amount)}
                  date={t.date}
                  onSave={(treatment, meta) => updateTreatment(t.id, treatment, meta)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Note</Label>
                <Textarea
                  rows={4}
                  placeholder="Add a note about this transaction…"
                  value={detailsDraft.note}
                  onChange={(e) => setDetailsDraft((d) => ({ ...d, note: e.target.value }))}
                />
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Reviewed</div>
                  <div className="text-xs text-muted-foreground">
                    {t.reviewed && t.reviewed_at ? `Marked ${fmtDate(t.reviewed_at)}` : "Not yet reviewed"}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={t.reviewed ? "secondary" : "outline"}
                  onClick={() => toggleReviewed(t.id, !t.reviewed)}
                >
                  {t.reviewed ? (<><Check className="h-3.5 w-3.5 mr-1.5" />Reviewed</>) : "Mark as reviewed"}
                </Button>
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Excluded from totals</div>
                  <div className="text-xs text-muted-foreground">Hide this transaction from spend summaries.</div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={t.excluded ? "secondary" : "outline"}
                  onClick={() => updateField(t.id, "excluded", t.excluded, !t.excluded)}
                >
                  {t.excluded ? "Excluded" : "Exclude"}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-6 py-4 bg-background">
              <Button variant="ghost" size="sm" onClick={() => setDetailsId(null)} disabled={savingDetails}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveDetails} disabled={savingDetails}>
                {savingDetails ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </aside>
        );
      })()}

      {/* Alias prompt */}
      <Dialog open={!!aliasPrompt} onOpenChange={(o) => { if (!o && !creatingAlias) setAliasPrompt(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save as merchant alias?</DialogTitle>
            <DialogDescription>
              Create an alias so future imports matching <span className="font-medium text-foreground">{aliasPrompt?.oldName}</span> are automatically displayed as <span className="font-medium text-foreground">{aliasPrompt?.newName}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm text-muted-foreground py-2">
            {aliasPrompt?.matchCount === 0
              ? "No other transactions currently share this merchant name."
              : `${aliasPrompt?.matchCount} other transaction${aliasPrompt?.matchCount === 1 ? "" : "s"} share this merchant name.`}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAliasPrompt(null)} disabled={creatingAlias}>
              Don't save
            </Button>
            <Button variant="outline" size="sm" onClick={() => createAliasAndApply(false)} disabled={creatingAlias}>
              Save alias only
            </Button>
            <Button size="sm" onClick={() => createAliasAndApply(true)} disabled={creatingAlias || !aliasPrompt?.matchCount}>
              {creatingAlias ? "Applying…" : `Save & apply to ${aliasPrompt?.matchCount ?? 0}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Transactions;
