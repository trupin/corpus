# [UI-048] PR #19 re-review MINORs: paste edges, composer draft loss, completion whitespace, layer comment

## Domain
ui

## Status
done

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
- [x] Runs of `<br>` in a Docs payload behave deliberately, with a test
- [x] Redirect unwrapping decision made and the JSDoc states the gate's full
      consequence
- [x] Composer draft loss on outside click resolved (guarded or documented)
- [x] `ty =note` completes to `type=note`, with a test
- [x] Layer comment complete and the flash/toast order deliberate

## Technical Design
### Files to Create/Modify
- `apps/ui/src/editor/clipboard.ts` + tests
- `plugins/todos/ui/TodoItemComposer.tsx` (or `dismiss.ts`) + tests
- `apps/ui/src/board/query/queryCompletion.ts` + tests
- `apps/ui/src/reader/reveal.css`

## Testing Strategy
Unit tests for each; no new e2e expected.

## E2E Verification Log

**Model: Opus 5 (1M context).** All five items are unit-level, as the Testing
Strategy says; no new e2e was expected and none was written. The shipped e2e that
covers the touched code (`clipboard.spec.ts`, `query-editor.spec.ts`,
`todos.spec.ts`, `todos-menu.spec.ts`, `context-menu.spec.ts`, `reveal.spec.ts`)
was re-run green.

### 1. Runs of `<br>` — decided: a run collapses

`<br>` is inline in HTML, so in `<p>A</p><br><br><p>B</p>` each break saw the
**other** as inline content it was separating, and both survived as two stray `\`
lines in the saved markdown. Nothing was being separated; the two were holding
each other up. `isInline` now answers `false` for a `<br>`, so a run between
blocks collapses entirely.

The deliberate blank line still survives, and that is what makes this the right
side to err on: in `<div>one<br><br>two</div>` the first break has text before it
and the second has text after it, so both take their answer from real content.

```
✓ drops a run of <br> between blocks, not just a single one
✓ keeps a deliberate blank line between two runs of text
```

Falsified by removing the one line: `✘ drops a run of <br> between blocks`.
`clipboard.test.ts` 42 tests green after restoring.

### 2. Redirect unwrapping — decided: the gate stays, and the JSDoc now says what it costs

Unwrapping unconditionally was considered and **rejected**, and the reason is not
doubt about the repair: a link-attribute rewrite cannot weld two lines together,
but reaching the attribute means the DOMParser round trip, and that round trip is
what loses ProseMirror's `wrapMap` re-hosting and its `<style>` folding on
**every** paste in the workspace. Paying a whole-clipboard regression to fix one
origin's links is the wrong way round.

`cleanPastedHtml`'s docblock now states the consequence in full and by name:
Gmail message bodies and Google Search results wrap links in the same
`google.com/url?q=…` hop and carry no `docs-internal-guid`, so copying a linked
sentence out of Gmail writes the ~200-character redirect into the file — exactly
as it did before this function existed. It also records what would change the
trade: a string-level rewrite that never parses, which is its own change with its
own tests, not a flag flipped here.

### 3. Composer draft loss — resolved, guarded, and the plugin no longer imitates an abandoned behaviour

Core's `CommentPopover` has **no** outside-click dismissal at all — it closes on
Escape and on submit. `plugins/todos/ui/dismiss.ts` still imitated the behaviour
core had dropped, which is the drift the item was escalated for.

`useDismissable` now takes an optional `guard`, read **at the moment of the
click** rather than captured, and `TodoItemComposer` passes the same question its
send button asks: is there text, or is there an attachment. So a draft survives a
stray click on the board, an empty composer still closes like the menu beside it
(it has nothing to lose), and Escape closes it either way — the explicit "put this
down".

```
✓ keeps a draft when the click lands outside, and still closes when empty
✓ still closes a guarded composer on Escape, which is the explicit way out
```

Falsified by deleting the guard call: `✘ keeps a draft when the click lands
outside`. `plugins/todos/ui` 191 tests green after restoring.

`PluginMenu` passes no guard and is unchanged — a menu should dismiss.

### 4. `ty =note` — fixed, with the case matrix

`tokenEnd` trims trailing whitespace out of the token, so `text[trigger.end]`
found the **space** and concluded the field had no `=`. The completion then added
a second one: `type= =note`, which `parseQueryString` reads as the field `type`
holding the value ` =note`. `equalsAfter` skips the gap, and the replacement
swallows it, so the repair does not leave behind the space that hid the operator.

```
✓ repairs a name across the gap to its own `=` — a space before the operator      ty| =note   → type=note
✓ repairs a name across the gap to its own `=` — spaces on both sides of it       ty|e = note → type= note
✓ repairs a name across the gap to its own `=` — a tab before it                  ty|\t=note  → type=note
✓ still adds the operator where the field genuinely has none
```

The pre-existing test that pinned the defect (`leaves the spacing a person typed
around the token alone`, asserting `type= = note`) is replaced by the matrix
above; `apps/ui/src/board/query` 81 tests green.

### 5. The layer comment — completed, and the order is deliberate

`reveal.css` now names `Toasts.css`'s 30 alongside focus mode's 35, search's 40,
the toolbar's 50 and the menus' 60, and says why the flash outranks a toast: a
toast is a notice that will still be there in a moment and can be re-read, while
the flash is a 1.2 s answer to *where*, drawn over the exact words the reader is
looking for. Nothing is blocked either way — every box in the layer is
`pointer-events: none` — so what the stack decides is which of the two is legible
for a second, and the transient pointer wins. Below 36 it would fade behind a
toast that happened to overlap the passage.

`Toasts.css` itself was not touched — another agent owns it this release, and
nothing here needed a change there.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
