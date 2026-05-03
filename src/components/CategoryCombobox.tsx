import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

type Category = { id: string; name: string; parent_category?: string | null };

interface Props {
  value: string | null | undefined;
  categories: Category[];
  onChange: (categoryId: string | null) => void | Promise<void>;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
}

export function CategoryCombobox({
  value,
  categories,
  onChange,
  placeholder = "Uncategorized",
  className,
  triggerClassName,
}: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const selected = categories.find((c) => c.id === value) ?? null;
  const trimmed = query.trim();
  const exactExists =
    !!trimmed &&
    categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase());

  async function handleCreate() {
    if (!trimmed || creating) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("categories")
      .insert({ name: trimmed })
      .select("id,name")
      .single();
    setCreating(false);
    if (error || !data) {
      toast({
        title: "Failed to create category",
        description: error?.message ?? "Unknown error",
        variant: "destructive",
      });
      return;
    }
    qc.invalidateQueries({ queryKey: ["categories"] });
    await onChange(data.id);
    setQuery("");
    setOpen(false);
  }

  async function handleSelect(id: string | null) {
    await onChange(id);
    setQuery("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group flex h-8 w-full items-center justify-between gap-2 rounded-md px-2 -ml-2 text-left text-sm hover:bg-muted/60 focus:outline-none focus:ring-1 focus:ring-ring transition-colors",
            triggerClassName,
          )}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected?.name ?? placeholder}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-50 group-hover:opacity-100" />
        </button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-64 p-0", className)} align="start">
        <Command shouldFilter>
          <CommandInput
            placeholder="Search or create…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {trimmed ? (
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent rounded-sm"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="truncate">
                    Create category <span className="font-medium">"{trimmed}"</span>
                  </span>
                </button>
              ) : (
                <span className="block px-3 py-2 text-sm text-muted-foreground">
                  No categories yet.
                </span>
              )}
            </CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none__"
                onSelect={() => handleSelect(null)}
                className="text-muted-foreground"
              >
                <X className="mr-2 h-3.5 w-3.5" />
                None
                {!value && <Check className="ml-auto h-3.5 w-3.5" />}
              </CommandItem>
              {categories.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.name} ${c.parent_category ?? ""}`}
                  onSelect={() => handleSelect(c.id)}
                >
                  <span className="truncate">{c.name}</span>
                  {c.parent_category && (
                    <span className="ml-2 text-xs text-muted-foreground truncate">
                      · {c.parent_category}
                    </span>
                  )}
                  {value === c.id && <Check className="ml-auto h-3.5 w-3.5" />}
                </CommandItem>
              ))}
            </CommandGroup>
            {trimmed && !exactExists && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value={`__create__${trimmed}`}
                    onSelect={handleCreate}
                    disabled={creating}
                  >
                    <Plus className="mr-2 h-3.5 w-3.5" />
                    Create category <span className="ml-1 font-medium">"{trimmed}"</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
