# [PLUGINS-018] A todo item's due date never reaches its document, so Attention cannot see it

## Domain
plugins

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: PLUGINS-005
- Related: SHARED-036 (a todo list's derived status — the same shape, one field over), PLUGINS-016

## Spec References
- SPEC.md **§12** — the todos plugin, and a todo's items as the record
- SPEC.md **§5** — `due:` and the Attention view

## Summary

Reported from live use, 2026-08-21, with a reproduction.

A `type: todo` item carries `(due: YYYY-MM-DD)` as **body text**. Attention reads
the **document's** `due:` frontmatter field. The two never meet.

Tested: an item **18 days overdue** produced `no documents match` on
`--due overdue`, on `--needs due`, and on `--needs me`. Three separate ways of
asking "what is late", and the answer was no in all three while something was
eighteen days late.

## Why this matters beyond the bug

The reporter records that this finding is **what decided them against the plugin
for personal tasks** — and that if a document-level rollup lands, that decision
is worth reopening, because the plugin's other properties are better than what
they use instead.

So this is not one missing field. It is the reason the reference plugin is not
being used for the thing it is for.

## The shape, and it is not new

SHARED-036 already settled the analogous question for `status`: a todo list says
`open` after its last item is checked, and the fix is that a plugin doc type
derives a document-level value from its items. **`due` is the same shape, one
field over** — the earliest open item's due date, surfaced on the document.

PLUGINS-016 is building the derivation seam for status. **Read it before
designing anything here**, and if the seam generalises, use it rather than
building a second mechanism. If it does not generalise, say why in this issue —
that is worth knowing.

## Decisions to make and record

1. **Earliest open item, or earliest item?** A checked item that was due
   yesterday is not late. Almost certainly open-only, but state it.
2. **What happens when no item has a due date** — the field is absent, not null,
   and must not make an undated list look due today.
3. **Whether a hand-written document-level `due:` wins over the derived one.**
   SHARED-036's answer for `status` is the precedent; do not answer it
   differently here without a reason.
4. **Where the derivation runs.** If it is a projection concern it belongs with
   SERVER-085's work; if it is a plugin concern it belongs in the manifest. The
   answer decides whether this issue needs a server issue behind it.

## Acceptance Criteria
- [ ] A todo document reports the earliest open item's due date
- [ ] `doc list --due overdue`, `--needs due` and `--needs me` all find an
      overdue item — the three the reporter tested, all three pinned
- [ ] A list with no dated open items reports no due date, and is not treated as
      due
- [ ] Checking the earliest item moves the document's due date to the next one
- [ ] Checking the last one clears it
- [ ] The Attention view shows it, end to end in the real app

## Testing Strategy
Unit over the derivation including the empty and all-checked cases. One
end-to-end reproducing the reporter's exact case: an item 18 days overdue, found
by all three queries.

## E2E Verification Log
_[Agent fills — state the model]_
