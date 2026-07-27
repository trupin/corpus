# [CLI-003] Doc, thread, skill and db verbs

## Domain
cli

## Status
in-review

## Priority
P0

## Model
opus — thin mappings onto endpoints already pinned by the contract and the spec; the judgment (write semantics, locks, attribution) lives server-side.

## Dependencies
- Depends on: CLI-001, SERVER-005, SERVER-006
- Blocks: AGENT-003

## Spec References
- SPEC.md §7 (agent stewardship — `doc create|edit|move|archive`, deletion is user-only; skills as documents, `corpus skill rollback` loop safety)
- SPEC.md §9.2 (HTTP API — the endpoints these verbs call)
- SPEC.md §14 (validation and git hooks — `doc check --staged`, `db doctor` in pre-commit)
- CLAUDE.md — Architecture Decision 2 (server is the sole writer; CLI is a thin HTTP client)

## Summary
Ship the document-lifecycle surface the product agent actually uses to steward the corpus: `corpus doc create|edit|move|archive|delete`, `corpus thread reply|resolve|reopen`, and `corpus db rebuild|doctor`.

> **Scope adjudication (orchestrator, 2026-07-27, sprint-007 planning):** `corpus doc check` and `corpus skill rollback` are **deferred out of this issue** — the server exposes no validation or targeted-revert endpoint, so they are contract-first work: CONTRACT-008 → SERVER-019 → CLI-006 (Phase 4, before AGENT-003). The `.githooks/pre-commit` edit is **struck entirely**: this repo's hooks run in the Corpus *tool* repo, which is not a workspace — the workspace-side hook belongs to the agent-runtime domain once `doc check` exists. Do not touch `.githooks/`. Every verb is a thin, typed call onto a server endpoint — the CLI parses arguments, reads a body from stdin or `--file`, calls the server, and renders the response. It never touches a document file, never writes YAML, never runs `git commit`; locking, anchor reconciliation, validation, and auto-commit with author attribution all happen server-side. `--from user|agent` is threaded through every mutating verb so `git log` remains the audit trail of who changed what.

