# Rise — UX behaviour guide

How the app *feels and operates*, written so another installable PWA can copy it. No colours,
fonts or theme tokens (see `DESIGN-SYSTEM.md`). Money rules and logic live in `SPEC.md`, which
wins on conflict.

- **Part I: the portable kit.** Reusable interaction patterns with exact thresholds, timings
  and the reasoning behind them. Nothing here is budget-specific. Lift it whole.
- **Part II: Rise screens.** How the kit is applied, screen by screen.
- **Part III: porting checklist and dead ends.**

Numbers are the shipped values. Where a number was tuned on a real device, it says so.

**Feel in one line:** calm, quick, forgiving. The common action is one tap; every action is
undoable for a moment; nothing consequential happens without the person seeing it; the app
never lies about how fresh its data is.

---

# Part I — The portable kit

## 1. Principles

1. **One tap for the common case.** Show the best guess; confirming it is one tap.
2. **Forgiving by default.** Reversible actions apply instantly and wait behind Undo (§9).
3. **Choosing is not committing.** Picking a value stages it; a separate, visible confirm applies it.
4. **Consequential actions name their consequence** ("Forgive $93", "Delete erases history") and
   live in a separated Manage area, never next to routine controls.
5. **Honest data.** Stale, estimated, offline and inferred data says so, quietly, in place.
6. **Same thing, same place, same component.** One sheet, one chart, one amount field, one detail
   scaffold, one chip row.
7. **Quiet copy.** No captions that restate a label. Keep text only if it names a destructive
   consequence, states a fact visible nowhere else, or is a needed empty state.
8. **Nothing zooms, nothing bounces.** Fixed-scale page; only opted-in charts zoom.
9. **Deterministic back.** Back always goes somewhere predictable and names it.

## 2. App shell and viewport (installed phone app)

- **Display mode standalone.** Detect with `navigator.standalone === true` or
  `matchMedia('(display-mode: standalone)')`; add a root class (`app-full`) *before first paint*
  from a non-inline script file (so CSP can forbid inline script). The same script applies a
  pinned light/dark theme before paint to avoid a flash.
- **Layout:** `html/body/#root` fill the screen (100%); the page is a flex column: sticky title
  bar, one scroll container (`#app-scroll`), tab bar as the **last flex item** (not fixed, not
  sticky). Reason: iOS can strand a fixed bar mid-screen after a long session, and the installed
  window reports one status-bar shorter than the screen unless the *document itself* is
  screen-tall. Never cap html/body at window height. Size from `screen` dimensions per
  orientation and keep the tallest window seen.
- **Status bar:** solid theme colour, no translucent mode (it fogs on iOS 26). Keep a sticky or
  fixed title bar touching the top edge at all times (including during transitions) or iOS fades
  the status bar.
- **Safe areas:** top padding floor 0 in the installed app; bottom padding `env(safe-area-inset-bottom)`.
- **Overscroll:** `overscroll-behavior: none`; only the inner scroller scrolls, so there is no
  rubber-band of the chrome.
- **Splash:** a static splash in the HTML covers parse/execute; React fades it out once mounted,
  held for a minimum visible time so it never flashes.
- **Updates:** auto-updating service worker, shell precached, SPA fallback excluded for `/api`.
  After a deploy the installed app may need a full close/reopen to pick up new HTML; show the
  running version in Settings, and serve a `no-store` version file.
- **Badge:** the home-screen badge follows the one number that matters (items awaiting review),
  set by push payload and cleared at zero.

## 3. Navigation model

- **Four bottom tabs** on phone. Each tab root has a menu button (top-left) that opens a drawer
  with everything else. Pushed screens replace the menu button with a **named back control**.
- **Depth limit: two pushes** from a tab. Past that use a sheet or a filtered list.
- **Tab switch = replace history**, not push. A back swipe on a tab root has nowhere to go.
- **Tab root traps back:** on a tab root a copy of the screen is pushed behind it so back lands on
  itself; re-applied on every landing and on `popstate`.
- **Re-tapping the active tab** smooth-scrolls it to top.
- **Back names its origin** (`‹ Budget`, `‹ Review`). Origin travels in the URL as
  `?from=Label|/path`; only same-app paths are accepted, split on the first `|`, nested `?from=`
  allowed so chains retrace. A back link tagged `data-transition="back"` is a pop even if its
  target is a push route.
