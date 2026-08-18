# [SERVER-121] Designate a resident without naming a profile

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-061
- Blocks: UI-122, CLI-049, AGENT-033

## Spec References

- SPEC.md **§7** — the SHARED-048 rider
- SPEC.md **§9.2** — `POST /api/threads/:id/resident`, `GET /api/agents`

## Summary

Accept a designation that names no profile, store it, put it on the roster, and
carry it in `resident.designated` — with **every other resident behaviour
unchanged**, which is the load-bearing half of this issue.

`apps/server/src/threads/resident.ts:179` resolves `request.name` through
`resolveMentionTarget` and refuses when it misses. A general designation never
reaches that lookup at all; a **named** one still must, and must still refuse.

## Acceptance Criteria

- [x] A designation naming no profile succeeds on a standalone thread and makes
      the thread a lane
- [x] A designation naming a profile behaves exactly as it does today, including
      the `404` for a name that resolves to nothing
- [x] The thread's frontmatter records a general residency in a form that
      round-trips through the projection and is legible on disk to a person
      reading the markdown
- [x] `GET /api/agents` lists the lane with a general resident, `live` computed
      exactly as it is for a profiled one
- [x] `resident.designated` is enqueued on the **orchestrator's** lane as today,
      carrying whatever CONTRACT-061 defined for a general resident
- [x] Lane routing, scope walking, presence, the grace-window fallback, release,
      and **resolution releasing the resident** are provably unchanged — each
      covered by a test that would fail if a general resident took a different
      path
- [x] `assertRecipientResolvable` / `assertScopeIsLane` treat a general-resident
      lane as a lane: `isDesignatedRoot` currently requires
      `resident_name IS NOT NULL`, which a general residency must still satisfy
      or presence and recipients silently break

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/resident.ts` — the designate path
- `apps/server/src/core/resident.ts` — the resident value read off frontmatter
- `apps/server/src/projection/schema.ts` + the document projector — how a
  general residency is stored in `threads.resident_name` / a sibling column
- `apps/server/src/agents/roster.ts` — the roster row
- `apps/server/src/queue/scope.ts` — `isDesignatedRoot`'s predicate

### Key Implementation Details

**The projection column is the sharp edge.** `isDesignatedRoot` asks
`resident_name IS NOT NULL`, and three separate things lean on it: the lane
predicate, `assertRecipientResolvable`'s `422`, and `assertScopeIsLane`'s refusal
of a park on a non-lane. Whatever represents "designated, no profile" **must
make that predicate true**. Decide deliberately between a reserved column value
and a second column, and write down which and why — a `NULL` name with a
separate `designated` flag is the shape that keeps "is a lane" and "has a
profile" as the two independent questions they now are.

**Do not let a general resident borrow a fake name.** If the projection stores
a sentinel string in `resident_name`, that string reaches the roster, the
composer's recipient list and the board badge, and will be indistinguishable
from a real agent-def with the same title.

**Frontmatter must stay hand-editable.** §7 calls designation *"user-only state
on the thread, set and released like any other thread field"*, and
`packages/contract/src/schemas/extra.ts:70` already reserves `resident`. A
person opening the markdown should be able to tell a general residency from a
profiled one without consulting the code.

### Edge Cases

- **Replacing in both directions** — general → profiled, profiled → general.
  Single-valued replacement, one write, one commit.
- **Releasing a general resident** — `DELETE` is idempotent as today.
- **Resolving the thread** releases a general resident with it
  (`threads/status.ts:45`), and the release must be visible on the roster.
- **A parented thread** is still refused, profile or no profile.
- **An in-flight park on a lane whose residency went general** keeps its park —
  `assertScopeIsLane`'s documented rule that presence is asked at the request
  and never re-asked of one already admitted.

## Testing Strategy

Route tests for both designation shapes and both refusals. Projection tests that
`isDesignatedRoot` is true for a general residency. Queue tests that an event in
a general-resident scope is stamped with that lane, that a scoped claim sees it,
and that an unscoped claim does not while the lane is live. A release/resolve
test asserting the lane leaves the roster. **Falsify each: break the general
path and watch the specific test go red** — several of these would pass against
a server that quietly routed general residents to the orchestrator.

## E2E Verification Plan

### Verification Steps

1. `corpus init` a throwaway workspace on a port that is **not 8765 and not
   5173**; start the real server
2. `corpus thread create`, then designate with no profile through the real HTTP
   route
3. `GET /api/agents` shows the lane; the thread's markdown on disk shows the
   residency; `git log` shows the auto-commit
4. Post a message in the thread; `corpus queue claim-all --scope <th_…>` sees it
   and an unscoped claim does not
5. Resolve the thread; the lane leaves the roster
6. Repeat 2–5 with a **named** profile and confirm the behaviour is identical
7. Stop the server and confirm the port is free

## E2E Verification Log

**Model: opus.** Run 2026-08-17, real `corpus init` workspace at
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s121ws`, real server on **8838**
(not 8765, not 5173), real files, real git, real queue directory. Server stopped
and port confirmed free at the end.

### The decision, first

**A general residency is `resident_designated INTEGER NOT NULL DEFAULT 0`, a new
column beside `resident_name` / `resident_doc_id`** — never a reserved value in
the name. Two independent questions since the rider: *is this a lane* and *which
profile*. `isDesignatedRoot`, the scope walk's `NODE_SQL` and the roster's
`DESIGNATED_LANES_SQL` all moved to the flag; the name columns are now
legitimately NULL on a designated row. A sentinel string in `resident_name` was
refused because it reaches the roster, the composer's recipient list and the
board badge indistinguishable from a real agent-def of that title, and because
`residentOrNull` would then have to un-say it in three readers. `SCHEMA_VERSION`
17 → 18; every value is re-derived from the thread files, so the rebuild the bump
triggers is the whole migration.

