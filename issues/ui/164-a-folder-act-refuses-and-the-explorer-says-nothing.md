# [UI-164] A folder act refuses a document and the explorer says nothing

## Domain
ui

## Status
todo

## Priority
P2 (nice-to-have)

## Model
opus

## Dependencies
- Depends on: CONTRACT-078
- Blocks: —

## Spec References
- SPEC.md Section 10 — "UI — the board" (rider 1, the explorer's folder menu)
- SPEC.md Section 11 — "Validation" (a non-blocking failure is reported, not
  swallowed)

## Summary

CONTRACT-078 gave every folder act a `refused: [{id, message}]` array, and
`apps/server/src/folders/acts.ts` now fills it. **Nothing reads it.** Its fourth
acceptance criterion — the explorer's folder menu saying what was refused — is
`apps/ui` work and a design decision, so its implementer left it and escalated
rather than inventing a surface.

Today a folder archive over twelve documents that refuses one reports success.
The user sees eleven change and one not, with nothing on screen saying which or
why. That is the failure §11's reporting rule exists to prevent, and it is the
same shape as shipping a saving nothing collects.

## Acceptance Criteria

- [ ] A folder act that refuses at least one document reports it, naming the
      documents and the reason the server gave.
- [ ] A partial act still reads as **partial**, not as success. The wording says
      what happened to the rest, so the user knows eleven of twelve moved.
- [ ] A refusal message is the server's, rendered as text. The UI invents no
      reason class — CONTRACT-078 deliberately shipped none, because a vanished
      file and a validator's refusal arrive as the same throw.
- [ ] Rename is exempt and stays exempt. It is one directory move, so no document
      can refuse alone, and CONTRACT-078 gives its result no `refused` field.
- [ ] Where more documents refuse than a notice can hold, the notice says how
      many are not shown. A truncated list presented as complete is SHARED-057's
      failure.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/explorer/explorerMenus.tsx` — the folder acts' result handling
- `packages/kit` — only if the folder hooks drop the field before the UI sees it;
  the client already carries it
- the matching tests beside each

### Key Implementation Details

The existing surface for this is the toast (`RowNotice`), which the explorer
already uses for every other folder-act outcome. Use it rather than adding a
second reporting channel — one act, one report.

A refusal is not an error. The act partly succeeded, so the tone should say
"partly done" rather than "failed", and the successful half must not be
described as lost.

### Edge Cases
- Every document refuses. That is a failure, and should read as one.
- One document refuses out of one. Same wording as the general case, without
  arithmetic that reads oddly at n=1.
- A refusal arriving with an empty message.

## Testing Strategy

Component tests over the explorer's folder menu with a stubbed act result
carrying `refused`: one refusal, several, and all. Assert the notice names the
documents and does not claim success.

**Falsify**: drop the `refused` field on the way through and watch the assertion
fail. A test asserting only "a notice appeared" would pass with the bug in place.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Build a workspace folder holding one document the server will refuse to
   archive and several it will not
2. Archive the folder from the explorer's folder menu
3. Expected: a report naming the refused document
4. Actual: a success notice, and one document silently unchanged

### Verification Steps
1. Repeat the reproduction after the change
2. Confirm the notice names the document and the reason, and says what happened
   to the rest

## E2E Verification Log

### Reproduction (bugs only)
_[Agent fills]_

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
