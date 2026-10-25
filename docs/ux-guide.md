# Rise — UX behaviour guide

How the app *feels and operates*, so it can be rebuilt elsewhere. No colours, fonts or theme
tokens here; those live in `DESIGN-SYSTEM.md`. Behaviour and money rules live in `SPEC.md`
(SPEC wins on conflict). Written for the owner's single-user, installable PWA.

**Feel in one line:** calm, quick, forgiving. The daily job (clearing the review queue) is one
tap per row; nothing about money changes without the owner seeing it; going over budget is a
debt, never an alarm.

---

## 1. Principles

1. **One tap for the common case.** Every row shows its best guess; confirming is one tap.
2. **Forgiving.** Actions wait behind a 5-second Undo before reaching the server.
3. **Never silent about money.** Rules, forgiveness, deletes and renames name their consequence
   and ask first. Choosing never files; confirming does.
4. **Honest data.** Stale, estimated and offline data says so, quietly. Inferred points are
   drawn dashed. No percentage change over a window under three months.
5. **Quiet copy.** No explanatory blurbs unless they name a destructive consequence, state a
   fact not visible elsewhere, or are a needed empty state.
6. **Same thing, same place.** One chart component, one range-chip row, one sheet, one
   detail-page scaffold, one amount field.
7. **Nothing zooms.** The page is fixed-scale; only designated charts zoom.

---

## 2. Navigation & layout

### Structure
- **Four tabs:** Dashboard · Accounts · Transactions · Budget.
- **Menu** (three-line button, top-left of each tab root): Surplus, Financial health, Review,
  Recurring, Reports, Investments, Categories, Rules, Tags, Settings.
- **Settings** is also reachable from the Dashboard header avatar/menu; its back control reads
  `‹ Dashboard`.
- **Depth limit:** two pushes from a tab. Deeper than that, use a sheet or a filtered list.
- **Back always names its origin** (`‹ Budget`, `‹ Gas`, `‹ Review`), carried in a
  `?from=Label|/path` query so chains retrace correctly (Categories → Budget settings → back
  returns to Budget settings, not the tab).

### Phone (below ~64rem)
- **Bottom tab bar** is the last item of a full-height column (not fixed/sticky), so it always
  ends at the screen edge.
- **Sticky top title bar** per screen, with a single right-hand action at most.
- **Tab switches replace history** instead of stacking, so a back swipe on a tab root has
  nowhere to go. A tab root traps back: back/swipe lands on itself.
- **Tapping the active tab scrolls it to the top** (smooth).
- **Menu drawer:** slides in from the left (78% width, max ~320px) over a dimmed page. Opens by
  the menu button *or* a right-swipe starting in the left 40% of a tab root. Closes by tapping
  the dim, swiping left (>50px), choosing an item, or Esc. Page scroll is locked while open.
- **Pushed screens** slide in from the right; back slides out. A right-swipe from the left 40%
  of a pushed screen goes back (needs >80px horizontal and mostly horizontal). The iOS
  edge-swipe is cancelled (20px strip) so only the app's own back runs; taps in that strip are
  re-sent as clicks.
- Swipe-back and menu-swipe are disabled over charts (`data-zoomable`), text inputs, and
  anything marked no-swipe or inside a dialog.
- **Scroll memory:** returning *back* to a screen restores its scroll position; any forward
  arrival starts at the top.

### Desktop (≥ 64rem)
- **Persistent left sidebar** (fixed, ~18rem): wordmark, the four tabs, a divider, the full menu
  list, Settings with the owner's initials at the foot. No drawer, no bottom bar.
- Content column is centred, narrow (reading width), gutters 16px phone / 24px desktop.
- **Master/detail instead of push:** Budget opens a category in a panel beside the list
  (`?category=`); its "Close" clears the param rather than navigating. Transactions becomes one
  scannable **table** with category editable in place. Review gains keyboard shortcuts (§4.1).
- Push transitions use the browser view-transition at wide widths; the installed phone app
  uses a custom in-place slide (see §9).

