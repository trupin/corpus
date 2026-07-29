# [UI-014] Editor ownership of non-core document bodies (plugin fallback + unknown types)

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus — a gating change with a spec-clarification rider.

## Dependencies

- Depends on: UI-006, PLUGINS-001
- Blocks: —

## Spec References

- SPEC.md §11 — the always-editable document editor
- SPEC.md §10 — deletion safety: a removed plugin's documents "render as plain markdown"
- issues/evals/PLUGINS-001-eval.md — adjudication request 1 (2026-07-28)
- issues/sprints/sprint-011.md — adjudication "editor owns doc bodies always"

## Summary

Found by the sprint-012 evaluator: `editorHandlesType` has gated on `CORE_DOC_TYPES` since Phase 3,
so a document whose type is not core — including a plugin-owned type without a `View`, and any doc
after its plugin is deleted — renders through the static `MarkdownView`, not the always-editable
`DocEditor`. Sprint-011's adjudication ("the editor owns doc bodies always") and §11's
always-editable principle suggest the editor should own **every** markdown body that no plugin
`View` claims; §10's "renders as plain markdown" concerns the absence of plugin chrome, not
read-only-ness.

Extend the gate: any doc type without a registered plugin `View` renders in the standard editable
document view. A plugin `View` still wins for types that declare one. Includes a one-line §11
clarification (spec-writer, user sign-off at the phase PR) stating the rule.

## Acceptance Criteria

- [ ] A doc of an unknown/non-core type renders in the editable editor (autosave, locks) exactly
      like a core note.
- [ ] Deleting a plugin flips its typed docs from plugin `View` to the editable editor, not to a
      static render.
- [ ] Plugin `View`s still take precedence; `DocPanel` slot unaffected.
- [ ] §11 clarification drafted and held for user sign-off.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran
on._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