## Acceptance Criteria
- [x] `corpus doc create --type <t> --title <s> [--folder <p>] [--tags a,b] [--due <iso>] [--from user|agent] [--file <p>]` — body from `--file` or stdin (heredoc); omitting both is legal (the server pre-fills from the type's template document). Prints the new document id; `--json` prints the created document object.
- [x] `corpus doc edit <id> [--file <p>|stdin] [--title <s>] [--add-tag <t>…] [--remove-tag <t>…] [--status <s>] [--due <iso>] [--reviewed] [--evergreen true|false] [--from …]` — body replacement is optional (frontmatter-only edits are valid); the server acquires and releases the document lock implicitly. Output reports remapped and newly orphaned anchors when the response includes them.
- [x] `corpus doc move <id> --folder <path>` and `corpus doc archive <id>` map to their endpoints and report the new path / status.
- [x] `corpus doc delete <id>` is **user-only**: `--from agent` (or `CORPUS_FROM=agent`) is refused client-side with an explanatory error ("deletion is user-only — the agent archives, never deletes"), exit code 2, and no request is sent. Interactive use requires `--yes` unless stdin is a TTY and the confirm prompt is answered.
- [x] `corpus thread reply <id> --from user|agent` reads the turn body from stdin (heredoc), `--file`, or `--message/-m`; empty body is a usage error. Prints the created turn's timestamp.
- [x] `corpus thread resolve <id>` and `corpus thread reopen <id>` flip thread status through the server and are idempotent (already-resolved → says so, exit 0).
- [x] `corpus db rebuild` triggers a full projection rebuild and prints a summary (documents/threads/turns projected, duration). `corpus db doctor` prints the drift report and exits **6** on drift, 0 when clean — the exit code the pre-commit hook gates on.
- [x] Every mutating verb accepts `--from user|agent` (default `user`, overridable by `CORPUS_FROM`), sends it to the server, and the resulting git commit carries that author — verified E2E via `git log`.
- [x] Every command above is registered in the CLI-001 registry with a summary, flag descriptions, and at least one realistic example, and appears in the regenerated `docs/cli.md`.
- [x] No handler in this issue calls `fs.writeFile`, `fs.rename`, `fs.unlink`, or spawns a state-changing git command; a lint rule or unit assertion enforces the read-only-filesystem constraint.
- [x] Vitest coverage for argument parsing, body-source resolution, the delete guard, and exit-code mapping.

## Technical Design

### Files to Create/Modify
- `apps/cli/src/commands/doc/{create,edit,move,archive,delete}.ts`
- `apps/cli/src/commands/thread/{reply,resolve,reopen}.ts`
- `apps/cli/src/commands/db/{rebuild,doctor}.ts`
- `apps/cli/src/input.ts` — shared body resolution (stdin / `--file` / `-m`) and `--from` resolution
- `apps/cli/src/registry/index.ts` — register the `doc`, `thread`, `db` topics
- `docs/cli.md` — regenerated
- colocated `*.test.ts`

### Key Implementation Details
**Body resolution** (one helper, used by `doc create`, `doc edit`, `thread reply`): precedence `--message` > `--file` > stdin-when-not-a-TTY > none. Reading stdin means reading it fully before the request (heredocs are the agent's normal invocation form). Reading `--file` is a *read*, which is permitted; the CLI still never writes.

**`--from` attribution.** Resolve once in the dispatcher (`--from` flag ?? `CORPUS_FROM` ?? `"user"`), validate against the union, and pass it in the request body/header exactly as the contract defines. The server maps it to the git author. Commands that are inherently user-only (`doc delete`) reject `agent` before any network call.

**Anchor reporting.** `doc edit` responses carry the reconciliation result (§6). Human output prints e.g. `edited doc_a1b2c3 — 3 anchors remapped, 1 orphaned (th_x9y8)`; `--json` passes the response through untouched so the agent can act on it.

**Idempotence and no-op reporting.** `thread resolve` on an already-resolved thread, `doc archive` on an archived doc: report "already …" and exit 0. The agent's loop must never have to branch on these.

**Quiet by default.** Success output is a single line naming the affected id and the effect. All structured data goes behind `--json`. Errors follow the CLI-001 surface (exit 4 unreachable, 5 server error, 6 check failed).

### Edge Cases
- Editing a document the **user** currently holds the lock on → the server returns a lock conflict; the CLI renders it as "document is locked by user — the edit was not applied" with a distinct, documented exit code path (server error, exit 5) so the orchestrate skill can defer rather than retry blindly.
- `doc create` with a `--folder` that does not exist → the server decides (create-on-demand or reject); the CLI surfaces the typed problem verbatim rather than pre-validating.
- `thread reply` with a body containing a `~~~form` / fenced block → passed through byte-for-byte; no markdown post-processing in the CLI.
- Very large bodies (multi-MB pasted content) → stream/limit sensibly; do not build the request body twice.
- `db rebuild` on a large corpus may exceed the default HTTP timeout → use a longer, explicit timeout for this verb and print progress-free but non-hanging output.
- CRLF/no-trailing-newline stdin bodies → normalized only if the server contract says so; otherwise pass through unchanged and let the server normalize (one implementation).

## Testing Strategy
Vitest in `apps/cli`, colocated, with a **real** `node:http` stub server mounted on an ephemeral port asserting the request shape (method, path, body, `--from` attribution) and returning contract-shaped responses:
- `input.test.ts` — body-source precedence, TTY vs. piped stdin, empty-body rejection.
- `doc/delete.test.ts` — `--from agent` is refused with exit 2 and **no** HTTP request is made (assert the stub received nothing).
- `doc/check.test.ts` — warnings → exit 0, errors → exit 6, `--json` shape; `--staged` with a temp git repo containing staged/unstaged/deleted files, asserting only staged document blobs are posted and no git state changed (`git status --porcelain` identical before/after).
- `doc/edit.test.ts` — frontmatter-only edit sends no body; anchor-report rendering for remapped/orphaned.
- `thread/*.test.ts` — reply body from heredoc-style piped stdin; resolve/reopen idempotence output.
- `db/doctor.test.ts` — drift response → exit 6, clean → exit 0.
- A guard test asserting no command module under `commands/{doc,thread,skill,db}` imports `node:fs` write APIs or invokes state-changing git.

## E2E Verification Plan

### Verification Steps
1. Real workspace, real server: `corpus init` in a temp directory, `corpus server start`, confirm health. Use the installed binary for every command below.
2. `corpus doc create --type note --title "Mortgage options" --folder finance --tags finance,housing --from user <<'EOF' … EOF` → prints an id; confirm the file exists on disk under `data/docs/finance/` with valid frontmatter, and `git log -1 --format='%an %s'` shows the `user` author and a structured message.
3. `corpus doc edit <id> --from agent <<'EOF' … EOF` → file body changed on disk; `git log -1` author is `agent`. Repeat with `--title` only (no body) → frontmatter updated, body untouched.
4. Anchored-thread flow: create a thread on that document through the server (or the UI/`POST /api/threads`), then `corpus doc edit` the anchored text → the CLI reports the remapped/orphaned anchor; verify against `GET /api/docs/:id`.
5. `corpus thread reply <th_id> --from agent <<'EOF' … EOF` → new turn appended to the thread file with a unique timestamp heading; `corpus thread resolve <th_id>` → `status: resolved` on disk; running it again → "already resolved", exit 0.
6. `corpus doc archive <id>` then `corpus doc move <id> --folder archive-notes` → status/path reflected on disk and in `GET /api/docs`.
7. `corpus doc delete <id> --from agent` → refused, exit 2, file still present. `corpus doc delete <id> --from user --yes` → file removed, git history retains it (`git log --diff-filter=D`).
8. Validation: hand-corrupt a staged document (malformed anchor entry), `git add` it, run `corpus doc check --staged` → non-zero exit 6 with the specific finding; `git commit` is blocked by pre-commit; fix and re-run → exit 0 and the commit succeeds.
9. `corpus db rebuild` then `corpus db doctor` → clean, exit 0. Delete a document file out of band, `corpus db doctor` → drift reported, exit 6; `corpus db rebuild` → clean again.
10. `corpus skill rollback comment` after editing `.claude/skills/comment/SKILL.md` through `corpus doc edit` → the file's previous content is restored and a revert commit appears in `git log`.
11. Re-run representative commands with `--json`, pipe through `jq .` → all parse.

## E2E Verification Log

**Implemented on: opus** (cli-dev, worktree `.claude/worktrees/cli-003`, 2026-07-27).

### Adjudications applied (sprint-007)

- **Open Conflict 1 / 3 — `doc check`, `skill rollback`: `STRUCK`.** No validation or
  targeted-revert route exists in `packages/contract`. ACs 5 and 8 and TEST-107…112 are not
  implemented here; they move to CONTRACT-008 → SERVER-019 → CLI-006. Nothing in this change
  validates locally: §14's one-validator rule is respected.
- **Open Conflict 2 — `.githooks/pre-commit`: `STRUCK`.** Untouched, per the orchestrator's
  instruction. The tool repository is not a workspace.
- **Open Conflict 4 — the default actor is `user`.** Resolved once in the dispatcher
  (`run.ts`: `--from` ?? `CORPUS_FROM` ?? `user`), validated against the union, and handed to
  the client so **every** verb inherits it. `--from` is a **global** flag for that reason;
  registry validation now forbids any verb from redeclaring it. `apps/cli/src/client.ts` no
  longer hardcodes `actor: "agent"`. **Behaviour change to CLI-004 verbs**: `corpus lock
  acquire` with no `--from` now takes the lock as `user` (was `agent`) — re-verified below.
- **Open Conflict 8 — `--folder does/not/exist`: recorded, not pre-validated.** The server
  **creates the folder on demand** (evidence below). First written statement of it.
- **Open Conflict 9 — non-TTY without `--yes` is exit 2**, immediately, and piped stdin is
  never read as a confirmation.
- **Open Conflict 10 — `db doctor`**: clean-after-external-edit is correct (evidence below).
  The optional `sqlite3`-surgery drift case was *also* run on a real server and gave exit 6.
- **Open Conflict 11 — `db rebuild` registers no `--timeout`** and calls through
  `client.untimedApi` with a ten-minute deadline of its own.

### Reproduction (bugs only)
_N/A — feature issue. One defect **found and fixed during E2E** is logged under “The stdin
hang” below; it was reproduced against the real binary before the fix._

### Post-Implementation Verification

Real workspace, real server, real git. Built bin (`node apps/cli/dist/bin/corpus.js`) unless
noted. Port **8945** (the orchestrator's assignment for this agent, overriding the sprint's
8985), scratch `/tmp/corpus-c003-K8nwzI`, server pid 16495 then 97615, both stopped by pid;
`lsof -nP -iTCP:8945` and `:8765` empty afterwards; scratch removed.

```
$ corpus init --port 8945
Initialized Corpus workspace at /private/tmp/corpus-c003-K8nwzI
  git: initialized on main, one commit authored as user
  installed 8 template files, recorded in .corpus/template-manifest.json
$ corpus server start
corpus 0.0.0 listening on http://127.0.0.1:8945 (pid 16495)
$ corpus health
ok — corpus 0.0.0, up 1s, workspace /private/tmp/corpus-c003-K8nwzI
```

**The stdin hang (defect found by this E2E, fixed, and now pinned by a test).** The first
attempt at `corpus doc create --type note --title "…"` with no body source **hung forever**
and was killed at 5 minutes. Cause: `!process.stdin.isTTY` was being read as "a body is being
piped", but an agent harness — Claude Code's own Bash tool included — hands its child a
**socket** on fd 0 that is never written to and never closed. `fstat` of that fd:
`isFIFO false, isFile false, isCharacterDevice false, isTTY false`. A heredoc is
`isFile true`; a shell pipe is `isFIFO true`. `stdinCarriesABody()` (`src/input.ts`) now
`fstat`s fd 0 and reads it **only** for a regular file or a FIFO, so the heredoc and pipe
forms work and nothing else can park the agent. After the fix the same command exits 0 with
the template pre-fill, as shown below.

**`doc create` — attribution, body sources, flags.**

```
$ corpus doc create --type note --title "Default actor probe"        # no --from, no CORPUS_FROM
created doc_xl3ydwth — data/docs/inbox/default-actor-probe.md
$ git log -1 --format='%an <%ae> %s'
user <user@corpus.local> doc create: Default actor probe (doc_xl3ydwth) by user
# file body = the `note` template's pre-fill: "## Context / ## Notes / ## Open questions"

$ corpus doc create --type note --title "Mortgage options" --folder finance \
    --tags finance,housing --due 2026-09-01 --from user <<'EOF'
We should assume a 30-year fixed at 6.1% for now.

```form
rate: 6.1
```
EOF
created doc_yejhzfh7 — data/docs/finance/mortgage-options.md
$ git log -1 --format='%an <%ae> %s'
user <user@corpus.local> doc create: Mortgage options (doc_yejhzfh7) by user
```

On disk: `tags: [finance, housing]`, `due: 2026-09-01`, and the body byte-for-byte including
the fenced `form` block and the heredoc's trailing newline. **Trailing-newline handling: pass
through, unchanged** — a `-m` body with no trailing newline is stored with none; the server
normalizes nothing. `--file` was verified with a 5.4 MB body (below).

**`--from` precedence, verified by git author on a real server.**

| invocation | `git log -1 --format='%an <%ae>'` |
| --- | --- |
| `corpus doc edit <D> --from agent` | `agent <agent@corpus.local>` |
| `CORPUS_FROM=agent corpus doc edit <D> --title …` | `agent <agent@corpus.local>` |
| `CORPUS_FROM=agent corpus doc edit <D> --from user -m …` | `user <user@corpus.local>` |
| `corpus doc create …` (neither) | `user <user@corpus.local>` |
| `corpus doc create … --from robot` | exit **2**, `--from must be one of: user, agent` |
| `CORPUS_FROM=robot corpus doc create …` | exit **2**, `CORPUS_FROM must be one of: …` |

"Zero requests sent" for the invalid actor is asserted against a recording `node:http` stub in
`run.test.ts` (the dispatcher path) — the E2E only shows the exit code, since a real server
cannot prove a request's absence.

**Frontmatter-only edit leaves the body alone** (proved with a *different* actor so
`SQUASH_IDLE_MS` could not fold the two commits):

```
$ corpus doc edit doc_yejhzfh7 --from agent --title "Mortgage options (agent retitle)"
edited doc_yejhzfh7
$ git show HEAD -- data/docs/finance/mortgage-options.md
-title: Mortgage options (2026)
+title: Mortgage options (agent retitle)
-updated: 2026-07-27T15:57:47Z
+updated: 2026-07-27T15:58:20Z
   (no body lines in the diff)
```

`--add-tag rates --remove-tag housing --reviewed` produced `tags: [finance, rates]` and
`reviewed: 2026-07-27T15:57:47Z` — an **instant**, not `true` (SPEC §5).

**Anchor reconciliation** (two threads created over HTTP on the document, then the body
rewritten so one anchor moves and the other's text is gone):

```
$ corpus doc edit doc_yejhzfh7 --from agent <<'EOF'
Assume a 30-year fixed at 6.1%.
EOF
edited doc_yejhzfh7 — 1 anchor remapped, 1 orphaned (th_2fli6jce) — warning: orphaned_anchor (anchor `anc_8268dab5` no longer resolves in the body; its thread is orphaned)
```

`--json` on the same edit emitted `"anchors":{"remapped":["anc_5243714a"],"orphaned":["anc_8268dab5"]}`
untouched, and `GET /api/docs/<id>` agreed (`anc_8268dab5`: `range: null, orphaned: true`).
The human line names the **thread** id, mapped from the response's own anchor table.

**Lock conflict — rendered, not retried.**

```
$ corpus lock acquire doc_xl3ydwth --from user
$ corpus doc edit doc_xl3ydwth --from agent -m "the agent tries to write"
corpus: 423 locked: doc_xl3ydwth is being edited by user; the lock was acquired at 2026-07-27T16:03:02Z
  The write was not applied. The other party holds this document's edit lock — defer and come back to it, rather than retrying in a loop.
  { "docId": "doc_xl3ydwth", "holder": "user", … }
exit=5      # file md5 identical before and after
```

The message is the server's typed problem verbatim (never a `JSON.stringify` of the body); the
"was not applied / do not retry" sentence is a CLI-owned **hint** added for `423`. The unit
test pins "exactly one request" for this path.

**`move` and `archive`, including the no-ops.**

```
$ corpus doc move doc_yejhzfh7 --folder archive-notes
moved doc_yejhzfh7 — data/docs/archive-notes/mortgage-options.md
$ corpus doc move doc_yejhzfh7 --folder archive-notes      # again
doc_yejhzfh7 is already at data/docs/archive-notes/mortgage-options.md   → HEAD unchanged
$ corpus doc archive doc_yejhzfh7 --from agent
archived doc_yejhzfh7 — warning: orphaned_anchor (…)
$ corpus doc archive doc_yejhzfh7                          # again
doc_yejhzfh7 is already archived                                        → HEAD unchanged
```

Both no-ops exited 0 and **produced no second commit** (`git rev-parse HEAD` identical before
and after). The archived document left the default `GET /api/docs` result set.

**`doc delete` — the user-only guard.**

```
$ corpus doc delete doc_yejhzfh7 --from agent --yes
corpus: deletion is user-only — the agent archives, never deletes
  Archive it instead: `corpus doc archive doc_yejhzfh7`. Nothing was sent to the server.
exit=2                                            # file still on disk
$ CORPUS_FROM=agent corpus doc delete doc_yejhzfh7 --yes     → identical, exit 2
$ curl -X DELETE /api/docs/doc_yejhzfh7 -H "x-corpus-author: agent"   → 403 (backstop intact)
$ corpus doc delete doc_yejhzfh7                  # non-TTY, no --yes
corpus: refusing to delete doc_yejhzfh7 without --yes.
exit=2
$ corpus doc delete doc_yejhzfh7 <<< "y"          # a piped "y" is NOT a confirmation
exit=2
$ corpus doc delete doc_yejhzfh7 --from user --yes
deleted doc_yejhzfh7 — orphaned 2 threads (th_2fli6jce, th_pck2yjz5)
$ git log --diff-filter=D -1 -- data/docs/archive-notes/mortgage-options.md
user doc delete: Mortgage options (agent retitle) (doc_yejhzfh7) by user
$ git show HEAD~1:data/docs/archive-notes/mortgage-options.md | head -3   → content retained
# both orphaned thread files still exist; GET /api/threads/th_2fli6jce → 200
```

The "**zero requests**" half of the guard is asserted in `doc/delete.test.ts` against a
recording stub, per the sprint's own definition of that evidence. The TTY prompt is covered by
a unit test that drives the real `readline` prompt over a pair of streams: `y`, `yes`, `Y`
proceed; a bare Return, `n` and `sure` do not.

**`thread reply | resolve | reopen`.**

```
$ corpus thread reply th_pck2yjz5 --from agent <<'EOF' … EOF
replied to th_pck2yjz5 — turn 2026-07-27T15:59:26Z
# thread file gained "## agent · 2026-07-27T15:59:26Z" with the fenced ```form block verbatim
# git log -1: agent <agent@corpus.local> comment: turn on th_pck2yjz5 by agent
$ corpus thread reply th_pck2yjz5 --from user -m "One more thought about closing costs."
replied to th_pck2yjz5 — turn 2026-07-27T15:59:27Z (queued evt_so53kefouomf)
$ corpus thread resolve th_pck2yjz5      → resolved th_pck2yjz5      (status: resolved on disk)
$ corpus thread resolve th_pck2yjz5      → th_pck2yjz5 is already resolved   exit 0, no new commit
$ corpus thread reopen th_pck2yjz5 --from agent → reopened th_pck2yjz5 (status: open)
$ corpus thread reopen th_pck2yjz5 --json → one ThreadSummary value, exit 0
$ corpus thread reply th_pck2yjz5 -m ""   → exit 2, "no reply body to send."
$ corpus thread reply th_zzzzzzzz -m "x"  → exit 5, "404 not_found: no document with id th_zzzzzzzz"
```

A CLI-authored reply woke a **parked `corpus queue idle --json`** (backgrounded, pid captured):
it returned in under a second with `{"events":[{"id":"evt_u44jidl24bgl","type":"comment.created",…}]}`.

**`db rebuild` and `db doctor`.**

```
$ stat -f '%i %z' .corpus/cache.db          → 65637430 4096
$ corpus db rebuild
rebuilt the projection in 11ms — 9 documents, 2 threads, 4 turns, 0 anchors, 0 links, 2 events, 0 jobs, 0 locks, 0 seen
$ stat -f '%i %z' .corpus/cache.db          → 65899414 172032      # inode changed: a real swap
$ corpus doc create …                        → still works; GET /api/docs → 200
$ corpus db rebuild --json → {"documents":…,"durationMs":9,"path":"…/.corpus/cache.db","skipped":[]}
$ corpus db doctor
projection is clean — 10 documents from 10 files (4ms)               exit 0
$ printf '\nAn out-of-band line.\n' >> data/docs/inbox/after-the-rebuild.md ; sleep 2
$ corpus db doctor
projection is clean — 10 documents from 10 files (3ms)               exit 0   ← CORRECT (watcher healed it)
$ sqlite3 .corpus/cache.db "delete from documents where id='doc_6u656iaz';"   # optional drift probe
$ corpus db doctor
missing_row data/docs/inbox/after-the-rebuild.md: … has no `documents` row
corpus: the projection has drifted from the files — 1 finding.
exit=6
$ corpus db doctor --json     → stdout: {"ok":false,"drift":[…],"stats":{…}}   stderr: {"error":{"code":"check_failed",…}}   exit 6
$ corpus db rebuild && corpus db doctor → clean again, exit 0
```

`db rebuild` registers **no** local `--timeout` (registry validation would reject it) and used
the untimed client seam; a rebuild took 329 ms on the largest state and never touched the
10 s global transport deadline.

**Error surface across every verb in this issue.** With the server stopped, all ten verbs
answered exit **4** with `server not running for this workspace — run `corpus server start``
and no stack trace; `git status --porcelain` was byte-identical before and after that whole
sweep. Outside a workspace every verb exits **3**. `corpus doc frobnicate x` → exit 2 listing
the valid verbs; `corpus thred reply x` → exit 2, "Did you mean \"thread\"?".

**CLI-004 regression (TEST-70).** `health`, `queue status`, `lock list`, `job list` unchanged.
`lock acquire` (no `--from`) now records `holder: "user"` — the adjudicated change — and
`lock acquire --from agent` records `agent`. `lock break` still succeeds and still commits as
`user <user@corpus.local> lock: force-break on doc_xl3ydwth (was agent) by user`.
`queue claim-all` → `job log` → `queue complete` still work end to end; `GET /api/jobs` shows
`status: processed`, `lastLine: "filed the mortgage note"`.

**Documentation.** All three help levels render from the registry (`corpus --help` lists the
new `doc`, `thread`, `db` topics; every verb shows a description for every flag and at least
one example). `docs/cli.md` was regenerated with `npm run docs:cli -w apps/cli` and is
Prettier-clean — the generator now escapes `|` inside table cells, which `--from <user|agent>`
would otherwise break. **Every example command in the regenerated `doc`, `thread` and `db`
sections was executed against the live workspace** (ids substituted) — all exited 0.
`scripts/check-generated-artifacts.ts` reports the CLI reference as changed-vs-HEAD only
because the regenerated file is uncommitted in this worktree; the regeneration itself is a
no-op (hash identical across two runs).

**Repo gate.** `npm run build && npm run lint && npm run format:check && npm run typecheck &&
npm test` — all green in the worktree; 194 test files, 3206 tests passing.

**Cleanup.** Server stopped by pid, ports 8945 and 8765 free, `/tmp/corpus-c003-*` removed.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified (ACs 5 and 8 — `doc check`, `skill rollback` — STRUCK by the scope adjudication above)

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain — CLI/server contract surface, user-only deletion guard)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-003]` prefix