**On disk** the general residency is the same `{name, docId}` mapping the wire
carries, with both halves null — one grammar, not two:

```yaml
resident:
  name: null
  docId: null
```

### 1–3. Designate with no profile, on a fresh workspace with no agent-defs

`POST /api/threads/th_reymyuos/resident` with **no body and no content-type**:

- `200`, `thread.resident = {"name": null, "docId": null}`, `warnings: []`
- markdown on disk carries the block above (verified by reading the file)
- `git log`: `291acac user resident designate: general resident on Can we talk
  about the archive? (th_reymyuos) by user` — one commit, authored `user`
- `GET /api/agents` lists two lanes: `orchestrator` (resident `null`) and
  `th_reymyuos` with `resident {"name": null, "docId": null}`, `live: false`,
  `origin {id, title}`
- projection: `th_reymyuos|1|<null>|<null>` (`resident_designated`, name, docId)
- `resident.designated` written with **`lane: orchestrator`** and payload
  `{"threadId": "th_reymyuos", "resident": {"name": null, "docId": null}}`

### 4. Lane routing, the partition, presence, the fallback

Posting `requestsAgent: true` in the thread stamped `comment.created` with
`lane: th_reymyuos` (the designation stayed on `orchestrator`).

With a scoped `idle` parked on the lane: `GET /api/agents` reports `live: true`
for it, `GET /api/queue/status` reports `agent.live true`; the **unscoped**
`claim-all` returned only `[('resident.designated', …)]` and the **scoped** one
returned `[('comment.created', …)]`. Presence, the partition and the addressing
guard therefore all admit a general resident.

### 5. Resolution releases it

`POST .../resolve` → roster back to `['orchestrator']`, `resident:` key gone from
the frontmatter (`grep -c '^resident:'` → 0), `resident_designated` → 0, one
commit `thread resolve: … by user`.

### 6. Identical with a named profile

Seeded `.claude/agents/researcher.md`, designated `{"name":"researcher"}` on a
second thread: `{"name":"researcher","docId":"doc_agentdef9aac2cc9"}`, commit
`resident designate: researcher on …`, row `1|researcher|doc_agentdef9aac2cc9`.
**The same script** then produced the same output at every step — live `true`,
unscoped claim blind to the lane, scoped claim seeing it, resolve emptying the
roster. The only differences anywhere are the resident's two fields and the word
in the commit subject.

### Refusal matrix, against the running server

| request | status |
| --- | --- |
| bare `POST`, no body | `200` |
| `{}` | `200` |
| `{"name": null}` | `400` |
| `{"name": "   "}` / `{"name": ""}` | `400` |
| `{"name": "nobody"}` | `404` |
| `{"agent": "researcher"}` (strict body) | `400` |
| bare `POST` as `x-corpus-author: agent` | `403` |
| bare `POST` on an unknown thread | `404` |
| bare **and** named `POST` on a parented thread | `409` |

### Replacement both ways, and a profile that has gone

general → profiled → general on one thread: one commit each way
(`resident designate: researcher on …`, then `resident designate: general
resident on …`). After deleting the agent-def, the profiled thread reads
`{"name": "researcher", "docId": null}` while the general one reads
`{"name": null, "docId": null}` — §7's "the missing profile is reported rather
than silently substituted", and the two states stay distinguishable. The gone
profile is **still a lane** (`resident_designated` = 1).

`corpus db doctor`: *projection is clean — 17 documents from 17 files (4ms)*.

### Falsification (the issue's requirement, done three ways)

Each break was applied to the shipped code, the suites re-run, then reverted.

1. `isDesignatedRoot` + `NODE_SQL` back to `resident_name` — **12 tests red**,
   across routing (4), the lane predicate (1), recipient resolution (1), the park
   guard (1), roster liveness (1) and the end-to-end partition (4).
2. `DESIGNATED_LANES_SQL` back to `resident_name` — **4 tests red**: the roster
   listing, the general-vs-gone distinction, general liveness, and the lane
   leaving the roster on release.
3. Projector writing the flag from the name (`resident?.name == null ? 0 : 1`) —
   **8 tests red**, including the round-trip through a rebuilt projection.

A server quietly routing general residents to the orchestrator fails every one of
these; none of them is satisfiable by the profiled path alone.

### Checks

- `VITEST_MAX_THREADS=4 vitest run apps/server`: **191 files, 4065 tests, all
  passing**
- `tsc --noEmit` in `apps/server`: exit 0
- `eslint apps/server/src`: no issues; `prettier --check apps/server/src`: clean
- `npm run build` stops at `apps/cli` (CLI-049 has not landed) — expected, not
  this issue's; `packages/contract` and `packages/kit` build clean, which is what
  `apps/server` resolves against

### Unresolved

Nothing blocking. One behaviour change worth naming for review: `currentResident`
previously answered a **stale** `docId` when the name resolved to nothing; it now
answers `null`. That is what CONTRACT-061's third row requires and what its
`docId` description states ("what `name` resolves to right now"), and it is the
failure the re-read was introduced to prevent — but it changes what `GET
/api/threads/{id}` and `GET /api/agents` say about a designation whose agent-def
was deleted, so UI-122 and AGENT-033 should expect `null` there rather than a
dead id.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-121]` prefix
