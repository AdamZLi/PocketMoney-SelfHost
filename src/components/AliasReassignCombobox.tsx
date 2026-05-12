import { useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Check, Plus } from "lucide-react";

interface Props {
  aliases: { id: string; display_name: string }[];
  currentAlias: string | null;
  onSelect: (displayName: string, isNew: boolean) => void;
  onCancel: () => void;
}

export function AliasReassignCombobox({
  aliases,
  currentAlias,
  onSelect,
  onCancel,
}: Props) {
  const [query, setQuery] = useState("");

  const trimmed = query.trim();
  const exactExists =
    !!trimmed &&
    aliases.some((a) => a.display_name.toLowerCase() === trimmed.toLowerCase());

  function handleSelect(displayName: string) {
    setQuery("");
    onSelect(displayName, false);
  }

  function handleCreate() {
    if (!trimmed) return;
    setQuery("");
    onSelect(trimmed, true);
  }

  return (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <Command className="border rounded-md shadow-md w-64" shouldFilter>
        <CommandInput
          placeholder="Search or create alias…"
          value={query}
          onValueChange={setQuery}
          autoFocus
          onKeyDown={e => { if (e.key === "Escape") onCancel(); }}
        />
        <CommandList>
          <CommandEmpty>
            {trimmed ? (
              <button
                type="button"
                onClick={handleCreate}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent rounded-sm"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="truncate">
                  Create alias <span className="font-medium">"{trimmed}"</span>
                </span>
              </button>
            ) : (
              <span className="block px-3 py-2 text-sm text-muted-foreground">
                No aliases yet.
              </span>
            )}
          </CommandEmpty>
          <CommandGroup>
            {aliases.map((a) => (
              <CommandItem
                key={a.id}
                value={a.display_name}
                onSelect={() => handleSelect(a.display_name)}
              >
                <span className="truncate">{a.display_name}</span>
                {currentAlias === a.display_name && (
                  <Check className="ml-auto h-3.5 w-3.5" />
                )}
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
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Create alias <span className="ml-1 font-medium">"{trimmed}"</span>
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </div>
  );
}
