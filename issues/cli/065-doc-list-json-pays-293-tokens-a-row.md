# [CLI-065] `doc list --json` pays 293 tokens a row against 25 for the human row

## Domain
cli

## Status
done

## Priority
P1 (important)

## Model
opus

## Dependencies
- Depends on: — (contract change may be needed for server-side field selection;
  if so, split a CONTRACT issue rather than widening this one)
- Blocks: —

## Spec References
- SPEC.md Section 7 — reflecting on the corpus gathers the window with `doc list`
- SHARED-070 audit report — `issues/evals/SHARED-070-token-audit.md`

## Summary

Measured in the SHARED-070 audit (2026-08-23, 20-document workspace):

- `corpus doc list` (human): 497 tokens for 20 rows — **25 tok/row**
- `corpus doc list --json`: 5,864 tokens for the same 20 rows — **293 tok/row,
  11.7×** — because every item carries ~25 fields including the full `excerpt`
  and `lastTurn` bodies, `kanban`, `columns`, `attention`, `snippets`, whether
  or not the caller wants them. Words understate this surface 4.9× (1,295 words
  → 6,361 tokens), so Phase 39's word counting never saw it.

The cost is on the loop's hot path: the orchestrate skill's reflection
procedure directs the agent to `corpus doc list --json` because **only the JSON
carries `lastActor`** — the one field reflection needs to skip its own writes.
At 500 documents a single reflection's window read is ~147k tokens. The agent
pays 268 tok/row for fields it wants one of.

## Decision (implementation, 2026-08-23)

**Option 2 — `--fields` on `--json`, CLI-side projection, no contract change.**
Why over option 1: the reflection read is a *parsing* read, and CLI-057's help
already promises that a caller needing certainty parses `--json` — the human
row's rule-character discussion exists precisely because a body can forge the
human form. Moving `lastActor` into the human row would direct a parser at the
forgeable form; field selection keeps the certain form certain and lets the
caller pay for exactly what it asked. Projection is CLI-side because the
tokens are paid in the agent's context, not on the wire — zero contract or
server change.

Shape decisions, each tested: `--fields` requires `--json` (exit 2 without —
the human rows are a fixed reading order, not a projection surface); an
unknown field is exit 2 naming the known ones, **before any request**, with
the known list enumerated at runtime from the contract's own `DocRowSchema`
keys so it cannot drift; a repeated field is read once at its first position;
items keep the requested field order; the `page` envelope is untouched so
truncation stays visible; a field absent on a row stays absent rather than
becoming `null`. `corpus search --json` was left alone — its hits are already
lean (~40 tok/row in the audit) — noted for a follow-up only if measurement
ever says otherwise.

## Acceptance Criteria
- [x] The reflection path can read its window without paying for excerpts and
      turn bodies. Two acceptable shapes — pick one and state why:
      1. `lastActor` joins the human row (one short token per row), and the
         orchestrate skill's reflection text is updated by agent-runtime to
         drop `--json` there (coordinate, do not edit `assets/` from this
         issue), or
      2. **Chosen**: `--json` gains field selection
         (`--fields id,title,lastActor,updated`) with the full object
         remaining the default. Rationale in the Decision above.
         Coordination still owed: the orchestrate skill's reflection text
         should add `--fields id,title,lastActor,updated` to its
         `doc list --json` command — agent-runtime's edit, reported to the
         orchestrator rather than made from this issue.
- [x] Measured before/after on a 20-doc workspace in the issue log: target
      ≤ 40 tok/row for the reflection read. (36.7 tok/row measured — log
      below.)
- [x] No existing consumer breaks: the UI does not use the CLI, and the full
      `--json` object stays available unchanged. (Asserted by test: without
      `--fields`, the emitted value is byte-identical to the server envelope.)

## Technical Design

### Files to Create/Modify
- `apps/cli/src/commands/doc/list.ts` — human row or `--fields` filtering
- (option 2, if server-side) `packages/contract` — split to a CONTRACT issue

