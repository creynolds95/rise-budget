# Rise — UX behaviour guide

How the app *looks, feels and operates*, written so another installable PWA can copy it. Scope is
interaction and behaviour only: no colours, fonts or theme tokens, and no domain logic or maths.

- **Part I: the portable kit.** Reusable interaction patterns with exact thresholds, timings and
  the reasoning behind them. Lift it whole.
- **Part II: Rise screens.** How the kit is applied, screen by screen, by UI pattern.
- **Part III: porting checklist and dead ends.**

Numbers are the shipped values. Where a number was tuned on a real device, it says so.

**Feel in one line:** calm, quick, forgiving. The common action is one tap; every action is
undoable for a moment; nothing consequential happens without the person seeing it; the app never
lies about how fresh its data is.

---

# Part I — The portable kit

## 1. Principles

1. **One tap for the common case.** Show the best default; confirming it is one tap.
2. **Forgiving by default.** Reversible actions apply instantly and wait behind Undo (§9).
3. **Choosing is not committing.** Picking a value stages it; a separate, visible confirm applies it.
4. **Consequential actions name their consequence** ("Delete erases history") and live in a
   separated Manage area, never next to routine controls.
5. **Honest data.** Stale, estimated and offline data says so, quietly, in place.
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
- **Badge:** the home-screen badge follows the one number that matters (items awaiting review)
  and clears at zero.

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
5. Failure restores the rows and shows the message; **offline, the change is kept on the device
   and the row stays done.**
6. Keyboard: `u` / Ctrl+Z undoes.

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
- **Never claim an empty/"not set up" state** from data that isn't known current.
- **Queued changes** keep a human label for the offline bar and replay in order on reconnect; only
  changes that are safe to apply late are queued, anything needing the server's answer first waits
  for a connection.

## 11. Charts

- **One component, one control set:** same height and axis treatment for lines and bars.
  Range chips (`1M 3M 6M YTD 1Y ALL`) as a radio group below the chart.
- Gridlines hairline, no borders, no chart junk. Anchor value axes at 0 (zoom-to-fit only where a
  balance moves little against its size, e.g. a loan).
- **Inferred ≠ measured:** a segment is dashed if either end is interpolated/held. If the newest
  point is held, name the date it is based on.
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
- **Rail:** a thin segmented bar (tinted lead-in segment, main segment, fill, one tick marker)
  instead of a plain progress bar; the fill switches to the debt tone past its limit.

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
- Taps focus an existing window and navigate to the notice's URL, else open one.
- Few, deduplicated notices; each kind is individually switchable.

## 14. Copy tone

- Plain, calm, short sentences. No exclamation marks, no jargon, no blame.
- State outcomes: `Merchant → Category`, `12 confirmed`, `Transfer confirmed`.
- Buttons are verbs naming the object: `Delete transaction`, `Confirm all (12)`.
- Going over a limit is framed as a neutral state ("Over"), in a muted warm tone, never red and never alarming.
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

# Part II — Rise screens (UI patterns only)

Each screen is described by layout, interaction and states. Domain logic is deliberately left out.

## Structure

- **Four tabs:** Dashboard · Accounts · Transactions · Budget. A menu lists the rest (review queue,
  reports, planning tools, categories, rules, tags, settings). Tab roots show the title bar with
  right-hand **header actions** that each screen registers; pushed screens show
  `‹ Origin · Title · (action)` in a three-column grid so the title stays centred.
- **Detail-page scaffold** (every detail page; zones may be omitted, never reordered):
  1. Header: `‹ Origin`, title, **one** action (pencil, or a ⋯ menu).
  2. Identity: the one number the page is about, large, left-aligned, never a chart; a small
     label above it and a status word where relevant.
  3. Shape: optional chart with range chips.
  4. Facts: label/value rows (static, edit or nav, §8).
  5. Related: first ~5 children, then an "All N …" **row**.
  6. Manage: destructive/rare actions last, separated.

## Sign-in

Wordmark, one primary button (**Sign in with passkey**) and a quiet **Use a code instead**. The code
form is Email + code (numeric keypad, one-time-code autofill) with quiet toggles between code types
and back to the passkey. Errors are one alert line below. The one-time registration link shows the
wordmark and a single **Create passkey** button; a missing token gets a plain sentence. Vertically
centred, narrow column, no marketing copy. Success replaces history.

## Dashboard

- Header action: a **sliders** button that opens a Customize sheet.
- A vertical stack of **tiles** in a user-chosen order; each tile is a titled card, and the whole
  card is a link (except interactive parts such as chart range chips). Tiles with nothing to show
  render nothing.
- Top-of-page **notes** (sync problems, stale accounts) can be dismissed per item; dismissal is
  device-local and returns if the situation recurs.
- An action tile (items to review) is a gold-edged row with a count and a plural-aware label, and
  disappears at zero.
