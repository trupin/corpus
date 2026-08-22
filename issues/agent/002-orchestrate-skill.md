# [AGENT-002] Orchestrate skill: the agent's main loop

## Domain

agent

## Status

done

## Priority

P0

## Model

fable — the skill text IS the product agent's judgment; prompt design quality determines system behavior.

## Dependencies

- Depends on: CLI-004, CLI-007, AGENT-001
- Blocks: AGENT-003

## Spec References

- SPEC.md §7 (event queue and agent loop) — queue contract and event types, CLI queue verbs, **orchestrator skill**, document locks, job logs, HALT, agent stewardship, skills-as-documents including loop safety (`corpus skill rollback`)
- SPEC.md §8 (agent participation semantics) — structured `mentions`/`skills` in the event payload, the honest pending indicator the loop must not leave hanging
- SPEC.md §10, extension point 2 (agent skills) — plugin event types `<plugin>.*` route to plugin skills by convention
- SPEC.md §12 M4 — the executable check this skill must satisfy end to end
- CLAUDE.md — Architecture Decision 2 (server is sole writer; the agent interacts only through the CLI)

## Summary

Write the real `.claude/skills/orchestrate/SKILL.md` — the product agent's main loop, the thing the operator invokes with `/orchestrate` after starting `claude` in their workspace. It replaces the AGENT-001 skeleton at `assets/workspace/claude/skills/orchestrate/SKILL.md`.

> **Attribution requirement (CLI-003 adjudication, 2026-07-27):** the CLI's `--from` default is `user` on every mutating verb — including `lock acquire`, which previously defaulted to `agent`. The skill (or the workspace's agent environment) MUST set `CORPUS_FROM=agent` (or pass `--from agent` on every call), or every agent-side write and lock will be attributed to the user in git and in lock ownership.

This is prompt engineering held to the same bar as code. The skill must make an autonomous Claude Code session: park with zero token burn, claim events atomically, route each event type to the right handler, respect concurrency and lock constraints, emit progress that the console can show, drive every claimed event to a terminal state, honor the HALT kill switch, steward the corpus while it works, and never — under any circumstance — write a workspace file by hand. It must also tell the human how to recover when the loop itself is broken, since a bad edit to a core-loop skill disables the mechanism that would otherwise fix it.

## Acceptance Criteria

- [ ] `assets/workspace/claude/skills/orchestrate/SKILL.md` contains real behavioral prose (no skeleton remnants) with frontmatter unchanged in shape from AGENT-001: both Claude Code fields (`name: orchestrate`, `description`) and Corpus fields (`id`, `type: skill`, `title`, `status`, `created`, `updated`, `tags`, `evergreen`), with `updated` advanced.
- [ ] The skill contains all **required sections** listed in Technical Design, each covering the behavioral rules enumerated there.
- [ ] The loop is stated as an explicit, ordered command sequence — `corpus queue claim-all` → handle → `corpus queue complete|fail <id>` → `corpus queue idle` → repeat — with the rule that `idle` is the **only** waiting mechanism: never `sleep`, never poll, never busy-wait, and its ~8-minute rearm exit is a normal outcome that re-runs the loop rather than an error.
- [ ] Event routing is specified for every core type: `comment.created` and `form.respond` → invoke the comment skill; `agent.done` → resume the parked work identified by the payload; `<plugin>.<action>` → the plugin skill named `<plugin>` by convention; **unknown type → `corpus queue fail` with a reason, never a guess and never a silent complete**.
- [ ] Concurrency rule is explicit and actionable: events touching the same document (same thread, or same parent document) are handled **serially in claim order**; events on independent documents may run in parallel via subagents, with a stated cap and the rule that a subagent never claims or completes queue events itself.
- [ ] Every claimed event reaches a terminal state (`complete` or `fail`) — the skill states this as an invariant, including on error paths and interruptions, and names `corpus queue reap-stale` as the recovery for events stranded in `in-progress`.
- [ ] Failure handling is specified: `corpus queue fail <id>` with a concise human-readable reason, the reason also written to the job log, and — when a user is waiting on a thread (`comment.created` / `form.respond`) — a short reply posted through the CLI so the pending indicator resolves instead of hanging.
- [ ] Progress reporting is specified: `corpus job log <eventId> "<line>"` at meaningful steps (claimed, routed, notable action taken, completed/failed), with guidance on what a useful line looks like and an explicit prohibition on chatter or token streaming.
- [ ] The CLI-only invariant is stated unmissably and reflected in **every** example: mutations go through `corpus` verbs, never file edits, never raw HTTP; the server is the sole writer.
- [ ] HALT semantics are stated: while `.corpus/HALT` is present, `idle` parks and `claim-all` returns empty — the correct behavior is to keep looping quietly, not to exit or error; `corpus queue halt|resume` are named as the operator's controls.
- [ ] Lock behavior is stated: before editing, the CLI acquires the document lock implicitly; if a document is **user-locked**, the edit is deferred — the work stays queued and applies when the lock clears, and the skill says exactly how the agent defers (does not `complete` the event as if done, does not force the lock; `corpus lock break` is the human's escape hatch, not the agent's).
- [ ] The stewardship charter is present and complete per §7: durable knowledge from threads becomes documents; stale content updated; obsolete archived; misfiled moved; near-duplicates merged; overgrown split; changes stated in replies; **the agent archives and never deletes** (deletion is user-only); every change traceable via the CLI's auto-commit with agent authorship.
- [ ] A loop-safety / recovery section, written **for the operator**, documents that a bad edit to `orchestrate` or `comment` can break the loop and that `corpus skill rollback <name>` restores the last-known-good version — plus how to reach that state (HALT, then rollback, then resume).
- [ ] Every `corpus …` command appearing anywhere in the skill exists in the generated `docs/cli.md` — enforced by an automated test, not by review.
- [ ] The skill is verified by running it for real: a live `claude` session in a real initialized workspace drives at least one queue event from `pending` to `processed` with an agent turn visible over the API and job log lines in the console (E2E log).

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the real skill (replaces the AGENT-001 skeleton body; frontmatter shape preserved, `updated` advanced)
- `scripts/workspace-template.ts` — extend with a helper that extracts `corpus …` invocations from template markdown (fenced blocks and inline code) and resolves them against `docs/cli.md`
- `scripts/workspace-template.test.ts` — add the skill-content assertions and the CLI-command-existence test
- `docs/workspace-template.md` — note that skill bodies are verified against `docs/cli.md`, so CLI surface changes can break AGENT skills

