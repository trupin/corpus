# [CLI-056] Help text costs an agent more to read than the work it describes

## Domain
cli

## Status
done

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
   drift-checked (§2.3, §11), so anything added here must survive that check.
3. **Whether the agent's own skills should be taught to use it.** A brief mode
   nothing invokes has saved nothing — this may want an `agent-runtime` issue
   behind it, and if so, file it rather than assuming.

## Decisions, as made

**1. The gloss is derived, not declared.** `--help=brief` renders the **first
sentence** of each description, extracted by `apps/cli/src/gloss.ts`. There is
one string per flag, so the two registers cannot drift: the brief line _is_ the
opening sentence of the full one.

What keeps the derived form worth reading is a registry rule rather than a hope.
`collectRegistryProblems` measures every flag's, every argument's and every
global flag's opening sentence and refuses the registry at module load when one
runs past **30 words** (`MAX_GLOSS_WORDS`). That converts _"the first sentence
should stand alone as a gloss"_ from a style note into a checked property, and
it costs the long prose nothing — splitting a 33-word opener improves the
paragraph a person reads too. Two descriptions failed the new rule and were
split: `doc check --staged` and `doc create --folder`. Nothing was deleted.

The sentence splitter is not naive. It skips terminators inside code spans
(`` `a.b.c` ``), inside references and numbers (`SPEC.md`, `§9.2`, `1.5`) and
after abbreviations (`e.g.`), and carries closing markdown across the terminator
so `**A view's stored query.**` glosses to eight words rather than running into
the next three paragraphs.

**2. `docs/cli.md` does not gain the brief form.** The gloss is literally the
first sentence of a description the table already prints in full, so a second
column would be bytes already on the page and a second thing the drift check
has to hold. The reference is read in a browser, where nothing is paid per
token. What it _did_ gain is the paragraph explaining the two registers, and the
`-h, --help[=<mode>]` row, because both would otherwise be wrong.

**3. Filed, not assumed.** `issues/agent-runtime/045-the-skills-never-ask-for-brief-help.md`
— the workspace skills all spell bare `--help`, so nothing invokes the new mode
yet. The measurements are in that issue.

**4. `--help` carries a value now, and never reads the next token.** `FlagSpec`
gained `bareValue?: string`: a string flag whose value comes from the inline
`--flag=value` form alone. Without it `corpus doc list --help` would swallow a
positional and `corpus --help doc` would lose the topic. The dispatcher excludes
such flags from its "this flag eats the next token" scan for the same reason.
`--help=true`, an artefact of the old boolean type, is now a usage error naming
the two real modes.

## Measured saving

Real `corpus` invocations, `wc -w`, build 0.19.0 on 2026-08-23:

| Help                    | Before (filed) | Full, after | Brief |         Saving |
| ----------------------- | -------------: | ----------: | ----: | -------------: |
| `doc edit --help`       |          2,214 |       3,126 |   468 |            85% |
| `doc create --help`     |          1,667 |       2,405 |   364 |            85% |
| `doc list --help`       |          1,119 |       1,313 |   366 |            72% |
| `thread reply --help`   |          1,020 |       1,072 |   188 |            82% |
| **those four together** |     **~7,000** |   **7,916** | 1,386 |        **82%** |
| all 10 topic helps      |          4,003 |       4,799 |   759 |            84% |
| `corpus --help`         |              — |         466 |   197 |            58% |

Two honest notes on that table. The "before" column is the issue's own count
from 2026-08-21; the surface has grown since, which is why the full column is
larger. And full help grew a further **+52 words per command** in this change,
because documenting `--help=brief` lengthened the `--help` row that every help
block prints. That is the price of the feature and it is paid by the register
the agent is being moved off. The `--help` description was cut roughly in half
from its first draft to keep that number at 52 rather than 93.

`--is-parent`, the issue's 180-word example, glosses to nine words:
_"Whether the document is a **child of something** (SPEC.md §9.2)."_

