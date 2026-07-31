# [UI-027] Anchored text is never highlighted in the document body

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-008
- Blocks: —

## Spec References
- SPEC.md §11 document view: "threads sit Docs-style in the right margin, aligned to their anchors with connectors", "Clicking an anchored highlight opens its thread"; §6 anchors

## Summary
Evaluator finding (2026-07-30, UI-024 eval LEDGER-1 — pre-existing, reproduced on the
untouched floating-toolbar path too): after commenting on a selection, **no
`.anchor-hl` ever renders** — column reader, focus mode, and after a full reload with
two anchors verifiably on disk. The DOM carries only the empty margin container; the
`.anchor-hl` CSS ships unused (evidence: DOM dump grep — 0 markup hits, style-block
hits only). Two §11 behaviors are therefore unreachable: clicking a highlight to open
its thread, and margin cards aligned to anchors with connectors. Diagnose where the
anchor layer loses the ranges (anchors arrive in `GET /api/docs/:id`; the layer
resolves selectors to editor ranges) and make highlights + click-through + margin
alignment real in both hosts. The evaluator's rig steps are the reproduction recipe.

## Acceptance Criteria
- [ ] Commenting paints the highlight over the anchored words in both hosts, immediately and after reload
- [ ] Clicking a highlight opens/expands its thread (§11)
- [ ] Margin cards (focus/wide) align to their anchors; narrow columns keep chips at the anchor
- [ ] Orphaned anchors (§6) render per spec (no phantom highlight)
- [ ] e2e coverage for highlight presence — the gap that let this ship silently

## Technical Design
### Files to Create/Modify
- `apps/ui/src/anchors/` layer (diagnose first — resolution vs decoration); DocView/margin wiring; e2e spec

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4); e2e assertion on `.anchor-hl` in the hermetic suite (stub carries anchors in the doc payload).

## E2E Verification Plan
Real app: comment via toolbar and via context menu; highlight visible, clickable, survives reload; margin alignment in focus mode.

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
