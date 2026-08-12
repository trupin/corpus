# [SERVER-099] Remove the lock subsystem

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SERVER-098 (keys work before locks go)

## Spec References

- SPEC.md **§7** — "Nothing to acquire, nothing to release, nothing to break"
- SPEC.md **§4** — "Two acts commit alone" (was three; the force unlock is gone)
- SPEC.md **§9.4** — the `locks` projection table, struck

## Summary

The deletion half of SHARED-041. Locks are **removed**, not deprecated beside the
new mechanism — the user's decision 7, and the reason is that two coexisting
mechanisms is how the forgettable one survives.

## Acceptance Criteria

- [ ] `apps/server/src/locks/` is gone in full, and every import of it
- [ ] The lock guard is out of every write path. No route returns `423`
- [ ] The `locks` projection table is dropped, with a schema migration — the
      projection has a `SCHEMA_VERSION` and this is a real change to it
- [ ] `.corpus/locks/` is no longer watched (§9.4) and no longer created
- [ ] The **force-break commit and its audit entry are gone**, including the
      `closeWindow("commits-alone")` SERVER-092 added for it. §4 now says two
      acts commit alone, not three — check that paragraph reads correctly
- [ ] An **existing workspace with `.corpus/locks/` on disk** starts cleanly and
      is not confused by it. Decide whether the directory is removed or ignored,
      and say which. A leftover lock file must not resurrect any behaviour
- [ ] The queue's `deferred` state survives with its new trigger (§7): re-entry
      is driven by an edit session ending, not by a lock clearing
- [ ] Nothing that referenced a lock is left half-referring to one — sweep the
      way SHARED-041's own sweep did, by grepping rather than by memory. That
      sweep found four references the plan had missed

## Technical Design

### Files to Create/Modify

- **Delete** `apps/server/src/locks/` (11 files)
- `apps/server/src/app.ts` — construction and route mounting
- `apps/server/src/projection/` — the table and a schema-version bump
- `apps/server/src/watcher/` — the watched path
- `apps/server/src/queue/` — the deferral re-entry trigger
- `apps/server/src/docs/*` — the guard calls

### Edge Cases

- **The projection migration.** A user upgrading has a `locks` table with rows.
  Dropping it is the change; make sure the migration path is exercised against a
  populated database, not only a fresh one.
- **`git-fixture.ts`** lives under `locks/` but is a test double for the git
  writer, used elsewhere. Move it rather than delete it.

## Testing Strategy

Deletion is proved by absence: the routes 404, the table is gone after migration,
and the full suite passes with no lock test remaining. Add a migration test
against a database that **has** the table.

## E2E Verification Plan

Real server on a free port (**never 8765 or 5173**). Start against a workspace
that already has `.corpus/locks/` and a populated projection; confirm a clean
start, a working migration, and that two writers still behave per SERVER-098.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (deletes a subsystem and migrates a user's database)
- [ ] Committed with `[ISSUE-ID]` prefix
