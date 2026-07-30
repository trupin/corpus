# [AGENT-005] Orchestrate skill: delegate jobs to subagents by default

## Domain
agent-runtime

## Status
in_progress

## Priority
P1

## Model
fable

## Dependencies
- Depends on: AGENT-002 (orchestrate skill)
- Blocks: —

## Spec References
- SPEC.md §7 — "Orchestrator skill" paragraph, amended and signed off 2026-07-30 (SHARED-004): **delegate everything** (no inline path), bound **10** concurrent subagents, parallelism gated on non-overlapping touched-sets (overlapping work serial, dispatch order), subagent **model scales with task weight** — the concrete tier table (including **Opus 5**) lives in the skill, not the spec. Outcomes recorded only from subagent reports (`agent.done` wake-back, `reap-stale` recovery); all invariants (CLI-only, locks, job-log lines, trace lines) bind subagents.

**Scope note (user clarification 2026-07-30): this is the PRODUCT orchestrator** — the orchestrate skill `corpus init` installs into a user's workspace. It does not change this repo's dev harness, whose ~3-agent machine-load cap stands. Keep the distinction explicit in the skill text.

## Summary
User request (2026-07-29, follow-up phase after PR #11): the product's orchestrator
agent currently works jobs inline, so it can only take tasks from the queue serially —
while it is deep in one task it is closed to new queue events. Change the orchestrate
skill so the default is to **delegate each job to a subagent** and return to parking on
the queue, keeping the orchestrator open to new tasks and enabling concurrent job
processing. Needs design judgment (hence fable): which jobs still warrant inline
handling, how subagent failures surface back into the queue/thread protocol, how the
CLI-only invariant and trace-line emission (AGENT-004) carry into subagents, and
machine-load bounds on concurrent subagents.

## Acceptance Criteria
- [ ] spec-writer amends SPEC.md §7 to describe delegation behavior (WHAT, user-signed-off) before implementation
- [ ] Orchestrate skill delegates queue jobs to subagents by default; the parent promptly resumes queue parking
- [ ] Subagent failures/deferrals surface through the existing job protocol (no silently lost jobs)
- [ ] Trace lines and CLI-only invariant hold inside subagents (transcript-provable, as AGENT-003/004 established)
- [ ] Concurrency bound documented and enforced (machine-load discipline)

## Technical Design

### Files to Create/Modify
- `assets/workspace/claude/skills/orchestrate/SKILL.md` (+ any subagent persona files the design calls for)

### Key Implementation Details
To be refined after the spec amendment; study how the dev harness's own orchestrator/domain-agent split handles reporting and failure escalation — it is the working precedent.

### Edge Cases
- Two subagents mutating the same document (lock contention → deferral protocol).
- Subagent dies mid-job: job must not evaporate.

## Testing Strategy
Live `claude` session drills with retained transcripts (the AGENT-003/004 methodology).

## E2E Verification Plan

### Verification Steps
1. Real workspace, real queue: enqueue two jobs; verify the second is picked up while the first's subagent still runs; verify both complete and trace correctly.

## E2E Verification Log

**implemented on: fable** (this agent, per the issue's Model recommendation). The live
`/orchestrate` drill sessions ran on `claude-opus-5` (stream-json init records); the
subagents they dispatched ran on the tiers noted under TEST-406.

**Change.** `assets/workspace/claude/skills/orchestrate/SKILL.md`, reconciled on top of
AGENT-007's landed text (TEST-471): Purpose + frontmatter description now describe
dispatch; the loop is claim → dispatch → park with settlement at idle returns; Claiming
corrects the "work the whole batch to terminal states" rule to its honest residue (no
second `claim-all` mid-dispatch, with the reason); the Routing table's rows name the skill
the subagent is given; a new **Delegation** section (mechanism = Task/Agent tool in the
background, full context handed over, the model-tier table, invariants across the
boundary, queue-state ownership, the three no-lost-job outcome paths, blocked-subagent
deferral); Concurrency generalizes overlap ("same document(s) — or … touched sets
otherwise conflict"), anchors dispatch order to batch/creation order, spans batches, and
carries the bound **10** with the explicit product-vs-operator-tooling distinction; job
logs gain the **dispatched** moment (subagent, tier, why) and the one-story-one-file rule;
the worked example is the delegated flow. No persona files shipped —
`assets/workspace/claude/agents/` keeps only `.gitkeep`; dispatch targets Claude Code's
generic subagent with the skill named in the prompt, and `@<subagent>` personas remain the
payload-directed variant. Plus `scripts/workspace-template.test.ts` (section count 15,
"delegation" required heading, three new delegation/model/report test blocks; reconciled
over AGENT-006/007's assertions — nothing reverted).

**Open Conflict 1 (shape shipped, as ruled):** delegation ships **without** `agent.done`.
The skill's wake-back prose says reports are read at each `corpus queue idle` return and
"Settlement never depends on any queue event announcing the subagent; the report itself is
the signal." The `agent.done` routing row survives as an honest consumer ("Nothing
produces this event today"). Observed cost, live: evt_o2mtodxh2cmt's subagent finished at
17:13:48 and the event settled at 17:22:03 — the rearm window, exactly the latency the
ruling priced in.

**Adjudication 9 followed:** the delegated-deferral path uses `corpus queue defer` /
automatic re-entry per the shipped product and AGENT-007's text; SPEC §7's residual
`deferred:` parenthetical (`SPEC.md:248` as of contract time) was not followed and not
edited (Open Conflict 2 — a spec-writer working-tree rider now fixes those lines in this
same branch; none of it is this agent's diff).

**Environment.** Scratch `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-agent005-CnYfR3`
(cwd outside the repo), `corpus init --port 9181`, server pid 15145. Three live sessions
(A: pid 15726, `transcript-agent005.stream.json`; B: pid 42174, `…005b…`; C: pid 54289,
`…005c…`), all `claude -p "/orchestrate" --output-format stream-json` with scoped
`--allowedTools`. Four seed notes (winter/grocery/reading/insurance) created as user.

| Test | Result | Evidence |
| ---- | ------ | -------- |
| TEST-387 | PASS | Skill: "**Every claimed event is worked by a subagent.** You never work a job inline — not a one-line answer, not a 'quick' edit, no exception for small work"; routing rows read "A subagent applying the **comment** skill…". Live: every one of the 9 drill events shows a `dispatched to a …-skill subagent (…)` job-log line; transcripts show 9 Task/Agent tool dispatches and zero inline handling. |
| TEST-388 | PASS | Loop block order is claim → dispatch → `corpus queue idle`, with settle lines annotated "on every return"; prose: "You return to `corpus queue idle` **as soon as the batch is dispatched**". The old sentence is replaced by "never call `claim-all` in the middle of dispatching, because a second claim splices new events into an ordering you have already computed. That is the whole rule…". Live (session A): dispatch lines at 17:12:36, first completion 17:13:20 — and the session's own next call after dispatch was `corpus queue idle` (transcript order: dispatch Tasks → idle). |
| TEST-389 | PASS | "bounded to at most **10** concurrent subagents; further events wait their turn in dispatch order. That 10 is **this workspace agent's** bound, set by the product's contract — it is unrelated to any concurrency limit the operator's own tooling enforces elsewhere, and neither number constrains the other." `grep` for a 3-bound → none (template test pins `not.toMatch(/\*\*3\*\*/)`). |
| TEST-390 | PASS | "Two events **overlap** when their work would touch the same document(s) — or when their touched sets otherwise conflict: a folder one event reorganizes while another files into it, a skill one event edits while another applies it…"; serial in dispatch order, anchored to `claim-all` order; the uncomputable-touched-set → touches-everything rule survives verbatim. |
| TEST-391 | PASS | Concrete three-row table: **Haiku** (small/mechanical, prescribed one-document changes), **Sonnet** (standard comment work), **Opus 5** (cross-document restructuring, skill genesis/edits, ambiguity). Decision rule: "Judge weight by three things: how many documents the work touches, whether the request prescribes the change or asks for a decision, and the cost of getting it wrong. In doubt between two tiers, take the stronger." Names live in the skill only; `git diff SPEC.md` from this agent is empty. |
| TEST-392 | PASS | Invariants intro: "These bind every step below — and every subagent you dispatch, without dilution". Delegation restates all four for the prompt: CLI-only (no hand-edits of `data/`/`.corpus/`/`.claude/`, no HTTP), `export CORPUS_FROM=agent` + `--from agent` **inside** the subagent ("a subagent inherits no environment"), lock conduct, job-log lines to the dispatched event id, `↳ ` trace line. |
| TEST-393 | PASS | "**Queue state never crosses the boundary.** A subagent never runs `corpus queue claim-all`, `corpus queue complete`, `corpus queue fail`, or `corpus queue defer`: it **reports** an outcome, and you **record** it." Live: every `queue complete`/`queue defer` call in all three transcripts is a top-level (orchestrator) Bash call; none originates in a subagent. |
| TEST-394 | PASS | "Outcomes come from reports, never from dispatch" + the three concrete paths (verify-then-complete; fail with **the subagent's reason**; no-report → stays `in-progress` → `reap-stale`). Live proof of the third path, unplanned: session B was killed mid-batch by a permission-classifier rejection; its two events sat `in-progress`, session C's opening `reap-stale` returned both at 17:56:28, C **verified the prior run's work** (job log: "verified prior run's work…") before completing — nothing lost, nothing redone blindly. |
| TEST-395 | PASS | Delegation: "**A blocked subagent defers — through you.** … never `corpus queue fail` for a lock"; Locks and deferral gained "When the refusal happened inside a subagent, the sequence is unchanged…". Drilled live under TEST-404. Adjudication 9 note recorded above. |
| TEST-396 | PASS | Job-log moments now claimed / **dispatched** (subagent, tier, why) / acted (from inside the subagent, same event id) / settled; "A delegated job's log is one story in one file… That discipline binds the subagent's lines too." Live: e.g. evt_ehl2ets6wrgb's single `.jsonl` carries the orchestrator's claim+dispatch lines, the subagent's read/edit lines, and the recorded outcome. |
| TEST-397 | PASS | Mechanism stated concretely: "Dispatch through Claude Code's subagent mechanism — the Task (Agent) tool — launched **in the background**, one subagent per event. A subagent inherits nothing, so its prompt carries everything: the event id and type, the payload's ids…, which skill to apply…, and the binding rules below. Its report comes back as the task's final message." Live sessions followed it without inventing anything (9 real Task dispatches). No persona files: none needed by the design; `claude/agents/` unchanged. |
| TEST-398 | PASS | Wake-back prose depends only on `corpus queue idle` returns; "Settlement never depends on any queue event announcing the subagent; the report itself is the signal." The `agent.done` row stays as a consumer and states "Nothing produces this event today". No command in the rewrite is absent from `docs/cli.md` (template suite green). Shape shipped = Open Conflict 1 default, stated above. |
| TEST-399 | PASS | `git diff SPEC.md` contains **no change by this agent**. (The shared working tree carries a spec-writer rider fixing Open Conflict 2's residual sentences plus the §12 redesign — `issues/shared/005-phase5-wave3-spec-pass.md` — authored outside this session; my blast radius is the two skill files, the template test, and the three issue files.) |
| TEST-400 | PASS | `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts` → **96 passed** on the merged three-issue state; `CLI_COMMANDS_PENDING_CLI_006` still `[]`; no allowlist entry; every `corpus …` invocation resolves. |
| TEST-401 | PASS | Two events on disjoint docs staged under halt, resumed 17:12; **both dispatched at 17:12:36 before either completed** (first completion 17:13:20). Mid-flight `corpus job list --json` (17:12:50) pasted in the drill record: two `in-progress` jobs, each `lastLine: "dispatched to a comment-skill subagent (Haiku — one document, prescribed change)"`. Both replies posted (trace-lined), both events `processed`. |
| TEST-402 | PASS | Transcript A: after the two dispatches the orchestrator's next call was `corpus queue idle` (no sleep, no polling loop). Third event posted **17:13:03** while both ran (processed=0): claimed by **17:13:09** and dispatched 17:13:12 — before the first two finished (they completed 17:13:20/17:13:57). The queue stayed open; timestamps above. |
| TEST-403 | PASS | Overlapping pair on one parent, drilled twice. Run 1 (17:22): serialization held — job log `"held — overlaps evt_ggx3sae5akg6 on [[doc_fk2w2v7k]]; runs after it settles"`, second dispatched only after the first settled, and its subagent **reconciled** the other's edit ("added auto policy line, updated count 1 to 2") — but the session chose its own order within the batch, exposing an ambiguity in my first wording. Fixed in the same session: dispatch order is now anchored ("dispatch order is the order `claim-all` printed the events… never reorder an overlapping pair"). Run 2 (17:40/17:56, sessions B/C on the corrected text): first-posted dispatched first, second explicitly `"queued behind evt_mfhjwwjpyknk — both touch [[doc_lamjjwbx]]"`, dispatched only after the first's outcome was recorded (17:56:46), and its reply — "2" — reflects the first's edit. No concurrent edits, no lock contention between the agent's own subagents at any point. |
| TEST-404 | PASS | User lock on `doc_e6esh4rx` (ttl 900), event enqueued 18:05:46. Subagent hit the refusal, logged `"waiting on [[doc_e6esh4rx]] — the user holds its edit lock"`, replied to the thread (18:06:31, honest wording, no user chore), ran **no queue verb**; the orchestrator called `corpus queue defer evt_ehl2ets6wrgb --blocked-on doc_e6esh4rx` (top-level transcript call) → `deferred 1, failed 0`, `blockedOn: doc_e6esh4rx`. `corpus lock release` 18:14:50 → event re-entered by itself, re-claimed and edited 18:15:35-40 (~45 s after release, no operator action, no `job retry`), completed; final `processed 8, failed 0`. |
| TEST-405 | PASS | In the scratch workspace: `git log --format='%an %s'` — every mutation a server auto-commit with correct authorship (`agent` for all subagent work, `user` for seeds/threads); `git status --porcelain` shows only my harness `cp` of the corrected SKILL.md (disclosed; not an agent hand-edit — transcripts show zero Write/Edit tools in all three sessions); all job-log progress lines under the dispatching event ids; every writing agent turn trace-lined (7 `↳ ` lines pasted); `corpus db doctor` → `{"ok":true,"drift":[]}`. |
| TEST-406 | PASS | Implementing agent: **fable** (this log). Drill sessions: `claude-opus-5`. Subagent tiers actually chosen, from the Task tool inputs: `haiku` ×7 (all prescribed one-document changes — matches the table's small/mechanical row, rationale logged in each dispatch line), `sonnet` ×2 (the count-and-summarize and add-and-reconcile tasks — matches the standard row). No drill task was heavy enough for the Opus 5 row, so it went unused — consistent with the table rather than contradicting it. The dispatch log lines name tier + reason every time, so the guidance is demonstrably executable. |

Cleanup: sessions A/B/C stopped by recorded pids (15726, 42174, 54289); server stopped
(pid 15145); `lsof` 9180-9182 and 8765 → nothing bound; 8765 never bound/killed/proxied;
`/Users/theophanerupin/code/corpus/.corpus` absent. Scratch retained with all three
transcripts, job logs, and the workspace for the evaluator.

## Completion Checklist (domain agent)
- [x] Tests written and passing (template suite 96/96 on the merged three-issue state)
- [x] `/lint` passes (prettier + eslint on the touched test file; skills are markdown)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified (spec-writer criterion: §7 was amended and signed via SHARED-004 before this implementation — already satisfied at contract time)

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[ISSUE-ID]` prefix
