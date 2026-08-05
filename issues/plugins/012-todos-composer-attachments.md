# [PLUGINS-012] The todos item composer takes attachments too

## Domain
plugins

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: SHARED-012, UI-070
- Blocks: —

## Spec References
- SPEC.md §11 as replaced by SHARED-012: the contract binds "any composer a
  plugin contributes"

## Summary
`plugins/todos/ui/TodoItemComposer.tsx` takes no attachments. The signed §11 text
covers plugin composers explicitly, so the reference plugin has to demonstrate
the capability rather than be the one surface without it.

This is deliberately the *second* consumer test of a kit surface. PLUGINS-011 was
the first — it consumed the composer key contract with a single root import,
nothing copied, and the boundary test unchanged, which is what vindicated putting
that helper in the kit rather than in `apps/ui`. UI-070 is required to publish
the attachment intake the same way.

**The interesting result this issue produces is whether that held.** If the
attachment surface is not cleanly consumable from a plugin, say so plainly and
file the gap against UI-045 — do not work around it with a copy, which is exactly
the debt UI-045 exists to retire.

## Acceptance Criteria
- [ ] A file can be attached to a todo item comment by picker, paste and
      drag-and-drop, with chip previews before sending
- [ ] Consumed from `@corpus/kit` — no copy of the intake or the chip strip
- [ ] The plugin boundary holds: only `@corpus/kit*`, `@corpus/contract`,
      `react`, `zod`; `imports.test.ts` passes unchanged
- [ ] An over-cap file is refused visibly, matching every other surface
- [ ] The composer key contract is unchanged (`↵` newline, `⌘↵` send)
- [ ] The attachment lands under the created thread on disk, verified against a
      real server

## Technical Design
### Files to Create/Modify
- `plugins/todos/ui/TodoItemComposer.tsx` + tests

## Testing Strategy
Component tests for intake and refusal; a real-app drill asserting the bytes on
disk under the thread the comment created.

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
