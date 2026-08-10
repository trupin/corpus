# [UI-104] The first save still rewrites 68 of 618 documents, and one of them changes meaning

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: UI-103 (whose sweep found these)
- Blocks: —

## Spec References

- SPEC.md **§11** — "the editor serializes to clean markdown", and autosave with
  no save button
- SPEC.md **§5** — files on disk are the source of truth
- SPEC.md **§1** — the corpus is the user's documents; the tool stewards them

## Summary

UI-103 fixed the fixed-point failures: all 618 repo documents now settle on the
first printing, where six did not. But its sweep also measured what the **first**
save still changes, and that is **68 documents** — down from 72, not to zero.

Normalisation on first save is partly by design: §11 says the editor serializes
to clean markdown. The question this issue exists to settle is **which of the 68
are normalisation and which are the tool rewriting the user's document**, and the
sweep already shows at least one of the latter.

## The one that changes meaning

**14 documents where a single unescaped `|` widens a whole table by a column.**
That is not tidying — a table gains a column that the author did not write, and
every row after it shifts. `issues/ui/099` and `issues/ui/077` were both hit by
it during UI-103's own investigation.

A `|` inside a table cell has to be escaped to be content; the printer is
emitting it bare, so the next read parses it as a delimiter. The reader is not
wrong — the writer is.

## The rest, as measured

- **51 documents**: a soft break inside an inline code span flattens to a space.
  This is remark's own `inlineCode` handler and matches CommonMark render
  semantics, so the rendered output is unchanged. Cosmetic on the page, but it
  still edits the file — decide deliberately whether that is acceptable rather
  than inheriting it.
- **3 documents**: mark-order normalisation.
- Loose lists tightened — already a documented normalisation.
- Malformed `**a **b** c**` emphasis healed in a way that **extends the bold
  run**. Healing malformed input is defensible; changing which words are bold is
  a content decision.

### The category UI-103 itself added — classified, per this issue's own rule

**40 documents gain a blank line inside a list item, which makes the list
loose.** Raised by PR #40's review (MINOR 3) and named here because it was
missing from both this issue's list and UI-103's: it is the entire measurable
effect of UI-103's fix on the corpus, and it is a rewrite the tool performs that
nobody asked for. `CLAUDE.md`'s `8. Format:` item plus its fenced block is the
concrete case — the item gains a blank line, and every item in that twelve-item
list re-renders `<p>`-wrapped.

**Classification: intended normalisation, not a defect.** Decided on the record
in UI-103 (*Where the blank line is not required, and why it is written anyway*),
with the per-adjacency measurements — of 164 adjacencies inside list items across
610 documents, 98 get a blank line that is not strictly required
(`paragraph → code` 48, `code → paragraph` 36, `paragraph → blockquote` 9,
`paragraph → table` 3, `code → code` 1, `paragraph → rawBlock` 1). The reasons it
stands rather than being narrowed:

- ProseMirror does not model list looseness, so tight and loose parse to the
  identical document. Nothing the editor could hold is lost, the output is a
  fixed point, and it is the same category as the already-listed "loose lists
  tightened" running the other way;
- every additional flush exception is a proof obligation over *all* spellings of
  the right-hand block plus the left-hand block not being extended by it, and the
  one exception written without discharging it fully had two live holes
  (UI-103's follow-up). `paragraph → rawBlock` cannot even be decided without
  classifying the HTML block type — `<div>` interrupts a paragraph, a bare
  `<custom-el data-x>` does not;
- blank-by-default is what makes a block type the schema grows later arrive
  separated rather than silently absorbed.

**It is still a byte rewrite of the user's file**, so if the looseness is
unwanted the answer is to make the printer emit loose items consistently, not to
narrow the join rule — a separate decision, and one for this issue rather than
UI-103.

## Also classify: an empty-only task list loses its task-ness

Found by the pr-reviewer on PR #40 and confirmed pre-existing — it reproduces at
`0b3ed418` and **at top level**, where UI-103's join rule never runs, so it is
not caused by that fix.

A task list whose **only** item is empty round-trips as a plain bullet list:
`doc(taskList(taskItem(emptyParagraph())))` prints `"-\n"`, which reads back as a
`bulletList`. The task-ness is gone. UI-103 strictly improved the nested case —
that shape used to turn the paragraph above it into an H2 — but the type loss
survives.

`SPELLINGS.taskListEmptyLead` uses two items, so the pair probe does not see it.
Whatever this issue decides about the other categories, decide this one too:
either the printer must spell an empty task item in a way that survives a read,
or losing task-ness on an empty-only list is accepted on the record.

## Acceptance Criteria

- [ ] The `|` case is fixed: a table cell containing a literal `|` round-trips
      with the same number of columns. This one is not a judgment call
- [ ] Every remaining category is **classified on the record** as either
      intended normalisation or a defect, with the reason. A category nobody
      classified is how this issue gets closed while a file still moves
      (the blank-line-in-a-list-item category is classified above; the rest are
      still open)
- [ ] The emphasis-healing case is decided explicitly: healing is fine, changing
      the bold run is a different act
- [ ] The sweep is a **test**, not a one-off script — round-tripping the repo's
      own documents and asserting the count of structurally-changed files does
      not grow. UI-103 ran it by hand; that is why 72 was never noticed
- [ ] Reproduce each fixed case before fixing, per the SDLC's rule for bugs

## Technical Design

### Files to Create/Modify

- `apps/ui/src/editor/markdown/serialize.ts` and its fixtures.

### Notes

- UI-103's fixture corpus had **zero** coverage of a list item holding anything
  but a nested list, which is how that bug shipped. Check what else the fixtures
  do not cover before assuming a category is safe.
- Do not fix the `|` case by making the reader tolerant. The file is what moved.

## Testing Strategy

Property: round-trip every document under `issues/` and `docs/` and assert the
set of structurally-changed files is empty for the fixed categories and matches a
pinned, commented list for the accepted ones.

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
