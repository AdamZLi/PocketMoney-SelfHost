import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function MerchantNameInput({ value, onChange }: Props) {
  const [focused, setFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: aliasNames = [] } = useQuery({
    queryKey: ["alias_display_names"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("merchant_aliases")
        .select("display_name");
      if (error) return [];
      const seen = new Set<string>();
      return (data ?? [])
        .map(a => a.display_name)
        .filter(name => {
          const key = name.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort();
    },
  });

  const suggestions = useMemo(() => {
    if (!value.trim()) return [];
    const lower = value.toLowerCase();
    return aliasNames.filter(
      name => name.toLowerCase().includes(lower) && name.toLowerCase() !== lower
    ).slice(0, 8);
  }, [value, aliasNames]);

  const showDropdown = focused && suggestions.length > 0;

  useEffect(() => {
    setSelectedIndex(-1);
  }, [value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      onChange(suggestions[selectedIndex]);
      setFocused(false);
    } else if (e.key === "Escape") {
      setFocused(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={handleKeyDown}
      />
      {showDropdown && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md py-1 max-h-48 overflow-y-auto">
          {suggestions.map((name, i) => (
            <button
              key={name}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${i === selectedIndex ? "bg-accent" : ""}`}
              onMouseDown={e => {
                e.preventDefault();
                onChange(name);
                setFocused(false);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
