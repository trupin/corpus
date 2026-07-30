# [SERVER-037] `POST /api/docs` with a dot-segment folder commits an invisible document

## Domain
server

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: SERVER-005
- Blocks: —

## Spec References
- SPEC.md §5 — document tree under `data/docs/`; §9.2 — write paths

## Summary
Found by server-dev during SERVER-036's containment verification (2026-07-30),
pre-existing: `POST /api/docs` with `folder: ".claude/skills"` is not refused — it
resolves inside the docs root to `data/docs/.claude/skills/` (containment holds,
nothing escapes), writes the file, **auto-commits it**, then answers
`404 no document with id doc_…` because `classifyPath` skips dot-segment paths and the
projection never indexes what was just committed. Net effect: a document created,
committed to the audit trail, and permanently invisible to every read surface. Fix
direction: refuse dot-segment folder components at validation time (400 naming
`folder`), before any write — reads should never have to learn about paths writes can
produce but the projection won't index.

## Acceptance Criteria
- [x] A `folder` containing any dot-prefixed segment is a 400 naming the field; nothing written, nothing committed
      (widened per Adjudication 15 to every segment `classifyPath` skips, derived by calling it)
- [x] Regression test walks the write→project round-trip for a near-miss legal folder to prove no over-refusal
- [x] Repro from SERVER-036's log reproduced pre-fix, refused post-fix

## Technical Design
### Files to Create/Modify
- `apps/server/src/docs/` folder validation (locate `normalizeDocFolder`/`resolveFolder`), colocated tests

## Testing Strategy
apps/server scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real server: pre-fix repro (create → commit → 404), post-fix 400 with clean tree and no commit.

## E2E Verification Log

implemented on: **opus** (server-dev, sprint-017 stage D, 2026-07-30)

Workspace: `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-server037-IUFbaU`, created with
`corpus init --port 9194` from a cwd outside this repository. Server started from source
(`node_modules/.bin/tsx apps/server/src/main.ts --workspace <ws>`), port **9194** per the contract.
`8765` checked and left alone before and after.

### TEST-557 — the bug, reproduced before any code changed

```
$ curl -X POST http://127.0.0.1:9194/api/docs -d '{"type":"note","title":"Invisible Doc","folder":".claude/skills"}'
HTTP 404
{"code":"not_found","message":"no document with id doc_2qk2usjf"}

$ find data/docs -type f
data/docs/.claude/skills/invisible-doc.md          <-- written
$ git log --oneline
4975d21 doc create: Invisible Doc (doc_2qk2usjf) by user     <-- committed
5c1c426 workspace: initialize corpus workspace by user
```

A document created, committed to the audit trail, and invisible to every read surface.

**The other half of the same line, reproduced too** (Adjudication 15): `classifyPath`
(`projection/roots.ts:135`) skips a segment that `startsWith(".")` **or** that
`IGNORED_DIRECTORIES.has(segment)`, and both doors produce the identical outcome:

```
folder=node_modules      -> 404 no document with id doc_ejaw377v   file: data/docs/node_modules/ignored-dir-doc.md      commit: c76feb1
folder=notes/.hidden/x   -> 404 no document with id doc_yulx5x7b   file: data/docs/notes/.hidden/x/nested-hidden.md     commit: 0a15e2b
```

### The fix

`resolveFolder` (`apps/server/src/docs/write.ts`) — the one place a `folder` field becomes a path,
shared by `POST /api/docs` and `POST /api/docs/{id}/move` — now refuses, after containment and before
anything is written, a folder the projection would not index. **The rule is not a copy of
`classifyPath`'s rule; it is `classifyPath` itself**, asked about a probe path in the folder:

```ts
const projectionIndexesFolder = (folder: string): boolean =>
  classifyPath(`${folder}/${FOLDER_PROBE_FILENAME}`) !== null;
```

