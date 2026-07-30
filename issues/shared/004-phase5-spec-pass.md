# [SHARED-004] Phase 5 spec pass: delegation, doc-abandon, context menu, view width, §12/§2.1 reconciliation

## Domain
shared

## Status
todo

## Priority
P0

## Model
fable — spec authorship is judgment work; spec-writer is pinned fable regardless.

## Dependencies
- Depends on: —
- Blocks: AGENT-005, UI-017, UI-018, UI-019

## Spec References
- SPEC.md §7 (agent loop), §10 (board), §11 (documents/editor), §12 (todos), §2.1 (CLI lifecycle)

## Summary
One spec-writer pass covering everything Phase 5 needs signed off, so the user reviews a
single coherent set of SPEC.md amendments:

1. **§7 — delegation (AGENT-005)**: the orchestrator agent delegates queue jobs to
   subagents by default and returns to parking, so it stays open to new events;
   failure/deferral surfacing, trace + CLI-only invariants inside subagents,
   concurrency bounds. (User request 2026-07-29.)
2. **§11 — no empty untitled documents (UI-017)**: exiting a still-empty new document
   must leave nothing behind; specify create-then-delete vs. defer-creation semantics
   and the git-audit-trail consequences. (User request; the user's own workspace log
   shows the create-Untitled-then-delete-Untitled annoyance live.)
3. **§10/§11 — right-click context menu (UI-018)**: which surfaces, action parity with
   existing menus, native-menu preservation (text selection), keyboard accessibility.
   (User request.)
4. **§10 — view width (UI-019)**: user-adjustable view/column width; where the
   preference lives (no settings surface exists; mind the server-sole-writer rule if
   file-backed) and whether this seeds a settings panel. (User request.)
5. **§12 reconciliation (PR #11 review MAJOR 3, held at merge)**: §12 promises each
   todo item "can be commented on (anchored to the item text)"; shipped v1 defers this
   to PLUGINS-003 — which is IN Phase 5 scope. Reconcile: if PLUGINS-003 lands this
   phase, the sentence may only need a transitional note or nothing; coordinate with
   that issue's timing rather than blindly rewording.
6. **§2.1 stale-pidfile wording (PR #11 re-review MINOR 1)**: "Stale pidfiles (dead or
   reused pid) are detected and cleaned" → match CLI-014's shipped conservative
   semantics (dead pid cleaned; live pid's pidfile always kept, with a report).

## Acceptance Criteria
- [ ] Draft amendments for all six items as behavioral spec text (WHAT, not HOW), each traceable to its SPEC section
- [ ] Ambiguities surfaced as explicit questions rather than guessed
- [ ] The full set presented to the user for sign-off in one round; applied to SPEC.md only after sign-off
- [ ] AGENT-005 / UI-017 / UI-018 / UI-019 unblocked (their issues updated with the signed-off spec references)

## Technical Design
spec-writer produces the drafts; the orchestrator runs the sign-off round with the user; amendments are applied on the phase branch after sign-off.

## Testing Strategy
n/a (spec text). Downstream issues carry the tests.

## E2E Verification Plan
n/a.

## E2E Verification Log
_Filled by the spec-writer / orchestrator: drafts produced, sign-off record, application commit._

## Completion Checklist (orchestrator)
- [ ] User sign-off recorded
- [ ] SPEC.md amended on the phase branch
- [ ] Committed with `[SHARED-004]` prefix
