# [UI-050] Fenced canvases wrap long lines instead of scrolling horizontally

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: SHARED-009 (Amendment 5)
- Blocks: —

## Spec References
- SPEC.md §11 Thread view, copyable-canvases sentence as amended by SHARED-009
  Amendment 5

## Summary
Live report 2026-08-03: _"Snippets should show in canvas, but the content should
be wrapped rather than linear. Right now it shows the content as a horizontal
scroll where long lines need to be scrolled horizontally in order to be
visible."_ The user chose **always wrap** over a per-block toggle.

Current behavior, measured: `markdown.css` sets `.doc-body pre { overflow-x:
auto }` and declares **no** `white-space`, so the `<pre>` keeps the UA default
`white-space: pre` and long lines scroll sideways. `.doc-body` is bounded at
`62ch`, so in a narrow column a long fence line becomes a small horizontal
scroller. `CodeFence` is installed as `pre` on `MarkdownView`, so this is
identical in the reader, in thread turns, in focus mode and on plugin surfaces.

No test pins the current overflow anywhere (`CodeFence.test.tsx` and
`fences.spec.ts` contain no `overflow` assertion), so this is free to change.

## Acceptance Criteria
- [ ] Long lines wrap inside the fence canvas; no horizontal scrollbar
- [ ] Wrapping preserves the raw text exactly — the copy button still puts the
      original line structure on the clipboard, unwrapped (this is the property
      most at risk: do not let a CSS change become a content change)
- [ ] Indentation and leading whitespace survive wrapping (continuation lines
      must not lose the block's shape)
- [ ] Applies identically in the reader, thread turns, focus mode and plugin
      surfaces — one rule, one place
- [ ] The editor's own code blocks and `.md-raw` are considered: say whether they
      follow or deliberately keep scrolling, and why (`editor.spec.ts:130` pins
      `.md-raw` `white-space: pre` — do not break it accidentally)
- [ ] A test pins the new behavior so the next change is deliberate

## Technical Design
### Files to Create/Modify
- `packages/kit/src/markdown/markdown.css` — the `.doc-body pre` / `.fence-canvas`
  rules
- Tests in `packages/kit/src/markdown/CodeFence.test.tsx` and/or
  `apps/ui/e2e/fences.spec.ts`

## Testing Strategy
Assert computed style and, better, actual geometry: a long line's rendered box
must not exceed the canvas width. Round-trip the copy button against a block with
long lines to prove the clipboard text is unchanged.

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
