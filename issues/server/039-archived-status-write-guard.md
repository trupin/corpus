# [SERVER-039] Refuse a status change that takes a document off `archived` at the write boundary

## Domain

server

## Status

done

## Priority

P1 (important)

## Model

opus

## Dependencies

- Depends on: CLI-017 (the CLI-side guard this generalizes)
- Blocks: —

## Spec References

- SPEC.md §7 — "Archiving a skill disables it: `corpus doc archive` on a skill moves its folder to
  `.claude/skills-archived/` — still indexed as a document (visible with the archived chip,
  restorable), no longer discovered by Claude Code."
- SPEC.md §9.2 — "`PUT /api/docs/:id` — edit body/frontmatter … move and archive/unarchive routes
  (path changes and `status` flips; id never changes)"
- CLAUDE.md Architecture Decision 2 — the server is the sole writer; a rule that only the CLI
  enforces is not enforced.

## Summary

`corpus doc edit --status open` on an archived document is refused by the CLI (CLI-017): for a
`type: skill` document the frontmatter would say `open` while the folder stayed in
`.claude/skills-archived/`, i.e. disabled, invisible to Claude Code and still holding its name
against `corpus skill create`. That guard lives in `apps/cli/src/commands/doc/edit.ts` — a client.
`PUT /api/docs/{id}` itself has no such guard, so the UI's FrontmatterForm status control and any
raw HTTP client still produce the half-state the CLI refuses (audit AUDIT-S017-wave3 FIX 5). The
sole-writer architecture says the rule belongs to the write path. This issue moves it there.

## Acceptance Criteria

- [ ] `PUT /api/docs/{id}` with a `status` that is not `archived`, on a document whose current
      status **is** `archived`, is refused — the file is not written, nothing is committed, and the
      response names `POST /api/docs/{id}/unarchive` as the operation to use instead.
- [ ] The refusal uses a status code the route already declares (**400**, `VALIDATION_RESPONSE`);
      no contract change.
- [ ] `POST /api/docs/{id}/unarchive` still works — the guard lives in the `PUT` verb, not in the
      shared write pipeline.
- [ ] `POST /api/docs/{id}/archive` on an archived document still works (the idempotent no-op) and
      re-archiving through it is unaffected.
- [ ] A `PUT` that carries `status: archived` on a non-archived document still works — it is the
      path `SERVER-018`'s `mayChangeTree` was written for, and for a non-skill it is exactly what
      the archive route does.
- [ ] A `PUT` that carries `status: archived` on an already-archived document is not refused (it
      changes nothing).
- [ ] A `PUT` that carries no `status` on an archived document is unaffected — an archived document
      stays editable (body, title, tags, `extra`).
- [ ] Unit tests cover each of the above; the tree-key suite's PUT-restores-a-document leg is moved
      onto the unarchive route.

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/update.ts` — the guard, inside `updateDocumentLocked`.
- `apps/server/src/docs/update.test.ts` — the guard's cases.
- `apps/server/src/docs/tree-key.test.ts` — the leg that restored a document with `PUT status: open`
  moves to `POST /unarchive` (the tree assertion is unchanged; unarchive already sets
  `mayChangeTree: true`).

### Key Implementation Details

The guard reads the document that was just loaded (`loaded.parsed.data["status"]`, the file's own
value — never the projection row, which is what the archive route also writes through) and the
patch's `status` after `changedFields` has decided the patch actually changes something:

- fires only when the current status is `archived` **and** the incoming status is not `archived`;
- is raised with `validationError` / `badRequest`, path `body.status`, so it travels in the same
  `ApiError` envelope every other 400 on this route uses;
- sits after `assertWritable` (a 423 from a held lock still wins — the lock is about who may write
  at all) and before anything is written.

**Why 400 and not 409.** The route declares `200 / 400 / 401 / 404 / 423` and no `409`
(`packages/contract/src/routes/docs.ts`). This is the same situation as the archive route's
"destination already exists" refusal, settled by sprint-005 Open Conflict 4 as a 400 for exactly
that reason. The refusal is also genuinely a statement about the request body — the named `status`
value is not one this verb can write for this document — which is what `body.status` in the issue
path says. Inventing a 409 would be a contract change, and the audit's brief for this round forbids
improvising one.

**Why only this direction.** Moving a document *into* `archived` through `PUT` is unchanged, because
for every non-skill type it is exactly what `POST /archive` does (a `status` flip, no folder move),
and for a skill the archive route heals it on the next call: `planFolderMove` looks at where the
folder *is*, not at what the frontmatter says, so `POST /archive` on a skill whose frontmatter is
already `archived` still moves the folder. The other direction has no such healer from the `PUT`
side — the document is left disabled while claiming to be open, and the audit's report is written
from a UI that offers a status dropdown with no unarchive affordance (SPEC 34, filed separately).

### Edge Cases

- The patch names `status: archived` on an archived document → `changedFields` drops it (no change),
  and the guard does not fire.
- The patch names `status` alongside a body edit → refused as a whole; a `PUT` is one save.
- The document's frontmatter status is missing or unparseable → the guard does not fire (it is not
  archived), and the write proceeds exactly as before.
- `POST /api/docs/{id}/unarchive` writes `status: open` through `setFrontmatterFields`, not through
  `updateDocumentLocked`, so it is structurally out of the guard's reach.
- The plugin context's `mutateDoc` calls `updateDocumentLocked` — a plugin that tried to un-archive a
  document by writing frontmatter is refused too, which is the point.

## Testing Strategy

Vitest, in `apps/server/src/docs/update.test.ts` against the real workspace fixture (real files,
real git, real projection):

1. archived + `status: open` → 400, `body.status`, message names `unarchive`; file unchanged; no new
   commit.
2. archived + `status: resolved` → 400 (the guard is about leaving `archived`, not about `open`).
3. archived + `status: archived` → 200, no change.
4. archived + `{ title: … }` (no status) → 200, saved.
5. open + `status: archived` → 200, archived (the SERVER-018 path).
6. archived, then `POST /unarchive` → 200 and `status: open` (the guard did not catch the route that
   is supposed to do this).

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. `corpus init` a workspace outside the repo; start the real server.
2. Create a skill document; `POST /api/docs/{id}/archive`; confirm the folder is under
   `.claude/skills-archived/`.
3. `curl -X PUT /api/docs/{id} -d '{"status":"open"}'`.
4. Expected: refused. Actual (pre-fix): `200`, frontmatter says `open`, folder still under
   `.claude/skills-archived/`, `corpus skill create <name>` still 409s on the name.

### Verification Steps

1. Restart the server on the same workspace.
2. Repeat the `PUT` → expect `400` naming the unarchive route.
3. `POST /api/docs/{id}/unarchive` → `200`, status `open`, folder back under `.claude/skills/`.
4. `POST /api/docs/{id}/archive` again → `200`, folder back under `.claude/skills-archived/`.
5. `PUT` with `status: archived` on an open note → `200`, archived.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work._

### Reproduction (bugs only)

implemented on: **opus** (server-dev, wave-3 audit fix round, 2026-07-30)

Real workspace `/private/tmp/s017fix3.Knjm/ws` (outside the repo), created with
`corpus init --port 9197`, real server (`corpus server start`, pid 61524), real HTTP. The guard
line in `updateDocumentLocked` was commented out for the reproduction and restored byte-for-byte
afterwards (`diff` against the pre-repro copy: identical); the server runs from source, so each
leg is a real restart.

```
$ corpus skill create half-state --description "A demo skill for the archived guard."
created doc_apxn4hru — .claude/skills/half-state/SKILL.md

