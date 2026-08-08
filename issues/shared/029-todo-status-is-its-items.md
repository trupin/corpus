# [SHARED-029] A todo list says `open` after its last item is checked

## Domain

shared (orchestrator-handled — SPEC.md rider, needs user sign-off)

## Status

todo — **DRAFTED, awaiting sign-off**

## Priority

P1

## Model

fable

## Dependencies

- Depends on: **SHARED-031** — which defines what `resolved` means for every
  type. This rider must be re-based on it before either is applied: with
  SHARED-031 signed, a completed todo list is not a special rule but the general
  one (`resolved` = no further action required) *computed* instead of set.
- Blocks: PLUGINS-014, SERVER-077, UI-092

## Spec References

- SPEC.md §5 line 157 — core frontmatter `status`, as replaced by SHARED-031
- SPEC.md §12 — "Reference plugin: todos", the `todo` doc type bullet
- SPEC.md §5 — archiving as a reversible `status: archived` flip (line 308)

## Summary

A user checked the only item on a todo document. The stats panel read `0 OPEN /
1 DONE` with a full completion bar, and the status chip beside it still read
`open`. Both are correct under the spec as written, which is the problem: §5
says `status` means whatever the type says it means, and §12 never says what it
means for a `todo`. So nothing derives it, nothing writes it, and a completed
list is indistinguishable from an untouched one on the board, in `GET
/api/docs?status=`, and in every saved view built on a status filter.

This rider closes that gap by making a todo document's status **a reading of its
items rather than a field anyone sets**. The user chose derived-and-read-only
over an auto-flipped stored field (2026-08-08): a stored value that something
else keeps in sync is a value that can drift, and the stats panel next to it
already proves the derivation is cheap and always available.

## Drafted rider text — part 1 of 2

To be appended to §12's **Doc type `todo`** bullet:

> **A todo document's status is its items.** §5's `resolved` — no further action
> required — is a question a todo list can answer for itself, so it does:
> `status` here is *derived*, not set. A list holding at least one item and no
> open items reads `resolved`; every other list reads `open`, including an empty
> one, which has completed nothing. Checking the last item resolves the list and
> unchecking any item reopens it, with no separate act and nothing to keep in
> sync, because this is the same reading of the body that the stats panel already
> shows and the two can therefore never disagree. The field is **not editable for
> this type**: the status control shows the derived value and says it comes from
> the items, which is not an edit mode but a field that was never the person's to
> set (§11). **`archived` is not derived, because it is not a claim about what is
> left to do.** It says where a document is kept (§5), which no checkbox can
> imply, so an archived todo document reads `archived` whatever its items say —
> the derivation chooses between `open` and `resolved` and nothing else, and
> unarchiving returns it to whichever of the two its items say at that moment.
> **The file never disagrees with what is shown**: the derived value is written
> into the document's frontmatter whenever the server writes the document, so
> reading the file, querying the projection and looking at the board all give one
> answer.

## Drafted rider text — part 2 of 2

§12 currently defines the column as "aggregating **open** items across all `todo`
documents". Checking an item there makes it vanish, so the column can be used to
complete work but never to undo it. Replacing the **Column** bullet:

> - **Column**: a "Todos" column type aggregating items across all `todo`
>   documents, built exclusively on `@corpus/kit`. It shows **open items by
>   default** — that is what a list of work to do means — and offers a control
>   that **also shows completed ones**, because a checkbox that can only ever be
>   ticked is half a checkbox: an item checked by mistake must be reachable to
>   uncheck without going to find its document. Completed items are shown as
>   completed and read as a record rather than as work, and the default is
>   unchanged by looking at them.

## Acceptance Criteria

- [ ] Both parts read aloud to the user, as two quoted blocks, **on their own** —
      not batched with SHARED-030 or SHARED-031 (per the standing one-at-a-time
      rule that surfaced the §4/§7 contradiction in SHARED-028)
- [ ] User signs off, or amends the drafted text
- [ ] The signed text is applied to SPEC.md §12 with the `_(Rider signed
      YYYY-MM-DD.)_` marker the section's other riders carry
- [ ] The rider is checked against §5 (archiving), §11 (frontmatter form,
      always-editable rule) and §14 (`doc check`) for contradictions before
      applying — specifically that `doc check` must not report a todo document
      whose stored status is stale as invalid
- [ ] PLAN.md rows for PLUGINS-014 / SERVER-077 / UI-092 reference the signed
      date

## Technical Design

None — this issue produces spec text. Implementation is PLUGINS-014 (the
derivation and where it lives), SERVER-077 (projection and write-back) and
UI-092 (the control renders locked).

### Edge Cases the text must survive

- **Empty list** — zero items. Resolved by the drafted text: `open`, because an
  empty list has completed nothing. Worth confirming with the user; the opposite
  reading (vacuously complete) is defensible and would make every freshly created
  todo document read `resolved` on the board.
- **Archived with open items** — reads `archived`; unarchiving reads `open`.
- **Unreadable items** — a pre-PLUGINS-005 `extra.items` key that will not parse.
  The DocPanel's existing rule is that it renders the `LegacyItemsNotice` and
  **no stats**, because a number over a broken list is a quiet claim about a
  broken state. Status must follow the same rule: derive nothing, fall back to
  the stored value. The rider text does not currently say this — **add it or
  decide it belongs in PLUGINS-014**.
- **A todo document with items that are not the plugin's** — task-list lines
  inside a fenced code block, or in a quoted block. Whatever `readItems` already
  does is the answer; the rider must not imply a second parse.

## Testing Strategy

N/A — spec text. The behavior it describes is tested by the three implementing
issues.

## E2E Verification Plan

N/A.

## E2E Verification Log

_N/A — spec rider._

## Completion Checklist (orchestrator)

- [ ] Rider read aloud one at a time, verbatim
- [ ] Signed by user
- [ ] Applied to SPEC.md with signature marker
- [ ] Contradiction sweep across §5, §11, §14 done and recorded here
- [ ] Committed with `[SHARED-029]` prefix
