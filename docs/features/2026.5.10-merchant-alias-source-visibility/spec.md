# Merchant Alias Source Visibility & Exact-Match Rules Specification

**Version:** 1.1  
**Author:** PMSpec Agent  
**Date:** 2026-05-10  
**Updated:** 2026-05-11 — Resolved 6 open design questions  
**Status:** Draft  
**Target Persona:** Adam (Solo Self-Hoster)

---

## Problem Statement

**What problem does this solve?**

When transactions are imported, raw merchant names from bank statements (e.g., `"Google&Youtubepremium.co/helppay#"`) are cleaned and matched to display names using pattern-based rules. These patterns can be overly broad — a pattern like `"Google"` captures every transaction containing that word, regardless of whether it's Google Play, YouTube Premium, Google Cloud, or Google One. The user loses the original transaction name after import, making it impossible to audit which raw strings mapped to which display name — or to correct mistakes.

**Why does it matter?**

- **Misclassification compounds silently.** A bad pattern match means every future import with that raw name is wrong, and the user has no easy way to discover or fix it.
- **Bank reconciliation is broken.** Without the original transaction name, the user can't cross-reference their bank statement with the app.
- **Control is lost.** The user has no way to say "this exact string should map to X" — only broad patterns exist today.

**Current state → Desired state:**

| Current State | Desired State |
|---|---|
| Only pattern-based alias matching | Exact-match rules (higher priority) + pattern rules coexist |
| Raw merchant name is discarded/invisible after import | Raw merchant name is preserved and visible on alias page and during import |
| No way to see which raw names matched a given alias | Each alias shows all unique raw names it has captured |
| Mismatches require manually creating a new pattern and hoping it doesn't conflict | User can correct a mismatch inline and create an exact rule in one action |
| Corrections only affect future imports | Corrections retroactively update past transactions |

---

## Goals & Non-Goals

### Goals

1. **Preserve and surface raw transaction names** — every imported transaction retains its original merchant string from the bank, and users can view these on the alias management page and during import review.
2. **Enable exact-match alias rules** — users can define precise `raw name → display name` mappings that take priority over pattern-based matching.
3. **Support inline correction with retroactive application** — when a user identifies a mismatch, they can reassign the raw name to the correct alias (or create a new one), and all past transactions with that same raw name are updated.

### Non-Goals

1. **Replacing pattern-based matching** — patterns remain as the fallback matching strategy. This feature augments, not replaces, the existing system.
2. **AI-assisted alias suggestions** — any ML/AI-driven merchant name resolution is out of scope for this spec.
3. **Bulk re-processing tool** — a tool to retroactively re-process all historical transactions against new rules is not included (though individual corrections do apply retroactively).

---

## User Stories & User Experience

### Story 1: Viewing raw names that matched an alias

> As **Adam**, I want to see every unique raw transaction name that has been matched to a given alias, so that I can audit whether the matching is correct.

**Happy path:** Adam opens the alias management page, selects the alias "Google," and sees a list of all unique raw strings that were mapped to it (e.g., `"GOOGLE *SERVICES"`, `"Google&Youtubepremium.co/helppay#"`, `"GOOGLE *Google One"`). He immediately notices the YouTube Premium entry doesn't belong.

**Edge case — no matches yet:** A newly created alias shows an empty list with a clear indication that no transactions have matched yet.

**Edge case — many unique raw names:** An alias for a common merchant (e.g., Amazon) might have dozens of unique raw strings. The list should be navigable and not overwhelm the user.

---

### Story 2: Creating an exact-match rule

> As **Adam**, I want to define an exact-match rule that maps a specific raw transaction name to a display name, so that it always resolves correctly regardless of patterns.

**Happy path:** Adam creates an exact-match rule: `"Google&Youtubepremium.co/helppay#"` → `"YouTube Premium"`. On the next import, any transaction with that exact raw name maps to "YouTube Premium" — not "Google."

**Edge case — conflict with existing pattern:** The raw name also matches the "Google" pattern. The exact-match rule takes priority and the user sees no conflict. The pattern still applies to other raw names it matches.

**Edge case — duplicate exact rule:** If the user tries to create an exact-match rule for a raw name that already has one, they are informed of the existing rule and given the option to update it.

---

### Story 3: Correcting a mismatch inline during import

> As **Adam**, I want to see the original raw merchant name during import review and correct any mismatches before or after committing, so that I catch errors early.