There is therefore no second list to keep in step — a name added to `IGNORED_DIRECTORIES` is refused
here the same day, and `apps/server/src/projection/` is not modified at all by this issue (TEST-563:
`classifyPath` is **not** taught to index dot-segment paths, and `roots.ts` is untouched). The probe
filename is an ordinary slug, which is safe because `slugifyTitle` strips everything but `a-z0-9-`,
so no real filename can make the answer differ.

### TEST-558 / TEST-560 — every skipped segment is a `400` naming `folder`

Post-fix, against the same running workspace:

```
400 ".claude/skills"      folder is not a location documents are indexed from  issues[0].path = "folder"
400 ".foo"                idem
400 "notes/.hidden/x"     idem
400 "node_modules"        idem
400 "notes/node_modules/x" idem
400 "data/docs/.claude"   idem
400 "sub/.git"            idem
```

Message body (identical shape for all): `"<folder> contains a folder name the corpus never indexes
(a name starting with \`.\`, or an ignored directory such as \`node_modules\`), so a document filed
there could never be read back"`.

The derivation is pinned by a test that asserts the **equivalence** rather than a list
(`write.test.ts` → "refuses exactly the folders the projection declines to index"): for each
candidate segment it compares `resolveFolder`'s outcome against `classifyPath`'s verdict on the same
shape, so a hand-copied list that drifts fails immediately.

### TEST-559 — nothing written, nothing committed

Around the seven refusals above, in the drill workspace:

```
HEAD before: 0a15e2b1b5432c6cdd35acafcacbfa2e33181534
HEAD after:  0a15e2b1b5432c6cdd35acafcacbfa2e33181534      (unchanged)
git status --porcelain: only the two untracked server log files this drill created
/usr/bin/grep -rl "Invisible Post Fix" <ws>/data   -> no match (exit 1)
find <ws>/data/docs                                -> no new path; only the three files the
                                                      PRE-fix reproduction left behind
```

No file, no commit, no projection row, no id burned: the refusal is raised by `resolveFolder`, which
runs before the create lane is even entered.

### TEST-561 — legal near-misses, full round trip (no over-refusal)

Each created against the real server and then read back:

```
201 "my.notes"       -> doc_l6gfugrz  data/docs/my.notes/near-miss.md        GET /api/docs/{id} => 200
201 "v1.2"           -> doc_3tuuxe7g  data/docs/v1.2/near-miss.md            GET => 200
201 "notes/2026.07"  -> doc_5y4h7vd5  data/docs/notes/2026.07/near-miss.md   GET => 200
201 "a.b/c.d"        -> doc_nlchhkvz  data/docs/a.b/c.d/near-miss.md         GET => 200
201 "finance/2026"   -> doc_eztivs6k  data/docs/finance/2026/near-miss.md    GET => 200

git log --oneline | head -5   -> one `doc create: Near Miss (<id>) by user` commit per document
corpus db doctor              -> projection is clean — 19 documents from 19 files (2ms)
```

`POST /api/docs/{id}/move` inherits both halves through the same helper: `→ .claude/skills` is the
same `400`, `→ archive.2026` is `200` with the file at `data/docs/archive.2026/near-miss.md`.

### TEST-562 — containment is not weakened

The new check runs **after** the existing ones, and every pre-existing refusal keeps its own message
and error class:

```
400 "../../etc"                folder escapes the document root
400 "data/docs/../../escape"   folder escapes the document root
400 "/etc"                     folder must be a path under data/docs (absolute path)
400 "C:\Windows"               folder must be a path under data/docs (drive letter)
400 ".."                       folder escapes the document root
400 "a/../../b"                folder escapes the document root
201 "."                        normalizes to `data/docs` — unchanged, pre-existing, and indexable
```

`apps/server/src/core/paths.test.ts` (41 tests, including the `PathTraversalError` cases at
`:79-83,111-124,126-128`) passes **unmodified**; `core/paths.ts` was not touched.

