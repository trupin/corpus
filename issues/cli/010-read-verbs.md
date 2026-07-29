# [CLI-010] Read verbs: `corpus doc show` + `corpus thread show`

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus — two thin read verbs over existing GET endpoints, following the registry patterns.

## Dependencies

- Depends on: CLI-003
- Blocks: AGENT-003

## Spec References

- SPEC.md §7 (agent loop) — the comment skill reads thread context before replying
- CLAUDE.md — Architecture Decision 2 ("the agent interacts with the system **only through the
  CLI**")
- issues/sprints/sprint-012.md — AGENT-002 escalation 1 (2026-07-28)

## Summary

Found live during AGENT-002's E2E: the orchestrate loop's `claude` session tried `corpus thread
show` and `corpus doc show` — neither exists — and fell back to reading workspace files directly.
The shipped skill's invariant is mutation-only (reads of workspace files are not forbidden), but
Architecture Decision 2 reads stronger, and AGENT-003's comment skill needs a *stated, stable* read
path for thread context (turns, events, anchors, read-state) that file parsing cannot provide
faithfully — thread state lives in the projection, not only in the markdown.

Ship two read verbs as thin clients over the existing GET endpoints:

- `corpus doc show <id>` → `GET /api/docs/{id}` (frontmatter + body, `--json` for the raw payload)
- `corpus thread show <id>` → `GET /api/threads/{id}` rendered **as the wire returns it** (turns,
  status, anchor incl. orphan state; sprint-013 Adjudication 14 — no `events`, no read-state, and
  never the mutating unread endpoint)

Human-readable default rendering, `--json` for the agent path. Registry validation (description +
examples) as for every verb; `docs/cli.md` regenerated. AGENT-003's skill then cites these verbs;
whether direct file reads remain legal for the agent is settled in AGENT-003's text (recommended:
reads of `data/` markdown are fine for document *content*; thread/queue/lock state goes through the
CLI).

## Acceptance Criteria

- [x] `corpus doc show <id>` and `corpus thread show <id>` exist, with `--json`; errors follow the
      CLI's standard exit-code mapping (sprint-013 Adjudication 13 — server 404 maps to exit 5).
- [x] Both appear in `corpus --help`, topic help, and regenerated `docs/cli.md` with ≥1 example.
- [x] Unit tests per registry conventions; E2E against a real server in the log.

## Technical Design

Two `WorkspaceCommandSpec`s, one module each, registered in their topic's `commands` array:

- `apps/cli/src/commands/doc/show.ts` — `GET /api/docs/{id}` → `emit(payload)`, then a header
  (title; `id · type · status`; path; `created … · updated …`; `tags …`), an optional
  `due · reviewed · evergreen` line when the document carries one of them, an `anchors:` block
  listing each resolved anchor with its thread, that thread's status, its range or its orphan state
  and its quote, then the body.
- `apps/cli/src/commands/thread/show.ts` — `GET /api/threads/{id}` → `emit(payload)`, then title;
  `id · status · agent …`; `parent … · anchor … · <shape>` where the shape is
  `anchored to a selection` / `whole document` / `standalone`; timestamps; tags; then each turn as
  `author · ts` followed by its body, oldest first.

