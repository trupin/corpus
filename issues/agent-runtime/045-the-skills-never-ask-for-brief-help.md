# [AGENT-045] The skills never ask for brief help, so `--help=brief` saves nothing

## Domain

agent-runtime

## Status

done

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

- [x] The workspace skills name `--help=brief` where an agent would reach for help
- [x] They say when the full text is the right call, not only that brief exists
- [x] `scripts/workspace-template.test.ts` resolves every new invocation
- [x] No skill tells an agent to read help it does not need

## Testing Strategy

The template guard already resolves every `corpus …` invocation in the tree
against `docs/cli.md`, so a new one is checked by existing machinery. What needs
a new assertion is the prose rule itself, in the same style as the other skill-
text guards.

## The premise was wrong, and the correction changed the shape of the fix

The Summary above says _"Every worked block that reaches for help still spells
bare `--help`"_. It does not. Measured on the tree at
`eee7fb4f`:

```
$ grep -rn -- "--help" assets/workspace/
assets/workspace/README.md:121:`corpus --help` lists every command.
```

**One occurrence in the whole template, and it is addressed to a person.** No
skill named `--help` in any register. So this was never a find-and-replace over
existing sites — there were none. It was a rule that had to be introduced, which
is why the judgment the issue asked for mattered more than the mechanics.

## Decisions

**1. The rule is stated once, in `orchestrate`, in a section of its own.**

New `## Reading a command's help` between `## Invariants` and `## The loop`. A
section rather than a paragraph inside one, because the rule fires **outside any
task** — an agent reaches for help in the middle of whatever it is doing — so it
has to be findable by heading rather than by whichever section a reader happened
to be in. It is placed with the invariants because it is about talking to the
CLI at all, not about writing, claiming or replying.

`sections.size` for `orchestrate` goes 17 → 18 and `"command's help"` joins the
required-heading list, so the section cannot be silently deleted.

**2. The rule is three arms, and the second one is measured rather than
asserted.**

The issue proposed _brief when checking a name; full when the verb is new;
neither when the skill says it_. The middle arm is written differently, because
"a verb you have not used in this session" is not a property the agent can
check and is not what actually decides it. What decides it is measurable:

> **A brief line names a flag; the whole text says what a wrong value costs.**

Brief is the **first sentence** of each flag's full description, so the two
registers cannot disagree — and the sentences brief drops are the consequence
ones. Three pairs from this workspace's own flags, each read off a real build:

| Flag                        | Brief says                                | The whole text adds                                                                   |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `corpus doc edit --stage`   | where a document sits in a workflow       | a stage inside a kanban **writes a status in the same commit** — one field asked, two changed |
| `corpus doc create --folder`| a folder under `data/docs/`               | a folder passed with `--type thread` is **validated and then has no effect**          |
| `corpus doc edit --columns` | the ids of a board's views, display order | `--columns ""` is an **empty list** and `--unset columns` is **no key at all**        |

So the second arm reads: **the whole text, when a wrong value would write
something you cannot see is wrong.**

A fourth line was drafted and dropped: `corpus doc patch --all`. Its full text
adds _"occurrences are found left to right and never overlap … an excerpt
occurring zero times is refused whether or not this is set"_, which is about
matching rather than about silent damage. The _"it rewrites text you never
looked at"_ warning is the **skill's** sentence, not the help's, so citing it
here would have been citing this skill to itself.

**3. Start brief and escalate — never decide in advance.**

