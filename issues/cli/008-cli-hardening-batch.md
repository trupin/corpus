# [CLI-008] CLI hardening batch: PR #9 MINOR findings

## Domain

cli

## Status

done

## Priority

P2

## Model

opus — small, precisely located fixes from the PR #9 review.

## Dependencies

- Depends on: CLI-003, CLI-004
- Blocks: —

## Spec References

- PR #9 review, MINOR findings 7–9 (CLI subset)

## Summary

CLI-side MINOR findings from the Phase 2 PR review, deferred out of the merge:

1. **`probeHealth` ignores `health.workspace`** (`commands/server/state.ts`): a foreign corpus server on the same port passes as this workspace's; in `start` the child can die EADDRINUSE while the ready-probe hits the foreigner, writing a pidfile for a dead pid and reporting success. Compare the workspace identity.
2. **`lock break --from agent` silently rewrites to `user`** (`commands/lock/break.ts`): refuse like `doc delete` does (exit 2, no request) — one guard pattern for the two user-only verbs; refresh the stale module-header prose.
3. **Tag edit read-modify-write** (`commands/doc/edit.ts`): `--add-tag`/`--remove-tag` is an unguarded GET-then-PUT; document the hazard and mitigate if the server offers a conditional write; otherwise note the accepted race in the module header.
4. **`readAll` duplication** (`commands/job/log.ts` vs `input.ts`): folded by CLI-007 — verify and close.
5. **Enforce the stdin discipline** (CLI-007 implementer's suggestion): extend the hygiene test (or a lint rule) to assert no command module reads `process.stdin` outside `input.ts`, so the socket-hang class is enforced rather than remembered.

## Acceptance Criteria

- [x] Each item fixed with a regression test, or explicitly waived with a written rationale here.
- [x] Full gate green.

## E2E Verification Log

**implemented on: opus** (claude-opus-5, 1M context). Ports `8920`–`8924` and scratch
`/tmp/corpus-c008-eO1vrj` per the orchestrator's instruction; note this differs from
sprint-008's allocation for CLI-008 (`8951`–`8959`) — `8920`–`8924` sits inside SERVER-014's
band. Every port was confirmed free with `lsof` before binding and after teardown, and `8765`
was never bound. From-source entry point throughout:
`node --import tsx apps/cli/src/bin/corpus.ts` (with `--workspace <path>`, because `--import tsx`
resolves the loader against the child's cwd and the scratch workspaces have no `tsx`).

### Verdict per item

| # | Finding | Verdict | Evidence |
| - | ------- | ------- | -------- |
| 1 | `probeHealth` ignores `health.workspace`; `start` writes a pidfile for a dead child | **FIXED** | Reproduced first (below). `probeHealth(client, workspaceRoot)` now returns `ours` / `foreign` / `unreachable`; new `ServerState` kind `foreign`; `start` refuses an occupied port before spawning. Tests: `state.test.ts` (14), `status.test.ts` foreign cases, `stop.test.ts` "never signals a live pid because another workspace's server answered", `lifecycle.test.ts` "refuses to start when another workspace's server holds the port, and writes no pidfile" |
| 2 | `lock break --from agent` silently rewritten to `user` | **FIXED** — shipped behavior changed (see below) | `break.ts` guard mirrors `doc delete`'s: `UsageError` (exit 2) before any request, header now sends `context.actor`. Tests: `break.test.ts` "refuses `--from agent` before anything is sent…", "refuses the same way under --json…", "documents the refusal and the 404 no-op in its help" |
| 3 | Tag edit read-modify-write | **WAIVED with rationale** | No conditional write exists to mitigate with (`PUT /api/docs/{id}` takes `ActorHeaderSchema` only; no `If-Match`/ETag/version in `packages/contract` or `apps/server`; inventing one is out of scope per sprint-008 Out of Scope). Documented in `edit.ts`'s module header and in the verb's help (so `docs/cli.md` publishes it). Tests: `edit.test.ts` "states the accepted read-modify-write race where a caller will read it", "removing a tag the document does not carry leaves the list alone" |
| 4 | `readAll` duplicated between `job/log.ts` and `input.ts` | **VERIFIED CLOSED** (no code needed) | `grep -rn "export async function readAll" apps/cli/src` → one hit, `apps/cli/src/input.ts:144`. `job/log.ts` imports `readAll`, `stdinCarriesABody` (and now `stdinStream`) from `../../input.js` and defines none of them. Real-server run below exercises argument, pipe, heredoc and the socket case |
| 5 | Stdin discipline unenforced | **FIXED** | `input.ts` gained `stdinStream()` / `stdinIsTTY()`; the two legitimate call sites (`job/log.ts`, `doc/delete.ts`) moved onto them, so the rule is absolute with **no per-file exemptions** (Open Conflict 10's recommended design). `hygiene.test.ts` now scans **every** command module (37, listed exhaustively) plus the whole of `apps/cli/src`, and the rule is shown catching violations |

### Pre-fix reproduction (item 1 — this half was a bug)

Two real workspaces, both configured to `:8920`, workspace A's server running:

```
$ corpus init $S/wsA --port 8920 ; corpus init $S/wsB --port 8921   # then wsB's config.port := 8920
$ corpus --workspace $S/wsA server start
corpus 0.0.0 listening on http://127.0.0.1:8920 (pid 88535)
$ curl -s http://127.0.0.1:8920/api/health
{"status":"ok","version":"0.0.0","uptimeSeconds":0.378,"workspace":"/tmp/corpus-c008-eO1vrj/wsA"}

$ corpus --workspace $S/wsB server start          # B's port is A's
corpus 0.0.0 listening on http://127.0.0.1:8920 (pid 88691)   # ← a lie
  logs: corpus server logs -f
exit=0                                                        # ← reported success
$ cat $S/wsB/.corpus/server.pid
{ "pid": 88691, "port": 8920, … }                             # ← pidfile for a child that died
$ cat $S/wsB/.corpus/server.log
--- corpus server start … pid=88691 port=8920 ---
{"level":"error","msg":"port 8920 already in use — another corpus server may be running (corpus server status)"}
$ corpus --workspace $S/wsB server status
running — pid 88691 on :8920, corpus 0.0.0, up 8s, http://127.0.0.1:8920
exit=0                                                        # ← A's uptime, reported as B's server
```

Exactly the failure `start.ts`'s own comment says the write-the-pidfile-last order exists to
prevent. (Mitigating factor, recorded for completeness: the two workspaces have different
tokens, so a subsequent `corpus doc create` in B got `401` from A's server rather than writing
into A — the damage was confined to the lifecycle verbs' reports.)

### Post-fix verification (item 1)

```
$ corpus --workspace $S/wsB server start
corpus: :8920 is held by another workspace's server (/tmp/corpus-c008-eO1vrj/wsA)
  Give this workspace its own port: change `port` in .corpus/config.json (or set CORPUS_PORT), then start again.
exit=4                                     # TEST-129: documented exit code, clear message
$ test -e $S/wsB/.corpus/server.pid || echo "no pidfile"
no pidfile                                 # TEST-129: no file naming a pid that never served
$ corpus --workspace $S/wsB server start --json
{"error":{"code":"server_unreachable","message":":8920 is held by another workspace's server (/tmp/corpus-c008-eO1vrj/wsA)"}}
exit=4                                     # stdout empty, failure on stderr as one JSON line

$ corpus --workspace $S/wsB server status  # TEST-128
not running
corpus: the workspace server is not running
  Start it with `corpus server start`.
exit=6
```

TEST-130 (happy path unchanged), on B's own port:

```
$ corpus --workspace $S/wsB server start   → corpus 0.0.0 listening on http://127.0.0.1:8921 (pid 46866)   exit=0
$ corpus --workspace $S/wsB server status  → running — pid 46866 on :8921, corpus 0.0.0, up 1s, …           exit=0
$ corpus --workspace $S/wsB server start   → already running on :8921 (pid 46866) — http://127.0.0.1:8921   exit=0
$ corpus --workspace $S/wsA server stop    → stopped (pid 88535)                                            exit=0
```

The new `foreign` state, observed live (B's config re-pointed at `:8920` while B's own server
was still alive on `:8921` — a live pid *and* a healthy answer, the combination that used to
read as "running"):

```
$ corpus --workspace $S/wsB server status
pid 46866 is alive, and :8920 is held by another workspace's server (/tmp/corpus-c008-eO1vrj/wsA)
corpus: the workspace server is not running, and :8920 is held by another workspace's server (…/wsA)
exit=6
$ corpus --workspace $S/wsB server status --json
{"workspace":"…/wsB","url":"http://127.0.0.1:8920","running":false,"healthy":false,"pid":46866,"port":8920,…}

$ corpus --workspace $S/wsB server stop
not running (stale pidfile removed) — :8920 is held by another workspace's server (…/wsA), and pid 46866 was left alone
exit=0
$ lsof -nP -iTCP:8921 -sTCP:LISTEN   → node 46866 … (LISTEN)   # B's real server survived
$ curl -s http://127.0.0.1:8920/api/health → {"status":"ok",…,"workspace":"…/wsA"}   # A untouched
```

One defect was found by this E2E pass and fixed: the first implementation named the *pidfile's*
port in the foreign message (`:8921`) while the probe had asked the *config's* port (`:8920`).
`buildReport`/`stop` now report the port that was actually probed; pinned by
`status.test.ts` "names the port it actually probed, not the one the old pidfile records".

Two further branches the E2E pass exercised only by hand are now pinned by `lifecycle.test.ts`
against real spawned daemons: "refuses to start over a live pid whose port answers for another
workspace" (a live pid **and** a healthy answer — the pair that used to read as "already
running") and "refuses to start a second server for this workspace when no pidfile names the
first" (a deleted pidfile over a live daemon, which previously spawned a child that could only
die `EADDRINUSE` and then recorded *that* pid).

### Item 2 — the behavior change, stated plainly

**`corpus lock break` used to accept `--from agent` and silently send `x-corpus-author: user`.**
It now **refuses**: exit 2, `breaking a lock is user-only — the agent waits, never breaks`, with
nothing sent to the server. A caller that relied on the rewrite gets a usage error instead of a
break attributed to the user who never asked for one. `lock break` stays **user-only**; the
legitimate agent path is unaffected because AGENT-002/003 pass `--from agent` / `CORPUS_FROM=agent`
for the verbs the agent actually runs, and breaking a lock was never one of them.

```
$ corpus --workspace $S/wsA lock acquire doc_iaf2wpep --from agent   → locked doc_iaf2wpep for agent, lease 300s.

$ corpus --workspace $S/wsA lock break doc_iaf2wpep --from agent      # TEST-131
corpus: breaking a lock is user-only — the agent waits, never breaks
  Wait for the holder and retry — a job blocked on a lock is deferred, not forced. Nothing was sent to the server. Check who holds it with `corpus lock list`.
exit=2
$ CORPUS_FROM=agent corpus --workspace $S/wsA lock break doc_iaf2wpep # TEST-132 — same refusal, same exit 2
exit=2
$ corpus --workspace $S/wsA lock break doc_iaf2wpep --from agent --json
{"error":{"code":"usage_error","message":"breaking a lock is user-only — the agent waits, never breaks"}}
exit=2
$ corpus --workspace $S/wsA lock list → doc_iaf2wpep — agent, acquired …, lease 300s   # still held; commits unchanged (2 → 2)
```

Proof the guard runs **before** the transport, not after a failed request — the same refusal in a
workspace whose server is **not running** (a sent request would be exit 4, not exit 2):

```
$ corpus --workspace $S/wsB lock break doc_whatever --from agent → exit=2  (usage error)
$ corpus --workspace $S/wsB lock break doc_whatever              → exit=4  (server not running…)
```

TEST-133, breaking as the user still works and is still audited:

```
$ corpus --workspace $S/wsA lock break doc_iaf2wpep            → broke the agent lock on doc_iaf2wpep.   exit=0
$ corpus --workspace $S/wsA lock list                          → no locks held.
$ corpus --workspace $S/wsA lock break doc_iaf2wpep            → no lock held on doc_iaf2wpep.           exit=0  (404 no-op)
$ corpus --workspace $S/wsA lock break doc_iaf2wpep --from user --json → {"docId":"doc_iaf2wpep","broken":true,"holder":"agent"}  exit=0
$ git -C $S/wsA log --format='%h %an %s' -3
5efa2d6 user lock: force-break on doc_iaf2wpep (was agent) by user
c1ac979 user lock: force-break on doc_iaf2wpep (was agent) by user
290600d user doc create: c008 lock probe (doc_iaf2wpep) by user
```

TEST-133's "the deferred edit re-enters the queue" clause was **not exercised**: it is server-side
behavior with no deferred edit in this scenario, and nothing in this issue touches it.

TEST-134: the stale module prose (*"the actor is overridden per call"*) is gone from `break.ts`'s
header, replaced by the refusal's rationale; `docs/cli.md` regenerated with
`npm run docs:cli -w apps/cli` (never hand-edited).

### Item 3 — the race is documented; the verb still behaves (TEST-136)

Against the real server on `:8920`, reading the result **off disk** each time:

```
$ corpus doc edit doc_iaf2wpep --add-tag housing --add-tag finance   → tags: [housing, finance]
$ corpus doc edit doc_iaf2wpep --remove-tag finance                  → tags: [housing]
$ corpus doc edit doc_iaf2wpep --add-tag draft --remove-tag draft --add-tag urgent → tags: [housing, urgent]
$ corpus doc edit doc_iaf2wpep --remove-tag nonexistent              → tags: [housing, urgent]
$ git -C $S/wsA log --format='%h %s' -1 → 9f51ff6 doc edit: c008 lock probe (doc_iaf2wpep) by user
```

The four edits produced **one** commit — `SQUASH_IDLE_MS = 30_000` folding same-doc/same-actor
writes, which is the server's documented behavior, not a CLI effect.

### Item 4 — verified closed (TEST-137)

`readAll` has exactly one definition (`input.ts:144`) and `job/log.ts` imports it. Both input
routes still work against the real server, and the socket case still refuses instead of hanging
(this Bash tool hands the child a socket on fd 0, so the last line is the regression itself):

```
$ corpus job log evt_axgnjaritu7s "step 1: from an argument" --from agent --json → {"eventId":"…","appended":true}
$ echo "step 2: piped in" | corpus job log evt_axgnjaritu7s --from agent --json  → {"eventId":"…","appended":true}
$ corpus job log evt_axgnjaritu7s --from agent --json <<'EOF' … EOF              → {"eventId":"…","appended":true}
$ corpus job log evt_axgnjaritu7s --from agent
corpus: no line to append.  … exit=2      # a socket on fd 0: usage error, not a hang
$ cat $S/wsA/.corpus/jobs/evt_axgnjaritu7s.jsonl
{"ts":"…","source":"cli","line":"step 1: from an argument"}
{"ts":"…","source":"cli","line":"step 2: piped in"}
{"ts":"…","source":"cli","line":"step 3: heredoc"}
```

### Item 5 — the rule, and it catching a real violation (TEST-138/139/140)

Design shipped (Open Conflict 10): **absolute ban, achieved by moving the call sites**, not a ban
with carve-outs. `input.ts` exports `stdinStream()` and `stdinIsTTY()`; `job/log.ts:43` and
`doc/delete.ts:67,:86` now use them, so `process.stdin` appears in code in exactly one file. The
hygiene test scans every command module (the exhaustive 37-entry list is asserted, so a new verb
joins the scan by existing) **and** the whole of `apps/cli/src`. The write-restriction rules stay
scoped to `doc`/`thread`/`db` — `server/` and `init/` legitimately write the pidfile, the log and
the workspace scaffold (SPEC.md §2.2 rule 4).

Demonstrated, not asserted — a real `process.stdin` read appended to a real command module:

```
$ printf '\nexport const rogue = process.stdin.isTTY;\n' >> apps/cli/src/commands/queue/claim-all.ts
$ vitest run apps/cli/src/commands/hygiene.test.ts
 × nothing outside input.ts touches process.stdin > finds no reference in any command module
   → expected [ 'queue/claim-all.ts' ] to deeply equal []
 × nothing outside input.ts touches process.stdin > finds no reference anywhere else in the CLI either
   → expected [ 'commands/queue/claim-all.ts' ] to deeply equal []
 Tests  2 failed | 8 passed (10)
$ # reverted; git diff on that file is empty and the file is green again (10 passed)
```

Two in-memory fabricated modules pin the same rule against spacing tricks
(`process . stdin . isTTY`) and prove prose is not a violation.

### TEST-126 / TEST-127 — no surprises

Every item has a verdict in the table above. No exit code was added (`0/1/2/3/4/5/6` unchanged —
`start`'s port refusal reuses `4`, `lock break`'s refusal reuses `2`), no flag was added at all,
and `registry/validate.ts` still passes at module load. Help renders at all three levels:

```
$ corpus --help            → corpus — conversations around documents, driven by an agent.   exit=0
$ corpus server --help     → corpus server — Manage this workspace's server process.        exit=0
$ corpus lock break --help → …“**The agent may not run this.**” …                           exit=0
```

Also re-confirmed unchanged: `corpus doc delete` without `--yes` on a non-TTY stdin exits 2
without consuming the piped input (`echo "yes" | corpus doc delete doc_iaf2wpep` → exit 2, the
document still editable afterwards), and `doc delete --from agent` still refuses with its own
message.

### Gate

- `npm run build` — green.
- `npm run lint` — clean; `npm run format:check` — "All matched files use Prettier code style!"
  (two files needed `prettier --write` first).
- `npm run typecheck` — green across all workspaces.
- `npm test` — **201 files, 3438 tests, all passing** (baseline 201/3415 per the sprint contract;
  a clean full run at the end of this issue reported `Tests 3438 passed (3438)`). `apps/cli`
  alone: **51 files, 530 tests** (baseline 507) — **+23 tests**, all new ones colocated.
  Two wall-clock-bounded tests flaked under load while a coverage run and sibling agents shared
  the machine — `apps/server/src/anchors/reconcile.test.ts > reconciles 50 anchors over a ~1 MB
  body in under a second` (5 s timeout) and, in an earlier run, `apps/cli/src/commands/queue/
  idle.test.ts > writes nothing at all while parked`. Both pass in isolation and in the quiet
  full run; neither is touched by this issue.
- `npm run test:coverage` — the 90 % gate passes (exit 0): total lines **98.66 %**, statements
  98.66 %, functions 98.40 %, branches 94.74 %. Per workspace lines: `apps/cli` **99.00 %**
  (4152/4194), `apps/server` 98.09 %, `apps/ui` 100 %, `packages/contract` 100 %. The files this
  issue changed: `server/state.ts` **100 %**, `server/start.ts` 95.48 % (the only uncovered lines
  are `abandon()`'s pre-existing SIGKILL-escalation path, 204–212), `server/stop.ts` 94.79 %
  (unchanged from baseline — the uncovered lines are the pre-existing SIGKILL-failure and
  already-gone-signal paths).
- `node --import tsx scripts/check-generated-artifacts.ts` — the API contract is up to date, and
  `docs/cli.md` regenerates to a **byte-identical** file (the hash is stable across regeneration).
  The check still reports it "stale" **because the regenerated file is not yet committed** — it
  also diffs against `HEAD`, and this worktree is uncommitted by design (domain agents do not
  commit). It goes green with the `[CLI-008]` commit; run twice, same result both times.
- Ports `8920`–`8924` free at teardown, `8765` never bound, no stray processes (both scratch
  servers stopped: A via `corpus server stop`, B by pid after the foreign-state `stop` had
  correctly declined to signal it).

### Escalation

None blocking. One thing worth a filed issue rather than an improvisation here: **item 3's race
can only be closed by a conditional-write primitive** (`If-Match`/ETag or a version field on
`PUT /api/docs/{id}`), which is a `packages/contract` change nobody has filed. The CLI-side
mitigation is documentation, which is what shipped.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[CLI-008]` prefix
