# Rise — Design System

Identity target: **calm, premium, warm.** Black text. Native-quality craft with an
independent product identity — a screen must never read as "iOS Settings with different
words on it."

Reference inspiration is Monarch's *information architecture*, explicitly **not** its
surface treatment. Monarch wraps everything in white rounded cards on grey, giving every
element identical visual weight and no hierarchy. Rise does not.

## 1. Colour tokens

```css
:root {
  --ink:          #191C16;  /* body text — near-black with a green cast */
  --ink-muted:    #5C6157;  /* secondary text */
  --ink-faint:    #8A8F84;  /* tertiary, timestamps */

  --canvas:       #FAFAF7;  /* app background — WARM off-white, never #F2F2F7 */
  --surface:      #FFFFFF;  /* raised content */
  --hairline:     #E6E7E1;  /* dividers */

  --sage-700:     #4A6142;  /* pressed, emphasis text */
  --sage-600:     #5F7A55;  /* primary actions — 4.9:1 on white */
  --sage-300:     #A8BC9F;  /* fills, inactive rail */
  --sage-100:     #EDF1EA;  /* selected states, tints */

  --gold:         #C9A24D;  /* accent + data-viz ONLY — 2.4:1, NEVER text */
  --gold-text:    #8A6D22;  /* when gold must carry words — 5.2:1 */
  --gold-100:     #F7F0DE;

  --clay:         #A8563C;  /* overspend / carried deficit — NOT red */
  --clay-100:     #F6E7E1;
}
```

**Two hard rules:**

1. `--gold` never carries text. Use `--gold-text`.
2. **Overspend is `--clay`, never red.** The product's thesis is that going over is a debt
   you carry, not a failure. Full-saturation red contradicts the model, and red against a
   sage-green primary reads as a system error.

**Money direction is carried by sign, position, and weight first** — colour only reinforces.
Never encode direction in colour alone: the primary brand colour is already green.

Dark mode is out of scope for v1. When added, redefine tokens under
`@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`.

## 2. Typography

| Role | Family | Notes |
|---|---|---|
| UI, labels, body | **Inter** | |
| Hero numbers, section headers | **Fraunces** | Warm serif — the single highest-leverage identity move |

**Every monetary figure uses tabular figures.** `font-variant-numeric: tabular-nums`.
No exceptions — misaligned decimal points read as amateur instantly.

```
display   Fraunces 40/44  -0.02em   hero balances
title     Fraunces 24/28  -0.01em   section headers, page titles
body      Inter    16/24            default
label     Inter    13/16   +0.02em  uppercase row labels
caption   Inter    12/16            timestamps, staleness
money-lg  Fraunces 32/36  tabular
money     Inter    16/24  tabular   semibold in rows
```

## 3. Shape & space

- Spacing unit **4px**. All spacing is a multiple.
- Radii: cards `12px`, buttons `10px`, inputs `8px`, pills `999px`. One rule, applied consistently.
- Minimum touch target **44×44**.
- Side gutter **16px** on phone, **24px** on desktop.
- Elevation: a single soft shadow `0 1px 2px rgba(25,28,22,.06), 0 4px 12px rgba(25,28,22,.04)`.
  Used sparingly — most grouping is hairlines and typography, not cards.

**Anti-patterns — do not ship these:**

- Grouped-list "Settings" screens as a default layout
- Grey background + white rounded card around every group
- Large-title-plus-list on every screen
- A card wrapped around every stray number
- Default platform accent blue
- Gradients, glassmorphism, or decorative shapes used to "look different"

Identity comes from composition — typography, colour relationships, spacing rhythm,
information hierarchy — not decoration.

## 4. Navigation

Four bottom tabs. **No hamburger drawer.** Monarch runs both a drawer of 12 items and a tab
bar; for a single user most of that drawer is settings.

```
Dashboard      Accounts        Transactions      Budget
this month     net worth       search            the rail
+ reports      + accounts      + filters         + reallocation
  (scrolls in)  + goals         + rules            + recurring
```

Everything else — Categories, Merchants, Rules, Institutions, Preferences — lives behind a
single avatar control top-right.

**Depth limit: two pushes from a tab.** Beyond that, use a sheet or a filtered list.
**The back control always names its origin** — `‹ Budget`, `‹ Gas`, `‹ USAA Checking` —
never a bare arrow.

## 5. The five-zone detail template

Every detail page — account, transaction, category, merchant, goal, recurring bill — uses
this scaffold. **Zones may be omitted; they are never reordered.**

```
┌──────────────────────────────────────────┐
│ ‹ Budget      Gas                    Edit│  1 HEADER   back w/ origin, title, ONE action
├──────────────────────────────────────────┤
│ AVAILABLE THIS MONTH                     │  2 IDENTITY the number this page is about
│ −$93                                     │             hero, left-aligned, never a chart
│ $250 allocated · $343 spent              │             context line
├──────────────────────────────────────────┤
│ [ chart ]                                │  3 SHAPE    optional; one component,
│ 1M  3M  6M  YTD  1Y  ALL                 │             one control set everywhere
├──────────────────────────────────────────┤
│ Rollover policy      Carries forward  ›  │  4 FACTS    label/value rows
│ Carried in                   $0          │
├──────────────────────────────────────────┤
│ Transactions (14)                        │  5 RELATED  children, capped
│  …first five…                            │
│ All 14 transactions                   ›  │             a ROW, not a button
├──────────────────────────────────────────┤
│ Manage                                   │  6 MANAGE   destructive/rare, last, separated
│ Forgive carried deficit                  │
└──────────────────────────────────────────┘
```

**The identity contract:** the hero is always *the number this page is about*, in the same
position and type treatment. Account → current balance. Transaction → amount. Category →
available this month. Goal → amount remaining.

### 5.1 Row types — exactly three, visually distinct

```
Original Statement     Walmart Supercenter      STATIC  — no affordance
Planned                        [ $250 ]         EDIT    — bordered field, edits in place
Merchant                       Walmart  ›       NAV     — chevron, pushes a page
```

No blue link text. No chevron that edits instead of navigating. A user must be able to tell
what a row does from across the room.

The `EDIT` field is the **same component** as the budget row's planned-amount box. That
shared component is what makes the detail page feel related to the budget list.

### 5.2 Action placement

- **Primary action** → header, right. One only, or none.
- **Navigation** → a row with a chevron. Never a full-width button.
- **Destructive / state-changing** → the Manage zone, in `--clay`, behind a confirm that
  names the consequence. "Forgive carried deficit" tells you it concerns money;
  "Reset Rollover" does not.

## 6. The budget rail — the signature component

Not a progress bar. Three segments plus one marker.

```
Eating Out                              −$40 ▸ $260 available
├── carried ──┼──────── allocated ────────────────┤
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░┊░░░░░░░░░░░
   spent $182                           ┊ pace tick
```

- Rail width = `carried_in + planned`.
- The carried segment is tinted distinctly — `--clay-100` when negative, `--sage-100` when
  positive — so a category starting underwater visibly starts underwater.
- Spent fills left→right in `--sage-600`, switching to `--clay` past `available`.
- The pace tick rides on top at `pace_fraction`, respecting `spend_shape` (a `fixed`
  category shows no linear tick — see SPEC §2.7).

**Three encodings and one marker is the ceiling.** Do not also put the rollover icon and
the carried-in number inside the rail; they live in the row's text.

## 7. Charts

One chart component, one control set. Line for value-over-time, bars for period comparison,
but identical height, identical range-chip row, identical axis treatment.

- Categorical series: `--sage-600`, `--gold`, `--clay`, `--sage-300` in that order.
- Gridlines `--hairline`, no chart borders, no chart junk.
- **Never show a percentage change over a window shorter than three months** — short-window
  percentages on a volatile base are noise.
- Interpolated net-worth segments (between manual snapshots) render **dashed**. Never draw
  inferred data as measured.

## 8. States

Every list and screen needs all four designed, not just the happy path:

| State | Requirement |
|---|---|
| Loading | Skeleton matching final layout. No spinners on full screens. |
| Empty | A designed default state, not a sentence explaining emptiness. |
| Error | What failed, and the one action that fixes it. |
| Stale | Explicit: "Apple Card last synced Sep 1 — 22 days not yet counted." |

## 9. Two tests before any screen is called done

1. **Generic-UI test** — strip the logo and content. Could this pass as a first-party
   platform app? If yes, change composition, hierarchy, typography, or density — not just
   the accent colour.
2. **Screenshot test** — could this be identified as Rise from a screenshot alone, no logo?
   If not, the identity is not strong enough yet.
