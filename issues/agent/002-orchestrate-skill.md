# [AGENT-002] Orchestrate skill: the agent's main loop

## Domain

agent

## Status

todo

## Priority

P0

## Model

fable — the skill text IS the product agent's judgment; prompt design quality determines system behavior.

## Dependencies

- Depends on: CLI-004, AGENT-001
- Blocks: AGENT-003

## Spec References

- SPEC.md §7 (event queue and agent loop) — queue contract and event types, CLI queue verbs, **orchestrator skill**, document locks, job logs, HALT, agent stewardship, skills-as-documents including loop safety (`corpus skill rollback`)
- SPEC.md §8 (agent participation semantics) — structured `mentions`/`skills` in the event payload, the honest pending indicator the loop must not leave hanging
- SPEC.md §10.2 (plugin agent skills) — plugin event types `<plugin>.*` route to plugin skills by convention
- SPEC.md §15 M4 — the executable check this skill must satisfy end to end
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
2. Create an agent-requested thread on a real document through the real interface (UI comment with `@agent`, or `corpus thread create` with the agent flag) → confirm a `comment.created` event lands in `.corpus/queue/pending/` and the UI shows the pending indicator.
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

Record exact commands and observed output for each step; §15 M4's check is the bar.

## E2E Verification Log

### Reproduction (bugs only)

_[Agent fills]_

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output, confirmation feature works]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[AGENT-002]` prefix
