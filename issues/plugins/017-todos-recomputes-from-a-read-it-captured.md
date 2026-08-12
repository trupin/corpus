# [PLUGINS-017] The todos plugin writes from a read it captured, and the key now catches it

## Domain

plugins

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-049, SERVER-098
- Related: SHARED-041

## Spec References

- SPEC.md **§7** "A key, not a lock" — what needs a key
- SPEC.md **§10** — the plugin surface

## Summary

Found by SERVER-098 while verifying its own work, and filed because nothing in
Phase 30's chain covered `plugins/`.

`plugins/todos/server/routes.test.ts` has **28 failures**, all `400` where `201`
is expected. `mutateItems` and `migrateOne` return `{ body, … }` from
`mutateDoc`, and `UpdateDocRequestSchema`'s refinement now refuses a body that
carries no key.

**This is the mechanism working, not a regression to route around.** A plugin
that rewrites a whole body from a document it captured earlier is exactly the
blind overwrite §7 exists to stop. That the plugin happens to be correct today —
`mutateDoc` hands the callback the document read *inside* the lane, so it is by
construction the version being overwritten — is a property nothing was checking.
Presenting the key makes it checked.

## Acceptance Criteria

- [ ] `mutateItems` and `migrateOne` present the key of the document `mutateDoc`
      handed them. SERVER-098's reading is that this is two lines in
      `plugins/todos/server/routes.ts`; verify that before trusting it
- [ ] The test fixture's `docFixture` carries `key` and `userEditing`
- [ ] **Do not** work around the refusal by making the key optional on this path
      or by re-reading immediately before writing. Either would restore the blind
      overwrite with extra steps
- [ ] Check whether any other plugin surface writes a whole body from a captured
      read. `plugins/` is small; the point is to answer the question rather than
      fix the one call site that failed a test
- [ ] The kit's plugin-facing types expose whatever a plugin needs to do this
      without reaching around the surface (§10)

## Technical Design

### Files to Create/Modify

- `plugins/todos/server/routes.ts`, `plugins/todos/server/routes.test.ts`

### Notes

- `apps/server` is not on this path — SERVER-098 confirmed it. This is purely
  CONTRACT-049's consequence reaching the plugin surface.

## Testing Strategy

The 28 failures are the test: they should pass by the plugin presenting a key,
not by the schema accepting its absence. Add one case that a *stale* key from a
captured read is refused, so the guarantee is asserted rather than incidental.

## E2E Verification Plan

Real server on a free port (**never 8765 or 5173**), scratch workspace under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`. Check a todo item through the
real plugin route.

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
