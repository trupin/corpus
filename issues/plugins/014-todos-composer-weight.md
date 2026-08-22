# [PLUGINS-014] The todos composer offers no weight control

## Domain

plugins

## Status

closed — obsoleted by SHARED-064 (Phase 41): the todos plugin, and the composer this issue is about, are deleted.

**Closed 2026-08-22 by SHARED-065 (Phase 41).** SHARED-064 removed the plugin
surface and the todos plugin on the user's instruction — *"I want it fully gone,
no trace of it in the codebase or the specs"* — and `todo` is not a document
type. The whole subject of this issue is
`plugins/todos/ui/TodoItemComposer.tsx`, which INFRA-031 deletes with the rest of
`plugins/`. There is no todos composer to give a weight control to. Nothing here
survives its cause: UI-082 already published the control and the level parser
from `@corpus/kit` with a `RUNTIME_SURFACE` entry, and this issue only ever asked
the todos composer to import them.
Kept as a record rather than deleted.

## Priority

P2

## Model

opus

## Dependencies

- Depends on: UI-082 (the control and its parser, published from `@corpus/kit`)
- Blocks: —
- Related: PLUGINS-012 — the identical situation for attachments, and the
  precedent for filing this rather than widening a UI issue

## Spec References

- SPEC.md §10, "Smart input everywhere" — the weight rider binds **"any composer
  a plugin contributes"**
- SPEC.md §12 — the todos plugin ships in v1, so its composer is not a sample

## Summary

Found by the pr-reviewer on PR #35. `plugins/todos/ui/TodoItemComposer.tsx:79`
sends `requestsAgent` with `asking` defaulting to `true` — it is a composer that
reaches the agent — and it offers no weight control.

This is a **gap in coverage, not a defect in UI-082.** §10 enumerates plugin
composers, and UI-082's own surface table delegates that row to "via
`@corpus/kit`", which UI-082 delivered: the control and the level parser are
published from the kit with a `RUNTIME_SURFACE` entry, so this is one import and
no copy. What was missing is this issue — PLUGINS-012 exists for exactly the same
situation with attachments, and no equivalent was filed for weight.

## Acceptance Criteria

- [ ] The todos composer offers the weight control, consumed from `@corpus/kit`
      — **imported, never reimplemented.** A second parser or a second control in
      `plugins/` is the copy the kit export exists to prevent
- [ ] Nothing is preselected, exactly as on the first-party surfaces
- [ ] A chosen level travels on the request the composer sends
- [ ] A workspace whose skill declares no parseable levels gets **no control**
      here either — never a fallback list
- [ ] Liveness follows the composer's own reach, and does not gate what reaches
      the agent (§8 owns that)
- [ ] The composer's key contract is unchanged and the control claims no key

## Technical Design

### Files to Create/Modify

- `plugins/todos/ui/TodoItemComposer.tsx`, plus its tests.

### Notes

- Read how PLUGINS-011 consumed the kit's key contract: one import, no copy. That
  is the shape of this change, and the reason the kit export was built.
- The weight scope for this composer is a decision worth making explicitly rather
  than inheriting — see UI-082's `weightChoice.ts` for how the first-party
  surfaces are scoped, and PR #35's finding that a choice made on an inert
  control must not seed a live one.

## Testing Strategy

Follow PLUGINS-012's shape. Drive the level set from a fixture declaration and
assert the composer offers it; assert nothing preselected; assert the chosen
level is on the request; assert the no-levels case offers no control.

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
