# [CLI-042] `--json` carries no `hint`, so a machine caller is told what happened and not what to do

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: CLI-035 (where it was found), SHARED-041 (the refusals that made it
  matter)

## Spec References

- Not spec text. This is about whether the CLI's machine surface is usable by
  the caller it exists for.

## Summary

Found by CLI-035's follow-up while fixing the patch route's stale-key hint, and
flagged rather than fixed because it is a **CLI-wide** decision, not a property
of one verb.

`toProblem` in `apps/cli/src/errors.ts` emits `{code, message, changed, details}`.
`hint` is documented as human-only, so **every** `--json` error the CLI raises
carries what went wrong and no instruction for what to do next.

It became visible on the patch route's stale-key refusal, where the message is
*"the patch itself is still good"* and the recovery — **run the same patch
again** — lives only in the human rendering. A machine caller reading that JSON
is told its patch is fine and given nothing to do about it.

That is the same shape as the finding that prompted the fix (a hint naming a
`--key` the verb does not have), one layer over: the human path was corrected and
the machine path never had the sentence at all.

## Why it matters more than it looks

The agent is the machine caller. Every refusal this repo has designed in the last
week — the stale key, the patch's two conflicts, the keyless-write refusal — was
written so that the *message names its own recovery*, because an agent that
cannot act on what it reads will guess. `--json` drops exactly that half.

## The question to answer first

**Should `hint` be machine-visible, or should the recovery live in `details`?**
Both are defensible and the issue should not assume:

- **Emit `hint`.** One line, and every existing refusal gains its recovery for
  free. But `hint` is prose written for a person, with backticks and command
  spellings, and publishing it makes it an interface — changing a hint becomes a
  breaking change for anyone parsing it.
- **Give the recovery a structure.** A `recovery` field naming the action and its
  arguments, rather than a sentence to be read. Honest for a machine, and more
  work: every error class needs one, and the ones that genuinely have no
  recovery must say so rather than omitting it.

Escalate with a recommendation rather than settling it in a diff — this fixes the
shape of every error the CLI emits.

## Acceptance Criteria

- [ ] The question above is answered in writing
- [ ] Whatever is chosen applies to **every** error class, not only the refusals
      that prompted it — a partial answer leaves a caller guessing which errors
      carry a recovery
- [ ] An error with no meaningful recovery says so explicitly rather than
      omitting the field, so absence is never ambiguous
- [ ] `docs/cli.md`'s exit-code table and the `--json` documentation agree with
      whatever shape lands

## Technical Design

### Files to Create/Modify

- `apps/cli/src/errors.ts`, and every error class if the answer is structural

## Testing Strategy

One case per error class asserting the machine surface carries a recovery, and
one asserting a no-recovery error says so.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
