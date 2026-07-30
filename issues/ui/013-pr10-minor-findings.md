# [UI-013] UI hardening batch: PR #10 MINOR findings

## Domain

ui

## Status

done

## Priority

P2

## Model

opus — five scoped fixes with the reviewer's diagnosis already written.

## Dependencies

- Depends on: UI-006, UI-007, UI-008
- Blocks: —

## Spec References

- PR #10 review (2026-07-28), findings 11/12/14/18/19

## Summary

The pr-reviewer's MINOR findings in the UI slice, batched (the PR #9 → SERVER-022/CLI-008
precedent). Finding 13 is already filed as UI-012.

## Acceptance Criteria

- [x] (11) `thread/Turn.tsx:39-48` — trace parsing matches §6 exactly: `↳ ` requires the trailing
      space, no indented lines, and the check runs on the true final line (before
      attachment-ref splitting can promote an earlier line).
- [x] (12) `thread/parseFormBlock.ts:112-129` — with two unanswered forms sharing an option
      string, the answer attaches to the right form (use the known `formTs` instead of
      re-deriving from prose).
- [x] (14) `reader/LockBanner.tsx:40-49` — the held-duration line ticks (a minute-interval
      re-render) instead of freezing at mount.
- [x] (18) editor/anchor edge batch: run-location vs adjacent URL syntax; the length-equality
      licence for server offsets vs length-compensating constructs; the no-entities test pins
      decimal + named forms too; trace cache holds ≥2 entries; post-save self-echo adoption
      skipped at source rather than repaired downstream.
- [x] (19) board polish: no-change Edit-query blur sends no PUT; a plugin column without `query`
      does not fetch the unfiltered doc list; pending-turn drop predicate can't transiently hide
      a second in-flight turn.

## E2E Verification Log

**Implemented on: opus** (ui-dev, 2026-07-29). Environment: workspace
`/tmp/corpus-s014-uihard-ws` (from-source CLI), workspace server on `9150`, Vite on `5286`,
Chromium via Playwright. Every observation below is from that running stack.

### (11) The trace grammar — `Turn.tsx`

`TRACE_PREFIX` is now `"↳ "` (arrow **and** space); the final line is `trimEnd`ed only, never
left-trimmed, so an indented arrow stays content; an arrow with nothing after it is content, not an
empty trace; and `Turn` reads the trace off `turn.body` **before** `splitTurnAttachments`, so
removing the reference block can no longer promote an earlier line into final position.

Two agent turns seeded through the real CLI (`thread reply --from agent`) and read back from the
rendered DOM:

```
{ who: "agent",
  body:  "Checked the rate table. a line ↳ indented, not a trace",
  trace: "edited the model doc — 3 lines" }
{ who: "agent",
  body:  "Not a trace here. ↳ this arrow is not last",
  trace: null }
```

The indented `↳` survives in the body; the real trailing trace is stripped and rendered in
`.turn-trace` (the arrow itself re-supplied by CSS); and the turn whose true last line is an
attachment reference gets **no** trace at all.

Tests: new `apps/ui/src/thread/Turn.test.ts` (9 cases), including one that runs
`splitTurnAttachments` first and shows it *would* have promoted the earlier line — so the ordering
in `Turn` is a decision with evidence rather than an accident.

### (12) Two forms sharing an option — `parseFormBlock.ts` + the card

Two fixes, and the browser is what showed the first one was not enough.

1. **Replay**: `mapFormAnswers` keeps every unanswered form open instead of a single "current" slot
   that a second form silently evicted (which meant the earlier form could never be answered at
   all). An unattributed answer goes to the earliest still-open form offering it.
2. **The known `formTs`**: `POST …/turns/{ts}/form` addresses a form by `ts`, but the turn the
   server writes back is prose naming only the option, so replay alone still guessed. `FormBlock`
   now reports `(formTs, option)` on success, `ThreadCard` holds those pairings in browser-local
   state, and `mapFormAnswers(turns, submitted)` lets a known pairing win.

**Observed with only fix 1 in place** — two open forms both offering "Yes", answering the *second*:

```
POST /api/threads/th_lz27naz3/turns/2026-07-29T06%3A59%3A31Z/form
after: form 06:59:30 "Should I file the first quote?"  answered "Answered — Yes"   ← wrong form
       form 06:59:31 "Should I file the second quote?" answered null               ← still live
```

