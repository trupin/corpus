# [SHARED-060] §11 puts the comments switch in the header unconditionally, and the header cannot hold it

## Domain
shared (orchestrator)

## Status
done — **SIGNED by the user 2026-08-21**, option 1 (ratify what shipped), applied
to SPEC.md §11 the same day. The switch arrives with the first conversation and
the ⋯ path is the guarantee. UI-063's recorded deviation is now a recorded
design.

## Priority
P1

## Model
fable

## Dependencies
- Related: UI-063 (which measured it), SHARED-010 (the rider being corrected), SHARED-057 (the geometry rule that forbids the alternatives), UI-135 (which set the head's rules)

## Spec References
- SPEC.md **§11**, Document view — *"A document's comments are also available as a **list**, reached by a Document / Comments switch in the reader's header and present in both column view and full screen."*

## The problem

That sentence reads as unconditional, and UI-063 could not honour it. The
deviation is shipped in v0.16.0 and recorded in three places in the code, but
the spec still says something the product does not do. This rider is the
correction, and it is **not applied** — SPEC.md changes need the user's
signature.

## The measurement, which is the whole argument

A 560px column (534px of content), a document reached from a long-titled parent
so `.back` sits at its own `max-width: 40%` cap. `natural` is what each item
would take if the row had room:

| item | natural | drawn |
| --- | --- | --- |
| `.back` | 214 (its cap) | 206 |
| `.reader-id` | 101 | **85, clipped** |
| `.save-chip` | 120 | **101** |
| `.comments-btn` | 52 | 52 |
| `⋯` | 28 | 28 |
| `⤢` | 22 | 22 |
| gaps | 45 | 45 |
| **total** | **582** | 539 |

```
natural with the toggle      582 of 534  →  deficit 48px
natural without the toggle   521 of 534  →  slack   13px
```

**13px of slack against a control needing 61.** No control of any width fits.
This is not a padding problem and cannot be shaved.

The two items that would pay are exactly the pair UI-135's log records
rejecting: the back label pushed below its own cap, and the document id
truncating on a head where nothing unusual is happening.

**It is one configuration.** The same column with an ordinary back label
(`‹ Inbox`) draws 420 of 534 — **114px of slack** — and both 240px cases pass
with the toggle present.

## Why the obvious escapes are all worse

- **Show the toggle only when it fits.** A control that appears and disappears
  as a column is dragged is the thing SHARED-057 was signed to stop.
- **Truncate the toggle.** UI-135 rejected exactly this for the save chip:
  truncating a control's affordance is not revealing overflow, it is hiding a
  control.
- **Shrink the id, the back cap, or the save-chip reserve.** Any of these makes
  room, and each is somebody else's signed tuning — UI-134's reserved box,
  UI-135's yield order, UI-065's title rule. Spending one of them to buy room
  here is a decision, not an implementation detail.

## The drafted amendment

**Rewritten 2026-08-21 after the pr-reviewer found the first draft described a
rule the code does not implement.** The first draft said the switch appears
"wherever the head has room for it". The shipped condition is **count-based**:
the switch renders when the document has conversations, or whenever the list is
already showing. Those diverge in both directions, and the reviewer named both:

- a comment-less document in a **wide** head — full screen at 1400px, room to
  spare — carries no switch, though a room-based rule says it should;
- the over-full 560px head **with** comments does seat the switch, and pays for
  it by truncating the document id.

So signing the first draft would have left the code contradicting the amended
spec. That is worth stating plainly: the paper was wrong, not the code.

**And the second divergence is not a defect.** A head that truncates its
document id and reveals the whole of it on a `title` is UI-135's rule working as
written — controls never yield, variable text truncates and is revealed. What
UI-135 rejected was the id truncating *on a head where nothing unusual is
happening*. A long parent title, an active save chip and a conversation count
together are not nothing.

**So the real deviation is narrower than the first draft claimed**, and it is
this one thing: **a document with no comments has no switch.**

Replace, in §11's Document view bullet:

> A document's comments are also available as a **list**, reached by a Document
> / Comments switch in the reader's header and present in both column view and
> full screen.

with:

> A document's comments are also available as a **list**, present in both column
> view and full screen. The reader's header carries a **Document / Comments**
> switch **once the document has a conversation to show** — it is the same
> control that opens the comments, in the same place, showing which of the two
> is displayed, and it stays while the list is open so the way back is never
> missing. A document with no comments yet reaches the list from its own ⋯ menu,
> where its actions already live. **The list is never unreachable, and a comment
> can always be started without selecting text** — that is the guarantee; the
> switch is the fast path to it rather than the only one, and the head does not
> spend a control's width on a list with nothing in it.

## What the user is being asked to decide

1. **Ratify as drafted** — the switch arrives with the first conversation, the ⋯
   path is the guarantee. This is what v0.16.0 ships, and the amendment now
   describes it exactly.
2. **Make the switch unconditional anyway**, and buy the room by spending one of
   three tunings someone already signed: a shorter document id (UI-135's yield
   order), a smaller `.back` cap, or a narrower save-chip reserve (UI-134's box).
   Each is a real trade. The measurement says 61px is needed and 13px is
   available in the worst configuration.
3. **Make it room-based** — the first draft's rule, shown above. It is
   defensible and it is *more* work than it looks: a control that appears as a
   window widens and vanishes as it narrows is close to what SHARED-057 was
   signed to stop, so it would need a rule about when it may change.

The orchestrator recommends **1**. The ⋯ path is always present, and a switch
between two views where one of them is empty is chrome without a job.

## Acceptance
Nothing until signed. If signed, the orchestrator applies the text to §11 and
UI-063's recorded deviation becomes a recorded design instead.
