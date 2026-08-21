# [UI-128] Audit: every surface whose size follows its content

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-057 (signed 2026-08-20)
- Blocks: the fixes it ranks
- Related: UI-127 (the instance that prompted it)

## Spec References

- SPEC.md **§11** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)

## Summary

Requested by the user, 2026-08-20, after finding UI-127: *"Something else which I
notice is present in the UI in general. Elements resize based on their content,
which then moves other elements that are stacked on top of it or aligned right.
We should do an audit of all the places where that's the case… Instead, we should
find other ways like using tool tips, drop downs, etc… We should also figure out
ways for sizes to be enough for most texts to fit."*

SHARED-057 turns that into a rule. This issue measures the product against it.

## Scale, measured before the audit ran

- **28** stylesheets and **230** components across `apps/ui/src`, `packages/kit/src`, `plugins/`
- **8** sites anchor absolutely and grow back toward what they are anchored to — UI-127's exact shape
- **9** files use `margin-left: auto` or `justify-content: flex-end`, where a sibling's width decides a neighbour's position
- **18** places already truncate with `text-overflow: ellipsis`, which is the pattern SHARED-057 wants and the floor to compare against

## What the audit produces

A **ledger**, written into this issue: one row per site, each carrying

1. the file and the element
2. what content drives the size (a name, a count, an async value, a hover preview)
3. what moves as a result, and whether a person can be pointing at it when it moves
4. a severity: **reachable** (a person can hit it in ordinary use), **latent**
   (only with unusual content), or **compliant** (already sized or truncated)

Then **one issue per reachable cluster**, not per site — a whole surface with one
cause is one issue.

## The ranking, and why it decides the release

The user asked for the audit and the fixes. The fixes are ranked by whether a
person can hit them, and this release takes the reachable ones. **A cluster too
large to finish is filed rather than half-built**, and the release says what was
cut.

## Acceptance Criteria

- [ ] Every stylesheet and every component that renders variable text is looked
      at — the sweep's coverage is stated, and anything skipped is named with a
      reason
- [ ] The ledger distinguishes **reachable** from **latent** with a stated test,
      not a feeling: can a person be pointing at, or reading, the thing that
      moves?
- [ ] The four known shapes are each searched for by name: pointer-driven preview
      (UI-127), async-arriving value, digit-count growth, and right-aligned rows
      whose sibling varies
- [ ] Findings are **verified in a real browser** before being called reachable —
      a CSS rule that looks unstable may be constrained by a parent, and jsdom
      implements no layout
- [ ] Sites that are already compliant are listed too, briefly. An audit that
      only reports faults cannot be checked for coverage
- [ ] One issue per reachable cluster, filed with a `PLAN.md` row

## Technical Design

### Files to Create/Modify

- this issue (the ledger)
- `issues/ui/*.md` — one per reachable cluster
- `issues/PLAN.md`

### Key Implementation Details

**Read SHARED-057's applied text in SPEC.md §11 first**, and measure against it
rather than against taste. Its four clauses are the rubric: size follows place
not content; overflow is revealed not accommodated; boxes are sized for real
content; the one exception grows into empty space.

The sweep parallelises cleanly by surface — board, reader, thread, console,
compose, kit, plugins — and is read-only, so it may run as a fan-out.

### Edge Cases

- A body with no knowable size (document, thread) — SHARED-057's stated exception,
  and must be recorded as compliant rather than as a finding
- A component whose parent already constrains it, so the CSS reads unstable and
  the rendered result is not
- Content that only grows in a workspace larger than any test fixture

## Testing Strategy

The audit itself is not code. Each filed issue carries its own strategy, and the
pattern UI-127 sets — measure a bounding box, change the content, measure again —
is the one to reuse.

## E2E Verification Plan

### Verification Steps

1. Real Vite dev server, ports not 5173 / not 8765
2. For each candidate, produce the content that would grow it and watch what moves
3. Record the measurement, not the impression

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Ledger complete, coverage stated
- [ ] Reachable findings verified in a browser
- [ ] One issue per reachable cluster, filed
- [ ] Self-review

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-128]` prefix
