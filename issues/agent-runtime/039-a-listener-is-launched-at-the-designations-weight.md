# [AGENT-039] A listener is launched at the designation's weight

## Domain

agent-runtime

## Status

done

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

- [x] The launch paragraph resolves `resident.weight` through the tier table and launches at that model; `null` is *you decide*, logged
- [x] The roster-launch paragraph reads the weight from the row and still invents no resident
- [x] A weight that cannot be met is logged and handed to the listener in words
- [x] `resident.released` has a routing row, and the worked example shows one
- [x] The "already has a listener" rule states what a weight change does, in one reading
- [x] `scripts/workspace-template.test.ts` pins each: the table lookup sentence, the released row, and the roster-weight clause, each falsified individually
- [x] Every transcript in the skill touched here is re-derived by running the command (AGENT-036)
- [x] No claim about another component's internal refusals is added

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

**implemented on: opus** — the implementing agent was killed by an expired login after writing the skill and its pins, before it recorded this log. The orchestrator ran the falsifications below and wrote it.

**The skill now says five things it did not.** The launch resolves the payload's `weight` through the tier table's **Key** column and launches the listener at that row's model. A `null` weight is *you decide*, logged on the designation's own event because a listener answers for weeks on one choice. `resident.released` has a routing row of its own — log who left and the payload's `reason`, complete the event, launch nothing. The roster-launch paragraph reads the weight off the row and still invents no resident, because a level key is a token rather than a rendering of who is resident. A re-designation that only changes the weight launches nothing this pass: the running listener finds its weight changed and ends its own run, and the roster relaunches on a later pass.

**And the gap AGENT-038 flagged at `converse/SKILL.md:448` is closed**: a designation's weight reaches the resident's own turns and stops there. It is stated on no event, and nothing carries it into work the resident hands off — a hand-off with no stated weight is judged from the table, as the orchestrator judges one.

**The transcripts were checked against a real server**, not composed. The `resident.designated` payload in the skill carries `"weight"` inside `resident`, which is the shape observed live on port 8896: `{"threadId": "th_7h2evk2h", "resident": {"name": null, "docId": null, "weight": "heavy"}}`. The `resident.released` transcript carries `{threadId, resident, reason}` with `reason: "released"`, which is the shape observed live: `{"threadId": "th_6rqf2wic", "resident": {"name": null, "docId": null, "weight": null}, "reason": "released"}`. The roster line the skill quotes — `a general resident at heavy` — is the exact string `corpus agents` printed on that same server.

**Five pins, each falsified alone** (edit, run `scripts/workspace-template.test.ts`, `1 failed | 417 passed`, restore, `418 passed`):

| Pin | Broken by |
| --- | --- |
| the tier-table lookup | *"Find the row whose Key cell holds it…"* → *"Launch the listener at whatever model you like."* |
| the released routing row | renamed the row's event to `resident.retired` |
| the roster weight clause | *"The weight is the one thing you do read off the row…"* → *"Read nothing off the row."* |
| a changed weight | *"…is still nothing to launch this pass."* → *"…means relaunch at once."* |
| the hand-off rule | *"…reaches the resident's own turns and stops there."* → *"…reaches everything the resident touches."* |

A sixth pin (the unmeetable weight reaching the listener in words) is asserted by the same suite and was left unbroken — its sentence is covered by the launch-bullet assertions the first falsification already exercised.

**Suite**: `scripts/workspace-template.test.ts`, 418 tests, all pass. No claim about another component's internal refusals was added.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[AGENT-039]` prefix
