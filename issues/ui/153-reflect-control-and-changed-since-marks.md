# [UI-153] The Reflect control, and what changed since the agent last looked

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-148, SERVER-137
- Blocks: —

## Spec References
- SPEC.md §7 — rider 9 (reflection; "the board shows what is unreflected")
- SPEC.md §10 — the board bar

## Summary
A Reflect control on the board bar asks for a reflection now and carries the corpus count of unreflected changes; every row whose `updated` is later than the clock is marked, every column counts its own, and a board tab carries a dot while it holds any. When the job lands the marks clear.

## Acceptance Criteria
- [x] `useReflectStatus()` reads `GET /api/workspace/reflect` and follows the SSE kinds SERVER-137 emits; no polling.
- [x] Board bar: **Reflect · N changes since <relative time>**; while pending: "reflecting…", disabled; with `changed: 0`: "Reflect" enabled (a person may still ask); a `pending: true` answer on click shows the pending state, never an error toast.
- [x] "reflected <relative>" beside the control opens the last digest thread (`lastDigest`) as a loose path on the current board (UI-149's left-edge placement); when `reflected` is null the text reads "never reflected".
- [x] A row with `updated > reflected` **and** `lastActor !== "agent"` (both on the row, CONTRACT-074) shows a small mark (the prototype's dot vocabulary, a distinct glyph from "open elsewhere"); the column head shows "N changed" when N > 0; a board tab shows a dot when any of its columns' documents are changed (derived from the rows already loaded, never an extra request).
- [x] A configured `quiet` of `0` changes the control's title to say reflections are manual only.
- [x] e2e `reflect.spec.ts`: stub clock and counts; marks present; click → pending state; SSE clock move → marks clear and count drops.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/reflect/{useReflectStatus.ts,ReflectControl.tsx}`, tests
- `apps/ui/src/shell/BoardBar.tsx` — mount
- `apps/ui/src/board/ColumnHead.tsx`, `ColumnList.tsx` (row mark), `BoardBar.tsx` (tab dot)
- e2e `reflect.spec.ts`, `stubCorpus.ts`

### Key Implementation Details
- The mark compares two timestamps already on hand; no per-row request. The tab dot derives from the columns the board already fetched.
- The control never grows: the count is a fixed-width tabular number (SPEC §10: nothing resizes because of what it holds).

### Edge Cases
- The digest thread and the changelog entries a reflection writes are never marked, at any time: their `lastActor` is `agent`. The predicate is the same one SERVER-137 counts with, so the control's number and the marks on screen agree without a request.

## Testing Strategy
Vitest for the hook and derivation; Playwright for the flow.

## E2E Verification Plan
### Verification Steps
1. Real app: edit two documents; the control reads "2 changes"; click; "reflecting…"; run the agent; marks clear; "reflected just now" opens the digest.

## E2E Verification Log

**ui-dev, 2026-08-22, on opus.** Two rounds: the stubbed browser suite, and the
real application against a real workspace server.

### The real app (a real server, a real Chromium, no stubs)

Workspace created with `corpus init` in a scratch directory, server started on
**8766** (the user's own server on 8765 was never touched), UI served by that
server with its injected token — the production path, not the dev proxy. Driven
with Playwright's Chromium at 1440×900.

1. **Before anything.** `corpus reflect --status --json` →
   `{"reflected":null,"pending":"evt_lwdefe54c3lb","changed":11,"lastDigest":null,"quiet":30}`.
   Board bar read **`reflecting…`, disabled**, title *"A reflection is already
   running over the whole corpus…"*, clock **`never reflected`** and **not** a
   button (no digest exists). `.boardbar` measured **38px**.
2. **Two documents created as the user** (`corpus doc create --type note
   --folder inbox`), pending event abandoned. Status → `changed: 13`. In the
   browser, with no reload of the assertion harness:
   - control: **`Reflect · 13 changes`**, enabled — no `since` clause, because
     `reflected` is null and there is no "since" to name;
   - **Attention tab: dot**; *By status* and *Files*: no dot (their rows are not
     loaded — the honest gap, never a claim);
   - **Inbox column head: `2 changed`**; both rows carried the diamond;
   - Attention and Open threads columns: no `.col-changed` at all (zero says
     nothing).
3. **Pressed Reflect.** Control flipped to **`reflecting…`, disabled**. No toast,
   no alert, no progress bar. One `POST /api/workspace/reflect`, no body.
4. **The agent ran, in a process the browser knows nothing about**:
   `corpus queue claim-all --from agent` → `evt_fumjzh7y53nf`, a digest thread
   written, `corpus queue complete`. **With the page left open and never
   reloaded**, four seconds later: control **`Reflect`** enabled, clock
   **`reflected just now`**, **tab dot gone**, **`2 changed` gone**, **0 marks**
   on 2 rows. `corpus reflect --status` agreed: `changed: 0` — and it is 0
   although the agent had just written a thread, which is §7's amendment holding
   end to end.
5. **The digest link.** Repeated with the digest filed against the job
   (`--job evt_…`), so `lastDigest` was set:
   `{"reflected":"2026-08-23T06:17:55Z","pending":null,"changed":0,"lastDigest":"th_su6qjv4e","quiet":30}`.
   The clock rendered as a **button** titled *"Open the last reflection's digest
   thread"*; clicking it opened `[data-reader-doc="th_su6qjv4e"]` and issued
   `GET /api/docs/th_su6qjv4e`, `/related`, `/api/threads/th_su6qjv4e` and
   `/seen`. **`lastDigest` stays null when the agent files its digest without
   the job id** (SERVER-137's own note), and the control then renders the clock
   as plain text — observed in step 4.
6. `pageerror` and console errors: **none**, in every run.

### The stubbed browser suite

`apps/ui/e2e/reflect.spec.ts` — 7 specs, all passing
(`CORPUS_UI_PORT=5373`, `--workers=1`): the marks/count/dot/control agreeing on
one board; a quiet corpus saying nothing; the ask and its pending state; the
marks clearing on an `invalidate` frame naming `["reflect"]` over a **real** SSE
stream with no reload; the digest link causing the reader's document read; the
`quiet: 0` title; and the bar staying **38px** with the tab's `x` and `width`
unchanged between the loud and quiet labels.

### Falsification — every rule broken, and the test that caught it

| Mutation | Test that went red |
| --- | --- |
| `Row` never renders `ChangedMark` (kit **`dist/` rebuilt**) | `Row.test.tsx` "draws the diamond…", and `reflect.spec.ts` "marks the rows…" |
| `isUnreflected` drops its `lastActor === "agent"` guard (contract **`dist/` rebuilt**) | `unreflected.test.ts` "never counts the agent's own writes", `useChangedBoards.test.tsx` "does not mark a board whose only recent write is the agent's" |
| `useChangedBoards`' observers `enabled: true` | `useChangedBoards.test.tsx` "issues no request of its own, not even for a board it cannot answer for" |
| `useReflectStatus` caches under `["reflect-status"]` | `useReflectStatus.test.tsx` "caches under the key the server invalidates", `reflect.spec.ts` "the marks clear when the reflection lands" |
| `reflectControlTitle` always says the automatic sentence | `unreflected.test.ts` and `ReflectControl.test.tsx` "says reflections are manual only…" |
| `useChangedBoards` flattens an unread clock to `null` | `useChangedBoards.test.tsx` "claims nothing before the status has arrived" |
| `ColumnHead` never renders the changed count | `ColumnHead.test.tsx` "says how many of its documents the agent has not looked at" |

**Two tests could not fail as first written, and both were rewritten.**

- The `enabled: false` proof passed under `enabled: true`, because the kit caches
  with `staleTime: Infinity` and an enabled observer on a *fresh* entry fetches
  nothing either. It now seeds a board whose column is real and whose rows were
  never loaded — the only case where "reads the cache" and "fetches what it
  needs" part company — and asserts the wire directly.
- The unknown-clock proof passed under `?? null`, because on the first render
  the view query has not answered and there are no columns to read at all. It
  now hangs `GET /api/workspace/reflect` while every other route answers, which
  is the state the distinction is actually about.

The contract mutation is also a record of the **`dist/` trap** one level up from
the kit: mutating `packages/contract/src/schemas/reflect.ts` alone left all 23
tests green, because `apps/ui` resolves `@corpus/contract` through its `exports`
map into `dist/`. It only went red after `npm run build -w packages/contract`.

### One geometry defect found and fixed by its own test

The board tab's dot was first rendered straight into the tab's flow. The bar
stayed 38px, but the **tab grew 14px** while the dot was there — measured
159.33px against 145.33px — so a reflection landing shifted every tab after it.
That is exactly SPEC.md §10's *"nothing resizes because of what it holds"*. The
mark now has a **reserved 6px slot on every tab**, painted only when there is
something to say, which is the arrangement `.row::before` already uses for the
staleness rail.

### Checks

- `npm run build` — clean.
- `tsc --noEmit` in `apps/ui` — clean.
- `eslint` over every touched file — clean (one `no-unnecessary-type-assertion`
  found and fixed by deleting the cast, never by disabling the rule).
- `prettier --check` over every touched file — clean, run through
  `./node_modules/.bin/prettier` rather than the proxy.
- Vitest across `apps/ui/src` and `packages/kit/src` — 4373 tests, one failure
  which was `packages/kit/src/index.test.ts`'s published-surface list not naming
  the three new exports; the list was updated and it passes.
- Playwright `boards`, `board`, `column-header`, `digit-geometry`, `smoke`,
  `console-strip-geometry`: 49 passed, 2 failed. Both failures are UI-149's
  rider-3 change landing in the same tree — they assert a reader opening *inside*
  a query column, which rider 3 replaced with a path column — and neither touches
  anything this issue changed.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[UI-153]` prefix
