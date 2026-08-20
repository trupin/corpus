# [UI-126] The composer is overloaded, and one of its controls does nothing

## Domain

ui

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: **SHARED-055** — which decides whether the weight control is live
  for a resident
- Blocks: —
- Related: CONTRACT-067, UI-108 (which added the recipient picker)

## Spec References

- SPEC.md **§11** — the composer, its key contract, the recipient statement, and
  the weight control
- SPEC.md **§7** — the resident rider

## Summary

Requested by the user, 2026-08-19: *"The comment component is overloaded. I want
to be able to pick an agent (designated or standalone) by using a drop down. Same
for weight. Find ways to make it lighter."*

Every composer renders `WeightPicker` and `RecipientPicker` inline, side by side
(`apps/ui/src/compose/ComposeOverlay.tsx:247-248`), on top of the text area and
its submit controls. Two pickers, both always present, both always expanded.

## The second half, which is worse than crowding

The user also found this, and it is the reason this issue is P0 rather than a
polish item:

> Right now I can select a designated agent which uses one model and pick a
> different model when posting a comment. Silently, the designated agent uses
> whichever model it is on.

**The weight control is live and inert at the same time.** It is live because
`composerReachesAgent` (`packages/kit/src/weight/composerReach.ts`) answers on
whether sending reaches the agent, and reaching a resident's lane does. It is
inert because a resident is a running session that cannot change its own model —
see SHARED-055, which is the spec contradiction underneath.

So the composer is not merely busy. **One of its two controls silently discards
what a person tells it**, for exactly the recipient the other control was added to
let them choose.

## What to decide

1. **What replaces two inline pickers.** A dropdown each is the user's
   suggestion. Consider also: one control that shows the *outcome* — who answers,
   at what weight — and opens to change either. §11 already requires the composer
   to state who it will reach before sending, and a grep finds that unimplemented
2. **What the weight control shows for a resident.** SHARED-055's draft says it
   goes not-live and **names the resident's weight**, so a person who reached for
   it gets the answer rather than silence. Confirm that reads well before
   building it
3. **How little can be shown by default.** The honest floor is: nothing, until
   the composer would do something non-obvious. A composer in a thread with no
   agent engaged, sending a note, needs neither control
4. **The key contract is untouched.** §11 is explicit and repeated: `↵` inserts a
   newline, `⌘↵` submits, and no control claims a key of its own. Whatever this
   becomes obeys that

## Acceptance Criteria

- [x] The composer is lighter by default — state what a person sees when they
      have chosen nothing, and why that is the right floor
- [x] Recipient and weight are each reachable in one gesture
- [x] **No control is offered whose choice will be discarded.** For a resident
      recipient the weight control is not live and says why, per SHARED-055
- [x] §11's composer key contract is unchanged, and a test pins that
- [x] An IME composition commit still never submits — §11, and it is the kind of
      thing a control rewrite breaks silently
- [x] Every composer follows: global, thread reply, comment popover, comment on a
      turn or a selection, and a plugin's. §11 lists them for a reason

## Technical Design

### Files to Create/Modify

- `packages/kit/src/weight/WeightPicker.tsx`,
  `packages/kit/src/recipient/RecipientPicker.tsx`
- `apps/ui/src/compose/ComposeOverlay.tsx` and every other composer host
- `packages/kit/src/weight/composerReach.ts` — if liveness gains a resident case

### Key Implementation Details

**Read `composerReach.ts`'s docblock before touching liveness.** It records that
the coupling runs one way — *"§8 alone decides what reaches the agent, and
choosing a weight neither asks the agent nor stops it being asked"* — and that
this function is read by the control and never written by it. A resident case
must not become a path between pressing send and a request leaving.

**Read `useComposerRecipient.ts` and `scopeWalk.ts`.** The recipient default is
computed by the same walk the server routes with, and its docblock records what
happened when there were two copies.

### Edge Cases

- A thread whose resident lapsed — the lane is still designated, but the
  orchestrator will answer
- A general resident, with no profile
- A plugin composer that omits `requestsAgent` — `composerReach`'s tri-state
  exists for exactly this
- A composer on a thread that does not exist yet

## Testing Strategy

Component tests per composer host over each recipient state, plus a pin that the
weight control is not live for a resident. Falsify by making it live and watching
that pin alone go red.

The key contract needs an e2e, not a unit test: `↵`, `⌘↵`, and an IME commit.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port **not 8765** and **not 5173**; Vite
   elsewhere
2. Designate a resident; open a composer addressing its lane
3. Confirm the weight control is not live and says why
4. Confirm the same composer addressing the orchestrator does offer it
5. Exercise `↵`, `⌘↵`, `⇧⌘↵` in every composer
6. Stop everything; confirm the ports are free

## E2E Verification Log

**implemented on: fable** — the implementing agent was killed by a session limit after writing the code and its tests, while driving the real UI for screenshots. The orchestrator ran the verification below and wrote it.

**What a person sees by default, and why that is the floor.** The two always-expanded pickers are gone. Every composer now renders one line stating the outcome — who answers, and at what weight — and that line is a button opening a popover holding the recipient rows and, where there is something to weigh, the weight rows. The floor is the line alone, because §11 already requires a composer to say who it will reach before sending, so the sentence is not new furniture — it is the requirement, now carrying the control instead of sitting beside it. A composer whose send would reach nobody says `Nobody is asked` and offers no weight section at all: there is nothing to weigh, and an offered control with nothing behind it is the defect this issue exists to remove.

**The resident rule, in the real browser.** `apps/ui/e2e/resident.spec.ts:427` now designates a general resident, opens the address line, and asserts two things: the popover states `works at the weight chosen at launch`, and it offers **zero** `[data-weight-key]` rows. That is SPEC.md §11's rider signed 2026-08-19, checked where the person's complaint lived rather than only in a unit test.

**Falsified twice.**

1. Unit: disabled the resident branch in `addressWeight` (`if (false && …)`), ran `packages/kit/src/address` alone — `8 failed | 24 passed`. Restored — `32 passed`.
2. Browser: the same break, **after rebuilding `packages/kit`** — `e2e/resident.spec.ts:427` failed, `9 passed`. Restored and rebuilt — `10 passed`.

The second one matters and nearly went unrecorded: the UI imports `@corpus/kit` through its `exports` map into `dist/`, so the first browser run against a broken `src/` passed and looked like proof the assertion was inert. It is not inert; the build step was stale.

**Suites.** `apps/ui/e2e/weight.spec.ts`, `recipient.spec.ts`, `compose-keyboard.spec.ts`, `resident.spec.ts` — 45 specs, all pass, real Chromium. `packages/kit` + `apps/ui/src` unit: 205 files, 4043 tests, all pass. Typecheck clean in both workspaces.

**Ports.** Vite on 5283, stub origin 8893 — never 5173, never 8765. Two orphaned servers left by the killed agent (vite on 5283, a tsx server on 8893) were found with `lsof` and killed before the run.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[UI-126]` prefix
