# [UI-186] The Residents tab says "weight set at launch" and never what it launched at, and cannot change it

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: `AGENT-059` (the launch now records the weight it went out at, so
  there is something true to show)
- Related: `AGENT-063` (a judged pick is safe because this makes it correctable),
  `SHARED-076` (the §7 rider that permits the change), `UI-185`

## Spec References

- SPEC.md **§7** — *"A dispatch says what weight it went out at, and where that
  weight came from"*
- SPEC.md **§7** — the resident rider signed 2026-08-19, as amended by
  `SHARED-076`
- SPEC.md **§10** — the console

## Summary

**User directive, 2026-09-02:** *"maybe we make it possible to change a
resident's model from the residents tab. That would make the mistake less of a
problem."*

The console's Residents tab (`apps/ui/src/console/Residents.tsx`,
`residentsModel.ts`) lists every lane, its resident, liveness and scope. It is
**read-only**, and its weight column has a hole.

**It prints "weight set at launch" and stops.** `laneWeightLabel` returns
`LAUNCH_WEIGHT_CLAUSE` whenever `row.weight` is `null` — a designation that
stated no level. That sentence is true and useless: it says *the launcher chose*
without saying **what it chose**. A person looking at a lapsed resident, last
seen three days ago, cannot find out what it ran as.

**That is the same blind spot that started this whole line of work.** The
operator who reported `AGENT-059` found out their conversations were on Sonnet by
asking their agent, because no surface said so. `AGENT-059` fixed the *log*. This
is the surface.

## Acceptance Criteria

- [ ] A lane whose designation stated no weight shows **what the launch actually
      went out at**, not only that the launcher chose. Where the launch recorded
      nothing, it says so plainly rather than guessing — §10's standing rule that
      an unknown says so beats a plausible attribution
- [ ] A lane whose designation **stated** a weight still shows that level, as it
      does now, and the two cases are distinguishable: a level somebody asked for
      is not the same fact as a level the launcher picked
- [ ] The weight can be **changed from this tab**, on a designated lane
- [ ] Changing it uses the re-designation that already exists — the server
      releases the current listener with reason `replaced` and launches a new one
      at the new weight. **No second mechanism.**
- [ ] The levels offered are the workspace's own declared table
      (`useWeightLevels`), including the explicit *"the launcher decides"* member,
      worded as `residentActions.ts` already words it. A workspace declaring no
      levels offers no change control
- [ ] The person is told what changing costs before it happens: the running
      listener is replaced and anything it held that the conversation does not
      record is lost. The conversation itself is not
- [ ] A lane with no resident, and the unscoped orchestrator lane, offer no
      weight control — there is no designation to change

## Technical Design

### Files to Create/Modify

- `apps/ui/src/console/residentsModel.ts` — `laneWeightLabel` and the row model
- `apps/ui/src/console/Residents.tsx` — the control
- `apps/ui/src/console/console.css` — `.lane-weight` is a **fixed reservation**
  (UI-131) and will not grow to hold a longer string; read that comment before
  changing what the column prints
- Possibly `packages/kit/src/address/addressModel.ts` — `LAUNCH_WEIGHT_CLAUSE`
  is shared, so changing its meaning changes other surfaces. Prefer a new
  constant over redefining that one

### Notes

- **Do not invent a weight vocabulary.** SHARED-022 Decision 1: the skill's table
  is the one declaration. `residentActions.ts`'s `weightOptions` is the pattern.
- **Where does the launched model come from?** `AGENT-059` logs it on the
  designation's own event, and §7 makes a job log runtime state reaped with its
  event. So a lapsed three-day-old lane may have no log left. Decide what the
  tab shows then, and say it in the issue log — this is exactly the case the
  screenshot that prompted the issue was showing.

## Testing Strategy

Component tests over the tab: a stated weight, a null weight with a recorded
launch, a null weight with nothing recorded, a lane with no resident. A browser
spec that changes a weight and asserts the re-designation on the wire. Falsify by
removing the weight from the submitted re-designation and watching the wire
assertion fail.

## E2E Verification Log

_Filled by the implementing agent; state the model._

**Pre-fix observation, 2026-09-02 (user screenshot):** the Residents tab showing
four lanes, three reading `weight set at launch`, one resident `lapsed` and
`last seen 3d 09h ago`. What any of them ran as is not on the screen.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
