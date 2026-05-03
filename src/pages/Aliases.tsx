import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Trash2, Plus, Loader2, Wand2 } from "lucide-react";
import {
  AliasRow,
  compileAliases,
  cleanMerchant,
  genericNormalize,
} from "@/lib/cleanMerchant";
import { recleanAllTransactions } from "@/lib/recleanTransactions";

type MatchType = "contains" | "exact" | "regex";
type Source = "user" | "seed";

const Aliases = () => {
  const qc = useQueryClient();
  const [pattern, setPattern] = useState("");
  const [matchType, setMatchType] = useState<MatchType>("contains");
  const [displayName, setDisplayName] = useState("");
  const [priority, setPriority] = useState<number>(150);
  const [testInput, setTestInput] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);

  const { data: aliases = [] } = useQuery({
    queryKey: ["merchant_aliases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("merchant_aliases")
        .select("id,pattern,match_type,display_name,priority,source,updated_at")
        .order("priority", { ascending: false });
      if (error) throw error;
      return (data ?? []) as (AliasRow & { updated_at: string })[];
    },
  });

  const compiled = useMemo(() => compileAliases(aliases as AliasRow[]), [aliases]);
  const testResult = useMemo(() => (testInput ? cleanMerchant(testInput, compiled) : ""), [testInput, compiled]);
  const testGeneric = useMemo(() => (testInput ? genericNormalize(testInput) : ""), [testInput]);

  async function addAlias() {
    if (!pattern.trim() || !displayName.trim()) {
      toast({ title: "Pattern and display name are required", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("merchant_aliases").insert({
      pattern: pattern.trim(),
      match_type: matchType,
      display_name: displayName.trim(),
      priority,
      source: "user" as Source,
    });
    if (error) {
      toast({ title: "Failed to add alias", description: error.message, variant: "destructive" });
      return;
    }
    setPattern(""); setDisplayName(""); setPriority(150); setMatchType("contains");
    qc.invalidateQueries({ queryKey: ["merchant_aliases"] });
    toast({ title: "Alias added — refreshing transactions…" });
    await applyToExisting(true);
  }

  async function updateAlias(id: string, patch: Partial<AliasRow>) {
    const { error } = await supabase.from("merchant_aliases").update(patch).eq("id", id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["merchant_aliases"] });
    await applyToExisting(true);
  }

  async function deleteAlias(id: string) {
    const { error } = await supabase.from("merchant_aliases").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["merchant_aliases"] });
    await applyToExisting(true);
  }

  async function applyToExisting(silent = false) {
    setApplyBusy(true);
    try {
      const updated = await recleanAllTransactions();
      if (updated === 0) {
        if (!silent) toast({ title: "Nothing to update", description: "All transaction names already match the current rules." });
      } else {
        qc.invalidateQueries({ queryKey: ["transactions"] });
        toast({ title: `Updated ${updated} transaction names` });
      }
    } catch (e: any) {
      toast({ title: "Apply failed", description: e.message, variant: "destructive" });
    } finally {
      setApplyBusy(false);
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Merchant Aliases</h1>
        <p className="text-muted-foreground mt-1">
          Map raw merchant strings to clean display names. Highest priority match wins; if no alias matches, the generic cleaner is applied.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Test the cleaner</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder='e.g. "TST* MAMA&apos;S PIZZA #4421 SAN FRANCISCO CA"' value={testInput} onChange={e => setTestInput(e.target.value)} />
          {testInput && (
            <div className="flex flex-wrap gap-3 text-sm">
              <Badge variant="secondary">Raw: {testInput}</Badge>
              <Badge>Cleaned: {testResult}</Badge>
              <Badge variant="outline">Generic only: {testGeneric}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Add alias</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <Input className="md:col-span-4" placeholder="Pattern (e.g. WALGREENS)" value={pattern} onChange={e => setPattern(e.target.value)} />
          <Select value={matchType} onValueChange={v => setMatchType(v as MatchType)}>
            <SelectTrigger className="md:col-span-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="contains">contains</SelectItem>
              <SelectItem value="exact">exact</SelectItem>
              <SelectItem value="regex">regex</SelectItem>
            </SelectContent>
          </Select>
          <Input className="md:col-span-3" placeholder="Display name (e.g. Walgreens)" value={displayName} onChange={e => setDisplayName(e.target.value)} />
          <Input className="md:col-span-1" type="number" value={priority} onChange={e => setPriority(Number(e.target.value) || 0)} />
          <Button className="md:col-span-2" onClick={addAlias}><Plus className="h-4 w-4 mr-1" /> Add</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>All aliases ({aliases.length})</CardTitle>
          <Button variant="outline" onClick={() => applyToExisting(false)} disabled={applyBusy}>
            {applyBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
            Apply to existing transactions
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pattern</TableHead>
                <TableHead>Match</TableHead>
                <TableHead>Display name</TableHead>
                <TableHead className="w-24">Priority</TableHead>
                <TableHead className="w-20">Source</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aliases.map(a => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Input defaultValue={a.pattern} onBlur={e => e.target.value !== a.pattern && updateAlias(a.id, { pattern: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Select defaultValue={a.match_type} onValueChange={v => updateAlias(a.id, { match_type: v as MatchType })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="contains">contains</SelectItem>
                        <SelectItem value="exact">exact</SelectItem>
                        <SelectItem value="regex">regex</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input defaultValue={a.display_name} onBlur={e => e.target.value !== a.display_name && updateAlias(a.id, { display_name: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Input type="number" defaultValue={a.priority} onBlur={e => Number(e.target.value) !== a.priority && updateAlias(a.id, { priority: Number(e.target.value) || 0 })} />
                  </TableCell>
                  <TableCell><Badge variant={a.source === "seed" ? "outline" : "secondary"}>{a.source}</Badge></TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => deleteAlias(a.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {aliases.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No aliases yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Aliases;
