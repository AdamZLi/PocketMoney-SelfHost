import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { Plus, User } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
};

/**
 * Free-text input with autocomplete drawn from:
 *   1. The managed `people` table (preferred)
 *   2. Distinct `owed_by` values that have appeared on past split transactions
 * Lets the user save a new name to the people list inline.
 */
export function OwedByCombobox({ value, onChange, placeholder, className }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: people = [] } = useQuery({
    queryKey: ["people"],
    queryFn: async () => {
      const { data, error } = await supabase.from("people").select("name").order("name");
      if (error) throw error;
      return (data ?? [])
        .map((p) => p.name)
        .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
    },
  });

  const { data: pastNames = [] } = useQuery({
    queryKey: ["owed_by_past_names"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("treatment_meta")
        .eq("treatment", "reimbursable")
        .limit(1000);
      if (error) throw error;
      const set = new Set<string>();
      (data ?? []).forEach((t: any) => {
        const n = (t.treatment_meta?.owed_by as string | undefined)?.trim();
        if (n) set.add(n);
      });
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    },
  });

  const all = useMemo(() => {
    const merged = new Map<string, "saved" | "history">();
    pastNames.forEach((n) => merged.set(n, "history"));
    people.forEach((n) => merged.set(n, "saved")); // saved overrides history label
    return Array.from(merged, ([name, source]) => ({ name, source })).filter(
      (p) => typeof p.name === "string" && p.name.length > 0,
    );
  }, [people, pastNames]);

  const q = value.trim().toLowerCase();
  const filtered = q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
  const exactMatch = all.some((p) => p.name.toLowerCase() === q);
  const canSaveNew = q.length > 0 && !exactMatch;

  async function saveAsPerson(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    await supabase.from("people").upsert({ name: trimmed }, { onConflict: "name" });
    qc.invalidateQueries({ queryKey: ["people"] });
  }

  function pick(name: string) {
    onChange(name);
    setOpen(false);
    inputRef.current?.blur();
  }

  // Close popover on outside click handled by Popover; keep it open while typing.
  useEffect(() => {
    if (!value && open) return;
  }, [value, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? "Alex, work, etc."}
          className={cn("h-8", className)}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[--radix-popover-trigger-width] min-w-[220px] p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="max-h-56 overflow-auto">
          {filtered.length === 0 && !canSaveNew && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No matches</div>
          )}
          {filtered.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => pick(p.name)}
              className="w-full flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <span className="flex items-center gap-2 truncate">
                <User className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="truncate">{p.name}</span>
              </span>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {p.source === "saved" ? "saved" : "past"}
              </span>
            </button>
          ))}
        </div>
        {canSaveNew && (
          <div className="border-t mt-1 pt-1">
            <button
              type="button"
              onClick={async () => {
                await saveAsPerson(value);
                pick(value.trim());
              }}
              className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <Plus className="h-3 w-3" />
              <span>Use & save "{value.trim()}"</span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
