# [UI-126] The composer is overloaded, and one of its controls does nothing

## Domain

ui

## Status

todo

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

- [ ] The composer is lighter by default — state what a person sees when they
      have chosen nothing, and why that is the right floor
- [ ] Recipient and weight are each reachable in one gesture
- [ ] **No control is offered whose choice will be discarded.** For a resident
      recipient the weight control is not live and says why, per SHARED-055
- [ ] §11's composer key contract is unchanged, and a test pins that
- [ ] An IME composition commit still never submits — §11, and it is the kind of
      thing a control rewrite breaks silently
- [ ] Every composer follows: global, thread reply, comment popover, comment on a
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

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-126]` prefix
