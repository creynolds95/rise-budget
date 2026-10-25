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
- **Enter commits (blur)** in every inline field; **Escape reverts** in money fields.
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

Tabs: **Dashboard · Accounts · Transactions · Budget** (phone: bottom bar; desktop: sidebar).
Menu: Surplus, Financial health, Review, Recurring, Reports, Investments, Categories, Rules, Tags,
Settings. Depth map (a test holds the two-push limit):

| Depth 0 (tab roots) | Depth 1 (push) |
|---|---|
| Dashboard, Accounts, Transactions, Budget, Settings | Review, Surplus, Recurring, Financial health (+ its tools), Account detail, Transaction detail, Category detail, a Settings section |

Everything deeper is a sheet. Each tab root shows the tab title bar with **header actions** on the
right (each screen registers its own); a pushed screen shows its own bar: `‹ Origin · Title ·
(action)`, three-column grid so the title stays centred. Settings and Financial health show the
tab bar styling with `‹ Dashboard`.

### Detail-page scaffold (every detail page)
Zones may be omitted, never reordered:
1. **Header**: `‹ Origin`, title, **one** action (Edit pencil, or a ⋯ menu).
2. **Identity**: the number this page is about, hero, left-aligned, never a chart. Account →
   balance (label becomes *Owed* / *Credit* for liabilities) · Transaction → amount (label *Spent*,
   *Money in*, or *Transfer*, with a status word: *Pending*, *To review*, *Never posted*) · Category
   → *Available this month*.
3. **Shape**: optional chart + range chips.
4. **Facts**: label/value rows (static / edit / nav, §8).
5. **Related**: first ~5 children then an "All N transactions" **row** (shows `N+` while more pages
   exist).
6. **Manage**: destructive/rare actions last, separated.

## Sign-in

- **Login:** the wordmark, then one primary button **Sign in with passkey** and a quiet **Use a
  code instead**. The code form asks Email + Authenticator code (numeric keypad, one-time-code
  autofill); a quiet toggle swaps to **Recovery code**; a quiet **Passkey** link returns. Errors
  appear in an alert line below ("You weren't signed in."). Success replaces history with `/`.
- **Register** (one-time link, token in the URL hash so it never reaches a server log): the
  wordmark and **Create passkey**. A missing token says "This link is missing its token. Ask for a
  new one." After creating, it signs in straight away; if that second step fails the passkey
  already exists and the link is spent, so it just goes home.
- Vertically centred, narrow column, no marketing copy.

## Dashboard

- Header action: a **sliders** button → Customize sheet. Top of page can carry health notes (sync,
  backups, usage) and stale-account notes, both **dismissible here** (device-local, per account
  until its next sync).
- Tiles in saved order (all hideable/reorderable). **Default on:** Review transactions, Surplus,
  Budget, Spending trend, Where it went, Transactions, Net worth, Recurring transactions.
  **Default off:** Investments, Savings goals, Retirement, Debt payoff, Mortgage payoff schedule,
  Mortgage this year. Tiles with nothing to say render nothing (Review at zero, Coming up empty).
- **Review tile:** up to two gold rows with a left accent: "N transactions to review" → Review,
  "N to review in Surplus" → Surplus (anchor `#review`). Singular/plural handled.
- **Surplus tile:** big number (whole dollars) or "Confirm your pay dates"; whole card is a link.
- **Budget tile:** the same Summary card as the Budget tab; whole card is a link.
- **Transactions tile:** the 4 most recent as rows (empty: "No transactions yet."), then a
  "Most recent" nav row to the tab.
- **Net worth tile:** same chart as Accounts; the whole tile is a link *except* the range chips.
- **Coming up:** this month's expected bills with date and category, plus missed/broken bills.
- A brand-new install (no accounts) replaces `/` with `/welcome` once.
- **Customize sheet:** a list of every tile with a grip handle (aria "Drag X to reorder"), its name
  and a toggle. Reorder and toggle both save immediately; hidden tiles sort after shown ones.

## Review queue (the daily screen)

