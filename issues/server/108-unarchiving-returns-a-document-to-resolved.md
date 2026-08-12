# [SERVER-108] Unarchiving returns a document to `resolved`, not to `open`

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: SHARED-031 (the status ladder rider, signed 2026-08-12, which
  explicitly foresaw this bug), SERVER-107 (the other half of the same rider the
  code never received), SHARED-032 (the bulk path, which shares the decision)

## Spec References

- SPEC.md **§5** — "It is reversible, and **search is how it is reversed**: …
  unarchiving happens from there, returning the document to `resolved` — the
  state archiving already implied — rather than to `open`, unless its status is
  **derived** (§12), in which case it returns to whatever its record now says"
- SPEC.md **§5** — "`archived` is **resolved, and out of sight** … there is no
  such state as an archived document with work outstanding"
- SPEC.md **§12** — "`archived` is not derived, because it is not a claim about
  what is left to do … unarchiving returns it to whichever of the two its items
  say at that moment"
- `issues/shared/031-what-the-three-statuses-mean.md:135-139` — "if it currently
  restores `open`, that is a bug this rider creates work for — file it against
  server"

## Summary

`apps/server/src/docs/archive.ts:493` writes the restored status as a bare
ternary over the requested direction:

```ts
status: archived ? "archived" : "open",
```

So unarchiving lands on `open` — the one thing §5's applied text says it does
not do. The rider is signed, so the code is what is wrong. Nobody filed the
issue SHARED-031 said to file; PR #44's third review found it as a **MAJOR**.

Two other sites hold the same belief and are part of the same fix:

- `apps/server/src/docs/archive.ts`'s `ownedFields` corrects a **carried** skill
  that still says `status: archived` under the enabled root to `open`. A carried
  document is being unarchived by the folder move — implicitly rather than by
  name, but by the same act — so §5 governs it identically, and leaving it would
  make one act produce `resolved` for the skill the caller named and `open` for
  the nested one it swept back.
- `apps/server/src/docs/bulk.ts` needs no change and that is the point: it
  archives through `planSetArchived`, so the bulk path follows this fix for free
  (`bulk.test.ts:597` pins the old value and is updated with the rest).

`PUT /api/docs/{id}` is not a second door: `docs/update.ts` refuses to leave
`archived` through it, so the dedicated route is the only one that restores.

## The derived-status carve-out

§5 exempts a type whose status is **derived** (§12) — a todo list unarchived with
items still open reads `open`, because the list is telling the truth rather than
the archive being overruled.

**No type derives its status today.** The todos plugin reports
`doc.frontmatter.status` verbatim (`plugins/todos/server/routes.ts:88`), and
nothing anywhere recomputes a status from body items — §12's "the derived value
is written into the document's frontmatter whenever the server writes the
document" is unimplemented in both directions. So the carve-out has nothing to
branch on and this issue deliberately does not invent the derivation to satisfy
it. What it does instead: state the rule in one place with the carve-out named in
the comment, so that whoever implements §12's derivation has one site to route
through rather than a ternary to rediscover.

**This is worth its own issue** (plugins or server, not decided here): §12's
derived todo status is specified, signed, and absent.

## Reproduction

Logged in the E2E Verification Log below. Real server, real routes: a document
resolved, archived, then unarchived comes back `open` — in the response body and
in the file's frontmatter.

## Acceptance Criteria

- [x] `POST /api/docs/{id}/unarchive` writes `status: resolved`, in the response
      and on disk
