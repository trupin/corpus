# [CONTRACT-076] `workspace.reflect`: the event, the ask route, and the status route

## Domain
contract

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-064 (rider 9 signed)
- Blocks: SERVER-137, CLI-060, UI-153

## Spec References
- SPEC.md §7 — "Event queue and agent loop" (rider 9: reflection)
- SPEC.md §9.2 — "HTTP API"

## Summary
Reflection is one event with one field and two routes: ask for one, and read the clock. This issue defines them so the server, the CLI and the UI agree on the shape.

## Acceptance Criteria
- [x] Event type `workspace.reflect` is in the core event-type list with payload `{ since: string (ISO) | null }` — `null` for a corpus never reflected on.
- [x] `POST /api/workspace/reflect` → `202 { eventId, since, pending: boolean }`: a new event when none is pending or in progress, else the one already pending, with `pending: true` — an ask while one is pending is answered with the pending one, never refused and never doubled.
- [x] `GET /api/workspace/reflect` → `{ reflected: string | null, pending: eventId | null, changed: number, lastDigest: threadId | null, quiet: number }` — `changed` is the count of documents with `updated > reflected` **whose last write was not the agent's** (`lastActor !== "agent"`, CONTRACT-074; archived excluded — an archived document shows on no board, so a mark for it is impossible, and the agent's own gather sees archives at the next reflection with `--include-archived`; decided at PR #56's review, 2026-08-22), `quiet` the configured window in minutes. This is the §7 rule "the agent's own writes never count as unreflected", applied server-side with the same predicate the UI applies row by row.
- [x] `openapi.json` regenerated, drift check green, typed client exposes both.

## Technical Design

### Files to Create/Modify
- `packages/contract/src/schemas/events.ts` — the type and payload
- `packages/contract/src/schemas/reflect.ts`, `routes/reflect.ts` — the two routes
- `packages/contract/openapi.json`

### Key Implementation Details
- `changed` counts the same set the UI marks; it is in the status route so the board bar's count is one request, not a list.
- `lastDigest` is the id of the most recent reflection thread, so the UI can link "reflected 2h ago" to it; the server finds it by the thread's `origin` (§9.2) pointing at the reflection job.

### Decisions taken here (2026-08-22)

- **The predicate ships as a function, not as two paragraphs.**
  `isUnreflected(document, reflected)` lives in `schemas/reflect.ts` beside the
  status schema, and `ReflectStatus.changed`'s published prose names it. SERVER-137
  counts with it and UI-153 marks with it, so the corpus count and the row marks
  cannot disagree. It joins `findFormFence` and `isAgentPresent` under the same
  test: it needs values the wire publishes (`lastActor`, `updated`, `status`, the
  clock) and it has more than one consumer. Its three exclusions are each pinned:
  the agent's own write, an archived document, and an **unknown `updated`** — a
  hand-written `SKILL.md` carries no timestamp, and the staleness ramp already
  reads an unknown age as fresh, so marking it would put a mark on every board
  that never cleared.
- **`lastActor` is on `DocRow` and not on `DocFrontmatter`** (CONTRACT-074): it
  is projected from the write that landed, not a frontmatter key, and publishing
  it on the frontmatter would claim a file key that does not exist.
- **`WorkspaceReflectPayloadSchema` is deliberately not a registered component**,
  exactly as `ResidentDesignatedPayload` is not: `QueueEvent.payload` is an open
  record because the *set of types* is open, so no route references a payload
  shape and a registered name would publish a component nothing points at. The
  field name reaches a document reader through `QueueEvent.payload`'s prose,
  which now says `workspace.reflect` carries `{since}`.
- **A new `["reflect"]` invalidate key, and this is the one thing SERVER-137
  must honour that the AC did not name.** The resource moves on two unrelated
  things — a document write changes `changed`, a queue transition changes
  `pending`/`reflected`/`lastDigest` — so a client caching it under `["docs"]`
  would miss half its updates and under `["queue"]` the other half. The emitter's
  rule is published as a **rule** rather than a list: *name `["reflect"]`
  wherever `["docs"]` is named, and wherever `["queue"]` is named*, which an
  emitter can follow without knowing what a reflection is, and which a write
  added later inherits. `QUERY_KEY_NAMES` is now ten.
