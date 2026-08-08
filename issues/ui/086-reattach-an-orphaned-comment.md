# [UI-086] An orphaned comment offers candidate sites, and the person picks

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-041 (the re-attach route), SERVER-072 (the write)
- Blocks: SERVER-059
- Related: SERVER-071, UI-068 (the prevention half — this repairs what those stop creating)

## Spec References

- SPEC.md §6 Anchoring — "a visible orphan beats a silent misattachment"

## Summary

Phase B of the route chosen for SERVER-059 (user decision, 2026-08-07).

SERVER-059 proves, as a construction, that **no reader-side similarity measure
can decide where an orphaned comment belongs**: deleting a line from a parallel
list, and renaming that line while deleting its sibling, produce the same
after-state from the same before-state and demand opposite correct answers. A
reader sees only the after-state.

The evidence problem is unsolvable for a machine and **trivial for the person
who wrote the comment**. So the machine stops guessing and asks.

This is the half that closes the existing backlog. SERVER-071 and UI-068 stop
the population growing; nothing but this drains it.

## Acceptance Criteria

- [ ] An orphaned comment is visibly orphaned, and offers a way to re-attach
- [ ] Candidate sites are **offered, never pre-selected**. A default selection is
      a guess wearing a person's authority, which is the exact failure SPEC §6
      forbids and SERVER-055 shipped
- [ ] "Leave it detached" is always available and always costless
- [ ] The person can tell what they are agreeing to: each candidate shows enough
      surrounding text to be judged, not a similarity score
- [ ] Choosing a site writes the corrected selector, and the comment resolves
      normally from then on — the repair is durable, not a per-session overlay
- [ ] Two threads on disjoint text never end up claiming overlapping text
- [ ] Candidate generation is **complete or honest**: if the list is truncated,
      it says so. A silently-capped list looks like "these are the only places"
- [ ] Tested adversarially at **three or more parallel items** in every shape —
      list, table, task list, prose, numbered. SERVER-055's safety tests passed
      only because they used two items, which was shape-luck, not safety

## Technical Design

### Files to Create/Modify

- The orphan presentation in `apps/ui/src/thread/`, plus the re-attach call
  against CONTRACT-041's route.

### Notes

- **`findFuzzyRange` is admissible here and inadmissible on a read path.** The
  difference is that its output becomes a *suggestion a person confirms* rather
  than an attachment nobody sees happen. Reuse it to generate candidates; do not
  reuse it to pick one.
- Generate candidates by the pigeonhole-complete route SERVER-059 names, not by
  ranking-and-truncating. The person can dismiss a bad candidate; they cannot
  summon a missing one.
- The empty case matters: when nothing plausible exists, say so plainly rather
  than showing a weak candidate to avoid an empty list. A bad suggestion is
  worse than none, because it invites a click.

## Testing Strategy

Adversarial fixtures first, at three or more parallel items, in every shape
above. Then the flow: orphan → candidates → choose → the selector on disk is
corrected → the comment resolves on a fresh read. Plus the decline path leaving
everything untouched.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
