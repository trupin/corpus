# [CLI-024] SIGPIPE guard: piped output must not die with an EPIPE stack trace

## Domain
cli

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: CLI-001
- Blocks: —

## Spec References
- None product-behavioral — CLI robustness (Phase 7 eval finding, 2026-07-31)

## Summary
Evaluator observed `corpus doc show <104KB doc> | head -6` emit an unhandled Node
EPIPE stack trace (once; not reproduced in 15 trials — the race depends on flush
timing vs. head's exit). A CLI whose skills teach piping (`search | …`, `doc show`)
must exit quietly when its reader goes away: handle EPIPE on stdout/stderr globally
(exit 0 silently, the POSIX convention), in the bin entry so every verb is covered.

## Acceptance Criteria
- [ ] Deterministic test: writer with a closed-early pipe exits 0, no stack trace (simulate by closing the stream, not by racing `head`)
- [ ] Normal error output paths unaffected

## Technical Design
### Files to Create/Modify
- `apps/cli/src/bin/corpus.ts` (or the shared output layer) + test

## Testing Strategy
apps/cli scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
`corpus doc show <big doc> | head -1` in a loop; zero stack traces.

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
