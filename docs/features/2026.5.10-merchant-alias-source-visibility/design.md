# Merchant Alias Source Visibility & Exact-Match Rules — Design Document

**Source Spec:** `docs/pm-specs/2026.5.10-merchant-alias-source-visibility-spec.md`  
**Date:** 2026-05-10  
**Updated:** 2026-05-11 — All open design questions resolved  
**Status:** Ready for Implementation  
**Target Persona:** Adam (Solo Self-Hoster)

---

## Overview

This design addresses three core user needs from the spec:

1. **Visibility** — see the original raw transaction name everywhere (alias page, import review, transaction detail)
2. **Control** — create exact-match rules that override pattern-based matching
3. **Correction** — fix mismatches inline with retroactive updates to past transactions

The design builds on existing patterns in the codebase: inline-editable tables on the Aliases page, the staging table on Import, Command-based comboboxes for search+create, toast notifications, and progressive disclosure for long lists.

---

## 1. User Flow

### Flow A: Auditing aliases and correcting mismatches (Alias Page)

```
Opens Alias page
  → Sees alias table with sentence-style add form and expandable rows
  → Clicks/expands an alias row
  → Sees "Matched Source Names" panel listing all unique raw strings that resolved to this alias
  → Scans the list — spots a raw name that doesn't belong (e.g., "Google&Youtubepremium.co/helppay#" under "Google")
  → Clicks "Reassign" on that raw name
  → Reassign flow opens inline:
      → Searches existing aliases or types a new display name
      → System shows: "This will update X transactions. An exact-match rule will be created."
      → Confirms
      → Toast: "Reassigned. X transactions updated."
  → Raw name disappears from this alias's list and appears under the new alias
```

**Decision points:**

- **User cancels reassignment** → nothing changes, panel stays open
- **Target alias doesn't exist** → user types a new name, system creates both the alias and the exact-match rule
- **Zero transactions affected** → confirmation step is skipped, rule is still created for future imports

### Flow B: Creating an exact-match rule proactively (Alias Page)

```
Opens Alias page
  → Uses the sentence-style add form at top
  → Selects "is exactly" from the match type dropdown
  → Pastes the full raw merchant string in the pattern field
  → Enters desired display name
  → Clicks [+ Add]
  → Rule appears in table
  → Toast: "Exact-match rule created."
```

### Flow C: Correcting a mismatch during import (Import Page)

```
Uploads CSV
  → Staging table loads — now shows a "Raw Name" column alongside the existing "Merchant" column
  → Scans rows — notices "Google&Youtubepremium.co/helppay#" resolved to "Google"
  → Clicks the merchant cell (or a reassign action on that row)
  → Combobox opens: search existing aliases or create new
  → Selects "YouTube Premium"
  → Row updates immediately in staging
  → On commit: an exact-match rule is created automatically for that raw string
```

**Decision points:**

- **User ignores the raw name column** → no change, import proceeds as before
- **User changes merchant but raw name column is the same as merchant** → no exact rule needed, treated as a normal category override

### Flow D: Cross-referencing a transaction with bank statement

```
Views a transaction (in transaction list or detail)
  → Sees display name prominently
  → Sees raw name below/beside it in a secondary style
  → Copies raw name to clipboard
  → Searches bank portal with that string
```

---

## 2. Component Breakdown

### 2a. Alias Page — Default State

