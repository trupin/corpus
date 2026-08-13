# [UI-056] The e2e stub misrepresents the server: anchors resolve worse than reality

## Domain
ui

## Status
done — verified 2026-08-13 (INFRA-027): the work landed and PLAN.md has said so; this file was never ticked. Evidence: a commit carrying the id, or the named implementation and its tests in the tree.

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-051
- Blocks: an e2e spec for UI-051's turn-selection commenting

## Spec References
- SPEC.md §6 "Anchoring" (the resolution ladder the real server implements)

## Summary
Found by UI-051 (2026-08-03) while trying to write a Playwright spec for
selection-anchored child threads. Two gaps in `apps/ui/e2e/stubCorpus.ts`, and
the first is the dangerous kind — a stub that is **wrong**, not merely absent:

1. **`resolveAnchor` implements only rung 2 of the ladder** (unique `exact`). A
   framed selector for a duplicated phrase — the exact case §6's prefix/suffix
   framing exists to handle, and the case PR #19 shipped a MAJOR over — resolves
   perfectly against the real server and reports **`orphaned`** against the stub.
   So a spec asserting correct behavior fails, and a spec written to match the
   stub would encode a lie. Any future anchor work will hit this and may well
   "fix" the product to match the stub.
2. **No `GET /api/threads/{id}`**, so a `ThreadCard` never renders turns under
   the stub at all — which is why UI-051 shipped with real-browser verification
   and component tests, but no Playwright coverage.

UI-051 deliberately did not extend the shared e2e infrastructure while two other
agents were editing that directory. That was the right call in the moment and
leaves this issue owing the coverage.

## Acceptance Criteria
- [x] The stub's `resolveAnchor` implements the same ladder the server does, or
      is honest about what it does not implement — a framed duplicate must not
      report `orphaned` when the real server resolves it
- [x] A test pins stub and server against the same fixtures, so the two cannot
      drift again silently (this is the criterion that matters — the others are
      symptoms)
- [x] `GET /api/threads/{id}` served, so `ThreadCard` renders turns
- [x] An e2e spec for UI-051: select a phrase inside a turn, comment, assert the
      child thread's selector and that the highlight lands on the selected
      occurrence — including the duplicated-phrase case
- [x] Existing specs that depend on today's stub behavior still pass, or are
      corrected where they encoded the stub's error

## Technical Design
### Files to Create/Modify
- `apps/ui/e2e/stubCorpus.ts`
- a new or extended spec covering turn-selection commenting
- consider where the shared resolution logic could live so stub and server
  genuinely share it rather than being compared

### Notes
- The real ladder is in `apps/server/src/` anchor resolution; `apps/ui/e2e` may
  not import from `apps/server`, so "share" likely means extracting to a package
  or pinning by fixture. Say which you chose and why.

## Testing Strategy
Fixture-driven parity between stub and server, plus the missing e2e.

## E2E Verification Log

**Model: Opus 5 (1M context).** 2026-08-05.

### Reproduction — the stub disagreeing with the server, measured
Ran UI-051's own seed (a phrase twice in one turn) through three resolvers in
one process: the stub's **pre-fix** function (rung 2 only, copied verbatim out
of the diff), the stub's new one, and the **real server's**
`resolveAnchorExact`, imported from `apps/server/src/anchors/resolve.ts`.

```
thread file: "## user · 2026-08-03T17:01:12Z\nLet's revisit the rate assumption.\n\nI said revisit the rate assumption because 6.1% looks stale.\n"
occurrences of "revisit the rate assumption" at: 37, 74

framed {prefix:"I said ", suffix:" because 6.1% looks stale."}
  old stub: null            ← orphaned
  new stub: {74, 101}
  server:   {74, 101}
bare {exact only}
  old stub: null    new stub: null    server: null   ← §6 orphans rather than guess
turns parsed: 1 · user · 2026-08-03T17:01:12Z
```

`{74, 101}` is the same range UI-051's drill recorded from a **real `corpus`
server** on the same text (its log: "range {start: 74, end: 101}", first
occurrence at 37, second at 74). The bug is reproduced and the fix lands on the
server's answer, not near it.

