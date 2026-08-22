# [UI-125] The console shows who is resident and what they own

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: **CONTRACT-068** — the scope half does not exist to display
- Blocks: —
- Related: UI-109 (the board badge), CONTRACT-067

## Spec References

- SPEC.md **§10** — the board and the console
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
   confirming against §10's split: the console is the agent's own machinery — jobs
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

- [x] One surface lists every designated lane and its resident
- [x] Each lane shows its scope, or a count with a way to see it, and the listing
      is bounded
- [x] A lapsed lane is visible and distinguishable from a live one, because that
      is the state a person opens this to find
- [x] Nothing here re-implements the scope walk — it consumes CONTRACT-068's
      answer. Two implementations of one rule is the defect
      `scripts/mention-offer-parity.test.ts` exists to prevent
- [x] The empty state is followable: a workspace with no designations says how to
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

**implemented on: opus** — the implementing agent was killed by an expired login after writing the tab and its unit tests, before typechecking, before any browser run, and before this log. The orchestrator finished the issue: fixed what did not compile, wrote the browser spec the acceptance criteria asked for, falsified it, and wrote this.

**What shipped.** A second console tab, *Residents*, master-detail like the jobs tab it sits beside. The lane list names each lane's resident — a profile, or the conversation a general resident owns — with the weight it works at and whether it is live. Selecting a lane fetches **that lane's** scope and lists it, one line per member, each carrying how it got in (`self`, `parent`, `origin`). A truncated page says so rather than ending silently. The orchestrator's lane has no scope and says what it holds instead.

**Two defects found while finishing it, one real and one not:**

1. **Not real.** `Residents.test.tsx` asserted the weight *label* (`Heavy or judgment-laden`) after waiting only for the resident's *name*. The label arrives on a second round trip — the roster names the key `heavy`, and the workspace's own orchestrate skill is what turns it into words — so the assertion fired mid-load, on `weightLabel`'s documented key fallback. The wait now waits for the label. The product was correct.
2. **Real, and compile-breaking.** The test's `BoardNavigation` stub declared `reveal` and `focusColumn`, neither of which exists on that interface (it has `open` and `revealColumn`). `apps/ui` did not typecheck. Fixed.

Two new kit exports (`useThreadScope`, `threadScopeKey`) were also missing from the plugin surface list that `packages/kit/src/index.test.ts` pins, so that test was red. Declared.

**Browser verification** — `apps/ui/e2e/residents-tab.spec.ts`, new, real Chromium on Vite 5283:

- The drawer opens, the *Residents* tab is pressed, and **two** lanes list: the orchestrator's and the designated one.
- The designated lane reads `researcher` and `data-lane-liveness="live"`.
- **Nothing is fetched for a lane nobody selected** — the spec asserts zero `GET /api/threads/th_solo/scope` calls before the click. §7 forbids sweeping, and one request per lane on mount is what that would look like from here. This is the property jsdom cannot tell apart from an eager fetch, which is why it is the browser's to check.
- After the click, the scope renders: the conversation itself `via: "self"`, its subthread `via: "parent"`, and an undesignated conversation in the same workspace **absent**.

The e2e stub gained `GET /api/threads/{id}/scope`, derived from the store the board already reads rather than seeded, so the answer follows from what the spec actually created.

**Falsified**: pinned `data-scope-via` to the constant `"self"` in `LaneScope.tsx` — the spec failed. Restored — it passed. (The `@corpus/kit` `dist/` trap from UI-126 does not apply here: the broken file is `apps/ui`'s own, which Vite serves from source.)

**Suites**: `packages/kit` + `apps/ui/src` unit — 208 files, 4483 tests, all pass. `apps/ui` and `packages/kit` typecheck clean. Ports 5283/8893 — never 5173, never 8765, and both freed after the run.

**A lane whose resident lapsed** renders as `lapsed` in the list, and its scope still lists — the designation stands whether or not a listener is holding a park, which is §7's distinction between a lapse and a release.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[UI-125]` prefix
