import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Pencil, Trash2, Check, X } from "lucide-react";

const Categories = () => {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editParent, setEditParent] = useState("");

  const [ruleCat, setRuleCat] = useState<string>("");
  const [pattern, setPattern] = useState("");
  const [matchType, setMatchType] = useState<"contains"|"equals"|"regex">("contains");

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editRulePattern, setEditRulePattern] = useState("");
  const [editRuleMatch, setEditRuleMatch] = useState<"contains"|"equals"|"regex">("contains");
  const [editRuleCat, setEditRuleCat] = useState<string>("");

  const { data: categories = [] } = useQuery({
    queryKey: ["categories", "full"],
    queryFn: async () => (await supabase.from("categories").select("*").order("name")).data ?? [],
  });
  const { data: rules = [] } = useQuery({
    queryKey: ["rules"],
    queryFn: async () => (await supabase.from("category_rules").select("*,categories(name)").order("priority")).data ?? [],
  });

  async function addCategory() {
    if (!name.trim()) return;
    const { error } = await supabase.from("categories").insert({
      name: name.trim(), parent_category: parent.trim() || null,
    });
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    setName(""); setParent("");
    qc.invalidateQueries({ queryKey: ["categories"] });
  }
  async function delCategory(id: string) {
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["categories"] });
  }
  function startEdit(c: any) {
    setEditingId(c.id);
    setEditName(c.name ?? "");
    setEditParent(c.parent_category ?? "");
  }
  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditParent("");
  }
  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    const { error } = await supabase
      .from("categories")
      .update({ name: editName.trim(), parent_category: editParent.trim() || null })
      .eq("id", id);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    cancelEdit();
    qc.invalidateQueries({ queryKey: ["categories"] });
  }
  async function addRule() {
    if (!ruleCat || !pattern.trim()) return;
    const { error } = await supabase.from("category_rules").insert({
      category_id: ruleCat, pattern: pattern.trim(), match_type: matchType, priority: 10, source: "user",
    });
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    setPattern("");
    qc.invalidateQueries({ queryKey: ["rules"] });
  }
  async function delRule(id: string) {
    await supabase.from("category_rules").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["rules"] });
  }
  function startEditRule(r: any) {
    setEditingRuleId(r.id);
    setEditRulePattern(r.pattern ?? "");
    setEditRuleMatch(r.match_type ?? "contains");
    setEditRuleCat(r.category_id ?? "");
  }
  function cancelEditRule() {
    setEditingRuleId(null);
    setEditRulePattern("");
    setEditRuleMatch("contains");
    setEditRuleCat("");
  }
  async function saveEditRule(id: string) {
    if (!editRulePattern.trim() || !editRuleCat) return;
    const { error } = await supabase
      .from("category_rules")
      .update({
        pattern: editRulePattern.trim(),
        match_type: editRuleMatch,
        category_id: editRuleCat,
      })
      .eq("id", id);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    cancelEditRule();
    qc.invalidateQueries({ queryKey: ["rules"] });
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Categories & Rules</h1>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Categories</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
              <Input placeholder="Parent (optional)" value={parent} onChange={e => setParent(e.target.value)} />
              <Button onClick={addCategory}>Add</Button>
            </div>
            <div className="divide-y border rounded-md">
              {(categories as any[]).map(c => (
                <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm gap-2">
                  {editingId === c.id ? (
                    <>
                      <div className="flex gap-2 flex-1">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Name"
                          className="h-8"
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(c.id); if (e.key === "Escape") cancelEdit(); }}
                          autoFocus
                        />
                        <Input
                          value={editParent}
                          onChange={(e) => setEditParent(e.target.value)}
                          placeholder="Parent (optional)"
                          className="h-8"
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(c.id); if (e.key === "Escape") cancelEdit(); }}
                        />
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => saveEdit(c.id)} title="Save">
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit} title="Cancel">
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <span className="font-medium">{c.name}</span>
                        {c.parent_category && <span className="text-muted-foreground ml-2">· {c.parent_category}</span>}
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => startEdit(c)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => delCategory(c.id)} title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Categorization rules</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Select value={ruleCat} onValueChange={setRuleCat}>
                <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  {(categories as any[]).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={matchType} onValueChange={(v: any) => setMatchType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">contains</SelectItem>
                  <SelectItem value="equals">equals</SelectItem>
                  <SelectItem value="regex">regex</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Input placeholder="Pattern (e.g. UBER)" value={pattern} onChange={e => setPattern(e.target.value)} />
              <Button onClick={addRule}>Add</Button>
            </div>
            <div className="divide-y border rounded-md max-h-96 overflow-auto">
              {(rules as any[]).map(r => (
                <div key={r.id} className="flex items-center justify-between px-3 py-2 text-sm gap-2">
                  {editingRuleId === r.id ? (
                    <>
                      <div className="flex gap-2 flex-1 min-w-0">
                        <Select value={editRuleMatch} onValueChange={(v: any) => setEditRuleMatch(v)}>
                          <SelectTrigger className="h-8 w-[110px] shrink-0"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="contains">contains</SelectItem>
                            <SelectItem value="equals">equals</SelectItem>
                            <SelectItem value="regex">regex</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          value={editRulePattern}
                          onChange={(e) => setEditRulePattern(e.target.value)}
                          placeholder="Pattern"
                          className="h-8 font-mono"
                          onKeyDown={(e) => { if (e.key === "Enter") saveEditRule(r.id); if (e.key === "Escape") cancelEditRule(); }}
                          autoFocus
                        />
                        <Select value={editRuleCat} onValueChange={setEditRuleCat}>
                          <SelectTrigger className="h-8 w-[140px] shrink-0"><SelectValue placeholder="Category" /></SelectTrigger>
                          <SelectContent>
                            {(categories as any[]).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => saveEditRule(r.id)} title="Save">
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEditRule} title="Cancel">
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="outline" className="text-[10px]">{r.source}</Badge>
                        <Badge variant="secondary" className="text-[10px]">{r.match_type}</Badge>
                        <span className="font-mono truncate">{r.pattern}</span>
                        <span className="text-muted-foreground truncate">→ {r.categories?.name}</span>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => startEditRule(r)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => delRule(r.id)} title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Categories;
