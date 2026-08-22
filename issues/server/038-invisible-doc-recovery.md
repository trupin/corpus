# [SERVER-038] Recovery path for already-committed invisible documents

## Domain
server

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: SERVER-037, CONTRACT-025 (doctor warnings surface — sprint-018 Open Conflict 1)
- Blocks: —

## Spec References
- SPEC.md §5 — document tree; §11 — doctor/validation

## Summary
SERVER-037's TEST-564 finding (2026-07-30): the fix is forward-only, and `db doctor` is
*structurally* silent about invisible documents committed before it — `enumerateDocuments`
skips the same segments `classifyPath` does, so a pre-fix file under
`data/docs/.claude/…` or `data/docs/node_modules/…` is findable only by `git log` plus a
raw filesystem walk. Add a recovery surface: a doctor warning pass that walks
`data/docs/` ignoring the skip rules and reports unindexable files (path + the commit
that created them), and/or a small cleanup verb. Report-only is an acceptable v1 —
deletion stays a user act.

## Acceptance Criteria
- [x] `corpus db doctor` (or a dedicated flag) names every file under `data/docs/` the projection will never index, with its creating commit
- [x] Zero false positives on a healthy workspace (near-miss folders like `my.notes` stay silent)
- [x] Report-only unless a cleanup verb is explicitly added with user-act semantics

## Technical Design
### Files to Create/Modify
- `apps/server/src/projection/` doctor pass (+ tests); CLI output passthrough if doctor's wire shape changes (contract rider then)

### Decisions taken (sprint-018 TEST-606, TEST-609, TEST-612)

**`ok` and the exit code (TEST-609).** A finding is a **warning**, never drift:
`ok` stays `true`, `corpus db doctor` still exits **0**, and `rebuild && doctor`
stays clean on every affected workspace. What a user with an affected workspace
experiences: the invisible files are named, with the commit that added them, and
their pre-commit hook keeps passing — because nothing is wrong with their
projection. The projection is *correct*: those files can never be indexed, by
any rebuild, so a `doctor` that failed would be a check nobody could ever make
pass except by deleting files, and deletion is a user act (§7). The human
output, the `--json` output and the exit code agree: the warning lines print in
the drift lines' voice, `warnings` carries the same list, and `ok: true` /
exit 0 is what both say. Drift and its exit 6 are untouched — a workspace with
both prints both and exits 6.

**The dot-leading filename (TEST-612), generalised.** A finding is a markdown
file that `classifyPath` refuses **and** that carries Corpus frontmatter with a
valid `id`, read through the projector's own `readDocumentIdentity`. So
`data/docs/.hidden.md` with an `id` is reported and `data/docs/.scratch.md`
without one is not — the discriminator SERVER-037's finding proposed. The rule
is applied to *every* skipped location rather than only to dot-leading
filenames, because the reasoning is the same everywhere: a file with an `id` is a
document the corpus will never show again; one without is somebody's own file
(a vendored `node_modules/**/README.md`, a `.drafts/` folder they are
deliberately hiding). It also keeps the pathological case affordable — a
`node_modules` tree yields no findings and therefore no `git log` at all.

**Rooted at `data/docs` only (TEST-606).** `.claude/skills` indexes only
`SKILL.md`, so a walk there would report every skill's `README.md`;
`data/threads` is flat, so it would report every nested file. Both are
legitimate shapes and both are knowingly out of scope here.

**Bounded (not in the contract, but in the code).** The report lists at most
`UNINDEXABLE_WARNING_LIMIT = 50` findings and then says so with a second,
server-only warning kind (`unindexable_files_truncated`, `path: null`). Each
finding costs one `git log` child process; a workspace with a whole tree in the
wrong place — the exact accident this pass exists for — would otherwise make
`doctor` spawn thousands of processes inside one request. The wire's kind space
is open by design (CONTRACT-025), so this needed no contract change: an
unrecognised kind still renders its `detail`.

## Testing Strategy
apps/server scoped (VITEST_MAX_THREADS=4); fixture with a pre-seeded invisible file.

