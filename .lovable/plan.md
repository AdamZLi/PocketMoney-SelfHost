## Why the section moves

In `src/pages/Review.tsx` the "Owed" tab groups split transactions by person and then sorts the list by total owed amount (descending):

```ts
return Array.from(map.values()).sort((a, b) => b.total - a.total); // line 163
```

When you mark items in **Unassigned** as settled (or otherwise change them), that group's total drops, so it gets re-sorted to a lower position — which looks like the section "jumped to the bottom."

## Fix

Stop re-ordering groups based on a value that mutates as the user works. Pick one stable ordering and stick with it:

1. Sort groups alphabetically by person name (case-insensitive), with `Unassigned` pinned to either the top or the bottom consistently.
2. Tie-break only on name, never on total.

Concretely, replace the sort on line 163 with:

```ts
return Array.from(map.values()).sort((a, b) => {
  if (a.person === "Unassigned") return -1; // or 1 to pin to bottom
  if (b.person === "Unassigned") return 1;
  return a.person.localeCompare(b.person);
});
```

The displayed `total` per group still updates live, but the section's position on the page stays put while the user works through it.

No other tabs (Refunds, Settled, People) have the same problem — only the Owed tab sorts by a mutating value.

## Open question

Where should `Unassigned` sit — pinned to the **top** (so it's always the first thing the user triages) or the **bottom** (so named people come first)? I'll default to **top** unless you say otherwise.  
=> Answer: Unassigned should always sit on the top.