**Happy path:** During import review, Adam sees a staging row showing:
- **Raw name:** `"Google&Youtubepremium.co/helppay#"`
- **Matched to:** `"Google"`

He recognizes this is wrong, selects the raw name, and reassigns it to "YouTube Premium" (or creates a new alias). This action creates an exact-match rule for that raw string.

**Edge case — raw name is already correct:** Most rows will be correct. The raw name should be visible but unobtrusive — it shouldn't clutter the review experience for rows that matched correctly.

---

### Story 4: Correcting a mismatch from the alias page with retroactive update

> As **Adam**, I want to reassign a mismatched raw name from the alias page and have all past transactions with that raw name updated, so that my historical data is accurate.

**Happy path:** On the alias page, Adam sees `"Google&Youtubepremium.co/helppay#"` under the "Google" alias. He reassigns it to "YouTube Premium." All past transactions that came from that raw name are updated to show "YouTube Premium" as the merchant. An exact-match rule is created automatically.

**Edge case — many affected transactions:** If reassigning affects a large number of transactions, the user is shown a count of how many will be updated and asked to confirm.

**Edge case — the target alias doesn't exist yet:** The user should be able to create a new alias as part of the reassignment flow, without navigating away.

---

### Story 5: Cross-referencing with bank statement

> As **Adam**, I want to see the original raw transaction name on any transaction, so that I can match it against my bank statement when reconciling.

**Happy path:** Adam opens a transaction's detail view (or sees it in a list) and the raw/original merchant name from the bank is visible alongside the cleaned display name. He copies the raw name and searches his bank portal.

**Edge case — raw name is identical to display name:** If the raw name and display name are the same (no alias was applied), the raw name field can be hidden or de-emphasized to reduce noise.

---

## Acceptance Criteria

### Raw Name Preservation

- When a transaction is imported, the original raw merchant string from the source file is stored and never overwritten.
- When viewing any transaction, the user can see both the raw merchant name and the display name.

### Alias Page — Source Name Visibility

- When viewing an alias on the alias management page, all unique raw merchant names that have matched to that alias are listed.
- When an alias has no matched raw names, a clear empty state is shown.
- When a raw name list is long, the user can navigate/search within it.
- When the alias row is expanded, matched raw names are fetched lazily (on expand), showing skeleton rows during loading.
- Each raw name in the matched names panel has a copy-to-clipboard action, allowing the user to copy the raw string for bank reconciliation.
- A raw name appears only under the alias it currently resolves to — not under previously matched aliases.

### Exact-Match Rules

- When creating a new alias rule, the user can choose between "exact match" and "pattern match" types.
- When a transaction's raw name matches both an exact-match rule and a pattern rule, the exact-match rule takes priority.
- When an exact-match rule already exists for a given raw name, the user is notified and can update it.
- When listing alias rules, the rule type (exact vs. pattern) is clearly indicated.

### Inline Correction

- When reviewing imports, the raw merchant name is always visible in a "Source Name" column alongside the matched display name for each row. The column is shown by default and cannot be toggled off.
- When a user reassigns a raw name to a different alias (on the alias page or during import), an exact-match rule is created for that raw string.
- When a user reassigns a raw name, they can select an existing alias or create a new one without leaving the current view.

### Retroactive Updates

- When a raw name is reassigned to a different alias, all existing transactions with that same raw merchant name are updated to reflect the new display name.
- When a retroactive update would affect transactions, the user is shown the count of affected transactions and must confirm.
- When an exact-match rule is created, the system also attempts to match pre-feature transactions (those without a stored raw name) by comparing the rule's raw string against their current `name` field. Matched transactions are updated and have their `raw_merchant_name` backfilled.

### Priority Order

- When matching a transaction during import, the system evaluates in this order: exact-match rules first → pattern rules second → unmatched.

---

## Constraints & Considerations

- **Data integrity:** Raw merchant names must be treated as immutable once stored. Only the display name / alias mapping may change.
- **Performance:** Retroactive updates could affect many transactions. The experience should communicate progress and not leave the user uncertain about whether the operation completed.
- **Accessibility:** Raw merchant names are often ugly strings with special characters. They should be displayed in a way that is readable (e.g., monospace, not truncated by default).
- **Raw name display length:** On the alias page matched names panel, raw names are shown in full (no truncation) — they wrap naturally in the panel. On the import staging table, raw names truncate at 60 characters with a tooltip showing the full string on hover, since the table layout is more constrained.
- **Backward compatibility:** Existing transactions that were imported before this feature must still work. If no raw name was stored historically, those transactions should gracefully show "not available" or similar for the raw name field. When exact-match rules are created, the system should attempt to backfill older transactions by matching against their current `name` field.

