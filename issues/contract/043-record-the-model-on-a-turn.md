# [CONTRACT-043] A turn has nowhere to record the model that wrote it

## Domain

contract

## Status

todo

## Priority

P1

## Model

fable

## Dependencies

- Depends on: SHARED-027 (signed, applied)
- Blocks: SERVER-074, UI-090

## Spec References

- SPEC.md **§11** Thread view — "An agent turn says which model wrote it"
  (rider signed 2026-08-07)
- SPEC.md **§7** — the console's dispatch line, amended by the same rider
- SPEC.md **§6** — the turn format

## Summary

SHARED-027 is signed: an agent turn carries the model that produced it, so
"which model wrote this?" survives the job log being reaped. Nothing records it.

**This issue owns one decision, and it is the reason the issue is `fable`**:
*where* the model is written, given that a turn on disk is
`## <author> · <ISO instant>` followed by prose.

## The decision, and why it is not obvious

**Option A — extend the turn heading.** The natural place, and the dangerous one.
`core/turns.ts` finds turn boundaries by scanning for that heading shape, and
this project has already shipped **two** parser defects in that exact area:
AGENT-016 (a closing fence on a content line swallowed every later turn) and
SERVER-066 (`unterminated-fence`). A person's turn body can contain arbitrary
markdown, so every character added to the delimiter grammar is a new way for
content to imitate a delimiter. The most recent CRITICAL on this project was
precisely a delimiter content could imitate.

**Option B — a separate line inside the turn**, below the heading. Keeps the
delimiter untouched. But it is content, so a person can type it, and then the
same imitation problem appears one line lower with none of the heading's
structure to anchor it.

**Option C — frontmatter on the thread document**, keyed by turn timestamp.
Cannot be imitated by turn content at all, and does not touch the delimiter.
Costs locality: the record lives away from the turn it describes, and a turn
moved or copied loses it.

None is obviously right. **Answer it explicitly, with the parser history in
view, and write the reasoning where the next reader will find it.** Do not pick
the one that is easiest to render.

## Acceptance Criteria

- [ ] A turn can carry the model that wrote it, on the wire and in whatever the
      server persists
- [ ] **Absent is a first-class state**, not a default or an empty string. §11
      is explicit: a turn written before this was recorded shows **nothing**
      rather than a guess, and a person's turn names no model
- [ ] Where a request ran in stages (§7), what is recorded is the **deciding**
      stage's model — the field means one model, not a list, and its
      description says so, because SHARED-023 makes multi-stage work ordinary
      and a later reader will otherwise assume it accumulates
- [ ] The chosen location **cannot be forged by turn content**. If the choice is
      A or B, that claim needs a test with adversarial bodies, not an assertion
- [ ] Round-trips: a thread file written with the field and read back yields the
      same turns, with the same bodies, byte for byte
- [ ] Whether this belongs in §6's turn-format prose is answered. If it does,
      that is a **SPEC edit needing user sign-off** — draft it here and hold it
- [ ] `openapi.json` and the typed client regenerated, not hand-edited

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/` (the turn shape), plus regenerated artifacts.
- Read `apps/server/src/core/turns.ts` before choosing — the parser is the
  constraint, and it is not in this domain.

### Notes

- **CONTRACT-039 deliberately kept request-time instruction off the turn**: a
  chosen *weight* is a directive, not a property of the message, and promoting
  it to a stored field was called out there as a separate decision needing
  sign-off. This issue does **not** overturn that. The model that wrote a turn
  is a fact about what happened, not an instruction about what should; SHARED-027
  was signed on exactly that basis. Keep the two apart, and say so in the
  description, or someone will later "unify" them.
- The model name is a display string, not an enum. §7 keeps model names in the
  skill; do not enumerate them in the contract.

## Testing Strategy

Round-trip over a thread file with and without the field; absent distinguishable
from empty; adversarial turn bodies attempting to forge it, if the chosen shape
makes that possible.

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
