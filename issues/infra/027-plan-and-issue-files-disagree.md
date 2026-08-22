# [INFRA-027] `issues/PLAN.md` and the issue files disagree, and nothing checks

## Domain

infra

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: every phase since the tracker started

## Spec References

- Not spec behaviour. This is the development harness.

## Summary

Found by PR #44's fourth review, and then by a script that compared the two.

`issues/PLAN.md` is what the orchestration loop reads to decide what is ready:
status `todo`, all dependencies `done`. The issue files are what the domain
agents read. **Nothing checks they agree**, and they do not.

Two directions, and they are not equally bad:

1. **PLAN says `todo`, the file says `done`** — the dangerous one. It makes
   *dependent* issues unpickable: PR #44 found `SHARED-036` recorded as
   `todo | (DRAFTED — sign-off)` in PLAN while its own file said signed and
   applied, which left **PLUGINS-016, SERVER-085 and UI-092 invisible to the
   readiness rule** even though their blocker had cleared. **13** rows were in
   this state; flipping them made 18 P1s ready at once. (A 14th row moved in the
   same sweep — `UI-081`, PLAN `todo` → `blocked` — which is a different shape
   and is counted below, not here.)
2. **PLAN says `done`, the file says something else** — bookkeeping debt, and it
   is not one shape. **11** rows where the file says `todo`: `SHARED-001`,
   `SERVER-011`, `INFRA-004`, `UI-056`, `UI-071`, `SERVER-059`, `UI-075`,
   `UI-077`, `SERVER-077`, `UI-084`, `SERVER-063`. (It was 13 until 2026-08-13,
   when `SHARED-008` and `SHARED-009` were settled — see below.) Two more where
   the file says **`in_progress`** — `SERVER-008`, `CLI-002` — which neither
   direction above describes.

   **`SHARED-009` was the consequential one** and an earlier draft of this census
   missed it: PLAN called it done while its file said *"signed by the user
   2026-08-03; apply to SPEC.md at phase kickoff, before the domain issues
   start."* Either five SPEC amendments were applied and never recorded, or they
   were never applied and the plan said otherwise — settled by reading SPEC.md
   rather than by flipping a row.

   **Settled 2026-08-13: applied, never recorded.** All five amendments are in
   SPEC.md §10 — the composer key contract, commenting on a selection, images
   opening full-size, the one autocomplete keyboard contract, and fenced canvases
   wrapping — each carrying its own signed marker. `SHARED-008` resolved the same
   way (its text is in §4, tagged `_(Rider signed 2026-08-02.)_`). Both status
   lines now say so, which drops this row count from 13 to 11.

   **`SHARED-011` is the shape that looks like this one and is not**, and the
   check must not conflate them: its file says `todo — apply at phase kickoff`,
   its text is genuinely **not** in SPEC.md, and that is *correct* — its own
   acceptance criterion is "the chain does not start before the text is in
   place", and the chain never started. A signed rider parked ahead of its phase
   is not drift. What distinguishes it from `SHARED-009` is the PLAN row, not the
   file: nothing calls `SHARED-011` done. (Its `Blocks` list is separately wrong
   — it names `CONTRACT-030`, `SERVER-056`, `UI-069`, which are jobs-query-by-
   origin issues, unrelated to structured filtering. A stale cross-reference, not
   a status disagreement, and out of this check's scope.)
3. **Shapes neither direction covers.** `CONTRACT-032` and `UI-083` are `blocked`
   in their files; `SERVER-055`'s **PLAN status is `reverted`**, a word
   `issues/TEMPLATE.md`'s vocabulary does not contain — so AC #2 requires the
   check to fail on it rather than guess. And **one** PLAN row has no issue file
   at all: `SERVER-104`.

   **This paragraph said 22, and 21 of them were an artefact of the census's own
   resolver** (corrected 2026-08-13). It claimed `AGENT-004` … `AGENT-024` had no
   file because only `001`–`003` exist under `issues/agent/`. They all exist —
   under **`issues/agent-runtime/`**, which holds `004` through `026`. There are
   two directories for one ID prefix, and the census looked in one of them.

   That is not a footnote, it is **the technical design's hardest requirement**:
   the domain directory is not the lowercased ID prefix, so a resolver that
   assumes it will report 21 issues missing that are sitting on disk. Had the
   check been built to this census it would have started red on 21 phantom rows,
   and the likely repair under pressure is to loosen it — which is the failure
   the caution below legislates against, arrived at through the census rather
   than around it.

## Why a check rather than a cleanup

A cleanup fixes today. The drift accrues because updating two files is a manual
step at the end of an issue, and the end of an issue is exactly when attention is
lowest — every phase in this repo's history has left some.

**A caution from writing this issue**: a first attempt at the sweep used
`"signed" in status` as its "done" test and mis-flipped two rows, including one
whose status read *"needs the one-line SPEC amendment below signed off first"* —
i.e. blocked. A checker that is too loose is worse than none, because it will be
trusted. Parse the status line properly and treat anything unrecognised as a
failure to classify rather than as `done`.

## Acceptance Criteria

- [x] A check compares every PLAN row against its issue file's `## Status` and
      fails on disagreement
- [x] Statuses it cannot classify **fail loudly** rather than defaulting either
      way — see the caution above
- [x] It runs where a stale row would be caught before it costs anything. The
      commit hook is diff-scoped and this needs the whole tree, so CI is its
      home (per CLAUDE.md's rule on where a check belongs)
- [x] The existing drift is cleaned in the same change, **in every shape above —
      not only the two directions**, so the check starts green. An earlier draft
      promised a clean start while describing only some of the rows, and a later
      one counted 21 phantom missing files; a check that starts red is one
      somebody loosens. Re-derive the census from the tree rather than trusting
      the numbers written here
- [x] **The ID → file resolver searches every domain directory**, because the
      directory is not the lowercased ID prefix: `AGENT-*` lives under
      `issues/agent-runtime/` for 004–026 and `issues/agent/` for 001–003. A
      resolver that maps prefix to directory reports 21 issues missing that are
      on disk — which is exactly how this issue's own census got it wrong
- [x] An issue file with no PLAN row, and a PLAN row with no issue file, are
      both reported — the second is how a renumbered issue goes missing
- [x] **Two issue files claiming one ID fail the check.** Not hypothetical: on
      2026-08-12, `SERVER-107` and `SERVER-108` each named two unrelated issues
      at once — Phase 31's (done, shipped in v0.7.0) and Phase 32's (todo) —
      because Phase 32 was planned on a branch while Phase 31 held the same
      numbers in flight, and each branch was internally consistent. Nothing
      caught it; it was found by eye. This is the shape that costs the most,
      because a dependency edge naming `SERVER-107` resolves to whichever file
      the reader opens first, and an agent handed the wrong one implements the
      wrong issue against a done issue's acceptance criteria. Parallel branches
      allocating IDs makes it recurrent, not a one-off. Renumbered to
      `SERVER-111`/`SERVER-112` (the collision is already repaired; the check
      must keep it from happening unseen again)

## Technical Design

### Files to Create/Modify

- `scripts/` — a new check, wired into CI beside the other whole-tree gates

### Notes

- `issues/TEMPLATE.md` fixes the `## Status` vocabulary: `todo | in_progress |
  done | blocked`. Several files carry prose after the word ("done — SIGNED
  2026-08-12 and applied"), which is useful and should stay legible to the
  parser rather than being normalised away.

## Testing Strategy

Unit: a fixture tree with each disagreement shape, including an unclassifiable
status, asserting the check fails for the right reason each time.

## E2E Verification Log

**Model: Opus 5 (1M context)** (`claude-opus-5[1m]`), run by the orchestrator
directly. Branch `phase-33-signed-riders`. No server started, no port bound.

### The census was re-derived from the tree, not read off this file

Deliberately, because this file's census had been wrong four times. The check was
written first and then **run** to find out what was true. It reported **25**
findings — not the 27 written here, and not the 22-missing-files:

- **13** rows where PLAN said `done` and the file said `todo`/`in_progress`.
  Settled by evidence rather than assumption: 11 carry a commit with their id,
  and the two that do not (`UI-071`, `SERVER-063` — squash-merge collapses
  per-issue commits into the phase's) were confirmed by finding their named
  implementation and tests in the tree
- **2** where the file said `blocked` and the blocker had since cleared —
  `CONTRACT-032` (SHARED-013 signed 2026-08-05) and `UI-083` (SHARED-032 signed
  2026-08-09). Both now `todo`; `UI-083` keeps prose saying its design is
  superseded and needs rewriting before anyone implements from it
- **2** unclassifiable — `SERVER-055` (`reverted`) and `INFRA-024` (`closed`)
- **1** PLAN row with no file — `SERVER-104`, written after the fact
- **7** issue files with **no PLAN row at all**, which this file never mentioned:
  `SHARED-002`, `SHARED-011`, `SERVER-054`, `CONTRACT-029`, `CLI-039`,
  `SERVER-100`, `SERVER-101`. This is the quieter half of the drift — a stale row
  is at least visible; an issue in nobody's plan is not

### The vocabulary was missing a state, so it gained one rather than a lie

`SERVER-055` and `INFRA-024` are both **resolved without landing** — the first
implemented and then reverted (wiring §6's fuzzy rung misattached threads to the
neighbouring bullet; `docs/read.ts` records it at the resolver), the second
superseded by `INFRA-025`. Forcing either into `done` would tell a reader the
behaviour is in the tree, and for both it is deliberately not. `issues/TEMPLATE.md`
and the check now carry **`closed`**, defined as resolved-without-landing and
required to carry prose saying which.

### The check found a bug in itself, twice, before it found anything else

Both in `classifyStatus`, both from stripping markdown emphasis globally:
`in_progress` became `inprogress` and the two files spelling the status exactly as
the template does were rejected as unclassifiable; then `_todo_` kept its trailing
underscore. Emphasis is now stripped at the **edges** only, and both cases are
regression tests.

### Green

```
$ node --import tsx scripts/check-issues.ts
issues:check ✓ 424 PLAN rows and 421 issue files agree
$ npx vitest run scripts/issue-tracker.test.ts   → PASS (22) FAIL (0)
$ npm run lint && npm run format:check           → clean
$ npm run typecheck                              → exit 0
```

Wired into `CI / validate` beside `version:check` — cheap, needs no build, fails
in seconds — and deliberately **not** into the commit hook, which is diff-scoped
while this compares one file against 400 (CLAUDE.md's rule on where a check
belongs).

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
