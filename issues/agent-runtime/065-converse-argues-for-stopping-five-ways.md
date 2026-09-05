# [AGENT-065] `converse` argues for stopping five ways and for continuing once

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: **CLI-078** (the next-step line this leans on)
- Blocks: —
- Related: INFRA-039 (the scenario that measures it), AGENT-064, AGENT-066 /
  AGENT-067 (the orchestrate split, same underlying cause)

## Spec References

- SPEC.md **§7** — the agent loop; a resident is present exactly while it holds a
  parked scoped `idle`
- SPEC.md **§8** — agent participation

## Summary

Reported from live use, 2026-09-05: *"subagents keep stopping although the skill
is meant to keep the agent alive."*

CLI-078 carries the mechanism — a Task subagent lives only while it keeps calling
tools, and the last line it reads before deciding is `event evt_x is complete.`
This issue is the other half: **the skill's own text argues for stopping far more
than it argues for continuing.**

`assets/workspace/claude/skills/converse/SKILL.md` documents **five** ways to
stop, each with a paragraph explaining why stopping is correct:

1. *When your context runs heavy* — **"Do not park again."**
2. *Retirement* — a `designationId` that is not yours, so exit.
3. *The loop* — an id your park named coming back held: **"One such id is the
   whole of the evidence. Exit."**
4. *Retirement* — a park refused with `422`.
5. The thread resolved, which releases the resident with it.

Against those five stands one instruction to continue: **"Then repeat from step
1."** Four words, at line 325 of a 1,600-line file.

**Measured**: the file carries 25 stop-signals against 7 continue-signals. Every
one of the five exits is correct in its own case, and every paragraph explaining
them is well argued. The aggregate is a document that has taught the reader,
carefully and at length, that stopping is usually the right answer.

**The softest of the five has no external signal at all.** *When your context runs
heavy* asks the model to assess its own remaining context and stop cleanly. There
is no measurement behind it, nothing refuses it, and it is available on every
single pass. It is the exit an agent will reach for whenever continuing feels
expensive, and its section makes stopping there sound like good citizenship.

## The skill also documents this symptom under the wrong cause

`orchestrate`'s *If the loop breaks* says that a listener which *"exits the moment
it starts and the lane keeps reading not-live with its pending count climbing,
pass after pass"* means a **corrupted `converse` file**, repaired by
`git restore`.

The operator is seeing that symptom with an intact file. So the one recovery
section in the workspace sends them to restore a file that is not broken, and
what they will find is that the restored file behaves the same way. Fix that
paragraph as part of this issue: name the other cause, and name what actually
distinguishes them.

## What to change

Four changes, and the third is the one that matters.

1. **Make the continue instruction outweigh the exits.** *Then repeat from step 1*
   is not a step of the loop, it is a sentence after it. Make continuing **step 8**
   — numbered, in the list, with the same weight the other seven carry — and say
   what it means: the pass ends by starting the next one, and a listener that stops
   parking stops existing.
2. **Cut the five exits to what they need.** Each keeps its rule. None keeps its
   essay. The rules are short: a designation id that is not yours, a `422`, an id
   your park named coming back held. Move the reasoning that earns each one into
   a reference file, per AGENT-067's split rule.
3. **Rewrite *When your context runs heavy*, and make it cost something to
   invoke.** It is the only exit with no external signal, and it must stop reading
   as an always-available option. Two directions, and the implementer decides and
   records which:
   - **Raise the bar in words**: state that a listener stops for this reason only
     when it can name what it has lost — a document it can no longer recall, an
     instruction it has to re-read — and that "this is getting long" is not that.
   - **Require a record**: the exit already asks for a last reply and a written
     handover. Make the *reason* part of that record, so stopping is an act with a
     visible cause rather than a quiet non-continuation.
   Do **not** delete the exit. A degraded listener holding a lane is genuinely
   worse than none, and that argument is sound. What is wrong is its availability,
   not its existence.
4. **Fix `orchestrate`'s *If the loop breaks* paragraph**, per the section above.

## What must not change

- **Every one of the five exits stays.** Each guards a real failure. This issue
  rebalances weight, and it must not become a licence for a listener to hold a
  lane it should have left. A skill that never stops is the opposite defect and it
  is worse: it puts two listeners on one conversation and answers people twice.
- **The `422` retirement path especially.** A park on a released lane must still
  end the listener. CLI-078 deliberately prints no next-step line there.

## Acceptance Criteria

- [ ] Continuing is a numbered step of *The loop*, not a trailing sentence.
- [ ] The stop-to-continue signal ratio is at or below **2:1**, measured the same
      way as above. The issue records both counts, before and after.
- [ ] All five exits still exist, and each still states its rule.
- [ ] *When your context runs heavy* states a bar that "this is getting long" does
      not meet.
- [ ] `orchestrate`'s *If the loop breaks* names both causes of a listener that
      will not stay up, and how an operator tells them apart.
- [ ] `converse/SKILL.md` gets no larger. It should get smaller.
- [ ] `scripts/workspace-template.test.ts` passes, and any wording guard this
      change invalidates is **updated rather than deleted**.

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/converse/SKILL.md`
- `assets/workspace/claude/skills/converse/references/leaving.md` — new. The
  reasoning behind the five exits.
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the recovery paragraph.
- `scripts/workspace-template.test.ts` — the guards.

### Key Implementation Details

**Read CLI-078 before writing this.** The next-step line and step 8 must say the
same thing in the same words. Two wordings for one instruction is the drift this
repository has already paid for more than once.

**This is prose, and prose is not a mechanism.** Nothing here proves an agent will
behave differently. `workspace-template.test.ts` checks wording and can never
check truth — CLAUDE.md says so in as many words about its 404 existing guards.
INFRA-039 is the only thing that will answer whether this worked.

### Edge Cases

- A listener whose context genuinely is exhausted must still be able to stop. Test
  that the rewritten section can be satisfied.
- A resolved thread releases its resident with no event. The retirement path must
  still be reachable through the roster read.

## Testing Strategy

- `workspace-template.test.ts` guards for the new step 8 and for the reference
  file's existence.
- A counting test asserting the ratio criterion, so the balance cannot silently
  drift back. It counts signals and claims nothing about behaviour, and its own
  comment says so.

## E2E Verification Plan

### Verification Steps

1. `corpus init` a scratch workspace and confirm the changed skills install.
2. Run the reproduction from CLI-078 against the real app: designate a resident,
   post two messages several minutes apart, watch `corpus agents`.
3. Record whether one listener answered both.
4. **Then say plainly that one run is not evidence**, and point at INFRA-039.

## E2E Verification Log

_Filled in by the implementing agent. State which model it ran on._

### Post-Implementation Verification

_[Agent fills: both signal counts, the install, the two-message run]_

## Completion Checklist (domain agent)

- [ ] Both signal counts recorded, before and after
- [ ] All five exits verified present
- [ ] `/lint` passes
- [ ] E2E log filled in, and it states what one run proves
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run
- [ ] `/evaluate` passes
- [ ] Committed with `[AGENT-065]` prefix
