import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseFile, ParsedTxn } from "@/lib/parseFile";
import { applyRules } from "@/lib/categorize";
import { loadAliases } from "@/lib/cleanMerchant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { Upload, FileText, Sparkles, Loader2, AlertTriangle, Check, Copy, Flag } from "lucide-react";
import { fmtCurrency, fmtDate } from "@/lib/format";

type Staged = ParsedTxn & {
  _row: number;
  _category_id: string | null;
  _account_id: string | null;
  _categorized_by: "file" | "rule" | "ai" | "none";
  _confidence?: number;
  _drop?: boolean;
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
};

function dateKey(d: string, offset = 0) {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + offset);
  return dt.toISOString().slice(0, 10);
}

const Import = () => {
  const qc = useQueryClient();
  const [staging, setStaging] = useState<Staged[]>([]);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [dupGroups, setDupGroups] = useState<DupGroup[]>([]);
  const [progress, setProgress] = useState<{ stage: string; current: number; total: number; detail?: string } | null>(null);

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

  // Detect duplicate groups: same merchant (lowercased) + same amount + EXACT same date.
  // Compares staged rows against each other AND against existing DB transactions on the same account.
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

    // Bucket by (account_id, merchant lowered, amount, date) — exact date only.
    const groups = new Map<string, DupSource[]>();
    const bucketKey = (acct: string | null, name: string, amount: number, date: string) =>
      `${acct ?? ""}|${name.trim().toLowerCase()}|${Number(amount).toFixed(2)}|${date}`;

    for (const s of staged) {
      const k = bucketKey(s._account_id ?? null, s.name, s.amount, s.date);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push({ kind: "staged", row: s._row });
    }
    for (const e of (existing ?? []) as any[]) {
      const k = bucketKey(e.account_id ?? null, e.name, e.amount, e.date);
      if (groups.has(k)) {
        groups.get(k)!.push({ kind: "existing", id: e.id, date: e.date, name: e.name, amount: e.amount });
      }
    }

    const result: DupGroup[] = [];
    for (const [k, members] of groups) {
      const stagedCount = members.filter(m => m.kind === "staged").length;
      if (members.length >= 2 && stagedCount >= 1) {
        const keepIndex = members.findIndex(m => m.kind === "staged");
        result.push({ key: k, members, keepIndex: keepIndex >= 0 ? keepIndex : 0, action: "merge" });
      }
    }
    return result;
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
        staged.push({ ...p, _row: i, _category_id: cat_id, _account_id: account_id, _categorized_by: by });
        if (i % 10 === 0 || i === parsed.length - 1) {
          setProgress({ stage: "Categorizing rows", current: i + 1, total: parsed.length });
          // Yield to keep UI responsive
          await new Promise(r => setTimeout(r, 0));
        }
      }
      setStaging(staged);
      setProgress({ stage: "Detecting duplicates", current: 0, total: 1 });
      const dups = await detectDuplicates(staged);
      setDupGroups(dups);
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
      const categoryNames = (categories as any[]).map(c => c.name);
      const CHUNK = 50;
      const next = [...staging];
      let done = 0;
      let totalClassified = 0;
      for (let i = 0; i < rowsToClassify.length; i += CHUNK) {
        const chunk = rowsToClassify.slice(i, i + CHUNK);
        const { data, error } = await supabase.functions.invoke("categorize-transactions", {
          body: {
            categories: categoryNames,
            transactions: chunk.map(r => ({ row: r._row, name: r.name, amount: r.amount })),
          },
        });
        if (error) throw error;
        const results: Array<{ row: number; category: string; confidence: number }> = data?.results ?? [];
        for (const res of results) {
          const idx = next.findIndex(s => s._row === res.row);
          if (idx === -1) continue;
          const cat = (categories as any[]).find(c => c.name.toLowerCase() === res.category?.toLowerCase());
          if (cat) {
            next[idx]._category_id = cat.id;
            next[idx]._categorized_by = "ai";
            next[idx]._confidence = res.confidence;
          }
        }
        totalClassified += results.length;
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
      const flaggedTotal = dupDirectives.flagRows.size + existingFlagIds.length;
      toast({
        title: `Imported ${count ?? rows.length} of ${rows.length}`,
        description: flaggedTotal > 0 ? `${flaggedTotal} transaction${flaggedTotal === 1 ? "" : "s"} flagged for review.` : undefined,
      });
      setStaging([]); setFilename(""); setDupGroups([]);
      qc.invalidateQueries();
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function setGroupAction(idx: number, action: DupGroup["action"]) {
    setDupGroups(prev => prev.map((g, i) => i === idx ? { ...g, action } : g));
  }
  function setGroupKeep(idx: number, keepIndex: number) {
    setDupGroups(prev => prev.map((g, i) => i === idx ? { ...g, keepIndex } : g));
  }

  const stagedById = useMemo(() => new Map(staging.map(s => [s._row, s])), [staging]);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
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
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Review {dupGroups.length} potential duplicate group{dupGroups.length === 1 ? "" : "s"}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Same merchant + amount within ±{FUZZY_DAYS} day. Compared across this import and existing transactions.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {dupGroups.map((g, gi) => (
                  <div key={g.key} className="rounded-md border bg-background p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 justify-between">
                      <div className="text-xs text-muted-foreground">
                        {g.members.length} matching transactions
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant={g.action === "merge" ? "default" : "outline"}
                          className="h-7 gap-1.5"
                          onClick={() => setGroupAction(gi, "merge")}
                        >
                          <Copy className="h-3 w-3" /> Merge
                        </Button>
                        <Button
                          size="sm"
                          variant={g.action === "keep_both" ? "default" : "outline"}
                          className="h-7 gap-1.5"
                          onClick={() => setGroupAction(gi, "keep_both")}
                        >
                          <Check className="h-3 w-3" /> Keep both
                        </Button>
                        <Button
                          size="sm"
                          variant={g.action === "flag" ? "default" : "outline"}
                          className="h-7 gap-1.5"
                          onClick={() => setGroupAction(gi, "flag")}
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
                                onClick={() => setGroupKeep(gi, mi)}
                              >
                                {isKept ? "Keep" : "Use this"}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
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
                <Button variant="ghost" onClick={() => { setStaging([]); setFilename(""); setDupGroups([]); }}>Cancel</Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[60vh]">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground border-b sticky top-0 bg-card">
                    <tr>
                      <th className="px-3 py-2 w-24">Date</th>
                      <th className="px-3 py-2">Merchant</th>
                      <th className="px-3 py-2">Account</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {staging.map(s => {
                      const willDrop = s._drop || dupDirectives.dropRows.has(s._row);
                      const willFlag = dupDirectives.flagRows.has(s._row);
                      return (
                        <tr key={s._row} className={willDrop ? "opacity-40" : ""}>
                          <td className="px-3 py-2 text-muted-foreground">{fmtDate(s.date)}</td>
                          <td className="px-3 py-2 font-medium">
                            {s.name}
                            <Badge variant="outline" className="ml-2 text-[10px]">{s._categorized_by}</Badge>
                            {willFlag && (
                              <Badge variant="outline" className="ml-1.5 text-[10px] border-amber-500/60 text-amber-700">
                                <Flag className="h-2.5 w-2.5 mr-1" />flagged
                              </Badge>
                            )}
                            {dupDirectives.dropRows.has(s._row) && !s._drop && (
                              <Badge variant="outline" className="ml-1.5 text-[10px]">duplicate</Badge>
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
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default Import;
