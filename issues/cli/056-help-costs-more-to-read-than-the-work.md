# [CLI-056] Help text costs an agent more to read than the work it describes

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
- Related: CLI-055 (same complaint, the read path), CLI-058 (per-invocation cost)

## Spec References
- SPEC.md **§2.3** — the command registry and generated `docs/cli.md`

## Summary

Reported from live use, 2026-08-21, with counts.

Help is the most expensive thing an agent reads in this CLI:

| Topic | Words |
| --- | --- |
| `doc edit --help` | 2,214 |
| `doc create --help` | 1,667 |
| `doc list --help` | 1,119 |
| `thread reply --help` | 1,020 |
| all 10 topic helps | 4,003 |

Reading help for four commands costs roughly **7,000 words**. `--is-parent`
alone runs 180 words inside `doc list`.

**The prose is not the problem and must not be cut.** It is precise, it is why
the commands are usable, and a person reading `doc edit --help` is well served.
The defect is that there is exactly one register, and an agent that needs to
recall a flag name pays a tutorial to get it.

## What to build

`--help=brief`: flag names and one-line glosses, nothing else. The full text
stays the default, unchanged.

## Decisions to make and record

1. **Where the brief gloss comes from.** Deriving it from the first sentence of
   the long text keeps one source and cannot drift — but a first sentence
   written for prose may not be a good gloss. A second field per flag is
   honest and can rot. Choose, and say what keeps the two in step.
2. **Whether `docs/cli.md` gains the brief form too.** It is generated and
   drift-checked (§2.3, §14), so anything added here must survive that check.
3. **Whether the agent's own skills should be taught to use it.** A brief mode
   nothing invokes has saved nothing — this may want an `agent-runtime` issue
   behind it, and if so, file it rather than assuming.

## Acceptance Criteria
- [ ] `--help=brief` emits flags and one-line glosses only
- [ ] Full help is unchanged and remains the default
- [ ] Every flag has a gloss — a missing one is a test failure, not a blank line
- [ ] The saving is measured against the numbers above and reported
- [ ] `docs/cli.md` regenerates cleanly and the drift check passes

## Testing Strategy
A registry-wide test asserting every flag in every command has a gloss, so a new
flag cannot ship without one. Snapshot the brief output for two commands.

## E2E Verification Log
_[Agent fills — state the model]_
