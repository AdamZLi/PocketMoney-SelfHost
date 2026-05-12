import React, { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AliasReassignCombobox } from "@/components/AliasReassignCombobox";
import { parseFile, ParsedTxn } from "@/lib/parseFile";
import { applyRules } from "@/lib/categorize";
import { loadAliases } from "@/lib/cleanMerchant";
import { findDuplicateGroups, type DedupEntry, type DupGroup as SharedDupGroup } from "@/lib/dedup";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { Upload, FileText, Sparkles, Loader2, AlertTriangle, Check, Copy, Flag } from "lucide-react";
import { fmtCurrency, fmtDate } from "@/lib/format";

const DUP_GROUP_BATCH_SIZE = 50;

type Staged = ParsedTxn & {
  _row: number;
  _raw_name: string;
  _category_id: string | null;
  _account_id: string | null;
  _categorized_by: "file" | "rule" | "ai" | "none";
  _confidence?: number;
  _drop?: boolean;
  _edited?: boolean;
};

type DupSource =
  | { kind: "staged"; row: number }
  | { kind: "existing"; id: string; date: string; name: string; amount: number };

type DupGroup = {
  key: string;
  members: DupSource[];
  // index in `members` representing the staged row to keep when action === "merge"
  keepIndex: number;
  action: "merge" | "keep_both" | "flag";
  crossAccount?: boolean;
};

type DupGroupRowProps = {
  group: DupGroup;
  index: number;
  stagedById: Map<number, Staged>;
  onSetAction: (idx: number, action: DupGroup["action"]) => void;
  onSetKeep: (idx: number, keepIndex: number) => void;
};

type DupActionSummary = Record<DupGroup["action"], number>;