- **Going back replaces** the history entry, so repeated back swipes never re-walk screens.
- **Scroll memory:** back to a screen restores its scroll offset (waits for data to grow the
  page); every other arrival starts at top.
- **Filters and month/period selection live in the URL** (`?m=`, search params): shareable,
  back-safe, reload-safe.
- **Link interception:** one global click handler turns in-app links into push/pop transitions
  (modifier-clicks, `target`, downloads and external links excluded). New screens can't forget.

### Desktop (≥ 64rem)
- Persistent **sidebar** (fixed, ~18rem): wordmark, tabs, divider, the full menu list, Settings at
  the foot. No drawer, no bottom bar; sidebar items min-height 44/40px.
- Content column centred at reading width; gutters 16px phone / 24px desktop.
- **Master/detail instead of push:** a list opens its detail in a panel beside it (`?category=`),
  "Close" clears the param.
- Lists become **tables** with in-place editing.
- Document scrolls (not an inner container); transitions use the browser View Transitions API.
- Keyboard shortcuts on the primary queue (§7).

## 4. Gestures

| Gesture | Where | Rule |
|---|---|---|
| Swipe right from left 40% | Pushed screen | Back. >80px horizontal and dx > 2×dy. |
| Swipe right from left 40% | Tab root | Opens the menu drawer (same thresholds). |
| Swipe left >50px | Open drawer | Closes it. |
| Swipe right / left on a row | Review queue | Confirm guess / open picker. 80px, ignored if mostly vertical. |
| Drag down on sheet header | Sheet | Follows finger; closes past ⅓ of height or flick (>0.6 px/ms and >40px); else springs back. |
| Press and drag | Charts | Scrub (§11). |
| Pinch / wheel / drag / double-tap | Opted-in charts only | Zoom / pan / reset. |
| Grip drag | Reorder lists | Only the six-dot grip starts a drag (§8). |

Rules that make gestures reliable:
- **Block native gestures:** cancel `gesturestart/change/end` and multi-touch `touchmove`
  everywhere except `[data-zoomable]`.
- **Kill iOS's own edge back:** cancel `touchstart` in the left 20px strip (except inputs and
  zoomables) and re-dispatch a tap there as a click if the finger moved <10px.
- Swipes are ignored on `[data-zoomable]`, `[data-no-swipe]`, inputs/textareas and dialogs.
- Passive listeners everywhere except where cancelling is the point.

## 5. Motion

One clock for the whole app.

| Token | Value | Used for |
|---|---|---|
| ease | `cubic-bezier(0.4, 0, 0.2, 1)` | sheets, drawer, backdrops |
| in | 500 ms | sheet rise, drawer open, fade-in |
| out | 400 ms | sheet drop, drawer close, backdrop fade |
| slide | 300 ms `cubic-bezier(0.3, 0.2, 0.5, 1)` | push/pop (copied from a recorded native iOS push) |

- **Push/pop, installed phone app:** do *not* use view transitions (the page becomes a snapshot
  and iOS fogs the status bar). Instead: clone the outgoing screen into inert (`aria-hidden`,
  `inert`) ghosts pinned over the same rect, commit the route synchronously (`flushSync`),
  measure the title/back-arrow geometry, then run CSS animations. Content slides in from the
  right while the old content goes left a quarter-width and dims; back is the mirror. Ghosts are
  removed ~400 ms later. Re-entrancy: a slide in flight restarts cleanly.
  - Header rules: content keeps its slide; only the header changes; buttons cross-fade in place;
    titles slide **and** fade in lockstep with their page (old title gone by ~57%, new title
    opacity ≈ progress²); the back arrow emerges from the old title's left edge
    (direction-aware measured shift).
  - Router gotcha: disable the router's transition-wrapped navigation, or the commit lands late
    and the slide starts on the old screen.
  - Lazy-loaded screens must be preloaded so the first sliding frame shows the destination.
- **Wide screens / browsers:** View Transitions API with direction attribute.
- **Reduced motion / unsupported:** plain navigation, no animation.
- **Sheets/drawer** share the same in/out tokens so nothing snaps faster than its neighbour.
- Small pop-in (menus), indeterminate bar (floating progress), shake (wrong PIN), caret blink
  (custom keypad amount).
