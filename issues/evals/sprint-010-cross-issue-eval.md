# Evaluation: sprint-010 cross-issue (TEST-113…126)

**Date**: 2026-07-28
**Sprint**: sprint-010
**Verdict**: **FAIL** — 13 of 14 criteria met; **TEST-116 fails**: the aggregate unread pill was
never wired to a document row, so the coupled `unreadThreads` commit is correct on the wire and
invisible on screen.

Environment: one `corpus init` workspace, the **production-served** board
(`corpus server start` → the URL the server printed, SERVER-024's injected token, no Vite, no env
var), real CLI mutations, a parallel `/events` capture, real headless Chromium. No source file was
read.

## Criteria Results

| #   | Criterion | Result | Notes |
| --- | --------- | ------ | ----- |
| 113 | Search → reader → back is one continuous act | PASS | ⌘K → `mortgage` → ↓↓ → ↵: overlay closes, **Finance** takes `.col.flash` (`border-color rgb(59,95,151)`), the document opens in that column's real reader, and Back returns to the column's **list** (`readingcols=0`, 16 rows visible). Network for the whole hand-off: `GET /api/docs/doc_dgwek2hm`, `?parent=…&type=thread`, `?references=…` — nothing else, no reload, no flicker. |
| 114 | One escape chain, three registrants | PASS | Console expanded + reader + focus mode + search overlay + ⋯ menu, then Escape repeatedly: `overlay → (menu) → focus → reader`, one layer per press, console untouched throughout. Popovers close before their host. |
| 115 | The console's `↗ open` and search's `↵` are the same code path | ACCEPTED (log) | Source-level grep. Behavioural corollary re-derived: both produce the identical scroll + `.col.flash` (accent border, removed after ~1.5 s) + open-in-reader sequence, and both honour the same fallback. |
| 116 | The aggregate unread badge closes its loop end to end | **FAIL** | See FAIL-1. |
| 117 | A failed job is one thing seen from three surfaces | PASS | `corpus queue fail` → the console's job row (`job-dot failed`), the strip's `1 failed` in `--signal`, and the Attention column's row with its `failed job` reason chip — all describing `evt_uehma6cyqfos`, all live. Retry from the console cleared all three without a reload. Sprint-009's unit-only coverage gap for `failed-job` is closed. |
| 118 | The board still works with the console expanded | PASS | Drawer forced to `540px` (60vh): board 258px tall, still scrolls horizontally (`scrollLeft` 300 → 368 with snap), a reader still opens at **560px**, rows still clickable, and the search overlay still centres at `y = 63` = 7vh. |
| 119 | The production-served board carries all of it | PASS | **Every browser measurement in all four verdict files was taken against the production build served by `corpus server start`** — reader, search overlay and console all worked against real data with the injected token. No Vite was used by this evaluator at any point. |
| 120 | No document content ever crosses the SSE stream | PASS | Full `/events` capture across the console session (20 frames) plus a second capture across the unread-movement sequence: one event name only (`event: invalidate`), `keys` only. Greps for the job-log line texts (`"reading thread context"`, `"ERR subagent"`, `"a line nobody"`) and for a document title (`"Mortgage"`) all returned empty. |
| 121 | Generated artifacts green at the tip | PASS | `node --import tsx scripts/check-generated-artifacts.ts` run **twice in a row**: identical output both times, exit 0 — `✓ API contract is up to date (packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts)`, `✓ CLI reference is up to date (docs/cli.md)`. |
| 122 | The whole repo gate is green at the tip | ORCHESTRATOR | Explicitly out of this evaluator's scope (single harvest run; machine-load discipline). Test-file count re-derived instead: **268** files repo-wide (`find apps packages plugins -name '*.test.ts*' \| grep -v node_modules \| wc -l`) — `apps/server` 112, `apps/cli` 52, `apps/ui` 46, `packages/contract` 34, `packages/kit` 25 — against the contract's 241 baseline (server 111, cli 51, contract 34, ui 24, kit 18). **+27 files**, and the growth sits where this sprint worked. |
| 123 | The merged coverage gate holds | ORCHESTRATOR | Not re-run here. |
| 124 | e2e green at the tip with the reserved ports respected | ORCHESTRATOR (partly re-derived) | Not re-run. Two of its sub-claims verified statically: `apps/ui/e2e/` now holds `smoke, board, reader, search, console` specs, `smoke.spec.ts`'s `.console-strip .c-failed` → `"server unreachable"` assertion is **intact at line 244**, and the "inert affordances" test is now honestly named *"the search bar is wired and the compose button is still inert"* with assertions to match (TEST-46/85). `8765` verified **unbound** before, during and after this evaluation. |
| 125 | The three artifacts the next issues depend on are written down | PASS | UI-005's log carries the kit's added `CorpusClient` methods and hooks verbatim, the `DocView` body-render seam with its single call site (`apps/ui/src/reader/DocView.tsx:102`) and the escape-registry API (`useEscapeLayer({active, priority, onEscape})` with `EscapeLayerPriority`); UI-009's log states `useOpenInColumn`'s precedence (candidacy filter on folder/type/status, `columns[0]` as last resort) — re-derived in the browser both ways (folder match, and first-column fallback for a subject-less job). |
| 126 | Nothing left running and the repo is clean | PASS (one finding) | This evaluator: both servers stopped by pid, the SSE client killed by pid, my scratch removed by name; `lsof` shows **nothing** bound on `8765`, `8960`–`8994` or `5200`–`5299`. All four issue logs state `implemented on: opus`. **However**: 75 `/tmp/corpus-s010-*` paths from the implementing agents are still on disk — see FIND-1. |

