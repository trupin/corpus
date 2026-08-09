# [SHARED-032] Bulk actions are a mode, are staged per row, and are the only place edit/save survives

## Domain

shared (orchestrator-handled — SPEC.md rider, needs user sign-off)

## Status

todo — **DRAFTED, awaiting sign-off**

## Priority

P1

## Model

fable

## Dependencies

- Depends on: SHARED-030 (which abolishes edit/save everywhere else — this rider
  carves out the single exception, so the two must be read together)
- Blocks: UI-083 (which is still `todo` and must be **rewritten**, not patched)

## Spec References

- SPEC.md §11 — "Selecting rows, and acting on the selection", the rider signed
  2026-08-05 (SHARED-017), which this rider substantially revises
- SPEC.md §11 line 467 — as amended by SHARED-030

## Summary

The bulk-selection rider signed 2026-08-05 designed selection as **"additive,
never a mode"**, with each action applying immediately to the whole selection and
reporting what it could not do. The user has since asked for a different shape
(2026-08-08): a button that **enters** a bulk mode, per-row quick actions that
appear on hover once in it, and a **Save** that applies the accumulated set —
explicitly *"the only time I want the pattern edit/save. For everything else, I
don't want it"*.

Two departures from the signed text, both deliberate:

1. **It is a mode.** The signed rider ruled that out in as many words.
2. **Each row stages its own action.** The signed rider assumed one action
   applied uniformly, which is what justified "an action is offered only when it
   applies to every selected item". Per-row staging dissolves that constraint:
   there is no mismatch to avoid when each row carries its own verb.

**UI-083 has not been implemented** (`issues/PLAN.md` — status `todo`), so this
revises a design rather than reworking shipped behaviour. That is the reason to
settle it now.

## Drafted rider text

Replacing §11's "Selecting rows, and acting on the selection" rider. The
**machinery** below the interaction model — partial application, the three-part
result, what clears a selection, the delete restrictions — is preserved from the
signed text and is not re-litigated here; only the interaction model changes.

> **Selecting rows, and acting on the selection.** A column's list can be put
> into **bulk mode** by a named control in its header, and this is the one place
> in the app where a change is staged and then saved (§11 abolishes that pattern
> everywhere else, and this is its single exception — a bulk change is worth
> reviewing before it happens, precisely because it is many changes at once).
> Outside bulk mode a click opens a row and nothing else, exactly as before.
>
> **In bulk mode each row carries its own staged action.** Rows show a selection
> control, and a row under the pointer or keyboard focus reveals the actions it
> can take — the ones that document already has, and nothing invented for the
> occasion. Choosing one **stages** it against that row: nothing is written, and
> the row shows which action it is carrying. A row may be staged with a different
> action from its neighbour — archiving three documents and resolving two is one
> pass, not two — and re-choosing replaces a row's staged action while choosing
> nothing leaves it untouched. **Because each row carries its own verb, no action
> needs to apply to every selected row**; an action is offered on the rows that
> can take it and simply absent on the rows that cannot.
>
> **Save applies the staged set, and is the only thing that writes.** The control
> says how many rows will change before it is used. Leaving bulk mode without
> saving discards every staged action and says so if anything was staged —
> staged work is never written by walking away from it, and never survives to be
> applied later by surprise. The result is reported exactly as the signed text
> already requires: what changed, what was already in that state, and, listed
> apart from both, what did not change and why, each named individually, staying
> until it is dismissed. After saving, the selection is reduced to the rows that
> did not change, so retrying after clearing a lock is one gesture.
>
> Everything else the 2026-08-05 rider settled stands unchanged: a selection
> lives in one column at a time and is browser-local; select-all and
> select-everything-the-query-matches remain two distinct acts, the second naming
> its number first; **Ask the agent about these** changes none of the selected
> documents; Delete keeps its §9 restrictions and is offered only on an
> enumerated selection; and the list of what clears a selection is unchanged.

## Open questions for the sign-off conversation

1. **Does select-everything-the-query-matches survive per-row staging?** Staging
   an action against 412 rows nobody enumerated has no per-row gesture. Either
   that path keeps a single uniform action, or it goes. The drafted text ducks
   this — it must not ship ducked.
2. **Is bulk mode per column or per board?** The signed text says a selection
   lives in one column at a time; the drafted text inherits that, but a *mode* is
   a stronger thing to scope than a selection.
3. **What does a staged row show when the underlying document changes under it**
   via SSE — someone else archives a row already staged for archiving?

## Acceptance Criteria

- [ ] Read aloud to the user on its own, alongside a plain statement of the two
      departures from the 2026-08-05 text
- [ ] The three open questions above are answered in the sign-off conversation,
      not deferred to the implementing agent
- [ ] User signs off, or amends
- [ ] Applied to SPEC.md §11, replacing the interaction-model half of the
      2026-08-05 rider and preserving its machinery half verbatim; the original
      signature line is annotated as revised, with both dates legible
- [ ] Contradiction sweep recorded here against SHARED-030 (the exception must
      be stated in both places, or a later reader will find them in conflict)
- [ ] **UI-083 is rewritten** against the new text and its PLAN.md row updated
- [ ] CONTRACT-037 (UI-083's dependency) is re-checked — a per-row staged set may
      need a different request shape than a uniform bulk action

## Technical Design

None — spec text. Implementation is a rewritten UI-083.

## Testing Strategy

N/A — spec text.

## E2E Verification Plan

N/A.

## E2E Verification Log

_N/A — spec rider._

## Completion Checklist (orchestrator)

- [ ] Rider read aloud, with its departures named
- [ ] Open questions answered
- [ ] Signed by user
- [ ] Applied to SPEC.md with both signature dates legible
- [ ] UI-083 rewritten; CONTRACT-037 re-checked
- [ ] Committed with `[SHARED-032]` prefix