### Key Implementation Details
Field selection can be CLI-side filtering of the server response with zero
contract change — the tokens are paid on the agent's context, not on the wire.
That makes option 2 cheap: parse `--fields`, project each item, print. Option 1
is smaller still but touches the human format other readers may parse.

### Edge Cases
- `--fields` naming an unknown field: usage error listing the known ones
  (exit 2), before any request.
- `--fields` with pagination lines: keep the trailing "showing X–Y of Z" line —
  the skill reads it to page.

## Testing Strategy
CLI unit tests: projection, unknown field, interaction with `--json` absent
(usage error: `--fields` requires `--json`, or define it for human mode too —
decide and test).

## E2E Verification Plan
Real workspace with 20 docs: run the reflection read both ways, count tokens
with the audit's scripts, confirm the target.

### Verification Steps
1. Scratch workspace, seed 20 documents
2. `corpus doc list --json --fields id,title,lastActor,updated` (or the human
   row with `lastActor`)
3. Expected: ≤ 40 tok/row, `lastActor` present, pagination line intact

## E2E Verification Log

**Model: Fable 5 (`claude-fable-5`)** — the issue recommended opus; recorded
per policy. Date 2026-08-23.

Packaged bundle (v0.20.0) against a real daemonized server on port **8766**
in a scratch workspace (the user's 8765 never touched). Tokens counted with
`gpt-tokenizer` (o200k), the SHARED-070 audit's tokenizer, via
`scratchpad/e2e/count-tokens*.js`; outputs captured to
`cli-065-tokens*.txt`. Machine load 3.5–6.9 during the counts (token counts
are load-independent; recorded anyway).

### The measurement — 20 rows, audit-comparable titles

```
short-titled 20 rows, --json full                     : 4061 tok  → 203.1 tok/row
short-titled 20 rows, --fields id,title,lastActor,updated:  734 tok  →  36.7 tok/row
short-titled 20 rows, human                           :  485 tok  →  24.3 tok/row
```

**36.7 tok/row — under the ≤ 40 target, 5.5× leaner than the full row, 82%
saved.** The human row measures 24.3 tok/row against the audit's 25, so the
corpus is comparable. On a second seed of deliberately long titles (~15-word
titles) the projected row is 57.6 tok — title bytes the caller asked for —
and still beats even the *human* row there (64.9), because the human row also
carries the path. The full row measured 203–276 tok/row here against the
audit's 293; the delta is title/body length, not a change in the surface.

### Behavior, all against the real server

```
$ corpus doc list --tag short --json --fields id,lastActor
  page kept: {"total":20,"limit":50,"offset":0}; item: {"id":"doc_7ctkgstn","lastActor":"user"}

$ corpus doc list --json --fields id,excerpts
corpus: --fields names 1 field no row carries: excerpts.
  Known fields: id, type, title, path, status, stage, tags, created, updated, … snippets. No request was sent.
exit=2

$ corpus doc list --fields id          # without --json
corpus: --fields selects JSON fields, so it needs --json.
exit=2
```

The known-field list in that refusal is enumerated from `DocRowSchema.shape`
at runtime — a contract rename moves it with no CLI edit.

### Falsification — the fix broken two ways on purpose

Each break made in `list.ts`, the scoped suite run, then restored (final run
green, 43/43):

| break | tests that failed |
|---|---|
| projection dropped (full object emitted despite `--fields`) | 2 — "cuts each item to the named fields…"; "reads a repeated field once" |
| validation moved after the request | 3 — every "before any request" assertion (`stub.requests` length 0) |

### Checks

- `vitest run apps/cli` — 2,079 passed (the 2 failures are CONTRACT-071
  `designationId` fixture fallout in files this issue never touched, owned by
  the orchestrator's sweep).
- `eslint` and `prettier --check` on `list.ts`/`list.test.ts` — clean, no
  rule disabled.
- `docs/cli.md` regenerated; drift test green.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
