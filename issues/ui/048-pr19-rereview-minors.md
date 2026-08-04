# [UI-048] PR #19 re-review MINORs: paste edges, composer draft loss, completion whitespace, layer comment

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §11 clipboard-fidelity rider (signed 2026-08-02)

## Summary
Five MINOR findings from the second Fable review of PR #19 (merged as `c7725a6`,
verdict APPROVE — none of these blocked). Grouped because four are in the paste
and query-editor code the same fix pass touched.

**1. Consecutive `<br>` in a Docs payload now survive.** `clipboard.ts` (`isInline`)
— `<br>` is itself absent from `BLOCK_ELEMENTS`, so in
`<p>A</p><br><br><p>B</p>` each break sees the other as inline content and the
neighbour rule keeps both. A Google Docs selection containing an empty paragraph
therefore writes two stray `\` lines into the saved markdown. This is
directionally the documented trade ("a stray break rather than a lost line") but
it is a real change to the shipped Docs repair and no test covers it. Decide
whether a run of breaks should collapse, and pin it either way.

**2. The Docs gate also disables redirect unwrapping for other Google surfaces.**
`clipboard.ts` — the `docs-internal-guid-` gate switches off repair #2 as well,
and Gmail message bodies and Search results also wrap links in
`https://www.google.com/url?q=…`. Copying a linked sentence out of Gmail now
writes a ~200-character tracking redirect into the file. Correct trade against
the MAJOR the gate fixes (it is also what `main` did before the PR, so not a
regression against shipped behavior), but consider unwrapping redirects
unconditionally — it is a link-attribute rewrite that cannot weld lines together
— and say so in the JSDoc, which currently reasons only about `wrapMap` and
`<style>`.

**3. The comment composer discards a draft on any outside click.**
_Escalated 2026-08-03 by PLUGINS-011, and I agree: this got more pressing, not
less._ The signed composer contract now makes `↵` insert a newline, which
actively encourages multi-line drafts — so a stray `mousedown` throws away more
text than it used to, still with no confirmation. Whatever is resolved for
`CommentPopover` must land in `plugins/todos/ui/dismiss.ts` in the **same**
change: that module exists only to imitate core's dismissal, and leaving the
plugin imitating a behavior core has abandoned is worse than either behavior.
Treat this item as the one to do first when UI-048 is picked up.

`plugins/todos/ui/dismiss.ts` applied at `TodoItemComposer.tsx` — the shared
dismissal hook was extracted to fix **Escape** ordering, and outside-click came
along with it. Type a comment on a todo item, click elsewhere on the board to
check something, and the draft is gone with no confirmation. Tested and
deliberate, so this is a design question rather than a defect: a menu should
dismiss on an outside click, a data-entry surface with unsaved text arguably
should not. Decide, and if the composer keeps the behavior, guard a non-empty
draft.

**4. Completion mis-repairs a field followed by a space.**
`apps/ui/src/board/query/queryCompletion.ts` — `equipped` tests
`text[trigger.end] === "="`, but `tokenEnd` trims trailing whitespace out of the
end offset, so `ty =note` with the caret at 2 writes `type= =note`. Pre-existing
(the previous `end === caret` test produced the same string), so not a regression
from the fix — but the fix's own framing about repairing a name already followed
by a value does not hold across a space.

**5. The reveal layer comment omits toasts.** `apps/ui/src/reader/reveal.css` —
the new `z-index: 36` comment enumerates focus mode (35), search (40), toolbar
(50) and menus (60) but not `Toasts.css` (30), which the layer now sits above.
Boxes are `pointer-events: none` so nothing is blocked, but a flash overlapping a
toast paints over it. 55 → 36 is strictly better; the list is just incomplete.
Decide whether a flash should outrank a toast, then complete the comment.

## Acceptance Criteria
- [ ] Runs of `<br>` in a Docs payload behave deliberately, with a test
- [ ] Redirect unwrapping decision made and the JSDoc states the gate's full
      consequence
- [ ] Composer draft loss on outside click resolved (guarded or documented)
- [ ] `ty =note` completes to `type=note`, with a test
- [ ] Layer comment complete and the flash/toast order deliberate

## Technical Design
### Files to Create/Modify
- `apps/ui/src/editor/clipboard.ts` + tests
- `plugins/todos/ui/TodoItemComposer.tsx` (or `dismiss.ts`) + tests
- `apps/ui/src/board/query/queryCompletion.ts` + tests
- `apps/ui/src/reader/reveal.css`

## Testing Strategy
Unit tests for each; no new e2e expected.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