### Detail-page scaffold (every account, transaction, category, goal…)
Zones may be omitted, never reordered:
1. **Header:** `‹ Origin`, title, **one** action (Edit).
2. **Identity:** the number this page is about, hero, left-aligned, never a chart.
   Account → balance · Transaction → amount · Category → available this month.
3. **Shape:** optional chart + range chips.
4. **Facts:** label/value rows.
5. **Related:** first ~5 children, then an "All N …" **row** (not a button).
6. **Manage:** destructive/rare actions last, separated, each behind a confirm that names the
   consequence (e.g. "Forgive carried deficit", not "Reset").

### Row types: exactly three, visually distinct
- **Static:** no affordance.
- **Edit:** bordered field, edits in place (same component as the budget row's planned amount).
- **Nav:** chevron, pushes a page.
No link-styled text; a chevron never edits; a button never navigates.

---

## 3. Dashboard

Top to bottom: **Surplus** (cash free to move), **Budget** summary, **Transactions** to review
(with a gold call-to-action that disappears at zero), **Coming up**, then net-worth and report
tiles. Tiles are **show/hide/reorder** from a customise sheet: six-dot grip handles, drag to
reorder, every change saves immediately.

- A brand-new install (no accounts) opens the **setup guide** once.
- Stale-account notes appear here and are **dismissible per account until its next sync moves
  its last-synced time** (device-local). A later stale spell shows again.
- Surplus with no detected pay schedule shows "Confirm your pay dates" instead of a number
  (a number would look precise while being a guess).
- The queue count is the app's only badge.

---

## 4. Review queue (the daily screen)

**Layout:** header `‹ Dashboard   Review 46`. Rows grouped by **date, newest first**, each day
with a **total** (money out, transfers excluded). Each row: merchant, amount, account, and
a **chip strip** of one-tap categories.

**Row behaviour**
- Best guess is shown on the row; **✓ confirms it**. Tapping the guess opens the picker.
- Chips are: merchant's own top categories → what the owner files most → anything, so even
  week one is one tap. Money in leads with income categories. Transfer-like rows lead with a
  **Transfer / Card payment** chip.
- **Choosing never files.** A picked category is held on the row until ✓ or Confirm all.
- Rows with no real suggestion stay unconfirmed; **nothing is filed to "Other" by default.**
- **Swipe right** confirms the guess; **swipe left** opens the picker. Mostly-vertical drags are
  scrolls; threshold 80px.
- **Transfer pairs** render as one linked row (shown under the later leg's date); a lone leg
  shows alone.
- **Splits** reachable in one tap from the row.
- Confidence sizes the control (confident ≥ 0.90 vs guess vs none).
- **Quiet flags** (possible duplicate / more than usual / first charge here) are a caption on
  the row, not an interruption; "Looks fine" clears one for good.
- **Always** option on a pick creates a rule when the row is confirmed; otherwise a **rule offer
  sheet** may appear after filing (rules are offered, never made silently).
- Pending charges that never posted are listed in their own section.

**Undo model:** every action hides its rows immediately, shows a bottom **toast**
(`Chick-fil-A → Eating out   Undo`), and **waits 5 s** before sending. A new action flushes the
previous one. Leaving the screen or backgrounding the app sends what's waiting. A failed send
brings the rows back and says why. Offline, the change queues on-device and the row stays filed.

**Confirm all** (bottom button, `Confirm all (N)` when fewer than all rows are confirmable) acts
on every row that has a guess or pick, plus transfer pairs.

**Empty:** "All caught up." plus one line that new charges arrive after each sync.

### 4.1 Keyboard (desktop, top row is focused)
`Enter` confirm · `o` or `/` open picker · `s` split · `t` mark transfer (only when offered) ·
`u` or `Ctrl+Z` undo. Ignored while a sheet is open or an input is focused.

---

## 5. Budget

- **Header:** month with prev/next arrows (`?m=`), plan up to 12 months ahead; future months
  are visibly future. Month change keeps other params.
- **Summary tile:** Income and Expenses at a glance; tapping opens the matching tab/section.
- **Income** and **Expenses** sections with column labels *Planned / Remaining* once per
  section; fixed-width columns so every row and group total aligns.
- **Groups** collapse/expand with one turned chevron and show roll-up totals.
- **Category row:** name, planned (an edit field), remaining, and the **rail**: carried segment,
  allocated segment, spent fill, pace marker. Over = "Over budget" (debt wording), never alarm
  wording. Income inverts: earning past plan is good, never "over".
- **Unbudgeted** (transfers, card payments, catch-all) never get a budget line; budgeted-but-idle
  $0 categories hide behind "Show N unbudgeted" / "Collapse".
- **Left to budget** pool banner: positive = money still to give a job, zero = fully planned,
  negative = planned past income ("Over budget").
- **Money moved this month** log lists reallocations.
- Tap a row → category detail (phone: push; desktop: side panel). First-run empty state:
  "Start with what you spend on."
- Settings gear opens budget preferences and returns to this month.

### 5.1 Plan editor (tap a planned amount)
Full-height sheet, **amount is the hero**:
- `Cancel · {emoji} Category · Save` header; **Add / Remove** modes adjust the current plan by
  what you type (default is Set).
- Big amount opens **selected**: the first key replaces it; delete clears it when fresh.
- Under it: **Remaining** and "Includes +$X carried from {month}".
- A **13-month spend bar chart** with a dashed average line; **tap a bar or a stat card to fill
  the amount**. Stat cards: "Spent last month", "Monthly average".
- Pinned above the keypad: **"Apply $N to all future months"** toggle (default from settings).
- **Custom whole-dollar numeric keypad** (digits + backspace only; max 7 digits). A hardware
  keyboard also types into it (digits, Backspace, Enter saves) until the sheet starts closing.
- Remove can't exceed the current plan.

### 5.2 Category detail
Hero = **available this month**, month stepper, 12-month spend chart with the viewed month
picked out, facts (rollover policy, carried in), transactions (first few + "All N" row), Manage
zone. **Forgive deficit** sheet names the amount and asks why before confirming.
Deleting a category with history is refused with the reason.

---

## 6. Transactions

- **Search as you type** (debounced); filters live in the **URL** (shareable, back-safe).
- **Filter sheet:** `Clear all · Apply` pinned at the bottom; includes an Accounts page inside
  the sheet (left slot becomes back instead of cancel).
- **Select mode** ("Select transactions" → "Done selecting"): tap rows or "Select all"
  (everything the search+filters match; shows "Loading…" while fetching; becomes "Clear"), then
  tag together.
- Row: merchant, amount, account, category, badges (pending, flags, tags).
- A list opened from a category or account is a **pushed** screen with that origin as back.
- Desktop: table with in-place category edit.

### Transaction detail
Hero amount; edit category, **splits** (typed rows plus an auto-computed last row so the set
always sums exactly; a new split starts as one typed amount plus "the rest"; an overshoot error
always shows), notes, merchant rename (**renames every past and future transaction** and says
so), transfer pairing (candidates: equal and opposite, other account, within 4 days, not already
paired), refund → purchase matching. Text fields commit on Enter or blur.

---

## 7. Accounts

- **Net worth first** (hero + chart), then accounts grouped by kind, each with its **staleness**.
- **Sync** button → floating card above the tab bar: "Syncing banks…" with a bar, then a short
  result that fades; failures stay until tapped. Keeps running if the owner leaves the tab.
  The floater never blocks the page and has an X.
- Account detail: balance, history chart (**dashed between reports**), facts, manual snapshot
  entry (balance recorded *as of a date*), summary edits held until **Save**.
- Manual accounts: liabilities are typed as positive "owed" numbers and stored negative; a card
  paid past zero shows a credit.
- **Close** (keeps history in net worth) and **Delete** (erases it) are separate, each
  confirmed with its own consequence text. A mistyped manual balance can be removed; the last
  one cannot.
- Stale notes name the account and the gap ("last synced Sep 1, 22 days not counted"), never an
  estimate. Loans show a gentler "update it" reminder on the account itself.

---

## 8. Charts

- **One component, one control set.** Range chips: `1M 3M 6M YTD 1Y ALL` (investments add 1W).
  Radio-group semantics; same height and axis treatment for lines and bars.
- **Scrub:** press/drag on the chart shows a read-out *inside the top of the chart* (never
  above it), centred on the pointer and clamped on-screen; multi-line charts list each series.
  Release/leave/cancel clears it. Touch hit selects on pointer-down.
- **Bar charts (Reports, Surplus):** tap a bar to select (others fade); tap again to return to
  the whole window. Surplus bars are 14 days, rise above/hang below a zero line; tap or drag
  across for that day's charges; tooltip pins to the side nearest the bar.
- **Reports:** one period drives every chart (single month via arrows or bar tap, or the full
  6-month window). Cash flow (bar), Spending (pie, bar, treemap), Summary.
- **Money flow (Sankey):** the one place zoom is allowed: **pinch or wheel to zoom, drag to pan
  when zoomed, double-tap to reset.** Overspend inflow ("from savings or credit") is a debt
  flow, not an alarm.
- **Fan charts (retirement)** show percentile bands; touch/drag reads any age; readout defaults
  to the last age. What-if chart redraws live as inputs change.
- Dashed = inferred/interpolated; held-balance end points name the date they're based on.

---

## 9. Motion

- One clock for everything: arrive **500 ms**, leave **400 ms**, standard ease-in-out.
  Sheets, drawer, pushes and dim all share it.
- **Sheets** rise from the bottom over a dimming backdrop; they slide back down on close (even
  when the caller unmounts them).
- **Installed phone app push/pop:** the old screen stays as an inert ghost and slides in place;
  content keeps its slide, the header changes, buttons cross-fade, titles slide and fade
  together, the back arrow emerges from the old title's left edge. ~0.3 s native-iOS curve.
  The first sliding frame must already show the destination.
- Collapsing rows animate closed after filing.
- Respect reduced-motion.

---

## 10. Sheets, menus, modals

- **Bottom sheet:** header grid `‹/Cancel · Title · action`; content scrolls; optional pinned
  footer (Clear all · Apply). Max ~92% of the visible area.
- **Dismiss:** Esc, tap the dim, or **drag down** (closes past 1/3 of height or on a quick flick).
  Page behind is scroll-locked.
- **Full-page sheet** variant for amount entry (sized to what's visible above the keyboard so
  pinned controls stay reachable).
- **Keyboard handling (global):** focused fields are scrolled into view above the keyboard and
  its input bar; number fields **select all on focus**; sheets with a primary field open the
  keyboard *with* the sheet (a stand-in input hands focus over after the rise animation);
  pickers don't autofocus search (keyboard rising mid-slide stutters).
- **Overflow menus** (⋯): small anchored popover, Esc closes.
- **Confirms** name the consequence and the amount; destructive buttons are in the Manage zone.
- **Rule offer sheet:** rule creation is always an explicit confirmation.
- **Toasts** are only for undoable actions; background work uses the floater.
- **Reorder lists** (dashboard tiles, categories, groups): six-dot grip is the only drag
  start; the held row follows the finger, others slide aside; holding near the top/bottom
  edge auto-scrolls; drop reports the new order and saves.

---

## 11. States

| State | Behaviour |
|---|---|
| Loading | Skeleton matching final layout; no full-screen spinners. |
| Offline, nothing cached | Skeleton gives up: "This screen isn't saved on this device yet". |
| Failed load | "Couldn't load this screen" plus the one fix. |
| Offline, cached | Top bar: "Offline · showing data from {time} · N changes waiting to send". |
| Reconnected | "Sending N saved changes…" until the queue drains (retries every ~30 s). |
| Refresh failed | Quiet "Couldn't refresh · data from {time}"; data stays. |
| Daily DB limit | Bar says reads show saved data until reset. |
| Stale account | Named account + gap; never an estimated number. |
| Empty | A designed default ("All caught up.", "Start with what you spend on."), not a lecture. |
| Error on action | Message from the server, rows restored. |

Plan pages never say "Not set up" from data that isn't known current (cached/offline copies may
predate a plan).

---

## 12. Settings

An **index**, not a stock grouped list: each area leads with its current state as a quiet
right-hand value, grouped by hairlines and type, under headings **Data** (Bank sync, Health, Your
data), **Budget**, **Preferences** (Alerts, Appearance, Security).

- **Bank sync:** automatic schedule (max 12 runs/day), per-institution last-reported times.
- **Budget:** rollover/plan preferences ("When you change a plan"), Categories (tabs
  Income / Expenses / Transfers, drag to reorder, add category/group via menu), Rules (view,
  edit = replace, delete), Tags.
- **Alerts:** "Show me" quiet flags + "Push me about" per kind; push opt-in per device (iPhone
  only from the Home Screen app); per-account Deposits vs Any-increase.
- **Appearance:** Match system / Light / Dark (applied immediately, device-local).
- **Security:** see §13.
- **Your data:** CSV export, backups, database-use meter, Claude connector.
- **Health:** checks with ok / needs attention state; failing checks tinted as debt-tone.
- **First-run guide** ("Set up Rise"): four steps (Connect your banks → Add what doesn't sync →
  Choose your spending cash → Shape your budget), step pills, Skip, each step links to the real
  screen that does the work.

---

## 13. Security: sign-in and app lock

- **No signup.** Sign-in is passkey first; authenticator code and single-use recovery codes are
  the only fallbacks (shown once, hashed). No email reset.
- **App lock** options: Off · Immediately · After 5 minutes away · After 1 hour away.
  - The app **covers itself the moment it's put away** (app switcher never shows balances) and
    stays locked across reloads until unlocked.
  - On open, the **passkey prompt appears automatically** (like Face ID in a banking app); if
    the browser refuses without a tap, the Unlock button is already there and no error is shown.
  - No record of leaving → lock (safe side).
- **Offline PIN** (4–8 digits, device-local, never account auth): on-screen pad **submits on the
  last digit**, hardware digits and Backspace work, wrong tries counted, **5 wrong wipes the
  PIN** so only the passkey unlocks. Only a salted hash is stored.
- Turning lock on counts from that moment (doesn't lock immediately).

---

## 14. Other tools

- **Surplus (cash to payday):** 14-day projected balance, "free to move" = lowest point minus a
  cushion. Card payments are never projected as outflows; card info is context only. Hand-added
  paychecks/bills; detected schedules are *suggestions that count only after added*; tap a
  schedule to edit amount/days/name; "Remove" deletes, suggestions are dismissed.
- **Recurring:** active charges soonest first.
- **Debt, Mortgage, Savings, Retirement, Taxes, Investments, Binder:** planning tools, same
  scaffold: hero number, one chart with chips, editable facts. Number boxes report every
  keystroke and commit on blur/Enter; clamping happens on save, not while typing.
- **Monarch import** is a history import and never touches the carry chain.

---

## 15. Copy tone

- Plain, calm, first-person-neutral. Short sentences, no exclamation marks, no jargon.
- Debt language for overspend ("Over budget", "carried deficit"), never failure language.
- Toasts read as outcomes: `Merchant → Category`, `12 confirmed`, `Transfer confirmed`.
- Buttons are verbs naming the object: "Forgive $93", "Confirm all (12)".
- Dates short ("Sep 23"); times in the owner's local time.
- Money is signed, tabular-aligned, whole dollars in planning, cents where it's a record.
- Errors say what failed and the one fix; stale notes say who and how long.

---

## 16. Accessibility & input details

- 44×44 minimum touch targets; labelled controls (`Select {merchant}`, `Range` radio group,
  `Steps` list).
- Never encode money direction by colour alone: sign, position and weight first.
- Every monetary figure uses tabular figures (alignment is a hard requirement).
- No page zoom; fixed-scale layout; 16px inputs so iOS doesn't zoom on focus.
- Text fields: Enter blurs/commits, Esc reverts in money fields.