Absent values render as `—` (the contract's own prescription); nothing is re-derived, and the whole
payload is what `--json` emits. `emit`-then-`line` keeps `--json` branch-free and guarantees exactly
one JSON value.

## E2E Verification Log

**Implemented on: opus** (cli-dev, 2026-07-28), in worktree `agent-a946ccecf09f5df81` branched from
the phase HEAD `ffdfa1b`. _(Written into the worktree copy of this file: the harness blocks a
worktree-isolated agent from editing the shared checkout.)_

### Environment

- Real workspace: `/tmp/corpus-s013-cli010-uBLVKN` (`mktemp -d /tmp/corpus-s013-cli010-XXXXXX`),
  scaffolded with `corpus init --port 9097`; real server on `9097`; real `curl` with the workspace
  bearer token from `.corpus/config.json`.
- From-source CLI, never `npx`. Because a scratch cwd cannot resolve the bare specifier `tsx`, the
  loader is named by absolute path — the same from-source binary the sprint prescribes:
  `node --import <worktree>/node_modules/tsx/dist/loader.mjs <worktree>/apps/cli/src/bin/corpus.ts …`
  Comparisons that needed a shell redirect were run from the worktree root as
  `node --import tsx apps/cli/src/bin/corpus.ts --workspace /tmp/corpus-s013-cli010-uBLVKN …`.
- Fixtures created through real interfaces: `corpus doc create` for the document; `POST /api/threads`
  by `curl` for the threads (thread creation deliberately has no CLI verb); `corpus doc edit` to
  orphan an anchor; `corpus thread reply` for the extra turns.

Ids used: `doc_wohrs5py` (note), `doc_skill138ec106` (`.claude/skills/fixture-notes/SKILL.md`, no
frontmatter timestamps), `th_uwn3qix2` (anchored, 3 turns), `th_zzwdpaur` (whole-document),
`th_ayog6b2g` (standalone), `th_5uogv3pa` (anchored, deliberately orphaned).

### TEST-31 / TEST-33 / TEST-34 — `corpus doc show`

```
$ corpus doc show doc_wohrs5py
Mortgage options
doc_wohrs5py · note · open
data/docs/finance/mortgage-options.md
created 2026-07-29T03:02:35Z · updated 2026-07-29T03:03:08Z
tags —
anchors:
  anc_3260c815 → th_uwn3qix2 (open) · chars 12–33 · "30-year fixed at 6.1%"
  anc_b95b989d → th_5uogv3pa (open) · orphaned, its quote is no longer in the body · "Rates may move."

We assume a 30-year fixed at 6.1% for the base case.
```

The second anchor was orphaned for real, by editing the body through the CLI first:
`corpus doc edit doc_wohrs5py --from user -m "We assume a 30-year fixed at 6.1% for the base case."`
→ `edited doc_wohrs5py — 1 anchor remapped, 1 orphaned (th_5uogv3pa) — warning: orphaned_anchor …`.
Each anchor names its `anchorId`, `threadId`, `threadStatus`, its range when resolved, and its
orphan state when not (TEST-34).

Null timestamps (TEST-33), on a skill file whose frontmatter carries none:

```
$ corpus doc show doc_skill138ec106
fixture-notes
doc_skill138ec106 · skill · open
.claude/skills/fixture-notes/SKILL.md
created — · updated —
tags —
…
$ corpus doc show doc_skill138ec106 --json | jq -c '{created:.frontmatter.created, updated:.frontmatter.updated}'
{"created":null,"updated":null}
```

No date is invented; under `--json` both stay `null`.

### TEST-32 — `--json` is exactly one JSON value, identical to `curl`

```
$ corpus doc show doc_wohrs5py --json > cli-doc.json ; echo $?
0
$ jq -e . cli-doc.json > /dev/null ; echo $?
0
$ curl -sS :9097/api/docs/doc_wohrs5py -H "Authorization: Bearer $TOK" -o curl-doc.json
$ diff <(jq -S . cli-doc.json) <(jq -S . curl-doc.json) ; echo $?
0
$ wc -l < cli-doc.json
1
```

Identical after key-order normalisation; one line, one value.

### TEST-35 / TEST-36 / TEST-37 — `corpus thread show`, all three shapes

```
$ corpus thread show th_uwn3qix2
Is 6.1% right?
th_uwn3qix2 · open · agent engaged
parent doc_wohrs5py · anchor anc_3260c815 · anchored to a selection
created 2026-07-29T03:02:44Z · updated 2026-07-29T03:04:10Z
tags —

user · 2026-07-29T03:02:44Z
Is 6.1% still the right base case?

agent · 2026-07-29T03:04:04Z
Checked this morning: 6.1% still holds for a 30-year fixed.

user · 2026-07-29T03:04:10Z
Thanks — leaving it as the base case then.

$ corpus thread show th_zzwdpaur
Whole-document question
th_zzwdpaur · open · agent none
parent doc_wohrs5py · anchor — · whole document
…

$ corpus thread show th_ayog6b2g
Standalone note to self
th_ayog6b2g · open · agent none
parent — · anchor — · standalone
…
```

Turns render oldest first with author and timestamp; `status`, `agent`, `parent` and `anchor` are all
shown, nulls as `—`, and the three shapes are named rather than left to be inferred (TEST-37).

TEST-36:

```
$ corpus thread show th_uwn3qix2 --json > cli-thread.json ; jq -e . cli-thread.json >/dev/null ; echo $?
0
$ diff <(jq -S . cli-thread.json) <(jq -S . curl-thread.json) ; echo $?
0
$ wc -l < cli-thread.json
1
```

### TEST-47 / TEST-48 — nothing invented, and the mutating endpoint is never called

`thread show` prints only what `ThreadSchema` carries. **No read-state is reported and no second call
is made** (sprint-013 Adjudication 14): the endpoint carries no `unread`/`lastSeenTs`, and the only
read-state endpoint is `POST /api/threads/{id}/seen`, a _mutation_ — a read verb that called it would
silently clear the board's unread badge for the thread it was asked to display. Likewise no `events`
array: the schema has none. Proof from the server's own log after the whole session:
`grep -c seen /tmp/corpus-s013-cli010-uBLVKN/.corpus/server.log` → `0`. The colocated unit test
`thread/show.test.ts` pins both (`stub.requests` is exactly `["/api/threads/th_x9y8"]`, and stdout
matches neither `unread|lastSeenTs|events`).

### TEST-38 / TEST-39 / TEST-40 — exit codes read from `$?`

```
$ corpus doc show doc_zzzzzz ; echo $?
corpus: 404 not_found: no document with id doc_zzzzzz
5
$ corpus thread show th_zzzzzz ; echo $?
corpus: 404 not_found: no document with id th_zzzzzz
5
$ corpus doc show doc_zzzzzz --json ; echo $?
{"error":{"code":"not_found","message":"404 not_found: no document with id doc_zzzzzz"}}
5
$ corpus doc show not-an-id ; echo $?
corpus: 400 bad_request: request failed validation
  [ { "path": "param.id", "message": "Invalid string: must match pattern /^(doc|th)_[A-Za-z0-9]+$/" } ]
5
$ corpus server stop
stopped (pid 65891)
$ corpus doc show doc_wohrs5py ; echo $?
corpus: server not running for this workspace — run `corpus server start`
  Nothing answered at http://127.0.0.1:9097.
4
$ corpus thread show th_uwn3qix2 ; echo $?
corpus: server not running for this workspace — run `corpus server start`
  Nothing answered at http://127.0.0.1:9097.
4
```

404 → **5** (sprint-013 Adjudication 13; the issue's original "404 → exit 4" was stale and is
corrected above), 400 → 5, transport failure → 4 with the actionable message.

### TEST-41 — all three help levels

`corpus --help` lists `doc  Read, create, edit, move, archive and delete documents.` and
`thread  Read conversations, reply to them, and open or close them.`; `corpus doc --help` and
`corpus thread --help` list `show` first among their verbs; `corpus doc show --help` and
`corpus thread show --help` render summary, description, `Usage: corpus <topic> show <id> [flags]`,
the `<id>` argument table, the global flags and both examples — all from the registry, no
hand-written help text.

### TEST-42 / TEST-43 — generated reference and examples

`npm run docs:cli -w apps/cli` adds ``### `corpus doc show` `` (line 441) and
``### `corpus thread show` `` (line 1214) with the generated shape, both listed in the `## Contents`
TOC; running the generator twice is byte-identical (`diff` of the before/after copy → exit 0), and
`npx prettier --check docs/cli.md` passes. Each verb carries two examples — a plain one and a
`--json` one whose description inlines the literal JSON skeleton — and `validateRegistry` (which runs
at module load) passes.

One prose-level gotcha worth recording: Prettier normalises markdown emphasis in the generated file
(`*current*` → `_current_`), which makes `docs/generate.test.ts`'s drift assertion fail on the next
run. The description now writes `_current_` directly, with a comment saying why.

`npx tsx scripts/check-generated-artifacts.ts` reports, verbatim:

```
✓ API contract is up to date (packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts).
✗ CLI reference is stale: docs/cli.md
  Fix: npm run docs:cli -w apps/cli && git add docs/cli.md
 docs/cli.md | 70 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++----
 1 file changed, 66 insertions(+), 4 deletions(-)
```

This is the expected `git diff --stat HEAD` half of the check firing on an **uncommitted** artifact —
an agent cannot turn it green inside its own worktree. The regenerate-and-compare half is green (see
above). Authoritative regeneration is the orchestrator's at harvest (pre-ruled Adjudication 4).

### TEST-44 / TEST-45 / TEST-46 — thin clients, one emit, no write path

Each verb is one `context.client.request((api) => api.GET("/api/docs/{id}"|"/api/threads/{id}", …))`
through the generated typed client, then `out.emit(payload)` followed by `out.line(…)` renders — no
`fetch(`, no literal URL, no `if (json)` branch. `apps/cli/src/commands/hygiene.test.ts` passes with
its rules unamended; only its two **pinned module inventories** gained `doc/show.ts` and
`thread/show.ts`, which is the designed failing-diff mechanism ("nothing is out of scope by being
new"), not a relaxation. Both specs are `WorkspaceCommandSpec` with no flags of their own (`--from`
is global; declaring it would fail `validateRegistry`). No server, contract, mutation-verb or UI file
was touched.

### TEST-49 / TEST-50 — tests and cleanup

- `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/cli/src/docs apps/cli/src/commands/doc apps/cli/src/commands/thread apps/cli/src/commands/hygiene.test.ts apps/cli/src/help.test.ts`
  → **12 files, 122 tests, all green**, including 11 new `doc/show.test.ts` and 10 new
  `thread/show.test.ts` cases.
- Workspace-scoped `VITEST_MAX_THREADS=4 npm test -w apps/cli` → 575 tests, green after the emphasis
  fix (the single failure it first surfaced was the `docs/cli.md` drift assertion described above).
- `npm run lint`, `npm run typecheck`, `npm run format:check` all clean.
- Server stopped with `corpus server stop` (pid 65891); `lsof -nP -iTCP:9097 -sTCP:LISTEN` and
  `lsof -nP -iTCP:8765 -sTCP:LISTEN` both report nothing bound. Only the one scratch directory this
  issue created was written to; no `/tmp/corpus-*` glob delete was run.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
