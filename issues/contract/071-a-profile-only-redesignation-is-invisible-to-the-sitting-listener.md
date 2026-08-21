# [CONTRACT-071] A profile-only re-designation is invisible to the listener it replaces

## Domain
contract

## Status
todo

## Priority
P1

## Model
fable

## Dependencies
- Related: AGENT-040 (which found it), AGENT-041, CONTRACT-067, SERVER-129, CLI-053, SHARED-055

## Spec References
- SPEC.md **§7** — designation, release, and a resident's lane

## Summary

Escalated by AGENT-040's implementer, 2026-08-21, as beyond its own domain.

A re-designation that changes **only the profile**, at the same weight, cannot be
detected by the listener it replaces:

- `converse` detects a **changed weight** and a **vanished row**. Neither happens
  here — the weight is identical and the row is still there.
- The roster's resident cell is **display text written for a person**, and the
  skill correctly forbids parsing it. AGENT-040's own fix records that rule.

AGENT-040 made the successor launch — a designation following a release now
launches even while the outgoing listener still holds its park. But the duplicate
is then resolved by the **contested claim**, which is a race. **The stale-persona
listener can win it and keep the lane**, answering as a profile the person
replaced.

## Why the wire has to answer this

Every fix available inside the skills has been taken. The successor launches; the
old listener has no signal to act on; and the tie is broken by whoever claims
first. There is nothing left to write in prose that would change the outcome —
which is precisely the point at which a defect stops being an agent-runtime one.

What is missing is a **machine-readable** statement of which designation a
listener is serving, either on the roster row or in the park path, so a sitting
listener can compare what it was launched for against what the lane now says and
stand down when they differ.

## Decisions to make and record

1. **Roster row, or the park path, or both.** A field on the row is read on a
   poll; a field in the park answer reaches the listener at the moment it
   unparks, which is when it is about to act. The second is more timely and the
   first is simpler.
2. **An identity, not a rendering.** Whatever is added must be something a
   machine compares — a designation id, or the profile's document id — never the
   display string. The display string already exists and is already forbidden,
   and adding a second parseable-looking rendering would invite the same mistake.
3. **What a listener does when they differ.** Standing down is the obvious
   answer and it belongs to `converse`, not here. This issue supplies the fact;
   the skill decides the act. Say which issue owns that half.
4. **Whether the same field answers the weight case more cleanly.** `converse`
   detects a changed weight today by comparison. If a designation identity
   covers both, the weight-specific path may be redundant — check before adding
   a second mechanism beside it.

## Acceptance Criteria
- [ ] A listener can tell, without parsing display text, that the designation it
      serves is no longer the lane's designation
- [ ] A profile-only change at the same weight is detectable
- [ ] The roster's human-facing cell is unchanged and still not parseable
- [ ] The contract declares the field, and the server populates it
- [ ] The follow-up owning the listener's response is filed and named here

## Testing Strategy
Contract round-trip plus a server test that a profile-only re-designation changes
the field. The listener half is a skill change with its own pin.

## E2E Verification Log
_[Agent fills — state the model]_
