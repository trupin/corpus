# [CONTRACT-052] The diff route's published description tells API consumers the wrong default base

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-113 (which changed the behaviour being described)
- Related: SERVER-097 (which left one of these two descriptions stale already),
  CLI-045 (the same sentence in the CLI's help), SHARED-045 (the same sentence
  in SPEC.md, which needs sign-off)

## Spec References

- SPEC.md **§4** — commit windows are party-scoped, and each document's diff is
  path-scoped
- SPEC.md **§9.2** — the diff route (currently carries the same wrong sentence;
  that is SHARED-045, not this issue)

## Summary

`SERVER-113` changed `GET /api/docs/{id}/diff`'s default base from *the parent
of `to`* to *the previous commit that touched this document*, because since §4's
party-scoped commit windows the parent is routinely a different party's commit
touching a different file.

**The published contract still describes the old behaviour**, in two places:

- `packages/contract/src/schemas/edit.ts` — `DocDiffQuerySchema.from` (~:332)
  and `DocDiff.from` (~:373)
- `packages/contract/src/routes/doc-diff.ts` — the operation description

And one of them was **already** stale before SERVER-113 touched anything:
`edit.ts:240` still says "the parent of its first commit", left behind by
`SERVER-097`. So this is two drifts in one file, and fixing them is one pass.

**Why this is P1 and not documentation tidying.** `openapi.json` is a committed,
generated, drift-checked artifact that ships in the package. An API consumer
reading it is told the base is `to`'s parent, and can compute what they think is
the same range and get a different answer — silently, because both answers are
well-formed diffs. A description that is merely absent makes a caller ask; one
that is confidently wrong makes them not ask.

## Acceptance Criteria

- [ ] Both `edit.ts` descriptions state the actual rule: the previous commit
      that touched **this document**, and git's empty tree when there is none
- [ ] `routes/doc-diff.ts`'s operation description agrees with them
- [ ] `packages/contract/openapi.json` is regenerated and committed, and the
      drift check passes
- [ ] **The published artifact is swept, not just the source** — read the
      regenerated `openapi.json` and confirm no remaining description anywhere
      in it claims the parent-of-`to` rule. Grepping the source is what let
      `edit.ts:240` survive SERVER-097
- [ ] No behavioural change: this issue moves no code

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/edit.ts`
- `packages/contract/src/routes/doc-diff.ts`
- `packages/contract/openapi.json` (generated)

## Testing Strategy

The generation and drift check are the test. If a description is asserted
anywhere in `openapi.test.ts`, update it there too rather than letting the
assertion pin the old wording.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] `/lint` passes
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-052]` prefix
