# [SHARED-062] A todo list's `due` is its items, and a hand-written date does not survive

## Domain
shared (orchestrator)

## Status
done — **SIGNED by the user 2026-08-22**, applied to SPEC.md §12 the same day

## Priority
P0

## Model
fable

## Dependencies
- Related: SHARED-036 (which signed the same shape for `status`), PLUGINS-018 (which drafted this), SERVER-134

## Spec References
- SPEC.md **§12** — the `todo` doc type
- SPEC.md **§5** — `due:` as an optional deadline, and the Attention view

## Why it was needed rather than merely tidy

PR #55's cold reviewer returned MAJOR on this and the reasoning is worth keeping:
shipping the behaviour without the rider does not "run ahead" of a future
signature, it **contradicts signed text**. §5 says `due` is an *"optional
deadline (ISO date) on ANY type"*, and §10's form clause listed `due` among the
fields a person edits. This release makes `due` nobody's to set on a todo — a
hand-written one does not survive a write.

The status half had cleared the same gate: PLUGINS-016 and SERVER-085 each
carried *"Depends on: SHARED-036 (rider must be signed first)"*. `due` had no
such gate and needed one.

## The signed text

Appended to §12's `todo` bullet, after the status sentence:

> **A todo document's `due` is its items too.** The same reading that gives the
> list its status gives it its deadline: `due` here is **derived**, not set, and
> it is the **earliest open item's** date. A checked item is not late, so it does
> not count. A list with no dated open items has no deadline and is absent from
> Attention rather than due today. Checking the last dated item clears the field
> exactly as checking the last item resolves the list. **A hand-written `due:`
> does not win, because it cannot**: the derived value is written into the
> frontmatter on every server write, so a typed date and a derived one are the
> same bytes one write later — there is nowhere to record which a person meant,
> and "explicit wins" would decay into "last write wins". The field is **not
> editable for this type**, and its control shows the derived value and says
> where it came from, exactly as the status control does. An archived list
> derives nothing, and unarchiving returns it to whatever its items say.

## The call this records, and what it rejected

**Chosen: the derived value wins, and the field is not editable.**

**Rejected: a hand-written `due:` overrides the derivation.** It is the intuitive
answer and it cannot be implemented honestly. The convergence writes the derived
value into frontmatter on every server write, so one write after a person types
a date, their date and a derived one are indistinguishable bytes. Honouring
"explicit" would need somewhere to record that a human typed it — a second field,
or a flag — and without that, "explicit wins" silently becomes "last write wins".
That is drift wearing a rule's clothes, which is the thing SHARED-036 rejected
when it chose derivation over an auto-flipped stored field.

**The cost, stated:** a person who wants a deadline on a todo list that its items
do not imply cannot set one. The honest answer is that they date an item.

## Consequences that had to land with it
- UI-092/UI-093's `due` control must render **locked** with its source, exactly
  as the status control does. PR #55's reviewer found it still editable — a
  CRITICAL — and it is fixed in the same PR.
- `PUT` setting `due` on a derived type refuses rather than answering 200 and
  ignoring the request.

## Acceptance
Signed and applied to SPEC.md §12 on 2026-08-22.
