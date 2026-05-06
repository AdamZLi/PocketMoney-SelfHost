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
import { ArrowDown, ArrowUp, Trash2, Search, Calendar, X, Sparkles, Loader2, Undo2, CheckCircle2, Flag, Check, CalendarCheck, Pencil, Plus, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  const [scanReviewed, setScanReviewed] = useState<"unreviewed" | "reviewed" | "all">("unreviewed");
  const [scanAccountId, setScanAccountId] = useState<string>("all");
  // Month in YYYY-MM format, "" means all months
  const [scanMonth, setScanMonth] = useState<string>("");
  // "all" = any category, "uncategorized" = null only, otherwise a category id
  const [scanCategoryId, setScanCategoryId] = useState<string>("all");
  type PreviewItem = {
    txnId: string;
    name: string;
    amount: number;
    oldCategoryId: string | null;
    newCategoryId: string | null;
    newCategoryName: string;
    oldTreatment: Treatment;
    newTreatment: Treatment;
    newTreatmentMeta: TreatmentMeta;
    confidence: number; // 0..1
    bucket: "high" | "medium" | "low";
    reason: string;
    source: "rule" | "ai";
    isNoChange: boolean;
    dismissed?: { category?: boolean; treatment?: boolean };
    unverified?: boolean;
  };
  type ScanStage = "configure" | "previewing" | "preview" | "applying" | "summary";
  const [scanStage, setScanStage] = useState<ScanStage>("configure");
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);
  const [scanTotalConsidered, setScanTotalConsidered] = useState(0);
  const [excludedFromPreview, setExcludedFromPreview] = useState<Set<string>>(new Set());
  const [bucketsCollapsed, setBucketsCollapsed] = useState<Record<"high" | "medium" | "low", boolean>>({ high: true, medium: false, low: false });
  const [noChangeCollapsed, setNoChangeCollapsed] = useState(true);
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
    // If there's an AI proposal for this txn and the existing note doesn't already
    // include it, prefill the note with the agent's reasoning so the user can keep,
    // edit or replace it.
    const proposal = previewItems.find((p) => p.txnId === t.id);
    let note = t.note ?? "";
    if (proposal?.reason && proposal.source === "ai") {
      const tag = `[AI · ${Math.round(proposal.confidence * 100)}%] ${proposal.reason}`;
      if (!note.includes(proposal.reason)) {
        note = note ? `${tag}\n\n${note}` : tag;
      }
    }
    setDetailsDraft({
      name: t.name ?? "",
      date: t.date ?? "",
      note,
      amount: t.amount != null ? String(t.amount) : "",
    });
  }

  async function saveDetails() {
    if (!detailsId) return;
    const t = (txns as any[]).find((x) => x.id === detailsId) ?? detailsRecord;
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
  // Rule-based category matches always take precedence; the AI Review Agent
  // sees the rest and proposes both category AND treatment with a confidence.
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
        .select("id,name,amount,date,category_id,treatment,treatment_meta,account_id,accounts(name)")
        .eq("excluded", false);
      if (scanReviewed === "unreviewed") q = q.eq("reviewed", false);
      else if (scanReviewed === "reviewed") q = q.eq("reviewed", true);
      if (scanAccountId !== "all") q = q.eq("account_id", scanAccountId);
      if (scanCategoryId === "uncategorized") q = q.is("category_id", null);
      else if (scanCategoryId !== "all") q = q.eq("category_id", scanCategoryId);
      if (scanMonth) {
        const [y, m] = scanMonth.split("-").map(Number);
        const start = `${scanMonth}-01`;
        const endDate = new Date(y, m, 1);
        const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-01`;
        q = q.gte("date", start).lt("date", end);
      }
      const { data: pending, error } = await q;
      if (error) throw error;
      const list = (pending ?? []) as any[];
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
      const catName = (id: string | null) =>
        id ? ((categories as any[]).find((c) => c.id === id)?.name ?? "Unknown") : "Uncategorized";

      const items: PreviewItem[] = [];
      const remaining: any[] = [];

      for (const t of list) {
        const cat = applyRules(t.name, rules);
        const oldTreatment: Treatment = (t.treatment ?? "normal") as Treatment;
        if (cat) {
          const ruleChanges = cat !== t.category_id;
          items.push({
            txnId: t.id,
            name: t.name,
            amount: Number(t.amount) || 0,
            oldCategoryId: t.category_id,
            newCategoryId: cat,
            newCategoryName: catName(cat),
            oldTreatment,
            newTreatment: oldTreatment,
            newTreatmentMeta: (t.treatment_meta ?? {}) as TreatmentMeta,
            confidence: 1,
            bucket: "high",
            reason: ruleChanges
              ? "Matched a saved category rule."
              : "Already matches a saved category rule — no change needed.",
            source: "rule",
            isNoChange: !ruleChanges,
          });
        } else {
          remaining.push(t);
        }
      }

      setScanProgress({ done: 0, total: remaining.length });

      const CHUNK = 25;
      for (let i = 0; i < remaining.length; i += CHUNK) {
        const chunk = remaining.slice(i, i + CHUNK);
        const { data: aiData, error: aiErr } = await supabase.functions.invoke(
          "review-transactions",
          {
            body: {
              transactions: chunk.map((t: any) => ({
                id: t.id,
                name: t.name,
                amount: Number(t.amount) || 0,
                date: t.date,
                current_category_id: t.category_id,
                current_treatment: t.treatment,
                account_name: t.accounts?.name ?? null,
              })),
              categories: (categories as any[]).map((c) => ({
                id: c.id,
                name: c.name,
                parent_category: c.parent_category,
              })),
            },
          },
        );
        if (aiErr) {
          toast({ title: "AI review paused", description: aiErr.message, variant: "destructive" });
          break;
        }
        const proposals: Array<{
          id: string;
          category_id: string | null;
          treatment: Treatment;
          treatment_meta: TreatmentMeta;
          confidence: number;
          reason: string;
          unverified?: boolean;
        }> = aiData?.proposals ?? [];

        const seenIds = new Set<string>();
        for (const p of proposals) {
          const t = chunk.find((x: any) => x.id === p.id);
          if (!t) continue;
          if (seenIds.has(p.id)) continue; // server already dedupes; belt + braces
          seenIds.add(p.id);
          const oldTreatment: Treatment = (t.treatment ?? "normal") as Treatment;
          const categoryChanged = p.category_id !== t.category_id;
          const treatmentChanged = p.treatment !== oldTreatment;
          const isNoChange = !categoryChanged && !treatmentChanged;
          const rawC = Math.max(0, Math.min(1, Number(p.confidence) || 0));
          // Unverified proposals stay in Low regardless of model self-rating.
          // No-change verdicts always land in High — the agent confirmed
          // the existing values match its proposal.
          const c = p.unverified
            ? Math.min(rawC, 0.4)
            : isNoChange
              ? Math.max(rawC, 0.9)
              : rawC;
          const bucket: PreviewItem["bucket"] = c >= 0.9 ? "high" : c >= 0.5 ? "medium" : "low";
          items.push({
            txnId: t.id,
            name: t.name,
            amount: Number(t.amount) || 0,
            oldCategoryId: t.category_id,
            newCategoryId: p.category_id,
            newCategoryName: catName(p.category_id),
            oldTreatment,
            newTreatment: p.treatment,
            newTreatmentMeta: p.treatment_meta ?? {},
            confidence: c,
            bucket,
            reason: p.reason ?? "",
            source: "ai",
            isNoChange,
            unverified: !!p.unverified,
          });
        }
        setScanProgress({ done: Math.min(remaining.length, i + chunk.length), total: remaining.length });
      }

      // Final guard: in the unlikely case duplicates slipped through across
      // chunks or rule + AI both produced an entry for the same txn, keep
      // the first one. Rule entries come first so they win.
      const dedup = new Map<string, PreviewItem>();
      for (const it of items) if (!dedup.has(it.txnId)) dedup.set(it.txnId, it);
      setPreviewItems(Array.from(dedup.values()));
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
    const toApply = previewItems.filter((p) => !p.isNoChange && !excludedFromPreview.has(p.txnId));
    // Every transaction the agent looked at (changes + no-change confirms,
    // minus user-dismissed) gets marked as reviewed when the user confirms.
    const toMarkReviewed = previewItems.filter((p) => !excludedFromPreview.has(p.txnId));
    if (toApply.length === 0 && toMarkReviewed.length === 0) {
      toast({ title: "Nothing to mark" });
      return;
    }
    setScanStage("applying");
    setScanning(true);
    setScanProgress({ done: 0, total: toMarkReviewed.length });
    try {
      let done = 0;
      const reviewedAt = new Date().toISOString();
      for (const p of toMarkReviewed) {
        const txn = (txns as any[]).find((x) => x.id === p.txnId);
        const curCat = txn ? (txn.category_id ?? null) : p.oldCategoryId;
        const curTr = txn ? ((txn.treatment ?? "normal") as Treatment) : p.oldTreatment;
        const updates: Record<string, any> = { reviewed: true, reviewed_at: reviewedAt };
        const edits: Array<{ field_changed: string; old_value: any; new_value: any }> = [];
        if (!p.isNoChange && p.newCategoryId !== curCat) {
          updates.category_id = p.newCategoryId;
          edits.push({ field_changed: "category_id", old_value: curCat, new_value: p.newCategoryId });
        }
        if (!p.isNoChange && p.newTreatment !== curTr) {
          updates.treatment = p.newTreatment;
          updates.treatment_meta = p.newTreatmentMeta ?? {};
          updates.excluded = p.newTreatment === "excluded";
          edits.push({ field_changed: "treatment", old_value: curTr, new_value: p.newTreatment });
        }
        const { error: upErr } = await supabase.from("transactions").update(updates as any).eq("id", p.txnId);
        if (upErr) throw upErr;
        if (edits.length > 0) {
          await supabase.from("transaction_edits").insert(
            edits.map((e) => ({ transaction_id: p.txnId, ...e })),
          );
        }
        // Learning loop: record acceptance for AI-sourced proposals.
        if (p.source === "ai" && !p.isNoChange) {
          await supabase.from("agent_feedback").insert([
            {
              transaction_id: p.txnId,
              merchant_name: p.name.trim().toLowerCase(),
              field: "category",
              ai_value: { category_id: p.newCategoryId },
              ai_confidence: p.confidence,
              user_action: "accepted",
              user_value: null,
            },
            {
              transaction_id: p.txnId,
              merchant_name: p.name.trim().toLowerCase(),
              field: "treatment",
              ai_value: { treatment: p.newTreatment, meta: p.newTreatmentMeta },
              ai_confidence: p.confidence,
              user_action: "accepted",
              user_value: null,
            },
          ]);
        }
        done += 1;
        setScanProgress({ done, total: toMarkReviewed.length });
      }
      // Record dismissals (unchecked AI items) for the learning loop.
      const dismissed = previewItems.filter((p) => excludedFromPreview.has(p.txnId) && p.source === "ai");
      if (dismissed.length > 0) {
        await supabase.from("agent_feedback").insert(
          dismissed.flatMap((p) => [
            {
              transaction_id: p.txnId,
              merchant_name: p.name.trim().toLowerCase(),
              field: "category",
              ai_value: { category_id: p.newCategoryId },
              ai_confidence: p.confidence,
              user_action: "dismissed",
              user_value: null,
            },
          ]),
        );
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

  // Revert: restore each previously-changed transaction to its prior category + treatment.
  async function revertLastScan() {
    if (!lastApplied || lastApplied.length === 0) return;
    setReverting(true);
    try {
      for (const p of lastApplied) {
        const updates: Record<string, any> = {};
        if (p.newCategoryId !== p.oldCategoryId) updates.category_id = p.oldCategoryId;
        if (p.newTreatment !== p.oldTreatment) {
          updates.treatment = p.oldTreatment;
          updates.excluded = p.oldTreatment === "excluded";
        }
        if (Object.keys(updates).length > 0) {
          await supabase.from("transactions").update(updates as any).eq("id", p.txnId);
        }
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
            {scanning ? "Scanning…" : "AI scan & review"}
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

      {scanOpen && (
        <aside
          className="fixed top-0 right-0 z-40 h-screen w-full sm:max-w-md border-l bg-background shadow-xl flex flex-col animate-in slide-in-from-right duration-200"
          role="dialog"
          aria-label="AI scan and review"
        >
          <button
            type="button"
            onClick={() => { if (!scanning) { setScanOpen(false); resetScanDialog(); } }}
            className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          {scanStage === "configure" && (() => {
            // Build month options from loaded transactions (most recent first)
            const monthSet = new Set<string>();
            for (const t of (txns as any[])) {
              if (t?.date) monthSet.add(String(t.date).slice(0, 7));
            }
            const monthOpts = [...monthSet].sort((a, b) => (a < b ? 1 : -1));
            const monthLabel = (ym: string) => {
              const [y, m] = ym.split("-").map(Number);
              return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
            };
            return (
              <>
                <div className="px-6 pt-6 pb-2">
                  <h2 className="text-lg font-semibold">AI scan &amp; review</h2>
                  <p className="text-sm text-muted-foreground">
                    Pick which transactions to analyze. Existing rules apply first; the AI agent reviews the rest. You'll preview changes before anything is saved.
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Reviewed</Label>
                    <Select value={scanReviewed} onValueChange={(v) => setScanReviewed(v as any)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unreviewed">Not reviewed yet</SelectItem>
                        <SelectItem value="reviewed">Already reviewed</SelectItem>
                        <SelectItem value="all">All transactions</SelectItem>
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
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Category</Label>
                    <Select value={scanCategoryId} onValueChange={setScanCategoryId}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All categories</SelectItem>
                        <SelectItem value="uncategorized">Uncategorized only</SelectItem>
                        {(categories as any[]).map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Month</Label>
                    <Select value={scanMonth || "all"} onValueChange={(v) => setScanMonth(v === "all" ? "" : v)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All months</SelectItem>
                        {monthOpts.map((ym) => (
                          <SelectItem key={ym} value={ym}>{monthLabel(ym)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="border-t px-6 py-4 bg-background">
                  <Button variant="ghost" onClick={() => setScanOpen(false)}>Cancel</Button>
                  <Button onClick={buildScanPreview} className="gap-2">
                    <Sparkles className="h-3.5 w-3.5" />
                    Preview changes
                  </Button>
                </div>
              </>
            );
          })()}

          {scanStage === "previewing" && (
            <>
              <div className="px-6 pt-6 pb-2">
                <h2 className="text-lg font-semibold">Analyzing transactions…</h2>
                <p className="text-sm text-muted-foreground">
                  Applying rules and asking the AI agent to review the remaining merchants.
                </p>
              </div>
              <div className="px-6 py-6 space-y-3">
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

          {scanStage === "preview" && (() => {
            const buckets: Array<{
              key: "high" | "medium" | "low";
              label: string;
              dot: string;
              ring: string;
              items: PreviewItem[];
            }> = [
              { key: "high", label: "High confidence", dot: "bg-confidence-high", ring: "border-confidence-high/30", items: previewItems.filter((p) => p.bucket === "high" && !p.isNoChange) },
              { key: "medium", label: "Medium confidence", dot: "bg-confidence-medium", ring: "border-confidence-medium/30", items: previewItems.filter((p) => p.bucket === "medium") },
              { key: "low", label: "Low confidence", dot: "bg-confidence-low", ring: "border-confidence-low/30", items: previewItems.filter((p) => p.bucket === "low") },
            ];
            const noChangeItems = previewItems.filter((p) => p.isNoChange);
            const changeItems = previewItems.filter((p) => !p.isNoChange);
            const oldCatName = (id: string | null) =>
              id ? ((categories as any[]).find((c) => c.id === id)?.name ?? "—") : "Uncategorized";
            const treatmentLabelShort = (t: Treatment) => t === "normal" ? "normal" : t;
            const selectedCount = changeItems.filter((p) => {
              if (excludedFromPreview.has(p.txnId)) return false;
              const txn = (txns as any[]).find((x) => x.id === p.txnId);
              const curCat = txn ? (txn.category_id ?? null) : p.oldCategoryId;
              const curTr = txn ? ((txn.treatment ?? "normal") as Treatment) : p.oldTreatment;
              return p.newCategoryId !== curCat || p.newTreatment !== curTr;
            }).length;
            return (
              <>
                <div className="px-6 pt-6 pb-2">
                  <h2 className="text-lg font-semibold">Review proposed changes</h2>
                  <p className="text-sm text-muted-foreground">
                    {changeItems.length === 0
                      ? `No changes proposed. Confirming will mark all ${scanTotalConsidered} reviewed transaction${scanTotalConsidered === 1 ? "" : "s"} as reviewed.`
                      : `${selectedCount} of ${changeItems.length} change${changeItems.length === 1 ? "" : "s"} selected. All ${scanTotalConsidered} considered transaction${scanTotalConsidered === 1 ? "" : "s"} (${noChangeItems.length} no-change) will be marked as reviewed when you confirm.`}
                  </p>
                </div>
                {previewItems.length > 0 && (
                  <ScrollArea className="flex-1 px-6">
                    <div className="space-y-4 pb-4">
                      {buckets.map((b) => {
                        if (b.items.length === 0) return null;
                        const collapsed = bucketsCollapsed[b.key];
                        return (
                          <div key={b.key} className={`rounded-lg border ${b.ring}`}>
                            <button
                              type="button"
                              className="w-full flex items-center gap-2 px-3 py-2 text-left"
                              onClick={() => setBucketsCollapsed((prev) => ({ ...prev, [b.key]: !prev[b.key] }))}
                            >
                              <span className={`h-2 w-2 rounded-full ${b.dot}`} />
                              <span className="text-sm font-medium">{b.label}</span>
                              <span className="text-xs text-muted-foreground">
                                {b.items.length} item{b.items.length === 1 ? "" : "s"}
                              </span>
                              {b.key === "high" && (
                                <Badge variant="secondary" className="ml-1 text-[10px] uppercase tracking-wide">
                                  Auto ✓
                                </Badge>
                              )}
                              {b.key !== "high" && (
                                <Badge variant="outline" className="ml-1 text-[10px] uppercase tracking-wide">
                                  Needs review
                                </Badge>
                              )}
                              <span className="ml-auto text-xs text-muted-foreground">{collapsed ? "Show" : "Hide"}</span>
                            </button>
                            {!collapsed && (
                              <div className="divide-y border-t">
                                {b.items.map((p) => {
                                  const checked = !excludedFromPreview.has(p.txnId);
                                  const txn = (txns as any[]).find((x) => x.id === p.txnId);
                                  // Use LIVE txn state so user edits made via the side panel
                                  // are reflected here immediately.
                                  const currentCatId = txn ? (txn.category_id ?? null) : p.oldCategoryId;
                                  const currentTreatment = txn ? ((txn.treatment ?? "normal") as Treatment) : p.oldTreatment;
                                  const oldCat = oldCatName(currentCatId);
                                  const catChanged = p.newCategoryId !== currentCatId;
                                  const trChanged = p.newTreatment !== currentTreatment;
                                  const fullyDismissed = !!(p.dismissed?.category || p.dismissed?.treatment) && !catChanged && !trChanged;
                                  const alreadyMatches = !catChanged && !trChanged && !fullyDismissed;
                                  return (
                                    <div key={p.txnId} className="flex items-start gap-3 px-3 py-2.5 group">
                                      <Checkbox
                                        className="mt-1"
                                        checked={checked && !alreadyMatches}
                                        disabled={alreadyMatches}
                                        onCheckedChange={(v) => {
                                          setExcludedFromPreview((prev) => {
                                            const next = new Set(prev);
                                            if (v) next.delete(p.txnId);
                                            else next.add(p.txnId);
                                            return next;
                                          });
                                        }}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => txn && openDetails(txn)}
                                        disabled={!txn}
                                        className="flex-1 min-w-0 text-left rounded -mx-1 px-1 py-0.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed"
                                        title="Click to edit transaction"
                                      >
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="text-sm truncate flex items-center gap-1.5">
                                            {p.name}
                                            {alreadyMatches && (
                                              <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">Applied</Badge>
                                            )}
                                            {fullyDismissed && (
                                              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">Dismissed</Badge>
                                            )}
                                            {p.unverified && (
                                              <Badge variant="outline" className="text-[10px] uppercase tracking-wide border-confidence-low/60 text-confidence-low">⚠ Verify</Badge>
                                            )}
                                            <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                          </div>
                                          <div className="text-xs tabular-nums text-muted-foreground">
                                            {fmtCurrency(p.amount)}
                                          </div>
                                        </div>
                                        {catChanged && (
                                          <div className="text-xs text-muted-foreground truncate">
                                            <span className="opacity-70">Category:</span>{" "}
                                            {oldCat} → <span className="text-foreground/90">{p.newCategoryName}</span>
                                          </div>
                                        )}
                                        {trChanged && (
                                          <div className="text-xs text-muted-foreground truncate">
                                            <span className="opacity-70">Treatment:</span>{" "}
                                            {treatmentLabelShort(currentTreatment)} → <span className="text-foreground/90">{treatmentLabelShort(p.newTreatment)}</span>
                                          </div>
                                        )}
                                        {p.reason && (
                                          <div className="text-[11px] text-muted-foreground/80 mt-0.5 truncate" title={p.reason}>
                                            {p.source === "rule" ? "Rule match" : `AI · ${Math.round(p.confidence * 100)}%`} — {p.reason}
                                          </div>
                                        )}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {noChangeItems.length > 0 && (
                        <div className="rounded-lg border border-confidence-high/20 bg-muted/20">
                          <button
                            type="button"
                            className="w-full flex items-center gap-2 px-3 py-2 text-left"
                            onClick={() => setNoChangeCollapsed((v) => !v)}
                          >
                            <span className="h-2 w-2 rounded-full bg-confidence-high/60" />
                            <span className="text-sm font-medium">No change needed</span>
                            <span className="text-xs text-muted-foreground">
                              {noChangeItems.length} item{noChangeItems.length === 1 ? "" : "s"}
                            </span>
                            <Badge variant="outline" className="ml-1 text-[10px] uppercase tracking-wide">
                              Confirmed
                            </Badge>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {noChangeCollapsed ? "Show breakdown" : "Hide"}
                            </span>
                          </button>
                          {!noChangeCollapsed && (
                            <div className="divide-y border-t">
                              {noChangeItems.map((p) => {
                                const txn = (txns as any[]).find((x) => x.id === p.txnId);
                                const checked = !excludedFromPreview.has(p.txnId);
                                return (
                                  <div key={p.txnId} className="flex items-start gap-3 px-3 py-2.5 group">
                                    <Checkbox
                                      className="mt-1"
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
                                    <button
                                      type="button"
                                      onClick={() => txn && openDetails(txn)}
                                      disabled={!txn}
                                      className="flex-1 min-w-0 text-left rounded -mx-1 px-1 py-0.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed"
                                      title="Click to edit transaction"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="text-sm truncate flex items-center gap-1.5">
                                          {p.name}
                                          <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                        <div className="text-xs tabular-nums text-muted-foreground">
                                          {fmtCurrency(p.amount)}
                                        </div>
                                      </div>
                                      <div className="text-xs text-muted-foreground truncate">
                                        <span className="opacity-70">Category:</span>{" "}
                                        {oldCatName(txn ? (txn.category_id ?? null) : p.oldCategoryId)}{" "}
                                        <span className="opacity-70">· Treatment:</span>{" "}
                                        {treatmentLabelShort((txn ? (txn.treatment ?? "normal") : p.oldTreatment) as Treatment)}
                                      </div>
                                      {p.reason && (
                                        <div className="text-[11px] text-muted-foreground/80 mt-0.5 truncate" title={p.reason}>
                                          AI · {Math.round(p.confidence * 100)}% — {p.reason}
                                        </div>
                                      )}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                )}
                <div className="border-t px-6 py-4 bg-background flex items-center gap-2">
                  <Button variant="ghost" onClick={() => setScanStage("configure")}>Back</Button>
                  {(() => {
                    const reviewCount = previewItems.filter((p) => !excludedFromPreview.has(p.txnId)).length;
                    return (
                      <Button
                        onClick={applyScanPreview}
                        disabled={reviewCount === 0}
                        className="gap-2 ml-auto"
                      >
                        <Check className="h-4 w-4" />
                        Mark {reviewCount} as reviewed
                        {selectedCount > 0 && ` (apply ${selectedCount} change${selectedCount === 1 ? "" : "s"})`}
                      </Button>
                    );
                  })()}
                </div>
              </>
            );
          })()}

          {scanStage === "applying" && (
            <>
              <div className="px-6 pt-6 pb-2">
                <h2 className="text-lg font-semibold">Marking as reviewed…</h2>
                <p className="text-sm text-muted-foreground">Applying changes and updating review state.</p>
              </div>
              <div className="px-6 py-6 space-y-3">
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
              <div className="px-6 pt-6 pb-2">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-foreground/80" />
                  Scan complete
                </h2>
                <p className="text-sm text-muted-foreground">
                  Categorized {lastApplied.length} transaction{lastApplied.length === 1 ? "" : "s"} out of {scanTotalConsidered} considered.
                </p>
              </div>
              <div className="px-6 py-2 grid grid-cols-3 gap-3">
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
              <div className="border-t px-6 py-4 bg-background mt-auto">
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
              </div>
            </>
          )}
        </aside>
      )}

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

              {(() => {
                const proposal = previewItems.find((p) => p.txnId === t.id);
                if (!proposal) return null;
                const curCat = t.category_id ?? null;
                const curTr = (t.treatment ?? "normal") as Treatment;
                const catDiffers = proposal.newCategoryId !== curCat;
                const trDiffers = proposal.newTreatment !== curTr;
                const allApplied = !catDiffers && !trDiffers;
                const dotColor =
                  proposal.bucket === "high" ? "bg-confidence-high"
                  : proposal.bucket === "medium" ? "bg-confidence-medium"
                  : "bg-confidence-low";
                const oldCatName = curCat
                  ? ((categories as any[]).find((c) => c.id === curCat)?.name ?? "—")
                  : "Uncategorized";
                const merchantKey = (proposal.name ?? t.name ?? "").trim().toLowerCase();
                const recordFeedback = async (
                  field: "category" | "treatment",
                  action: "accepted" | "dismissed" | "modified",
                  userValue: any,
                ) => {
                  if (proposal.source !== "ai") return;
                  await supabase.from("agent_feedback").insert({
                    transaction_id: t.id,
                    merchant_name: merchantKey,
                    field,
                    ai_value:
                      field === "category"
                        ? { category_id: proposal.newCategoryId }
                        : { treatment: proposal.newTreatment, meta: proposal.newTreatmentMeta },
                    ai_confidence: proposal.confidence,
                    user_action: action,
                    user_value: userValue,
                  });
                };
                const applyCategoryOnly = async () => {
                  await handleCategoryChange(t, proposal.newCategoryId);
                  await recordFeedback("category", "accepted", { category_id: proposal.newCategoryId });
                };
                const applyTreatmentOnly = async () => {
                  await updateTreatment(t.id, proposal.newTreatment, proposal.newTreatmentMeta ?? {});
                  await recordFeedback("treatment", "accepted", {
                    treatment: proposal.newTreatment, meta: proposal.newTreatmentMeta,
                  });
                };
                const applyAll = async () => {
                  if (catDiffers) await applyCategoryOnly();
                  if (trDiffers) await applyTreatmentOnly();
                };
                // Drop just one field of the proposal (category or treatment) while
                // keeping the txn in the review list and the other field intact.
                const dismissField = async (field: "category" | "treatment") => {
                  await recordFeedback(
                    field,
                    "dismissed",
                    field === "category" ? { category_id: curCat } : { treatment: curTr },
                  );
                  setPreviewItems((prev) => prev.map((p) => {
                    if (p.txnId !== t.id) return p;
                    const next = { ...p, dismissed: { ...(p.dismissed ?? {}) } };
                    if (field === "category") {
                      next.newCategoryId = curCat;
                      next.newCategoryName = oldCatName;
                      next.dismissed!.category = true;
                    } else {
                      next.newTreatment = curTr;
                      next.newTreatmentMeta = (t.treatment_meta ?? {}) as TreatmentMeta;
                      next.dismissed!.treatment = true;
                    }
                    // Keep the item in its existing bucket (don't move to "No change needed")
                    // so the user still sees it on the review list and can mark it reviewed.
                    return next;
                  }));
                  setExcludedFromPreview((prev) => {
                    const n = new Set(prev); n.delete(t.id); return n;
                  });
                  toast({ title: `${field === "category" ? "Category" : "Treatment"} suggestion dismissed` });
                };
                const dismissAll = async () => {
                  if (catDiffers) await dismissField("category");
                  if (trDiffers) await dismissField("treatment");
                };
                return (
                  <div className="rounded-md border bg-muted/30 p-3 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                      <div className="text-sm font-medium">AI proposal</div>
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        {proposal.source === "rule" ? "Rule" : `${Math.round(proposal.confidence * 100)}%`}
                      </Badge>
                      {allApplied && (
                        <Badge variant="secondary" className="text-[10px] uppercase tracking-wide ml-auto">
                          Applied
                        </Badge>
                      )}
                    </div>
                    {proposal.unverified && (
                      <div className="rounded border border-confidence-low/40 bg-confidence-low/10 px-2 py-1 text-[11px] text-foreground/80">
                        ⚠ Reason may not match this merchant — please verify before accepting.
                      </div>
                    )}
                    {catDiffers && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 text-xs text-muted-foreground min-w-0 truncate">
                          <span className="opacity-70">Category:</span>{" "}
                          {oldCatName} → <span className="text-foreground">{proposal.newCategoryName}</span>
                        </div>
                        <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-muted-foreground" onClick={() => dismissField("category")}>
                          Dismiss
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={applyCategoryOnly}>
                          Apply
                        </Button>
                      </div>
                    )}
                    {trDiffers && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 text-xs text-muted-foreground min-w-0 truncate">
                          <span className="opacity-70">Treatment:</span>{" "}
                          {curTr} → <span className="text-foreground">{proposal.newTreatment}</span>
                        </div>
                        <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-muted-foreground" onClick={() => dismissField("treatment")}>
                          Dismiss
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={applyTreatmentOnly}>
                          Apply
                        </Button>
                      </div>
                    )}
                    {proposal.reason && (
                      <div className="text-xs text-muted-foreground italic">
                        "{proposal.reason}"
                      </div>
                    )}
                    {!allApplied && (
                      <div className="flex items-center gap-2 pt-1">
                        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={dismissAll}>
                          Dismiss all
                        </Button>
                        <Button type="button" size="sm" className="h-7 text-xs ml-auto" onClick={applyAll}>
                          Apply all
                        </Button>
                      </div>
                    )}
                    {proposal.source === "ai" && (
                      <p className="text-[10px] text-muted-foreground/70">
                        Your choice (apply, edit, or dismiss) is saved to improve future suggestions.
                      </p>
                    )}
                  </div>
                );
              })()}

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
