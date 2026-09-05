# [AGENT-069] The resident writes the digest at reply time

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: CLI-077 (the verb), SERVER-164 (the behaviour)
- Related: AGENT-065 (touches the same converse sections — sequence, do not race)

## Spec References

- SPEC.md **§6** — the digest rider: written at reply time, digests orient

## Summary

The digest exists only if the converse skill writes it. Amend `converse`:

- **After settling each event, before parking**: update the digest with
  `corpus thread digest set <id>` — the turns are already in context, so the
  write is nearly free. One digest, rewritten whole each time, ≤ the contract's
  length bound. Body via `--file` or stdin, never argv (CLI-074).
- **On rehydration** (Starting up): read digest + index + last turns before
  reaching for the whole thread; a `stale` digest is distrusted and rewritten
  on the next reply.
- **The invariant, verbatim in the skill**: digests orient — quote and patch
  only from turns read verbatim (`--turn <n>`), never from the digest.
- `comment` and `orchestrate` state the invariant where they read threads; they
  never write digests (no designation, no right).

## Acceptance Criteria

- [ ] converse writes the digest in its settle step and reads it at startup
- [ ] The invariant appears in converse, comment, orchestrate at their thread
      reads, one sentence each
- [ ] Net size change of the three skills recorded (INFRA-038 budgets apply)
- [ ] `workspace-template.test.ts` guards updated
- [ ] E2E: one designated conversation driven through two replies on a real
      workspace; the thread file shows the digest advancing its watermark

## E2E Verification Log

_Implementing agent fills; state the model._
