# [SHARED-060] §11 puts the comments switch in the header unconditionally, and the header cannot hold it

## Domain
shared (orchestrator)

## Status
todo — **DRAFTED, UNSIGNED**, awaiting the user's signature. Nothing is applied to SPEC.md.

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

Replace, in §11's Document view bullet:

> A document's comments are also available as a **list**, reached by a Document
> / Comments switch in the reader's header and present in both column view and
> full screen.

with:

> A document's comments are also available as a **list**, present in both column
> view and full screen. The reader's header carries a **Document / Comments**
> switch wherever the head has room for it — it is the same control that opens
> the comments, in the same place, showing which of the two is displayed. The
> head's geometry comes first (§11's rule that nothing resizes because of what
> it holds): a head that cannot seat the switch without pushing a control out of
> the column or truncating one does not seat it, and the list is reached from
> the document's own ⋯ menu instead, which is always present. **The list is
> never unreachable** — that is the guarantee, and the switch is the fast path
> to it rather than the only one.

## What the user is being asked to decide

1. **Ratify the amendment as drafted** — the switch is best-effort, the ⋯ path
   is the guarantee. This is what v0.16.0 ships.
2. **Or spend one of the three signed tunings** to buy the 61px, and keep §11
   unconditional. Each is a real trade and none is free: a shorter document id
   means truncating it sooner, a smaller `.back` cap means less of the parent's
   title, a narrower save-chip reserve re-opens the question UI-135 measured at
   120px.
3. **Or accept that the head is over-full** and say so plainly, which would make
   this an argument for a second row rather than a smaller control — a much
   larger change and not one this release should make.

The orchestrator recommends **1**. The ⋯ path is a real path, it is always
present, and it costs one gesture in the single configuration where the head is
full. Option 2 spends a decision someone already made, to fix a case that
happens only when a long parent title and an active save chip coincide.

## Acceptance
Nothing until signed. If signed, the orchestrator applies the text to §11 and
UI-063's recorded deviation becomes a recorded design instead.
