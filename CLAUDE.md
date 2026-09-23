# Rise — project instructions

Personal budgeting tool. Single user. Installable PWA on Cloudflare Workers + D1.

## Read first

- `docs/SPEC.md` — behaviour and logic. **The authority.** When code and SPEC disagree, SPEC wins.
- `docs/ARCHITECTURE.md` — stack, schema, API surface.
- `docs/DESIGN-SYSTEM.md` — tokens, the five-zone detail template, the budget rail.
- `docs/TASKS.md` — build order. Work tasks in sequence.

## Non-negotiables

1. **Money is integer cents. Never floats.** Not in the DB, not in the engine, not in transit.
2. **The budget engine (`packages/shared/src/budget`) is pure.** No I/O, no imports with
   side effects. It must reach 100% branch coverage before Phase 2 starts.
3. **Raw SQL lives only in `apps/api/src/db`.** Every query function takes `userId` first
   and filters on it.
4. **Nothing about the user's money changes silently.** Period close, carry recalculation,
   rule creation, and deficit forgiveness are all explicitly confirmed. A background job
   never restates a closed month.
5. **Types are inferred from Zod schemas** in `packages/shared/src/schemas`. Never maintain
   a parallel hand-written type.
6. **Overspend renders in `--clay`, never red.** Rollover means going over is a debt, not a
   failure, and red contradicts the model.
7. **Gold never carries text.** Use `--gold-text`.
8. **Every monetary figure uses tabular figures.**

## The 15 edge cases

`SPEC §11` lists 15 cases that must each have a named, passing test. They are the ones that
silently corrupt financial data — duplicate CSV rows, credit-card payments counted as
spending, pending-to-posted drift, late arrivals into closed periods. Treat them as the
real acceptance bar.

## Working style

- Write the test from the SPEC before the implementation.
- Prefer a pure function in `packages/shared` over logic in a route handler.
- If the SPEC is ambiguous, say so and pick the more conservative reading — the one that
  asks the user rather than guessing about their money.
- Do not add dependencies without a reason that survives the 10 ms CPU budget.

## Kanban

Work is tracked on the board. Move a card to `in_progress` before editing code, and to
`review` when written but not yet verified.

```
KB="/Users/Caleb/Claude Code/Visual Kanban/kanban.py"
python3 "$KB"                       # what to work on next
python3 "$KB" move VK-N in_progress
python3 "$KB" note VK-N "a decision or surprise"
python3 "$KB" move VK-N review
```
