import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Trash2 } from "lucide-react";

const types = ["credit_card","debit_card","checking","savings","cash","other"] as const;

const Accounts = () => {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [mask, setMask] = useState("");
  const [type, setType] = useState<typeof types[number]>("credit_card");
  const [institution, setInstitution] = useState("");

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", "full"],
    queryFn: async () => (await supabase.from("accounts").select("*").order("name")).data ?? [],
  });

  async function add() {
    if (!name.trim()) return;
    const { error } = await supabase.from("accounts").insert({
      name: name.trim(), mask: mask.trim() || null, type, institution: institution.trim() || null,
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    setName(""); setMask(""); setInstitution("");
    qc.invalidateQueries({ queryKey: ["accounts"] });
    toast({ title: "Account added" });
  }

  async function softDelete(id: string) {
    await supabase.from("accounts").update({ is_active: false }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["accounts"] });
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Accounts</h1>
        <p className="text-sm text-muted-foreground mt-1">Bank accounts and credit cards. Plaid sync arrives in Phase 1.5.</p>
      </header>

      <Card>
        <CardHeader><CardTitle className="text-base">Add account</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <Input placeholder="Name (e.g. Amex Gold)" value={name} onChange={e => setName(e.target.value)} className="md:col-span-2" />
            <Input placeholder="Last 4" value={mask} onChange={e => setMask(e.target.value)} maxLength={4} />
            <Select value={type} onValueChange={(v: any) => setType(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {types.map(t => <SelectItem key={t} value={t}>{t.replace("_"," ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Institution (optional)" value={institution} onChange={e => setInstitution(e.target.value)} />
          </div>
          <Button onClick={add} className="mt-3">Add</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground border-b">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Mask</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Institution</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(accounts as any[]).map(a => (
                <tr key={a.id}>
                  <td className="px-4 py-2.5 font-medium">{a.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{a.mask ? `····${a.mask}` : "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{a.type.replace("_"," ")}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{a.institution ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{a.is_active ? "Active" : "Archived"}</td>
                  <td className="px-4 py-2.5 text-right">
                    {a.is_active && (
                      <Button size="sm" variant="ghost" onClick={() => softDelete(a.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No accounts yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Accounts;
