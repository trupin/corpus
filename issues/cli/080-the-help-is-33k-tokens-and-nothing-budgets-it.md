# [CLI-080] The help is 33K tokens and nothing budgets it

## Domain

cli

## Status

done

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

- [x] `validateRegistry` enforces both budgets and a violation names the verb,
      the register, the size and the budget.
- [x] Every verb passes. The thirteen the validator named (the five outliers
      included) are rewritten, not exempted.
- [x] The three silent-damage sentences survive verbatim, verified, and
      test-pinned.
- [ ] Total description literals drop below **80,000 bytes**. Recorded before
      (212,194) and after (182,407) — the criterion's 134,784 baseline was a
      mis-measure; see the E2E log's deviation note.
- [x] `--help=brief` for `doc list` and `doc edit` lands at or under 400
      tokens (399 and 368).
- [x] `docs/cli.md` regenerates cleanly and its drift check passes.
- [x] The registry's own load-time cost does not regress
      (`bench-startup`: 195.1 ms → 194.5 ms total, within noise).

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

Implementing agent: **cli-dev on Fable 5** (`claude-fable-5`), 2026-09-05.

### Post-Implementation Verification

All numbers below are `wc -c` of the **built** CLI's output
(`apps/cli/dist/bin/corpus.js`), run inside a real scaffolded workspace
(`corpus init` on port 8971; server started, exercised, stopped; port verified
free afterwards). "Before" is the dist built from this branch's tip **before**
the rewrite; "after" is the rebuilt dist.

| Verb | full before | full after | brief before | brief after |
| --- | --- | --- | --- | --- |
| `doc edit` | 20,838 | **7,924** | 3,588 | **1,470** |
| `doc create` | 16,736 | **7,982** | 2,853 | **1,357** |
| `doc list` | 13,461 | **7,938** | 3,421 | **1,596** |
| `upgrade` | 11,626 | **7,037** | 1,658 | **728** |
| `thread create` | 11,402 | **7,697** | 2,115 | **1,111** |
| `doc show` | 11,112 | **7,879** | 1,653 | **723** |
| `doc patch` | 10,650 | **7,889** | 1,896 | **952** |
| `thread designate` | 10,611 | **6,737** | 1,482 | **552** |
| `search` | 10,166 | **7,510** | 2,819 | **1,309** |
| `thread show` | 9,727 | **7,567** | 1,708 | **778** |
| `workspace upgrade` | 8,458 | **6,298** | 1,453 | **523** |
| `thread reply` | 8,157 | **5,414** | 1,454 | **510** |
| `queue idle` | 8,085 | **5,925** | 1,285 | **355** |

- **The validator named 13 over-budget verbs, not 5** — the issue's "only five
  exceed the full budget" undercounted, because the budget measures the
  rendered page (layout, examples and the then-repeated global-flags block
  included). All 13 were rewritten; none exempted.
- **Every one of the 61 verbs and 11 topic pages now passes both budgets**
  (max full 7,982 `doc create`; max brief 1,596 `doc list`).
- **Brief tokens** (bytes/4): `doc edit` ≈ 368, `doc list` ≈ 399 — both at or
  under the 400-token criterion.
- **The three silent-damage sentences survive**, verified in the built CLI
  (`grep -c` = 1 each on the full help): `--stage`'s same-commit status write,
  `--folder`+`--type thread`'s validated-then-no-effect, and
  `--columns ""` vs `--unset columns`. `validate.test.ts` now pins all three
  by quoted fragment, so a later rewrite fails a test rather than dropping
  them silently.
- **Bench** (`bench-startup.ts`, 25 runs, minimum, same workspace, server up):
  before — total `corpus health` 195.1 ms (boot 59.0, module graph 107.0,
  round trip 29.1; medians: version 171.8, health 205.8). After — total
  194.5 ms (boot 42.6, module graph 122.2, round trip 29.7; medians: version
  174.9, health 203.6). No regression: totals and medians are within run
  noise.