The page has a sentence-style add form at top and a 4-column table with expandable rows.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Merchant Aliases                                                            │
│                                                                              │
│  If source name [▾ contains ] [___pattern___________] → display as           │
│  [___display name______] [+ Add]                                             │
│                                                                              │
│ ┌────────────────────────────────────────────────────────────────────────┐    │
│ │    │ When source name…              │ Display as        │              │    │
│ │────┼────────────────────────────────┼───────────────────┼──────────────│    │
│ │ ›  │ contains [___amazon___]        │ [___Amazon______] │  [🗑 Delete] │    │
│ │ ›  │ is exactly [___AMZN MKTP US_]  │ [___Amazon______] │  [🗑 Delete] │    │
│ │ ›  │ contains [___netflix___]       │ [___Netflix_____] │  [🗑 Delete] │    │
│ │ ›  │ contains [___google___]        │ [___Google______] │  [🗑 Delete] │    │
│ └────────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
```

*Alias page — default state (all rows collapsed)*

**Columns:**

1. **Chevron** — expand/collapse toggle (`›` collapsed, `⌄` expanded)
2. **"When source name…"** — shows the match type and an inline-editable pattern input
3. **"Display as"** — inline-editable display name input
4. **Delete** — removes the alias rule

The add form reads as a natural sentence: "If source name [contains ▾] [pattern] → display as [name] [+ Add]". The dropdown offers "contains", "is exactly", and "matches regex".

---

### 2b. Alias Page — Expanded Row (Matched Source Names Panel)

Clicking a row reveals the matched source names panel below it.

```
┌──────────────────────────────────────────────────────────────────────────┐
│    │ When source name…              │ Display as        │              │
│────┼────────────────────────────────┼───────────────────┼──────────────│
│ ⌄  │ contains [___google___]        │ [___Google______] │  [🗑 Delete] │
│    ┌────────────────────────────────────────────────────────────────┐   │
│    │  Matched Source Names (3 unique names)                        │   │
│    │                                                               │   │
│    │  GOOGLE *CLOUD abcd-1234          14 transactions  [📋] [Reassign] │
│    │  Google&Youtubepremium.co/he...    3 transactions  [📋] [Reassign] │
│    │  GOOGLE *SERVICES                  8 transactions  [📋] [Reassign] │
│    └────────────────────────────────────────────────────────────────┘   │
│ ›  │ contains [___netflix___]       │ [___Netflix_____] │  [🗑 Delete] │
│ ›  │ contains [___amazon___]        │ [___Amazon______] │  [🗑 Delete] │
└──────────────────────────────────────────────────────────────────────────┘
```

*Alias page — expanded row showing matched source names*

**Panel contents:**

- Header: "Matched Source Names" + count (e.g., "3 unique names")
- Each raw name row shows:
  - The raw string (monospace, full-width — wraps if long)
  - Transaction count (e.g., "14 transactions")
  - Copy button `[📋]` — copies raw name to clipboard, shows "Copied" tooltip (2s)
  - `[Reassign]` action — opens the reassign combobox inline
- Search/filter input appears when list exceeds 10 items
- First 20 shown; "Show N more" button for the rest
- Data is fetched lazily on expand — skeleton rows during load

---

### 2b-empty. Alias Page — Expanded Row, Empty State

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ⌄  │ is exactly [___NEWRULE_______]  │ [___NewAlias____] │  [🗑 Delete] │
│    ┌────────────────────────────────────────────────────────────────┐   │
│    │  Matched Source Names                                         │   │
│    │                                                               │   │
│    │          No transactions have matched this alias yet.         │   │
│    │                                                               │   │
│    └────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

*Alias page — expanded row, empty state (new rule with no matches)*

Shown when an alias rule exists but no transactions have resolved to it yet (e.g., a proactively-created exact-match rule).

---

### 2c. Reassign Combobox (Shared — Alias Page & Import Page)

**What it does:** A search-and-select dropdown for choosing a target alias, with inline creation of new aliases. Used when reassigning a raw name to a different alias.

**Existing pattern reused:** Matches the `CategoryCombobox` pattern — Popover + Command with search input, scrollable list of options, and a "Create new" option at the bottom when the search query doesn't match an existing alias.

```
│  GOOGLE *CLOUD abcd-1234          14 transactions  [📋]              │
│    ┌──────────────────────────────────┐                              │
│    │ Search aliases or type to create…│                              │
│    │──────────────────────────────────│                              │
│    │   Amazon                         │                              │
│    │ ✓ Google              (current)  │                              │
│    │   Netflix                        │                              │
│    │   YouTube Premium                │                              │
│    │──────────────────────────────────│                              │
│    │ + Create alias "youtube"         │                              │
│    └──────────────────────────────────┘                              │
```

*Reassign combobox — open, searching aliases*

**States:**

- Default: shows all aliases alphabetically
- Searching: filters list in real-time
- No results: shows only the "Create [query]" option
- Creating: brief loading state on the create option while the new alias is saved
- Current alias shown with check icon and "(current)" label — not selectable

---

### 2d. Retroactive Update Confirmation (Shared)

**What it does:** An inline confirmation step shown when a reassignment would affect existing transactions. Appears below the reassign combobox — not a modal.

```
│  Google&Youtubepremium.co/he...    3 transactions  [📋]              │
│    ┌──────────────────────────────────────────────────────────────┐  │
│    │ This will update 3 transactions from "Google" to            │  │
│    │ "YouTube Premium".                                          │  │
│    │ An exact-match rule will be created for this source name.   │  │
│    │                                                             │  │
│    │              [ Confirm Reassignment ]  [ Cancel ]           │  │
│    └──────────────────────────────────────────────────────────────┘  │
```

*Reassign confirmation — inline, showing affected transaction count*

**States:**

- Default: visible with transaction count
- Loading: "Confirm" button shows spinner, disabled
- Success: disappears, toast notification confirms completion
- Error: inline error text replaces summary, "Retry" replaces "Confirm"
- Zero affected: panel is not shown — rule is created immediately with a toast

---

### 2e. Import Page — Staging Table with Source Name Column

A new "Source Name" column shows the original raw merchant string from the CSV alongside the resolved merchant name.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  Import Transactions                                                           │
│                                                                                │
│  [Choose File]  capital-one-may-2026.csv  ✓ 47 transactions parsed             │
│                                                                                │
│ ┌────────────┬──────────────────────────┬──────────────┬────────────┬──────────┐│
│ │ Date       │ Source Name              │ Merchant     │ Category   │ Amount   ││
│ │────────────┼──────────────────────────┼──────────────┼────────────┼──────────││
│ │ 2026-05-01 │ AMZN MKTP US*M12345...  │ Amazon       │ Shopping   │  -$34.99 ││
│ │ 2026-05-02 │ GOOGLE *CLOUD abcd-...  │ Google       │ Software   │  -$12.00 ││
│ │ 2026-05-02 │ —                        │ Netflix      │ Entertain  │  -$15.49 ││
│ │ 2026-05-03 │ Google&Youtubeprem...    │ Google       │ Entertain  │   -$9.99 ││
│ │ 2026-05-04 │ WHOLEFDS MKT #1234...   │ Whole Foods  │ Groceries  │  -$67.23 ││
│ └────────────┴──────────────────────────┴──────────────┴────────────┴──────────┘│
│                                                                                │
│                                          [ Commit 47 Transactions ]            │
└────────────────────────────────────────────────────────────────────────────────┘
```

