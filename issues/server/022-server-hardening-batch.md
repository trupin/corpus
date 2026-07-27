# [SERVER-022] Server hardening batch: PR #9 MINOR findings

## Domain

server

## Status

todo

## Priority

P2

## Model

opus — each item is small and precisely located by the PR #9 review.

## Dependencies

- Depends on: SERVER-010, SERVER-018
- Blocks: —

## Spec References

- PR #9 review, MINOR findings 10–19 (server-side subset)

## Summary

> **Sprint-008 reassignments (orchestrator, 2026-07-27, Open Conflict 9):** finding 4 (whitespace-only `exact`) moved to SERVER-014 (same file, same classification reasoning, fable-tier); finding 10 (watcher sync `git show` bound) moved to SERVER-020 (same `flush()`). This issue keeps the remaining nine findings, all on disjoint files — the three server issues run genuinely parallel.

The server-side MINOR findings from the Phase 2 PR review, deferred out of the merge as a single hardening session:

1. **Encoded traversal spellings in the raw-path guard** (`attachments/serve.ts`): `%2e%2e` collapses in WHATWG parsing like literal `..`; extend the raw guard so encoded spellings share the uniform 404 (containment/auth already hold).
2. **Jobs `retry` race** (`jobs/service.ts`): the `status === "failed"` check runs outside the queue's serialize chain and `requeue` moves from any directory — a retry racing `complete` re-runs a finished job. Also `store.ts` detects the one-time cap notice by substring-search of the log tail.
3. **Unanswered-form detector** (`docs/needs.ts`): `LIKE '%```form%'` matches ` ```formula ` and quoted forms; missing `t.status = 'open'` guard leaves resolved threads stuck in Attention.
4. **Whitespace-only `exact` orphaned by untouched saves** (`anchors/reconcile.ts`): gate the blank-slice guard on `partial`/`deleted` classifications (no contract change).
5. **Unborn-branch commit swallows the index** (`git/commit.ts`): `--only -- <paths>` scoping omitted on the fresh-commit path.
6. **Template pre-fill ENOENT** (`docs/templates.ts`): tolerate the projection-row-vs-disk race like `DocumentParseError`, creating without pre-fill.
7. **`assertWritable` before the lane** (`docs/update.ts` + move/archive/delete, `threads/create.ts`, `threads/cascade.ts`): re-run the guard inside the per-doc lane (TOCTOU vs a lease acquired while queued).
8. **Mark-seen invalidation omits `docKey(id)`** (`threads/seen.ts`): emit it like every other thread mutation.
9. **`dataDir` parsed but ignored** (`config.ts` vs `projection/roots.ts`): honor it or drop it from config with a validation error. Phantom lock row: `project-runtime.ts` keys lock rows by internal docId but removal keys by filename.
10. **Watcher sync `git show` per anchored file** (`watcher/watcher.ts` + `git-head.ts`): bound per-batch blocking.
11. **FTS STX/ETX assumption** (`docs/fts.ts`): strip control chars from out-of-band text before snippet marking (cosmetic).

## Acceptance Criteria

- [ ] Each item fixed with a colocated regression test, or explicitly waived with a written rationale in this file.
- [ ] Full gate green; no behavior changes beyond the findings.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-022]` prefix
