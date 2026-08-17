# [CONTRACT-063] `MoveDocRequest.folder` is required and still says it defaults to `inbox`

## Domain

contract

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: CONTRACT-062
- Blocks: —

## Spec References

- SPEC.md **§11** — creation is inbox-first

## Summary

`MoveDocRequest.folder` is a **required** field, so it has no default — but its
description says *"Defaults to `inbox` — creation is inbox-first (SPEC.md §11),
and the agent files inbox arrivals per its skill."*

That sentence is dead text on this route. It reads as move's default because it
*was* create's: the two shared one constant until CONTRACT-062 split them, and
the split deliberately left the move side byte-identical so that issue could not
be accused of quietly giving move a grammar it never had.

Found by contract-dev while doing that split. It is the same defect the split
fixed — one sentence describing two routes — one instance smaller, and it wants
its own change so the correction is legible as a correction.

## Acceptance Criteria

- [ ] `MoveDocRequest.folder`'s description states what a caller may conclude
      about **move**, and claims no default it does not have
- [ ] Everything true of move's folder grammar is retained: the bare name and
      full-prefix spellings, and that it is rooted at `data/docs/`
- [ ] `CreateDocRequest.folder` is untouched
- [ ] `POST /api/docs/bulk`'s `move` act (`schemas/bulk.ts:163`) is checked for
      the same sentence and corrected if it carries one
- [ ] `openapi.json` and the generated client regenerated; drift check passes

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/doc.ts` — the move-side constant
- `packages/contract/src/schemas/bulk.ts` — if it carries the same claim
- regenerated artifacts

### Key Implementation Details

Read the move route's handler before writing the description — the authority is
what the server does with a required folder, not what create's text used to say.
CONTRACT-062's test already pins that the type-aware create grammar appears on
exactly one field in the published document; do not let this change leak it to a
second.

## Testing Strategy

Assert the move description no longer claims a default. Falsify by restoring the
old string.

## E2E Verification Plan

### Verification Steps

1. Regenerate, drift check
2. Read the description out of `openapi.json`

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-063]` prefix
