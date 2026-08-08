# [UI-087] Child threads render twice in a thread reader — per turn and again below the body

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Spec References

- SPEC.md **§11** Thread view — "**Child threads shown per-turn.**" That is the
  placement for a thread's children; §11 states no second listing for them
- SPEC.md **§11** Document view — "Whole-document comments and orphaned threads
  remain listed below the body." The below-body list is for threads that have
  **no place in the body**, not for every thread
- SPEC.md **§6** — recursion: commenting on a turn creates a child thread

## Summary

**Reported by the user, 2026-08-07**: in a thread, sub-threads appear twice —
once as sub-threads and once at the end of the document. With and without full
screen.

Confirmed by reading, and the cause is exact.

`apps/ui/src/reader/DocView.tsx:244` computes

```
const anchorsHost = doc !== undefined && !reader.isThread && PluginView === null && editorHandlesType(...)
```

so `anchorsHost` is **false for every thread**. The `else` branch at
`DocView.tsx:513-526` then renders **`reader.threads` in full** — every child
thread on the document — as `ThreadPanel`s below the body. Meanwhile
`ThreadCard` has already placed every one of them: `placeChildThreads` splits
them into `byTurn` (rendered under their turn, `ThreadCard.tsx:351`) and
`unanchored` (rendered after the last turn, `ThreadCard.tsx:375`). The two sets
are exhaustive and mutually exclusive, so the below-body list is a **second,
complete** rendering of the same conversations.

**How it happened** — the comment above that branch says so plainly:

> A document the editor does not own has no anchors to place, so every thread on
> it stays below the body, where UI-005 put them.

True when written. Child threads later gained per-turn placement inside
`ThreadCard`, and the fallback was never revisited. It is a stale catch-all, not
a wrong decision.

**Documents are not affected**, and the issue should not "fix" them: a document
takes the `anchorsHost` branch, where anchored threads become chips or margin
cards and `DetachedThreads` lists only `wholeDocument`, `orphaned` and
`unplaced` — which is exactly what §11 specifies. A plugin-view or
non-markdown-typed document also falls to the catch-all, but nothing else
renders its threads there, so that listing is the **only** render and must
stay.

## Acceptance Criteria

- [x] In a thread reader, each child thread renders **once** — under its turn,
      or after the last turn when it belongs to no single turn
- [x] True in a column and in full screen (the report names both), since the
      duplicate is above the placement split and not a width behaviour
- [x] A child thread whose anchor is **orphaned** still renders exactly once and
      is still reachable — `placeChildThreads` already routes it to `unanchored`;
      the fix must not drop it on the way to removing the duplicate
- [x] **A plugin-view or non-markdown document still lists its threads below the
      body.** The catch-all is load-bearing there. A fix that removes the branch
      outright silently drops every thread on those documents
- [x] A regression test pins the count, not just the presence — the defect is a
      *second* render, so an assertion that a thread "is shown" passes both
      before and after and proves nothing
- [x] The stale comment at `DocView.tsx:486-493` is corrected rather than left
      describing behaviour that no longer holds

## Technical Design

### Files to Create/Modify

- `apps/ui/src/reader/DocView.tsx` — the `anchorsHost` false branch.

### Notes

- The narrow fix is to make the below-body catch-all skip **threads**
  specifically (`reader.isThread`), rather than to widen `anchorsHost` — a
  thread genuinely has no anchor host in the document sense, and conflating the
  two would be reasoning about the wrong property. But check whether
  `reader.isThread` is the honest predicate, or whether the real question is
  "has something else already placed these", which is what actually differs
  between a thread and a plugin view.
- **Do not fix this inside `ThreadCard` by suppressing its per-turn placement.**
  §11 makes per-turn the specified placement for a thread's children; the
  duplicate is the below-body copy.

## Testing Strategy

A thread with children on two different turns plus one whole-thread child,
rendered in a reader: assert each appears exactly once, and that the
whole-thread child appears after the last turn. Plus a plugin-view document
asserting its threads still list below the body — the guard against fixing this
by deletion.

