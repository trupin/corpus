# [AGENT-025] The converse skill — a resident's own loop

## Domain
agent-runtime

## Status
todo

## Priority
P0

## Model
fable

## Dependencies
- Depends on: [SHARED-043], [CLI-044], [CLI-043]
- Blocks: [AGENT-026]

## Spec References
- SPEC.md §7 as amended by SHARED-043 — the resident's loop, one consumer per lane

## Summary
Author the **converse** skill: the loop a resident subagent runs for the lifetime of its
designation. It is orchestrate's sibling, not its child — same invariants where they apply
(CLI-only mutation, attribution, archive-never-delete, retrieval discipline, keys,
patches), but its own doctrine where they deliberately differ: a resident **works inline**
(the conversation *is* the work; delegation is the exception for heavy side-tasks), and a
resident **settles its own lane** (claim → work → settle → park, all first-person — the
rule "queue state never crosses the subagent boundary" is orchestrate's, scoped to the
orchestrator's lane by SHARED-043). The skill is what makes the feature feel synchronous:
warm context, no dispatch hop, reply then settle then re-park.

## Acceptance Criteria
- [ ] New skill document at `assets/workspace/claude/skills/converse/SKILL.md`, installed by the workspace template (`scripts/workspace-template.ts` + test), frontmatter matching the existing skills' shape (id `doc_skillconverse`, `type: skill`, `tags: [core]`, `evergreen: true`)
- [ ] Invocation contract stated: launched with the designated thread id as parameter (`/converse th_…`); first acts: `export CORPUS_FROM=agent`, `corpus agents` to confirm the lane exists and no other listener is live (one consumer per lane binds the resident too), `corpus thread context` + `thread show` to hydrate
- [ ] The loop: `corpus queue claim-all --thread th_x` → work each event inline in claim order → `corpus job log` progress lines → reply (`--model` naming what ran, trace line when documents changed) → settle first-person (`complete`/`fail`/`defer` with the same discipline orchestrate states) → `corpus queue idle --thread th_x` → repeat; `export CORPUS_JOB=<evt>` per event so every write is provenance-stamped, unset/reset between events
- [ ] Persona binding: the designation's agent-def document is read at start and bound as the resident's persona; a gone/archived persona → work anyway, state the deviation in replies (mention doctrine, unchanged)
- [ ] Summoned work spelled out: an event whose origin is outside the scope (recipient override) is worked with the resident's context but **replied where it was asked**; the resident never adopts the foreign thread into its scope
- [ ] Retirement: a scoped claim/park returning against a dissolved lane (`corpus agents` no longer lists it, or idle returns with the lane gone) → finish held work, settle, post a one-line sign-off on the root thread, exit — never re-park on a dead lane
- [ ] Context growth: the skill states the rehydration doctrine — the thread and its artifacts are the memory; when context runs heavy, finish and settle held events, then exit cleanly; relaunch (AGENT-026's lapse pickup or the operator) rehydrates from `thread show` + scope artifacts; no transcript handoff, per §7's briefing rule
- [ ] Weight/model rules restated for first-person work: a stated `weight` on an event binds the resident's own choice of what to launch for a delegated stage; forms, fences, and the reply grammar bind by reference to the comment skill

## Technical Design

### Files to Create/Modify
- `assets/workspace/claude/skills/converse/SKILL.md` — the skill
- `scripts/workspace-template.ts` / `scripts/workspace-template.test.ts` — install + test
- `assets/workspace/README.md` — mention the third core skill

### Key Implementation Details
Write it the way orchestrate and comment are written: invariants first, the loop as a
numbered procedure, refusals with their recoveries, worked examples. Do not duplicate the
comment skill's reply/forms/fence grammar — bind it by reference, the way orchestrate does.
The skill must be explicit about the two doctrinal departures (inline work, first-person
settlement) *and* their boundary: everything else in orchestrate's invariants binds
unchanged, and a resident dispatching a heavy side-task briefs it under the same delegation
rules orchestrate states.

### Edge Cases
- Two listeners on one lane (operator error): the `corpus agents` check at start; if a live listener already holds the lane, say so and exit rather than split the story
- A person editing a scope artifact the resident wants to write: same courtesy as everywhere — reply, `defer --blocked-on <docId>`, re-park; deferral semantics are lane-preserving (SERVER-111)
- `resident.designated` re-fired for a lane that already has this listener (re-designation with the same name): treated as a no-op report, not a second loop

## Testing Strategy
`scripts/workspace-template.test.ts` covers installation; the skill text itself is checked
by the evaluator against SHARED-043's behavioral criteria.

## E2E Verification Plan

### Verification Steps
1. Real workspace, real server, `.claude/agents/researcher.md` present; designate a standalone thread
2. In a Claude Code session, launch a background subagent on `/converse th_x`
3. Post three messages in the thread in quick succession → replies arrive in order, each turn naming its model; `corpus agents` shows the lane live with real summaries between them
4. Create a doc through the conversation → `corpus doc show` proves `origin: th_x`; comment on that doc → the resident (not the orchestrator) answers
5. `corpus thread release th_x` → the resident signs off and exits; a later comment on the thread is answered by the orchestrator path

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work._

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain)
- [ ] Committed with `[AGENT-025]` prefix
