# [INFRA-027] `issues/PLAN.md` and the issue files disagree, and nothing checks

## Domain

infra

## Status

todo

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
   readiness rule** even though their blocker had cleared. Fourteen rows were in
   this state; flipping them made 18 P1s ready at once.
2. **PLAN says `done`, the file says `todo`** — bookkeeping debt. Fifteen rows,
   most of them old: `SHARED-001`, `SERVER-008`, `SERVER-011`, `CLI-002`,
   `INFRA-004`, `SHARED-008`, `UI-056`, `UI-071`, `SERVER-059`, `UI-075`,
   `UI-077`, `SERVER-077`, `UI-084`, `SERVER-063`. Work that landed and whose
   file was never flipped.

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

- [ ] A check compares every PLAN row against its issue file's `## Status` and
      fails on disagreement
- [ ] Statuses it cannot classify **fail loudly** rather than defaulting either
      way — see the caution above
- [ ] It runs where a stale row would be caught before it costs anything. The
      commit hook is diff-scoped and this needs the whole tree, so CI is its
      home (per CLAUDE.md's rule on where a check belongs)
- [ ] The existing drift is cleaned in the same change, both directions, so the
      check starts green
- [ ] An issue file with no PLAN row, and a PLAN row with no issue file, are
      both reported — the second is how a renumbered issue goes missing

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

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
