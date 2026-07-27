# [SERVER-025] Emit an invalidate when the boot projection completes

## Domain

server

## Status

todo

## Priority

P2

## Model

opus — one broadcast at a known point in the boot sequence.

## Dependencies

- Depends on: SERVER-007
- Blocks: —

## Spec References

- SPEC.md §9 — SSE invalidation; §2 — live updates
- `issues/ui/002-kit-data-layer.md` — E2E log (discovery record)

## Summary

Found by UI-002's E2E: a client that reconnects quickly after a server restart can refetch **before** the boot-time projection scan has processed files written while the server was down — and since the boot scan emits no `invalidate` frame, the missed rows never appear until something else invalidates. The kit refetches once at the only moment it knows about (reconnect); the durable fix is server-side: broadcast one coarse `invalidate` (the five coarse keys) when the boot projection completes, so late-arriving rows reach every connected client.

## Acceptance Criteria

- [ ] After the boot scan finishes, one invalidate frame with the coarse keys is broadcast to connected SSE subscribers.
- [ ] Reproduction of UI-002's race (file written while server down; client reconnects fast) becomes a regression test; post-fix the row appears without any other mutation.
- [ ] No frame when there are no subscribers yet and nothing to announce is acceptable — decide and document.

## Technical Design

Expected footprint: the boot/attach sequence in lifecycle/attach + hub broadcast; tests.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

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

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-025]` prefix