- Collapsing/filed rows animate closed rather than vanishing.

## 6. Sheets, menus, modals

**Bottom sheet** (the way past the depth limit):
- Rises from bottom (500 ms), drops on close (400 ms) — including when the caller unmounts it
  (a `Leaving` wrapper keeps the last render alive long enough to slide out).
- Header grid `left · title · right`. Plain sheets: ✕. **Form sheets** (anything that changes
  something): `Cancel · Title · Save`, always the same place. A sheet-internal page turns the
  left slot into `‹` back.
- Optional **pinned footer** (e.g. `Clear all · Apply`) flush with the bottom edge.
- Max height ~92% of the visible area (visual viewport, minus keyboard).
- Dismiss: **Esc**, **tap the dim**, **drag the header down**. Page behind is scroll-locked.
- Opening from inside a sheet is counted (scroll lock is reference-counted).
- **Full-page variant** for amount entry: fills the visible area above the keyboard so pinned
  controls stay reachable.

**Scroll lock** (important on iOS): put `overflow: hidden` on `<html>` and the inner scroller
only; *never* `position: fixed` on body, and never `overflow` on body (both re-layout the page
and lift the tab bar). Cancel `touchmove` unless the target can scroll itself.

**Drawer:** 78% width (max ~320px), dimmed backdrop 40%, closes by dim tap / swipe left / item
tap / Esc. Safe-area aware.

**⋯ overflow menu:** small anchored popover under its button (right-aligned, ~16rem). Focus moves
to the first enabled item on open; closes on outside pointer-down, Esc, or selection. Items are
icon + label + optional hint.

**Confirms** are sheets, not browser dialogs; the destructive button restates the amount/object.

**Toast vs floater:** a toast is only for an undoable action. Background work (sync) uses the
**floater**: a card above the tab bar with text, a progress bar while busy, an X; never blocks;
short result then fades; failures persist until tapped; keeps running if the user navigates away.

## 7. Keyboard and text input

Global rules, installed once, not per screen:
- **Reveal focused field:** after focus, re-check at 0/120/350/700 ms (keyboard animates ~300 ms
  and iOS scrolls on its own). Nudge scrollable ancestors until the field sits inside the visible
  viewport with a 16px margin; if the field is taller than the band, align its top.
- Treat iOS's prev/next/done bar as hidden space (+72px). Publish the keyboard height as a CSS
  variable (`--kb`) that pads the page so short pages can scroll far enough. On blur, restore.
- In the installed app never `scrollBy` the document (it strands the layout); in browsers do.
- **Select all on focus** for number fields (deferred a tick; `setSelectionRange`, fall back to
  `select()`), so typing replaces.
- **Sheets with a primary field open the keyboard with the sheet:** focusing the real field
  during the rise animation makes iOS scroll the page. A stand-in input already on screen takes
  focus inside the tap; focus moves to the real field on `animationend` (fallback timer), keeping
  anything typed meanwhile. Fields opt in with `data-sheet-focus`.
- **Don't autofocus search in a picker** (keyboard mid-slide stutters and can leave the page
  short). Tap to type.
- **Sheets track `visualViewport`** (resize + scroll events + a 150 ms poll, because installed
  iOS skips the events) to cap their height above the keyboard.
- **16px inputs** so iOS doesn't zoom on focus.
- **Enter commits (blur), Escape reverts** in inline fields.
- Hardware keyboard works wherever a custom keypad exists.

**Amount keypad (custom, whole dollars):** digits 0–9 and backspace only, max 7 digits, leading
zeros collapse. Opens with the value *selected* ("fresh"): the first digit replaces, backspace
clears. Add / Remove modes adjust the current value by what you type instead of replacing it.

## 8. Forms, fields, lists

- **Three row types, visually distinct:** *Static* (no affordance), *Edit* (bordered field,
  edits in place), *Nav* (chevron, pushes). No link-styled text; a chevron never edits; a button
  never navigates.