- **The ask carries the acting party and declares `400`.** It is a queue-state
  write like `POST /api/queue/halt`, which carries the header and declares `400`
  for the same reason: `@hono/zod-openapi` validates the header before the
  handler, so an operation that validates input and declares no `400` publishes
  an error union that cannot represent one of its own responses.
- **Neither route takes a body.** The window is server state, not a parameter: a
  caller that could name its own `since` would be asking for a different act than
  the one §7 defines.

### Edge Cases
- `since: null` means "everything": the agent's gather has no `--since`.

## Testing Strategy
Schema round trips; route definitions mounted on a stub.

## E2E Verification Plan
### Verification Steps
1. `npm run generate -w packages/contract` idempotent; typed client compiles.

## E2E Verification Log

**contract-dev, 2026-08-22, on opus** (model actually run: opus). Landed in one
pass with CONTRACT-074 and CONTRACT-075.

**1. Generation is idempotent and the drift check fires.** See CONTRACT-074's
log, items 1 and 2.

**2. The event type is in the core list, in producer order.**
`CORE_QUEUE_EVENT_TYPES` is now seven: `workspace.reflect` sits after
`resident.released` and before `agent.done` (which stays last because nothing
produces it). `queue.test.ts` pins the list literally and pins that the type is
spelled identically here and beside its payload. Every event-type description in
the published document is built from that constant, so `QueueEvent.type` and
`InProgressEvent.type` name it too, and `QueueEvent.payload` now states
"`workspace.reflect` carries `{since}`, the corpus's last reflection, `null` for
one never reflected on".

**3. Both routes are in the published document.** `POST /api/workspace/reflect`
→ `202/400/401`, description carrying "never doubled and never refused";
`GET /api/workspace/reflect` → `200/401`. Neither declares a request body.
`ReflectAskResult` requires `eventId`, `since`, `pending`; `ReflectStatus`
requires `reflected`, `pending`, `changed`, `lastDigest`, `quiet`.
`changed`'s published prose carries all three clauses of the predicate and names
`isUnreflected`. `quiet`'s says `0` disables the automatic path. No `*Payload`
component is registered.

**4. The typed client reaches both, proved by counterfactual `tsc`.** Removed the
two routes from `contractRoutes`, regenerated, ran `tsc --noEmit -p
packages/contract`: `TS2345 Argument of type '"/api/workspace/reflect"' is not
assignable to parameter of type 'PathsWithMethod<FetchPaths, "post">'` and
`TS2339 Property 'pending' does not exist on type 'never'`. Restored → 0 errors.
Vitest does not typecheck, so this is the proof, not the passing test.

**5. Both routes exercised against the real definitions.**
`client/index.test.ts` mounts them on a Hono app: the first ask answers
`pending: false` with the window, the second answers `pending: true` with **the
same `eventId`** — §7's "answered with the pending one, never doubled" through
the generated client. The clock read returns `reflected`, `changed`,
`lastDigest`, `quiet` and a null `pending`, narrowed (`if (!data) throw`) rather
than optional-chained, so the compiler checks the shape.

**6. Schema tests.** `schemas/reflect.test.ts`, 24 tests: the payload including
its null window and the required key; the ask result in both states; the status
including a never-reflected corpus, `quiet: 0`, a negative `changed` refused and
a non-thread `lastDigest` refused; and eleven cases over `isUnreflected` —
after/before/**exactly at** the clock, the agent's own write, archived, resolved
(still marked), the null clock in all three combinations, an unknown `updated`,
and an unparseable instant on either side.

**7. Checks.** eslint 0, prettier clean, `tsc --noEmit -p packages/contract` 0,
`vitest run packages/contract` **2827 passed / 67 files**, build 0.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes

## Completion Checklist (orchestrator)
- [ ] Committed with `[CONTRACT-076]` prefix
