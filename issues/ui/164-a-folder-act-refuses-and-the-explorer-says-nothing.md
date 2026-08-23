# [UI-164] A folder act refuses a document and the explorer says nothing

## Domain
ui

## Status
done

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

- [x] A folder act that refuses at least one document reports it, naming the
      documents and the reason the server gave.
- [x] A partial act still reads as **partial**, not as success. The wording says
      what happened to the rest, so the user knows eleven of twelve moved.
- [x] A refusal message is the server's, rendered as text. The UI invents no
      reason class — CONTRACT-078 deliberately shipped none, because a vanished
      file and a validator's refusal arrive as the same throw.
- [x] Rename is exempt and stays exempt. It is one directory move, so no document
      can refuse alone, and CONTRACT-078 gives its result no `refused` field.
- [x] Where more documents refuse than a notice can hold, the notice says how
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

**Model: opus (claude-opus-5[1m]).** A real server on port 8790, a scratch
workspace, and Chromium against the built UI it serves. `todos/` holds two
documents, one of them in `todos/unfiled/`, and that sub-directory was made
unwritable (`chmod 0555`) so the server genuinely cannot rewrite the file.

With the surface blind to `refused` — the shipped behaviour — the explorer's
folder menu → **Archive folder** reported:

```
toast: ✓ | Archived todos/ — committed. The server listed 2 documents in the
          folder afterwards; nothing moved on disk. | ✕
statuses after the act: ["doc_alpha001: archived", "doc_beta0001: resolved"]
```

Plain success, and one of the two documents silently unchanged. That is §11's
failure exactly.

### Post-Implementation Verification

The same act, the same unwritable directory, the same click:

```
toast: ✓ | Archived todos/ in part — committed. 1 of 2 documents now read
          archived; 1 document was refused and keeps the status it had:
          doc_beta0001 — EACCES: permission denied, open
          '…/data/docs/todos/unfiled/.tmp-53520-91faa598c069.md'.
          Nothing moved on disk. | ✕
statuses after the act: ["doc_alpha001: archived", "doc_beta0001: resolved"]
```

It names the document, renders the server's message verbatim, reads as
**partial** rather than as success or as failure, and says what happened to the
rest. The successful half is not described as lost.

**The other outcomes**, covered by `explorerMenus.test.tsx` over the pure notice
functions and by one component test through the menu against a stubbed refusal:

- Nothing refused → the sentence that shipped, unchanged, tone `info`.
- Some refused → `info`, "in part", `11 of 12 documents`, the refusal named.
- Every document refused → `error`, "changed nothing", "every one of its 3
  documents was refused". At n=1 it reads "every one of its 1 document was
  refused" — no `0 of 1` arithmetic.
- Delete counts differently on purpose: a refused delete is **not** in
  `documents`, so the total is the two halves added (`Deleted 11 of 12
  documents under finance/ — 1 document was refused and still exists`).
- More refusals than the notice can hold: three are named and the rest counted
  (`(and 4 more not named here)`), never a cut list presented as whole.
- A refusal message that arrives empty renders `doc_a — no reason given` rather
  than an id with a dangling dash.
- Rename is untouched: `RenameFolderResult` carries no `refused`, and nothing
  here reads one from it.

**Falsification.** `refusalsOf` made to return `[]` — the field dropped on the
way through — turns the component test red:
`expected 'Archived finance/ — committed. The se…' to contain '2 of 3 documents'`.
A test asserting only that a notice appeared would have passed.

**One guard worth naming.** `refused` is required by the contract and the client
does not validate responses, so a server that omits it would hand the surface
`undefined`. `refusalsOf` degrades that to "nothing was refused"; a test covers
it. A `.length` on `undefined` in a toast handler is a swallowed act, not a
missing sentence.

**Checks.** `vitest run apps/ui` — 178 files, 3689 tests pass. `vitest run
packages/kit` — 63 files, 954 tests pass. `npm run typecheck` exit 0.
`eslint apps/ui packages/kit` exit 0.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