- **The edit field is one component** everywhere. Commit on blur or Enter; unparseable input
  **reverts** and flags invalid rather than guessing. Inside Save-gated forms it reports every
  valid keystroke (tapping Save doesn't blur on iOS and would lose the last edit).
- Number boxes report each readable keystroke; **clamping happens on save, not while typing.**
- **Toggles** are `role=switch`, 50×30; the label is the row's text.
- **Destructive/state-changing** actions: Manage zone, danger style, confirm naming the
  consequence. Close vs Delete are separate with separate confirms.
- **Splits/sums:** typed rows plus an auto-computed last row so the set always sums exactly; a
  new split starts as one typed amount plus "the rest"; overshoot error always shows, other
  errors only once there's something wrong.
- **Reorder:** six-dot grip is the *only* drag start (the grip opts out of scrolling, nothing
  else does). The held row follows the finger, passed rows slide aside, holding near the visible
  top/bottom edge auto-scrolls (accounting for scroll under the finger), drop reports the new id
  order and saves.
- **Select mode:** toggle in the header, tap rows, "Select all" applies to everything the
  current search+filters match (shows Loading… while fetching; becomes Clear).
- **Search:** as you type, debounced; sticky under the title bar.
- **Sticky date/section headings** sit below the sticky title bar and search.

## 9. The act → undo pattern

Used for any frequent, reversible action (filing items).
1. Action hides its rows immediately (optimistic) and shows a bottom toast `Label   Undo`.
2. Nothing is sent for **5 s**. Undo cancels and restores the rows.
3. A new action **flushes** the previous one first (one pending at a time).
4. **Leaving the screen or backgrounding the app flushes**, never drops.
5. Failure restores the rows and shows the server's message; **offline, the change is queued
   on-device and the row stays done.**
6. After a send, invalidate dependent queries (counts, totals).
7. Keyboard: `u` / Ctrl+Z undoes.

## 10. Data states, offline, background

| State | Behaviour |
|---|---|
| Loading | Skeleton shaped like the final layout. No full-screen spinners. |
| Empty | A designed default (title + one line), not a lecture. |
| Error | What failed + the one action that fixes it. |
| Stale | Explicit: names the thing and the gap ("last synced Sep 1, 22 days not counted"); never an estimate. Per-item dismissal is device-local and reappears on a later stale spell. |
| Offline, cached | Top bar: `Offline · showing data from {time} · N changes waiting to send`. |
| Offline, not cached | Skeleton gives up: "This screen isn't saved on this device yet". |
| Reconnecting | `Sending N saved changes…`; retries ~every 30 s. |
| Refresh failed | Quiet `Couldn't refresh · data from {time}`; data stays. |
| Resource limit | Bar explains reads show saved data until reset. |

- **Retry on foreground:** retry stuck queries on `visibilitychange`/`pageshow`, not only `online`
  (iOS suspends fetches in the background and never fires `online`).
- **Never claim "not set up"** from data that isn't known current.
- **Outbox:** only changes safe to apply late are queueable (edits, accepts, links, snapshots).
  Anything needing a decision from the server's reply (creating rules, forgiving, moving planned
  money) requires a connection. Each entry keeps its idempotency key and a human label; replay in
  order; the server replays its answer for a key already applied; Web Locks stop two tabs
  interleaving; a rejected entry is reported with a reason.
- **Auth plumbing:** access token in memory only; refresh token httpOnly cookie; a 401 triggers one
  shared refresh (cross-tab lock) then a single retry.

## 11. Charts

- **One component, one control set:** same height and axis treatment for lines and bars.
  Range chips `1M 3M 6M YTD 1Y ALL` as a radio group below the chart.
- Gridlines hairline, no borders, no chart junk. Anchor value axes at 0 (zoom-to-fit only where a
  balance moves little against its size, e.g. a loan).
- **Inferred ≠ measured:** a segment is dashed if either end is interpolated/held. If the newest
  point is held, name the date it is based on.
- **No percentage change over a window under three months** (of actual history).
- **Scrub:** pointer-down selects the nearest point immediately; move updates; up / leave /
  cancel clears. The read-out sits *inside the top of the chart* (never above, where it would
  cover a headline), centred on the pointer and clamped on-screen; multi-series lists every
  series; an optional extra line per slot. An `aria-live=polite` caption mirrors it.
- **Bar charts:** each bar is a button; tap selects (others fade); tap the selected bar again
  returns to the whole window; arrows step the period. Tooltip pins to the side nearest the bar.
