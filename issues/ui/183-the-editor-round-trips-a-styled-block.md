# [UI-183] The editor round-trips a styled block

## Domain

ui

## Status

todo

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

_[filled by the implementer]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified
