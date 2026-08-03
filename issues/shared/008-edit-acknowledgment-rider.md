# [SHARED-008] Edit-acknowledgment spec rider (signed 2026-08-02)

## Domain
shared (orchestrator-owned)

## Status
todo

## Priority
P1

## Model
fable

## Dependencies
- Depends on: —
- Blocks: CONTRACT-028, SERVER-052, CLI-026, UI-044, AGENT-011

## Summary
User-approved behavior (AskUserQuestion sign-off, 2026-08-02 — "Approve"), to
be applied verbatim to SPEC.md (§4 rider + §7/§8 agent loop) at the Phase 11
kickoff, per the amendment-at-kickoff pattern:

> **Edit acknowledgment.** Every *user* edit session on a document ends one of
> two ways: the reader closes (the UI flushes the session), or the document
> goes inactive for a few minutes while open (default 3 minutes, a distinct
> and longer window than §4's commit-squash idle). Either way the server
> emits one `doc.edited` queue event carrying the document id and the
> session's commit range with change stats — never the diff body. The agent's
> loop handles it like any event: a new CLI verb (`corpus doc diff <id>`)
> fetches the actual diff on demand. The orchestrate skill reflects on the
> change: it checks, through retrieval (`corpus search`, `corpus doc
> related`), whether the change ripples into other documents; updates or
> comments where it does; acknowledges briefly on the document's own surface
> where it does not. Agent-authored edits never emit the event (actor-scoped),
> so the loop cannot feed itself.

## Acceptance Criteria
- [ ] Rider applied to SPEC.md verbatim at phase kickoff (orchestrator)
- [ ] The five dependent issues implement against this text

## Completion Checklist (orchestrator)
- [ ] SPEC.md updated on the phase branch; fidelity-checked in review