**After fix 2**, same shape, fresh thread `th_wevu4g5h`:

```
POST /api/threads/th_wevu4g5h/turns/2026-07-29T07%3A04%3A13Z/form
after: form 07:04:12 "Should I file the first quote?"  answered null               ← still live
       form 07:04:13 "Should I file the second quote?" answered "Answered — Yes"   ← the one clicked
```

The residual limit is documented in the code: after a reload the pairing is gone and the ordering
rule takes over, because the file genuinely does not say which form an answer belongs to. Closing
that would need a field on the answer turn — a contract/server change, **not raised as a blocker**
but noted for the orchestrator.

Tests: `parseFormBlock.test.ts` (7 new cases across the fallback and the known pairing) and a new
`ThreadCard.test.tsx` describe that clicks the second form's option through the real card and
asserts the first form stays live with its submit button.

### (14) The lock banner ticks — `LockBanner.tsx`

`useMinuteClock` re-renders on a 60 s interval and feeds `lockNote(lock, now)`; the interval is
cleared on unmount. An agent lock was taken with the real CLI
(`corpus lock acquire doc_6jvfnwr4 --from agent`), the reader opened, and the banner read **without
reloading or navigating**:

```
t+0s   : "agent is editing — holding the edit lock, started just now · document is read-only"
t+65s  : "agent is editing — holding the edit lock for 2 min · document is read-only"
t+127s : "agent is editing — holding the edit lock for 3 min · document is read-only"
```

Before the fix that line was computed once at mount and said "started just now" for as long as the
reader stayed open — nothing else re-renders the banner, because the `Lock` object does not change
while it is held.

### (18) Editor / anchor edge batch

