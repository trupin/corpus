# [AGENT-039] A listener is launched at the designation's weight

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-067, SERVER-129, CLI-053, CONTRACT-069
- Blocks: —
- Related: AGENT-038 (the converse half), SERVER-128

## Spec References

- SPEC.md **§7** — *"A resident's weight is set when it is designated, not per message"* (rider signed 2026-08-19)
- SPEC.md **§7** — the weight rider: a stated weight is honoured, never substituted, and a deviation is stated twice

## Summary

SHARED-055 puts a resident's weight on the designation. A resident is a background subagent the **orchestrator** launches on `resident.designated` (`orchestrate/SKILL.md:288`), so the orchestrator is what turns a weight level into a model. Today the launch paragraph says nothing about a model, so a listener runs at whatever the launcher defaults to — chosen by nobody and recorded nowhere.

This issue makes the orchestrate skill:

1. **Launch the listener at the designation's weight.** The payload's `resident.weight` is a key in this skill's own tier table. Resolve it to the table's model and launch the listener at that model. `null` means *you decide* — exactly as a message stating no weight does — and the second pass applies: a conversation is a long-lived thing, so say what you picked in the job log.
2. **A relaunch from the roster carries the weight too.** `corpus agents` prints it (CLI-053), and the roster-launch paragraph (`:346`) must say the weight is read from the row while the resident still is not — a weight key is a token, not a rendering of who is resident, so reading it is not the invention that paragraph forbids.
3. **A weight it cannot meet is reported twice**, as §7's weight rider says: in the event's job log, and — since a listener has no reply of its own — by telling the listener in its launch prompt what was asked and what it runs at, so the converse skill can say so in its first reply (AGENT-038 owns that sentence).
4. **Handle `resident.released`** (CONTRACT-069, SERVER-128): the routing table gains a row. It is not a job either — log who left and why (the payload's `reason`), complete the event, and launch nothing. A lane without a resident is the fallback's, which the skill already handles.
5. **A re-designation that changes only the weight** arrives as a `resident.designated` for a lane that may still have a live listener. Today *"a lane that already has a listener gets nothing"*. That rule has to grow one clause: when the payload's weight differs from what the live listener was launched at, the old listener is stood down and a new one launched — or the change is logged as pending until the old one parks. **Pick the simpler reading and state it**: the listener re-reads its designation at the top of each pass (converse), so the cheapest correct behaviour is to let the running listener finish its current turn and exit on its own when it finds its weight changed, and the orchestrator relaunches from the roster on the following pass. AGENT-038 adds that exit to the converse skill.

## Acceptance Criteria

- [ ] The launch paragraph resolves `resident.weight` through the tier table and launches at that model; `null` is *you decide*, logged
- [ ] The roster-launch paragraph reads the weight from the row and still invents no resident
- [ ] A weight that cannot be met is logged and handed to the listener in words
- [ ] `resident.released` has a routing row, and the worked example shows one
- [ ] The "already has a listener" rule states what a weight change does, in one reading
- [ ] `scripts/workspace-template.test.ts` pins each: the table lookup sentence, the released row, and the roster-weight clause, each falsified individually
- [ ] Every transcript in the skill touched here is re-derived by running the command (AGENT-036)
- [ ] No claim about another component's internal refusals is added

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — `:278` routing table, `:288-351` launch paragraphs, `:442-521` weight section
- `scripts/workspace-template.test.ts`

### Key Implementation Details

Read `:288-351` whole before editing. The launch paragraph and the roster paragraph are one account in two halves, and AGENT-036 recorded what happened when a transcript line drifted from the CLI's real output. Re-derive the `corpus agents` line with the real CLI after CLI-053 lands.

## Testing Strategy

Pins in `scripts/workspace-template.test.ts`, falsified one at a time.

## E2E Verification Plan

### Verification Steps

1. `npm test -- scripts/workspace-template` green
2. Revert one pinned sentence; the one test goes red; restore

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-039]` prefix