*Import page — staging table with Source Name column*

**Column behavior:**

- Source Name truncated at 60 chars, full value on hover (tooltip)
- When raw name matches the resolved merchant → cell shows "—" (muted)
- Column is always visible — no toggle; this is the core visibility feature

---

### 2f. Import Page — Inline Correction

Clicking a merchant cell opens the reassign combobox anchored to that cell.

```
│ Date       │ Source Name              │ Merchant     │ Category   │ Amount   │
│────────────┼──────────────────────────┼──────────────┼────────────┼──────────│
│ 2026-05-01 │ AMZN MKTP US*M12345...  │ Amazon       │ Shopping   │  -$34.99 │
│ 2026-05-03 │ Google&Youtubeprem...    │ ┌──────────────────────────────┐9.99 │
│            │                          │ │ Search aliases or type to... │     │
│            │                          │ │──────────────────────────────│     │
│            │                          │ │   Google              ✓     │     │
│            │                          │ │   YouTube Premium           │     │
│            │                          │ │   Google Cloud              │     │
│            │                          │ │──────────────────────────────│     │
│            │                          │ │ + Create alias "youtube..."  │     │
│            │                          │ └──────────────────────────────┘     │
│ 2026-05-04 │ WHOLEFDS MKT #1234...   │ Whole Foods  │ Groceries  │  -$67.23 │
```

*Import page — inline correction with reassign combobox open on a row*

After selecting "YouTube Premium": the merchant cell updates immediately. On commit, an exact-match rule is created automatically for that raw string. The corrected row shows a subtle "edited" badge.

---

### 2g. Transaction Detail — Source Name Display

The raw merchant name appears below the display name in transaction detail sheets.

```
┌────────────────────────────────────────────┐
│  Transaction Detail                    [✕] │
│                                            │
│  Amazon                                    │
│  Source: AMZN MKTP US*M12345K7             │
│                                            │
│  ─────────────────────────────────────     │
│  Date          May 1, 2026                 │
│  Category      Shopping                    │
│  Amount        -$34.99                     │
│  Account       Capital One                 │
│  Treatment     Normal                      │
│  ─────────────────────────────────────     │
│                                            │
│  [📋 Copy Source Name]                     │
└────────────────────────────────────────────┘
```

