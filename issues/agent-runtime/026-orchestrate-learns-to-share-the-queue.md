# [AGENT-026] Orchestrate learns to share the queue

## Domain
agent-runtime

## Status
todo

## Priority
P0

## Model
fable

## Dependencies
- Depends on: [AGENT-025], [CLI-043]
- Blocks: —

## Spec References
- SPEC.md §7 as amended by SHARED-043 — one consumer per lane; the orchestrator's lane

## Summary
Amend the orchestrate skill for a shared queue. Its claim is now the **orchestrator
lane**, not the whole queue: the "only process that claims" language is rewritten to the
per-lane rule, unscoped verbs already mean the orchestrator lane (SERVER-107), and three
new behaviors arrive: route the `resident.designated` event (launch a background subagent
running `/converse th_x` — a long-lived launch, not a job that reports and settles like
comment work); leave live lanes alone; and pick up fallback work from lapsed lanes as
ordinary comment work, with one added courtesy — relaunch the listener.

## Acceptance Criteria
- [ ] `assets/workspace/claude/skills/orchestrate/SKILL.md` routing table gains `resident.designated` → launch a background subagent applying the **converse** skill with the payload's thread id and persona; the event completes when the launch is made (the listener's lifetime is not the job's); a failed launch fails the event with the reason
- [ ] The single-consumer paragraph (SKILL.md:17-27 region) rewritten: one orchestrating session per **orchestrator lane**; residents own their lanes; the console's story is per-lane
- [ ] "Queue state never crosses the boundary" (Delegation) scoped explicitly to the orchestrator's own lane — a resident settling its lane is the design, not a violation
- [ ] Fallback doctrine: an event claimed unscoped that carries a foreign lane stamp (visible in the claim payload per SERVER-107) is worked as ordinary comment work **plus**: log that the lane's listener lapsed, and launch a fresh `/converse` listener for that lane once, not per event
- [ ] Reflection guard extended: the resident's replies are agent turns, so the existing no-self-wake rules (no `--requests-agent`, no `@agent` in bodies) already cover them; state that a resident's `@agent`-quoting hazard lands in the *orchestrator* lane and is triaged there
- [ ] The 10-concurrent-subagents bound restated to exclude resident listeners (they are parked, not working) or adjusted per SHARED-043's decision — whichever the signed rider says, verbatim
- [ ] Skill's `updated` frontmatter bumped; workspace template test still passes

## Technical Design

### Files to Create/Modify
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the amendments
- `scripts/workspace-template.test.ts` — if it asserts on skill content

### Key Implementation Details
Edit surgically — this file is doctrine, and Phase 30's lesson (AGENT-022) applies: the
mechanism works only if the skill text cannot be misread. The launch dispatch line must
state: thread id, the converse skill, the persona from the payload, and that the subagent
is long-lived (the orchestrator never waits on it, never settles for it, and its report —
if one ever comes — is a sign-off, not an outcome to verify). Keep the routing table's
header cells untouched (the composer parses the weight table by them; do not disturb
neighboring parsers).

### Edge Cases
- `resident.designated` for a lane whose listener is already live (re-designation): launch nothing, log why, complete
- Orchestrator restart: designations are frontmatter, listeners are gone — on the first pass, `corpus agents` shows designated-but-lapsed lanes; relaunch each once (this is the recovery path, and it belongs in the loop's opening reap step)

## Testing Strategy
Template test; evaluator runs the behavioral scenarios (designation → listener launched;
lapse → fallback + relaunch; restart recovery).

## E2E Verification Plan

### Verification Steps
1. Real workspace, orchestrator session running `/orchestrate`
2. Designate a standalone thread → within one loop pass a converse listener is live (`corpus agents`)
3. Kill the listener's subagent; post in the thread after the grace window → the orchestrator answers (fallback) and a fresh listener appears
4. Restart the orchestrator session entirely → designated lanes get listeners again on the first pass

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
- [ ] Committed with `[AGENT-026]` prefix