Bar: `‹ Dashboard · Needs review`. Desktop (md+) shows a one-line key hint under it: "Keys for the
top row: Enter confirms · O other · S split · T transfer · U undo". Rows are grouped by **date,
newest first** (small label per day), each day a card; per-day totals are computed (money out,
transfers excluded) for the grouping model. A filed row **collapses** (200 ms height + opacity)
rather than vanishing; a day collapses when its last row goes.

**Row** (a card row with a hairline between):
- Line 1: optional category emoji, merchant name, badges, and the amount at the right; line 2:
  account name. Tapping this line opens the transaction (back returns to Review). **Pending rows
  are italic.**
- Line 3 (actions): a wide **category button** showing the guess and a chevron; tapping it opens
  the picker. Then optional quiet text buttons and the round **✓ confirm** (28px mark in a 44px
  target; pressed state fills it).
  - Guess shown as the category name; a *guess* (mid-confidence) shows in the warm accent text
    with a trailing **?**; *none* shows "Choose a category" and has **no ✓** (nothing to confirm).
  - A pick you've made counts as confident, and an **Always** tag appears if you asked for a rule.
  - **Card payment** / **Transfer** quiet button appears when the row looks like one and the
    guess isn't already that category; one tap marks it "not spending".
  - **Split** quiet link appears for Amazon-style merchants (the likely multi-category charges);
    it opens the transaction in split mode.
- **Swipe** (touch/pen only, never mouse): the row follows the finger clamped to ±120px; mostly
  vertical drags are ignored (scroll); release past 80px right = confirm, left = open picker;
  otherwise it springs back.
- **Transfer pair row:** "Account A → Account B", caption "Transfer · not spending", amount muted;
  actions **Not a transfer** (unlinks, with undo) and ✓ Confirm transfer.
- **Choosing never files:** a picked category is held on the row until ✓ or Confirm all.
- Rows with no real suggestion aren't confirmable; nothing is filed to "Other" by default.

**Picker:** a sheet, "Choose a category", optional first row "Always file {merchant} here" with a
toggle, a Search field (no autofocus), categories grouped under group labels with emoji; empty
state "No categories yet. Add them from the Budget tab."

**Confirm all:** a full-width primary button below the list: `Confirm all`, or `Confirm all (N)`
when only some rows are confirmable. Includes transfer pairs.

**Undo:** toast pinned above the tab bar (above the safe area + 72px on phone, bottom 16px on
desktop), max 560px wide, dark card, truncated label, **Undo** button (44px target).
`Merchant → Category`, `Merchant → not spending`, `N confirmed`, `Transfer confirmed`, `Unlinked`.
Five seconds; the toast fades in. Errors show as a line at the top of the list.

**Empty:** centred "All caught up." / "Nothing waiting. New charges land here after each sync."
**Loading:** four skeleton rows.
**Dropped section:** "Pending charges that never posted", caption "These sat pending for 14 days
with no matching charge, so they no longer count toward spending.", each as a muted row with a
struck-through amount.
**Desktop focus:** the top row has a 2px left accent; keys act on it (§Keyboard list):
`Enter` confirm · `o` or `/` picker · `s` split · `t` mark transfer (only when offered) ·
`u`/`Ctrl+Z` undo. Ignored with a sheet open, a modifier held, or an input focused.

## Budget

- **Sticky head:** month switcher + pool banner stay in view while lists scroll.
  - Switcher is a pill with `‹ Sep`, the **month name centred (adds the year only when it isn't the
    current year)**, `Nov ›`. Planning is allowed 12 months ahead; the forward button disables
    there. Choosing the current month clears `?m=`.
  - **Pool banner** (`role=status`): "Left to budget $X" (tinted when positive, plain at zero) or
    "Over budget $X" (solid debt colour with inverted text).
- Header action: a ⋯ **Budget settings** link (desktop: same link in the content). Back from
  settings returns to this month.
- **Summary card** (also the Dashboard tile): two rows, *Income* (X planned · fill bar · $ earned ·
  remaining/over) and *Expenses* (planned · fill bar with pace tick · $ spent · remaining/over, a
  refresh glyph when anything is carried in). Income going past plan is shown in the "in" tone,
  never as over. Rounding tolerance is already applied to spend.
- **Income** and **Expenses** sections: title, then **Planned / Remaining** column labels once,
  then groups. Fixed 72px columns so every row and each group total align.
