# [UI-072] Hard-wrapped prose shows its line breaks in the document editor

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §11 Document view (TipTap over markdown, autosave, "serializes to clean
  markdown")
- SPEC.md §11 thread view, as amended by SHARED-009 Amendment 7 (newlines render
  by author) — the read surface's answer to the same question

## Summary
Live report 2026-08-05, with a screenshot of an agent-written document: the prose
breaks mid-sentence at roughly 80 columns —

> …Tomorrow is a
> Wednesday, so the
> office opens an hour later than the rest of the week…

**Mechanism, traced:**
1. The agent writes hard-wrapped markdown (~80 columns) — measured during
   UI-054: 10 of 11 agent turns in the live workspace wrap this way. It is the
   agent's house style, not a defect.
2. remark parses a single newline inside a paragraph as part of one `text` node,
   value and all.
3. `apps/ui/src/editor/markdown/parse.ts` `case "text"` passes `md.value`
   straight through, so the ProseMirror text node contains a literal `\n`.
4. `apps/ui/src/editor/editor.css:38` sets `.doc-editor .ProseMirror {
   white-space: pre-wrap }`, which renders that `\n` as a visible line break.

So the **document view disagrees with CommonMark and with the app's own read
surface**: a single newline is a space everywhere else (that is exactly why
UI-054 had to add `remark-breaks` to get user turns to break at all), and here it
is a break. Every hard-wrapped document — most of what the agent writes — reads
ragged.

## The constraint that makes this non-trivial
**A fix must not silently rewrite the file.** The editor autosaves (§11), so
whatever the parse does, the serializer round-trips it back to disk on the next
keystroke. Normalising newlines to spaces at parse time would re-flow every
agent-written paragraph the moment the user opens the document — a whole-file
diff nobody asked for, auto-committed, on every document they read. That is worse
than the ragged rendering.

So the shape to aim for: **the model keeps the author's bytes; the view stops
drawing them as breaks.** Options, to be weighed rather than picked by default:

1. **Render-side.** Stop `pre-wrap` from turning soft newlines into breaks while
   keeping what it is actually there for (typed spaces, indentation). Establish
   what `pre-wrap` is load-bearing for here before changing it — ProseMirror
   relies on it for whitespace fidelity while typing, so plain `normal` is likely
   to break something.
2. **Model-side with fidelity.** Keep the newline out of the text node but record
   it so the serializer re-emits the original wrapping. This is the round-trip
   trace's territory (`serialize.ts` already carries one) — expensive, and worth
   it only if option 1 has no clean answer.
3. **Producer-side (partial at best).** Teach the agent not to hard-wrap
   (AGENT-012's neighbour). It does nothing for the documents that already exist
   or for anything a human pasted in, so it cannot be the whole answer.

## Acceptance Criteria
- [ ] A hard-wrapped paragraph renders as flowing prose in the document editor,
      the way it does in every read surface
- [ ] **The file is unchanged by opening and closing the document.** Byte-for-byte
      — assert it, because this is the criterion the obvious fix violates
- [ ] Typing still works: caret placement, selection, and whitespace fidelity
      while typing are unaffected
- [ ] Deliberate hard breaks still render as breaks — markdown's two-trailing-
      spaces and backslash forms both survive (`roundtrip.test.ts` has cases)
- [ ] Code blocks, `.md-raw` and table cells keep their own whitespace rules
      (`editor.spec.ts:130` pins `.md-raw`)
- [ ] Consistent with the thread view's signed answer (SHARED-009 Amendment 7):
      a person's typed newline breaks, an author's soft wrap does not
- [ ] A test with a hard-wrapped fixture asserting both the rendering and the
      byte-identical round-trip

## Technical Design
### Files to Create/Modify
- `apps/ui/src/editor/markdown/parse.ts`, `editor.css`, possibly `serialize.ts`
- tests alongside, plus an e2e on a hard-wrapped fixture

### Notes
- UI-054 measured the workspace and found the agent hard-wraps at ~80 columns;
  that measurement is the reason this affects most documents rather than a few.
- Check whether the same literal newline reaches other `pre-wrap` surfaces.

## Testing Strategy
Unit: a hard-wrapped fixture through parse → serialize, asserting byte equality.
E2E: open an agent-written document, assert the rendered paragraph has no break
where the file has a soft newline, then close it and assert the file is unchanged.

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
