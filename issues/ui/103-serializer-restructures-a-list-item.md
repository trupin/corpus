# [UI-103] Opening a document and typing one character can silently restructure a list

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
- Related: UI-099 (found it), UI-068 (the selector must quote the file's
  spelling), §4 autosave

## Spec References

- SPEC.md **§11** — "the editor serializes to clean markdown", and **autosave,
  no save button**: every keystroke eventually writes the file
- SPEC.md **§5** — files on disk are the source of truth
- SPEC.md **§1** — the corpus is the user's own documents; the tool stewards
  them, it does not rewrite them

## Summary

Found by UI-099's reproduction, and it is the worse half of what that
investigation turned up. UI-099 fixed the *anchoring* consequence; **this is the
data consequence, and it is untouched.**

`apps/ui/src/editor/markdown/serialize.ts`'s round trip is **not
structure-preserving** for a further paragraph of an outer list item following a
nested sublist:

```markdown
- Outer bullet leads in.
  - Nested bullet one.
  - Nested bullet two.

  A trailing paragraph of the outer item.
- Second outer bullet.
```

Printing once drops the blank line. Printing the result again re-reads that
paragraph as a continuation of the **nested** item and indents it 2 → 4 spaces.
So the construct is not a fixed point: `canonicalize(canonicalize(x)) ≠
canonicalize(x)`.

Because §11 gives the editor **autosave and no save button**, opening such a
document and typing a single character anywhere in it writes the restructured
form to disk. A paragraph that belonged to an outer list item silently becomes
part of a nested one — in the user's own file, with no action that asked for it,
and the git commit records it as the user's edit.

## Why this is P0

It is not a rendering defect. It changes **what is on disk**, in the direction
the product is least allowed to: §5 makes files the source of truth and §1 makes
them the user's. The change is invisible at the moment it happens, survives into
git under the user's authorship, and the affected construct is ordinary
markdown — an outer bullet with a sublist and a closing paragraph.

UI-099 made anchoring immune to it (the layer now traces what the editor
actually shows), so nothing depends on this being fixed to render correctly.
That is exactly why it needs its own issue rather than a note: the symptom that
would have led someone here is gone.

## Acceptance Criteria

- [ ] `canonicalizeMarkdown` is **idempotent** for this construct — printing
      twice equals printing once — and that is asserted as a property, not for
      one fixture
- [ ] The paragraph keeps its list level through a parse → print round trip, and
      through parse → print → parse → print
- [ ] A document containing the construct, opened and edited elsewhere, writes
      back with the construct **unchanged**. Drive it through the real editor
      and autosave, not through the serializer in isolation — autosave is what
      makes this reach disk
- [ ] Reproduce before fixing, with the on-disk before/after and the git commit
      it produced, per the SDLC's rule for bugs
- [ ] **Sweep for siblings.** A round trip that is not a fixed point for one
      construct is unlikely to be one for exactly one construct. Round-trip a
      corpus of real markdown — the repo's own documents will do — and report
      what else moves, even if this issue only fixes this case
- [ ] UI-099's fix is not undone: the anchor layer traces the editor's own
      document, and must keep doing so whatever the serializer is made to do

## Technical Design

### Files to Create/Modify

- `apps/ui/src/editor/markdown/serialize.ts`, and its tests.

### Notes

- The failing step is the **blank line**, which is what tells a reader the
  paragraph belongs to the outer item rather than the nested one. Dropping it is
  the loss; the re-indent on the second read is only the consequence.
- Idempotence is the property worth testing, because it is checkable without
  knowing what the right output is: whatever the printer chooses, printing its
  own output must not choose differently.
- Do not fix this by making the *reader* tolerant. The file on disk is what
  changed, and a reader that copes with both spellings still leaves the user's
  document rewritten.

## Testing Strategy

A property test over the construct and its neighbours (nested sublist with and
without a trailing paragraph, at two and three levels, ordered and unordered),
asserting print∘print = print. Plus the real-editor autosave case, and the
corpus sweep from the acceptance criteria.

## E2E Verification Log

_Filled by the implementing agent; state the model. This is a bug: the pre-fix
reproduction, including the on-disk diff and the commit it produced, is
mandatory._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