*Transaction detail sheet — raw source name shown below merchant*

**States:**

- **Raw ≠ display name:** "Source:" line shown in muted monospace below the display name
- **Raw = display name:** "Source:" line hidden — no visual clutter
- **Unavailable** (pre-feature transactions): italic muted "Original name not available"

---

## 3. States & Edge Cases

### Alias Page — Matched Raw Names


| State                  | Behavior                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| **Empty**              | "No transactions have matched this alias yet." centered, muted text                                       |
| **Loading**            | 3 skeleton rows with pulse animation                                                                      |
| **Loaded (few)**       | All raw names shown inline, no pagination needed. Only names currently resolving to this alias are shown. |
| **Loaded (many, 10+)** | Search filter input appears above the list                                                                |
| **Loaded (many, 20+)** | First 20 shown, "Show N more" button below                                                                |
| **Error fetching**     | "Couldn't load matched names." + "Retry" button                                                           |
| **After reassignment** | Raw name animates out of list, count decrements. If last raw name removed, empty state appears            |
| **Copy raw name**      | Click `[📋]` → clipboard copy → "Copied" tooltip (2s fade)                                                |


Loading state:

```
│ ⌄  │ contains [___google___]        │ [___Google______] │  [🗑 Delete] │
│    ┌────────────────────────────────────────────────────────────────┐   │
│    │  Matched Source Names                                         │   │
│    │                                                               │   │
│    │  ████████████████████████████      ██████████████   ██  ██    │   │
│    │  ██████████████████████            ██████████████   ██  ██    │   │
│    │  ████████████████████████████████  ██████████████   ██  ██    │   │
│    └────────────────────────────────────────────────────────────────┘   │
```

*Loading state — skeleton rows with pulse animation*

### Reassignment Flow


| State                               | Behavior                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Searching aliases**               | Combobox filters in real-time                                                                   |
| **No matching alias**               | "Create alias '[query]'" option appears                                                         |
| **Creating new alias**              | Loading spinner on create option, combobox stays open                                           |
| **Confirmation shown**              | Transaction count + confirm/cancel inline                                                       |
| **Confirming (loading)**            | Confirm button disabled with spinner                                                            |
| **Success**                         | Toast: "Reassigned '[raw name]' → '[new alias]'. [N] transactions updated." Combobox closes.    |
| **Failure**                         | Inline error: "Update failed. Your data is unchanged." + Retry                                  |
| **Zero transactions affected**      | No confirmation step. Immediate toast: "Exact-match rule created for '[raw name]' → '[alias]'." |
| **Target alias is same as current** | Combobox shows current alias as already selected; reassign action is disabled                   |


Full reassignment sequence:

```
Step 1: Click [Reassign]                 Step 2: Select target alias
                                         
│ GOOGLE&YOUTUBEPREM... 3 txn [📋]      │ GOOGLE&YOUTUBEPREM... 3 txn [📋]
│   [Reassign]                           │   ┌─────────────────────────────┐
│                                        │   │ Search aliases...           │
                                         │   │─────────────────────────────│
                                         │   │   Amazon                    │
                                         │   │   Google            ✓       │
                                         │   │   YouTube Premium           │
                                         │   └─────────────────────────────┘


Step 3: Confirmation appears              Step 4: Success toast
                                         
│ GOOGLE&YOUTUBEPREM... 3 txn [📋]      ┌──────────────────────────────────┐
│   ┌──────────────────────────────┐    │ ✓ Source name reassigned         │
│   │ This will update 3           │    │   "GOOGLE&YOUTUBE..." →          │
│   │ transactions from "Google"   │    │   "YouTube Premium".             │
│   │ to "YouTube Premium".        │    │   3 transactions updated.        │
│   │                              │    └──────────────────────────────────┘
│   │ [ Confirm Reassignment ]     │
│   │ [ Cancel ]                   │
│   └──────────────────────────────┘
```

*Reassignment flow — step by step*

### Import Page — Raw Name Column