- **Touch-friendly:** tap or drag across bars for per-slot detail; a touch that picked a bar on
  pointer-down must not toggle it back off on click.
- **Zoom** only where marked (`data-zoomable`): pinch/wheel to zoom about the pointer, drag to
  pan once zoomed, double-tap resets. Everything else is fixed-scale.
- **Fan/what-if charts:** touch/drag reads any x; default read-out is the last point; redraw live
  as inputs change.
- **Rail (progress) component:** three segments + one marker, never a plain progress bar
  (carried / allocated / spent fill, plus a pace tick; tick omitted where linear pace is
  meaningless).

## 12. Lock and auth

- **No public signup.** Passkey first; authenticator code and single-use recovery codes as
  fallback (shown once, stored hashed). No email reset.
- **App lock:** Off · Immediately · After 5 min · After 1 hr. The choice is stored server-side but
  mirrored locally so the lock can engage before data loads.
  - Covers the app **the instant it's backgrounded** (app switcher never shows content).
  - Survives reload: once locked, stays locked until unlocked.
  - **Unlock prompts the passkey automatically on open** (like a banking app). If the browser
    refuses without a gesture, stay quiet: the Unlock button is already there.
  - No record of leaving → lock (safe side).
  - Turning it on counts from that moment; it doesn't lock immediately.
- **Offline PIN** (device-local, 4–8 digits, never account auth): salted PBKDF2 hash only; the
  pad **submits on the last digit** (length stored); hardware digits/Backspace work; wrong tries
  counted with a shake; **5 wrong wipes the PIN** so only the passkey unlocks.

## 13. Notifications

- Opt-in **per device**; on iPhone only from the Home Screen app.
- Server decides what's new after each scheduled sync; every notice has a key and is sent once;
  max five per run, the rest wait in-app; a newly subscribed device starts from now.
- Taps focus an existing window and navigate to the notice's URL, else open one.
- Kinds are split into on-by-default (needs attention) and off-by-default (informational).

## 14. Copy tone

- Plain, calm, short sentences. No exclamation marks, no jargon, no blame.
- State outcomes: `Merchant → Category`, `12 confirmed`, `Transfer confirmed`.
- Buttons are verbs naming the object: `Forgive $93`, `Confirm all (12)`.
- Debt framing for overshoot ("Over budget", "carried deficit"), never failure framing.
- Empty states are a title and one line: "All caught up." / "Start with what you spend on."
- Errors: what failed + the one fix. Stale notes: who + how long.
- Dates short (`Sep 23`); times in the person's local time.
- Settings rows lead with their current state as a quiet right-hand value, so the index answers
  questions without opening anything.

## 15. Accessibility

- 44×44 minimum touch targets.
- Controls have accessible names (`Select {item}`, `Range` radio group, step lists).
- `role=status`/`aria-live=polite` for toasts, floaters, offline bar, chart read-outs;
  `role=alert` for lock errors.
- Direction of money carried by sign, position and weight before colour.
- Tabular figures on every number so decimals align.
- Reduced-motion: no animation, plain navigation.
- Hardware-keyboard parity for custom controls.

---

# Part II — Rise screens

## Information architecture
Tabs: **Dashboard · Accounts · Transactions · Budget**. Menu: Surplus, Financial health, Review,
Recurring, Reports, Investments, Categories, Rules, Tags, Settings. Settings and Financial health
are tab-less pushes that go back to the Dashboard. Two-push limit applies.

### Detail-page scaffold (all details)
Zones may be omitted, never reordered:
1. **Header** — `‹ Origin`, title, **one** action (Edit).
2. **Identity** — the number this page is about, hero, left-aligned, never a chart (account →
   balance, transaction → amount, category → available this month).
3. **Shape** — optional chart + range chips.
4. **Facts** — label/value rows.
5. **Related** — first ~5 children then an "All N …" **row**.
6. **Manage** — destructive/rare actions last, separated.

## Dashboard
Surplus → Budget summary → Transactions needing review (a gold call to action that disappears at
zero) → Coming up → net-worth/report tiles. Tiles can be hidden and reordered from a customise
sheet (grip handles, saves on every change). A brand-new install (no accounts) opens the setup
guide once. Stale-account notes are dismissible per account until its next sync. Surplus with no
detected pay schedule shows "Confirm your pay dates" instead of a number. The review count is the
app's only badge.

