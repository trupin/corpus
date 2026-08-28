# [UI-182] The editor round-trips inline styling

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-094
- Blocks: UI-101, UI-183

## Spec References

- SPEC.md §5 — "**Styled text lives in the body, as text.** … `<u>underline</u>`,
  `==highlight==`, and **attribute markers**"
- SPEC.md §10 — "the editor serializes to clean markdown"
- `apps/ui/src/editor/markdown/schema.ts` — "the round trip through this schema
  has to be lossless"

## Summary

The editor's schema has no underline, no highlight and no attribute span, so
every one of §5's inline styling forms survives today only as inert raw source
(`RawInline`) or as literal text. This issue makes the three forms first-class
marks: parsed into the document, rendered in the editor, and printed back to the
file byte for byte.

The grammar is **not** restated here. `packages/kit` gains one remark plugin
that produces the nodes, exactly as `remarkCorpusRefs` does for `[[ref]]`, and
it reads the patterns from `@corpus/contract`. The editor's parse walk then maps
the plugin's nodes, and the serializer prints them.

## Acceptance Criteria

- [ ] `<u>x</u>`, `==x==` and `[x]{color="accent"}` each parse to a mark and
      render as styled text in the editor
- [ ] Each round-trips byte for byte: parse then serialize returns the input
- [ ] A document carrying **no** styling is byte-identical after a round trip
      (no new escaping anywhere — the churn rule `escape.ts` exists for)
- [ ] Text that merely looks like a marker is escaped on output so it does not
      become one on the next read
- [ ] Marks nest with the existing ones in a stated order, and two marks over
      one run print as nested wrappers rather than as adjacent broken ones
- [ ] A marker inside a code span or a fenced block stays literal text
- [ ] `looksLikeMarkdown` recognises a pasted styling marker

## Technical Design

### Files to Create/Modify

- `packages/kit/src/markdown/styled.ts` — new; `remarkCorpusStyling`, the one
  place the four forms become mdast nodes. Reads `@corpus/contract`'s scanners
- `packages/kit/src/markdown/styled.test.ts` — new
- `packages/kit/src/index.ts` — export the plugin and its node/attribute names
- `apps/ui/src/editor/markdown/schema.ts` — three marks: `underline`,
  `highlight`, `styleSpan`; add to `MARK`
- `apps/ui/src/editor/markdown/styledMarks.ts` — new; the three TipTap marks
- `apps/ui/src/editor/markdown/parse.ts` — map the plugin's nodes to marks
- `apps/ui/src/editor/markdown/serialize.ts` — print them
- `apps/ui/src/editor/markdown/escape.ts` — `=` and the `]{` sequence
- `apps/ui/src/editor/editor.css` — how a styled run looks while editing

### The remark plugin

`remarkCorpusStyling` follows `remarkCorpusRefs`'s shape: a transform over the
tree that splits `text` nodes on the patterns and emits a node of type
`corpusStyle` carrying `data.hName` / `data.hProperties`, so `react-markdown`
renders a real element without a raw-HTML path (UI-184 uses this; the editor
uses the same nodes).

**Underline is the one structural case.** remark parses `<u>` and `</u>` as two
separate inline `html` nodes with the text between them as siblings. The plugin
pairs them and wraps the siblings. This is a pairing over siblings, not a text
split, and it is why the plugin cannot be a regex over rendered output.

**This does not open a raw-HTML path.** The plugin recognises exactly the two
tokens `<u>` and `</u>` and produces an element for them. Every other tag stays
the inert text `MarkdownView` already makes of it — the guarantee in that
component's docblock is unchanged, and `rehype-raw` stays absent.

### Marks

`underline` and `highlight` carry no attributes. `styleSpan` carries the
attributes `@corpus/contract` admits inline (`color`, `highlight`).

`MARK_ORDER` in `serialize.ts` gains them between `strike` and `bold`:
`link, styleSpan, underline, highlight, strike, bold, italic, code`. The span is
outermost of the three because it is the one that can carry two attributes at
once, and code stays innermost as it is.

### Printing

Three custom mdast types printed by one handler, in the shape `REF_TYPE`
already uses — except that these **wrap** rather than being leaves, so the
handler prints `open + state.containerPhrasing(node, info) + close`:

- `corpusStyleUnderline` → `<u>` … `</u>`
- `corpusStyleHighlight` → `==` … `==`
- `corpusStyleSpan` → `[` … `]{color="accent"}`, the attribute list spelled by
  `formatStyleAttributes`

`PrintState` gains `containerPhrasing`. The highlight joins `FLANKING_WRAPPERS`
so `hoistEdgeWhitespace` moves an edge space outside the markers — `== x ==`
does not close, exactly as `** x **` does not. The other two do not care about
flanking and must not be hoisted: `<u> x </u>` is legitimate.

### Escaping

`needsEscape` gains one case: `=` is escaped when the character after it is `=`
and the pair would open or close a highlight — i.e. when it flanks. The `[`
case already escapes what would open a reference; it gains the `]{` shape by
way of `opensReference`'s sibling, a check for a closing `]` followed by `{`.

The safety net stays as it is: `serializeDoc` prints twice and falls back to the
printer's defensive escaping whenever the minimal output would parse
differently. A miss here therefore costs churn, never corruption.

### Edge Cases

- A styling mark over a `[[ref]]` or an image: the mark wraps the leaf, and the
  leaf still prints verbatim.
- A styling mark inside a table cell: the wrapper's own text goes through
  `safeInCell`, so an attribute list with a `|` in it cannot split the row.
  (No admissible value contains one, so this is belt and braces.)
- A mark over a run that ends a line: `trimLineEdges` runs after the wrapper is
  built, as it does for emphasis.
- `LEAF_NODES` is unchanged — these are marks, not nodes.

## Testing Strategy

- `styled.test.ts` in the kit: each form → nodes, each near-miss → text
- `roundtrip.test.ts`: each form, nested combinations, and a fixture body
  carrying all three plus existing marks
- `serialize.test.ts`: the flanking case (`== x ==`), the escaping case (prose
  containing `==` and `]{`), and the churn case — a marker-free fixture that
  must come back byte-identical
- `parse.test.ts`: markers inside code spans and fences stay literal

**Falsification, required.** Remove the `=` escape rule and watch the churn test
go red; a round-trip test that passes with escaping absent is not testing it.

## E2E Verification Plan

1. Start the real app against a workspace document
2. Type `==highlight==` in a document body, let autosave land
3. `git -C <workspace> show HEAD:<path>` — the file says `==highlight==`
4. Reload the document; the phrase renders highlighted, not as four `=` characters
5. Edit a *different* paragraph, save, and confirm `git diff HEAD~1` touches
   only that paragraph

## E2E Verification Log

### Post-Implementation Verification

_[filled by the implementer]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified
