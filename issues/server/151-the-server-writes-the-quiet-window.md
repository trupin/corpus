# [SERVER-151] The server writes the quiet window it already reads

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-071, CONTRACT-086
- Blocks: UI-172

## Spec References

- SPEC.md §7 — `reflect.quiet`, and `0` disabling the automatic path
- SPEC.md §2 — the server is the sole writer

## Summary

`readQuietMinutes` (`apps/server/src/config.ts:550`) reads `reflect.quiet` from
`.corpus/config.json` on **every use**, so a change takes effect with no
restart. Nothing writes it.

This issue implements CONTRACT-086's `PUT`: the server writes the value into the
config file and answers with the same `ReflectStatus` a `GET` returns.

## Acceptance Criteria

- [ ] `PUT /api/workspace/reflect/quiet` writes `reflect.quiet` and answers the
      full `ReflectStatus`
- [ ] The write is **atomic** — a crash mid-write must not leave a truncated
      `.corpus/config.json`, because an unparseable config degrades far more than
      reflection
- [ ] **Every other key in the file survives** the write, including keys this
      server does not know about. The config is a file a person edits, and a
      round trip through a schema that dropped unrecognised keys would eat them
- [ ] Comments and formatting loss is acknowledged rather than discovered: state
      in the issue what the write does to a hand-formatted file, and pick the
      behaviour deliberately
- [ ] A config file that is **absent** is created. One that is **unparseable** is
      refused with a reason naming the file, and is not overwritten — a person
      with a broken config has a typo to find, and destroying it hides the typo
- [ ] Setting `0` stops the automatic path, proved by a test that lets the quiet
      window elapse with changes outstanding and asserts **nothing was enqueued**
- [ ] Setting it back to a non-zero value re-arms it, proved the same way
- [ ] A reflection already pending is **not** cancelled by switching the path off

## Technical Design

### Files to Create/Modify

- `apps/server/src/config.ts` — the write beside `readQuietMinutes`
- `apps/server/src/app.ts` — the route handler, near the existing reflect wiring
  (~line 484)

### Key Implementation Details

Write through a temp file and rename, the way the rest of the server writes.
Read the existing object, set one key inside `reflect`, serialise the whole
object back — never a targeted string edit of the file.

The quiet-window consumer at `app.ts:494` is already a thunk re-read per use
(*"Re-read per use rather than captured, so an edit to `reflect.quiet`…"*), so
nothing needs invalidating. Confirm that by test rather than by reading the
comment.

### Edge Cases

- Concurrent writes: the server is single-process and the sole writer, so the
  last write wins. Say so rather than building a lock nobody needs.
- The file exists but `reflect` is absent, or is not an object.

## Testing Strategy

Unit tests over the write: absent file, present file with unrelated keys, an
unparseable file, and `reflect` present but not an object. Integration test over
the effect: `0` enqueues nothing when the window elapses, non-zero enqueues one.

**Falsify the disable test.** Break the disable and watch it fail. A test that
asserts "nothing was enqueued" passes when the whole pipeline is broken, so it
must also prove the same fixture **does** enqueue with a non-zero window.

## E2E Verification Plan

Against a real workspace and a real server: read `.corpus/config.json`, `PUT` a
`0` through the CLI's generated client or `curl`, confirm the file changed and
kept its other keys, make a change, wait out the window, and confirm no
`workspace.reflect` event was enqueued. Then set it back and confirm one is.

## E2E Verification Log

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-151]` prefix