## E2E Verification Plan
Real server on a workspace carrying a pre-fix invisible file (SERVER-037's repro recipe): doctor names it; healthy workspace stays clean.

## E2E Verification Log

**Implemented on: opus** (`claude-opus-5[1m]`). Port **8794** (primary) and
**8795**; scratch under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s018-server/`, every drill run
from a cwd outside this repository. `8765` never bound, probed or proxied.

### TEST-603 — the blind spot, reproduced before the fix

Workspace `…/s018-server/038-k2bWjT`, `corpus init --port 8794` (explicit port).
Seeded by **file write plus commit** — SERVER-037's refusal blocks the API route
that originally created these, so the old recipe no longer works and this one
says so instead of pretending otherwise:

```
7238c6f seed three invisible documents (pre-SERVER-037)
 data/docs/.claude/skills/invisible-doc.md  | 9 +++++++++
 data/docs/node_modules/ignored-dir-doc.md  | 9 +++++++++
 data/docs/notes/.hidden/x/nested-hidden.md | 9 +++++++++
```

Pre-fix server on 8794:

```
$ corpus db doctor
projection is clean — 9 documents from 9 files (1ms)
exit=0
$ corpus db doctor --json
{"ok":true,"drift":[],"stats":{"files":9,"documents":9,"hashed":0,"parsed":0,"durationMs":1}}
$ corpus doc show doc_inv1skill0001 --json
{"error":{"code":"not_found","message":"404 not_found: no document with id doc_inv1skill0001"}}   (same for the other two)
$ /usr/bin/grep -c "invisible-doc\|ignored-dir-doc\|nested-hidden" doclist.json
0
```

Clean verdict, exit 0, three committed documents on disk, none listed, none
readable.

### TEST-604 — every invisible document named, with its creating commit

Same workspace, post-fix server (restarted, pid 8793). Human output, verbatim
(one line per finding, in the drift lines' voice):

```
unindexable_file data/docs/.claude/skills/invisible-doc.md: … Added in 7238c6f "seed three invisible documents (pre-SERVER-037)". Move it elsewhere under data/docs/ or delete it — doctor changes nothing.
unindexable_file data/docs/.hidden.md: … Added in 06d5d0c "seed near-miss fixtures and one dot-leading document". …
unindexable_file data/docs/node_modules/ignored-dir-doc.md: … Added in 7238c6f "seed three invisible documents (pre-SERVER-037)". …
unindexable_file data/docs/notes/.hidden/x/nested-hidden.md: … Added in 7238c6f "…". …
projection is clean — 19 documents from 19 files (24ms)
exit=0
```

`--json` carries the same four with `kind`/`path`/`detail`/`commit`
(`7238c6f`, `06d5d0c`, `7238c6f`, `7238c6f`), and raw HTTP agrees:
`GET /api/db/doctor` → `ok=True warning kinds=['unindexable_file'] commits=['06d5d0c','7238c6f']`.

### TEST-605 — the named near-miss list, item by item

Every item below was created **and committed** in the same workspace as the four
findings, so the pass was live while they were checked. Measured by
`/usr/bin/grep -o <item> doctor.json | grep -c .` over the full `--json` report:

| item | mentions in the report |
| --- | --- |
| `data/docs/my.notes/a.md` | 0 |
| `data/docs/v1.2/b.md` | 0 |
| `data/docs/notes/2026.07/c.md` | 0 |
| `data/docs/a.b/c.d/d.md` | 0 |
| `data/docs/finance/2026/e.md` | 0 |
| `data/docs/archive.2026/f.md` | 0 |
| `data/docs/node_modules.md` (file named like the ignored dir) | 0 |
| `data/docs/inbox/g.md`, `data/docs/templates/…`, `data/docs/views/…` | 0 |
| `data/docs/README.md` (indexed, and not reported as ignorable) | 0 |
| `data/docs/a/b/c/d/e.md` (deep nest) | 0 |
| `data/docs/notes.txt`, `data/docs/assets/diagram.png`, `**/.gitkeep` | 0 |
| `data/docs/.scratch.md` (dot-leading, **no** `id`) | 0 |
| `data/docs/.drafts/wip.md` (dot folder, no frontmatter) | 0 |
| `.corpus/attachments`, `.corpus/queue`, `.corpus/locks`, `.corpus/jobs`, `.corpus/cache.db` | 0 |
| the workspace's own `.claude/skills/orchestrate/SKILL.md`, `.claude/agents/` | 0 |

Every warning path starts with `data/docs/` (checked in the report:
`all under data/docs/: True`), and the verdict on that workspace is still
`ok: true`, exit 0. On the second, **healthy** workspace (`038-GiZaTk`, port
8795) with no invisible files: `projection is clean — 9 documents from 9 files
(2ms)`, `warnings=[]`, exit 0.

### TEST-607 — derived from `classifyPath`, provably

`unindexable.test.ts` mocks `./roots.js` so `classifyPath` refuses one extra
directory name (standing in for the ignored-directory declaration gaining an
entry) and asserts the pass reports `data/docs/hypothetical_vendor/doc.md`
**with no edit to the pass**. A pass carrying its own copy of the rule would
consider that path indexable and report nothing. The shape rule is derived too:
"is this the kind of file `data/docs` indexes" is asked of `classifyPath` with a
neutral stem (`data/docs/probe<ext>`), so the module contains no `.md` literal.

### TEST-608 — a healthy workspace pays nothing

Measured with a `git` shim first on `PATH` (`exec /usr/bin/git "$@"` after
logging its arguments; the log variable is **not** `GIT_`-prefixed, or
`sanitizeGitEnv` would strip it — which it did on the first attempt and produced
a silently empty log):

```
healthy workspace, one doctor run   → git children: (none)          durationMs = 1
same workspace + 1 invisible file   → git children: log --diff-filter=A -n1 --format=%h %s -- data/docs/.claude/skills/invisible-doc.md
after removing the file             → git children: (none)          durationMs = 1, 1, 1
```

Pre-fix healthy timing was `1ms`; post-fix healthy timing is `1–2ms`. Exactly
one `git log` per finding, zero on a healthy workspace.

**Bound, live:** 51 committed invisible documents → 50 `unindexable_file`
warnings + 1 `unindexable_files_truncated` ("more than 50 files … run `corpus db
doctor` again for the rest"), `ok: true`, exit 0, `durationMs = 624`. Unbounded,
that shape would have been ~50 processes per hundred files with no ceiling.

### TEST-609 — `ok`, the exit code, and the standing invariant

| workspace | `doctor` | `rebuild && doctor` |
| --- | --- | --- |
| healthy (`038-GiZaTk`) | `ok: true`, exit 0, `warnings: []` | rebuild `documents=9 skipped=[]`, doctor exit **0** |
| carrying 4 invisible documents (`038-k2bWjT`) | `ok: true`, exit **0**, 4 warnings | rebuild `documents=19 skipped=[]`, doctor exit **0** |

Human text, `--json` and exit code agree in both. Reasoning is in Technical
Design above.

### TEST-610 — report-only

`git status --porcelain` before and after two `doctor` runs on the affected
workspace: **IDENTICAL**, and empty (clean tree). `HEAD` unchanged
(`06d5d0c`). Nothing was moved, deleted, rewritten or committed; no cleanup verb
ships.

### TEST-611 — the `--json` shape, and the CLI

`corpus db doctor --json` emits exactly one JSON value carrying
`{ok, drift, warnings, stats}`; `warnings` is always present (empty on a healthy
workspace). Human output keeps its shipped shapes — the clean line `projection
is clean — N documents from M files (Xms)` and `<kind> <path>: <detail>` per
finding — and the new lines use that same second shape, with `(no file)` for a
finding that names none. The exit code is the same in both modes.
**One CLI change was needed and made:** `apps/cli/src/commands/db/doctor.ts`
dropped `warnings` on the floor in human mode (`--json` already passed them
through, since `out.emit` serialises the server's report untouched). The change
is the loop that prints them and nothing else — **no command spec string was
touched**, so `docs/cli.md` did not move:
`scripts/check-generated-artifacts.ts` regenerates it byte-identically (its only
complaint is that the tree differs from `HEAD`, which is CONTRACT-025's and
another agent's uncommitted work, not this change).

### TEST-612 — the dot-leading filename

`data/docs/.hidden.md` **with** an `id` is reported (see TEST-604, commit
`06d5d0c`); `data/docs/.scratch.md` **without** one is silent (TEST-605). Rule
and reasoning written down in Technical Design.

### TEST-613 — `db rebuild` and boot catch-up unaffected

Server restarted on the workspace carrying the invisible files: boots normally
(`running — pid 8793 on :8794, up 2s`), `db rebuild` reports `skipped: []` as
before, `doctor` exit 0. `inspectProjection` — the boot catch-up's entry point —
is **unchanged**: it returns `warnings: undefined` and runs no second walk
(pinned by `doctor.test.ts`, "leaves the boot catch-up's narrower question
exactly as it was"). `openProjectionReadonly`'s schema-stamp refusal still fires
before the new pass runs, because the pass runs after `inspectProjection`
(pinned by the pre-existing "says what to run when there is no projection at
all").

### TEST-614 — the contract question

Answered by **CONTRACT-025, already landed in this tree**: `DoctorReport` carries
an optional `warnings: DoctorWarning[]` with an open `kind` space and
`path`/`commit` required-and-nullable. No amendment was needed and none was
made — `git diff packages/contract` is empty as far as this issue is concerned
(the only working-tree difference there is CONTRACT-025's own uncommitted rider,
which this issue did not touch). Open Conflict 1 therefore did not fire.

### Tests and gates

- `VITEST_MAX_THREADS=4 vitest run apps/server` → **125 files, 2523 tests, all
  green** (one workspace-scoped run, at the end).
- `vitest run apps/cli/src/commands/db` → 2 files, 13 tests green.
- `npm run typecheck -w apps/server -w apps/cli` → clean;
  `eslint apps/server/src/projection apps/cli/src/commands/db` → no issues;
  `prettier --check` → clean.

### Housekeeping

Both servers stopped by recorded pid (8794: pid 8793; 8795: pid 8452);
`lsof -nP -iTCP:8794 -sTCP:LISTEN` and `:8795` empty.
`/Users/theophanerupin/code/corpus/.corpus` absent.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
