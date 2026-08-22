# [SERVER-136] Delete the server's plugin discovery, registry and derived-field seam

## Domain
server

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SHARED-064 (signed and applied)

## Spec References
- SPEC.md — §10, §12 and §13 are deleted; the plugin concept is gone from §1, §3, §4, §5, §7, §9 and §12

## Summary

Part of Phase 41. The plugin surface and the todos plugin are removed entirely,
on the user's instruction: *"I want it fully gone, no trace of it in the codebase
or the specs."* `todo` is not a document type.

The full inventory for this area is in the orchestrator's brief to the
implementing agent. Two rules bind every part of this phase:

1. **A document carrying an unrecognised `type:` must still open, render with
   working checkboxes, search, and pass `doc check`.** That is SPEC §12's M6, and
   it is what protects the user's existing `type: todo` documents.
2. **Where a rule existed only because a plugin might, delete it. Where it
   survives its cause, keep it and restate the reason.** A docblock explaining a
   constraint by a plugin that no longer exists is worse than no docblock.

## Acceptance Criteria
- [ ] No reference to plugins or todos remains in this area
- [ ] Rules that outlive their plugin justification are kept and restated
- [ ] Nothing that only existed for plugins is left behind as a stub

## E2E Verification Log
_[Agent fills — state the model]_
