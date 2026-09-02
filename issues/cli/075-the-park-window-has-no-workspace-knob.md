# [CLI-075] The park window has no workspace knob

## Domain

cli

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: nothing hard. INFRA-033/INFRA-034 run without it, slowly: every
  rehearsal run that reaches a park sits out most of a 480 s window.

## Spec References

- SPEC.md §7 — the queue, parking, and `corpus queue idle`

## Summary

Filed from INFRA-033, under its rule that a capability the suite needs and the
product lacks is a product gap to file, never something the harness works
around. `corpus queue idle`'s window is `--wait <seconds>` with the default
fixed at `DEFAULT_IDLE_TIMEOUT_SECONDS` (480, `@corpus/contract`). Nothing lets
a *workspace* or an *environment* change the default: not `.corpus/config.json`,
and no `CORPUS_*` variable (`CORPUS_PORT` is the precedent for exactly this
kind of operational override).

The rehearsal harness needs parks of seconds, and its rule 1 forbids the two
available workarounds: telling the agent to pass `--wait 5` would put
operational test text in a prompt that must carry nothing but the workspace
path and the follow-your-skill instruction, and shimming the CLI to inject the
flag would make the rehearsed loop not the shipped loop. INFRA-033's fixture
criterion — "`--wait` short enough that a park is seconds" — is therefore
unimplementable today, and rehearsal runs carry a ~480 s tail
(`rehearsals/scenarios/03-one-question-one-answer.ts` documents the budget it
forces).

## Acceptance Criteria

- [ ] A workspace or environment override changes the *default* window of
      `corpus queue idle` — an explicit `--wait` still wins. The mechanism is
      the implementer's choice (a `CORPUS_` environment variable in the
      `CORPUS_PORT` mould is the lightest); wherever it lands, the CLI help
      names it.
- [ ] The override is bounded the way `--wait` is bounded (never above
      `MAX_IDLE_TIMEOUT_SECONDS`), and an unparseable value is a loud refusal,
      not a silent 480.
- [ ] `rehearsals/fixture.ts` adopts it and the scenario budgets shrink
      accordingly.

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/queue/idle.ts` — default resolution
- `packages/contract` — only if the constant's story needs restating
- `rehearsals/fixture.ts`, `rehearsals/scenarios/*.ts` — adopt

### Key Implementation Details

`idle.ts` resolves `context.flags.number("wait") ?? DEFAULT_IDLE_TIMEOUT_SECONDS`
today. Insert the override between the two. Keep the resolution order
flag > override > default, matching `--from` / `CORPUS_FROM` / `user`.

### Edge Cases

- A zero or negative override: follow whatever `--wait 0` already means.
- The override must not leak into `corpus queue idle --help` examples as if it
  were a flag.

## Testing Strategy

Unit tests beside `idle.test.ts`: flag wins over override, override wins over
default, refusal on garbage.

## E2E Verification Plan

### Verification Steps

1. In a scratch workspace with a running server, set the override to 3 and run
   `corpus queue idle` with an empty queue.
2. Expected: the park returns with the timeout line after ~3 s, not 480.
3. Run again with `--wait 6` and the override set to 3; expected ~6 s.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