- [x] The same for a document that was `open` when it was archived — archiving
      settles it (§5's ladder), so there is no "memory of the previous status" to
      restore and none is kept
- [x] The bulk `unarchive` action agrees, because it plans through the same
      function
- [x] A carried skill whose frontmatter still says `archived` under the enabled
      root is reconciled to `resolved`, and the `carried_reconciliation` warning
      says so
- [x] Archiving is unchanged: `status: archived`, from any prior status
- [x] Unarchiving an already-unarchived document is still a no-op that writes
      nothing — a `resolved` or `open` document is never rewritten by it (the
      route's `contentChanged` guard, and the CLI's `isSettled`)
- [x] `archive.test.ts:159` and `bulk.test.ts:597` are updated rather than
      deleted
- [x] The CLI's `unarchive` help text no longer says the status comes back
      `open` — reported to the orchestrator, since `apps/cli` is another domain

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/archive.ts` — `planSetArchived`'s status, `ownedFields`'
  reconciliation target, the `reconciled` predicate that reads it back, and
  `carriedWarnings`' prose
- `apps/server/src/docs/archive.test.ts`, `apps/server/src/docs/bulk.test.ts` —
  the pins

### Out of domain, reported not changed

- `apps/cli/src/commands/doc/unarchive.ts` — the command description states the
  old rule twice
- `packages/contract/src/routes/docs.ts` — the unarchive route's OpenAPI
  description says "back to `status: open`"
- `packages/kit/src/client/createCorpusClient.ts:335` — the same sentence in the
  typed client's doc comment

## Testing Strategy

- `archive.test.ts` — round trip through `setArchived`: `open` → archive →
  unarchive lands `resolved`; `resolved` → archive → unarchive lands `resolved`;
  the file on disk carries it, and `updated` is stamped as for any write.
- `archive.test.ts` — the carried-skill reconciliation case asserts `resolved`
  and the warning's wording.
- `bulk.test.ts` — the bulk unarchive row reports `resolved`, which is what
  proves the two paths still share one decision.
- A no-op case: unarchiving a document that is not archived writes nothing (no
  new commit, bytes unchanged) — the guard that stops this rule from silently
  resolving an open document.

## E2E Verification Plan

Real server on a scratch port: create, resolve, archive, unarchive through the
real routes; read the response, the file, and `git log`.

## E2E Verification Log

Implemented on: **opus**.

Scratch workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/wsA`, real
`corpus server start` on port **8791** (never 8765 — the user's live server).
All calls are real HTTP against the running server with a real bearer token and
`x-corpus-author: user`.

### Reproduction (pre-fix, build of commit `ok4c58f8a5`)

```
create:    201  status=open        (doc_tfmrhzir, data/docs/inbox/round-trip-2.md)
PUT {status:"resolved"}:  200  status=resolved
POST /archive:            200  status=archived
POST /unarchive:          200  status=open       <-- SPEC.md §5 says `resolved`
file frontmatter status:  status: open
```

An earlier run in the same workspace, on a document archived straight from `open`
(`doc_av3qwoga`), answered `open` as well — so the ternary is unconditional,
exactly as read, and the document's prior status changes nothing.

### Post-fix

Rebuilt (`npm run build`), server stopped and started on the same workspace.

```
=== C. unarchive round trip ===
   doc_vgz6lg5e PUT resolved -> 200 resolved
   doc_vgz6lg5e (data/docs/inbox/round-trip-3.md)
       archive -> archived; unarchive -> resolved; file "status: resolved"
   doc_3z42cyfd (data/docs/inbox/round-trip-4.md)   [archived straight from `open`]
       archive -> archived; unarchive -> resolved; file "status: resolved"

=== D. no-op: unarchiving something that was never archived ===
   doc_vr2r27gn unarchive -> 200 open; bytes unchanged: true

=== E. bulk unarchive ===
   bulk -> 200 [{"id":"doc_gtbhnkd4","action":"unarchive"}]
   doc_gtbhnkd4 status now resolved
```

Both round trips land on `resolved` in the response **and** in the file, whether
the document was `resolved` or `open` when it was archived — there is no memory
of a previous status and §5 asks for none. The never-archived document comes back
`open` with its bytes byte-identical: the restore is not handed to a document
nobody archived.

Git, for the round-tripped document:

```
4c0ebc9 doc unarchive: Round trip 3 (doc_vgz6lg5e) by user
4ea1a9c doc archive: Round trip 3 (doc_vgz6lg5e) by user
```

The bulk door agrees, which is the assertion that matters: it plans through the
same `planSetArchived`, so a second opinion about the restored status is
structurally impossible rather than merely absent.

### Checks

- `npm run build` — green
- `npx vitest run apps/server` (`VITEST_MAX_THREADS=4`) — 179 files, 3755 tests,
  all passing
- Six tests pinned the old value and were updated with their reasoning:
  `archive.test.ts` (round trip, skill folder round trip, carried reconciliation,
  its warning detail), `bulk.test.ts` (the eight acts, the carried
  reconciliation), `update.test.ts` (the archive route still works in both
  directions). One new test was added for the no-op end of the rule.
- `npx eslint` and `npx prettier --check` on every touched file — clean;
  `tsc --noEmit` in `apps/server` — clean

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
