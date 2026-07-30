# [SERVER-035] Skill rollback must honor edit locks (+ lane TOCTOU, truncation wording)

## Domain
server

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-018
- Blocks: —

## Spec References
- SPEC.md §9.2 — "document write paths refuse edits to a document locked by the other party"; rollback routes
- SPEC.md §7 — skill rollback "lands as a normal auto-commit … like any mutation"

## Summary
PR #11 review (finding 1, MAJOR): `rollbackSkill`
(`apps/server/src/skills/rollback.ts`) is the only document write path that never
consults the edit-lock guard — every other mutation calls
`workspace.assertWritable(docId, actor)` (`docs/update.ts:221`, `docs/move.ts:35`,
`docs/archive.ts:103`, `docs/delete.ts:170`); rollback goes straight to
`mutex.run(...runMutation(...))`. Failure: user is editing `comment/SKILL.md` in the
board (session holds the lock — `corpus doc edit` would be 423-refused); agent runs
`corpus skill rollback comment` → server overwrites and commits over the in-progress
edit with no refusal. Rollback tests contain zero lock coverage. Also folds two
same-file MINORs from the review:

- **Finding 14 (TOCTOU)**: candidate read/selection (`rollback.ts:170-187`) runs
  outside the document lane; a save landing between the read and `mutex.run` is
  silently overwritten by a rollback chosen against stale bytes — violates the
  pipeline's inside-the-lane convention (SERVER-022 finding 7).
- **Finding 15 (refusal overclaim)**: the "history holds nothing that differs and
  validates" message (`rollback.ts:193-196`) asserts completeness the code didn't
  establish when the 50-revision walk (`git/show.ts:24-29`) truncates.

## Acceptance Criteria
- [ ] `rollbackSkill` calls the same edit-lock guard as the other write paths before mutating; when the other party holds the lock the route answers `423` (contract declares it per CONTRACT-018)
- [ ] Current-content read, candidate selection, validation, and the write all run inside the document lane — no window where a concurrent save is chosen-against-then-overwritten
- [ ] When `findLastKnownGood`'s revision walk truncates, the refusal message no longer claims exhaustiveness (scope the claim to the walked window, or walk to the root — pick one and say why in the log)
- [ ] Lock regression test: rollback against a doc whose lock the other party holds → 423, file and git untouched
- [ ] Lane regression test: a save entering the lane first is not overwritten by a rollback that read pre-save bytes (deterministic interleaving)

## Technical Design

### Files to Create/Modify
- `apps/server/src/skills/rollback.ts` — guard + restructure so selection happens inside `mutex.run`
- `apps/server/src/skills/*.test.ts` — lock + lane coverage
- `apps/server/src/git/show.ts` — only if the truncation fix lands there

### Key Implementation Details
Mind lock ordering when moving `withGitLock` inside the document lane: keep the
acquisition order every other path uses (document lane outermost unless the codebase's
convention says otherwise — check `runMutation` callers). `assertWritable` placement
should mirror `docs/update.ts`.

### Edge Cases
- `to === null` (last-known-good walk) and explicit `--to` both guarded.
- Lock held by the *same* party must still be writable (parity with other paths).

## Testing Strategy
apps/server scoped tests only (VITEST_MAX_THREADS=4): lock refusal, same-party pass-through, deterministic lane interleaving, truncation message case.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Start the real server against a scratch workspace (explicit --workspace, ports 9180+)
2. Acquire the session-side edit lock on a skill doc (as the board does), then `corpus skill rollback <name>` as the agent
3. Expected: 423 refusal. Actual (pre-fix): rollback overwrites and commits.

### Verification Steps
1. Restart after the fix; repeat — expect 423, file unchanged, no new commit
2. Release the lock; rollback succeeds as before

## E2E Verification Log

**Implemented on: opus** (server-dev, 2026-07-29).

### Pre-fix reproduction — real server, real workspace, before any code changed
`apps/server/src/skills/rollback.ts` restored to its PR #11 head state; scratch
workspace `~/.claude/jobs/4dd0ddef/tmp/s035-repro` created with `corpus init`
(real git repo), server started with `corpus server start` on port 9180. Two
committed revisions of `.claude/skills/comment/SKILL.md` made through the API.

```
1. user (the board session) takes the edit lock
   POST /api/locks/doc_skillcomment  (x-corpus-author: user)   -> 201
2. proof the lease is live: an ordinary agent edit is refused
   PUT /api/docs/doc_skillcomment    (x-corpus-author: agent)  -> 423 locked
3. before
   sha256(SKILL.md) = 8ee61770…afc6f
   HEAD             = ec06e1c7a2f7f3b2dec2a45d1df16282b2246438
   body             = "BAD EDIT — this broke the loop."
4. POST /api/skills/comment/rollback (x-corpus-author: agent)  -> 200   <-- BUG
   {"name":"comment","docId":"doc_skillcomment",
    "commit":"e2e1e9df31ad77470fac79c34259402daa5824ce", …}
5. after
   sha256(SKILL.md) = ab4988c1…9d7d9      (overwritten)
   HEAD             = e2e1e9df…5824ce     (new commit)
   git log -1       = "agent  skill rollback: comment (doc_skillcomment) to a2103f5 by agent"
```

The user's in-progress edit was discarded and the discard was committed, while
the very same document refused a `PUT` from the same actor one call earlier.

