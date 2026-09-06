# [SERVER-167] A rebuild discards an index it may not be able to rebuild

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Origin

Re-filed 2026-09-06 from **SHARED-003** (the PR #11 / PR #12 review ledger),
Phase 8 eval ledger additions, 2026-08-01:

> **`corpus index rebuild` has no guard against discarding an index it cannot
> rebuild** (unreachable configured provider → 561 valid vectors gone,
> spec-correct but unrecoverable-by-waiting). Consider a refusal or --force when
> resolution is currently error/disabled.

The 2026-09-06 audit re-checked the code and confirmed the finding is live and
unmitigated: the delete is unconditional, and the verb has no flags at all.

## Spec References

- SPEC.md §9.1 — the semantic index, sticky identity, and `corpus index rebuild`
  ("the effective model changes only through an explicit act … or `corpus index
  rebuild`, which re-picks the current default")

The spec makes rebuild the one place stickiness resets. It does not say the verb
must be able to destroy an index when nothing can rebuild it, and the eval found
the resulting state unrecoverable by waiting.

## Summary

`POST /api/index/rebuild` deletes every row in `chunk_embeddings` before anything
checks whether an embedding provider is reachable. With an unreachable or
disabled provider, a workspace with a complete index — 561 valid vectors in the
eval that found this — ends the call with zero vectors, a full pending queue, and
no way to get back: the vectors are gone, and the thing that would recreate them
is the thing that is not working. The CLI verb offers no `--force` and no
confirmation, so there is no way to express "yes, I know, do it anyway" and no way
to be stopped.

## Acceptance Criteria

- [ ] `POST /api/index/rebuild` **refuses** when embedding resolution is
      currently `error` or `disabled`, and the refusal names the reason
      (unreachable provider / no provider configured) rather than a generic 4xx.
- [ ] The refusal is bypassable by an explicit opt-in — a `force` flag on the
      request body or query — so a person who genuinely wants an empty index can
      still get one.
- [ ] `corpus index rebuild --force` exists, is documented in the verb's
      description, and appears in `docs/cli.md` after regeneration.
- [ ] Without `--force`, the CLI surfaces the refusal as an actionable message
      naming `corpus index status` and the `--force` escape, and exits non-zero.
- [ ] Nothing is deleted on the refusing path: a refused rebuild leaves the
      existing vectors intact, verified by a count before and after.
- [ ] `semantic.rebuild.begin()` is not left latched by a refusal — the refusal
      must return the index to its prior state, not to `rebuilding`.
- [ ] The declared responses for the route carry the new refusal status (a
      CONTRACT change — file the contract half first if the shape needs one).

## Technical Design

### Files to Create/Modify

- `apps/server/src/semantic/maintenance.ts` — `rebuild()`, lines 154-172.
- `apps/cli/src/commands/index-maintenance/rebuild.ts` — the verb's `flags: []`
  at line 81 and its description at lines 62-79.
- `packages/contract/src/routes/index.ts` (the `rebuildIndex` route) — the
  request shape and the declared refusal response, if the guard needs either.
- Tests beside each.

### Key Implementation Details

`apps/server/src/semantic/maintenance.ts:154-172` is the destructive path:

```ts
    rebuild() {
      // Raised before anything is discarded, so no request can observe an index
      // with zero vectors and no rebuild in flight — which `semanticIndexState`
      // would honestly, and uselessly, call `disabled`.
      semantic.rebuild.begin();

      let queued: IndexStatus;
      try {
        // The one place stickiness resets (SPEC.md §9.1 …)
        const discarded = db.prepare("DELETE FROM chunk_embeddings").run().changes;
```

There is no provider check between `begin()` and the `DELETE`. The module already
has the fact it needs: `status()` (line 143) returns `{ state, detail }`, and the
route handler for `db doctor` shows the established way to ask the live question
(`apps/server/src/projection/routes.ts:170`, `deps.index?.effectiveModel()`).

Two design points to settle before writing code:

1. **Where the guard lives.** `rebuild()` is currently synchronous after
   `begin()`. Resolution is async. Either make the guard the caller's job (the
   route awaits resolution, then calls `rebuild()`), or make `rebuild()` async
   and check inside. Prefer the route: it keeps `maintenance.ts` free of the
   probe and matches how `doctorDb`'s handler already asks the same question.
2. **What counts as refusable.** `error` and `disabled` per the ledger. A state
   of `downloading` is _not_ a refusal — the provider is resolving and the queue
   will drain — so do not widen the guard to "anything but current".

`apps/cli/src/commands/index-maintenance/rebuild.ts:80-81` is `args: []`,
`flags: []`. `--force` is the first flag this verb takes. Its description
already promises a great deal about what rebuild does (lines 62-79) and must
gain a sentence about the refusal.

### Edge Cases

- A **rebuild already in flight** must not be affected by the new guard.
- The refusal must not fire on a workspace that has never had an index (nothing
  to lose). Zero existing vectors and an unreachable provider is a no-op
  refusal that is more annoying than protective — refuse only when there is
  something to discard, or refuse uniformly and document it. Pick one and say
  which in the E2E log.
- `--force` with a working provider is an ordinary rebuild, not a special path.
- `--json` output for the refusal follows the CLI's existing error shape, not a
  bespoke one.

## Testing Strategy

Unit: a fake semantic module resolving to `error`, `disabled`, `downloading`,
and `current`; assert `DELETE` runs only where it should, that the row count is
unchanged on the refusing paths, and that `rebuild.active` is false afterwards.
CLI unit: `--force` parsing and the refusal's exit code and message.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start a workspace with a working embedding provider and let the index fill.
   Record `corpus index status --json` (`indexed` > 0).
2. Make the configured provider unreachable (point it at a dead host, or
   disconnect it) and confirm `corpus index status` reports `error`/`disabled`.
3. Run `corpus index rebuild`.
4. Expected: a refusal naming the provider state, with the vectors intact.
5. Actual: `discarded <n> vector(s)` in the log, `corpus index status --json`
   reports `indexed: 0`, and nothing can re-embed.

### Verification Steps

1. Rebuild and restart the server. Repeat steps 1-3.
2. Expected: refusal, non-zero exit, `indexed` unchanged.
3. Run `corpus index rebuild --force`; expect the discard to proceed.
4. Restore the provider, run `corpus index rebuild`, and confirm the ordinary
   path is unchanged and the backlog drains.

## E2E Verification Log

_[Agent fills: application restarted, exact commands, observed output, including
the vector counts before and after each attempt. State which model the
implementing agent ran on.]_

### Reproduction (bugs only)

_[Agent fills]_

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (destructive path — qualifying)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-167]` prefix