| State                       | Behavior                                                                          |
| --------------------------- | --------------------------------------------------------------------------------- |
| **Raw ≠ Merchant**          | Raw name shown in normal muted monospace text, truncated at 60 chars with tooltip |
| **Raw = Merchant**          | Cell shows "—" in muted text                                                      |
| **After inline correction** | Merchant column updates to new alias; Raw Name column unchanged                   |
| **Column overflow**         | Truncated at 60 characters; full value shown in tooltip on hover                  |


### Transaction Detail — Raw Name


| State                           | Behavior                                    |
| ------------------------------- | ------------------------------------------- |
| **Raw name exists and differs** | Shown in secondary style below display name |
| **Raw name exists and matches** | Hidden — no visual clutter                  |
| **Raw name unavailable**        | Italic muted: "Original name not available" |


### Add Alias Form


| State                              | Behavior                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **"Exact match" selected**         | Pattern field label changes to "Source Name"                                                                                 |
| **"Contains" or "Regex" selected** | Pattern field label remains "Pattern" (existing behavior)                                                                    |
| **Duplicate exact rule**           | Toast error: "An exact-match rule already exists for this source name. Edit the existing rule instead." Form is not cleared. |


---

## 4. Interaction Patterns

### Expanding an alias row

**Trigger:** User clicks anywhere on the alias row (except inline edit inputs or the delete button), or clicks a chevron/expand icon at the row start.

**Response:** Row expands downward with a smooth height transition (~200ms ease-out). The matched raw names panel loads below. Data is fetched lazily on expand — skeleton rows appear immediately during the transition, then resolve to real data.

**Collapse:** Clicking the row again (or the chevron) collapses the panel with a reverse transition. Collapsing does not lose any unsaved state (there is no unsaved state — reassignments are committed immediately).

### Reassigning a raw name

**Trigger:** User clicks the "Reassign" action on a raw name row (in the matched names panel or during import review).

**Response:**

1. The reassign combobox appears inline, replacing the "Reassign" button. Focus moves to the search input.
2. User searches or selects a target alias.
3. If transactions exist with this raw name:
  - Confirmation text appears below the combobox: "This will update [N] transactions from '[current]' to '[target]'. An exact-match rule will be created."
  - "Confirm" and "Cancel" buttons appear.
  - User clicks "Confirm" → button shows spinner, disabled (~1-3 seconds for the update).
  - On success: toast notification, raw name row animates out of current alias's list.
4. If zero transactions exist:
  - Rule is created immediately (no confirmation), toast shown.

**Cancel:** Clicking "Cancel" or pressing Escape closes the combobox and restores the "Reassign" button. No changes made.

**Keyboard:** Tab navigates through combobox options. Enter selects. Escape cancels.

### Inline correction during import

**Trigger:** User clicks the merchant cell on a staging row (or a dedicated "Change" action on that row).

**Response:** The reassign combobox (same component as alias page) opens anchored to that cell. User selects a target alias. The staging row's merchant column updates immediately. No confirmation modal — the exact-match rule is created on commit, not on selection.

**Feedback:** The merchant cell briefly highlights (background flash, ~300ms) to confirm the change. A subtle "edited" badge appears on the row.

### Copying raw name from transaction detail or alias page

**Trigger:** User clicks the raw name text in a transaction detail view or in the alias page matched names panel.

**Response:** Raw name is copied to clipboard. A brief tooltip appears: "Copied to clipboard" (~2 seconds, then fades). Same interaction in both locations.

---

## 5. Content & Copy

### Alias Page


| Element                            | Copy                                                                |
| ---------------------------------- | ------------------------------------------------------------------- |
| Add form sentence                  | "If source name [▾ contains] [pattern] → display as [name] [+ Add]" |
| Match type options                 | "contains" / "is exactly" / "matches regex"                         |
| Column header — match              | "When source name…"                                                 |
| Column header — display            | "Display as"                                                        |
| Expanded panel header              | "Matched Source Names"                                              |
| Expanded panel count               | "[N] unique names" / "1 unique name"                                |
| Empty matched names                | "No transactions have matched this alias yet."                      |
| Loading matched names              | (skeleton rows, no text)                                            |
| Error loading                      | "Couldn't load matched names."                                      |
| Error retry button                 | "Retry"                                                             |
| Raw name row — transaction count   | "[N] transactions" / "1 transaction"                                |
| Reassign button                    | "Reassign"                                                          |
| Copy tooltip (matched names panel) | "Copied to clipboard"                                               |
| Search filter placeholder          | "Filter source names…"                                              |
| Progressive disclosure button      | "Show [N] more"                                                     |


