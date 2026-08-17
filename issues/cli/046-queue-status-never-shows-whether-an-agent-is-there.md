# [CLI-046] `corpus queue status` never shows whether an agent is there

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-112 (which made the field carry a real answer)
- Related: CONTRACT-045 (which added it), UI-098 (the same omission in the
  console), CLI-043 (which found it)

## Spec References

- SPEC.md **§7** — presence is the parked request
- SPEC.md **§11** — the agent pill's four states

## Summary

`QueueStatus` carries `agent` — required since CONTRACT-045, and filled with a
real tracker's answer since SERVER-112. `corpus queue status` renders none of
it: the human output omits it entirely, and the `--json` example in the help
omits the field the route actually returns.

Found by CLI-043 while building the lane verbs, and deliberately not folded into
that issue.

**Why P1 rather than a nicety.** `corpus queue status` is what an agent or an
operator runs to answer "why is nothing happening". The queue depth alone cannot
distinguish *nobody has picked this up yet* from *nobody is there to pick it up*
— which are the two explanations, and they call for opposite responses. This is
the same defect UI-097 fixed in the thread indicator and UI-098 is fixing in the
console, in the one surface an agent reads.

A `--json` example that omits a field the route returns is its own small
problem: it is documentation that will be copied.

## Acceptance Criteria

- [ ] Human output states whether an agent is present, and since when
- [ ] It distinguishes **unknown** from **absent** — a status that has not
      answered must not render as "no agent", which is the trap UI-097 named and
      ui-dev's Domain Knowledge now records
- [ ] The `--json` example matches what the route actually returns
- [ ] It does not restate `AGENT_PRESENCE_WINDOW_SECONDS`; if the output
      mentions the window it reads the contract's constant, as CLI-043's lapse
      note does
- [ ] If the output shows both `QueueStatus.agent` and anything from
      `corpus agents`, they are not presented as one fact — CONTRACT-053 records
      that the two can legitimately disagree for one grace window

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/queue/status.ts` and its test
- `docs/cli.md` (regenerated)

### Notes

`apps/cli/src/commands/age.ts` (added by CLI-043) already formats an age; reuse
it rather than spelling a second one.

## Testing Strategy

Unit on the rendering, including the unknown case. No E2E drill is warranted for
a formatting change if the field's plumbing is already covered by SERVER-112's —
say so rather than inventing one.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-046]` prefix
