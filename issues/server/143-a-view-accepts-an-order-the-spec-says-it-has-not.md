# [SERVER-143] A view accepts an `order` the spec says it does not have

## Domain
server

## Status
todo

## Priority
P1 (important)

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 10 — rider 2, boards as documents (signed 2026-08-22): a
  view's `order` was removed, and a board's `order` is the bar's
- SPEC.md Section 5 — core frontmatter

## Summary

**Found by CLI-058's implementer while testing CLI-063**, against machinery
neither issue owned.

```
corpus doc edit doc_seedattention --order 5
```

on a `type: view` document **succeeds**. Rider 2 removed `order` from views in
Phase 41, and `POST /api/boards/order` enforces that — `PUT /api/docs/{id}` does
not.

So the product has one write path that refuses the field and another that
accepts it, and the one that accepts it is the general one every client uses.
Phase 41's migration told users to unset `order` on their views
(`corpus doc edit <id> --unset order`, CLI-061), and nothing stops it being put
back.

## Why it is P1

Nothing crashes. But an accepted write is a promise: the value is on disk, it is
in the projection, and a later reader is entitled to believe it means something.
Rider 2 says it means nothing on a view. A field that is writable and meaningless
is how the next release's migration gets written.

## Acceptance Criteria

- [ ] `PUT /api/docs/{id}` refuses `order` on a document whose type is `view`,
      and says why — naming the field and the rule, not a generic rejection.
- [ ] A `board` still accepts `order`. The refusal is by type, not by field.
- [ ] The refusal reaches the CLI as a real failure with a non-zero exit, so
      `corpus doc edit <view> --order 5` cannot silently appear to work.
- [ ] An existing view that already carries `order` is **not** broken by this: it
      still reads, still lists, and the field is still removable with `--unset`.
      A refusal on write must not become a refusal on read.
- [ ] The contract declares whatever status this refusal uses. CONTRACT-059 just
      closed the same class of gap on this exact route — do not reopen it.

## Technical Design

### Files to Create/Modify
- `apps/server/src/docs/update.ts` — the type-aware field guard
- its tests
- `packages/contract` — only if the refusal needs a status the route does not
  declare, which would be a separate issue with a dependency

### Key Implementation Details

The guard belongs beside the existing per-field rules in `update.ts`, not in a
new validation layer. That file already refuses `origin: null` for a non-user
actor and already knows the document's type.

**Read the reserved-key machinery first.** Phase 41 removed `pinned` and view
`order` from `RESERVED_FRONTMATTER_KEYS` and the schemas. Whatever remains there
is the natural home, and a second mechanism beside it is how two rules that agree
today stop agreeing.

### Edge Cases
- A document whose type changes from `board` to `view` while carrying `order`.
- `--unset order` on a view: must keep working, and is the migration's own
  instruction.
- A `PUT` that touches `order` with the same value it already holds. The server
  compares untouched keys structurally (SERVER-001), so decide deliberately
  whether a no-op write refuses or passes, and write the decision down.

## Testing Strategy

Unit tests over a real projection: a view refusing, a board accepting, a view
that already carries the field still reading and still unsettable.

**Falsify**: remove the guard and watch the view's write succeed again.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Start a real server on a scratch workspace with a seeded view
2. `corpus doc edit <view-id> --order 5`
3. Expected: a refusal naming the field and the rule
4. Actual: exit 0, and `order: 5` on disk

### Verification Steps
1. Repeat after the change and confirm the refusal and the exit code
2. `corpus doc edit <board-id> --order 5` still succeeds
3. A view already carrying `order` still reads, and `--unset order` still clears it

## E2E Verification Log

### Reproduction (bugs only)
_[Agent fills]_

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
