# [CONTRACT-078] A folder act cannot report a document it refused

## Domain
contract

## Priority
P2

## Status
todo

## Model
opus

## Dependencies
- Depends on: CONTRACT-075, SERVER-136 (which found it)

## Spec References
- SPEC.md §9.2 — "a response's warnings also carry effects on documents the request never named"

## Summary

Escalated by SERVER-136's implementer, 2026-08-22, against a shape it could not
change from its own workspace.

A folder act — rename, archive, unarchive, delete — plans a write per document
under the folder. A single document can refuse its write. **The caller is never
told which one.** `WARNING_CODES` is a closed enum with no code for a refused
document, and `FolderRenameResult`, `FolderArchiveResult` and
`FolderDeleteResult` have no `refused` array. So the act reports the documents it
moved and stays silent about the one it did not.

SERVER-136 recorded this rather than inventing a code, which was right: adding a
warning code is a contract change, and a server that invents one puts a value on
the wire no client can parse.

## Why it is P2 and not in the v0.19.0 release

A per-document refusal inside a folder act is an edge — a file the write lane
could not take. The act still commits what it could, and the projection stays
truthful. The gap is that the explorer's folder menu (UI-150) cannot tell the
user "eleven of twelve moved". That is worth fixing and is not worth widening a
release for.

## Acceptance Criteria
- [ ] Either `WARNING_CODES` gains a code for a refused document, or each
      `Folder*Result` gains a `refused` array naming the document and the reason
- [ ] Whichever is chosen, exactly one of them exists — a refusal is not
      reportable two ways
- [ ] SERVER-136's acts emit it, and a test proves a refused document reaches
      the caller
- [ ] UI-150's folder menu says what was refused

## Testing Strategy
Contract: the published shape and its example. Server: an act with one document
whose write is refused.

## E2E Verification Plan
### Verification Steps
1. Make one document under a folder unwritable.
2. Archive the folder.
3. The response names the refused document, and the other documents archived.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[CONTRACT-078]` prefix
