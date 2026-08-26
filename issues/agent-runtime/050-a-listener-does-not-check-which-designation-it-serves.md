# [AGENT-050] A listener does not check which designation it serves

## Domain
agent-runtime

## Status
done

## Priority
P1

## Model
fable

## Dependencies
- Depends on: CONTRACT-071 (declares the field), SERVER-147 (populates it)
- Related: AGENT-040, AGENT-041, CLI-053, SERVER-128, SERVER-129

## Spec References
- SPEC.md **§7** — designation, release, and a resident's lane

## Summary

CONTRACT-071 supplies the fact; this issue is the act. It is the half named in
that issue's decision 3: *"Standing down is the obvious answer and it belongs to
`converse`, not here."*

A designation now carries an identity, `Resident.designationId`. A listener was
launched for one designation and the lane may now carry another. Nothing in
`converse` reads the field, so a listener replaced by a re-designation that
named a different profile at the same weight still has no signal, and the
duplicate is still resolved by whoever claims first — which the stale-persona
listener can win.

## What the listener can now read

`corpus agents --json` carries the roster verbatim, so a row's
`resident.designationId` is available with no CLI change. The launch payload's
`resident` carries the id the listener was launched for.

The comparison is equality and nothing else. **Two nulls are not a match**: a
designation made before the field existed reports `null`, and a listener whose
own id is also `null` has no answer and must behave exactly as it did before the
field existed. The contract states this on the field itself.

## What has to be decided and written

1. **Where in the loop the comparison goes.** The loop already reads the roster
   once a pass (*The loop*, step 5) and reads it again immediately before a
   drain (*Retirement*). Whether the id is compared at both, or only the first,
   is the skill's call.
2. **Whether the weight comparison collapses into it.** CONTRACT-071's decision
   4 asks this and the answer is yes on the mechanism: a weight change is a
   different designation and mints a different id, so the weight-specific
   reading in *Retirement* becomes a special case of one comparison. The
   *reason* that paragraph gives — "no running agent becomes another one without
   discarding the conversation it is holding" — is still the reason, and should
   survive as prose. Collapsing two readings into one is the point; losing the
   sentence that explains the act is not.
   **Guard the transition**: while any workspace still holds designations made
   before SERVER-147, a null id on either side means the weight reading is the
   only reading available. Do not delete it in a way that leaves an old
   workspace with no test at all.
3. **What the listener does on a mismatch.** *Retirement* already has the act
   written for the weight case — finish the turn, settle what was claimed,
   write no goodbye, exit — and states why a farewell would be untrue. A
   profile-only replacement is the same act for the same reason.
4. **Whether the orchestrate skill reads it too.** Its live-row rule
   (AGENT-040) launches a successor when this session has processed a release on
   the lane. The id is a second, session-independent way to see that the lane
   has moved on. Judge whether that improves the rule or duplicates it; do not
   add a second mechanism beside one that works.

## What must not change

- **The roster's rendered resident cell stays display text and stays
  unparseable.** The whole point of the new field is that nothing has to read
  the cell. AGENT-040's rule about it holds.
- The listener must not report the id to a person, in a turn or in a job log.
  It is opaque and it means nothing to a reader.

## Acceptance Criteria
- [x] `converse` states, in one place, that a listener compares the designation
      id it was launched with against the id the lane carries now
- [x] The rule says what a `null` on either side means, and that it is not a
      match
- [x] The act on a mismatch is stated, and is the act *Retirement* already
      describes rather than a second one
- [x] The weight-specific reading is either collapsed into the id comparison or
      kept with a written reason for keeping both — not left silently redundant
- [x] Nothing instructs any skill to parse the roster's resident cell
- [x] A worked example shows the profile-only replacement, which is the case no
      previous signal covered

## Testing Strategy

Skill text, so the test is the pin: the skill's own examples and any
`assets/workspace` tests that read its rules. Verify against a real workspace by
re-designating a live lane to a different profile at the same weight and
watching the listener stand down.

## E2E Verification Plan

### Verification Steps
1. Start a workspace server and designate a standalone thread with profile A.
2. Launch a listener and let it park.
3. Re-designate the same thread with profile B, at the same weight.
4. The listener's next pass reads the roster, finds an id that is not the one it
   was launched with, settles what it holds and exits without posting a
   farewell.
5. The successor takes the lane, and the conversation ends with one voice.

## E2E Verification Log

Implemented by the orchestrator on opus, 2026-08-26.

### The two decisions the issue left open

**1. Where the comparison goes: the loop's pass, and not the drain.** They ask
different questions and the distinction is written into the skill rather than
left for a reader to work out.

- *The loop*, step 5, asks **am I still the resident** — an identity comparison,
  because a row's presence proves nothing when a person can release and
  re-designate between two passes and every other field comes back reading as
  before.
- *Retirement* asks **is anybody the resident** — a presence test, because you
  are leaving either way and what you must not do is drain out from under a
  successor. Comparing ids there would answer a question that moment does not
  ask, and would get it wrong: a row bearing **your own id** would mean a
  listener launched for the designation you are retiring from, and it is still
  not you.

**2. The weight comparison collapses in, and its reason survives as prose.** A
re-designation at a different weight is a different designation and mints a
different id, so one test now catches a weight change, a profile swapped, a
profile added and a profile removed — a list of the ways a row can change
becomes one comparison.

What must not be lost with the second mechanism is the sentence that explains
the act, and a test pins it: **no running agent becomes another one without
discarding the conversation it is holding.**

### Two nulls are not a match

The contract states it on the field, and the skill must not quietly improve on
it. A designation made before the field existed reports `null`; a listener whose
own id is also `null` has learned nothing from `null === null`, and behaves
exactly as it did before the field existed. **Only a difference between two ids
is evidence, and an absence is not a difference.**

### Falsification

Rewriting the null rule to say two nulls match:

```
× refuses to read two nulls as a match
  Tests  1 failed | 505 passed
```

### No SPEC.md citations

`grep -c "SPEC.md"` → 0, per AGENT-053's finding.

### Checks

```
vitest run scripts/workspace-template.test.ts   506 tests passed   exit 0
```
