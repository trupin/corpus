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
- Blocks: UI-094, SHARED-036 (which becomes an instance of this rule)

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
> - **`resolved`** — **no further action is required**, and it stays exactly as
>   visible as it was. Resolving is a statement about what is left to do, not a
>   way to tidy the board, so a resolved document keeps its place in every list
>   and view already showing it — and that visibility is what makes it reversible
>   in practice, since reopening one happens where you find it rather than after
>   going looking for it. Because nothing further is required of it, a resolved
>   document **stops going stale** (§5): the staleness ramp exists to ask whether
>   something still needs attention, and this document has already answered.
> - **`archived`** — **resolved, and out of sight.** Archiving is not a third,
>   unrelated thing: it is `resolved` plus hidden, so archiving settles a document
>   and puts it away in one act, and **there is no such state as an archived
>   document with work outstanding**. It is excluded by default from lists and
>   views (§11) and remains fully indexed, searchable and valid — archiving says
>   where a document is kept, never what it is worth. It is reversible, and
>   **search is how it is reversed**: the "include archived" chip brings archived
>   documents back alongside everything else, and unarchiving happens from there,
>   returning the document to `resolved` — the state archiving already implied —
>   rather than to `open`.
>
> The three are therefore a **ladder, not two independent axes**, which is why one
> field holds them: `open` is unsettled and visible, `resolved` is settled and
> visible, `archived` is settled and hidden. Nothing is lost by archiving and
> nothing has to be remembered to unarchive.
>
> **Deletion is the one that is not a status.** Deleting says a document is
> garbage: it leaves the files, the projection and every index, is user-only with
> an explicit confirm (§9), and cannot be undone from the app — git is its only
> recovery. Archiving is what "I do not want to see this" means; deletion is
> reserved for what should not have existed.
>
> A type may **derive** which of `open` and `resolved` it is rather than having
> one set — §12's `todo` reads its items — but the meaning of the word it lands
> on never changes with the type. Such a type unarchives to whatever its record
> now says rather than to `resolved`: a todo list unarchived with items still
> open reads `open`, which is the list telling the truth rather than the archive
> being overruled.

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
      without part 1. Still separate from SHARED-036 / SHARED-030.
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
      - §5 staleness ramp — the rider now says resolving stops it. Check §5's
        own text and the Attention "stale-for-review" reason agree, and that
        nothing else promises a resolved document will still be offered "still
        current"
      - §9.1 / §14 — **checked 2026-08-08 and it holds**: deletion purges the
        semantic index (`apps/server/src/projection/semantic-integrity.ts:83`,
        "Deleting a document deletes its chunks in the same statement sequence").
        No issue needed
      - **The unarchive path** — the rider changes where unarchiving lands
        (`resolved`, not `open`). `apps/server/src/docs/update.ts` refuses
        leaving `archived` via `PUT`, so the dedicated unarchive path is the one
        to check; if it currently restores `open`, that is a bug this rider
        creates work for — file it against server
- [ ] SHARED-036's rider is re-based on this one before either is applied

## Technical Design

None — spec text. Implementation is UI-094 plus whatever the §9.1 sweep turns up.

### Edge Cases the text must survive

- **A resolved *thread*** — §6 already collapses it by default. That is a
  rendering rule about conversations, not a visibility rule, and must not be
  read as an exception to "stays exactly as visible as it was".
- **Archiving an `open` document** settles it in the same act, per the ladder.
  Confirm nothing in §5 or §11 describes archiving as leaving status untouched.
- **Unarchiving lands on `resolved`.** Every surface offering Unarchive must say
  so, or the user learns it by surprise — including the bulk path (SHARED-032).
- **A resolved document that would otherwise be stale** no longer climbs the
  ramp. Confirm this does not strand documents that were resolved years ago and
  genuinely do want re-reading — the user accepted that trade deliberately
  (2026-08-08), so record it as a decision rather than re-opening it.

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
- [ ] SHARED-036 re-based on this rider
- [ ] Committed with `[SHARED-031]` prefix
