# [CLI-006] `corpus doc check` + `corpus skill rollback` verbs

## Domain

cli

## Status

done

## Priority

P1

## Model

opus — thin mappings onto CONTRACT-008 routes; the `--staged` collection is read-only git plumbing.

## Dependencies

- Depends on: CLI-003, SERVER-019
- Blocks: AGENT-003

## Spec References

- SPEC.md §11 — `doc check --staged`, exit-6 gating; §7 — skill rollback
- `issues/cli/003-doc-thread-verbs.md` — the deferred ACs and technical design (staged collection via `git diff --cached --name-only --diff-filter=ACMR -z` + `git show :<path>`, posted as `(path, content)` pairs)

## Summary

The two verbs deferred out of CLI-003 (2026-07-27 adjudication), implementable once CONTRACT-008/SERVER-019 land. `corpus doc check [<id>…] [--staged]` validates via the server (warnings don't fail; errors exit 6; `--json` structured findings; no staged document paths → exit 0, silent). `corpus skill rollback <name> [--to <ref>]` calls the targeted-revert endpoint and prints the restored commit and path (unknown skill → "no skill named <name>", exit 5). The workspace-side pre-commit hook that gates on exit 6 belongs to the agent-runtime domain (workspace template), not this issue, and nothing here touches this repo's `.githooks/`.

## Acceptance Criteria

- [x] The two deferred CLI-003 ACs, as originally written (minus the `.githooks/` line).
- [x] Registry + `docs/cli.md` regenerated; read-only-filesystem constraint holds.
- [x] Vitest for parsing, `--staged` collection, exit-code mapping; E2E through the real binary.

## Technical Design

To be refined when scheduled (Phase 4, before AGENT-003).

## E2E Verification Log

**implemented on: opus** (cli-dev, worktree `.claude/worktrees/agent-ad4bc7c8525066e48`, 2026-07-28).

### Reproduction (bugs only)

_N/A — feature issue._

### Post-Implementation Verification

Real workspace `/tmp/corpus-s013-cli006-JBhmHx`, real server on `9107`, from-source CLI
(`node --import <repo>/node_modules/tsx/dist/loader.mjs <worktree>/apps/cli/src/bin/corpus.ts`,
never `npx` — wrapped as `/tmp/cli006-corpus.sh` because the scratch workspace has no
`node_modules` for a bare `--import tsx` to resolve). Exit codes read from `$?`.

**Setup.**

```
$ corpus init --port 9107
Initialized Corpus workspace at /private/tmp/corpus-s013-cli006-JBhmHx
  installed 8 template files, recorded in .corpus/template-manifest.json
$ corpus server start
corpus 0.0.0 listening on http://127.0.0.1:9107 (pid 46927)
```

Drifted corpus built out-of-band (`data/docs/notes/drifted.md` carrying an `anc_ghost` anchor
entry whose quote is not in the body, plus a `[[doc_missing99]]` ref) and through the CLI
(`data/docs/notes/plan.md` with an unresolved ref).

**TEST-86 / TEST-87 / TEST-88 — the verdict is the exit code.**

```
$ corpus doc check doc_seedtemplatenote ; echo $?
checked 1 document — no findings.
0
$ corpus doc check doc_drift01 ; echo $?
error anchor-unused data/docs/notes/drifted.md: anchor `anc_ghost` has no thread referencing it
warning anchor-unresolved data/docs/notes/drifted.md: anchor `anc_ghost` no longer resolves in the body; its thread is orphaned
warning ref-unresolved data/docs/notes/drifted.md: reference `[[doc_missing99]]` does not resolve to a document in the corpus
corpus: 1 error in 1 document, plus 2 warnings.
  Fix the findings above; warnings alone would not have failed the check.
6
$ corpus doc check doc_d2v2rmnc ; echo $?          # warnings only
warning ref-unresolved data/docs/notes/plan.md: reference `[[doc_missing99]]` does not resolve to a document in the corpus
checked 1 document — 1 warning, no errors.
0
```

**TEST-89 / TEST-161 — `--json` is the server's body, and the exit code is unchanged.**

```
$ corpus doc check doc_drift01 --json | jq -e . >/dev/null ; echo $?   # 0 → exactly one JSON value
$ corpus doc check doc_drift01 --json > cli.json ; echo $?
6
$ curl -sS -X POST :9107/api/check -H 'content-type: application/json' -d '{"ids":["doc_drift01"]}' > curl.json
$ jq -S . cli.json > a; jq -S . curl.json > b; cmp a b && echo identical
identical
```

(Raw bytes differ only by the CLI's trailing newline: 582 vs 581.)

**TEST-90 / TEST-91 / TEST-92 — whole workspace, archived included, skills included.**

```
$ corpus doc check ; echo $?
error anchor-unused data/docs/notes/drifted.md: …
warning ref-unresolved data/docs/notes/plan.md: …
warning anchor-unresolved data/docs/notes/drifted.md: …
warning ref-unresolved data/docs/notes/drifted.md: …
corpus: 1 error in 10 documents, plus 3 warnings.
6
```

The ten enumerated ids include `doc_skillorchestrate`, `doc_skillcomment`,
`doc_skill138ec106` (the plugin skill) and `th_2xm4i3j6` — skills and threads are in scope.
Archived coverage proved by counting both ways after `corpus doc archive doc_d2v2rmnc`:
`GET /api/docs?limit=200` → `total: 9`, `…&includeArchived=true` → `total: 10`, and
`corpus doc check` still reports `data/docs/notes/plan.md`'s warning. Pagination is unit-tested
against a `MAX_PAGE_LIMIT + 3` corpus (two `GET /api/docs`, **one** `POST /api/check`).

**TEST-93 / TEST-94 / TEST-95 / TEST-96 — `--staged` reads the index and changes nothing.**

Five-file matrix staged in the scratch repo (explicit `-C`, never the Corpus repo):

```
$ git -C "$WS" status --porcelain
M  .gitignore                        # staged non-document
A  data/docs/notes/drifted.md        # staged addition
MM data/docs/templates/note.md       # staged modification, worktree differs
 M data/docs/views/attention.md      # unstaged modification
D  data/docs/views/inbox.md          # staged deletion
$ corpus doc check --staged --json ; echo $?
{"ok":false,"errors":[{"code":"anchor-malformed","path":"data/docs/templates/note.md"},
                      {"code":"frontmatter-invalid","path":"data/docs/templates/note.md"},
                      {"code":"anchor-unused","path":"data/docs/notes/drifted.md"}], …}
6
```

Exactly the two staged **document** paths are submitted; the staged `.gitignore`, the unstaged
change and the staged deletion are absent. **The content is the index's, not the worktree's**:
`data/docs/templates/note.md` holds `anchors: {}` on disk and an `anc_staged_only` entry in the
index — `corpus doc check doc_seedtemplatenote` (by id, i.e. from disk) reports
`checked 1 document — no findings.` while the same file staged reports `anchor-malformed`. The
request body is the `{documents: [{path, content}]}` branch (unit-asserted; no id form could
express content that is not on disk).

```
$ git -C "$WS" status --porcelain > before ; corpus doc check --staged ; git -C "$WS" status --porcelain > after
$ cmp before after && echo "byte-identical"
byte-identical
```

Clean index:

```
$ corpus doc check --staged ; echo $?
0
```

— no output at all on stdout.

**TEST-97 — a staged blob past `execFile`'s 1 MB default.** A 2.0 MB `data/docs/notes/large.md`
staged: `corpus doc check --staged --json` reported findings for three documents including
`data/docs/notes/large.md`. `src/staged.ts` sets `maxBuffer` (64 MB) and `timeout` (30 s)
explicitly; `runGit` in `commands/init/git.ts` sets neither and is untouched.

**TEST-98 — `--staged` with ids is refused, not silently merged.**

```
$ corpus doc check doc_drift01 --staged ; echo $?
corpus: `--staged` checks the content in git's index, so it cannot be combined with document ids.
  Run `corpus doc check --staged` on its own, or name ids without `--staged`.
2
```

Stated in the verb's `description` and therefore in `docs/cli.md`. Unit-asserted that no request
is sent.

**TEST-99 / TEST-100 / TEST-102 / TEST-103 — `corpus skill rollback`.**

```
$ corpus doc edit doc_skillorchestrate -m "VERSION TWO …" ; corpus doc edit doc_skillorchestrate -m "VERSION THREE …"
$ corpus skill rollback orchestrate --from agent ; echo $?
restored .claude/skills/orchestrate/SKILL.md in commit 673ed3f31370860168ff9790fb423c2c08d30d3f (doc_skillorchestrate)
0
$ git -C "$WS" log -1 --format='%H %an <%ae> %s'
673ed3f31370860168ff9790fb423c2c08d30d3f agent <agent@corpus.local> skill rollback: orchestrate (doc_skillorchestrate…
$ git -C "$WS" rev-parse HEAD
673ed3f31370860168ff9790fb423c2c08d30d3f
```

The file holds the pre-edit template bytes again. `--to` and `--json`:

```
$ corpus skill rollback orchestrate --to 5346b1c --json ; echo $?
{"name":"orchestrate","docId":"doc_skillorchestrate","commit":"a58db949…","path":".claude/skills/orchestrate/SKILL.md","warnings":[]}
0
$ tail -1 .claude/skills/orchestrate/SKILL.md
VERSION THREE of the orchestrate skill.
$ git -C "$WS" log -1 --format='%an'
user                                   # no --from → `user`, per the global default
```

`--from agent` → author `agent`; no flag → author `user`. The verb declares no `--from` of its
own (that would fail `validateRegistry`).

**TEST-101 — unknown skill.**

```
$ corpus skill rollback nope ; echo $?
corpus: 404 not_found: no skill named `nope` is installed (.claude/skills/nope/SKILL.md does not exist)
5
```

The message is the server's, rendered by the standard error surface — the handler catches nothing.

**TEST-104 / TEST-105 — registry, help, docs.** `check` is in `docTopic.commands`; a new `skill`
topic carries `rollback`; `validateRegistry` passes at module load. `corpus --help` lists the
`skill` topic, `corpus skill --help` lists `rollback`, and `corpus doc check --help` renders
`Usage: corpus doc check [id…]` with the argument and flag tables — all from the registry.
`npm run docs:cli -w apps/cli` emits ``### `corpus doc check` `` and
``### `corpus skill rollback` `` with TOC entries; the generator's output is Prettier-clean as
emitted and running it twice is byte-identical (`sha256 97975b5f…` before and after).

**TEST-106 / TEST-107 / TEST-108 — the self-invalidating allowlist expired.**
`CLI_COMMANDS_PENDING_CLI_006` is now `[]` in `scripts/workspace-template.ts`, and its companion
assertion in `scripts/workspace-template.test.ts` reads `toEqual([])`. A new assertion proves the
two verbs now resolve **against `docs/cli.md` itself**. The template-tree test
("resolves every `corpus …` invocation …") is green with no allowlist. No skill text was touched;
these are the only two edits to those AGENT-002-owned files (sprint-013 Adjudication 17).

**TEST-109 — the drift check is honest.** `scripts/check-generated-artifacts.ts` compares against
HEAD, so in the worktree before the orchestrator commits it is red, verbatim:

```
✓ API contract is up to date (packages/contract/openapi.json, …schema.generated.ts).
✗ CLI reference is stale: docs/cli.md
  Fix: npm run docs:cli -w apps/cli && git add docs/cli.md
 docs/cli.md | 109 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++--
 1 file changed, 107 insertions(+), 2 deletions(-)
```

That is the expected state (CONTRACT-008's precedent). The regenerate-and-compare half is green
against a pre-run snapshot: `sha256(docs/cli.md)` is `97975b5f8e95…f896b63` both before and after
re-running the generator.

**TEST-110 / TEST-111 / TEST-112 — the hygiene guard, relaxed narrowly and shown firing.**
Resolution is sprint-013 Adjudication 12: `apps/cli/src/staged.ts` (beside `git-env.ts`, outside
the guarded prefixes) holds the only read-only git plumbing; `commands/doc/check.ts` imports it
and is the **only** guarded module allowed to, pinned by a new named assertion
(`STAGED_HELPER_IMPORTERS = ["doc/check.ts"]`). The guard's docblock now states the exception and
its reason rather than being quietly weakened; every other prohibition is unchanged. `staged.ts`
refuses any subcommand outside `["diff","show","status","rev-parse"]` before spawning, asserted
in `staged.test.ts` against a real repository (a `commit`/`add`/`checkout`/`reset`/`push` request
throws `InternalError`).

Guard proven load-bearing with a **real** probe file
(`apps/cli/src/commands/doc/probe.ts` calling `spawnSync("git", ["commit", …])`):

```
× finds the modules it is supposed to be guarding      → expected [ Array(16) ] to deeply equal [ Array(15) ]
× imports no filesystem or subprocess module           → doc/probe.ts imports node:child_process
× calls no write API and spawns no process             → expected [ 'doc/probe.ts calls spawnSync' ] to deeply equal []
× scans every command module, not a chosen few         → expected [ Array(43) ] to deeply equal [ Array(42) ]
Tests  4 failed | 8 passed (12)
```

Probe deleted; re-run: `Tests 12 passed (12)`. Both new verbs call the server only through
`context.client.request((api) => api.POST(...))` on the generated typed client — no `fetch(`, no
literal URL (enforced by the unchanged guard).

**TEST-113 — unit tests.** `VITEST_MAX_THREADS=4 vitest run apps/cli scripts/` →
**67 files, 837 tests, all passing**. New: `apps/cli/src/staged.test.ts` (14),
`apps/cli/src/commands/doc/check.test.ts` (17), `apps/cli/src/commands/skill/rollback.test.ts`
(12), plus variadic-argument cases in `parse-args.test.ts` and `registry/validate.test.ts`.
`npm run lint`, `npm run format:check` and `npm run typecheck` (all workspaces) are green.

**TEST-115 — read-only filesystem.** `sha256` of every file under `data/` and `.claude/`
captured before, then all three check forms run, then re-captured: **byte-identical**. Only
`skill rollback` writes, and it writes through the server. Nothing in this issue touches this
repository's `.githooks/`.

**Cleanup.** `corpus server stop` → `stopped (pid 46927)`;
`lsof -nP -iTCP:9107 -sTCP:LISTEN` empty; `8765` was unbound before and after. The scratch
directory is `/tmp/corpus-s013-cli006-JBhmHx`, created by `mktemp -d` and deleted by captured
path only.

### Deviations and notes

- **`[<id>…]` needed a variadic positional, which the registry had no way to express.** The
  parser bound positionals one-to-one and rejected extras, so `corpus doc check a b` was a usage
  error. `ArgSpec` is widened **locally in `apps/cli`** with an optional `variadic?: true` (the
  published `PluginArgSpec` in `@corpus/contract/plugin` is untouched — a plugin declares fixed
  positionals, and amending the contract is forbidden to this issue by Adjudication 3), the
  parser binds the tail, `ParsedArgs.list()` reads it, `validateRegistry` requires a variadic to
  be last, and `argUsage()` renders `<id>`/`[id]`/`[id…]` in one place for help, the synopsis and
  `docs/cli.md`.
- **`{ids}` cannot report `duplicate-id`** (SERVER-019: one projection row per id, and the
  handler de-duplicates). Stated in the verb's `description`, so it is in `docs/cli.md`, with
  `corpus db doctor` named as the surface that does report it.
- **`--staged` filters to the document roots**, per CLI-003's original design text ("filtered to
  the workspace's document roots"). The five-root shape table in `staged.ts` is a documented
  transcription of `apps/server/src/projection/roots.ts` — the CLI may not import the server —
  in the same spirit as the contract's transcription of the validator's codes.
- **Nested skills** (`SKILL.md` more than one directory deep) are indexed but not addressable by
  `corpus skill rollback`: `SkillNameSchema` forbids `/`. Named as a limitation in the topic's
  docblock; not worked around.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[CLI-006]` prefix
