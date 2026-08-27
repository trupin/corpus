# [CONTRACT-026] Tag vocabulary source for the search overlay's tag chip

## Domain
contract

## Status

closed — superseded by CONTRACT-092, which answers the same question for two callers.

**Closed 2026-08-26 (Phase 50): superseded by CONTRACT-092.**

This issue asked where the `tag:` chip's vocabulary comes from and listed three
candidates. Candidate (b) — a dedicated route — is what Phase 50 built, for a
second reason this issue could not have known: SPEC.md §5's **Structured fields**
rider makes an invented frontmatter field a filter, and an invented field appears
in no list anywhere unless something enumerates it. One route answers both
questions, so building this one separately would have been designing the same
endpoint twice.

`GET /api/vocabulary` returns tags with counts, which is exactly what the chip
needs on the hybrid path, plus the extra keys the query editor needs. UI-178
consumes it and carries this issue's acceptance criterion for the chip.

The widening this issue proposed — putting `type` on `SearchHit` — is **not**
carried over. It is a per-hit payload cost for one glyph, this issue itself
called it "probably wrong", and it has nothing to do with a vocabulary. Anyone
who wants it should file it on its own merits.

## Priority
P2

## Model
opus

## Dependencies
- Depends on: CONTRACT-022
- Superseded by: CONTRACT-092
- Blocks: —

## Spec References
- SPEC.md §10 search overlay (filter chips)

## Summary
UI-026 finding (2026-08-02): the overlay's `tag:` chip offered options derived from
`DocRow.tags`, but ranked hits (`SearchHit`) deliberately carry no tags — so on the
hybrid path the chip can display and clear a tag but cannot offer one. Decide the
vocabulary source and spec/implement it: candidates are (a) a lightweight tags
aggregate on an existing surface (e.g. the tree endpoint already aggregates
folders), (b) a dedicated `GET /api/tags` (inventory + §9.2 rider), or (c) tags on
SearchHit (weighs every hit for one chip's benefit — probably wrong). Whichever
wins, the UI consumption is a small UI follow-up rider on this issue.

**Widened (Phase 9 eval, 2026-08-02):** consider letting SearchHit carry `type`
in the same decision — the frugal hit dropped the result-type glyphs too
(view/skill/template hits all render as doc). One additive field closes both if
chosen; weigh payload cost vs the two affordances.

## Acceptance Criteria
- [ ] Chosen source specced (one-bullet §9.2/§10 rider if a new route — user sign-off per house rules), implemented, and the chip offers options again on the hybrid path
- [ ] No per-hit payload growth unless explicitly chosen

## Technical Design
### Files to Create/Modify
- Per the chosen option; contract + server + one UI touch

## Testing Strategy
Scoped per workspace touched.

## E2E Verification Plan
Real app: overlay tag chip offers the workspace's tags while ranked results render.

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