Brief's last line is `Run \`corpus <verb> --help\` for the full text and
examples`, verified on every verb measured. So escalation costs one line and
guessing costs the whole tutorial. Brief-then-full on `corpus doc edit` is 3,594
words against 3,126 for full alone — **15% more in the rare wrong guess, 85% less
in the common right one.** The skill says start brief, and says the third arm
out loud so the section does not become an invitation to read help at all.

**4. `comment` and `converse` carry a pointer. `profile` carries nothing.**

Per the single-owner discipline: the owner states the rule, a consumer carries
the **outcome** and points at the owner. Both pointers say _ask for brief_ and
neither explains when the whole text is right.

`profile` was deliberately left alone. It runs seven verbs and spells every one
of them out with the flags it needs, so a line sending its agent to look a
command up would be sending it to read help it is already holding — which is
acceptance criterion 4, in the one skill where it bites. That follows the
registry's own precedent: `comment` carries no pointer to the weight table
because `comment` never chooses a model. The decision is pinned, not just
described, so reversing it by accident fails a test.

**5. `README.md` keeps bare `corpus --help`.**

Its reader is the workspace's owner at a terminal, in a section headed
_Everything else_, reading it once. `corpus --help` is 466 words and
`--help=brief` 197 — a 269-word saving for a human, against a worse first
impression of the tool. The full register is right there.

## E2E Verification Log

**Model: Opus 5 (1M context).** `npm run build` first, so every measurement
below is the current binary and not a stale `dist/`.

Scratch workspaces under the session scratchpad, servers on **8811** and
**8812**. The user's server on 8765 was not touched.

### 1. Brief vs. full, over the verbs these skills actually name

The 25 verbs came from the skill bodies themselves
(`grep -ohE "corpus [a-z][a-z-]*( [a-z][a-z-]*)?" assets/workspace/claude/skills/*/SKILL.md | sort | uniq -c | sort -rn`),
so this is what a real session reads rather than a chosen sample. Each figure is
`node apps/cli/dist/bin/corpus.js <verb> --help[=brief] </dev/null | wc -w`,
run in a real workspace against a running server.

| verb                 |  full |  brief | saved |
| -------------------- | ----: | -----: | ----: |
| `doc edit`           | 3,126 |    468 |   85% |
| `doc create`         | 2,405 |    364 |   84% |
| `doc show`           | 1,651 |    213 |   87% |
| `thread designate`   | 1,600 |    181 |   88% |
| `doc patch`          | 1,590 |    257 |   83% |
| `thread create`      | 1,548 |    265 |   82% |
| `doc list`           | 1,313 |    366 |   72% |
| `thread reply`       | 1,072 |    188 |   82% |
| `queue idle`         | 1,050 |    160 |   84% |
| `agents`             | 1,005 |    133 |   86% |
| `search`             |   992 |    325 |   67% |
| `doc diff`           |   988 |    158 |   84% |
| `queue claim-all`    |   964 |    148 |   84% |
| `thread context`     |   745 |    148 |   80% |
| `board order`        |   719 |    154 |   78% |
| `queue defer`        |   626 |    166 |   73% |
| `doc related`        |   603 |    171 |   71% |
| `thread show`        |   598 |    140 |   76% |
| `doc archive`        |   579 |    152 |   73% |
| `doc move`           |   553 |    167 |   69% |
| `thread resolve`     |   453 |    133 |   70% |
| `job log`            |   452 |    144 |   68% |
| `queue complete`     |   365 |    141 |   61% |
| `queue fail`         |   354 |    148 |   58% |
| `queue reap-stale`   |   336 |    133 |   60% |
| **TOTAL**            | **25,687** | **5,023** | **80%** |

**80% over the whole surface these skills use**, against CLI-056's 82% on its
four. The floor is 58% (`queue fail`) and the ceiling 88% (`thread designate`),
so no verb in the set is a case where brief saves nothing.

### 2. What the rule costs, since it is words too

Word deltas from `git diff -U0`, added minus removed:

| file                       | added | removed |
| -------------------------- | ----: | ------: |
| `orchestrate/SKILL.md`     |   869 |      59 |
| `comment/SKILL.md`         |    69 |       0 |
| `converse/SKILL.md`        |   120 |       0 |
| `boards/attention.md`      |    77 |      49 |

Of `orchestrate`'s 869, the help section is **470** and the board-order
correction is the rest. No session reads all three help passages: an orchestrator
reads 470 words, a comment subagent 69, a resident 120.

**The section pays for itself on the first help read it redirects.** One avoided
`corpus doc edit --help` is 3,126 − 468 = **2,658 words**, against 470 spent
once per session.

### 3. The registers behave as the skill says they do

```
$ corpus board order --help=brief
corpus board order — Set the order of the board bar, in one act and one commit.
…
Run `corpus board order --help` for the full text and examples.
```

The escalation line is present on every verb measured. And brief really is the
first sentence — `--columns`, side by side:

```
brief: **The columns of a `type: board` document**: the ids of the `type: view`
       documents that render them, in display order (SPEC.md §10, rider 2).
full:  …same sentence… Comma-separated rather than repeatable because the order
       _is_ the value. … `--columns ""` sets an **empty list**, which is what the
       Files board is; `--unset columns` removes the key altogether…
```

### 4. The board-order correction, reproduced then fixed

**Reproduction of the defect, on a real server (8811).** Three
`corpus doc edit --order` writes, the way `attention.md` and `orchestrate`
told the agent to reorder a bar:

```
$ corpus doc edit doc_seedboardfiles --order 1 --from agent
$ corpus doc edit doc_seedboardattention --order 2 --from agent
$ corpus doc edit doc_seedboardbystatus --order 3 --from agent
$ git log --oneline -2
aa92dd3 doc edit: By status (doc_seedboardbystatus) by agent
fddc602 workspace: initialize corpus workspace by user
```

**One commit for an act over three boards, named after one of them** — exactly
the defect reported, and the commit names whichever board went last rather than
`Files` as predicted. Then the same reorder with more than `SQUASH_IDLE_MS`
(30 s, `apps/server/src/git/commit.ts:69`) between the writes:

```
1ff9970 doc edit: Files (doc_seedboardfiles) by agent
04df0b6 editing session: 1 document by agent
33d098e editing session: 3 documents by agent
```

**Three commits, none of which names the act.** So the stale instruction is
worse than mis-labelled: what it produces depends on timing the agent does not
control. That is the second half of the correction, and `docs/cli.md` states the
mechanism — §4's window "holds only until the window closes between two of them".

**The fix, on a workspace installed from the corrected template (8812).** Run
exactly as the new skill text spells it:

```
$ corpus board order doc_seedboardfiles doc_seedboardattention doc_seedboardbystatus --from agent
doc_seedboardfiles      1  moved
doc_seedboardattention  2  moved
doc_seedboardbystatus   3  moved
ordered 3 boards — 3 boards moved, in one commit 664bb132520be8fec2af8a87c949d6769aa18923
$ git show --stat --oneline HEAD
664bb13 board reorder: 3 boards by agent
 data/docs/boards/attention.md | 2 +-
 data/docs/boards/by-status.md | 2 +-
 data/docs/boards/files.md     | 2 +-
 3 files changed, 3 insertions(+), 3 deletions(-)
```

**One commit, named after the act, carrying all three boards.**

Every other claim the new text makes, verified on the same server:

- _"a bar handed back the way it already stood writes nothing at all"_ — repeat
  run printed three `unchanged` rows and `none moved, so nothing was written`,
  and `git log | wc -l` stayed at 2.
- _"an id named twice … refused"_ — `400`, exit 5, message
  `\`doc_seedboardfiles\` is named twice`, nothing written.
- _"an id naming something that is not a board … refused"_ — passing a view id
  gave `400`, exit 5, `doc_seedattention is a \`view\` document, not a board`,
  nothing written.
- `corpus doc check` on the freshly installed workspace: `checked 12 documents —
  no findings.`

### 5. The sweep for a second copy

The orchestrator named `data/docs/boards/attention.md`. There was a second copy,
in `orchestrate/SKILL.md`, and it was the one that mattered — it taught
`--order 1.5` as the way to slot a board between two neighbours, which is a
per-document write dressed as a technique. Both are corrected.

Not changed, with reasons:

- `data/docs/boards/files.md` and `README.md` both say _"reorder them"_ about
  boards. Neither names a mechanism, so neither is stale.
- `--order` at **creation** (`corpus doc create --type board … --order 4`) and
  `--order` in the delta-verbs list are both still correct and untouched. The
  new text says so outright: `--order` is still right on **one** board.

### 6. Guards

`VITEST_MAX_THREADS=4 vitest run scripts/workspace-template.test.ts` — **432
passed**. Also green: `apps/cli/src/template/install.test.ts`,
`apps/cli/src/commands/hygiene.test.ts`, `scripts/pack-audit.test.ts`,
`packages/kit/src/weight/weightLevels.test.ts`. `eslint` and
`./node_modules/.bin/prettier --check` clean on the test file.

Three guards added or moved:

1. **`sections.size` 17 → 18** and `"command's help"` in the required-heading
   list for `orchestrate`.
2. **`asks for the brief help register in every skill that reaches for help`** —
   `orchestrate`, `comment` and `converse` must contain `--help=brief`, and
   `profile` must contain no `--help` at all. The second half is decision 4,
   executable.
3. **A `SINGLE_OWNER_RULE` for `"which register of a command's help a reading
   needs"`**, owned by `orchestrate`, with the two pointers registered. A
   restatement is a sentence naming **both** registers — one alone is a fact any
   skill may state, which is what keeps the pointers off the pin. Probed against
   the real bodies: `orchestrate` **2** restatements, `comment` **0**,
   `converse` **0**, `profile` **0**.

   Its companion test claims a net rather than a proof, in the house style: it
   catches three real second-account shapes, and asserts out loud that it misses
   _"Read `--help=brief` unless a bad value would write something silently"_. It
   also asserts the pin does **not** fire on the ordinary word `brief` — both
   loop skills use it, and a pin that fires on _"a brief reply"_ is a pin
   somebody baselines away.

**The passage pin earned its keep during this issue.** The first draft of the
two pointers shared thirteen words —
`synopsis and one line per argument and flag which is what a lookup wants and` —
and `states no passage in two skills that is not a recorded decision` reported
it. Reworded rather than recorded, per the rule that deleting the second copy is
the only fix that cannot drift. Nothing new was added to `STATED_TWICE`: the
shared pointer clause _"is the orchestrate skill's to state, and it is stated
there alone"_ is already recorded from AGENT-035.

**Invocation resolution (criterion 3), proved rather than assumed.** The three
flag examples are written with the `corpus ` prefix on purpose, so the
extractor sees them and checks them against `docs/cli.md`. Probing
`extractCorpusInvocationUses` over the real bodies returns
`{"tokens":["doc","edit"],"flags":["--help"]}`,
`{"tokens":["doc","edit"],"flags":["--stage"]}`,
`{"tokens":["doc","create"],"flags":["--folder"]}`,
`{"tokens":["doc","edit"],"flags":["--columns"]}` and three `board order` uses
including the seed board document — so a flag renamed under any of them fails
this suite.

### 7. What this E2E is not

No live `claude` session was driven. This issue changes what a skill **says**,
and every claim it now makes is a claim about the CLI, so the evidence that
matters is real invocations against a real build — which is what is above. There
is no loop behaviour here for a transcript to show.

## Filed rather than fixed

**AGENT-046** — `grep -rn "corpus folder" assets/workspace/` returns nothing.
Four bulk verbs (`corpus folder archive|unarchive|rename|delete`), each landing
one commit for one act, and no skill names any of them — while the stewardship
charter's _"obsolete documents are archived"_ and _"misfiled documents are
moved"_ are both written per document, and `orchestrate` already speaks of _"a
folder one event reorganizes"_. Same shape as the board-order defect one level
up, but the answer is not obviously "add the verbs": a folder act is bounded by
nothing the agent chose. Written up rather than widened into this pass.