## Review queue (the daily screen)
Header `‹ Dashboard   Review 46`. Rows grouped by date, newest first, with per-day totals
(money out, transfers excluded; income nets against it).

**Row:** merchant, amount, account, quiet flag caption, and a **chip strip** of one-tap
categories. Best guess shown; ✓ confirms it; tapping the guess opens the picker.
- Chips: merchant's own top categories → what the owner files most → anything, so even week one is
  one tap. Money in leads with income categories. A transfer-like row leads with a
  **Transfer / Card payment** chip.
- **Choosing never files**: a pick is held on the row until ✓ or Confirm all.
- Rows with no real suggestion stay unconfirmed; nothing files to "Other" by default.
- Confidence sizes the control (confident ≥ 0.90 / guess / none).
- **Transfer pairs** are one linked row under the later leg's date; a lone leg shows alone.
- **Splits** one tap away. **Looks fine** clears a quiet flag for good.
- **Always file {merchant} here** toggle in the picker, or a **rule offer sheet** after filing.
  Rules are offered, never created silently.
- Pending charges that never posted get their own section.
- **Picker:** sheet, grouped categories with a Search field (no autofocus), optional Always toggle.

**Undo** per §9 (toast `Chick-fil-A → Eating out · Undo`, 5 s). **Confirm all** (`Confirm all (N)`
when fewer than all rows are confirmable) files every row with a guess or pick plus transfer pairs.
**Empty:** "All caught up." + "Nothing waiting. New charges land here after each sync."

**Desktop keys** (top row is focused; ignored with a sheet open or an input focused):
`Enter` confirm · `o` or `/` picker · `s` split · `t` mark transfer (only when offered) ·
`u`/`Ctrl+Z` undo.

## Budget
- Month header with prev/next (`?m=`); planning up to 12 months ahead; future months look future.
- **Summary tile** (Income/Expenses; tapping opens that section) → **Income** and **Expenses**
  sections with *Planned / Remaining* column labels once per section, fixed-width columns so
  every row and group total aligns.
- **Groups** collapse with one chevron that turns; roll-up totals.
- **Category row:** name, planned (Edit field), remaining, and the rail. Overspend reads as
  "Over budget" debt wording. **Income inverts**: earning past plan is good.
- **Unbudgeted** categories (transfers, card payments, catch-all) never get a budget line;
  budgeted-but-idle categories hide behind "Show N unbudgeted" / "Collapse".
- **Left to budget** pool banner: positive = unassigned, zero = fully planned, negative = "Over
  budget". **Money moved this month** lists reallocations.
- Row tap: phone pushes category detail; desktop opens the side panel.
- First-run empty: "Start with what you spend on."

### Plan editor (tap a planned amount)
Full-height sheet, amount is the hero. `Cancel · {emoji} Name · Save`; **Add / Remove / Set**;
amount opens selected; under it **Remaining** and "Includes +$X carried from {month}"; a
13-month spend bar chart with a dashed average line — **tap a bar or a stat card
("Spent last month", "Monthly average") to fill the amount**; pinned above the keypad is
**"Apply $N to all future months"** (default from settings); custom numeric keypad (§7); Remove
can't exceed the current plan; hardware keyboard types too (Enter saves).

### Category detail
Hero = available this month; month stepper; 12-month spend chart with the viewed month picked
out; facts (rollover policy, carried in); transactions (first few + "All N" row); Manage.
**Forgive deficit** sheet names the amount and asks why. Deleting a category with history is
refused with the reason. Opened from the Dashboard, back says so.

## Transactions
- Search as you type; filters in the URL; **filter sheet** with pinned `Clear all · Apply` and an
  inner Accounts page. **Select mode** per §8. Rows show merchant, amount, account, category,
  badges (pending, flags, tags).
- A list opened from a category/account is a pushed screen with that origin as back.
- Desktop: table with in-place category edit.
- **Detail:** hero amount; category, **splits** (§8), notes, merchant rename (**renames every
  past and future transaction** and says so), transfer pairing (candidates: equal and opposite,
  other account, within 4 days, not already paired), refund → purchase matching. Text commits on
  Enter/blur.

