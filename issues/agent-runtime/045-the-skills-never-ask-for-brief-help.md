# [AGENT-045] The skills never ask for brief help, so `--help=brief` saves nothing

## Domain

agent-runtime

## Status

todo

## Priority

P1 (important)

## Model

opus

## Dependencies

- Depends on: CLI-056 (which built `--help=brief`)
- Related: CLI-055 (the read path), CLI-058 (per-invocation cost)

## Spec References

- SPEC.md **§2.3** — the command registry and the generated `docs/cli.md`

## Raised to P1 by the orchestrator, 2026-08-23

Filed P2. Raised because v0.20.0's headline says the agent stops paying to use
the CLI, and CLI-056's 82% saving is **not taken** until a skill asks for the
brief register. Shipping the mode with nothing invoking it would put a number in
the release notes that no workspace collects. `work-until-release`'s rule is
blunt about it: a release ships every part needed to *use* the thing, not merely
to have built toward it.

## Summary

Filed by CLI-056, whose decision 3 says so outright: _"A brief mode nothing
invokes has saved nothing — this may want an `agent-runtime` issue behind it,
and if so, file it rather than assuming."_

`corpus <verb> --help=brief` now prints the synopsis and one line per argument
and flag, and nothing else. Measured on a real build, 2026-08-23:

| Help                       | Full (words) | Brief (words) | Saved |
| -------------------------- | -----------: | ------------: | ----: |
| `doc edit`                 |        3,126 |           468 |   85% |
| `doc create`               |        2,405 |           364 |   85% |
| `doc list`                 |        1,313 |           366 |   72% |
| `thread reply`             |        1,072 |           188 |   82% |
| **those four together**    |    **7,916** |     **1,386** |   82% |
| all 10 topic helps         |        4,799 |           759 |   84% |
| `corpus --help`            |          466 |           197 |   58% |

Nothing in `assets/workspace/` invokes it. Every worked block that reaches for
help still spells bare `--help`, so an agent recalling a flag name still pays
the tutorial. The saving exists and is not being taken.

## The question this issue has to answer

**Which register does an agent want, and when?** The answer is not "always
brief" — an agent meeting `corpus doc patch` for the first time needs the
prose, and the prose is why the commands are usable. A plausible rule is:

- brief when the agent knows the verb and is checking a name or a spelling
- full when it is about to use a verb it has not used in this session
- neither when `docs/cli.md` or the skill itself already says it

Whether that rule is worth writing down, or whether one sentence naming the
flag is enough, is the judgment this issue makes. **A skill that teaches the
wrong rule costs more than one that teaches none.**

## Acceptance Criteria

- [ ] The workspace skills name `--help=brief` where an agent would reach for help
- [ ] They say when the full text is the right call, not only that brief exists
- [ ] `scripts/workspace-template.test.ts` resolves every new invocation
- [ ] No skill tells an agent to read help it does not need

## Testing Strategy

The template guard already resolves every `corpus …` invocation in the tree
against `docs/cli.md`, so a new one is checked by existing machinery. What needs
a new assertion is the prose rule itself, in the same style as the other skill-
text guards.

## E2E Verification Log

_[Agent fills — state the model]_
