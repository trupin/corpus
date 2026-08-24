# [SERVER-148] The server supplies what the contract now declares

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-029, CONTRACT-035, CONTRACT-036
- Blocks: UI-169

## Spec References

- SPEC.md **§7** — the queue and jobs, and read state
- SPEC.md **§9.2** — `GET /api/jobs`, `GET /api/threads/{id}`

## Summary

The server half of three contract changes that landed in `373b07b7`. **The repo
does not typecheck until this issue closes**, which is the forcing function those
changes were shaped to be: a field the contract declares and no route supplies is
a compile error rather than a silent `undefined`.

Exactly three call sites, all found by `tsc`:

1. **`src/jobs/project.ts`** — `toJob` needs `enqueued` and an **uncoalesced**
   `started`. `SELECT_JOBS` already selects both columns. `updated` must stop
   falling through `started`.
2. **`src/jobs/routes.ts`** — `JobList` needs `total` (a `COUNT(*)` over the same
   `WHERE`, with no `LIMIT`) and `truncated`. `truncated` is false by
   construction when `originId` is given.
3. **`src/threads/read.ts`** — `Thread.unread`, computed with the **existing**
   `isThreadUnread(db, threadId, mark)` from `docs/needs.ts` against the
   `.corpus/seen.json` mark.

## Acceptance Criteria

- [ ] `npm run typecheck -w apps/server` passes
- [ ] `enqueued` is the instant the job entered the queue; `started` is null
      until the first log line and is never coalesced to `enqueued`
- [ ] `total` counts every row matching the query's `WHERE`, not the windowed
      page, and `truncated` is derived from the two rather than guessed
- [ ] `unread` uses `isThreadUnread` against the server-side mark. **Not** a
      second comparison written for this route, and **not** derived from the
      `turns` array — a thread past the first page has no row to derive from,
      which is the whole reason CONTRACT-036 exists
- [ ] A standalone thread (`parent: null`) reports `unread` correctly, since it
      is the case no list can ever answer

## Testing Strategy

Route-level tests for each field. The falsification for `unread` is direct: mark
a thread seen, add a turn as another author, and assert the route says `true`
without the caller having listed anything.

## E2E Verification Log

_(to be filled by the implementing agent)_
