# [CONTRACT-088] A thread is created with its resident already designated

## Domain

contract

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-072
- Blocks: SERVER-154, UI-173

## Spec References

- SPEC.md §7 — rider A signed 2026-08-25: _"A new standalone thread designates a
  general resident, unless the person chose otherwise."_
- SPEC.md §10 — rider B signed 2026-08-25: _"Ask and Capture both offer **a new
  resident** … and the thread is created with that designation already made."_

## Summary

Designation is a separate act today: create the thread, then
`POST /api/threads/:id/resident`. Riders A and B make it part of creation — by
default for a standalone thread, and as an explicit choice on both composer
submits.

Two routes gain it: `POST /api/threads` (Ask) and `POST /api/capture` (Capture).

## Acceptance Criteria

- [ ] `POST /api/threads` accepts a designation on creation, expressing three
      states without ambiguity: **absent** (rider A's default — a general
      resident), **a named profile**, and **explicitly none**
- [ ] `POST /api/capture` accepts the same. §10's rider says outright why it may,
      although it carries no `recipient`: _"the reason it carries none — that a
      capture is in no scope by construction — is a statement about routing and
      not about ownership"_
- [ ] **Designation and `recipient` are separate fields and are never
      collapsed.** The route descriptions say why, citing §10: naming a recipient
      routes one message and rewires nothing, while designating hands over the
      conversation and everything that grows out of it. Both may be sent, and
      they mean different things
- [ ] A thread **with a parent** refuses a designation, as §7 has always required
      — a resident owns a conversation rather than a passage. The refusal names
      the rule
- [ ] The response carries the designation that was made, so a client never
      re-reads to learn what it got
- [ ] The three states have exactly **one spelling each** on the wire. "Absent"
      and "explicitly none" must be distinguishable, because they are different
      requests
- [ ] `openapi.json` and the generated client regenerate cleanly

## Technical Design

### Files to Create/Modify

- `packages/contract/src/routes/threads.ts` — `POST /api/threads`
- `packages/contract/src/routes/capture.ts` — `POST /api/capture`
- `packages/contract/src/schemas/agents.ts` or `threads.ts` — the designation
  request shape, declared once and used by both routes
- `packages/contract/openapi.json`, `src/client/schema.generated.ts` — regenerate

### Key Implementation Details

**The tri-state is the whole design decision.** `resident` absent means rider A's
default; a string names a profile; and "no resident at all" needs its own
spelling. Follow the existing precedent in this package rather than inventing
one — `requestsAgent` is already tri-state for a closely related reason (SPEC.md
§8), and `ComposeInput`'s comment records why absence gets exactly one spelling:
_"so 'stated nothing' has exactly one spelling on the way out: the key is
absent."_

Reuse `residentField`'s existing prose about a designation naming a profile or
naming none. It is already written and already signed.

### Edge Cases

- A named profile that does not exist: §7 says a missing profile is reported
  rather than silently substituted, and an archived one still resolves. Neither
  is new here — do not re-decide them, cite them.
- A capture creating several documents: the designation lands on the capture's
  filing thread, which is the standalone thread §10 already describes.

## Testing Strategy

Schema tests over the three states, and over the parent-thread refusal. Round
trip through the generated client. **Falsify the tri-state**: collapse "absent"
and "explicitly none" to one spelling and watch the test that tells them apart
go red.

## E2E Verification Plan

Through the generated client against the real server once SERVER-154 lands: Ask
with no designation produces a thread with a general resident, Ask with an
explicit none produces one with no resident, and Ask on a document thread is
refused with the rule named.

## E2E Verification Log

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-088]` prefix