- A "recent items" tile shows the last four rows then a quiet "Most recent" nav row.
- First launch with no data replaces the dashboard with the setup guide once.
- **Customize sheet:** every tile as a row: grip handle, name, switch. Reorder and toggle both save
  immediately; hidden tiles sort below shown ones.

## Review queue (the daily screen)

- Bar `‹ Dashboard · Needs review`. On desktop a one-line key hint sits under it.
- Rows grouped by **date, newest first**, one card per day with a small day label. A filed row
  **collapses** (200 ms height + opacity) rather than vanishing; a day collapses with its last row.
- **Row:** line 1 = optional emoji, name, badges, amount; line 2 = account (tapping this block opens
  the detail and back returns here); line 3 = a wide **category button** (value + chevron) that opens
  the picker, optional quiet text buttons, and a round **✓ confirm** (28px mark in a 44px target,
  fills while pressed). Pending rows are italic. A low-confidence guess renders in the warm accent
  text with a trailing **?**; with no guess it reads "Choose a category" and has no ✓.
- **Swipe** (touch and pen only, never mouse): the row follows the finger, clamped ±120px; mostly
  vertical drags are scrolls; past 80px right = confirm, left = open the picker; otherwise spring back.
- A picked value is **held on the row** until ✓ or Confirm all; choosing never commits.
- **Pair rows** (linked items) show "A → B" with a muted caption, a quiet "Not a transfer" button
  and a ✓.
- **Picker sheet:** optional first row with a toggle, a Search field (no autofocus), items grouped
  under labels with emoji; empty state is a single sentence pointing to where to add some.
- **Confirm all:** full-width primary button below the list, with a count when only some rows
  qualify.
- **Undo toast:** dark card pinned above the tab bar, truncated label, **Undo** (44px target), 5 s
  (§9). Phone: above the safe area + 72px; desktop: 16px from the bottom; max ~560px wide.
- **Empty:** centred title "All caught up." + one line. **Loading:** four skeleton rows. Errors
  are one line at the top of the list.
- **Desktop keys** (top row focused, shown by a 2px left accent): `Enter` confirm · `o` or `/`
  picker · `s` split · `t` mark transfer (only when offered) · `u` / `Ctrl+Z` undo.

## Budget

- **Sticky head:** month switcher + a status banner stay in view while lists scroll. The switcher
  is a pill: `‹ Sep`, month name centred (year only when not the current year), `Nov ›`; the forward
  button disables at the limit; choosing the current month clears the URL param.
- Header action: ⋯ link to budget settings; back returns to the same month.
- **Summary card:** two rows, each a label, "X planned", a fill bar, "$ done" and "remaining/over".
- **Sections** (Income, Expenses): section title, a column-label row once, then collapsible groups.
  Fixed 72px number columns so every row and group total align.
- **Group header:** full-width 44px button, turning chevron, name, two totals; open by default,
  `aria-expanded`.
- **Row:** emoji + name (link), a small glyph for a flag, a bordered **amount box** (72px; tap edits
  it in a full-height sheet), a **pill** with the remaining figure (muted at zero, tinted when over,
  sign hidden), then a thin **rail** below. Name and rail are one link; box and pill are separate
  targets.
- **Idle rows** collapse behind an eye-off row "Show N …" / "Collapse N …".
- **+ Add category** is a quiet button → a small form sheet.
- **Log row:** a bordered row `Label · N ›` opens a read-only list sheet.
- **Empty:** gold-edged one-line prompt with a single primary action.
- **Phone:** row tap pushes the detail. **Desktop:** it opens beside the list; the list narrows.
- **Loading:** skeleton shaped like the screen.

### Amount editor (tap an amount box)
A full-height sheet with its own docked bottom (a toggle row + keypad). Header `Cancel · {emoji}
Name · Save` (Save reads "Saving…", disabled when invalid).
- **Add / Remove** are two toggle buttons; tapping the active one returns to Set. In those modes
  the field starts empty and shows `+$`/`−$`, with a preview line beneath.
- The amount is a 40px serif figure. While "fresh" it is highlighted and the first digit replaces
  it; afterwards a caret blinks. Invalid turns it debt-tone.
- A short line beneath states the result; the **last six months** of history are tappable bars
  (labelled with whole dollars, a dashed line at the current value); two quick-fill cards fill the
  field rounded up to the next dollar. Bars hide when there's no history.
- Docked: a labelled switch row, then the 3×4 keypad (1–9, blank, 0, ⌫; 48px keys, hairline
  gaps, safe-area padding).
- Hardware keys: digits, Backspace, Enter saves; ignored while leaving or with modifiers.

### Category detail
Back names where you came from. Hero number with a month stepper. Facts rows (one is the shared
edit box). A 12-month bar chart with the viewed month picked out. Related list with an "All N" row.
Manage zone at the bottom; destructive actions open a sheet that names the consequence. **Edit
sheet:** name, emoji row that expands to a searchable 8-column grid plus "Or type any emoji", a
group picker, and switches grouped under small headings.

## Transactions

