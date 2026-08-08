# [SHARED-031] `status` is one vocabulary, not per-type

## Domain

shared (orchestrator-handled — SPEC.md rider, needs user sign-off)

## Status

todo — **DRAFTED, awaiting sign-off**

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Blocks: UI-094, SHARED-029 (which becomes an instance of this rule)

## Spec References

- SPEC.md §5 line 157 — `status: open | resolved | archived (meaning per type;
  threads use it heavily)` — the clause this rider replaces
- SPEC.md §11 — the bulk-selection rider signed 2026-08-05, whose Resolve
  example this rider corrects
- SPEC.md §9 — deletion is user-only, git is its only recovery
- SPEC.md §11 — "include archived" lifts the default exclusion

## Summary

Asked which documents cannot be resolved today, the answer turned out to be
**none**: `DOC_STATUSES` (`packages/contract/src/schemas/doc.ts:26`) is
type-independent, the server gates status writes only on leaving `archived`
(`apps/server/src/docs/update.ts:252`), and the frontmatter form already offers
`resolved` on every document. The only surface that disagrees is the row context
menu, which gates Resolve behind `isThread` (`apps/ui/src/menu/docActions.ts:154`).

So the spec's "meaning per type" hedge is doing no work and is actively
misleading: it invites per-type vocabularies that neither the contract nor the
write path has. The user settled the meaning directly (2026-08-08), and it is
uniform across every type.

## Drafted rider text — part 1 of 2

Replacing §5's parenthetical on the `status` line:

> **The three statuses mean one thing, for every type.** `status` is not
> per-type vocabulary. A document is `open`, `resolved` or `archived`, and each
> word means the same thing whatever the document is.
>
> - **`open`** — the default: something may still be required of it.
> - **`resolved`** — **no further action is required.** It stays exactly as
>   visible as it was. Resolving is a statement about what is left to do, not a
>   way to tidy the board, so a resolved document keeps its place in every list
>   and view already showing it — and that visibility is what makes it
>   reversible in practice, since reopening one happens where you find it rather
>   than after going looking for it.
> - **`archived`** — **out of sight, and still true.** An archived document is
>   excluded by default from lists and views (§11) and remains fully indexed,
>   searchable and valid: archiving says where a document is kept, never what it
>   is worth. It is reversible, and **search is how it is reversed** — the
>   "include archived" chip brings archived documents back alongside everything
>   else, and unarchiving happens from there.
>
> **Deletion is the one that is not a status.** Deleting says a document is
> garbage: it leaves the files, the projection and every index, is user-only with
> an explicit confirm (§9), and cannot be undone from the app — git is its only
> recovery. Archiving is what "I do not want to see this" means; deletion is
> reserved for what should not have existed.
>
> A type may **derive** which of `open` and `resolved` it is rather than having
> one set — §12's `todo` reads its items — but the meaning of the word it lands
> on never changes with the type.

## Drafted rider text — part 2 of 2

Replacing the Resolve clause in §11's bulk-selection rider (signed 2026-08-05).
Current text:

> An action is offered only when it applies to **every** selected item, so a
> selection holding a note and a thread offers no Resolve — nothing is
> half-applied because of a type mismatch.

The **rule** is right and stays; the **example** is wrong, because no such type
mismatch exists. Replacement:

> An action is offered only when it applies to **every** selected item — nothing
> is half-applied because one document could not take it. Resolve is not such a
> case: every type takes the same three statuses (§5), so a selection holding a
> note and a thread offers Resolve like any other. A type whose status is
> **derived** rather than set (§12) is such a case: it offers no Resolve, because
> there is nothing there for anyone to set.

## Acceptance Criteria

- [ ] Both parts read aloud to the user **together but as two quoted blocks** —
      they are one decision expressed in two places, and part 2 is meaningless
      without part 1. Still separate from SHARED-029 / SHARED-030.
- [ ] User signs off, or amends
- [ ] Applied to SPEC.md §5 and §11 with `_(Rider signed YYYY-MM-DD.)_` markers;
      the 2026-08-05 rider's own signature line is preserved and annotated as
      corrected rather than replaced wholesale
- [ ] Contradiction sweep recorded here, specifically:
      - §6 — "a resolved thread is collapsed by default". Collapse is explicitly
        **not** hidden ("Collapsed is never hidden"), so this is consistent —
        confirm and record it rather than assuming
      - §11 Attention — resolving removes a row from Attention. Consistent with
        "no further action required"; confirm
      - §5 staleness ramp — does a resolved document still stale and still offer
        "still current"? The rider does not say, and it should
      - §9.1 / §14 — deletion leaving *every* index, including the semantic index
        (§9.1), is a claim worth checking against what deletion actually does
        today. If it does not, that is a bug this rider surfaces — file it
- [ ] SHARED-029's rider is re-based on this one before either is applied

## Technical Design

None — spec text. Implementation is UI-094 plus whatever the §9.1 sweep turns up.

### Edge Cases the text must survive

- **A resolved document that is also stale.** Two independent axes; the rider
  should not imply resolving silences the staleness ramp.
- **A resolved *thread*** — §6 already collapses it by default. That is a
  rendering rule about conversations, not a visibility rule, and must not be
  read as an exception to "stays exactly as visible as it was".
- **Archived and resolved at once** is not representable — `status` holds one
  value. Archiving a resolved document loses the fact that it was resolved. The
  rider does not address this; decide whether it needs to.

## Testing Strategy

N/A — spec text.

## E2E Verification Plan

N/A.

## E2E Verification Log

_N/A — spec rider._

## Completion Checklist (orchestrator)

- [ ] Both parts read aloud verbatim, separately from the other held riders
- [ ] Signed by user
- [ ] Applied to SPEC.md §5 and §11 with signature markers
- [ ] Contradiction sweep across §6, §9, §9.1, §11, §14 recorded here
- [ ] SHARED-029 re-based on this rider
- [ ] Committed with `[SHARED-031]` prefix