## Accounts
- **Net worth first** (hero + chart + chips), then accounts grouped by kind with per-account
  staleness. A percentage shows only with ≥3 months of real history.
- **Sync** → floater (`Syncing banks…` → short result → fade; failure persists until tapped).
- **Account detail:** balance, history (dashed between reports), facts, manual snapshot entry
  (as-of date); summary edits held until **Save**; changing Kind first re-signs balances.
- Liabilities typed as positive "owed"; a card paid past zero shows a credit.
- **Close** (keeps history in net worth) and **Delete** (erases it) are separate, each confirmed.
  A mistyped manual balance can be removed; the last one can't.
- Loans show a gentle "update it" reminder on the account, never in summaries.

## Reports
One period drives every chart: a single month (arrows or bar tap) or the full 6-month window (tap
the selected bar again, or "6 months"). Cash flow bars (optional cumulative-savings line);
Spending as pie / bar / treemap with top categories and "Everything else"; Summary; **Money flow
Sankey** (the only zoomable chart; overspend inflow "from savings or credit" is a debt flow).

## Surplus (cash to payday)
14-day projected-balance bars above/below a zero line; tap or drag across for that day's items.
Free to move = lowest point − cushion. Card payments are never projected as outflows. Detected
paychecks/bills are **suggestions that count only after being added**; tap a schedule to edit
amount/days/name; Remove deletes, suggestions are dismissed. A hand-added paycheck or bill is
possible for cold starts.

## Settings
An index, not a stock grouped list: each area leads with its current state. Groups **Data** (Bank
sync, Health, Your data), **Budget**, **Preferences** (Alerts, Appearance, Security).
- *Bank sync:* schedule (max 12 runs/day), last-reported times per institution.
- *Budget:* plan-change default, Categories (Income / Expenses / Transfers tabs, drag reorder,
  add via ⋯), Rules (edit = replace), Tags.
- *Alerts:* "Show me" quiet flags, "Push me about" per kind, per-account Deposits vs Any-increase,
  push opt-in per device.
- *Appearance:* Match system / Light / Dark, applied immediately, device-local.
- *Security:* §12 (app lock, offline PIN, passkeys, devices, backup sign-in, recovery codes).
- *Your data:* export, backups, database-use meter, assistant connector.
- *Health:* checks with ok / needs-attention state.
- **First-run guide** ("Set up Rise"): four steps (Connect your banks → Add what doesn't sync →
  Choose your spending cash → Shape your budget), step pills, Skip, each step links to the screen
  that does the work.

## Other planning tools
Debt, Mortgage, Savings, Retirement, Taxes, Investments, Binder, Recurring use the same scaffold:
hero number, one chart with chips, editable facts. History imports never touch the carry chain.

---

# Part III — Porting checklist and dead ends

**Port in this order**
1. Shell + viewport rules (§2) and the single scroll container.
2. Tabs, named back, URL-carried origin and filters (§3).
3. Motion tokens, then sheets, then push/pop (§5–6).
4. Global keyboard handling and the field component (§7–8).
5. Act → undo (§9), then states and offline queue (§10).
6. Gestures with thresholds (§4); chart scrub (§11).
7. Lock/auth (§12) last.

**Dead ends found on a real iPhone — don't retry**
- `100dvh`, `fixed inset-0`, or sizing the shell from window height: the installed window stays a
  status bar short. Size the document from `screen` instead.
- `position: fixed` / `overflow` on body for scroll lock: lifts the tab bar.
- A translucent status bar: fogs under iOS 26; use solid.
- View Transitions for installed-phone push: fogs the status bar during the transition.
- Focusing a field inside a sheet during its rise animation: iOS scrolls the page.
- Relying on `visualViewport` events alone in standalone: they're skipped; poll.
- Relying on `online` to retry after backgrounding: it never fires; retry on foreground.
- A router that wraps navigation in a transition: the slide starts on the old screen.
- Reinstall tests with a stale cached shell: the status-bar meta is read from the cached HTML;
  confirm the running version first.

**Test on device:** paused animation sampling for transitions, 4× CPU throttle, a stubbed
`navigator.standalone`, a virtual WebAuthn authenticator, and a real iPhone for anything touching
viewport, keyboard or status bar.
