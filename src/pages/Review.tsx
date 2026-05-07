import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { TreatmentMeta } from "@/lib/treatments";
import { Check, ExternalLink, Trash2, Undo2, User } from "lucide-react";
import { TransactionEditSheet } from "@/components/TransactionEditSheet";
import { toast } from "sonner";

type Txn = {
  id: string;
  date: string;
  name: string;
  amount: number;
  treatment: string;
  treatment_meta: TreatmentMeta;
};

const Review = () => {
  const qc = useQueryClient();
  const [tab, setTab] = useState("owed");
  const [personFilter, setPersonFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Pending splits (people owe me) — includes both whole-txn reimbursables AND
  // sub-parts of "split" transactions whose part is reimbursable + pending.
  const { data: splits = [] } = useQuery({
    queryKey: ["review", "reimbursable_pending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id,date,name,amount,treatment,treatment_meta")
        .in("treatment", ["reimbursable", "split"])
        .order("date", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const out: (Txn & { partIndex?: number; partLabel?: string; partAmount?: number })[] = [];
      for (const row of (data ?? []) as Txn[]) {
        if (row.treatment === "reimbursable") {
          if ((row.treatment_meta?.reimbursement_status ?? "pending") === "pending") {
            out.push(row);
          }
        } else if (row.treatment === "split") {
          const parts = row.treatment_meta?.parts ?? [];
          parts.forEach((p, i) => {
            if (p.treatment !== "reimbursable") return;
            if ((p.meta?.reimbursement_status ?? "pending") !== "pending") return;
            out.push({
              ...row,
              treatment_meta: { ...(p.meta ?? {}) },
              partIndex: i,
              partLabel: p.label,
              partAmount: p.amount,
              amount: p.amount,
            });
          });
        }
      }
      return out;
    },
  });

  // Pending refundables (whole-txn + split parts)
  const { data: refunds = [] } = useQuery({
    queryKey: ["review", "refundable_pending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id,date,name,amount,treatment,treatment_meta")
        .in("treatment", ["refundable", "split"])
        .order("date", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const out: (Txn & { partIndex?: number; partLabel?: string })[] = [];
      for (const row of (data ?? []) as Txn[]) {
        if (row.treatment === "refundable") {
          if ((row.treatment_meta?.refund_status ?? "pending") === "pending") out.push(row);
        } else if (row.treatment === "split") {
          const parts = row.treatment_meta?.parts ?? [];
          parts.forEach((p, i) => {
            if (p.treatment !== "refundable") return;
            if ((p.meta?.refund_status ?? "pending") !== "pending") return;
            out.push({
              ...row,
              treatment_meta: { ...(p.meta ?? {}) },
              amount: p.amount,
              partIndex: i,
              partLabel: p.label,
            });
          });
        }
      }
      return out;
    },
  });

  // Settled splits (reimbursement_status = 'settled') — both whole-txn and split parts.
  const { data: settled = [] } = useQuery({
    queryKey: ["review", "reimbursable_settled"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id,date,name,amount,treatment,treatment_meta")
        .in("treatment", ["reimbursable", "split"])
        .order("date", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const out: (Txn & { partIndex?: number; partLabel?: string; partAmount?: number })[] = [];
      for (const row of (data ?? []) as Txn[]) {
        if (row.treatment === "reimbursable") {
          if ((row.treatment_meta?.reimbursement_status) === "settled") out.push(row);
        } else if (row.treatment === "split") {
          const parts = row.treatment_meta?.parts ?? [];
          parts.forEach((p, i) => {
            if (p.treatment !== "reimbursable") return;
            if ((p.meta?.reimbursement_status) !== "settled") return;
            out.push({
              ...row,
              treatment_meta: { ...(p.meta ?? {}) },
              partIndex: i,
              partLabel: p.label,
              partAmount: p.amount,
              amount: p.amount,
            });
          });
        }
      }
      return out;
    },
  });

  const { data: people = [] } = useQuery({
    queryKey: ["people"],
    queryFn: async () => {
      const { data, error } = await supabase.from("people").select("id,name,note").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Group splits by person
  const grouped = useMemo(() => {
    const map = new Map<string, { person: string; txns: typeof splits; total: number }>();
    splits.forEach((t) => {
      const person = (t.treatment_meta?.owed_by || "Unassigned").trim() || "Unassigned";
      const share =
        typeof t.treatment_meta?.your_share === "number"
          ? t.treatment_meta.your_share
          : Math.abs(Number(t.amount));
      const owed = Math.abs(Number(t.amount)) - share;
      const cur = map.get(person) ?? { person, txns: [], total: 0 };
      cur.txns.push(t);
      cur.total += owed;
      map.set(person, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [splits]);

  const personNames = useMemo(() => {
    const set = new Set<string>(grouped.map((g) => g.person));
    people.forEach((p) => set.add(p.name));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [grouped, people]);

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return grouped.filter((g) => {
      if (personFilter !== "all" && g.person !== personFilter) return false;
      if (q && !g.person.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [grouped, personFilter, search]);

  const totalOwed = visibleGroups.reduce((s, g) => s + g.total, 0);

  // For split-part rows, we need to fetch the parent txn meta and update only the part.
  async function applyStatus(
    t: Txn & { partIndex?: number },
    field: "reimbursement_status" | "refund_status",
    value: "settled" | "received" | "pending",
  ) {
    if (typeof t.partIndex === "number") {
      const { data: parent } = await supabase
        .from("transactions")
        .select("treatment_meta")
        .eq("id", t.id)
        .single();
      const parentMeta: TreatmentMeta = (parent?.treatment_meta ?? {}) as TreatmentMeta;
      const parts = [...(parentMeta.parts ?? [])];
      const p = parts[t.partIndex];
      if (!p) return { error: { message: "Part not found" } };
      parts[t.partIndex] = { ...p, meta: { ...(p.meta ?? {}), [field]: value } };
      return supabase
        .from("transactions")
        .update({ treatment_meta: { ...parentMeta, parts } })
        .eq("id", t.id);
    }
    const meta = { ...(t.treatment_meta ?? {}), [field]: value };
    return supabase.from("transactions").update({ treatment_meta: meta }).eq("id", t.id);
  }

  async function markSettled(t: Txn & { partIndex?: number }) {
    const { error } = await applyStatus(t, "reimbursement_status", "settled");
    if (error) toast.error(error.message);
    else {
      toast.success("Marked settled");
      qc.invalidateQueries({ queryKey: ["review"] });
    }
  }

  async function unmarkSettled(t: Txn & { partIndex?: number }) {
    const { error } = await applyStatus(t, "reimbursement_status", "pending");
    if (error) toast.error(error.message);
    else {
      toast.success("Moved back to pending");
      qc.invalidateQueries({ queryKey: ["review"] });
    }
  }

  async function markGroupSettled(group: { person: string; txns: (Txn & { partIndex?: number })[] }) {
    for (const t of group.txns) {
      await applyStatus(t, "reimbursement_status", "settled");
    }
    toast.success(`Marked ${group.txns.length} settled with ${group.person}`);
    qc.invalidateQueries({ queryKey: ["review"] });
  }

  async function markRefundReceived(t: Txn & { partIndex?: number }) {
    const { error } = await applyStatus(t, "refund_status", "received");
    if (error) toast.error(error.message);
    else {
      toast.success("Marked refunded");
      qc.invalidateQueries({ queryKey: ["review"] });
    }
  }

  // People management
  const [newPerson, setNewPerson] = useState("");
  async function addPerson() {
    const name = newPerson.trim();
    if (!name) return;
    const { error } = await supabase.from("people").insert({ name });
    if (error) toast.error(error.message);
    else {
      setNewPerson("");
      qc.invalidateQueries({ queryKey: ["people"] });
    }
  }
  async function removePerson(id: string) {
    const { error } = await supabase.from("people").delete().eq("id", id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["people"] });
  }

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold">Review</h1>
        <p className="text-sm text-muted-foreground">
          Follow up on pending splits and refundables.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="owed">
            Owed to me
            {grouped.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {fmtCurrency(grouped.reduce((s, g) => s + g.total, 0))}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="refunds">
            Refunds pending
            {refunds.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {refunds.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="settled">
            Settled
            {settled.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {settled.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
        </TabsList>

        <TabsContent value="owed" className="space-y-4">
          <Card className="p-4 flex flex-wrap items-center gap-3">
            <Select value={personFilter} onValueChange={setPersonFilter}>
              <SelectTrigger className="h-9 w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All people</SelectItem>
                {personNames.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name…"
              className="h-9 w-[200px]"
            />
            <div className="ml-auto text-sm text-muted-foreground">
              Total owed: <span className="font-medium text-foreground">{fmtCurrency(totalOwed)}</span>
            </div>
          </Card>

          {visibleGroups.length === 0 && (
            <Card className="p-10 text-center text-sm text-muted-foreground">
              Nothing pending. Mark a transaction as Split / reimbursable to see it here.
            </Card>
          )}

          {visibleGroups.map((g) => (
            <Card key={g.person} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-medium">{g.person}</h3>
                  <Badge variant="outline">{g.txns.length} item{g.txns.length === 1 ? "" : "s"}</Badge>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm">
                    Owes <span className="font-semibold">{fmtCurrency(g.total)}</span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => markGroupSettled(g)}>
                    <Check className="h-3.5 w-3.5 mr-1" /> Settle all
                  </Button>
                </div>
              </div>
              <div className="divide-y border-t">
                {g.txns.map((t) => {
                  const total = Math.abs(Number(t.amount));
                  const share =
                    typeof t.treatment_meta?.your_share === "number"
                      ? t.treatment_meta.your_share
                      : total;
                  const owed = total - share;
                  return (
                    <div key={`${t.id}-${(t as any).partIndex ?? "x"}`} className="flex items-center gap-3 py-2 text-sm">
                      <span className="text-muted-foreground w-20 shrink-0">{fmtDate(t.date)}</span>
                      <span className="flex-1 truncate">
                        <Link
                          to={`/transactions?edit=${t.id}`}
                          className="hover:underline hover:text-primary inline-flex items-center gap-1"
                          title="Open transaction"
                        >
                          {t.name}
                          <ExternalLink className="h-3 w-3 opacity-50" />
                        </Link>
                        {(t as any).partLabel && (
                          <span className="text-muted-foreground text-xs ml-1">· {(t as any).partLabel}</span>
                        )}
                        {typeof (t as any).partIndex === "number" && !(t as any).partLabel && (
                          <span className="text-muted-foreground text-xs ml-1">· part {(t as any).partIndex + 1}</span>
                        )}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        Your {fmtCurrency(share)} of {fmtCurrency(total)}
                      </span>
                      <span className="font-medium w-20 text-right">{fmtCurrency(owed)}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        onClick={() => markSettled(t)}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="refunds" className="space-y-4">
          {refunds.length === 0 ? (
            <Card className="p-10 text-center text-sm text-muted-foreground">
              No refundable transactions are pending.
            </Card>
          ) : (
            <Card className="p-4">
              <div className="divide-y">
                {refunds.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="text-muted-foreground w-24 shrink-0">{fmtDate(t.date)}</span>
                    <span className="flex-1 truncate">
                      <Link to={`/transactions?edit=${t.id}`} className="hover:underline hover:text-primary inline-flex items-center gap-1" title="Open transaction">
                        {t.name}
                        <ExternalLink className="h-3 w-3 opacity-50" />
                      </Link>
                    </span>
                    {t.treatment_meta?.expected_refund_date && (
                      <span className="text-xs text-muted-foreground">
                        expected {fmtDate(t.treatment_meta.expected_refund_date)}
                      </span>
                    )}
                    <span className="font-medium w-24 text-right">
                      {fmtCurrency(Math.abs(Number(t.amount)))}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => markRefundReceived(t)}>
                      <Check className="h-3.5 w-3.5 mr-1" /> Refunded
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="settled" className="space-y-4">
          {settled.length === 0 ? (
            <Card className="p-10 text-center text-sm text-muted-foreground">
              No settled items yet. Items you mark as settled will appear here.
            </Card>
          ) : (
            <Card className="p-4">
              <div className="divide-y">
                {settled.map((t) => {
                  const total = Math.abs(Number(t.amount));
                  const share =
                    typeof t.treatment_meta?.your_share === "number"
                      ? t.treatment_meta.your_share
                      : total;
                  const owed = total - share;
                  const person = (t.treatment_meta?.owed_by || "Unassigned").trim() || "Unassigned";
                  return (
                    <div key={`${t.id}-${(t as any).partIndex ?? "x"}`} className="flex items-center gap-3 py-2 text-sm">
                      <span className="text-muted-foreground w-20 shrink-0">{fmtDate(t.date)}</span>
                      <span className="flex-1 truncate">
                        <Link to={`/transactions?edit=${t.id}`} className="hover:underline hover:text-primary inline-flex items-center gap-1" title="Open transaction">
                          {t.name}
                          <ExternalLink className="h-3 w-3 opacity-50" />
                        </Link>
                        {(t as any).partLabel && (
                          <span className="text-muted-foreground text-xs ml-1">· {(t as any).partLabel}</span>
                        )}
                      </span>
                      <span className="text-muted-foreground text-xs w-24 truncate">{person}</span>
                      <span className="text-muted-foreground text-xs">
                        Your {fmtCurrency(share)} of {fmtCurrency(total)}
                      </span>
                      <span className="font-medium w-20 text-right">{fmtCurrency(owed)}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        title="Move back to pending"
                        onClick={() => unmarkSettled(t)}
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="people" className="space-y-4">
          <Card className="p-4">
            <h3 className="font-medium mb-3">Saved people</h3>
            <div className="flex gap-2 mb-4">
              <Input
                value={newPerson}
                onChange={(e) => setNewPerson(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addPerson()}
                placeholder="Add a name…"
                className="h-9 max-w-xs"
              />
              <Button size="sm" onClick={addPerson}>
                Add
              </Button>
            </div>
            {people.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No saved people yet. Names you use on splits also appear in the autocomplete.
              </p>
            ) : (
              <div className="divide-y">
                {people.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 py-2 text-sm">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1">{p.name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-muted-foreground hover:text-destructive"
                      onClick={() => removePerson(p.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Review;