const DupGroupRow = ({ group: g, index: gi, stagedById, onSetAction, onSetKeep }: DupGroupRowProps) => (
  <div className="rounded-md border bg-background p-3 space-y-2">
    <div className="flex flex-wrap items-center gap-2 justify-between">
      <div className="text-xs text-muted-foreground">
        {g.members.length} matching transactions
        {g.crossAccount && (
          <Badge variant="outline" className="ml-2 text-[10px] border-amber-400 text-amber-700">Cross-account</Badge>
        )}
      </div>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant={g.action === "keep_both" ? "default" : "outline"}
          className="h-7 gap-1.5"
          onClick={() => onSetAction(gi, "keep_both")}
        >
          <Check className="h-3 w-3" /> Keep all
        </Button>
        <Button
          size="sm"
          variant={g.action === "merge" ? "default" : "outline"}
          className="h-7 gap-1.5"
          onClick={() => onSetAction(gi, "merge")}
        >
          <Copy className="h-3 w-3" /> Merge all
        </Button>
        <Button
          size="sm"
          variant={g.action === "flag" ? "default" : "outline"}
          className="h-7 gap-1.5"
          onClick={() => onSetAction(gi, "flag")}
        >
          <Flag className="h-3 w-3" /> Flag
        </Button>
      </div>
    </div>
    <div className="divide-y">
      {g.members.map((m, mi) => {
        const isStaged = m.kind === "staged";
        const date = isStaged ? stagedById.get(m.row)?.date ?? "" : m.date;
        const name = isStaged ? stagedById.get(m.row)?.name ?? "" : m.name;
        const amount = isStaged ? stagedById.get(m.row)?.amount ?? 0 : m.amount;
        const isKept = g.action === "merge" && mi === g.keepIndex;
        const willDrop = g.action === "merge" && !isKept && isStaged;
        return (
          <div key={mi} className={`flex items-center gap-3 py-2 text-sm ${willDrop ? "opacity-50" : ""}`}>
            <div className="w-24 text-xs text-muted-foreground tabular-nums">{fmtDate(date)}</div>
            <div className="flex-1 truncate">
              {name}
              <Badge variant="outline" className="ml-2 text-[10px]">
                {isStaged ? "new" : "existing"}
              </Badge>
            </div>
            <div className="tabular-nums w-24 text-right">{fmtCurrency(amount)}</div>
            {g.action === "merge" && (
              <Button
                size="sm"
                variant={isKept ? "secondary" : "ghost"}
                className="h-7 text-xs"
                onClick={() => onSetKeep(gi, mi)}
              >
                {isKept ? "Keep" : "Use this"}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  </div>
);

const MemoDupGroupRow = React.memo(DupGroupRow, (prev, next) =>
  prev.group === next.group &&
  prev.index === next.index &&
  prev.stagedById === next.stagedById &&
  prev.onSetAction === next.onSetAction &&
  prev.onSetKeep === next.onSetKeep
);

const Import = () => {
  const qc = useQueryClient();
  const [staging, setStaging] = useState<Staged[]>([]);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [dupGroups, setDupGroups] = useState<DupGroup[]>([]);
  const [visibleDupGroups, setVisibleDupGroups] = useState(DUP_GROUP_BATCH_SIZE);
  const [progress, setProgress] = useState<{ stage: string; current: number; total: number; detail?: string } | null>(null);
  const [visibleRows, setVisibleRows] = useState(200);
  const [editingRow, setEditingRow] = useState<number | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await supabase.from("accounts").select("id,name,mask").order("name")).data ?? [],
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("id,name,parent_category").order("name")).data ?? [],
  });
  const { data: rules = [] } = useQuery({
    queryKey: ["rules"],
    queryFn: async () => (await supabase.from("category_rules").select("id,category_id,match_type,pattern,priority")).data ?? [],
  });
  const { data: aliases = [] } = useQuery({
    queryKey: ["merchant_aliases_combobox"],
    queryFn: async () => (await supabase.from("merchant_aliases").select("id,display_name")).data ?? [],
  });

  async function ensureCategory(name: string | null | undefined, parent?: string | null) {
    if (!name) return null;
    const existing = (categories as any[]).find(c => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id as string;
    const { data, error } = await supabase.from("categories").insert({ name, parent_category: parent ?? null }).select("id").single();
    if (error) return null;
    qc.invalidateQueries({ queryKey: ["categories"] });
    return data.id;
  }

  async function ensureAccount(name: string | null, mask: string | null) {
    if (!name) return null;
    const existing = (accounts as any[]).find(
      a => a.name.toLowerCase() === name.toLowerCase() && (a.mask ?? "") === (mask ?? "")
    );
    if (existing) return existing.id as string;
    const { data, error } = await supabase.from("accounts").insert({ name, mask, type: "credit_card" }).select("id").single();
    if (error) return null;
    qc.invalidateQueries({ queryKey: ["accounts"] });
    return data.id;
  }

  // Detect duplicate groups using shared dedup library.
  // Compares staged rows against each other AND against existing DB transactions.
  async function detectDuplicates(staged: Staged[]) {
    if (staged.length === 0) return [];
    const dates = staged.map(s => s.date).sort();
    const min = dates[0];
    const max = dates[dates.length - 1];

    const { data: existing } = await supabase
      .from("transactions")
      .select("id,date,name,amount,account_id")
      .gte("date", min)
      .lte("date", max);

    // Map staged rows to DedupEntry (using _row as string id)
    const candidates: DedupEntry[] = staged.map(s => ({
      id: String(s._row),
      name: s.name,
      amount: s.amount,
      date: s.date,
      account_id: s._account_id ?? null,
    }));

    const existingEntries: DedupEntry[] = ((existing ?? []) as any[]).map(e => ({
      id: e.id,
      name: e.name,
      amount: Number(e.amount),
      date: e.date,
      account_id: e.account_id ?? null,
    }));

    const sharedGroups = findDuplicateGroups(candidates, existingEntries);

    // Convert shared DupGroup format back to Import's DupGroup format
    return sharedGroups.map((g): DupGroup => ({
      key: g.key,
      members: g.members.map(m => {
        if (m.kind === "candidate") {
          return { kind: "staged" as const, row: Number(m.id) };
        }
        return { kind: "existing" as const, id: m.id, date: m.date, name: m.name, amount: m.amount };
      }),
      keepIndex: g.keepIndex,
      action: g.action,
      crossAccount: g.crossAccount,
    }));
  }

  async function handleFile(file: File) {
    setBusy(true);
    setProgress({ stage: "Reading file", current: 0, total: 1, detail: file.name });
    try {
      setFilename(file.name);
      setProgress({ stage: "Loading merchant aliases", current: 0, total: 1 });
      const merchantAliases = await loadAliases();
      setProgress({ stage: "Parsing file", current: 0, total: 1, detail: file.name });
      const parsed = await parseFile(file, merchantAliases);
      const staged: Staged[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const p = parsed[i];
        const account_id = await ensureAccount(p.account_name ?? null, p.account_mask ?? null);
        let cat_id: string | null = null;
        let by: Staged["_categorized_by"] = "none";
        if (p.category) {
          cat_id = await ensureCategory(p.category, p.parent_category);
          by = "file";
        } else {
          const r = applyRules(p.name, rules as any);
          if (r) { cat_id = r; by = "rule"; }
        }
        staged.push({ ...p, _row: i, _raw_name: p.rawName, _category_id: cat_id, _account_id: account_id, _categorized_by: by });
        if (i % 10 === 0 || i === parsed.length - 1) {
          setProgress({ stage: "Categorizing rows", current: i + 1, total: parsed.length });
          // Yield to keep UI responsive
          await new Promise(r => setTimeout(r, 0));
        }
      }
      setStaging(staged);
      setVisibleRows(200);
      setProgress({ stage: "Detecting duplicates", current: 0, total: 1 });
      const dups = await detectDuplicates(staged);
      setDupGroups(dups);
      setVisibleDupGroups(DUP_GROUP_BATCH_SIZE);
      toast({
        title: `Parsed ${staged.length} rows from ${file.name}`,
        description: dups.length > 0 ? `Found ${dups.length} potential duplicate group${dups.length === 1 ? "" : "s"} to review.` : undefined,
      });
    } catch (e: any) {
      toast({ title: "Parse failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function runAIFallback() {
    const rowsToClassify = staging.filter(s => !s._category_id && !s._drop);
    if (rowsToClassify.length === 0) { toast({ title: "Nothing to classify" }); return; }
    setAiBusy(true);
    setProgress({ stage: "AI categorizing", current: 0, total: rowsToClassify.length });
    try {
      const CHUNK = 50;
      const next = [...staging];
      let done = 0;
      let totalClassified = 0;
      for (let i = 0; i < rowsToClassify.length; i += CHUNK) {
        const chunk = rowsToClassify.slice(i, i + CHUNK);
        const { data, error } = await supabase.functions.invoke("suggest-categories", {
          body: {
            categories: (categories as any[]).map(c => ({ id: c.id, name: c.name, parent_category: c.parent_category })),
            merchants: chunk.map(r => ({ id: String(r._row), name: r.name, amount: r.amount })),
          },
        });
        if (error) {
          // supabase.functions.invoke gives a generic message for non-2xx;
          // the edge function returns a JSON body with a descriptive error.
          const detail = data?.error ?? error.message;
          throw new Error(detail);
        }
        const suggestions: Array<{ id: string; category_id: string | null; confidence: string }> = data?.suggestions ?? [];
        for (const s of suggestions) {
          const idx = next.findIndex(row => String(row._row) === s.id);
          if (idx === -1 || !s.category_id) continue;
          next[idx]._category_id = s.category_id;
          next[idx]._categorized_by = "ai";
          next[idx]._confidence = s.confidence === "high" ? 0.9 : s.confidence === "medium" ? 0.6 : 0.3;
        }
        totalClassified += suggestions.filter(s => s.category_id).length;
        done += chunk.length;
        setProgress({ stage: "AI categorizing", current: done, total: rowsToClassify.length });
        setStaging([...next]);
      }
      toast({ title: `AI classified ${totalClassified} rows` });
    } catch (e: any) {
      toast({ title: "AI categorization failed", description: e.message, variant: "destructive" });
    } finally {
      setAiBusy(false);
      setProgress(null);
    }
  }

  // Compute which staged rows the dup-group decisions force to drop or flag.
  const dupDirectives = useMemo(() => {
    const dropRows = new Set<number>();
    const flagRows = new Map<number, string>();
    for (const g of dupGroups) {
      if (g.action === "merge") {
        // Drop every staged member except the chosen keep
        g.members.forEach((m, i) => {
          if (m.kind === "staged" && i !== g.keepIndex) dropRows.add(m.row);
        });
        // If keep is an existing row, drop ALL staged members
        if (g.members[g.keepIndex]?.kind === "existing") {
          g.members.forEach(m => { if (m.kind === "staged") dropRows.add(m.row); });
        }
      } else if (g.action === "flag") {
        const reason = `Possible duplicate of ${g.members.length - 1} other transaction${g.members.length - 1 === 1 ? "" : "s"}`;
        g.members.forEach(m => { if (m.kind === "staged") flagRows.set(m.row, reason); });
      }
      // keep_both: no-op
    }
    return { dropRows, flagRows };
  }, [dupGroups]);

  async function commit() {
    setBusy(true);
    try {
      const rows = staging.filter(s => !s._drop && !dupDirectives.dropRows.has(s._row));
      const { data: batch, error: bErr } = await supabase.from("import_batches").insert({
        filename, file_type: filename.split(".").pop() ?? null, status: "importing", total_rows: rows.length,
      }).select("id").single();
      if (bErr) throw bErr;

      const payload = rows.map(r => ({
        date: r.date,
        name: r.name,
        amount: r.amount,
        status: r.status,
        category_id: r._category_id,
        account_id: r._account_id,
        excluded: !!r.excluded,
        type: r.type,
        note: r.note,
        recurring: r.recurring,
        source: "import" as const,
        import_batch_id: batch.id,
        raw_row: r.raw as any,
        raw_merchant_name: r._raw_name,
        needs_review: dupDirectives.flagRows.has(r._row),
        review_reason: dupDirectives.flagRows.get(r._row) ?? null,
      }));
      // Also flag matched existing rows when user chose "flag"
      const existingFlagIds: string[] = [];
      for (const g of dupGroups) {
        if (g.action !== "flag") continue;
        for (const m of g.members) {
          if (m.kind === "existing") existingFlagIds.push(m.id);
        }
      }
      if (existingFlagIds.length > 0) {
        await supabase
          .from("transactions")
          .update({ needs_review: true, review_reason: "Possible duplicate flagged during import" } as any)
          .in("id", existingFlagIds);
      }

      const CHUNK = 200;
      let totalCount = 0;
      setProgress({ stage: "Importing transactions", current: 0, total: payload.length });
      for (let i = 0; i < payload.length; i += CHUNK) {
        const slice = payload.slice(i, i + CHUNK);
        const { error: txErr, count } = await supabase.from("transactions").upsert(slice, {
          onConflict: "date,name,amount,account_id,status",
          ignoreDuplicates: true,
          count: "exact",
        } as any);
        if (txErr) throw txErr;
        totalCount += count ?? slice.length;
        setProgress({ stage: "Importing transactions", current: Math.min(i + CHUNK, payload.length), total: payload.length });
      }
      const count = totalCount;
      await supabase.from("import_batches").update({ status: "done", imported_rows: count ?? rows.length }).eq("id", batch.id);

      // Create exact-match alias rules for corrected rows
      const editedRows = rows.filter(r => r._edited && r._raw_name !== r.name);
      for (const r of editedRows) {
        const { data: existing } = await supabase.from("merchant_aliases")
          .select("id").eq("pattern", r._raw_name).eq("match_type", "exact").maybeSingle();
        if (existing) {
          await supabase.from("merchant_aliases").update({ display_name: r.name }).eq("id", existing.id);
        } else {
          await supabase.from("merchant_aliases").insert({
            pattern: r._raw_name, match_type: "exact", display_name: r.name, priority: 1000, source: "user",
          });
        }
      }

      const flaggedTotal = dupDirectives.flagRows.size + existingFlagIds.length;
      toast({
        title: `Imported ${count ?? rows.length} of ${rows.length}`,
        description: flaggedTotal > 0 ? `${flaggedTotal} transaction${flaggedTotal === 1 ? "" : "s"} flagged for review.` : undefined,
      });
      setStaging([]); setFilename(""); setDupGroups([]); setVisibleDupGroups(DUP_GROUP_BATCH_SIZE);
      qc.invalidateQueries();
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const setGroupAction = useCallback((idx: number, action: DupGroup["action"]) => {
    setDupGroups(prev => prev.map((g, i) => i === idx ? { ...g, action } : g));
  }, []);
  const setGroupKeep = useCallback((idx: number, keepIndex: number) => {
    setDupGroups(prev => prev.map((g, i) => i === idx ? { ...g, keepIndex } : g));
  }, []);
  const setAllGroupsAction = useCallback((action: DupGroup["action"]) => {
    setDupGroups(prev => prev.map(g => ({ ...g, action })));
  }, []);

  const stagedById = useMemo(() => new Map(staging.map(s => [s._row, s])), [staging]);
  const dupActionSummary = useMemo<DupActionSummary>(() => {
    return dupGroups.reduce(
      (summary, group) => {
        summary[group.action] += 1;
        return summary;
      },
      { keep_both: 0, merge: 0, flag: 0 } as DupActionSummary,
    );
  }, [dupGroups]);

  return (
    <div className="p-6 xl:p-8 max-w-7xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Import</h1>
        <p className="text-sm text-muted-foreground mt-1">CSV and XLSX supported. PDF support is wired up via the AI parser.</p>
      </header>

      {progress && (
        <Card>
          <CardContent className="py-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 font-medium">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {progress.stage}
                {progress.detail && <span className="text-muted-foreground font-normal">· {progress.detail}</span>}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {progress.total > 1
                  ? `${progress.current.toLocaleString()} / ${progress.total.toLocaleString()} (${Math.round((progress.current / progress.total) * 100)}%)`
                  : "Working…"}
              </div>
            </div>
            <Progress value={progress.total > 0 ? (progress.current / progress.total) * 100 : 0} className="h-2" />
          </CardContent>
        </Card>
      )}

      {staging.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <label className="flex flex-col items-center gap-3 cursor-pointer text-center">
              <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Upload className="h-7 w-7" />
              </div>
              <div>
                <div className="font-medium">Drop or choose a file</div>
                <div className="text-xs text-muted-foreground mt-1">CSV or XLSX exported from your bank or card</div>
              </div>
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              <Button disabled={busy} type="button" onClick={(e) => (e.currentTarget.previousElementSibling as HTMLInputElement)?.click()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
                Choose file
              </Button>
            </label>
          </CardContent>
        </Card>
      ) : (
        <>
          {dupGroups.length > 0 && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      Review {dupGroups.length} potential duplicate group{dupGroups.length === 1 ? "" : "s"}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground max-w-2xl">
                      Same merchant + amount on the same date. These might be legit repeat purchases (e.g., two Subway swipes the same day) — choose <span className="font-medium">Keep all</span> to import every row, or <span className="font-medium">Merge all</span> to collapse them into one. Compared across this import and existing transactions.
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Apply to all groups</span>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => setAllGroupsAction("keep_both")}>
                        <Check className="h-3 w-3" /> Keep all ({dupActionSummary.keep_both})
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => setAllGroupsAction("merge")}>
                        <Copy className="h-3 w-3" /> Merge all ({dupActionSummary.merge})
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => setAllGroupsAction("flag")}>
                        <Flag className="h-3 w-3" /> Flag all ({dupActionSummary.flag})
                      </Button>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {dupGroups.slice(0, visibleDupGroups).map((g, gi) => (
                  <MemoDupGroupRow
                    key={g.key}
                    group={g}
                    index={gi}
                    stagedById={stagedById}
                    onSetAction={setGroupAction}
                    onSetKeep={setGroupKeep}
                  />
                ))}
                {dupGroups.length > visibleDupGroups && (
                  <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-3 text-xs text-muted-foreground">
                    <span>Showing {visibleDupGroups.toLocaleString()} of {dupGroups.length.toLocaleString()} duplicate groups.</span>
                    <Button size="sm" variant="outline" onClick={() => setVisibleDupGroups(v => Math.min(v + DUP_GROUP_BATCH_SIZE, dupGroups.length))}>
                      Show more
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Review {staging.length} rows · {filename}</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {staging.filter(s => s._categorized_by === "file").length} from file ·{" "}
                  {staging.filter(s => s._categorized_by === "rule").length} matched by rule ·{" "}
                  {staging.filter(s => s._categorized_by === "ai").length} by AI ·{" "}
                  {staging.filter(s => !s._category_id).length} uncategorized
                  {dupDirectives.dropRows.size > 0 && (
                    <> · <span className="text-amber-700">{dupDirectives.dropRows.size} will be deduped</span></>
                  )}
                  {dupDirectives.flagRows.size > 0 && (
                    <> · <span className="text-amber-700">{dupDirectives.flagRows.size} flagged</span></>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={runAIFallback} disabled={aiBusy}>
                  {aiBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  AI categorize
                </Button>
                <Button onClick={commit} disabled={busy}>Commit import</Button>
                <Button variant="ghost" onClick={() => { setStaging([]); setFilename(""); setDupGroups([]); setVisibleDupGroups(DUP_GROUP_BATCH_SIZE); }}>Cancel</Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[60vh]">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground border-b sticky top-0 bg-card">
                    <tr>
                      <th className="px-3 py-2 w-24">Date</th>
                      <th className="px-3 py-2">Merchant</th>
                      <th className="px-3 py-2">Source Name</th>
                      <th className="px-3 py-2">Account</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {staging.slice(0, visibleRows).map(s => {
                      const willDrop = s._drop || dupDirectives.dropRows.has(s._row);
                      const willFlag = dupDirectives.flagRows.has(s._row);
                      return (
                        <tr key={s._row} className={willDrop ? "opacity-40" : ""}>
                          <td className="px-3 py-2 text-muted-foreground">{fmtDate(s.date)}</td>
                          <td className="px-3 py-2 font-medium relative">
                            <span
                              className="cursor-pointer hover:underline"
                              onClick={() => setEditingRow(s._row)}
                            >
                              {s.name}
                            </span>
                            {s._edited && (
                              <Badge variant="outline" className="ml-1.5 text-[10px]">edited</Badge>
                            )}
                            <Badge variant="outline" className="ml-2 text-[10px]">{s._categorized_by}</Badge>
                            {willFlag && (
                              <Badge variant="outline" className="ml-1.5 text-[10px] border-amber-500/60 text-amber-700">
                                <Flag className="h-2.5 w-2.5 mr-1" />flagged
                              </Badge>
                            )}
                            {dupDirectives.dropRows.has(s._row) && !s._drop && (
                              <Badge variant="outline" className="ml-1.5 text-[10px]">duplicate</Badge>
                            )}
                            {editingRow === s._row && (
                              <AliasReassignCombobox
                                aliases={aliases}
                                currentAlias={s.name}
                                onSelect={(displayName) => {
                                  const next = [...staging];
                                  const i = next.findIndex(x => x._row === s._row);
                                  next[i] = { ...next[i], name: displayName, _edited: true };
                                  setStaging(next);
                                  setEditingRow(null);
                                }}
                                onCancel={() => setEditingRow(null)}
                              />
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {s._raw_name === s.name ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span
                                className="text-muted-foreground font-mono text-xs truncate block max-w-[60ch]"
                                title={s._raw_name}
                              >
                                {s._raw_name.length > 60 ? s._raw_name.slice(0, 60) + "…" : s._raw_name}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground text-xs">
                            {s.account_name}{s.account_mask ? ` ····${s.account_mask}` : ""}
                          </td>
                          <td className="px-3 py-2">
                            <Select
                              value={s._category_id ?? "none"}
                              onValueChange={(v) => {
                                const next = [...staging];
                                const i = next.findIndex(x => x._row === s._row);
                                next[i]._category_id = v === "none" ? null : v;
                                setStaging(next);
                              }}
                            >
                              <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">— None —</SelectItem>
                                {(categories as any[]).map(c => (
                                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(s.amount)}</td>
                          <td className="px-3 py-2">
                            <Button size="sm" variant="ghost" onClick={() => {
                              const next = [...staging];
                              const i = next.findIndex(x => x._row === s._row);
                              next[i]._drop = !next[i]._drop;
                              setStaging(next);
                            }}>
                              {s._drop ? "Keep" : "Drop"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {staging.length > visibleRows && (
                  <div className="flex items-center justify-between gap-3 px-3 py-3 border-t bg-muted/30 text-xs text-muted-foreground">
                    <span>
                      Showing {visibleRows.toLocaleString()} of {staging.length.toLocaleString()} rows.
                      All rows will be imported when you commit.
                    </span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setVisibleRows(v => v + 500)}>
                        Show 500 more
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setVisibleRows(staging.length)}>
                        Show all
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default Import;