### Key Implementation Details

**Required sections of the skill** (headings may be worded naturally, but every one of these must be present and substantive):

1. **Purpose and when to run** — what `/orchestrate` is, that the operator starts it and it runs until stopped, and that it is the only process that claims queue events.
2. **Invariants** — up front, before the loop, because everything after depends on them: (a) every mutation goes through the `corpus` CLI; never edit files in `data/`, `.corpus/`, or `.claude/` by hand, never call the HTTP API directly; (b) the agent archives, never deletes; (c) every claimed event reaches a terminal state; (d) `corpus queue idle` is the only wait.
3. **The loop** — the ordered command sequence, with the rearm-exit behavior and the "no sleeping, no polling" rule spelled out. Show it once as literal commands so there is nothing to infer.
4. **Claiming and batching** — `corpus queue claim-all` returns the whole pending batch as one JSON payload; parse it, group it, and work it; do not claim again mid-batch.
5. **Routing table** — one row per event type, mapping to a handler, including the plugin convention and the unknown-type failure rule. Plugin routing: event type `<plugin>.<action>` → the skill whose name is `<plugin>`; if no such skill is installed or it is archived, fail the event with a reason naming the missing skill.
6. **Concurrency and ordering** — how to compute the "document a event touches" (for thread events: the thread id **and** its `parent` document id; for plugin events: the document ids in the payload), the serial-per-document rule in claim order, the parallel-across-documents rule via subagents, a stated cap on parallel subagents, and the rule that subagents do the work while the orchestrator alone owns queue state transitions.
7. **Locks and deferral** — the CLI acquires locks implicitly on edit verbs; a user-held lock means defer, not force. State the concrete deferral protocol the implementing agent settles on (the work stays queued and applies when the lock clears) and note that a broken lock re-queues the deferred edit rather than losing it.
8. **Progress and job logs** — `corpus job log <eventId> "<line>"` at claimed / routed / acted / terminal, what makes a line useful ("edited [[doc_…]] — updated the rate assumption" beats "working"), and the prohibition on narrating every tool call.
9. **Completing and failing** — the exact verbs, what belongs in a failure reason, the "reply to the waiting user before failing a thread event" rule, and `corpus queue reap-stale` for stranded in-progress events after a crash.
10. **HALT** — what it is, how it manifests (`idle` parks, `claim-all` returns empty), the correct quiet-loop behavior, and the operator's `halt`/`resume` verbs.
11. **Stewardship charter** — the §7 rules in full (see acceptance criteria), framed as "leave the corpus better than you found it": act opportunistically while working a task, not only when asked; state what changed in the reply that occasioned it; nothing silently destructive.
12. **Skills and subagents are documents** — new or edited skills and `type: agent-def` documents take effect as files under `.claude/`, are visible and commentable on the board, and are edited through the CLI like any document.
13. **If the loop breaks (operator recovery)** — written for the human, not the agent: symptoms of a broken core-loop skill, `corpus queue halt`, `corpus skill rollback orchestrate|comment`, `corpus queue resume`, and the reminder that archiving a skill (`corpus doc archive`) disables it by moving it to `.claude/skills-archived/`.
14. **Worked example** — one end-to-end trace of a single `comment.created` event from `claim-all` through the reply and `complete`, with the literal commands in order. Realistic ids, no ellipses standing in for required arguments.