- **Group header:** a full-width button (44px) with a turning chevron, group name, planned total
  and remaining total; **open by default**, `aria-expanded`. Group over-total uses debt tone.
- **Category row:** emoji + name (link to detail), a roll-over glyph if leftovers carry, the
  **Planned** box (bordered, 72px, tap opens the Plan editor, aria "Planned for X: $N. Change"),
  the **Remaining** pill (muted at zero, tinted when positive, debt tint with "Over" label when
  over; sign never shown), then the **rail** underneath (income uses a plain fill bar). The name
  and rail are one link; planned and remaining are separate targets.
- **Unbudgeted:** transfers / card payments / catch-all never get a budget line; budgeted
  categories with no plan, carry or spend hide behind an eye-off row "Show N unbudgeted" /
  "Collapse N unbudgeted", per group.
- **+ Add category** (quiet button) → "New category" sheet (Name, Group picker incl. "New group…",
  Add category).
- **Money moved this month:** a bordered row `Money moved this month · N ›` (hidden if none) →
  sheet "Money moved" listing `From → To`, amount, date and note.
- **Empty:** gold-edged "Start with what you spend on." + **Add your first category**. Income empty:
  "Paychecks count once they're filed under an income category." + **Add a Paycheck category**
  (creates the group and category in one tap).
- Row tap: phone pushes `/budget/:id?m=`; desktop selects it (`?category=`) and shows the detail
  beside the list (list hidden below lg when something is selected).
- Loading: a skeleton shaped like the screen.

### Plan editor (tap a Planned box)
Full-height sheet with its own docked bottom (toggle + keypad); header `Cancel · {emoji} Name ·
Save` (Save reads **Saving…** while busy, disabled when invalid).
- **Add / Remove** are two toggle buttons (`aria-pressed`); tapping the active one returns to
  Set and restores the current plan. In Add/Remove the box starts empty and shows `+$` / `−$`,
  with "New plan for {Mon}: $N" beneath.
- **Amount** is a 40px display figure; the whole figure is highlighted while "fresh" (first digit
  replaces); after typing a caret blinks. An emptied Set amount reads as $0 (Remaining follows) but
  can't be saved. Invalid (e.g. Remove past the plan) turns the figure debt-tone.
- **Remaining:** carried-in + new plan − spent, shown with "Includes +$X carried from {previous
  month}" when anything carried.
- **Spend bars:** the **last six months**, each a button (aria "Month: $N. Use this amount."),
  labelled with whole-dollar spend, with a dashed line at the current plan; loading shows stubs.
  Hidden when there's no history at all. Beneath: two quick-fill cards **Spent last month** and
  **Monthly average**; both fill **rounded up to the next whole dollar**.
- **Docked:** "Apply $N to all future months" row with a switch (default from settings), then the
  3×4 keypad (1-9, blank, 0, ⌫; 48px keys, hairline gaps, safe-area padding).
- Hardware keys: digits, Backspace, Enter (save); ignored while the sheet is leaving or with
  modifiers.
- Save failure closes the sheet and shows the server message above the lists.

