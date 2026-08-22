# [SHARED-061] A surface is as large as its place allows

## Domain
shared (orchestrator)

## Status
done — **SIGNED by the user 2026-08-21**, applied to SPEC.md §10 the same day.

**The route here is worth keeping, because it is the one that nearly went
wrong.** The orchestrator applied this text once already, on the strength of
*"Do an audit for these kinds of issues around element size and fix them."* PR
#54's cold reviewer returned MAJOR: those words authorize an audit and fixes,
they do not mention SPEC.md, and this paragraph adds four normative rules. The
edit was reverted. The user was then shown the drafted text in full, alongside
what it would cost not to sign it, and signed it.

The rule is identical either way. What changed is that it is the user's rule
rather than the orchestrator's, which is the whole point of the constraint.

UI-142's audit and its fixes shipped ahead of the signature and never depended
on it.

## Priority
P0

## Model
fable

## Dependencies
- Depends on: —
- Blocks: UI-142 (the audit)
- Related: SHARED-057 (the rule this completes), UI-128 (its audit), UI-130 (which gave the address popover the ceiling now in question), UI-136

## The report

2026-08-21, with a screenshot of the composer's address popover:

> *"The size of this window is so small I can't even see what's in it… Do an
> audit for these kinds of issues around element size and fix them."*

The card shows a two-line lane list under a `2 lanes · scroll for the rest`
note, in a box roughly 240px wide, with the rest of a conversation crammed
beneath it. Everything in it is legible only by scrolling a box smaller than the
room around it.

## The diagnosis, and it is uncomfortable

**v0.15.0 caused some of this.** SHARED-057 said a component's size is a
property of its place and never of its text, and that text which does not fit is
*revealed rather than accommodated*. UI-128 audited against that rule and fixed
ten surfaces — all of them in the **growing** direction.

Neither the rule nor the audit said anything about a box being too *small*. Put
the two halves together and the result is predictable in hindsight: **a fixed
box whose overflow is revealed into itself.** Reveal-not-accommodate plus a
pixel ceiling is a scrollbar in a small window.

The reported surface says it outright. `packages/kit/src/address/address.css`:

```
min-width: 240px;
max-width: min(330px, 86vw);
--address-pop-cap: 280px;
```

`330px` and `280px` are constants. They do not consult the column, the composer
or the viewport. On a wide screen with room to spare the card is the same size
it is on a narrow one, and the lane list gives, because a comment in that file
says *"Every section keeps its size; the lane list's is the one that gives."*
That was a reasonable local decision under a rule that only pointed one way.

## What the rule now says

Applied to §10, immediately after SHARED-057's text:

> **And a surface is as large as its place allows.** The rule above is a ceiling
> on what content may do to a box; it is not a licence to draw the box small. A
> surface bounded well below the room it has — a popover a third the width of
> the column it opens over, a list showing two of its rows with the rest behind
> a scrollbar while the window is half empty — fails the reader in the other
> direction, and pairs with the reveal rule to produce the worst result of all:
> a fixed small box whose overflow is revealed into itself. **A bound is derived
> from the room, not chosen as a number.** Where a surface must be bounded it is
> bounded against what is actually available — the viewport, the host column,
> the space between the anchor and the edge — so that a larger window makes it
> larger, and a pixel constant that was measured once on one screen is not a
> bound. **Scrolling is for content that cannot fit, never for content that was
> not given room.** A surface whose ordinary content needs a scrollbar at a
> comfortable window size is under-sized, and the fix is the size rather than
> the scrollbar. Where a floor and a ceiling meet — a box that cannot be given
> the room its content needs — the surface says so, in the terms §10 already
> uses for a listing that reached its bound. _(Rider authorized 2026-08-21.)_

## The calls, and what they rejected

**1. A completion of SHARED-057, not a new rule beside it.** Rejected: a
separate "minimum size" rule. Two rules about how big a box is, written apart,
would be read apart — and the whole defect is that someone applied one half
without the other. It is one paragraph, and the second sentence names the pair.

**2. "Derived from the room" rather than a minimum-size table.** Rejected:
per-surface floors (`the address card is at least 420px`). A floor is another
constant measured on one screen, which is the same mistake one number larger. A
bound expressed against the viewport or the host adapts by construction, and it
is checkable — a reviewer can ask *"what room does this consult?"* and get an
answer, where *"is 420 enough?"* is taste.

**3. It does not license growth.** The two halves have to hold at once: a
surface takes the room its **place** offers, and still does not resize because
of what it **holds**. A card that grows as its lane list fills would break
SHARED-057 and re-introduce the oscillation v0.15.0 was named for. The room is
the input; the content is not.

**4. The unsatisfiable case gets a sentence rather than silence.** Where a
surface genuinely cannot be given the room it needs, it says so. That is the
same stated-cap principle §10 already applies to a listing that hit its bound,
and it is the honest end of the rule — some boxes really are too small, and a
person should learn that from the surface rather than from a scrollbar.

## Why the rule was written before the audit

Deliberately, and for the reason SHARED-057 recorded: an audit without a rule
produces one reviewer's taste, and an audit with one produces findings anybody
can check against a paragraph. UI-128 was the model and it worked — it produced
findings against the orchestrator three times.

## Acceptance
Signed and applied to SPEC.md §10 on 2026-08-21. UI-142's fixes shipped ahead of
it and did not depend on it; the signature makes the rule they were built against
normative, so the next audit enforces something the user agreed to.
