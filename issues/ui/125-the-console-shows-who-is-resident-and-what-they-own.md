# [UI-125] The console shows who is resident and what they own

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: **CONTRACT-068** — the scope half does not exist to display
- Blocks: —
- Related: UI-109 (the board badge), CONTRACT-067

## Spec References

- SPEC.md **§11** — the board and the console
- SPEC.md **§7** — designation, lanes, scope

## Summary

Requested by the user, 2026-08-19: *"I want to have access to a tab in the
console, which shows me the designated agents as well as what documents / threads
are attached to their scope."*

Today the console holds a job list, a job detail, a log, and an agent pill
(`apps/ui/src/console/`). The board shows who is resident on a thread's own row
(UI-109). **There is no one place that answers "who is running, and on what".**

`corpus agents` answers the first half on the CLI. Nothing answers the second
half anywhere — see CONTRACT-068, which is the reason this issue is blocked
rather than merely unstarted.

## What the tab has to show

- Every designated lane, with its resident: a profile, or a general resident
- What it runs at, once CONTRACT-067 lands
- Whether it is live — §7's presence is a parked scoped `idle`, and UI-109
  already renders that distinction on the board
- **Its scope**: the thread, its subthreads, and the artifacts whose provenance
  walks back to it

## What to decide

1. **A console tab, or a board surface?** The user asked for a console tab. Worth
   confirming against §11's split: the console is the agent's own machinery — jobs
   and logs — and the board is the corpus. A roster of agents is arguably the
   former; their scope is arguably the latter
2. **How much scope to show before it is an enumeration.** §7 forbids the agent
   from sweeping the corpus; a person's view has no such rule, but an unbounded
   list is still a bad surface. Count first, expand on request, is one shape
3. **Is a released or lapsed lane shown?** A lane whose listener lapsed is
   falling back to the orchestrator (§7) and is exactly what someone opening this
   tab wants to see. Showing only healthy lanes would hide the interesting case
4. **Does it offer actions?** Release, and re-designate, are the two a person
   watching this tab will reach for — and SERVER-128 is what makes release
   observable enough to offer here

## Acceptance Criteria

- [ ] One surface lists every designated lane and its resident
- [ ] Each lane shows its scope, or a count with a way to see it, and the listing
      is bounded
- [ ] A lapsed lane is visible and distinguishable from a live one, because that
      is the state a person opens this to find
- [ ] Nothing here re-implements the scope walk — it consumes CONTRACT-068's
      answer. Two implementations of one rule is the defect
      `scripts/mention-offer-parity.test.ts` exists to prevent
- [ ] The empty state is followable: a workspace with no designations says how to
      make one, and does not read as an error

## Technical Design

### Files to Create/Modify

- `apps/ui/src/console/` — the new tab and its model
- `packages/kit/src/recipient/` — reuse `laneRows` rather than restating lane
  vocabulary; it already owns the five states

### Key Implementation Details

**`packages/kit/src/recipient/laneRows.ts` owns the vocabulary for every lane
state**, including `MISSING_PROFILE_CAUSES`, which exists because that claim was
typed ten times and four were false (SHARED-053). Consume it; do not write a
sixth description of a lane.

`apps/ui/src/console/consoleModel.ts` and `useConsoleLayout.ts` are where the
console's existing structure lives. Read both before adding a tab — the split
between job list and log is resizable and has its own open issue (UI-081).

### Edge Cases

- A designation whose profile was renamed, deleted or moved out of the root —
  `docId: null`, and **archiving is not one of those causes** (SHARED-053)
- A general resident, with no profile at all
- A scope containing an archived document
- A workspace with no designations

## Testing Strategy

Component tests over each lane state, plus an e2e against the real app. The
states come from `laneRows`, so the test enumerates that rather than a hand-built
list.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port **not 8765** and **not 5173**; Vite on
   a port that is not 5173
2. Designate two residents, one with a profile and one general
3. Create a subthread and a document written from one of them
4. Open the tab: both lanes listed, scope correct, live state correct
5. Release one; confirm the tab reflects it
6. Stop everything; confirm the ports are free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-125]` prefix
