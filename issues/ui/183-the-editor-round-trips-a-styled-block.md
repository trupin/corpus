# [UI-183] The editor round-trips a styled block

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-094, UI-182
- Blocks: UI-101

## Spec References

- SPEC.md §5 — "**attribute markers** — … fenced divs for block styling
  (`::: {align="center"}` … `:::`)"
- SPEC.md §5 — the closed vocabulary: `color`, `highlight`, `align`, `indent`

## Summary

§5's fourth styling form is the fenced div, and it is the one that carries
`align` and `indent`. This issue gives the editor a block node for it: a
container holding ordinary blocks, rendered with its alignment and indentation,
and printed back as the two fence lines it was written with.

## Acceptance Criteria

- [ ] `::: {align="center"}` … `:::` parses to a block node holding the blocks
      between the fences
- [ ] The block renders with its alignment and indentation in the editor
- [ ] It round-trips byte for byte, fence lines included
- [ ] A fence line whose attributes are not admissible stays a paragraph of text
- [ ] An unclosed fence leaves every line as prose
- [ ] A styled block nests: a block inside a block round-trips
- [ ] The node contains blocks, so a heading, a list or a table inside one
      survives

## Technical Design

### Files to Create/Modify

- `packages/kit/src/markdown/styled.ts` — the block half of `remarkCorpusStyling`
- `apps/ui/src/editor/markdown/styledBlock.ts` — new; the TipTap node
- `apps/ui/src/editor/markdown/schema.ts` — `NODE.styledBlock`
- `apps/ui/src/editor/markdown/parse.ts` — the block case
- `apps/ui/src/editor/markdown/serialize.ts` — the block printer
- `apps/ui/src/editor/editor.css`, `packages/kit/src/markdown/markdown.css`

### The node

`styledBlock` is `group: "block"`, `content: "block+"`, `defining: true`, with
attributes `align` and `indent`. It is a container, not an atom: the blocks
inside it are ordinary editable blocks, which is the whole point — §5 calls it
block styling, not a styled paragraph.

### Parsing

remark gives the opening fence, the content and the closing fence as separate
block children of whatever parent they sit in (`paragraph`, blocks…,
`paragraph`). The plugin walks any parent's children, finds an opening fence
paragraph whose whole text `blockFenceAttributes` admits, finds the next closing
fence paragraph at the same level, and replaces the run with one
`corpusStyleBlock` node holding the blocks between them.

**The fence lines must stand alone.** `::: {align="center"}\ntext\n:::` written
with no blank lines is one paragraph to remark, and stays one paragraph of text.
That is a stated restriction, and it is what Pandoc's own form looks like.

### Printing

A custom mdast block type whose handler prints:

```
::: {align="center"}

<the blocks, printed by state.containerFlow>

:::
```

`PrintState` gains `containerFlow`. The blank lines around the content are what
make the output parse back the way it went in.

### Edge Cases

- **Nesting.** An inner block's fences are printed by the same handler and the
  outer `containerFlow` indents nothing, so `:::` lines nest flush. Parsing
  matches fences by depth-first walk, so an inner close is not taken for the
  outer one.
- **An empty styled block** — two fence lines with nothing between — is not
  representable (`content: "block+"`) and parses as two paragraphs of text.
- **`LEAF_NODES`** is unchanged; `TEXT_BLOCKS` is unchanged. The node's children
  are blocks, so the offset trace descends into them as it does for a blockquote.
- A styled block inside a list item: the join rules already default to a blank
  line between an item's blocks, which is what this needs.

## Testing Strategy

- Round trip: each `align` value, each `indent` level, both together, nested
- A fence line with an inadmissible attribute stays text
- An unclosed fence stays text
- A heading, a list, a table and a code fence inside a styled block
- The churn test again: a fixture with no styled block is byte-identical

**Falsification.** Remove the blank lines from the printer's output and watch
the round trip go red — the fences would be absorbed into the content paragraph.

## E2E Verification Plan

1. Start the real app
2. Write a centred block in a document through the editor
3. `git show HEAD:<path>` — the file carries the two fence lines
4. Reload; the text is centred, and the fence lines are not visible as text

## E2E Verification Log

### Post-Implementation Verification

Implemented on: **opus**.

**Unit.** `apps/ui` and `packages/kit`: **4,915 passed, 0 failed**, 247 files.
The block form's canonical shapes are in `fixtures/styled-text.md`, so they are
asserted byte-identical, idempotent, and traceable by `offsetMap.test.ts`.

**The strongest evidence came from a test that already existed.**
`serialize.test.ts` reads the block types a list item may hold **out of the live
schema** rather than from a list, so adding `styledBlock` made that test fail
until the node was registered — and then ran every ordered pair of it with every
other block type through the round trip. Its docblock says why: "a block type
the editor grows later arrives as a failure in this file instead of as an
adjacency nobody thought to write a case for — which is how the reported one
shipped." That is exactly what happened, and all 121 pairs pass.

**Falsification, two breaks.**

| Break | Result |
| --- | --- |
| Print the fences flush against their content instead of on their own lines | **38 failed** |
| Stop counting depth when looking for the closing fence | 2 failed |

The first is the one that matters. Printed flush, the opening fence and the
first paragraph are one paragraph to every markdown parser, so the block does
not read back at all — and 38 tests say so.

**The round trip, case by case**:

```
'::: {align="center"}  … :::'                     OK
'::: {indent="2"}      … :::'                     OK
'::: {align="right" indent="1"} … :::'            OK
nested: an inner block inside an outer one        OK
a heading, a list and a fenced block inside one   OK
a highlight inside a styled block                 OK
'::: {color="accent"}' (inline attribute)         OK — stays prose
an unclosed fence                                 OK — stays prose
fences glued to their content                     OK — stays prose
a fence inside a fenced code block                OK — stays prose
```

Alignment first has a rendering in UI-184, so the in-browser evidence lives
there.

**In-browser confirmation ran** (logged in full under UI-184): the same spec
asserts the centred block computes `text-align: center` while the paragraph
above it does not, that `:::` never appears as visible text, and that the two
fence lines survive an edit made elsewhere in the document. 5 passed, and
breaking `align-center` to `text-align: left` turns one of them red.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified
