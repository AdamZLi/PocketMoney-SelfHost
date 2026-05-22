# DESIGN.md — Pocketwise

> The visual constitution for Pocketwise. This document is the **single source of truth** for color, typography, spacing, components, and elevation. All design decisions trace back to here. AI design agents must read this file before producing any UI proposal and cite the tokens they used.
>
> **Authoring source:** Tokens are extracted from `src/index.css` and `tailwind.config.ts`. Atmosphere & voice are informed by [Wise](https://getdesign.md/wise/design-md) (fintech clarity) and [Linear](https://getdesign.md/linear.app/design-md) (data-density discipline) — neither dictates the tokens.
>
> **Last updated:** 2026.5.14

---

## 1. Visual Theme & Atmosphere

**Philosophy:** Trust + Control + Clarity.

Pocketwise is a personal finance reconciliation tool for a power user who wants to *understand* their data, not just see it. The UI must feel:

- **Trustworthy** — clean, professional, never flashy. Money decisions deserve a calm interface.
- **Transparent** — the user can always see *why* the system did something (original merchant names, rule sources, AI confidence). Visual hierarchy never hides data lineage.
- **Dense but legible** — financial work involves tables, lists, and many fields. Density is a feature, not a flaw — but spacing, type weight, and color must work harder to keep the eye organized.
- **Calmly confident** — teal primary signals "this is correct" without shouting. Red is reserved for genuine destructive intent. Amber for "look at this."

**Voice cues borrowed from Wise:** clear, friendly, money-literate. Never use jargon when a plain word works. Never apologize for showing the user a number.

**Density cues borrowed from Linear:** tight type, restrained chrome, every pixel earns its place. But Pocketwise is warmer — system fonts (not Inter Display), softer shadows, light-mode-default.

**Anti-patterns:** crypto-energy gradients, neon accents, oversized hero illustrations, motivational copy ("You're crushing it!"). Pocketwise is a tool, not a coach.

---

## 2. Color Palette & Roles

All colors live as HSL CSS variables in `src/index.css` and are surfaced as Tailwind tokens via `tailwind.config.ts`. **Never hardcode a hex outside this file.**

### Light mode (default)

| Token | HSL | Approx hex | Role |
|---|---|---|---|
| `--background` | `220 20% 98%` | `#f9fafb` | Page canvas |
| `--foreground` | `222 47% 11%` | `#0f172a` | Body text, headings |
| `--card` | `0 0% 100%` | `#ffffff` | Card / surface above background |
| `--card-foreground` | `222 47% 11%` | `#0f172a` | Text on cards |
| `--popover` | `0 0% 100%` | `#ffffff` | Popover / dropdown surface |
| `--primary` | `158 64% 35%` | `#1f9968` | Primary actions, brand teal |
| `--primary-foreground` | `0 0% 100%` | `#ffffff` | Text on primary |
| `--primary-glow` | `158 70% 45%` | `#22c082` | Hover/glow accent for primary |
| `--secondary` | `220 14% 96%` | `#f1f3f5` | Secondary buttons, subtle surfaces |
| `--secondary-foreground` | `222 47% 11%` | `#0f172a` | Text on secondary |
| `--muted` | `220 14% 96%` | `#f1f3f5` | Muted surfaces (chip backgrounds, etc.) |
| `--muted-foreground` | `215 16% 47%` | `#64748b` | Captions, helper text, timestamps |
| `--accent` | `220 14% 94%` | `#e9ecef` | Hover backgrounds, ghost-button hover |
| `--accent-foreground` | `222 47% 11%` | `#0f172a` | Text on accent |
| `--destructive` | `0 84% 55%` | `#ef4444` | Destructive actions, errors |
| `--destructive-foreground` | `0 0% 100%` | `#ffffff` | Text on destructive |
| `--success` | `158 64% 40%` | `#22b075` | Success states (slightly brighter than primary) |
| `--success-foreground` | `0 0% 100%` | `#ffffff` | Text on success |
| `--warning` | `38 92% 50%` | `#f59e0b` | Warning states, "needs attention" |
| `--warning-foreground` | `0 0% 100%` | `#ffffff` | Text on warning |
| `--border` | `220 13% 91%` | `#e4e7eb` | All borders, dividers |
| `--input` | `220 13% 91%` | `#e4e7eb` | Input borders |
| `--ring` | `158 64% 35%` | `#1f9968` | Focus ring (matches primary) |

### AI Trust Scale (domain-specific)

These three tokens are **the most important domain colors in the app.** They communicate AI proposal confidence and have strict usage rules. Never repurpose them for non-AI UI.

| Token | HSL | Approx hex | Confidence range | Usage |
|---|---|---|---|---|
| `--confidence-high` | `158 64% 40%` | `#22b075` | ≥ 0.85 | Auto-acceptable AI proposals; badge background only |
| `--confidence-medium` | `38 92% 50%` | `#f59e0b` | 0.55 – 0.85 | "Review me"; badge background only |
| `--confidence-low` | `0 84% 55%` | `#ef4444` | < 0.55 | "Probably wrong, needs human"; badge background only |

**AI Trust Scale rules:**
- Use only as badge backgrounds, dot indicators, or thin progress bars. **Never on body text** (red text reads as error, not low-confidence).
- Always pair with the numeric confidence value next to the badge. The color is reinforcement, not a substitute for the number.
- Do not introduce a "very high" or "very low" tier. Three is the contract.

### Sidebar (always dark, both modes)

The sidebar is a stable navigation anchor and stays dark regardless of theme.

| Token | HSL | Role |
|---|---|---|
| `--sidebar-background` | `222 47% 11%` | Sidebar canvas (matches light-mode foreground for visual continuity) |
| `--sidebar-foreground` | `220 14% 88%` | Inactive nav text |
| `--sidebar-primary` | `158 70% 45%` | Active nav indicator (brighter teal for dark surface) |
| `--sidebar-primary-foreground` | `0 0% 100%` | Text on sidebar-primary |
| `--sidebar-accent` | `222 33% 17%` | Active nav background, hover background |
| `--sidebar-accent-foreground` | `0 0% 100%` | Text on sidebar-accent |
| `--sidebar-border` | `222 33% 17%` | Sidebar dividers |
| `--sidebar-ring` | `158 70% 45%` | Focus ring inside sidebar |

### Dark mode

Same semantic roles, shifted for a dark canvas. Tokens not listed are inherited from light mode (sidebar-* and confidence-* do not change).

| Token | HSL | Role |
|---|---|---|
| `--background` | `222 47% 7%` | Page canvas |
| `--foreground` | `220 14% 96%` | Body text |
| `--card` | `222 47% 10%` | Card surface (slightly lighter than canvas) |
| `--popover` | `222 47% 10%` | Popover surface |
| `--primary` | `158 70% 45%` | Brighter teal for dark surface contrast |
| `--primary-foreground` | `222 47% 7%` | Dark text on bright teal |
| `--secondary` / `--muted` | `222 33% 15%` | Subtle surfaces |
| `--muted-foreground` | `215 16% 65%` | Captions on dark |
| `--accent` | `222 33% 17%` | Hover background |
| `--destructive` | `0 70% 50%` | Slightly muted red |
| `--border` / `--input` | `222 33% 17%` | Borders, inputs |
| `--ring` | `158 70% 45%` | Focus ring |

### Gradient (used sparingly)

| Token | Value | Allowed usage |
|---|---|---|
| `--gradient-primary` | `linear-gradient(135deg, hsl(158 64% 35%), hsl(180 60% 40%))` | Hero metric backgrounds, brand moments. **Never on buttons or cards** — primary stays flat. |

---

## 3. Typography Rules

**Font stack:** System fonts only. No custom font import. Inherits from Tailwind/browser default: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.

**Font features:** `font-feature-settings: "cv11", "ss01"` is applied globally on `body` for stylistic variants. Do not override.

### Type scale (used in production)

| Role | Tailwind classes | Notes |
|---|---|---|
| Page title (h1) | `text-3xl font-semibold tracking-tight` | Top of every page |
| Section title (h2) | `text-2xl font-semibold leading-none tracking-tight` | Card titles, modal titles |
| Subsection title (h3) | `text-lg font-semibold` | Inside cards |
| Body | `text-sm` | Default for paragraphs, table cells, form descriptions |
| Body emphasis | `text-sm font-medium` | Labels, names, primary table column |
| Strong emphasis | `text-sm font-semibold` | Active states, selected items |
| Caption / helper | `text-xs text-muted-foreground` | Form labels, timestamps, secondary metadata |
| Eyebrow / section label | `text-[11px] font-semibold uppercase tracking-wider text-muted-foreground` | Above-section labels (e.g., "THIS MONTH") |
| Metric (large number) | `text-2xl xl:text-3xl font-semibold` | Dashboard stat cards, totals |
| Code / monospace | `font-mono text-xs` | Raw merchant names, debug values |

**Rules:**
- **One eyebrow per section.** Don't stack eyebrow above a title; pick one.
- **Numerals are tabular by default in metric contexts** — use `tabular-nums` Tailwind class on any number that appears in a table or stat card so columns align.
- **Never use italic for emphasis.** Use `font-medium` or `font-semibold` instead.
- **Line-height:** rely on Tailwind defaults. Override only for headings (`leading-none` on tight stat cards) or long-form copy (`leading-relaxed` for review summaries).

---

## 4. Component Stylings

Pocketwise uses [shadcn/ui](https://ui.shadcn.com/) components in `src/components/ui/`. The patterns below are the **canonical configurations** — engineers should not invent new variants without updating this document.

### Button (`src/components/ui/button.tsx`)

| Variant | When to use |
|---|---|
| `default` (primary teal) | The single most-important action on a screen. Max one per visible region. |
| `secondary` | Equally-weighted alternative actions (e.g., "Save and add another"). |
| `outline` | Tertiary actions, table-row actions. |
| `ghost` | Icon buttons, low-emphasis actions, table-cell actions. Most table actions are `variant="ghost" size="sm"`. |
| `destructive` | Delete, remove, irreversible. Always paired with a confirm step. |
| `link` | Inline navigation that looks like text. Rare. |

**Sizes:** `default` (h-10), `sm` (h-9), `lg` (h-11), `icon` (h-10 w-10). Touch targets stay ≥ 40px.

**Hover states:** Already defined in the component. Do not override per-page.

### Card (`src/components/ui/card.tsx`)

**Canonical pattern:**

```tsx
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Optional</CardDescription>
  </CardHeader>
  <CardContent>...</CardContent>
</Card>
```

**Padding rule:** Use the default `CardHeader` (`p-6`) and `CardContent` (`p-6 pt-0`) padding. **Do not override** with custom `p-4`/`pb-2`/`pt-0` combinations on individual cards. If you find yourself reaching for an override, the card itself is wrong (too big, too small, or you're nesting where you shouldn't).

**Shadow:** Default `shadow-sm` (which maps to `--shadow-card`). Do not add additional shadows to cards.

**Border-radius:** `rounded-lg` (10px, the `--radius` default). Do not change.

### Table (`src/components/ui/table.tsx`)

- Body text: `text-sm`
- Row hover: `hover:bg-muted/50` (built-in)
- Row borders: bottom-only via `[&_tr]:border-b` (built-in)
- Numeric columns: add `text-right tabular-nums`
- Action columns: `variant="ghost" size="sm"` buttons in the rightmost cell
- **Density:** Pocketwise tables are dense by design — never add extra row padding for "breathing room"

### Sheet (right-rail editor — `src/components/ui/sheet.tsx`)

**Canonical pattern** (used by `TransactionEditSheet`):
- Position: `fixed top-0 right-0 z-40 h-screen`
- Width: `w-full sm:max-w-md`
- Border: `border-l`
- Background: solid `bg-background`
- Shadow: `shadow-xl` (modal-sheet tier — see §6)
- Animation: `slide-in-from-right duration-200`
- Header: title + close button at top-right

Sheets are for editing a single entity. For multi-step flows, use a Dialog instead.

### Dialog

Same shadow tier as Sheet (`shadow-xl`) but centered. Use for confirmations and multi-step flows.

### Input + Label

- Label: `text-xs text-muted-foreground` above the input
- Input: standard shadcn (`border`, `rounded-md`, `h-10`)
- Spacing between label and input: `space-y-1.5`
- Multi-field forms: `grid grid-cols-2 gap-3`

### Badge

Used for status, source, and confidence indicators.

| Variant | Use |
|---|---|
| `outline` | Source labels (e.g., "rule", "AI", "manual") |
| `secondary` | Inactive / informational state |
| Confidence badge | Background = `--confidence-{high/med/low}`, foreground = white, always paired with the numeric confidence next to it |

### Sidebar nav item (`src/components/AppLayout.tsx` + `NavLink.tsx`)

**Canonical states:**

| State | Treatment |
|---|---|
| Default | `text-sidebar-foreground`, no background |
| Hover | `bg-sidebar-accent` |
| **Active (current route)** | `bg-sidebar-accent` + `border-l-2 border-sidebar-primary` + `text-white` |
| Focus | Default focus ring (`ring-sidebar-ring`) |

> **Note:** As of this writing, the active state is *not yet implemented* in `AppLayout.tsx`. This is the canonical pattern for when it's added — designs proposing sidebar changes must use it.

### Confidence Badge (composite, app-specific)

```
┌─────────────────────┐
│ [● High]  0.92      │   ● = colored dot using --confidence-high
└─────────────────────┘
```

Always: dot/pill (color) + numeric value (foreground text). Never the dot alone.

---

## 5. Layout Principles

### Spacing scale

Use Tailwind's default scale, but constrain yourself to these values for layout work:

| Token | Pixels | Use |
|---|---|---|
| `1` | 4 | Inline icon-text gap |
| `2` | 8 | Tight list items, badge interior |
| `3` | 12 | Form-field inner spacing |
| `4` | 16 | Compact card content, dense grid gap |
| `6` | 24 | Standard card padding, standard grid gap, page section spacing |
| `8` | 32 | Generous page padding (xl breakpoint), page section spacing |

**Avoid `5`, `7`, `9`, `10` for layout.** They create magic numbers that are hard to reason about.

### Grid & containers

- **Page max width:** `max-w-6xl` (1024px) with `mx-auto`. The app is for focused work, not spreading content edge-to-edge.
- **Page padding:** `p-6 xl:p-8` (24px → 32px at xl).
- **Section gap:** `space-y-6` between major sections within a page.
- **Metric grid:** `grid grid-cols-1 sm:grid-cols-3 gap-6`.
- **Form grid:** `grid grid-cols-2 gap-3` for two-column forms; single column otherwise.

### Sidebar

- Expanded width: **200px**
- Collapsed (icon-only) width: **48px**
- Auto-collapse breakpoint: **1280px (`xl`)**
- Sticky, full viewport height
- Background: `bg-sidebar` (always dark)

### Border-radius hierarchy (semantic)

Avoid choosing radii by feel. Use these four:

| Class | Value | Use |
|---|---|---|
| `rounded-sm` | 6px | Small tags, dense badges |
| `rounded-md` | 8px | Inputs, table-cell controls, secondary buttons |
| `rounded-lg` | 10px (`--radius`) | Cards, dialogs, sheets, primary buttons |
| `rounded-full` | — | Status dots, avatars, pill filters in Trends |

**Do not use `rounded-xl`, `rounded-2xl`, etc.** They were used inconsistently in early code and should be migrated to `rounded-lg` over time.

---

## 6. Depth & Elevation

Pocketwise has **four semantic elevation tiers.** Pick the tier by what the element *is*, not by visual weight.

| Tier | Tailwind | Source token | Backdrop | Use |
|---|---|---|---|---|
| **Card** | `shadow-sm` | `--shadow-card` | none | All cards, all stat tiles |
| **Popover** | `shadow-md` | (default) | none | Comboboxes, dropdowns, command palettes |
| **Floating panel** | `shadow-lg` | (default) | `bg-background/95 backdrop-blur` | Tooltips, hover charts, undo/redo notifications, transient overlays |
| **Modal / Sheet** | `shadow-xl` | (default) | solid `bg-background` over `bg-black/30` overlay | Dialogs, sheets, full editors |

**Rules:**
- **Solid background = blocks interaction.** Sheets and dialogs are solid because the user must address them.
- **Translucent + blur = transient.** Tooltips and undo bars are blurry because they're temporary and the user should still feel context behind them.
- **Never invent a fifth tier** ("shadow-2xl"). If a design seems to need one, the visual hierarchy is wrong elsewhere.
- **Do not stack shadows.** Cards inside cards do not get a second shadow.

---

## 7. Do's and Don'ts

### Do
- ✅ Cite this DESIGN.md when proposing any new component or visual treatment.
- ✅ Use `tabular-nums` on every number that appears in a list or table.
- ✅ Show the original merchant name alongside the cleaned name. Data lineage is a feature.
- ✅ Pair confidence badges with the numeric confidence value.
- ✅ Use `--primary` (teal) for the single most-important action on a screen.
- ✅ Use `--warning` (amber) for "this needs your attention but isn't broken."
- ✅ Default to light mode; verify dark mode works without re-testing.
- ✅ Keep page max-width at `max-w-6xl` for new pages.

### Don't
- ❌ Don't introduce a new color, shadow, or radius value. Use what's in §2, §5, §6.
- ❌ Don't use `--destructive` (red) for anything except destructive actions. Errors get destructive; warnings get warning.
- ❌ Don't use confidence colors on body text — only as backgrounds for badges/dots.
- ❌ Don't override `CardHeader` / `CardContent` padding ad-hoc. If the default doesn't fit, the card itself is wrong.
- ❌ Don't use `rounded-xl` or `rounded-2xl`. Use the four-tier hierarchy in §5.
- ❌ Don't add motion beyond what shadcn provides (slide-in for sheets, fade for dialogs). Pocketwise is calm.
- ❌ Don't write motivational copy. The user is doing serious financial work.
- ❌ Don't introduce a custom font. System stack stays.
- ❌ Don't use the gradient on buttons or cards. Hero metrics only.

---

## 8. Responsive Behavior

**Breakpoints actively used:**

| Token | Min width | Use |
|---|---|---|
| (mobile-first) | 0 | Default styles |
| `sm` | 640px | Show secondary columns; sidebar still collapsed |
| `lg` | 1024px | Multi-column metric grids enabled |
| `xl` | 1280px | Sidebar auto-expands; page padding bumps to `p-8`; metric type bumps to `text-3xl` |

**Touch targets:** minimum 40px (`h-10`). All buttons and clickable rows already meet this.

**Table collapse:** Tables in narrow viewports use the responsive-graceful-collapse pattern (see `docs/features/2026.5.11-responsive-graceful-collapse/`). Designs proposing new tables must specify which columns drop at which breakpoint.

**Sheet on mobile:** Sheets become full-width (`w-full`) on mobile, `sm:max-w-md` from `sm` up.

**Sidebar on mobile:** Always collapsed to icon-only (48px) below `xl`.

---

## 9. Agent Prompt Guide

### Quick-reference card (for AI agents)

- **Primary action color:** `bg-primary text-primary-foreground` (teal)
- **Page surface:** `bg-background`
- **Card surface:** `bg-card` with `shadow-sm` and `rounded-lg`
- **Body text:** `text-foreground` at `text-sm`
- **Muted text:** `text-muted-foreground` at `text-xs`
- **Page padding:** `p-6 xl:p-8`
- **Page max width:** `max-w-6xl mx-auto`
- **Section spacing:** `space-y-6`
- **Confidence colors:** `bg-confidence-high|medium|low` (badges only)

### Mandatory pre-design prompt (for the `ui-ux-designer` agent)

Apply this silently before producing any design:

> Use Pocketwise tokens from `DESIGN.md` as the source of truth for all visual decisions. Cite every token used in a Section 0 "Visual Tokens Used" block at the top of the design document. Do not invent new colors, shadows, or radii. If a needed token doesn't exist, propose its addition as an Open Design Question — never silently introduce it. Match the canonical component patterns in §4. Default to light mode but verify the design works in dark mode by checking that all tokens used have dark-mode equivalents in §2.

### When the user says "design like X"

If the user references a brand by name (e.g., "make this feel like Linear"), the agent reads the brand file from the local catalog at `~/.copilot/design-catalog/<brand>.md`, borrows that brand's *atmosphere and structure* — but Pocketwise's tokens still win. Cite the borrowed elements explicitly in the design doc's Visual Tokens Used section ("borrowing Linear's table density approach; tokens remain Pocketwise").

For aesthetic-by-description ("dense and dark and warm"), the agent uses `~/.copilot/design-catalog/BRANDS.md` (axis matrix) to suggest 2–3 catalog matches and asks the user to pick.

Adopting a brand's *actual* colors/fonts is a Layer 1 change to this DESIGN.md, not a per-design tweak. Don't let the agent silently swap tokens.
