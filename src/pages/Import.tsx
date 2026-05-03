import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseFile, ParsedTxn } from "@/lib/parseFile";
import { applyRules } from "@/lib/categorize";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Upload, FileText, Sparkles, Loader2 } from "lucide-react";
import { fmtCurrency, fmtDate } from "@/lib/format";

type Staged = ParsedTxn & {
  _row: number;
  _category_id: string | null;
  _account_id: string | null;
  _categorized_by: "file" | "rule" | "ai" | "none";
  _confidence?: number;
  _drop?: boolean;
};

const Import = () => {
  const qc = useQueryClient();
  const [staging, setStaging] = useState<Staged[]>([]);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

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

  async function handleFile(file: File) {
    setBusy(true);
    try {
      setFilename(file.name);
      const parsed = await parseFile(file);
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
      }
      setStaging(staged);
      toast({ title: `Parsed ${staged.length} rows from ${file.name}` });
    } catch (e: any) {
      toast({ title: "Parse failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function runAIFallback() {
    const rowsToClassify = staging.filter(s => !s._category_id && !s._drop);
    if (rowsToClassify.length === 0) { toast({ title: "Nothing to classify" }); return; }
    setAiBusy(true);
    try {
      const categoryNames = (categories as any[]).map(c => c.name);
      const { data, error } = await supabase.functions.invoke("categorize-transactions", {
        body: {
          categories: categoryNames,
          transactions: rowsToClassify.map(r => ({ row: r._row, name: r.name, amount: r.amount })),
        },
      });
      if (error) throw error;
      const results: Array<{ row: number; category: string; confidence: number }> = data?.results ?? [];
      const next = [...staging];
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
      setStaging(next);
      toast({ title: `AI classified ${results.length} rows` });
    } catch (e: any) {
      toast({ title: "AI categorization failed", description: e.message, variant: "destructive" });
    } finally {
      setAiBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    try {
      const rows = staging.filter(s => !s._drop);
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
      }));
      // Insert ignoring conflicts on dedupe key (rows with same date+name+amount+account+status are skipped)
      const { error: txErr, count } = await supabase.from("transactions").upsert(payload, {
        onConflict: "date,name,amount,account_id,status",
        ignoreDuplicates: true,
        count: "exact",
      } as any);
      if (txErr) throw txErr;
      await supabase.from("import_batches").update({ status: "done", imported_rows: count ?? rows.length }).eq("id", batch.id);
      toast({ title: `Imported ${count ?? rows.length} of ${rows.length} (duplicates skipped)` });
      setStaging([]); setFilename("");
      qc.invalidateQueries();
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Import</h1>
        <p className="text-sm text-muted-foreground mt-1">CSV and XLSX supported. PDF support is wired up via the AI parser.</p>
      </header>

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
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Review {staging.length} rows · {filename}</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {staging.filter(s => s._categorized_by === "file").length} from file ·{" "}
                  {staging.filter(s => s._categorized_by === "rule").length} matched by rule ·{" "}
                  {staging.filter(s => s._categorized_by === "ai").length} by AI ·{" "}
                  {staging.filter(s => !s._category_id).length} uncategorized
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={runAIFallback} disabled={aiBusy}>
                  {aiBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  AI categorize
                </Button>
                <Button onClick={commit} disabled={busy}>Commit import</Button>
                <Button variant="ghost" onClick={() => { setStaging([]); setFilename(""); }}>Cancel</Button>
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
                    {staging.map(s => (
                      <tr key={s._row} className={s._drop ? "opacity-40" : ""}>
                        <td className="px-3 py-2 text-muted-foreground">{fmtDate(s.date)}</td>
                        <td className="px-3 py-2 font-medium">
                          {s.name}
                          <Badge variant="outline" className="ml-2 text-[10px]">{s._categorized_by}</Badge>
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
                    ))}
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
