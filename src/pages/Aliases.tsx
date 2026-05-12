import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Trash2, Plus, Loader2, Wand2, ChevronRight, ArrowRight, Search } from "lucide-react";
import MatchedRawNamesPanel from "@/components/MatchedRawNamesPanel";
import {
  AliasRow,
} from "@/lib/cleanMerchant";
import { recleanAllTransactions } from "@/lib/recleanTransactions";

type MatchType = "contains" | "exact" | "regex";
type Source = "user" | "seed";

const Aliases = () => {
  const qc = useQueryClient();
  const [pattern, setPattern] = useState("");
  const [matchType, setMatchType] = useState<MatchType>("contains");
  const [displayName, setDisplayName] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

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

  const filteredAliases = useMemo(() => {
    if (!search.trim()) return aliases;
    const lower = search.toLowerCase();
    return aliases.filter(a =>
      a.pattern.toLowerCase().includes(lower) ||
      a.display_name.toLowerCase().includes(lower)
    );
  }, [aliases, search]);

  async function addAlias() {
    if (!pattern.trim() || !displayName.trim()) {
      toast({ title: "Pattern and display name are required", variant: "destructive" });
      return;
    }
    const { data: existing } = await supabase
      .from("merchant_aliases")
      .select("id,display_name")
      .eq("pattern", pattern.trim())
      .eq("match_type", matchType)
      .maybeSingle();

    if (existing) {
      toast({
        title: "Rule already exists",
        description: `A ${matchType} rule for "${pattern.trim()}" already exists, displaying as "${existing.display_name}". Edit the existing rule instead.`,
        variant: "destructive",
      });
      return;
    }

    const priority = matchType === "exact" ? 1000 : 100;
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
    setPattern(""); setDisplayName(""); setMatchType("contains");
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
    <div className="p-6 xl:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Merchant Aliases</h1>
        <p className="text-muted-foreground mt-1">
          Rules that map raw bank names to clean display names. Click a rule to see which source names matched.
        </p>
      </div>

      {/* Add alias — reads as a sentence */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground whitespace-nowrap">If source name</span>
            <Select value={matchType} onValueChange={v => setMatchType(v as MatchType)}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="contains">contains</SelectItem>
                <SelectItem value="exact">is exactly</SelectItem>
              </SelectContent>
            </Select>
            <Input
              className="flex-1 min-w-[180px]"
              placeholder={matchType === "exact" ? "Paste full source name…" : "e.g. WALGREENS"}
              value={pattern}
              onChange={e => setPattern(e.target.value)}
            />
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground whitespace-nowrap">display as</span>
            <Input
              className="flex-1 min-w-[150px]"
              placeholder="e.g. Walgreens"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
            />
            <Button onClick={addAlias} className="shrink-0"><Plus className="h-4 w-4 mr-1" /> Add</Button>
          </div>
        </CardContent>
      </Card>

      {/* Alias list */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>All rules ({aliases.length})</CardTitle>
          <Button variant="outline" onClick={() => applyToExisting(false)} disabled={applyBusy}>
            {applyBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
            Apply to existing transactions
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search rules…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="max-w-sm"
            />
            {search && (
              <span className="text-sm text-muted-foreground">{filteredAliases.length} of {aliases.length}</span>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>When source name…</TableHead>
                <TableHead>Display as</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAliases.map(a => {
                const isExpanded = expandedId === a.id;
                const matchLabel = a.match_type === "exact" ? "is exactly" : "contains";
                return (
                  <Fragment key={a.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest("input, button, [role='combobox'], [role='listbox']")) return;
                        setExpandedId(isExpanded ? null : a.id);
                      }}
                    >
                      <TableCell className="w-8 pr-0">
                        <ChevronRight className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm text-muted-foreground whitespace-nowrap">{matchLabel}</span>
                          <Input
                            defaultValue={a.pattern}
                            className="font-mono text-sm"
                            onClick={e => e.stopPropagation()}
                            onBlur={e => e.target.value !== a.pattern && updateAlias(a.id, { pattern: e.target.value })}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          defaultValue={a.display_name}
                          className="max-w-[250px]"
                          onClick={e => e.stopPropagation()}
                          onBlur={e => e.target.value !== a.display_name && updateAlias(a.id, { display_name: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); deleteAlias(a.id); }}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={4} className="p-0 bg-muted/30">
                          <MatchedRawNamesPanel alias={a} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
              {filteredAliases.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">{search ? "No rules match your search." : "No rules yet. Add one above."}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Aliases;