### Category detail
Bar `‹ Budget` (or the Dashboard when opened from there) · category name · pencil → **Edit
category** sheet. Hero *Available this month* with a month stepper (`?m=`, other params kept).
Facts: `Left in {Name}` (income: `Left to earn in …`), `Rolled over from last month`, **Planned**
(the shared edit box → Plan editor), `Total amount` (income: `Earned`), `Average transaction`.
A 12-month spend chart with the viewed month picked out. **Transactions** zone: first few rows or
"Nothing filed here yet.", then `All N transactions` row. **Manage** at the bottom: forgive deficit
(sheet "Forgive the deficit?" naming the amount and asking why; button `Forgive $93`) and delete
(refused with the reason when it has history).
**Edit category sheet:** Name; Emoji row (shows current emoji or "None") expanding a searchable
8-column emoji grid plus "Or type any emoji"; Group picker; **Budget** (toggle "Counts toward the
budget"); **Month end** (toggles "Rolls over to next month" and "Spent all at once, like a bill");
**Taxes** (Tax heading picker, default None).

## Transactions

- **Header:** tab title with two header actions, **Select** and **+** (Add transaction). Desktop
  repeats them beside a page title.
- **Search:** a pill under the title bar that **stays pinned while the list scrolls** ("Search
  merchants, notes"); the **Filters** icon lives inside the pill and carries a count badge (aria
  "Filters, N on"). Typing applies after **250 ms**; filters and search live in the URL and
  replace history.
- **Active filter chips:** a horizontally scrolling row below the search, one chip per filter with
  an ✕ (aria "Remove filter: X"); a quiet **Clear all** appears with two or more.
- **Totals line** (only when filtered): `N transactions · Out $X · In $Y · Net $Z` (each part
  shown only if it applies).
- **"To review" filter** adds a full-width **Mark all reviewed (N)** button (shows "Marking…") and
  makes each row's category tappable to recategorise in a picker.
- **List:** grouped by day under **sticky date headings** (`dayLabel`) when sorted by date, a
  single card otherwise; **Show more** button paginates (no infinite scroll; "Loading…" while
  fetching). Row: optional category emoji (a split joins emojis with " / ", smaller), merchant,
  badges, amount; caption "Sep 23 · Transfer / Spread, 2 of 3 / Spread over N months / Split / To
  review / flag text" (date hidden under a date heading). Pending rows italic.
- **Empty:** icon bubble + "No transactions yet" / "They arrive with the first bank sync." or,
  when filtered, "Nothing matches" / "Try a wider date range or fewer filters." + **Clear filters**.
- **Select mode:** header icon toggles (label "Done selecting"). Rows become checkboxes (24px
  square, check when on). A **sticky bottom bar** shows `Select all` (→ `Loading…` → `Clear`),
  `N selected`, **Tag** (disabled at zero → tag sheet) and **Done**. Select all fetches every page;
  over the bulk cap it refuses with "That's N. Narrow the search to M or fewer."
- **Desktop table:** Date · Merchant (with "To review" tag) · Category (a pill-shaped button that
  opens the picker, or plain "Transfer"/"Split") · Account · Amount; hover tint; row click opens
  detail; in select mode a checkbox column appears.
- **Filter sheet:** `Filters` root page with **Date range** (presets: All time, This month, Last
  month, Last 3 months, This year, Custom with From/To), **Sort by** (Date newest first / oldest
  first, Amount largest first / smallest first), and **Filter by** rows (Accounts grouped by kind, Categories grouped by group with
  emoji, Tags, Amount direction/min/max, Review status: Any / To review / Reviewed / Never
  posted), each opening an in-sheet page (left slot becomes `‹`). Multi-select rows can be
  negated ("Not X"). **Nothing applies until Apply**, so exploring is free; pinned footer `Clear
  all · Apply`.
- **Add transaction sheet:** "New transaction", Add button. Kind segmented control (Expense /
  Income), Amount (the shared field), Merchant ("Where"), Account, Category ("Choose…" →
  picker), Date, Notes ("Add notes…").

### Transaction detail
Bar `‹ {origin}` with a **⋯ Transaction options** menu: Split transaction / Edit split · Spread
over months / Change spread · Mark reviewed / Send back to review · Not a transfer (unlink both)
· Link as a transfer · Link as a refund / Unlink from purchase · untag actions · Create rule /
Edit rule · **Delete transaction**. Only options that apply are listed.
Hero amount; rows: **Merchant** (nav, opens the rename sheet which warns it renames every past and
future transaction), *Original statement* (static), **Account**, **Category** (nav → picker; muted
and read-only for transfers; per-split rows for splits; **Spread** row for spread charges),
**Tags** (nav → tag sheet, "None" when empty), **Date** (inline date field), **Surplus** row on
cash accounts (a suggested bill/paycheck mark, "Suggested, not added"), **Notes** ("Add notes…",
commits on Enter/blur).
**Splits** (§8): typed rows + auto-computed last row, so it always sums exactly.
**Delete sheet:** "Delete transaction?" naming that it leaves every total, and (for synced rows)
that the next sync won't bring it back; "This can't be undone."
Transfer pairing candidates: equal and opposite, other account, within 4 days, not already paired.
Refund matching lists earlier outflows, best match first.

## Accounts

- **Header actions:** ⋯ **Account options** (Refresh all / "Refreshing…"; disabled when sync is
  off with hint "Connect SimpleFIN first"; Bank connection → Settings with origin) and **+** (Add a
  manual account).
- **Net worth first:** title, big whole-dollar number (debt tone if negative; "No balances yet"
  when empty), a delta line (`+$X (pct) over 6M` / `since {date}`; first-ever balance says "History
  starts {date}, the first balance Rise saw."), `· as of {date}` when the newest point is
  estimated), chart with range chips (**default 6M**). Percent only with ≥ 90 days of real
  history.
- Health and stale notes appear above the groups (not dismissible here).
- **Groups in order:** Cash · Credit cards · Loans · Investments · Other. Each is one card: group
  name + group total in a header, then **nav rows**: logo, name (+ `··mask`), caption (the
  institution, "Manual", "Not up to date" in the warm text, "Last synced {date}" for slow feeds,
  "· not in net worth"), balance (muted when negative).
- Empty: "No accounts yet. Synced accounts appear after the first sync; add anything else by
  hand."
- **Sync:** Refresh all → floater "Syncing banks…" (busy, spinner, indeterminate bar) → result
  (OK tone fades after a few seconds; warn tone persists until dismissed). Continues if you leave.
- **Account detail:** hero balance; history chart (dashed between reports); **Summary** group with
  Name, Type (Cash / Credit card / Loan / Investment / Other), Balance/Owed, As of, Monthly
  payment (loans), edits held until **Save**; switching Type first re-signs balances. Balance
  entries list (newest first, "Updated by hand"; a mistyped one can be removed, the last can't);
  "All transactions" row; Manage: detach a synced account to manual, **Close** (keeps history in
  net worth) vs **Delete** (erases it) as separate confirmed sheets. Matching-transfer manual
  accounts (savings that never report) adjust from transfers elsewhere.
- Liabilities are typed as positive "owed"; a card paid past zero shows a credit.

## Reports

- Bar with month navigation (`‹`, label, `›`) or the full 6-month window ("May – Oct 2026"; tap the
  selected bar again, or "6 months"). One period drives every chart.
- **View picker:** *Cash flow* / *Spending* (pressed-state chips), then a **Chart** picker (cash
  flow: Bar / Sankey; spending: Pie / Bar / Treemap).
- Cash flow bars are buttons (`aria-pressed`): tap selects (others fade), tap again returns to the
  window; an optional cumulative-savings line sits over them. Summary block above.
- Pie: top categories + "Everything else"; Treemap: squarified tiles; Sankey: pinch/wheel zoom,
  drag to pan, double-tap to reset (the only zoomable chart).

## Surplus (cash to payday)

- Bar `‹ Dashboard · Surplus`. Hero **On hand until payday** (the free-to-move number) with the
  lowest-point sentence beneath. No pay schedule → "Confirm your pay dates", plus guidance to add
  income below.
- Facts: **Cash accounts** (a nav row showing the names or "All checking"; opens a picker
  sheet), **Cushion held back** (the shared money field).
- **To review** (anchor `#review`): sync-detected suggestions that count only after you add them;
  each opens an edit sheet (amount, days/name; **Remove** deletes a saved schedule, a suggestion
  is **dismissed**).
- **Upcoming income** / **Upcoming expenses** lists ("Nothing expected yet.") each ending in a
  full-width add row (**Add income** / **Add expense**).
- Chart: 14 days of end-of-day balance bars above/below zero; tap or drag across for that day's
  items; tooltip pins to the side nearest the bar.
- Card payments are never projected; card info is context only.

## Financial health hub and planning tools

- **Hub:** a column of tiles (icon badge, name, state value, chevron): Retirement
  (`$X/mo` or "Set up"), Debt ("Debt-free {month}" / "Add payments" / "Set up"), Mortgage
  (equity / "Paid off {month}" / "Add payment" / "Set up"), Savings ("N months covered" / "N
  goals"), Taxes, Binder ("Start one" / "N entries"). Anything not started shows its state as a
  **gold button** instead. Offline with nothing cached shows "—"; "Set up" is only claimed from
  settings known to be current. Swipe-back goes to the Dashboard.
- **Retirement:** hero "Monthly spending at {age}" with a retirement-age control; a **fan chart**
  (touch/drag reads any age; readout under it); facts (Today, At {age}, Social Security a month,
  Set aside until checks start, Money lasts to {age}, Needed for goal, Gap to goal or "On track");
  **Life events** list (tap to edit, add row; sheet "New life event"). ⋯ **Retirement settings**
  sheet in sections You / Spouse / Plan, both of you / Contributions by account.
- **Debt:** header actions **Set up** / **What if**; hero "Student loans debt-free {month}"; loan
  rows tap to edit; strategy choice (Smallest / Highest rate); **What if** redraws live and has
  **Apply** and a quiet skip; an auto-applied change offers Undo. "Add a loan" sheet lists loan
  accounts not already in the plan.
- **Mortgage:** choose the loan account then optionally a home-value account; hero "Mortgage paid
  off {month}"; view toggle Payoff schedule / balance, principal, interest lines; one-time
  payments sheet ("Add").
- **Savings:** goals (sheet "Add a goal"/goal name → Save), hero "Saved toward goals", emergency
  fund shows months covered.
- **Taxes:** tax-year stepper (previous/next year arrows), totals per tax heading with their
  transactions, and nav rows to Categories and Tags that return here. **Binder:** household records with
  "Passwords live in" (where, never the passwords) and "Last 4 digits only." validation.
- **Investments:** Accounts list and a chart with ranges `1W 1M 3M 6M YTD 1Y`. **Tags:** list +
  "New tag"/"Edit tag" sheet; empty "No tags yet — Add one here or from any transaction."
  **Recurring:** hero "A year of recurring charges"; rows "Expected/Due {date} · Category" with
  price-up/duplicate notes, then missed bills. **Monarch import:** guided groups (Import, Imported,
  Split accounts, Counted twice, Past imports); history imports never touch the carry chain.
- **Health (Settings):** one row per check with a status dot (ok / needs a look / loading), title,
  text, and the fix in small type; the app-version check has an **Update** button ("Updating…").

## Settings

An index, not a stock grouped list: each area is a card leading with its state as a quiet
right-hand value (tinted when something needs attention). Page header shows the owner's display
name and email. Groups: **Data** (Bank sync, Health, Your data), **Budget**, **Preferences**
(Alerts, Appearance, Security). Sections are `/settings/:section` pushes with `‹ Settings`.
- *Bank sync:* schedule (max 12 runs/day) and per-institution last-reported times.
- *Budget:* "When you change a plan" default, Categories (Income / Expenses / Transfers tabs, grip
  reorder, add via ⋯ with Add category / Add group, rename group sheet), Rules (edit replaces,
  delete), Tags. Reordering a filtered tab keeps the other kind's groups where they were.
- *Alerts:* "Show me" (quiet flags, each with a hint) and "Push me about"; push opt-in per
  device; per-account **Deposits** vs **Any increase**.
- *Appearance:* Match system / Light / Dark with hints; applies immediately, device-local.
- *Security:* App lock (Off · Immediately · After 5 minutes away · After 1 hour away), Offline
  PIN, Passkeys, Signed-in devices, Backup sign-in (authenticator sheet, Recovery codes sheet).
- *Your data:* Database use (free daily limit, resets 7 pm Central), Export, Backups, Claude.

### App lock screen
Full-screen dialog: logo, "Rise is locked", button **Unlock** (→ "Waiting for passkey…") and, when
a PIN exists, "Use PIN". Starts in PIN mode if a PIN exists and the device is offline. The PIN
view says "Enter your PIN" ("PIN turned off" after the wipe), shows dots, and on a wrong entry
shakes. While backgrounded the app is covered by the plain logo screen.

## First-run guide ("Set up Rise")

Bar `‹ Dashboard · Set up Rise` with a Skip control; four step pills (aria "Step N: title"), the
current step's label and title, a short body, and **Go** buttons to the real screen:
1. *Connect your banks* — sync now, or the claim command when sync is off.
2. *Add what doesn't sync* — Accounts, Debts.
3. *Choose your spending cash* — Surplus.
4. *Shape your budget* — Budget, Categories.

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