## Failures

### FAIL-1: no document row renders the aggregate unread pill

**Criterion**: TEST-116 — *"the parent row's aggregate pill goes from 2 to 1 with NO reload, and
`GET /api/docs`'s `unreadThreads` for that document agrees."* Also the sprint's Integration Points:
*"Wiring `unreadCount={row.unreadThreads}` at the `ColumnList.tsx` call site is a one-line change —
assign it explicitly … rather than leaving the field populated on the wire and unused on screen,
which would make TEST-116 unverifiable."*

**Expected**: a document row whose `unreadThreads > 0` shows an aggregate count, and that count
decrements live when one of its threads is opened.

**Observed**: `unreadThreads` is correct on the wire and **nothing renders**. The document row's
badge slot is empty; only *thread* rows render an unread badge.

```
wire:  GET /api/docs → doc_affs5ced  unreadThreads = 3   unread = null

DOM (the same row, Finance column):
<div class="row" role="button" data-row-doc="doc_affs5ced" data-row-type="note" …>
  <div class="row-top">
    <span class="type-glyph">note</span>
    <span class="row-title">Mortgage options</span>
    <span class="row-badges"></span>      ← EMPTY
  </div>
  …

for comparison, a thread row in the same column:
  <span class="row-badges">
    <span class="unread" aria-label="Unread — a turn you have not seen">new</span>
    <span class="working-dot" …></span>
  </span>
```

Scanning every descendant of the document row for a class matching `/unread|badge|pill/` or a bare
digit returns only the empty `row-badges` element itself.

**Steps to reproduce**:
1. `corpus init <ws> --port 8982`; `corpus server start`; open the printed URL.
2. Create a note, open **three** threads on it (`POST /api/threads` with `parent: <noteId>`), and
   leave them unread. Pin a view column that lists the note.
3. `GET /api/docs` → the note's row carries `unreadThreads: 3`.
4. In the board, find the note's row. Observe `.row-badges` is empty — no count, no pill.
5. Open one of its threads in a column reader (`POST /api/threads/{id}/seen` fires, that thread's
   own `new` badge clears). `GET /api/docs` now reports `unreadThreads: 2`. The note's row still
   shows nothing, so there is no "2 → 1" to observe.

**Why this matters**: the coupled CONTRACT-012 + SERVER-027 commit exists to feed this pill. Its
server half is correct and independently verified (see `issues/evals/CONTRACT-012-eval.md`), but
its only consumer is unwired, so the sprint's stated *"whole point of the coupled commit"* is not
demonstrable in the product. Note that the wiring is likely **more than one line**: the shipped
`Row` renders its unread badge under `row.unread === true`, and `row.unread` is `null` on document
rows by contract — so a document-row branch is needed as well as the `unreadCount` assignment.

**Owner**: UI-005's `ColumnList.tsx` call site, per the sprint contract's Integration Points.
The other half of TEST-116 — *"then open the PARENT document: the remaining count does NOT change"*
— is already proven at the data layer (TEST-39: opening a parent fires **zero** `/seen` calls and
the wire's per-thread `unread` state is unchanged).

## Additional findings (for the phase PR reviewer)

### FIND-1: TEST-126's scratch-cleanup half is not satisfied

`ls -d /tmp/corpus-s010-*` → **75 paths** left behind by the implementing agents (log files, hash
captures, JSON dumps, `/tmp/corpus-s010-e2e-K77ydi`, `/tmp/corpus-s010-401`, …). The contract
requires *"every `/tmp/corpus-s010-*` path created here removed BY NAME"*. This evaluator did not
delete them — they are not mine, and the same contract forbids blanket `rm -rf /tmp/corpus-*`.
Ports and processes are clean; only the filesystem is not.

### FIND-2: three UI-level findings recorded in the per-issue verdicts

- The Delete menu item's sub-label renders in `--ink-3`, not `--signal` (UI-005 FAIL-1) — and the
  UI-005 log claims otherwise. This is the **only** sampled log claim across four issues that did
  not reproduce.
- The force-unlock toast asserts *"the agent's deferred edit was re-queued"* unconditionally, even
  when no deferred event existed (UI-005 FIND-2).
- Omnibox create omits `folder: "inbox"` from its POST body and relies on the server default, while
  the row's copy promises inbox (UI-009 FIND-1).
- A non-id `[[token]]` renders as a live link into a dead reader (UI-005 FIND-3).
- Every toast renders as two identical DOM nodes, in all three UI issues.

### FIND-3: what this evaluator could not re-derive

Four criteria rest on the implementers' evidence because they are not observable through a public
interface: TEST-80 (statement count / `EXPLAIN QUERY PLAN`), TEST-81 (before/after timings, which
need a code edit), TEST-14/33/67/115 (source-level greps for unit reuse), TEST-59 (a unit
round-trip). In every case a behavioural corollary was checked instead and matched.

## Summary

13 of 14 criteria met; TEST-116 fails. The three surfaces genuinely compose: search hands off to
the reader and back without a reload, one escape registry serves overlay/focus/reader/menus with
the console untouched, a failed job is the same event on three surfaces and clears from all three
live, the board survives a 60vh drawer, and nothing but `invalidate` frames with `keys` ever crosses
SSE — all verified against the production-served board, which is what an installed user gets. The
single failure is a wiring gap, not a defect in anything built: `unreadThreads` is computed
correctly and rides every row, and no row shows it. **FAIL** until the pill is wired and the
2 → 1 decrement can be observed.
