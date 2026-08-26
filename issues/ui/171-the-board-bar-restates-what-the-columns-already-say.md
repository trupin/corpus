# [UI-171] The board bar restates what the columns already say

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

- SPEC.md §10 — "A kanban is a board over one field" (rider signed 2026-08-22)

## Summary

`BoardBar.tsx` draws a permanent status line between the `＋` button and the
paths pill: `kanban over status · a drag moves one stage left or right`. The
user reported it on 2026-08-25 — _"Why is there this sentence? can we remove it
and if not, let's show it somewhere it makes sense, not in the middle of the tab
bar"_.

**Two of its three clauses are already drawn elsewhere, by the surface the spec
names.** §10 says _"Each column shows where it leads"_, and every column of a
kanban does: `stageChips` pushes one `→ <target>` chip per reachable stage and
`→ ∅` where nothing leads out. So `a drag moves one stage left or right` is a
board-wide paraphrase of a per-column fact the spec puts on the columns.
`kanban over <field>` restates the `kanban` tag the tab already carries, adding
only the field name.

**One clause carries something no other surface shows** — the stray count,
_"N documents in scope with a `stage` this board does not list"_. That is a
finding about the board's own configuration, and it stays visible.

The placement is the reported defect, and the redundancy is why the fix is
mostly deletion rather than a move. `design/navigation.html:879` draws the same
sentence in the bottom console strip; the implementation moved it into the board
bar and the comment at `BoardBar.tsx:461` records that choice. The strip is not
a better home either: it is a `role="button"` that toggles the console, and a
variable-length board clause inside it would re-width it on every board switch
(SHARED-061, "nothing resizes because of what it holds").

## Acceptance Criteria

- [x] The `kanban over <field>` and drag-rule clauses no longer render in the
      board bar
- [x] The field name and the drag rule survive as the **tooltip on the tab's
      `kanban` tag** — the badge whose meaning they explain
- [x] The stray count renders as its own element, on the right of the bar beside
      the paths pill, where the board-scoped counters already live
- [x] The stray count is **absent**, not empty, when there are no strays — an
      element that appears would re-width the row it is on (§10)
- [x] `FUNNEL_HINT` / `GRAPH_HINT` keep their exported names and text, so the
      tooltip and the e2e assertions read the same strings
- [x] No board without a kanban gains anything on the bar

## Technical Design

### Files to Create/Modify

- `apps/ui/src/shell/BoardBar.tsx` — drop the `.board-hint` span; move the
  drag rule to the `kanban` tag's `title`; render `.stray-pill` beside
  `.paths-pill`
- `apps/ui/src/shell/BoardBar.css` — replace `.board-hint` with `.stray-pill`
- `apps/ui/e2e/kanban.spec.ts` — the three `.board-hint` assertions: two become
  tag-tooltip assertions, the stray one moves to `.stray-pill`

### Key Implementation Details

`KANBAN_HINT_TITLE` already carries the full sentence and the way out of the
graph. It takes the field, so it can carry the drag rule too — one string on the
badge, rather than a visible clause plus a tooltip that says more.

`useStrayStages` returns `number | null` and is unchanged. `null` is "not
answered yet", `0` is "answered, none" — both render nothing.

### Edge Cases

- A board whose `kanban` is `null` gets no tag, so it gets no tooltip and no
  stray pill.
- `useStrayStages` returning `null` mid-flight must render nothing rather than a
  placeholder, for the same §10 reason the console strip's index pill sits where
  it does.

## Testing Strategy

`BoardBar` unit tests for: the hint span is gone, the tag carries the field and
the drag rule in its `title`, the stray pill renders only for a non-zero count.
Falsify the pill by forcing `useStrayStages` to `0` and confirming the element is
absent rather than empty.

## E2E Verification Plan

`apps/ui/e2e/kanban.spec.ts` against the real Vite app: open the `status` kanban
and assert the bar holds no `.board-hint`, the tab's tag tooltip names the field
and the drag rule, and the stray fixture (`doc_birch`, `stage: gazumped`) puts
the count in `.stray-pill` and not in the tab strip.

### Reproduction Steps (bugs only)

1. `npm run watch`, open the board.
2. Show a kanban board.
3. Expected: the tab strip holds tabs and the `＋` button.
4. Actual: `kanban over status · a drag moves one stage left or right` sits
   between `＋` and the paths pill, restating the tab's own `kanban` tag and the
   `→` chips on every column below it.

## E2E Verification Log

Implemented directly by the orchestrator on opus, 2026-08-25.

### The prototype now disagrees, deliberately

`design/navigation.html:879` draws this sentence in the **bottom console
strip**, right-aligned after a spacer. The product had moved it into the board
bar, which is what the user reported. This fix does not put it back in the
strip, and that is a divergence from a file CLAUDE.md calls authoritative for
look and feel, so it is recorded here rather than left to be discovered.

The strip was rejected for two reasons. It is a `role="button"` that toggles the
console, so a board clause inside it is inside a control that does something
else on click. And its content is anchored either side of a spacer with no
slack to give: a clause whose length changes with the board name and the field
would re-width the one row that always renders, which is what SHARED-061 forbids
and what the index pill's own placement comment already works around.

**A follow-up worth someone's judgment, not filed:** whether the prototype
should drop its status line to match, or whether the product should grow a
board-scoped line somewhere the prototype's does not conflict. Neither is
urgent, and deciding it inside a bug fix would be deciding it by accident.

### The review gate did not run

Merged on green CI without a `pr-reviewer` verdict. The gate could not run in
this session, so the diff's author is the one who merged it. The user was asked
and chose to merge rather than wait. Recorded because the repository's rule is
that every PR gets one, and a skipped gate that nobody wrote down is a gate
everybody later assumes ran.

### Falsification

Every new assertion was broken on purpose and watched to fail.

```
tooltip removed from the tag        → 2 failed | 17 passed  (unit)
stray pill rendered unconditionally → 1 failed | 18 passed  (unit)
stray pill removed entirely         → 1 failed              (e2e, real browser)
```

### Checks

```
vitest run apps/ui/src/shell/BoardBar.test.tsx     19 passed   exit 0
playwright kanban.spec.ts --workers=1              16 passed   exit 0  (19.3s)
tsc --noEmit -p apps/ui/tsconfig.json                          exit 0
eslint (three changed files)                                   exit 0  (no rule disabled)
prettier --write                                               exit 0
```

The e2e count went from 15 to 16: the absent-pill branch is a new test, because
"renders nothing" is the branch a fix like this gets wrong and no existing
assertion covered it.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-171]` prefix