- **Header actions:** Select and + (add). Desktop repeats them next to a page title.
- **Search pill** under the title bar stays **pinned while the list scrolls**; the Filters icon sits
  inside the pill with a count badge. Typing applies after **250 ms**; filters and search live in the
  URL and replace history.
- **Active-filter chips:** a horizontally scrolling row, each chip with ✕; a quiet **Clear all**
  with two or more. A summary line (count · out · in · net) appears only when filtered.
- **List:** grouped by day under **sticky date headings** when sorted by date, one card otherwise;
  a **Show more** button paginates (no infinite scroll). Row: optional emoji, name, badges, amount;
  caption of short facts joined with " · ". Pending rows are italic.
- **Empty:** icon bubble + title + one line; when filtered, "Nothing matches" and a **Clear filters**
  button.
- **Select mode:** rows become 24px checkboxes; a **sticky bottom bar** shows `Select all` (→
  "Loading…" → "Clear"), `N selected`, a bulk action (disabled at zero) and Done. A bulk cap shows
  one clay line.
- **Desktop:** a table (Date · Name · Category pill-button · Account · Amount) with hover tint; the
  category cell opens the picker; row click opens detail.
- **Filter sheet:** root page of rows (date range presets with Custom From/To, sort, then filter
  rows each opening an in-sheet page with the left slot becoming `‹`); multi-select pages can
  negate ("Not X"). **Nothing applies until Apply**; pinned footer `Clear all · Apply`.
- **Add sheet:** segmented control (Expense / Income), amount field, text rows with right-aligned
  inputs, nav rows that open pickers, date, notes ("Add notes…").
- **Detail:** hero amount; a ⋯ options menu listing only the actions that apply; rows are static /
  edit / nav per §8; notes commit on Enter or blur; delete opens a sheet naming the consequence.
  Splitting is a stack of typed rows with an auto-filled last row.

## Accounts

- **Header actions:** ⋯ menu (refresh, connection) and +.
- **Hero** big number with a delta line and chart with range chips (default 6M).
- **Groups:** one card each, header = serif group name + total; rows = logo, name (+ masked number),
  caption (status in a warm tone when stale), value (muted when negative); each row a nav row.
- **Sync:** the **floater** (§6): "Syncing banks…" with spinner and indeterminate bar, then a
  result that fades; warnings persist until dismissed; runs on if you leave.
- **Detail:** hero; chart (dashed where estimated); a Summary group of edit rows that are **held
  until Save**; list of entries; Manage zone with separate Close and Delete sheets, each naming
  its consequence.

## Reports

Bar with period navigation (`‹ label ›`), a view picker (pressed-state chips), then a **Chart**
picker (bar, flow, pie, treemap). Bars are buttons: tap selects (others fade), tap again returns to
the whole window. The flow diagram is the only zoomable chart (pinch/wheel, drag to pan,
double-tap reset).

## Cash projection screen

Hero number with a one-line caption; facts rows (one opens a picker sheet, one is an edit box);
a "to review" list where each row opens an edit sheet (Remove/Dismiss inside); two lists ending in
full-width add rows; a 14-day bar chart above/below a zero line (tap or drag across bars; tooltip
pins to the side nearest the bar).

## Planning tools

A hub of tiles (icon badge, name, state value, chevron); a not-started tool shows its state as a
**gold button**. Each tool is a detail page: hero number, one chart (fan chart or line, scrub to
read), facts, a list with an add row, and header actions that open settings / what-if sheets.
What-if inputs **redraw the chart live** and finish with **Apply** or a quiet skip; automatic
changes offer **Undo**. Offline with nothing cached shows "—" instead of a claim.

## Lists and utility screens

Tags, recurring items, imports and the health page all use the same rows: list with an add row,
a form sheet (`Cancel · Title · Save`), an empty state ("No X yet" + one line). The health page is a
column of check rows with a status dot, title, text and, when failing, a small fix line; one row
can carry a primary **Update** button ("Updating…").

## Settings

An index, not a stock grouped list: each area is a card that leads with its **current state** as a
quiet right-hand value (tinted when attention is needed). The page header shows the owner's name and
email. Groups under small headings; sections are pushes with `‹ Settings`. Inside sections:
rows with switches and hints, choice lists (radio rows with a hint line), reorderable lists with grips
and an add menu, rename/new sheets, and confirm sheets. Appearance applies immediately.

### App lock screen
Full-screen dialog: logo, "Rise is locked", **Unlock** ("Waiting for passkey…") and, when a PIN
exists, "Use PIN". Starts in PIN mode if a PIN exists and the device is offline. The PIN view shows
"Enter your PIN" and dots, shakes on a wrong entry, submits on the last digit. While backgrounded
the app is covered by the plain logo screen.

## First-run guide

Bar `‹ Dashboard · Set up Rise` with Skip; four step pills (aria "Step N: title"), the current
step's label, title and short body, and **Go** buttons to the screen that does the work.

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