**Writing standard.** Imperative, second person, no hedging. Every rule states what to do, not what to consider. Where the spec allows judgment (how much stewardship to do opportunistically, when to parallelize), give a decision rule and an example rather than "use your judgment". Keep it as short as it can be while covering the above — a loop skill that is not read in full is a loop skill that is not followed. Prefer tables for the routing map and command reference.

**Command accuracy is a hard requirement.** Before writing any command, read the generated `docs/cli.md` (CLI-001's registry output, extended by CLI-002/003/004) and use only verbs and flags that exist, spelled exactly. If the loop needs a verb the CLI does not provide, **escalate to the orchestrator for a CLI issue** — do not write aspirational commands into the skill. The automated test makes this permanent: a skill referencing a nonexistent command fails `npm test`.

**Heredoc convention.** Multi-line text always goes through a quoted heredoc so the agent's own content is never re-interpreted by the shell:

```
corpus thread reply th_x9y8 --from agent <<'EOF'
Updated the rate assumption in [[doc_a1b2c3]] to 6.4%.
EOF
```

**Division of labor with AGENT-003.** Thread-handling behavior (reading context, honoring mentions, filing inbox captures, reply content, skill genesis) belongs to the comment skill. Orchestrate routes to it and owns queue state, concurrency, locks, logging, HALT, and the charter. Do not duplicate comment-skill rules here; reference the comment skill by name.

### Edge Cases

- **`claim-all` returns an empty batch** (halted, or a race with another consumer) — proceed straight to `idle`; not an error.
- **Two events on the same thread in one batch** — serial in claim order; the second sees the first's effects, which is why order matters.
- **An event whose thread or parent document no longer exists** (user deleted it) — fail with a reason naming the missing id; do not attempt to recreate it.
- **`agent.done` for work whose thread was resolved meanwhile** — finish the work if it has value, but say so in the reply rather than reopening the thread unilaterally.
- **A plugin event whose plugin skill was archived** — archived skills are still indexed but no longer discovered; fail with a reason naming the skill so the console row is actionable.
- **Interruption mid-batch** (operator quits, session dies) — events stay in `in-progress`; the skill names `corpus queue reap-stale` as the way back, and says to run it at loop start after an unclean stop.
- **A subagent tries to complete an event** — forbidden; state it explicitly, because it is the natural thing for a subagent to do and it corrupts queue accounting.
- **Editing the orchestrate skill from inside the loop** — permitted (skills are documents) but the change takes effect only on the next `/orchestrate`; say so, and pair it with the rollback path.
- **A document locked by the agent's own earlier crashed run** — a TTL'd stale lock; `corpus lock reap` clears expired locks. The agent does not break locks.

## Testing Strategy

Vitest, extending `scripts/workspace-template.test.ts`:

- **Frontmatter preserved**: `name: orchestrate` still matches the directory; both field sets present; `type: skill`.
- **Required sections present**: assert on the section list (headings matched case-insensitively against a small set of required keywords per section), so a future edit that drops the HALT or stewardship section fails the build.
- **Required rules present**: assert the literal presence of the non-negotiables — `corpus queue claim-all`, `corpus queue idle`, `corpus queue complete`, `corpus queue fail`, `corpus job log`, `corpus skill rollback`, and phrases covering CLI-only, archive-never-delete, and terminal-state-for-every-claimed-event.
- **CLI command existence**: extract every `corpus …` invocation from the skill (fenced blocks + inline code), normalize to `topic verb`, and assert each exists in `docs/cli.md`. This is the test that keeps the skill honest as the CLI evolves.
- **No placeholders**: no `TODO`, no `<…>` tokens outside documented argument placeholders in examples.

Behavior itself is not unit-testable — a prompt's quality is proven by running it. That is what the E2E plan is for.

## E2E Verification Plan

### Reproduction Steps (bugs only)

_N/A — feature issue._

### Verification Steps

Real workspace, real server, real `claude` session — no simulation of the loop itself.

1. `corpus init` a scratch workspace outside the repo; `corpus server start`; confirm `corpus doc check` passes and the board loads.
2. Create an agent-requested thread on a real document through the real interface (UI comment with `@agent`, or `POST /api/threads` with `requestsAgent: true` and the bearer token — there is no `corpus thread create` verb and no `--agent` flag; sprint-012 Adjudication 7) → confirm a `comment.created` event lands in `.corpus/queue/pending/` and the UI shows the pending indicator.
3. Start `claude` in the workspace, invoke `/orchestrate`. Observe, and capture: `claim-all` output, the event moving `pending → in-progress`, job log lines appearing in the console drawer for that job, an agent turn appearing in the thread (via SSE in the UI **and** in `GET /api/threads/:id`), the event ending in `processed`, and the loop parking on `idle`.
4. Post a second comment in the same thread → the parked loop wakes and handles it without operator intervention. Capture the timestamp gap to show `idle` returned promptly rather than after a rearm.
5. **Two events, same document**: post agent-requested comments on two threads of the same parent document in quick succession → confirm they are handled serially and the second reflects the first's changes.
6. **Two events, independent documents**: same test across two unrelated documents → confirm parallel handling and that queue transitions remain correct (no event completed twice, none stranded).
7. **HALT**: `corpus queue halt`, post a comment → the loop stays quiet, `claim-all` returns empty, the event remains pending, the console shows the halted state. `corpus queue resume` → the event is picked up.
8. **Lock deferral**: hold a document's lock as the user (open it in the UI editor), post an `@agent` comment asking for an edit to that document → the agent defers rather than forcing; release the lock → the edit lands. Then take an agent-held lock, use **Force unlock** → the break is recorded in the commit trail and the deferred edit re-enters the queue.
9. **Unknown event type**: hand-place a queue event with a bogus `type` in `pending/` → the loop fails it with a reason; the console shows a failed job with that reason; nothing is silently completed.
10. **Loop safety**: edit `orchestrate`'s skill document through the UI editor to something broken, restart the loop to observe the failure mode, then follow the skill's own recovery section — `corpus queue halt`, `corpus skill rollback orchestrate`, `corpus queue resume` — and confirm the loop returns. This proves the recovery text is correct, not merely present.
11. **Stewardship**: in a thread, tell the agent a durable preference → confirm it lands in a document (created or updated) via the CLI, that `git log` shows the commit authored by the agent, and that the reply states the change.
12. `corpus queue reap-stale` after killing the session mid-event → the stranded `in-progress` event is recovered.

Record exact commands and observed output for each step; §12 M4's check is the bar.

## E2E Verification Log

**Implemented on: fable** (this agent). The live workspace session below also ran on `claude-fable-5` (from its stream-json init record).

### Reproduction (bugs only)

_N/A — feature issue._

### Post-Implementation Verification

Environment: worktree `.claude/worktrees/agent-a2be23f95d15bf8ef` (cut from `main` @ 8d99313). Scratch workspace `/tmp/corpus-s012-agent002-UYqrmz/ws`, server port **9062**. From-source CLI entry: `node --import tsx apps/cli/src/bin/corpus.ts`. The live `claude` session got a `corpus` wrapper script at `/tmp/corpus-s012-agent002-UYqrmz/bin/corpus` (execs the same from-source entry via an absolute tsx loader path) prepended to its PATH — harness scaffolding outside the workspace.

#### Textual half (automated suite: `scripts/workspace-template.test.ts`, 61 tests green)

Scoped run: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts` → `Test Files 1 passed | Tests 61 passed`. Lint/format/typecheck on touched files: eslint clean, prettier clean, `tsc --noEmit -p scripts/tsconfig.json` clean.

- **TEST-1** — frontmatter shape preserved; `git diff` on the file shows exactly one frontmatter change:
  ```
  -updated: 2026-07-26T00:00:00Z
  +updated: 2026-07-28T00:00:00Z
  ```
  `created` byte-identical; all other fields untouched. The tree-wide one-timestamp test was reworked to pin exactly this (all `created` equal; `updated` equals `created` everywhere except orchestrate, where it is strictly later).
- **TEST-2** — file at `assets/workspace/claude/skills/orchestrate/SKILL.md`; "uses no dot-prefixed name other than .gitkeep" still passes.
- **TEST-3** — no skeleton remnants (tested: no "Arrives with AGENT", "skeleton", "TBD", "<fill", "placeholder"). Surviving `<…>` tokens, enumerated (all argument placeholders in documented examples/rows): `<plugin>`×6, `<name>`×4, `<action>`×3, `<id>`×2, `<type>`×1, `<subagent>`×1, `<skill>`×1, `<seconds>`×1, `<line>`×1, `<eventId>`×1 (plus quoted `<<'EOF'` heredoc markers).
- **TEST-4** — tested: body contains none of `SPEC.md`, `CLAUDE.md`, `issues/`, `/implement`, `/decompose`; no plugin name (`todos`/`_fixture` grep → 0).
- **TEST-5** — all 14 sections present (heading keywords asserted) and each section body > 400 chars (asserted; a bare heading fails).
- **TEST-6** — comment skeleton untouched; its heading assertions, CLI-only assertion and "no `corpus queue (complete|fail)` in comment body" all still pass in the same run.
- **TEST-7/8/9/10/11** — the loop appears once as a literal bash block (`export CORPUS_FROM=agent` → `reap-stale` → `claim-all` → complete/fail → `idle`); "only wait" prohibition asserted, and the suite counts exactly **one** occurrence of `sleep` (the prohibition itself), zero `while true`, zero timer constructs; rearm spelled exactly `{"idle":true,"reason":"timeout"}` exit 0 and `{"idle":true,"reason":"halted"}`, `--wait <seconds>` (default 480) named as the only flag; one-batch/no-mid-batch-claims and empty-batch-goes-to-idle stated.
- **TEST-12..16** — routing table with the five rows (comment.created, form.respond, agent.done, `<plugin>.<action>`, anything-else → `corpus queue fail <id> --reason "unknown event type: <type>"`); "never guess"/"never silently completed" literal; missing/archived plugin skill fails the event naming the skill; structured `mentions`/`skills`, `@<subagent>`/`/<skill>` directives, missing-target-said-in-reply, generic `@agent` → triage.
- **TEST-17/18/19** — touched-set computation per event type (thread id AND parent id; payload doc ids; plus a rule for uncomputable sets: treat as touching everything, run serially); serial-in-claim-order with the reason; parallel via subagents cap **3**; subagent queue-state prohibition with the reason.
- **TEST-20/21/22** — deferral as an ordered literal command sequence (reply heredoc → `corpus job log … "deferred: …"` → `corpus queue fail … --reason "deferred: …"`), `corpus job retry` as re-entry, `corpus lock list` to notice clearance; never force / `corpus lock break` human-only / `corpus lock reap` for TTL'd leftovers. Attribution: `--from` defaults to `user` incl. `lock acquire`; `export CORPUS_FROM=agent` at session start **and** `--from agent` on the doc-edit/thread-reply examples. Mutating invocations enumerated: `corpus doc edit … --from agent` (worked example, ×1) and `corpus thread reply … --from agent` (deferral + worked example, ×2) carry the flag explicitly; `corpus queue complete/fail/reap-stale`, `corpus job log`, and inline verb references are covered by the stated `export CORPUS_FROM=agent` opening the loop block; the recovery section's `corpus queue halt/resume` and `corpus skill rollback` are operator commands where the `user` default is correct.
- **TEST-23/24/25/26** — `corpus job log <eventId> "<line>"` with no flags, good line vs `"working"`, no tool-call narration/token streaming; terminal-state invariant in Invariants item 4 and restated in Completing and failing; `--reason` is a flag, reason mirrored to the job log, reply-before-fail for thread events; HALT as `.corpus/HALT`, empty `claim-all`, parked `idle` with `reason: "halted"`, quiet loop, `corpus queue halt|resume` named.
- **TEST-27/28** — all charter rules present rule-by-rule (durable-knowledge→documents with "if you would need it in a future thread, write it down now"; stale updated; obsolete archived / archive-never-delete / deletion user-only; misfiled moved; near-duplicates merged; overgrown split; change stated in the occasioning reply; auto-commit traceability). Hedge grep asserted in the suite: zero of "use your judgment", "consider whether", "you may want", "if appropriate"; a scope rule (stewardship the event's own documents call for; sweeps are separate, proposed in a reply) replaces judgment language.
- **TEST-29/30/31/32** — skills/agent-defs as documents, next-`/orchestrate` effect; operator recovery `halt → corpus skill rollback orchestrate → resume` with symptoms and the archive note (`.claude/skills-archived/`); worked example is a full `comment.created` trace with realistic ids (`evt_7c1d9a`, `th_4b8e2c`, `doc_a1b2c3`), no ellipses in commands; every multi-line argument is a quoted heredoc — the suite asserts every heredoc marker in the body is exactly `<<'EOF'` and that `-m "$(` never appears.
- **TEST-33** — `scripts/workspace-template.ts` exports `parseCliDoc`/`readCliDoc` (heading-derived `commands` + `topics`), `extractCorpusInvocations` (fenced lines incl. `&&`/`|`/`;` splitting and heredoc-body skipping, plus inline code spans; prose never scanned), `normalizeInvocation` (bare command | `topic verb` | bare topic | `null` for flag-only). Unit tests cover: a fenced heredoc invocation extracted without its body (a body line *starting with* `corpus queue resume` is not extracted), an inline invocation, prose sentences (two), top-level `corpus init ~/notes --port 9062`, compound-line splitting, and normalization of flag-only/topic/undocumented forms.
- **TEST-34** — demonstrated both ways. With `` Run `corpus doc frobnicate doc_a1b2c3` after every batch. `` appended to the real skill body:
  ```
  FAIL … cli command references > resolves every `corpus …` invocation in the whole template tree against docs/cli.md
  AssertionError: claude/skills/orchestrate/SKILL.md: expected [ 'doc frobnicate' ] to deeply equal []
  ```
  After reverting: `Tests 61 passed (61)`.
- **TEST-35** — scope: the check covers **every `.md` file in the whole template tree** (`listTemplateFiles()` filtered to `.md`), not only skill bodies. `assets/workspace/README.md`'s `corpus skill rollback <name>` and `corpus doc check` resolve through the allowlist — stated, not silently narrowed. Allowlist per Adjudication 5: `CLI_COMMANDS_PENDING_CLI_006 = ["doc check", "skill rollback"]` in `scripts/workspace-template.ts`, named and commented; the companion test "expires the allowlist the moment CLI-006 lands in docs/cli.md" asserts each entry is still absent from `docs/cli.md` and names the removal action in its failure message; a second test pins the allowlist to exactly those two entries.
- **TEST-36** — `docs/workspace-template.md` gained "Verified against the CLI reference": the coupling, the regeneration command `npm run docs:cli -w apps/cli`, the fix direction, and the self-invalidating allowlist.

#### Live half (real workspace, real server, real `claude` session)

- **TEST-37** — `corpus init /tmp/corpus-s012-agent002-UYqrmz/ws --port 9062` → "Initialized Corpus workspace … port 9062 … installed 8 template files"; `corpus server start` → "corpus 0.0.0 listening on http://127.0.0.1:9062 (pid 90799)". `corpus queue status --json` → `{"halted":false,"pending":0,…}`; `corpus db rebuild --json` → `{"documents":6,…,"skipped":[]}`; `corpus db doctor --json` → `{"ok":true,"drift":[],…}`. Board: `curl` → HTTP 200 (served UI). **Note**: board verified over HTTP, not in an interactive browser. `corpus doc check` STRUCK per the contract (does not exist until CLI-006); `db rebuild && db doctor` is the substitute, as the contract directs.
- **TEST-38** — created `doc_y3z2zwnv` ("Mortgage options", user-authored) via CLI, then `POST /api/threads` with the bearer token, `x-corpus-author: user`, body `{"parent":"doc_y3z2zwnv","selector":{"exact":"The working rate assumption is 6.0%."},"body":"@agent please update the rate assumption…to 6.4%…","requestsAgent":true}` → 201. Pending event, quoted verbatim from `.corpus/queue/pending/evt_shzavv22x3nk.json`:
  ```json
  { "id": "evt_shzavv22x3nk", "type": "comment.created", "created": "2026-07-29T00:34:08Z",
    "source": "thread",
    "payload": { "threadId": "th_gcsy66im", "parentId": "doc_y3z2zwnv",
                 "turnTs": "2026-07-29T00:34:08Z", "mentions": [], "skills": [], "unresolved": [] },
    "status": "pending", "updated": "2026-07-29T00:34:08Z" }
  ```
  Interface used: `POST /api/threads` (no browser); the §8 pending-indicator UI state was **not** visually observed.
- **TEST-39** — real session: `cd <ws> && PATH=<wrapper-bin>:$PATH claude -p "/orchestrate" --output-format stream-json --verbose --allowedTools "Bash(corpus *)" …`. First loop command from its transcript: `export CORPUS_FROM=agent && corpus queue reap-stale && corpus queue claim-all`. Observed, each: event file `pending/ → in-progress/ → processed/`; job log `.corpus/jobs/evt_shzavv22x3nk.jsonl`:
  ```
  {"ts":"2026-07-29T00:37:01Z","source":"cli","line":"claimed comment.created on th_gcsy66im"}
  {"ts":"2026-07-29T00:37:01Z","source":"cli","line":"routed to the comment skill"}
  {"ts":"2026-07-29T00:37:39Z","source":"cli","line":"edited [[doc_y3z2zwnv]] — updated the rate assumption to 6.4% and adjusted the wording"}
  {"ts":"2026-07-29T00:37:43Z","source":"cli","line":"completed — replied on th_gcsy66im"}
  ```
  agent turn present in `GET /api/threads/th_gcsy66im` (author `agent`, ts `2026-07-29T00:37:40Z`); the loop parked (`ps` showed the wrapper running `corpus queue idle`, invoked as `…job log … && corpus queue complete evt_shzavv22x3nk && corpus queue idle`). The doc's anchor was remapped by the edit (frontmatter `exact:` now carries the 6.4% text). Console-drawer rendering and browser-SSE-without-reload were **not** watched in a browser; SSE `invalidate` frames were captured on the raw stream instead (below). Harness note: the session's first ~2 minutes went to repairing the harness `corpus` wrapper (cwd-dependent `--import tsx`; it rewrote the wrapper to an absolute loader path — an Edit **outside** the workspace); loop behavior after that was uninterrupted.
- **TEST-40** — `git -C <ws> log`: `e2b3576 agent <agent@corpus.local> comment: turn on th_gcsy66im by agent`, `c417c46 agent <agent@corpus.local> doc edit: Mortgage options (doc_y3z2zwnv)…`; thread file turn header `## agent · 2026-07-29T00:37:40Z`.
- **TEST-41** — second user reply posted (CLI, engaged thread) at **00:38:13**; the parked loop's claim: job log `claimed … 00:38:22`, and the event was already in `in-progress/` when polled at **00:38:19** — a ~6–9 s gap (includes CLI process startup), not an ~8-minute rearm. Handled with no operator input; processed at 00:38:34 with reply + doc edit.
- **TEST-42** — halted the queue, posted two `requestsAgent` threads on the **same** parent `doc_f4na522f`, resumed → one `claim-all` batch of two (`evt_73dlujsfhfoj`, `evt_vvgp5zmac7y6`, quoted in the session transcript). Serial in claim order, and the loop *logged the decision*: evt_vvgp…'s job log opens with `"claimed comment.created on th_7ehmoscf; shares doc_f4na522f with evt_73dlujsfhfoj — running serially after it"`. Timestamps show no interleaving (evt_73d…: acted 00:42:31, completed 00:42:32; evt_vvg…: routed 00:42:36, acted 00:42:40, completed 00:42:41). The second saw the first's effects: the doc reads `oats, coffee, apples, bananas, rye bread` and the second reply answers "The staples list now has **5 items**" (counting the first event's bananas). Minor observation: the "claimed" job-log line was emitted twice per event (00:42:13 and 00:42:19) — duplicate logging, harmless.
- **TEST-43** — same shape across two unrelated docs (`doc_vmfaen3i`, `doc_f4na522f`): both claimed in one batch (claims logged 00:43:25/00:43:26; the orchestrator handled both itself back-to-back rather than spawning subagents — permitted, the rule is "may run in parallel"). Afterwards `corpus queue status --json` → `{"halted":false,"pending":0,"inProgress":0,"processed":8,"failed":1,"abandoned":0}`; each event present in exactly one status directory; no double completion.
- **TEST-44** — `corpus queue halt` → `.corpus/HALT` exists (35B); comment posted while halted → `evt_3xj32xeeqn2n.json` stayed in `pending/`; harness-run `corpus queue claim-all` while halted → `{"events":[]}` with `queue status` `{"halted":true,"pending":1,…}`. `corpus queue resume` at **00:39:30** → the session's parked `idle` returned at **00:39:34** (4 s, no session restart), the loop re-ran `reap-stale && claim-all`, event claimed 00:39:36, processed 00:39:48. The loop stayed quiet throughout the halt (no error, no exit — the transcript shows it simply parked).
- **TEST-45** — `corpus lock acquire doc_y3z2zwnv --ttl 600` (default `--from user`) → `{"docId":"doc_y3z2zwnv","holder":"user",…}`; posted "@agent please change the rate assumption to 6.5%". The session attempted `corpus doc edit doc_y3z2zwnv --from agent` (423 → exit 5), then followed the skill's deferral order exactly: reply (`"You're editing [[doc_y3z2zwnv]] right now, so I haven't touched it. I'll change the rate assumption to 6.5% once the document is free — retry the job from the console…"`), `corpus job log … "deferred: doc_y3z2zwnv is locked by user"`, `corpus queue fail evt_cuvekaeqdhw3 --reason "deferred: doc_y3z2zwnv locked by user — retry when the lock clears"` (quoted from the event file's `error` and the job log). Transcript grep for `lock break` → **0 occurrences**. Then `corpus lock release` + `corpus job retry evt_cuvekaeqdhw3` → re-claimed (`"re-claimed after lock cleared; applying the 6.5% change"`), the doc now reads 6.5%, event processed. The lock was held via the CLI (`--from user` default), not the UI editor.
- **TEST-46** — agent-held lock (`CORPUS_FROM=agent corpus lock acquire doc_vmfaen3i`) force-broken with `corpus lock break` → commit trail records it: `086bfd5 user lock: force-break on doc_vmfaen3i (was agent) by user`. Re-enqueue on break: `.corpus/queue/pending/` stayed empty — **the server does not re-enqueue a deferred edit on lock break**. Recorded as a SERVER finding for the next wave (SERVER-030 per Adjudication 6), not worked around in the skill text. (The break was on an explicit agent lock, not mid-edit — implicit edit locks are held only for the duration of the write.)
- **TEST-47** — hand-placed `evt_bogus0001.json` with `"type": "frobnicator.zap"` into `pending/`. The loop failed it via the routing table's plugin row: the event landed in `failed/` with `"error": "no installed skill named frobnicator"`; job log `claimed frobnicator.zap` → `failed: no installed skill named frobnicator`; `corpus job list` shows `evt_bogus0001 failed failed: no installed skill named frobnicator`. Nothing silently completed.
- **TEST-48** — posted "@agent add lemons…", waited for the claim (`evt_yucgcqcvkjh7` in `in-progress/`), then `kill -9` on the recorded session pid (93161). Event stranded in `in-progress/`; an immediate `corpus queue reap-stale` returned `{"reaped":[],"failed":[]}` — the server's staleness threshold is 15 min (`DEFAULT_STALE_AFTER_MS = 900_000` in `apps/server/src/queue/service.ts`), so a just-crashed claim waits out the threshold. After the threshold: reap-stale returned the event to `pending/` and a fresh `/orchestrate` session drove it to `processed/` (evidence in the addendum below).
- **TEST-49** — stated in-thread: "remember this as a standing preference: interest rates written with one decimal place". The session ran `corpus doc create --type note --title "User preferences" --tags preferences --from agent <<'EOF' …EOF` (body records the rule and cites `[[th_gcsy66im]]`); `git log`: `fd35df9 agent doc create: User preferences (doc_b5j6l36v) by agent`; the reply states the change: "I've recorded it in a new document, [[doc_b5j6l36v]] … Changed: [[doc_b5j6l36v]] (created)."
- **TEST-50** — transcript audit of the whole session (stream-json): tool counts `{Bash: 53, Read: 10, Edit: 1, Skill: 1}`; the single Edit targeted `/tmp/corpus-s012-agent002-UYqrmz/bin/corpus` (the harness wrapper, outside the workspace); zero Write/Edit into `data/`, `.corpus/`, `.claude/` and zero shell redirections into them (scripted scan → `suspicious workspace writes: NONE`); `git -C <ws> status --porcelain` → empty (every workspace change was a server auto-commit). Reads: the session used `Read`/`grep` on thread/doc files after discovering the CLI has no read verbs (`corpus thread show` / `corpus doc show` do not exist — it tried both, then fell back to reading files). Reading is not a mutation; the CLI-only invariant (mutations) held without exception.
- **SSE (supporting TEST-39)** — raw stream capture (`curl -N "http://127.0.0.1:9062/events?token=…"`) during a CLI mutation:
  ```
  event: invalidate
  data: {"keys":[["docs"],["docs","doc_vmfaen3i"]]}
  ```
  Live-update transport confirmed; in-browser no-reload rendering not watched.
- **TEST-51** — **DEFERRED → CLI-006.** `corpus skill rollback` does not exist yet (Adjudication 5), so the skill's own recovery path cannot be followed verbatim. Substitute evidence: the recovery section names exactly the verb and argument shape CLI-006 ships (`corpus skill rollback <name>`, with `orchestrate`/`comment` as the arguments, halt-first/resume-last ordering, and the `corpus doc archive` → `.claude/skills-archived/` disable path), and the command sits in the tested allowlist that fails the suite the day CLI-006 lands. The break-the-skill/observe/restore live drill was not run in this session — the honest version needs the rollback verb; it belongs with CLI-006's verification.

#### Findings / escalations

1. **The CLI has no read verbs.** The live session tried `corpus thread show` and `corpus doc show` (neither exists) before falling back to reading workspace files directly — legal (the invariant is mutation-only) but unstated. AGENT-003 must state the read path; a `doc show`/`thread show` CLI pair would make the comment skill's context-gathering CLI-native. Escalated to the orchestrator.
2. **No re-enqueue on lock break** (TEST-46): server-side gap, matching Adjudication 6's expectation; SERVER-030 is the filed home.
3. **`reap-stale` threshold is 15 minutes** — correct behavior, but "run it at loop start" recovers a *just*-crashed session's events only after the threshold elapses. Worth a line in CLI/server docs; no skill change.
4. **Duplicate "claimed" job-log lines** when the session logged claims batch-wide and again per event (TEST-42) — cosmetic over-logging.

#### Cleanup

Recorded pids: claude session 93161 (killed during TEST-48), TEST-48 replacement session (killed after completion), server pid 90799 (`corpus server stop`), SSE curls exited via `--max-time`. Final port check over 9060–9064 and 8765: free; 5173/5174 untouched (ssh). Scratch retained at `/tmp/corpus-s012-agent002-UYqrmz` for evaluator re-derivation. `git -C` ran only against the scratch workspace; the worktree's `git status` shows only this issue's intended files.

#### Addendum — TEST-48 completion

After the 15-minute staleness window, `corpus queue reap-stale --json` returned `evt_yucgcqcvkjh7` at **01:01:21** and the event file reappeared in `pending/`. A fresh `claude -p "/orchestrate"` session claimed it at 01:01:55 and drove it to `processed/`:
```
{"ts":"2026-07-29T01:01:55Z","source":"cli","line":"claimed comment.created on th_rr6zql5e"}
{"ts":"2026-07-29T01:01:55Z","source":"cli","line":"routed to the comment skill"}
{"ts":"2026-07-29T01:02:27Z","source":"cli","line":"edited [[doc_f4na522f]] — added lemons to the staples"}
{"ts":"2026-07-29T01:02:30Z","source":"cli","line":"completed — replied on th_rr6zql5e"}
```
The doc reads `Weekly staples: oats, coffee, apples, bananas, lemons, rye bread, oat milk.` and the thread carries the agent reply. Session then killed by recorded pid; final workspace check: `corpus db rebuild && corpus db doctor` clean, `git status` clean, queue `{"pending":0,"inProgress":0,"processed":10,"failed":1,"abandoned":0}` (the 1 failure is the deliberate `evt_bogus0001`).

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier + tsc scoped to touched files; repo-wide gate is the orchestrator's harvest run)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[AGENT-002]` prefix