## Acceptance Criteria
- [x] `--help=brief` emits flags and one-line glosses only
- [x] Full help is unchanged and remains the default — `corpus thread reply --help`
      and `--help=full` are byte-identical, and `renderCommandHelp` in `full` mode
      is untouched
- [x] Every flag has a gloss — a missing one is a test failure, not a blank line
      (`registry/validate.ts`, plus a 178-case `it.each` over the shipped registry
      in `gloss.test.ts`)
- [x] The saving is measured against the numbers above and reported
- [x] `docs/cli.md` regenerates cleanly and the drift check passes

## Testing Strategy
A registry-wide test asserting every flag in every command has a gloss, so a new
flag cannot ship without one. Snapshot the brief output for two commands.

## E2E Verification Log

**Model: Opus 5 (1M context).** Real `corpus` binary from `apps/cli/dist`, real
workspace at `.../scratchpad/ws`, real server on port 9377 (the user's 8765
server was never touched).

```
$ corpus init .../scratchpad/ws --port 9377
Initialized Corpus workspace at .../scratchpad/ws
$ corpus server start
corpus 0.19.0 listening on http://127.0.0.1:9377 (pid 47611)
$ corpus health
ok — corpus 0.19.0, up 3s, workspace .../scratchpad/ws
```

**Word counts, full vs brief** (`corpus <verb> --help | wc -w`):

```
doc edit       full=3126   brief=468
doc create     full=2405   brief=364
doc list       full=1313   brief=366
thread reply   full=1072   brief=188
```

**The brief output itself:**

```
$ corpus doc list --help=brief
corpus doc list — Query the document collection: what is in the corpus, and what needs attention.

Usage:
  corpus doc list [flags]

Flags:
  --q <text>                Full-text query across titles, bodies and turn bodies.
  --type <a,b>              Comma-separated document types; values OR together.
  --tag <a,b>               Comma-separated tags; values OR together.
  --folder <path>           Path prefix under `data/docs/`, matching the folder and its descendants.
  …
Global flags:
  …
  -h, --help[=<mode>]  Show help for the current topic or command and exit.

Run `corpus doc list --help` for the full text and examples.
```

**An unknown mode is a usage error at all three levels, and names the two real ones:**

```
$ corpus --help=short;        # root
corpus: unknown help mode "short".
  Usage: `--help` for the full text, `--help=brief` for names and one line each. Modes: full, brief.
root exit=2
$ corpus doc --help=short;    # topic  → exit=2, same message
$ corpus doc list --help=short  # verb → exit=2, same message
```

**`--help` still does not swallow the token after it** (the `bareValue` rule):

```
$ corpus --help doc
corpus doc — List, read, check, create, edit, move, archive, unarchive and delete documents.
…
```

**Bare `--help` is byte-identical to `--help=full`:**

```
$ diff <(corpus thread reply --help) <(corpus thread reply --help=full) && echo identical
identical
```

**Help under `--json` is still human text:**

```
$ corpus health --help=brief --json | tail -2

Run `corpus health --help` for the full text and examples.
```

### Checks

- `npm test -w apps/cli` — **102 files, 1,982 tests, all pass**
- `npx vitest run scripts` — **18 files, 919 tests, all pass** (the template
  guard reads the regenerated `docs/cli.md`)
- `tsc -p apps/cli/tsconfig.json --noEmit` — clean
- `eslint apps/cli/src` — clean, no rule disabled
- `prettier --check "apps/cli/src/**/*.ts" docs/cli.md` — clean
- `npm run docs:cli -w apps/cli` then `prettier --check docs/cli.md` — clean

### Falsification

Every new test was watched to fail with the fix removed:

| Break                                                        |            Result |
| ------------------------------------------------------------ | ----------------: |
| `gloss()` returns the whole description                      | 6 failures across 3 files |
| `bareValue` branch deleted from `parse-args.ts`              | 10 failures across 2 files |
| gloss cap short-circuited in `validate.ts`                   |        2 failures |
| `bareValue` exclusion removed from the dispatcher's scan     |        2 failures |

No test was found that could not be made to fail.