### Reassign Flow


| Element                            | Copy                                                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Combobox search placeholder        | "Search aliases or type to create…"                                                                                                    |
| Create new option                  | "Create alias '[query]'"                                                                                                               |
| Confirmation text                  | "This will update [N] transactions from '[current alias]' to '[new alias]'. An exact-match rule will be created for this source name." |
| Confirmation text (0 transactions) | (not shown — rule created immediately)                                                                                                 |
| Confirm button                     | "Confirm Reassignment"                                                                                                                 |
| Cancel button                      | "Cancel"                                                                                                                               |
| Success toast title                | "Source name reassigned"                                                                                                               |
| Success toast description          | "'[raw name]' → '[new alias]'. [N] transactions updated."                                                                              |
| Success toast (0 transactions)     | "Exact-match rule created for '[raw name]' → '[alias]'."                                                                               |
| Error inline text                  | "Reassignment failed. Your data is unchanged."                                                                                         |
| Error retry button                 | "Retry"                                                                                                                                |


### Add Alias Form


| Element                                | Copy                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| Match type dropdown — contains         | "contains"                                                                                 |
| Match type dropdown — exact            | "is exactly"                                                                               |
| Match type dropdown — regex            | "matches regex"                                                                            |
| Pattern field placeholder              | Contextual — "pattern" or full source name                                                 |
| Display name field placeholder         | "display name"                                                                             |
| Add button                             | "+ Add"                                                                                    |
| Duplicate exact rule toast title       | "Rule already exists"                                                                      |
| Duplicate exact rule toast description | "An exact-match rule already exists for this source name. Edit the existing rule instead." |


### Import Page


| Element                   | Copy          |
| ------------------------- | ------------- |
| Source Name column header | "Source Name" |
| Cell when raw = merchant  | "—"           |
| Edited row badge          | "edited"      |


### Transaction Detail


| Element              | Copy                          |
| -------------------- | ----------------------------- |
| Raw name label       | "Source name"                 |
| Raw name unavailable | "Original name not available" |
| Copy tooltip         | "Copied to clipboard"         |


---

## 6. Accessibility Notes

### Keyboard Navigation

- **Alias table rows** are keyboard-expandable: Enter or Space toggles the expanded panel. Focus ring is visible on the row.
- **Tab order within expanded panel:** Search filter → first raw name row → Reassign button → next raw name row → Reassign button → … → "Show more" button.
- **Reassign combobox:** Follows the existing CategoryCombobox keyboard pattern — arrow keys navigate options, Enter selects, Escape cancels and returns focus to the Reassign button.
- **Confirmation buttons:** Tab navigates Confirm → Cancel. Enter activates the focused button.
- **Import staging table:** Tab order includes the new Source Name column. The correction action (click on merchant cell) is also triggerable via Enter when the cell is focused.

### Screen Reader Support

- Expanded alias rows use `aria-expanded="true/false"` on the row trigger.
- Matched raw names panel is announced: `aria-label="Matched source names for [alias display name]"`.
- Transaction counts per raw name use `aria-label="[raw name], [N] transactions"`.
- Reassign combobox uses `role="combobox"` with `aria-autocomplete="list"`.
- Confirmation text is wrapped in `aria-live="polite"` so the transaction count is announced when it appears.
- Success/error toasts use `role="status"` (existing pattern).
- The "Copied to clipboard" tooltip uses `aria-live="assertive"` for immediate announcement.

### Color & Contrast

- Match type labels in table rows (e.g., "contains", "is exactly"): use existing muted text styles which meet AA contrast (4.5:1).
- Muted raw name text (secondary style): must meet AA contrast against the background. The existing `text-muted-foreground` class meets this.
- Monospace raw name text: use the system monospace font at the same size as body text — no reduction in readability.
- Error states: use existing destructive/red styling which meets AA contrast.

### Motion

- Row expand/collapse animation respects `prefers-reduced-motion`: if set, transition is instant (0ms) instead of 200ms.
- Background flash on corrected import row also respects reduced motion preference.

---

## 7. Resolved Design Questions

All design questions have been resolved and incorporated into the spec. See "Resolved Design Decisions" in the source spec (`docs/pm-specs/2026.5.10-merchant-alias-source-visibility-spec.md`).