### TEST-564 — forward-only, stated plainly

**This fix prevents creation. It cleans up nothing that was already committed.** Verified in the
drill workspace, which still holds the three documents the pre-fix reproduction created:

```
GET /api/docs/doc_2qk2usjf -> 404      GET /api/docs/doc_ejaw377v -> 404      GET /api/docs/doc_yulx5x7b -> 404
docs listing contains any of them: false
corpus db doctor -> projection is clean — 19 documents from 19 files
```

`db doctor` is **silent** about them, and necessarily so: `enumerateDocuments` skips the same
segments `classifyPath` does, so the files are invisible to the drift check as well as to the reader.
A workspace that ever hit this bug therefore carries files that only `git log` and a filesystem walk
can find, and nothing in the product will ever mention them again.

**Finding for the orchestrator to file (not done here, per scope):** if any real workspace may have
hit this, a recovery path is needed — either a `db doctor` warning that walks `data/docs/` ignoring
the skip rules and reports markdown files with Corpus frontmatter in unindexed locations, or a small
cleanup verb that moves them into `inbox/`. Inventing that migration inside this P2 is how a P2
becomes a P0, so it is reported rather than built.

### Tests

- `apps/server/src/docs/write.test.ts` — the refusal (six shapes, both doors, both nesting
  positions), the acceptance (five dotted-but-legal folders), and the equivalence-with-`classifyPath`
  test that makes a future second list fail.
- `apps/server/src/docs/create.test.ts` — route level: the four-folder refusal with `git status`,
  `HEAD` and the projection all proven untouched; and the full write → commit → project → read round
  trip for five legal near-miss folders.
- Full workspace run: **`vitest run apps/server` → 122 files, 2470 tests, all passing**
  (`VITEST_MAX_THREADS=4`). ESLint and Prettier clean on every touched file; `tsc --noEmit` clean.

### Blast radius (TEST-565)

This issue touched exactly three files: `apps/server/src/docs/write.ts` and the two colocated test
files above. `apps/server/src/projection/` is untouched **by this issue** (the projection diff in the
same session belongs to SERVER-032's `turns.form_answered` column, which does not go near
`classifyPath` or `roots.ts`). No `SPEC.md`, no `packages/contract` — `400` is a status both affected
routes already declare, checked rather than assumed: `packages/contract/src/routes/docs.ts:83`
(`createDoc` → `400: VALIDATION_RESPONSE`) and `:142` (`moveDoc` → the same) — and no `apps/ui`. Per this agent's standing rule it ran **no git command** in the development
repository (TEST-575); the blast-radius diff is the orchestrator's to run.

## Audit fix round

_Appended 2026-07-30 by server-dev (opus) in the wave-3 audit fix round
(`issues/evals/AUDIT-S017-wave3.md`)._

Nothing in the round touched this issue's blast radius: `apps/server/src/docs/write.ts` and its two
colocated test files are unchanged, and `classifyPath` / `roots.ts` were not read or edited. Two
neighbouring changes are worth knowing about when reading this issue later:

- **SERVER-039** (filed and implemented in the round, from audit FIX 5) adds a refusal to
  `apps/server/src/docs/update.ts` — a `PUT` may not move a document off `status: archived`, because
  for a `type: skill` document that writes the frontmatter and leaves the folder disabled in
  `.claude/skills-archived/`. Like this issue's refusals it is a **400**, and for the same reason:
  `packages/contract/src/routes/docs.ts:112` already declares `400: VALIDATION_RESPONSE` on
  `updateDoc`, so no contract change was needed.
- **FIX 16** made `openProjectionReadonly` (the handle `db doctor` opens) refuse a projection whose
  schema stamp is not this build's, instead of reporting it clean — the projection files this issue
  reasons about are unaffected, but `db doctor`'s verdict on a stale `cache.db` now differs.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes (ESLint + Prettier on every touched file; `tsc --noEmit` clean)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