---

## Resolved Design Decisions

The following decisions were made to resolve open design questions raised during the design phase. Each decision is grounded in Adam's core goals: transparency, control, bank reconciliation accuracy, and efficiency.

### Decision 1: Source Name column is always visible on the import staging table

**Choice:** Always show (Option A).

**Reasoning:** This feature exists to give Adam visibility into what his bank actually sent. Hiding the column behind a toggle defeats the purpose — Adam wouldn't know to turn it on, and the information is most valuable precisely during import review when he can catch mismatches. The table gains a 7th column, but the Source Name column can use compact monospace styling with truncation (see Decision 5) to stay manageable. Visibility is the entire point of this feature.

### Decision 2: Matched Source Names panel uses lazy loading (fetch on expand)

**Choice:** Lazy loading — fetch raw names when the alias row is expanded.

**Reasoning:** Adam is a solo self-hoster with moderate data, but loading matched names for every alias eagerly would slow the alias page load for no benefit. Adam will only expand a handful of aliases at a time. Lazy loading keeps the page snappy. The loading state (skeleton rows during the expand animation) is brief and well-understood. This also sets a good pattern if data volume grows.

### Decision 3: Raw names appear only under the alias they currently resolve to

**Choice:** Show under current alias only — not historical aliases.

**Reasoning:** Adam cares about current accuracy, not historical breadcrumbs. If `"Google&Youtubepremium.co/helppay#"` was once matched to "Google" but now has an exact rule mapping it to "YouTube Premium," it should only appear under "YouTube Premium." Showing it under both would be confusing and make the matched names panel unreliable as an audit tool. The exact-match rule is the source of truth; the panel should reflect it.

### Decision 4: Copy-to-clipboard is available on the alias page matched names panel

**Choice:** Yes — add copy-to-clipboard to each raw name row in the matched names panel.

**Reasoning:** Adam's cross-referencing workflow (copying raw names to search his bank portal) shouldn't require navigating to individual transactions. When he's auditing aliases and spots a suspicious raw name, he should be able to copy it right there and check his bank statement. This is a small addition (click-to-copy on the raw name text, same pattern as transaction detail) with high utility.

### Decision 5: Raw names display in full on alias page, truncated on import table

**Choice:** Context-dependent display — full on alias page, truncated at 60 characters with tooltip on import staging table.

**Reasoning:** Adam wants to see the full ugly string to match against his bank statement, so the alias page matched names panel shows the complete raw name (it wraps naturally since the panel is full-width). On the import staging table, space is tighter with 7 columns, so raw names truncate at 60 characters with the full string available on hover (tooltip). The import table is for spotting mismatches, not reading every character — Adam can copy the full string or check the alias page for full details.

### Decision 6: Retroactive updates include pre-feature transactions via name-field matching

**Choice:** Yes — when an exact-match rule is created, also attempt to match older transactions (without stored raw names) by comparing the rule's raw string against their current `name` field.

**Reasoning:** Adam has existing transaction history and wants corrections to be comprehensive. Transactions imported before this feature have no `raw_merchant_name` stored, but many will have a `name` field that matches a raw bank string (since the current import flow often stores the original or lightly-cleaned string as the name). The system should attempt this match, backfill the `raw_merchant_name` on matched transactions, and apply the alias update. The confirmation dialog should show the total count (both raw-name matches and name-field matches). This is best-effort — it won't catch everything, but it maximizes the value of the feature for Adam's existing data.

---

## Out of Scope

- **Fuzzy / AI-assisted matching** — intelligent suggestions for alias mapping are a future enhancement.
- **Bulk re-processing tool** — a "re-run all aliases against all transactions" feature is not included (individual corrections are retroactive, but a mass reprocessing tool is separate work).
- **Alias merge** — combining two aliases into one (e.g., merging "Google" and "Google Services") is not part of this spec.
- **Multi-bank raw name normalization** — different banks may format the same merchant differently. Handling that is a future phase.
