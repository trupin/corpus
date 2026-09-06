# [AGENT-070] The skills still read "a parked resident answers only mentions"

## Domain

agent-runtime

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-165

## Spec References

- SPEC.md **§7**, **§8** — the designation-engages rider (SERVER-165)

## Summary

Once SERVER-165 lands, any skill text reading the old truth — that a plain
turn on a designated lane reaches nobody — is stale. AGENT-068/069's E2E logs
both hit the old behaviour and worked around it with `@agent` mentions; the
converse skill's lapse/summoned sections and the comment skill's participation
notes must be audited for the same reading and corrected to the rider's.

## Acceptance Criteria

- [ ] Every statement about designated-lane participation in converse,
      comment, orchestrate matches the signed rider
- [ ] Net size change per skill recorded; INFRA-038 ratchet green
- [ ] `workspace-template.test.ts` guards updated
- [ ] E2E: a plain (unmentioned) message to a designated conversation is
      answered by its resident on a real workspace

## E2E Verification Log

_Implementing agent fills; state the model._