**Run location vs an adjacent URL.** A link's destination is emitted *after* its text, so the cursor
the text run leaves behind still had the whole URL in front of it: `[a](https://x.test/bold)**bold**`
located the bold run **inside the destination**, four words early. `alignTrace` now advances past
`](…)` with a balanced-parenthesis scan that honours backslash escapes, and only when the markdown
really reads `](` at the cursor. Verified in the browser on a real document
(`doc_wdgzu566`, body `[a](https://ex.test/bold)**bold** tail and more prose.`) with a real anchored
thread; the server resolved the selector to offsets 27–31 (`slice = "bold"` — the visible word, not
the URL's copy at 20–24) and the rendered DOM is:

```html
<a href="https://ex.test/bold">a</a><strong><span data-anchor="anc_1fcbe6b3" class="anchor-hl">bold</span>…</strong> tail
```

i.e. the highlight sits inside the `<strong>`, over the word the reader selected. The unit test in
`offsetMap.test.ts` was confirmed to fail (3 assertions) with the fix removed.

**The length-equality licence.** `offsetsComparable` no longer trusts equal totals: normalisation
both shortens (setext → ATX) and lengthens (indented code → fenced), and one of each cancels out
while every offset between them shifts. It now requires the same line count and the same length per
line — what the licensed equal-length respellings (`*`→`-`, `_x_`→`*x*`) actually preserve. The test
builds the cancelling pair through the real serializer and asserts both the total really does match
(22 = 22) and that it is refused anyway.

**The no-entities assertion.** It matched `/&#x/i` only, so a printer that started writing `&#32;`
or `&nbsp;` would have walked straight through it. `CHARACTER_REFERENCE` now lives in `escape.ts`
next to the `&` rule that decides when one would be read back, covers hexadecimal, decimal **and**
named forms, and excludes a backslash-escaped ampersand (which is what the escaper writes). Both
corpus-wide assertions import it, and the non-canonical corpus grew decimal and named cases.

**The trace cache.** One slot per question meant two open readers evicted each other on every
render — and the board is several columns of readers side by side, so that is ordinary use. Both
caches are now capacity-bounded LRUs (`TRACE_CACHE_ENTRIES = 6`), with tests for alternation (2
computations over 10 rounds, was 20), a full board's worth, and bounded eviction.

**Post-save self-echo.** After a save the refetch hands back the body the user just typed, so
`canonical` changed to text the editor was already showing and `DocEditor` replaced the document
with an identical one — discarding caret, selection and every anchor decoration, which
`useAnchorLayer` then had to notice and repair on a `preventUpdate` transaction. The adoption is now
skipped at source: `DocEditor` compares the incoming canonical against what the editor would
serialize and declines. Pinned by document **identity** (`setContent` always builds a new node, so a
matching object is the only proof no replacement happened); the test fails without the guard. The
downstream repair stays, because a genuine external change still replaces the document, and its
docblock now says which case reaches it.

### (19) Board polish

**No-change Edit-query blur.** `sameQuery` compares the parsed query against the column's stored
one (key order is not meaning); the rename branch had always declined a no-op, the query branch had
not. In the browser, against the seeded Inbox view:

```
stored query: "folder=inbox"
blurred untouched    → writes: []
re-typed identically → writes: []
a real change        → writes: ["PUT /api/docs/doc_seedinbox"]
restored             → writes: ["PUT /api/docs/doc_seedinbox"]
```

**A plugin column with no `query`.** A pinned `type: view` document was created with
`column: _fixture/sample` and **no `query` key at all** (checked on disk). The board rendered the
plugin's own body and issued:

```
?pinned=true&sort=order&type=view · ?needs=me · ?folder=inbox · ?status=open&type=thread   (×2 loads)
unfiltered GET /api/docs: 0
```

The split into `PluginColumnBody` (PLUGINS-001) already prevented this; the regression test now
pins the literal case the finding names — `query` absent rather than `query: {}`.

**The pending-turn drop predicate.** A provisional turn carries the *client's* timestamp and its
confirmation carries the *server's*, which is later — so with two appends in flight the confirmation
of the first could satisfy "any confirmed turn at or after" for the second as well, and the second
turn would blink out of the conversation until its own response landed. `mergePendingTurns` now
pairs in order: one confirmed turn cancels exactly one provisional. Two unit cases cover it. Not
staged in a browser: forcing two overlapping appends needs latency control the real composer does
not expose — flagged rather than claimed.

### Rider — the buffer parked behind a foreign lock

**Decision: keep the park, and guard the one exit that can still lose the text.** Sending is not an
option — the server refuses a write to a locked document (§7), so a send would produce a `423` and
an error chip about a failure the user cannot act on. Reproducing the text outside the surface (a
draft store outliving the reader) would be a second source of truth for a document body, which is
the thing §5 is most careful about. What *is* worth intercepting is leaving the page: `useAutosave`
now installs a `beforeunload` handler that fires **only** when a buffer is pending *and* the
document is locked by another party. An ordinary pending save is left alone, because `pagehide`
flushes it and a prompt on every unload would be a dialog people learn to dismiss unread. All of
this is now written down in `flush`'s docblock rather than left implicit.

Browser evidence:

- Negative case, real app: typed into a document inside the debounce window, closed the tab with
  `runBeforeUnload` → **no dialog**, and the save landed (`committed · git ✓`). No nuisance prompt.
- Positive case: **could not be staged through the UI**, and the reason is itself reassuring. Two
  attempts, both recorded: taking the agent lock while the user typed returned `409`, and taking it
  after a forced `break` also returned `409` — `useUserLock` re-acquires on the heartbeat while the
  editor is focused. So while a user is typing, a foreign lock cannot arrive; the state needs the
  user lock to lapse *while* a save is still outstanding, which is the narrow race the completion
  handler documents. The guard is pinned at the hook level instead, against the real `useAutosave`
  in jsdom: three cases in `useAutosave.test.tsx` (parked-under-lock prompts; no buffer does not;
  an ordinary pending save does not).

### e2e suite

`npm run e2e` was **not** run (single-holder resource). Every existing spec touching these surfaces
(`thread.spec.ts` `.turn-trace`, `editor.spec.ts` `.doc-editor`, `form-comment`) asserts CSS against
**static HTML fixtures**, not live app logic, so none of them exercises a code path this issue
changed. No e2e spec needed updating.

### Checks

`npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check` — all clean.
Scoped `vitest run apps/ui packages/kit` → **119 files, 1773 tests, all passing**.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed

## Rider (orchestrator, 2026-07-28 — re-review finding 2)

`useAutosave.ts:243-248` — a buffer parked behind a foreign lock is lost if the surface unmounts
before the lock clears. The chip is honest while mounted and the server would refuse the write
anyway, so there may be no better move — but consider surfacing the parked state more loudly
(the text's only copy dies with the tab). Decide and document rather than leave implicit.