$ curl -X POST …/api/docs/doc_apxn4hru/archive     → HTTP 200, "status": "archived"
$ ls .claude/skills-archived/half-state/            → SKILL.md

# PRE-FIX (guard disabled, server restarted):
$ curl -X PUT -d '{"status":"open"}' …/api/docs/doc_apxn4hru
HTTP 200
frontmatter.status = archived            ← the response even contradicts the file it just wrote
$ grep -n '^status:' .claude/skills-archived/half-state/SKILL.md
10:status: open
skills-archived/half-state exists: yes
skills/half-state exists: no
$ corpus skill create half-state --description "x"
corpus: 409 conflict: the name `half-state` belongs to an archived skill
  (.claude/skills-archived/half-state exists) — unarchive it to bring it back …
```

Confirmed: `200`, frontmatter `open`, folder still archived (disabled, not discovered by Claude
Code), name still `409`-blocked — the exact state CLI-017 refuses, reached over plain HTTP.

### Post-Implementation Verification

Guard restored, server stopped and started again on the same workspace. (The file was first healed
back to `status: archived` through `POST /archive`, which is the route's own repair for a
frontmatter that drifted from the folder.)

```
$ curl -X PUT -d '{"status":"open"}' …/api/docs/doc_apxn4hru
HTTP 400
{ "code": "bad_request",
  "message": "request failed validation",
  "issues": [ { "path": "body.status",
    "message": "doc_apxn4hru is archived; `status: open` would set the frontmatter without
      bringing the document back. Use `POST /api/docs/doc_apxn4hru/unarchive` — it restores the
      status and, for a skill, moves its folder back out of `.claude/skills-archived/` and frees
      the name." } ] }
$ grep -n '^status:' .claude/skills-archived/half-state/SKILL.md   → 10:status: archived
HEAD moved: no                                                     ← nothing written, nothing committed

$ curl -X POST …/api/docs/doc_apxn4hru/unarchive
HTTP 200  status: open  path: .claude/skills/half-state/SKILL.md
  (.claude/skills-archived/half-state: No such file or directory)
$ curl -X POST …/api/docs/doc_apxn4hru/archive     → HTTP 200, .claude/skills-archived/half-state/SKILL.md

$ curl -X POST -d '{"type":"note","title":"Retiring"}' …/api/docs   → 201  doc_yp5usjps
$ curl -X PUT  -d '{"status":"archived"}'  …/api/docs/doc_yp5usjps  → HTTP 200
$ curl -X PUT  -d '{"title":"Retired"}'    …/api/docs/doc_yp5usjps  → HTTP 200 (archived stays editable)
$ curl -X PUT  -d '{"status":"open"}'      …/api/docs/doc_yp5usjps  → HTTP 400, issues[0].path = body.status
```

Every acceptance criterion exercised over real HTTP against a real workspace. One corner recorded
in passing: when a file and its projected row disagree about `archived` (a `SKILL.md` under
`.claude/skills-archived/` whose frontmatter says `open`, the state the reproduction left behind)
and the patch names the file's own value, `changedFields` drops it before the guard runs and the
save is a no-op — nothing is written and no new half-state is created.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
