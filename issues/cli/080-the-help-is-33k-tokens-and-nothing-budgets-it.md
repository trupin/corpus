# [CLI-080] The help is 33K tokens and nothing budgets it

## Domain

cli

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Related: CLI-056 (`--help=brief`, which built the cheap register), INFRA-038
  (the same idea for skills — this is the CLI's own copy of it)

## Spec References

- SPEC.md **§2.3** — one registry, self-documenting
- SPEC.md **§11** — `docs/cli.md` regenerates from the registry

## Summary

Measured 2026-09-05 against the built 0.32.0 CLI.

The registry's description literals total **134,784 bytes (~33,700 tokens)** —
the CLI's help is a second orchestrate-sized document, and it is read through
the hole CLI-056 left: brief is cheap *relative to full*, not cheap.

| Verb | `--help` | `--help=brief` |
| --- | --- | --- |
| `doc edit` | 5,209 tok | 897 tok |
| `doc create` | 4,184 tok | 713 tok |
| `doc list` | 3,157 tok | 855 tok |
| `doc show` | 2,778 tok | 413 tok |
| `search` | 2,541 tok | 704 tok |
| fifteen hot verbs together | 33,625 tok | 6,688 tok |

The skills instruct *ask brief first*, and a brief that costs **855 tokens**
answers a question — *what is the flag called?* — worth about 30. Brief's cost
is the sum of every flag's first sentence, so the verbs with the most flags are
the most expensive to look up, which is backwards: those are the verbs looked
up most.

**The description strings also load on every invocation.** CLI-058 measured
first-party module init at 24.8 ms and registry validation as free — this issue
does not claim a startup win, and must not: the cost here is context, paid when
help is read.

## What to build

Two halves, the same shape as INFRA-038: a budget that gates, and the rewrite
that gets under it.

### 1. A budget in `validateRegistry`

The registry already self-validates at load (`gloss.ts` checks every
description's opening sentence — the hook exists and is tested). Add:

- a **brief budget per verb**: summary + each flag's first sentence + the
  synopsis, at most **1,600 bytes (~400 tokens)**;
- a **full budget per verb**: at most **8,000 bytes (~2,000 tokens)**;
- both enforced as registry problems, so a violation fails the build the way a
  malformed gloss already does. A ratchet file is unnecessary here: only five
  verbs exceed the full budget today and one exceeds none after the rewrite
  below — the numbers are settled by this issue landing, not by a baseline.

### 2. Rewrite the outliers

`doc edit` (8,669 B of literals), `doc create` (6,630), `doc patch` (5,947),
`workspace upgrade` (5,739), `thread create` (5,600). The pattern in each is
the same one AGENT-067 names in orchestrate: the instruction is short and the
litigation around it is not. What a wrong value silently costs **stays** — the
orchestrate skill's help-reading section names three flags whose full text is
the only warning (`--stage`, `--folder` with `--type thread`, `--columns` vs
`--unset`), and those sentences are load-bearing. What goes is duplicated
narrative: the same rule stated in the verb's description, again per flag, and
again in an example's caption.

## What must not happen

- **No sentence that names a silent-damage consequence is cut.** List the three
  the orchestrate skill cites, verify each survives, and say so in the log.
- **Brief's contract holds**: a flag's brief line stays the first sentence of
  its full description, so the two registers cannot disagree (CLI-056's rule).
- **`docs/cli.md` keeps regenerating** from the same strings — no second copy.

## Acceptance Criteria

- [ ] `validateRegistry` enforces both budgets and a violation names the verb,
      the register, the size and the budget.
- [ ] Every verb passes. The five outliers are rewritten, not exempted.
- [ ] The three silent-damage sentences survive verbatim, verified.
- [ ] Total description literals drop below **80,000 bytes**. Record before and
      after.
- [ ] `--help=brief` for `doc list` and `doc edit` lands at or under 400
      tokens. Record the numbers.
- [ ] `docs/cli.md` regenerates cleanly and its drift check passes.
- [ ] The registry's own load-time cost does not regress
      (`npm run bench:startup -w apps/cli` before and after — CLI-058's
      benchmark, reused).

## Technical Design

### Files to Create/Modify

- `apps/cli/src/registry/validate.ts` and `gloss.ts` — the budgets.
- `apps/cli/src/registry/validate.test.ts` — over- and under-budget fixtures.
- The five outlier command modules.
- `docs/cli.md` — regenerated.

### Key Implementation Details

Count in **bytes of the rendered register**, not of the source literals —
what a reader pays is the output. Render brief and full through the existing
help renderer inside the validator, so the budget measures the same bytes the
agent reads.

### Edge Cases

- A verb with many flags whose first sentences are each honest can breach the
  brief budget structurally. The fix is shorter first sentences, not fewer
  flags in brief — brief listing every flag is its contract.
- Topic-level help (`corpus doc --help`) — decide whether it gets a budget,
  and record it.

## Testing Strategy

- Validator fixtures: one verb over each budget → registry problem naming it.
- A test asserting the three silent-damage sentences exist in the registry,
  quoted, so a later rewrite cannot drop them silently.

## E2E Verification Plan

### Verification Steps

1. `npm run build` and run the built CLI: `--help=brief` and `--help` for the
   five rewritten verbs, `wc -c` each, recorded against the table above.
2. `node --import tsx scripts/check-generated-artifacts.ts` — docs drift clean.
3. `npm run bench:startup -w apps/cli` — no regression.

## E2E Verification Log

_Filled in by the implementing agent. State which model it ran on._

### Post-Implementation Verification

_[Agent fills: the size table after, the three sentences, the bench numbers]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E log with the full before/after table
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (touches every command module — qualifies)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-080]` prefix
