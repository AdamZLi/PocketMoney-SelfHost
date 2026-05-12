import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Copy, ArrowRightLeft, Loader2 } from "lucide-react";
import { AliasReassignCombobox } from "@/components/AliasReassignCombobox";
import { reassignAndCreateRule } from "@/lib/recleanTransactions";

interface MatchedRawNamesPanelProps {
  alias: { id: string; pattern: string; match_type: string; display_name: string };
}

interface RawNameEntry {
  name: string;
  count: number;
}

const PAGE_SIZE = 20;

const MatchedRawNamesPanel = ({ alias }: MatchedRawNamesPanelProps) => {
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [reassigningName, setReassigningName] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<{ displayName: string; isNew: boolean } | null>(null);
  const [affectedCount, setAffectedCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  const queryClient = useQueryClient();

  const { data: rawNames = [], isLoading } = useQuery({
    queryKey: ["matched_raw_names", alias.display_name],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("raw_merchant_name")
        .eq("name", alias.display_name)
        .not("raw_merchant_name", "is", null);
      if (error) return []; // column may not exist yet before migration

      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        const raw = row.raw_merchant_name as string;
        counts.set(raw, (counts.get(raw) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([name, count]): RawNameEntry => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    },
  });

  const { data: allAliases = [] } = useQuery({
    queryKey: ["merchant_aliases_list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("merchant_aliases")
        .select("id,display_name");
      if (error) return [];
      // Deduplicate by display_name — multiple rules can share the same display name
      const seen = new Set<string>();
      return (data ?? []).filter(a => {
        const key = a.display_name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
    enabled: reassigningName !== null,
  });

  const filtered = useMemo(() => {
    if (!filter) return rawNames;
    const lower = filter.toLowerCase();
    return rawNames.filter(e => e.name.toLowerCase().includes(lower));
  }, [rawNames, filter]);

  const visible = showAll ? filtered : filtered.slice(0, PAGE_SIZE);
  const remaining = filtered.length - visible.length;

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  }

  function cancelReassign() {
    setReassigningName(null);
    setPendingTarget(null);
    setAffectedCount(null);
    setConfirming(false);
  }

  async function handleTargetSelect(rawName: string, displayName: string, isNew: boolean) {
    setPendingTarget({ displayName, isNew });

    // Fetch affected transaction count
    const [{ count: countWithRaw }, { count: countByName }] = await Promise.all([
      supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("raw_merchant_name", rawName),
      supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("name", rawName)
        .is("raw_merchant_name", null),
    ]);

    setAffectedCount((countWithRaw ?? 0) + (countByName ?? 0));
  }

  async function handleConfirm(rawName: string) {
    if (!pendingTarget) return;
    setConfirming(true);
    try {
      const result = await reassignAndCreateRule(rawName, pendingTarget.displayName);
      const total = result.updatedWithRaw + result.updatedByName;
      toast({
        title: `Reassigned '${rawName}' → '${pendingTarget.displayName}'. ${total} transaction${total !== 1 ? "s" : ""} updated.`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["matched_raw_names", alias.display_name] }),
        queryClient.invalidateQueries({ queryKey: ["merchant_aliases"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
      ]);
      cancelReassign();
    } catch (err) {
      toast({ title: "Reassign failed", description: String(err), variant: "destructive" });
      setConfirming(false);
    }
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (rawNames.length === 0) {
    return (
      <p className="text-muted-foreground text-center py-6 text-sm">
        No transactions have matched this alias yet.
      </p>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">
          Matched Source Names{" "}
          <span className="text-muted-foreground font-normal">
            ({rawNames.length} unique name{rawNames.length !== 1 ? "s" : ""})
          </span>
        </h4>
      </div>

      {rawNames.length > 10 && (
        <Input
          placeholder="Filter source names…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="max-w-sm"
        />
      )}

      <div className="space-y-1">
        {visible.map(entry => (
          <div key={entry.name}>
            <div className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted/50">
              <div className="flex items-baseline gap-3 min-w-0">
                <span className="font-mono text-sm truncate">{entry.name}</span>
                <span className="text-muted-foreground text-xs whitespace-nowrap">
                  {entry.count} transaction{entry.count !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {reassigningName === entry.name ? (
                  <AliasReassignCombobox
                    aliases={allAliases}
                    currentAlias={alias.display_name}
                    onSelect={(displayName, isNew) =>
                      handleTargetSelect(entry.name, displayName, isNew)
                    }
                    onCancel={cancelReassign}
                  />
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Reassign to another alias"
                    onClick={() => {
                      cancelReassign();
                      setReassigningName(entry.name);
                    }}
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => copyToClipboard(entry.name)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {reassigningName === entry.name && pendingTarget && (
              <div className="ml-2 mr-2 mt-1 mb-2 p-3 rounded-md bg-muted/60 border text-sm space-y-2">
                <p>
                  This will update{" "}
                  <span className="font-semibold">
                    {affectedCount !== null ? affectedCount : "…"}
                  </span>{" "}
                  transaction{affectedCount !== 1 ? "s" : ""} and create an exact-match rule.
                </p>
                <p className="font-mono text-xs">
                  {entry.name} → {pendingTarget.displayName}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={confirming || affectedCount === null}
                    onClick={() => handleConfirm(entry.name)}
                  >
                    {confirming && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    Confirm
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelReassign} disabled={confirming}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {remaining > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
          Show {remaining} more
        </Button>
      )}
    </div>
  );
};

export default MatchedRawNamesPanel;
