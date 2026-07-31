# [UI-031] Closing full screen must not adopt the column under the resting pointer

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-005
- Blocks: —

## Spec References
- SPEC.md §11 — active column follows focus/hover; esc/⌫ close-back precedence

## Summary
User decision (2026-07-31, sign-off round): after closing full screen, the column
under the *resting* mouse becomes active (§11's hover-follows-active fires on the
overlay unmount), which strands `esc` for keyboard-only flow until the mouse
physically moves (UI-022 eval finding: 7 dead presses, survives reload; hovering
restores). Signed rule: **on programmatic close, keep the origin column active and
ignore the pointer's position until it actually moves** — hover re-adopts only on
real mouse movement. Implementation shape: suppress hover-adoption until the next
`mousemove` after a focus-mode close (a one-shot latch), not a permanent behavior
change to hover-follows-active.

## Acceptance Criteria
- [x] Enter focus from column A with the pointer parked over column B's area → esc → column A is still active; esc keeps working
- [x] Moving the mouse afterwards resumes normal hover-follows-active immediately
- [x] No change to click/keyboard column activation

## Technical Design
### Files to Create/Modify
- The active-column hover tracking (apps/ui/src/board/ or shell/) + tests; e2e case in the focus spec

### As implemented
The latch already existed (`keyboard/useActiveColumn.ts:50` `keyboardOwns`, armed by `pin()`,
released by a real `mousemove`). The work was **arming it from the close path**, not building a
second one.

- `keyboard/useActiveColumn.ts`: new `hold()` on the `ActiveColumn` interface — `pin` without
  the move. `pin` now calls it, so there is demonstrably one flag.
- `shell/Board.tsx`: one `closeFocus` callback (`active.hold(); setFocusDoc(null)`), and it is
  the **only** way out of focus mode. The four close paths reach it:
  1. `Escape` — `FocusMode.tsx:83` `useEscapeLayer(Focus)` → `onClose={closeFocus}`
  2. `Backspace` — same layer (`useEscapeStack.ts:49` `CLOSE_KEYS`)
  3. the ✕ button — `FocusMode.tsx:110` → the same `onClose`
  4. the depth-0 auto-close — `FocusMode.tsx:87-89` → the same `onClose`
  …plus the `f` toggle (`toggleFocusMode`), rewritten from a functional updater to an explicit
  `if (focusDoc !== null) { closeFocus(); return; }` so the latch is armed outside the
  reducer rather than in it.
- **No guard on `Column.tsx`**: its handler is `onMouseOver` (bubbling — it also fires on every
  move between descendants), so the early return stays in `activate`, where it belongs.
- `testing/boardFixture.ts`: `DELETE /api/docs/{id}` now answers with `DeleteDocResultSchema`'s
  shape instead of falling through to the document read. The old answer made `orphanedThreadIds`
  undefined, which threw inside the delete mutation and made the depth-0 path untestable.

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4).

Added: `keyboard/useActiveColumn.test.ts` +2 (`hold` holds without moving; the *first* real
movement releases it). `shell/Board.test.tsx` +7 in a new describe — one per close path
(`esc`, `⌫`, `✕`, `f`), the depth-0 auto-close driven by actually deleting the document from
the ⋯ menu inside focus mode, the resume-on-movement case, and "esc keeps working on the reader
beneath". **Reproduction discipline**: with `active.hold()` commented out all 7 fail; with it,
all pass. `useActiveColumn.test.ts:21/:56/:76` and `Board.test.tsx` "follows hover…" / `⇧→` /
`f toggles` / `⇧↵`, and `FocusMode.test.tsx`, are unmodified and green.
Workspace run: **105 files, 1585 tests, all green**.

## E2E Verification Plan
Real app: reproduce the eval's exact drill (ref-follow in focus, esc with parked pointer) → esc still closes/backs.

## E2E Verification Log

**Model: opus** (claude-opus-5, 1M). 2026-07-31.

### The mechanism, confirmed in a real browser
Instrumenting `document` for `mousemove`/`mouseover` across the close records exactly one
event: **`mouseover:<neighbour column>` with no `mousemove` beside it.** That is Chromium
recomputing hover when the element under a stationary cursor changes, and it is precisely the
event the signed rule distinguishes from a real movement. The finding is real and the
discriminator is sound.

### Playwright, real browser
`apps/ui/e2e/anchor-layer.spec.ts` (extended per adjudication 7 — no new spec file) → new
describe **"closing full screen with the pointer parked over another column"**, test **"keeps
the origin column active, and esc keeps working"**, plus a second pinned view so there is a
neighbour. Run: `CORPUS_UI_PORT=5284 CORPUS_SERVER_ORIGIN=http://127.0.0.1:8790 playwright test
e2e/anchor-layer.spec.ts` → **7 passed**.

It is a genuine regression test: with `active.hold()` disabled it **fails** —
`locator resolved to <section class="col reading" data-col="doc_view_inbox">, unexpected value
"col reading"` — the origin lost `.kactive` to the neighbour. (First draft of this test passed
without the fix: the assertions were racing the browser's boundary event, which lands a frame
after the unmount. A two-frame `settle()` fixed it, and that is why the helper exists.)

### Real workspace, real server, real git (port 8806)
Same workspace as UI-030, three seeded columns. Origin = `doc_seedinbox` (a note open in its
reader), pointer parked at the centre of `doc_seedopenthreads` while full screen was up, closed
with `esc` and never moved again:

```
UI-031 before focus  — origin: col kactive reading | neighbour: col
UI-031 pointer parked over doc_seedopenthreads at {"x":812,…,"width":336,…}
UI-031 events the close produced: [ 'mouseover:doc_seedopenthreads' ]
UI-031 after close   — origin: col kactive reading | neighbour: col
UI-031 second esc    — reader count: 0
```

The origin kept the board, and the **second `esc` still worked** — the reader beneath closed,
which is the exact thing the evaluator found dead seven times. Then, a real movement:

```
moved onto origin    — origin: col kactive reading | neighbour: col
moved onto neighbour — origin: col reading        | neighbour: col kactive
```

Hover-follows-active resumes on the first movement, with no delay and no second move.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