## E2E Verification Plan

Against the real app: open a thread that has sub-threads, in a column and in
full screen, and confirm each sub-thread appears once. Then a document with
anchored and whole-document comments, confirming the document behaviour is
unchanged.

## E2E Verification Log

**Model: opus** (`claude-opus-5[1m]`), 2026-08-07. Vite dev server on **port
5473** (`CORPUS_UI_PORT=5473`) — 8765 and 5173 deliberately untouched. The git
hooks no longer build or test (INFRA-025), so every run below was invoked by
hand.

### The predicate, and why it is not `reader.isThread`

`reader.isThread` would have made the count right while naming the wrong
property. The question the call site is actually asking is **"has the body
already placed this document's threads?"** — that is what separates the four
body branches: the editor places anchored threads at their anchors, a thread's
conversation places its children under their turns, and a plugin `View` and the
static markdown fallback place nothing at all. So the branch is now keyed off a
named `bodyPlacesThreads = anchorsHost || reader.isThread`, documented at the
point of definition, and the below-body list is a second JSX expression rather
than the `anchorsHost` else-branch. That is what keeps the list load-bearing
where it is the only render, and what makes the next body branch answer the
question instead of inheriting an answer.

### Reproduced before fixed, in a real browser

The regression tests were written first and run against the **pre-fix**
predicate (`anchorsHost` restored at the call site, nothing else changed):

- jsdom, both hosts: `expected [ <div …>, <div …> ] to have a length of 1 but
  got 2` — `renders each child exactly once in a column` and `… in full screen`
  both failed; the four placement/guard tests passed, as they must.
- Chromium, `e2e/turn-comment.spec.ts -g "counted"`: `locator('.reader
  [data-thread-panel="th_framed"]')` — `Expected: 1 / Received: 2`,
  `14 × locator resolved to 2 elements`. That is the user's report, driven.

And the deletion trap, driven too: with the catch-all removed outright
(`{true || …}`), the new e2e `still lists the threads on a document whose body
places none` fails at `.reader .thread-slots` → expected 1, received 0. The
branch is proved load-bearing rather than assumed to be.

### After the fix

- `apps/ui/src/reader/childThreadPlacement.test.tsx` — **6 passed**. Each of the
  four children counted at exactly 1 in a column (`Reader`) and in full screen
  (`FocusMode`), `.thread-slots` at 0 in both; `th_c1` under `ASK`'s turn and
  nowhere else, `th_c2` under `REPLY`'s; the whole-thread and **orphaned**
  children (`range: null`, the server's verdict) outside `.turns` and after it
  by `compareDocumentPosition`, once each; the plugin-`View` and `view`-type
  documents still listing theirs, at exactly 1 `.thread-slots` each.
- Chromium, `e2e/turn-comment.spec.ts` — **4 passed**, including the new
  `a thread's children, counted` pair. In a column: `th_framed` ×1, `th_orphan`
  ×1, `.reader .thread-slots` ×0. Then ⤢ (`.reader [data-expand]`): in
  `.focus.open`, one turn, `th_framed` ×1, `th_orphan` ×1, `.thread-slots` ×0,
  and the orphaned child still a real conversation full screen — its
  `.turn-body` still reads "Which one of the two?".
- Regression sweep, Chromium: `turn-comment` + `thread` + `collapse` + `reader`
  — **41 passed** (19.8s).
- `npx vitest run apps/ui packages/kit` — **2954 passed, 0 failed**.
- `npm run typecheck -w apps/ui` — clean. ESLint + Prettier on the three touched
  files — clean.

### Not claimed

No `corpus` server was started: 8765 is the user's live one, and this repo's e2e
harness is the real Vite app over `stubCorpus` at the transport boundary. The
duplicate was a pure render-placement defect with no write path, so the browser
evidence above is the whole of it.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
