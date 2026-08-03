# [UI-051] Select text inside a turn and comment on it, with the selection quoted

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-009 (Amendment 2)
- Blocks: —

## Spec References
- SPEC.md §11 Thread view as amended by SHARED-009 Amendment 2
- §6 "Anchoring" and §6 "Recursion" (a thread is a document; commenting on a
  turn creates a child thread whose `parent` is the thread's id)
- §11 right-click menu ("Comment on selection")

## Summary
Live report 2026-08-03: _"In a thread, or any document for that matter. I want to
be able to select some text and comment on it. When in a thread though, I want the
selected text to automatically start a comment with a citation with the selected
text."_

**The mechanism is already there — the granularity is not.** Established by
survey:
- A thread may be the `parent` of another thread: §6 Recursion says so,
  `ThreadSchema.parent` carries no type restriction, and the server's create path
  loads the parent with no type check and writes `anchors` into its frontmatter.
  Child threads already render per-turn up to `MAX_RENDERED_DEPTH = 4`.
- The per-turn 💬 button exists (`Turn.tsx`, `NewChildThread.tsx`) but anchors to
  `turnAnchorText` — the turn's **first non-empty line of prose, truncated to 160
  characters** (`childThreads.ts`) — not to what the user selected.
- The selection menu **does** fire inside a turn: `nativeMenu.ts` keys on
  `.doc-body`, and turns render `className="doc-body turn-markdown"`. But the
  Comment item is absent because `useAnchorLayer.captureComment` returns `null`
  unless there is an editable TipTap editor with a non-empty PM selection — for a
  thread, `anchorsHost` is false by construction. So today a selection in a turn
  offers Copy and nothing else.

The work is a selection→selector path that does not require the TipTap editor,
plus the citation-prefilled composer.

## Acceptance Criteria
- [ ] Selecting text in a rendered turn offers **Comment on selection** in the
      selection menu (and via the floating toolbar if one is shown there)
- [ ] The comment creates a child thread whose `parent` is the thread's id and
      whose anchor is a §6 text-quote selector for **the selection**, not the
      turn's first line
- [ ] The selector carries the same prefix/suffix framing a document selection
      produces, so a duplicated phrase inside a turn anchors to the occurrence
      the user selected (the PR #19 MAJOR taught this lesson — do not anchor on
      `exact` alone)
- [ ] The composer opens with the selection quoted as a citation above the input
- [ ] The anchor is highlighted in the turn the way a document anchor is
- [ ] Whole-turn commenting still works and still anchors to the turn
- [ ] The existing document selection→comment path is unchanged
- [ ] Escape/layering behave like the document comment popover
- [ ] Composer keys follow UI-052's contract (`↵` newline, `⌘↵` send) — coordinate
      rather than shipping a fifth convention

## Technical Design
### Files to Create/Modify
- `apps/ui/src/anchors/useAnchorLayer.ts` (the `captureComment` editor
  precondition), or a sibling capture path for non-editable rendered bodies
- `apps/ui/src/menu/SelectionMenuItems.tsx` / `nativeMenu.ts` (offer Comment when
  the host is a turn)
- `apps/ui/src/thread/Turn.tsx`, `ThreadCard.tsx`, `NewChildThread.tsx`,
  `childThreads.ts` (selection anchor instead of/alongside `turnAnchorText`;
  citation prefill; highlight placement)
- `apps/ui/src/anchors/selectorFromSelection.ts` — currently PM-position based;
  a DOM-range path is needed for rendered (non-editor) bodies

### Notes
- Placement of an existing child thread back onto a turn currently works by
  `turn.body.includes(quote)` — with selection-level anchors, decide whether that
  stays sufficient or needs the same framing treatment.
- Do not regress `MAX_RENDERED_DEPTH` or the two-level requirement in §6.

## Testing Strategy
Component tests for the capture path and the citation prefill. E2E against the
real app: select a phrase inside a turn, comment, and assert the child thread's
selector on the wire matches the selection (prefix/suffix included), the
highlight lands on the selected words, and a duplicated phrase anchors to the
right occurrence.

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