### Post-fix verification — same workspace, server restarted
```
1. user holds the lease; a fresh bad edit is saved by the holder
   before: sha256 = 291b9bca…0fe77  HEAD = 1ccadec6…7f444a
   POST /api/skills/comment/rollback (agent) -> 423
     {"code":"locked","message":"doc_skillcomment is being edited by user; …",
      "lock":{"docId":"doc_skillcomment","holder":"user","acquired":"…","ttl":300}}
   after:  sha256 = 291b9bca…0fe77  HEAD = 1ccadec6…7f444a   (byte-identical)
2. through the CLI the agent actually uses
   corpus --from agent skill rollback comment           -> exit 5, file/HEAD unchanged
   corpus --from agent --json skill rollback comment    ->
     {"error":{"code":"locked","message":"423 locked: doc_skillcomment is being edited by user; …",
               "details":{"holder":"user", …}}}
   (the CLI's default actor is `user`, so the bare `corpus skill rollback comment`
    is the *holder* rolling back and is correctly allowed — `--from agent` is the
    agent's path and is the one refused)
3. the explicit `--to <rev>` path is guarded too       -> 423
4. same party holds the lease and rolls back            -> 200, restored
5. lease released, agent rolls back                     -> 200,
   git log -1 = "agent  skill rollback: comment (doc_skillcomment) to 2faecae by agent"
6. truncation wording, on a skill with 51 commits touching it, none restorable:
   404 "no earlier committed version of .claude/skills/deep/SKILL.md to restore —
        none of the 50 most recent commits touching it holds content that differs
        from the file on disk and validates, and older commits were not examined;
        name one explicitly with `to` to restore it"
7. and unchanged for a history the walk reached the end of:
   404 "… — its history holds nothing that differs from the file on disk and validates"
```
Server stopped by pid; ports 9180–9199 free; `corpus/.corpus` does not exist.

### What changed
- `apps/server/src/skills/rollback.ts`
  - The whole verb now runs inside `mutex.run(docId, …)`: `assertWritable` first
    (the same one-call-per-verb placement as `docs/update.ts`), then a re-check
    that the skill still exists, then the current-content read, the candidate
    selection under `withGitLock`, the validation, and `runMutation`. Lock
    ordering is the codebase's: **document lane outermost, git lock innermost**,
    released before `runMutation` takes it for the commit — documented in the
    file header.
  - `documentIdFor` no longer derives the id from the *restored* bytes (it
    cannot: the lane key has to exist before anything is read). It is the id of
    what occupies the path now — the projection row, or the skills root's
    path-derived synthetic id when the file is too broken to have a row. §5 makes
    ids immutable, so an old revision declaring a different id is describing a
    document this workspace does not have. `readDocumentIdentity` is no longer
    needed here, and the unreachable `badRequest` branch it guarded is gone.
  - `findLastKnownGood` returns `{candidate, truncated}`; it lists
    `REVISION_SEARCH_LIMIT + 1` shas and walks the first `REVISION_SEARCH_LIMIT`,
    so the extra sha is a free truncation probe (one `git log`, no extra
    `git show`). `noCandidateReason` scopes the refusal accordingly.
- `apps/server/src/skills/rollback.test.ts` — 7 new tests (5 lock, 2 lane) plus
  the two truncation-wording tests. `git/show.ts` needed no change.

### Truncation: scoped, not exhaustive — and why
Acceptance criterion 3 offered "scope the claim to the walked window, or walk to
the root". **Scoped.** The bound is deliberate and `REVISION_SEARCH_LIMIT`'s own
doc comment says so: each candidate costs one `git show` inside a request
handler, so walking to the root would make a rollback's latency a function of the
repository's age — on a workspace with years of history that is a request that
never returns. The window already has an escape the walk does not: `to` restores
any revision git resolves, and an operator who needs revision 51 knows which one
it is. The refusal now names the window and points at that escape.

### Tests
`apps/server/src/skills/rollback.test.ts` — 33 tests, all passing (was 26).
Proven to be real regression tests: with the three fixes temporarily reverted in
place (guard removed, `current` read hoisted back outside the lane, refusal
message unqualified), **exactly the 7 new tests fail and all 26 pre-existing ones
still pass**; restoring the fix returns all 33 to green. The lane tests are
deterministic — the lane is held directly by the test (`mutex.run(docId, () =>
held)`) so "the save went first" is decided, not timed. The queued-rollback lock
test uses the same real `pre-commit` parking hook `locks/write-guard.test.ts`
uses. Full `apps/server` suite: **121 files, 2385 tests, all passing**.
`tsc --noEmit` in `apps/server`: clean. ESLint over `apps/server/src`: clean.

### Decisions taken that the issue left open
- **Lane key.** See `documentIdFor` above — one id, from the projection/path,
  never from the restored bytes. The only behaviour this changes is the
  vanishingly rare "no projection row **and** the restored revision declares its
  own `id:`" corner, where the old code would have adopted the old revision's id;
  §5 says it must not.
- **Existence is checked twice** — once before the lane (so an unknown skill name
  is refused without queuing behind an unrelated write) and once inside it (so a
  deletion that landed while the rollback waited is the same uniform `404`
  rather than an `ENOENT` 500).
- **`--to` never reports truncation**: it examines exactly the revision it was
  given, so there is no window to scope.

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