### The pin against drift
`scripts/stub-server-parity.test.ts` runs one fixture set through **both**
implementations — 17 anchor cases (each rung, both duplicated-phrase directions,
the unicode snap, and 8 orphan shapes lifted from the server's own "rung 3 is
inadmissible on a read path" suite) and 8 thread-file shapes — asserting
`stub === server === fixture`. It lives in `scripts/` because that is the only
place allowed to look at two applications at once (`eslint-boundaries.test.ts`
is there for the same reason); `apps/ui` importing `apps/server` would invent a
dependency edge between siblings and drag server-only packages into the UI's
type program. **28 tests, all passing.** Chosen over extracting a shared package
because a new workspace is infra's call — filed as a recommendation instead.

### The e2e that was owed (`apps/ui/e2e/turn-comment.spec.ts`, 3 specs)
Real Vite on `:5273` (never 5173, never 8765), real Chromium, real
`react-markdown` output, a real DOM range over **one occurrence** inside a
paragraph, a real right-click at the selection's own coordinates.

1. *anchors to the occurrence that was selected* — selected the **second**
   copy of the phrase. Menu: `["comment", "copy"]` under
   `Actions for the selection` (Comment first, no Cut/Paste — a turn is not
   editable). Composer citation `“revisit the rate assumption”`. On the wire,
   `POST /api/threads`: `parent: "th_dup"`, `selector.exact` the phrase,
   `prefix` ending `"I said "`, `suffix` `" because 6.1% looks stale."`, and the
   framed needle occurs once in the file where the phrase alone occurs twice.
   The paint, read out of `CSS.highlights.get("corpus-turn-anchor")`: one range,
   text = the phrase, in **paragraph 1** — the words that were selected. One
   nested child card under that turn, rendering its own turn
   ("Is this still the assumption?"), which is `GET /api/threads/{id}` working.
2. *the first occurrence* — same phrase, other copy: `prefix: "Let's "`, paint in
   paragraph 0. The anchor follows the pointer, not the first match.
3. *a thread that arrives with anchors already on it* — the framed anchor paints
   and its child card hangs off the turn; the **context-free duplicate orphans**
   and its child is listed under the conversation instead of being guessed onto a
   turn or dropped. Both halves asserted, because a stub that resolved everything
   would be as wrong as one that resolved nothing.

Ran `--repeat-each=3`: 9/9 green, no flake.

### Full suite, and one spec corrected
`npx playwright test` (whole suite, `CORPUS_UI_PORT=5273`): **285 passed, 2
failed**. Both failures are `console.spec.ts` / `smoke.spec.ts` asserting the
console strip reads "server unreachable", which cannot hold on this machine: the
user's live personal corpus server holds `127.0.0.1:8765`, the dev proxy's
target (`lsof -nP -iTCP:8765 -sTCP:LISTEN` → `node 29851`). Environmental, not
touched by this change, and left alone.

(Re-run identically after a last fidelity fix on the same routes — a thread
created with no `parent` now reports `null` rather than the empty id, which is
the wire's word for standalone: 285 passed, same 2 environmental failures.)

One spec **was** relying on stub fiction: `anchor-layer.spec.ts` seeded its
thread with `body: "Which lenders?"` — no turn headings — and asserted the
anchor pip reads `1`, which only held because the stub asserted `turnCount: 1`
for every thread regardless of its body. With turn counts now read off the body
the honest answer for that seed is `0`, so the seed was corrected to a real
thread file (`## user · 2026-07-01T09:00:00Z\nWhich lenders?\n`) and the spec now
pins the truth. All 9 of its tests pass.

### Automated
- `VITEST_MAX_THREADS=4 npx vitest run apps/ui scripts/stub-server-parity.test.ts`
  → **2176 passed, 0 failed** (28 of them the new parity suite).
- `npx tsc --noEmit` in `apps/ui` and over `scripts/tsconfig.json`: clean.
- `npx eslint --max-warnings 0` and `npx prettier --check` over every touched
  file: clean.

### Residual, reported rather than fixed
- Anchor resolution still exists twice. The parity test makes drift loud, but the
  real repair is one implementation in a package both applications can depend on
  — a new `packages/anchors` (or a contract subpath), which is not this domain's
  to create.
- The stub still answers `POST /api/threads/{id}/seen`, `/resolve` and `/reopen`
  with `{}`, and appends no turns. Nothing in the suite reads those responses;
  they are the next honest gap, not this issue's.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
