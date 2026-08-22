# [SHARED-002] Reconcile SPEC.md with adjudicated Phase 2 behavior (PR #9 findings 2–4)

## Domain

shared (orchestrator-handled; drafted by spec-writer, sign-off by user)

## Status

done — user signed off 2026-07-27 ("land"), merged with PR #9

## Priority

P0

## Model

fable (spec-writer pinned)

## Dependencies

- Depends on: — (responds to PR #9 review)
- Blocks: PR #9 merge

## Summary

The recurring gap of Phase 2: sprint adjudications that changed user-observable behavior lived only in issue files and Domain Knowledge while SPEC.md kept the superseded claims. The pr-reviewer flagged three (MAJOR findings 2–4); the spec-writer amended SPEC.md to describe shipped, adjudicated behavior:

1. **§7 + §9.2 — idle timeout is rejected, not clamped**: a >480 s ask is a 400 validation error (sprint-003 adjudication: validated input beats silent coercion).
2. **§6 — reconciliation described behaviorally**: threads follow their text (in-place edits, cut-and-paste, reorders); orphans preserve the selector byte-for-byte; a visible orphan beats a silent misattachment (doppelgängers never capture threads, boundary-swallowing rewrites orphan, disjoint anchors never overlap); recomputed quotes are honest. §9.2 + §10: the `awaiting-reply` filter/chip is gone — form-awaiting threads are `needs=form`.
3. **§10 — templates are body-only**: frontmatter comes from the create request, never the template.

## Acceptance Criteria

- [x] SPEC.md amended minimal-diff (11 insertions, 12 deletions), no section restructuring
- [x] `issues/ui/009-search-overlay.md` annotated re: the dropped awaiting-reply chip
- [x] User sign-off ("land" on PR #9, 2026-07-27)

## Process note

Adopted going forward: when a sprint adjudication changes user-observable behavior, the adjudication commit must include the SPEC.md amendment (drafted by spec-writer, flagged for user sign-off at the phase PR) — not just the issue-file record.
