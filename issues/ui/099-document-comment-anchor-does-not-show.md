# [UI-099] Commenting on a document selection leaves no visible anchor

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: UI-062 (comment anchored at the top, done), UI-068 (selector quoted the
  canonical spelling, not the file's, done), UI-086 / SERVER-072 (orphan
  re-attachment, done) — this area has a history and the fix must not undo them

## Spec References

- SPEC.md §11 — "**Commenting**: selecting text pops a floating toolbar
  (formatting + **Comment**); commenting captures the text-quote selector and
  opens a thread composer"
- SPEC.md §11 — "Clicking an anchored highlight opens its thread"
- SPEC.md §15 M4 — the Playwright check: "select text → comment ('note only') →
  **highlight + chip appear without reload**"
- SPEC.md §6 — anchors are text-quote selectors

## Summary

User report (2026-08-08): selecting text in a **document** and leaving a comment
produces no visible anchor — no highlight on the quoted passage. The same gesture
in a **thread** works.

This is P0: it is a §15 M4 milestone check (*"highlight + chip appear without
reload"*), and without a visible anchor the passage no longer says it has been
discussed, which is the core of the product's anchoring model.

## The framing that matters — "it works in threads" proves nothing here

The two surfaces place conversations by **different mechanisms**.
`apps/ui/src/reader/DocView.tsx:244`:

```ts
const anchorsHost =
  doc !== undefined &&
  !reader.isThread &&
  PluginView === null &&
  editorHandlesType(doc.frontmatter.type);
```

and line 275: `const bodyPlacesThreads = anchorsHost || reader.isThread;`

A **document** draws highlights through the anchor layer (`useAnchorLayer`,
`anchorDecorations`, `textHighlight`). A **thread** has `anchorsHost === false`
and places child threads per-turn via `placeChildThreads` instead. So the working
thread case exercises none of the machinery that is failing. Do not use it as a
reference implementation, and do not conclude the anchor layer is fine because
something adjacent renders.

## Reproduction — establish this first

Reproduce against the real app and record **which of these it is**, because the
fix differs entirely:

1. Is the thread **created** at all? (Check the file on disk and `git log`.)
2. Does the parent document's frontmatter gain an `anchors` entry?
3. Does the selector match the saved body — or is the thread born orphaned?
   `useAnchorLayer.ts:58` carries the message *"Couldn't quote that selection from
   the document as it is saved"*, and `:91–101` explains that the check compares
   two **printings** of the body via `traceOfBody` / `traceOfDoc`. A mismatch there
   is a strong candidate.
4. Is the anchor resolved but the **decoration** not drawn?
5. Is `anchorsHost` false for this document — a plugin `View` claiming the type,
   or `editorHandlesType` returning false?

Record the answer before writing code.

## Acceptance Criteria

- [ ] Reproduction recorded, naming which stage fails
- [ ] Selecting text in a document and commenting produces a **visible highlight
      on the quoted passage, without a reload** (§15 M4)
- [ ] The chip / margin card appears at the anchor, per the adaptive placement
      rule — margin in focus and wide layouts, chip at the anchor in narrow
      columns
- [ ] Clicking the highlight opens its thread (§11)
- [ ] The anchor survives a reload, and survives editing elsewhere in the body
      (reconciliation per §6)
- [ ] A selection that genuinely cannot be quoted still fails **loudly**, with the
      existing message — this issue must not fix the silence by suppressing a real
      refusal
- [ ] The regressions this area already fixed stay fixed: the anchor lands at the
      selection and not at the top (UI-062), and the selector quotes the file's
      spelling rather than the canonical one (UI-068)
- [ ] Works in both the column reader and focus mode
- [ ] A whole-document (unanchored) comment is unaffected

## Technical Design

### Files to Create/Modify

Determined by the reproduction. Candidates, in the order the pipeline runs:

- `apps/ui/src/anchors/selectorFromSelection.ts` — capture
- `apps/ui/src/anchors/CommentPopover.tsx` — the compose/submit path
- `apps/ui/src/anchors/sourceTrace.ts` / `traceCache.ts` — the two printings
- `apps/ui/src/anchors/useAnchorLayer.ts` — resolution and publication
- `apps/ui/src/anchors/anchorDecorations.ts` / `textHighlight.ts` — drawing
- `apps/ui/src/reader/DocView.tsx` — `anchorsHost`, if the layer is not mounted

### Key Implementation Details

`useAnchorLayer`'s docblock warns that "a report against a document it was not
computed for is how a highlight ends up" wrong (line 47), and that sameness is
**not** string equality with the body because "a file the printer spells
differently is still the same document" (line 91). Both are load-bearing. A fix
that makes the highlight appear by loosening either check will reintroduce the
class of bug UI-068 and SERVER-072 were filed for.

There is a settle delay after a document change before the layer re-checks
(line 107). If the anchor appears only after an unrelated edit, that timer is
where to look.

### Edge Cases

- A selection spanning a formatting boundary (bold, a link, an inline code span)
- A selection whose exact text appears more than once in the body
- A selection made immediately after typing, before autosave has written —
  §11 requires the selector to quote the document **as saved**
- A document whose type a plugin claims with a `View` — `anchorsHost` is false by
  design there, and the todos manifest documents this as the reason it registers
  no `View`. If the reported document is such a type, that is the answer and the
  issue changes shape
- A locked document — commenting is still allowed; the layer is not editable

## Testing Strategy

Vitest for each stage the reproduction implicates. **A Playwright spec is
required regardless**: §15 M4 already specifies this exact flow as a milestone
check, and a bug that reached a user through a specified check means the check is
missing or not asserting the highlight. Add or repair it so this cannot regress
silently.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start the real app; open an ordinary `note` document in a column reader
2. Select a phrase in the body; choose Comment; submit a note-only comment
3. Expected: the phrase is highlighted, a chip/card appears at it, no reload
4. Actual: no visible anchor
5. Repeat the same gesture inside a thread — record that it works, and record
   **which mechanism** drew it there

### Verification Steps

1. Restart the app; repeat the document case — confirm the highlight and the
   chip appear immediately
2. Reload — confirm both survive
3. Edit text elsewhere in the body — confirm the anchor stays attached
4. Edit inside the anchored range — confirm reconciliation keeps it attached
5. Delete the anchored text — confirm the thread detaches as an orphan with its
   quote preserved, and is offered candidate sites (UI-086)
6. Repeat in focus mode
7. Select a phrase that occurs twice and comment on the second occurrence —
   confirm the highlight lands on the second
8. Confirm a whole-document comment still works and still lists below the body

## E2E Verification Log

_[Agent fills: model run on, which stage the reproduction implicated, commands,
observed output.]_

## Completion Checklist (domain agent)

- [ ] Pre-fix reproduction logged, naming the failing stage
- [ ] Tests written and passing, including the M4 Playwright check
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] UI-062 and UI-068's fixes confirmed still in force
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (P0)
- [ ] `/evaluate` passes
- [ ] Committed with `[UI-099]` prefix
