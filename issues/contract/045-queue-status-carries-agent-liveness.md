# [CONTRACT-045] `QueueStatus` cannot say whether an agent is there

## Domain

contract

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-033 part 2 (rider must be signed first)
- Blocks: SERVER-086, UI-098

## Spec References

- SPEC.md §11 line 469 — the console strip's agent pill, as amended by SHARED-033
- SPEC.md §7 — the queue's long-poll idle endpoint
- SPEC.md §9.2 — the queue status resource

## Summary

`QueueStatus` carries `halted`, `pending` and `inProgress` — everything about the
*work*, nothing about the *worker*. So the UI derives `idle` by elimination
(`consoleModel.ts:135`: not halted, nothing in progress ⇒ idle), which is why a
machine with no agent at all reports `agent: idle`.

SHARED-033 makes `idle` a claim requiring evidence. This issue puts the evidence
on the wire.

## Acceptance Criteria

- [x] `QueueStatus` carries when the server last observed agent contact — a
      nullable instant, absent when the server has seen none since starting
      _(`agent.since`, required and nullable; it arrives inside `agent` rather
      than alone, because CONTRACT-051 landed `live`/`since` as the roster's
      vocabulary and this reuses the objects — see the log's decision 1)_
- [x] The field is documented as **what the server observed**, not as a heartbeat
      the agent sends: nothing new is asked of the agent, and the existing parked
      long-poll is the signal
- [x] The window that separates connected from disconnected is **derived from
      `DEFAULT_IDLE_TIMEOUT_SECONDS`** (currently 480 s) and exported alongside
      it, not written as a literal in the UI. A parked agent re-contacts the
      server at least that often, so the threshold must move if the timeout does
      _(`AGENT_PRESENCE_WINDOW_SECONDS = DEFAULT_IDLE_TIMEOUT_SECONDS * 2`, in
      `schemas/queue.ts`, pinned by a test to exceed the rearm bound)_
- [x] Whether the contract exports a **derived state** (`working | idle |
      disconnected | halted`) or leaves the UI to compute it from the timestamp
      is decided here and documented — one place must own the rule, and two
      consumers already exist (the pill, and any plugin reading queue status)
      _(both: `isAgentPresent` and `agentActivity` — decision 3)_
- [x] `openapi.json` regenerates with no diff, and the drift check passes
- [x] Existing consumers keep compiling — the field is additive
      **on the wire, not in TypeScript**: every *reader* compiles unchanged, and
      the four *constructors* of a `QueueStatus` outside this package now fail to
      compile, which is the forcing function SERVER-086 and UI-098 exist to
      answer. Sites listed in the log
- [x] Schema round-trip tests cover the absent case as well as the present one

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/queue.ts` — the `QueueStatus` shape, beside
  `DEFAULT_IDLE_TIMEOUT_SECONDS` / `MAX_IDLE_TIMEOUT_SECONDS` (line 332)
- the generated `openapi.json` and typed client (regenerated, not hand-edited)

### Key Implementation Details

Prefer **timestamp on the wire, rule in the contract**: a raw instant plus an
exported helper that answers `disconnected` given a clock. A precomputed enum
would be stale by the age of the response, which for a 10-minute window is
usually harmless and occasionally exactly wrong — and it would make the pill
unable to re-evaluate between polls.

Name the field for what it is. Something like `lastAgentContact` is honest;
`agentAlive` would assert a liveness nobody verified.

### Edge Cases

- **No contact since server start** — absent/null, and the UI must render that as
  disconnected rather than as "unknown, assume fine"
- **A server restart while an agent is parked** — the long-poll drops and the
  agent re-parks within the timeout, so the field refills on its own. Confirm
  nothing needs persisting across restarts, and say so
- Clock source: server-side only, so a client cannot influence it

## Testing Strategy

Vitest: schema round-trips with the field present and absent; the derived-state
helper (if the decision puts it here) across the boundary — just inside the
window, just outside, and never-contacted.

## E2E Verification Plan

### Verification Steps

1. `npm run generate -w packages/contract` from a clean tree — no diff
2. Start the server; `curl` the queue status endpoint with no agent running —
   confirm the field is absent/null and the response validates
3. Run `corpus queue idle` in another terminal; `curl` again — confirm the field
   is populated
4. Confirm the typed client exposes it to both `apps/ui` and `apps/cli` without
   a cast

## E2E Verification Log

**Model: Opus 5 (1M context). 2026-08-16, branch `phase-33-reader-ergonomics`.**

### The design, and what CONTRACT-051 changed about it

This issue was written before SHARED-043's rider existed. CONTRACT-051 has since
landed the lane vocabulary and the roster (`schemas/lane.ts`, `schemas/agents.ts`,
`GET /api/agents`, declared but deliberately unmounted), and §7 now defines
presence exactly: *"Presence is the parked request, and nothing else."* So the
question this issue asks — "is an agent there" — already has an answer on the
wire, at a different grain. Building a second one would have been the drift the
issue exists to remove, doubled.

**Decision 1 — share the roster's vocabulary; do not invent `lastAgentContact`.**
`presenceLiveField` and `presenceSinceField` (`schemas/agents.ts`) are now the
*literal schema objects* published on an `AgentLane` row **and**, through the new
`AgentPresence` component, on `QueueStatus.agent`. The two sites therefore carry
character-identical prose because they carry the same object — asserted in the
**generated** document by JSON pointer (`openapi.test.ts`, "publishes %s in the
same words"), not by grepping source. `QueueStatus.agent` is documented as *the
roster's own verdict aggregated*: `live` is true exactly when some lane's `live`
is. `AgentLane` keeps its fields flat, so a roster row is structurally an
`AgentPresence` and one predicate serves the pill and the picker.

Why publish an aggregate at all rather than have the console read
`GET /api/agents`: the strip already fetches this resource on load and on every
`["queue"]` frame, presence and depth are read together (depth matters most when
nobody is listening), and the roster route stays unmounted until SERVER-112. The
redundancy is real and is why the identity is stated in the published prose
rather than left implicit.

**Decision 2 — timestamp *and* verdict, not a timestamp alone.** The issue
preferred a raw instant plus a client-side rule. That was right when nothing else
answered the question; with the roster it would have made the client the only
party applying a window, while the server applied its own for the roster — two
rules, one question. So the server answers `live` (grace already applied, as
SERVER-112's tracker is specified to do) and `since` is the evidence. A client
may re-apply the **same** exported window to the **same** instant, which can only
ever *withdraw* a stale `live` and never manufacture one — a second application
of one rule, not a second rule. That is what makes §11's "the pill flips on its
own" reachable without a refetch.

**Decision 3 — the contract exports both the predicate and the four-state
function.** `isAgentPresent(presence, now)` and
`agentActivity({agent, halted, inProgress}, now)` live in `schemas/queue.ts`. The
precedence `halted > disconnected > working > idle` is the one judgement call
here: **`disconnected` outranks `working`**, which SHARED-033 listed as an open
edge case and its signed text did not settle (see "unresolved", below). It
follows from §11's own principle — `inProgress > 0` is a fact about events, not
about anyone holding them, and `working` about an agent that claimed work and
died is exactly as unevidenced as `idle` about an empty machine.

**Decision 4 — `since` means *last observed parked*, and advances on every
re-arm.** CONTRACT-051's landed description said "last seen parked" but gave
`live 4m` as the rendering, which are two different instants; the ambiguity is
load-bearing once anything computes an age from it. Pinned to the advancing
reading (so `now − since` is the age of the *evidence*, never the length of a
session) and the rendering example corrected to `last seen 12m ago`. Field shape
unchanged.

### Commands and observed output

```
$ npm run generate -w packages/contract      # exit 0
$ shasum openapi.json src/client/schema.generated.ts > before && npm run generate && shasum -c before
openapi.json: OK
src/client/schema.generated.ts: OK           # regeneration is idempotent — drift check clean
```

Generated document swept by JSON pointer (not by grep):

```
components/schemas/QueueStatus/properties -> [agent, halted, pending, inProgress,
                                              deferred, processed, failed, abandoned]
components/schemas/QueueStatus/required    -> includes "agent"
components/schemas/QueueStatus/properties/agent -> {"$ref":"#/components/schemas/AgentPresence"}
components/schemas/AgentPresence/type      -> object      (plain, non-nullable, undefaulted)
components/schemas/AgentPresence/required  -> [live, since]
AgentPresence.properties.live  === AgentLane.properties.live   -> true
AgentPresence.properties.since === AgentLane.properties.since  -> true
```

Typed client against a **real mounted app** (Hono + `@hono/node-server` on 8791,
route mounted from the contract's own `getQueueStatus`, read through
`createCorpusClient(...).api.GET("/api/queue/status")`):

```
no agent: {"live":false,"since":null}                  -> disconnected   # was: idle
parked  : {"live":true,"since":"2026-08-16T17:13:43Z"} -> idle
same response, one window later                        -> disconnected   # flips on the clock alone
held work (inProgress 4), nobody there                 -> disconnected   # not "working"
isAgentPresent(<an AgentLane row>)                     -> true           # one predicate, both grains
```

Tests: `npx vitest run packages/contract packages/kit` → **111 files, 3292 tests,
all passing**. `npx eslint packages/contract/src packages/kit/src` → no issues.
`npm run typecheck -w packages/contract` → clean. `npm run build` → clean.

### Unresolved / handed back

1. **Three workspaces do not typecheck until their own issues land**, because a
   required response field breaks every *constructor* of a `QueueStatus`:
   - `apps/server/src/queue/service.ts:661` (`status()`) — SERVER-086. Its own
     docblock at :654 already names this as the intended forcing function.
   - `apps/ui/src/console/consoleModel.ts:239` (`UNKNOWN_QUEUE_STATUS`), plus
     `console/Console.test.tsx:32`, `console/consoleModel.test.ts:21`,
     `e2e/console.spec.ts:317`, `e2e/stubCorpus.ts:911,919` — UI-098.
   Deliberately not fixed here: UI-098 rewrites those exact lines (`agentState`,
   the dot, the tick decision), and patching them blind would collide with it.
2. **Pre-existing, unrelated, and blocking `apps/server`'s typecheck today**:
   `apps/server/src/projection/schema.ts:366,370` — `error TS1005` (a syntax
   error in the `events` table DDL, from SERVER-111's lane column). It is not
   mine (I touched no server file) and it currently masks whatever else that
   workspace would report.
3. **SHARED-033's open edge case is now decided in code** (decision 3). If the
   user wants `working` to win over `disconnected`, it is one line in
   `agentActivity` — but the rider's own "a claim that requires evidence" reads
   the other way.
4. **SERVER-086's design is superseded in part.** Recording a standalone
   "last agent contact" scalar would be the second notion of liveness this issue
   removed. It should aggregate SERVER-112's `LaneTracker` (or seed it), and
   SERVER-112's "one server constant, default 900_000 ms" should become the
   contract's `AGENT_PRESENCE_WINDOW_SECONDS` (960 s) so one number is applied by
   both processes. Ordering is the orchestrator's call: as written, SERVER-086
   lands before SERVER-112.
5. **The queue key now owes a frame on a presence change** — recorded in
   `query-keys.ts` and `packages/kit/README.md`, and asserted against the
   generated `/events` description. Without it the pill would never notice the
   agent left. That is a requirement on SERVER-086.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] `openapi.json` regenerated, drift check clean
- [x] E2E verification log filled in
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[CONTRACT-045]` prefix