- `docs/cli.md` regenerated from the registry (163 insertions, 291
  deletions) and Prettier-clean; `generate.test.ts`'s committed-copy
  assertion passes. The shared `check-generated-artifacts` script reports it
  "stale" only against HEAD, which resolves when this lands in one commit.
- Full CLI suite: **2,329 passed, 0 failed** (`VITEST_MAX_THREADS=4`).

### Aggregates

| Metric | before | after |
| --- | --- | --- |
| Rendered full help, all 61 verbs | 363,274 B | **201,107 B** |
| Rendered full help, 15 hottest verbs | 166,211 B | **104,659 B** (~26k tok) |
| Description literals (summary + descriptions + examples) | 212,194 B | **182,407 B** |

**Deviation — the "< 80,000 bytes of literals" criterion.** The issue's
baseline of 134,784 B is not the literal total of this tree (measured:
212,194 B before this work); 134,784 happens to equal the sum of the **top
eleven verbs' rendered full pages** to within 3 bytes, so the criterion was
calibrated on a rendered-page measure mislabelled as literals. On the
rendered measure the reader actually pays, the hot-verb total fell 37% and
the whole surface 45%. Getting *literals* under 80,000 would require gutting
all 48 verbs the validator never named — outside "rewrite the outliers until
every verb passes" — so the enforced per-verb budgets are the ratchet and
this line is reported, not met. Orchestrator to adjudicate.

### Decisions

1. **Topic-level help is budgeted**, same two caps as verbs (the question the
   issue left open). All 11 topic pages pass with head-room.
2. **The global-flags block moved** (this is what made the budgets reachable
   at all): the ~900-byte glossed block, identical on every page, now lives
   **only** on `corpus --help`. A verb or topic **full** page carries the
   names on one line (`` Global flags: --from, … (`corpus --help`). ``), so
   "does this verb take `--json`?" is still answered locally. **Brief carries
   no global flags** — matching the issue's own budget definition ("summary +
   each flag's first sentence + the synopsis") and what topic and root brief
   already did. This supersedes CLI-056's "globals stay in brief, glossed".
3. **Compression doctrine** for the last mile: a fact the tool states at the
   moment it matters — a refusal naming the fix, a printed warning — may
   shrink to a clause in help; a fact that fails **silently** keeps its
   sentence. Notable cuts under it: enumerations moved out of brief glosses
   (a wrong value still gets them, listed, in the usage error), spec-history
   citations (SERVER-039, SHARED-066, AGENT-061…), worked examples whose rule
   is already stated (`--kanban`'s full inline example among them), and
   per-verb restatements of rules another flag or the description owns.
4. Placeholders narrowed where they set the padded column width
   (`true|false`→`bool`, `key=json`→`k=json`, `number|null`→`n|null`,
   `date|keyword`→`when`, `user|agent`→`actor`); the value shapes stay stated
   in each description.
5. **For agent-runtime**: the orchestrate skill's help-reading section
   paraphrases two brief glosses that changed shape (`--columns` now opens
   "The columns of a `type: board` document."; `--stage` unchanged). Its
   point — brief stops before the silent-damage sentence — still holds; the
   paraphrase is one revision stale.
6. **Pre-existing failure, not touched**: `npm run typecheck -w apps/cli`
   fails with 7 errors in `src/commands/thread/context.test.ts` (fixtures
   missing the now-required `digest` key) — a file this issue never modified,
   failing on the `phase-57-token-ledger` base before this work. Left for the
   CLI-076/078/079 owner.

## Completion Checklist (domain agent)

- [x] Tests written and passing (budget fixtures over/under both registers,
      topic-path and topic-page budgets, the three-sentence guard; full CLI
      suite 2,329/2,329)
- [x] `/lint` passes on everything touched (eslint clean, Prettier clean;
      workspace `tsc` blocked only by the pre-existing `context.test.ts`
      failure noted above)
- [x] E2E log with the full before/after table
- [x] Self-review
- [x] Acceptance criteria verified (all met except the literals line,
      reported above as a deviation with the measurement analysis)

## Completion Checklist (orchestrator)

- [ ] `/audit` run (touches every command module — qualifies)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-080]` prefix
