# [SERVER-118] `GET /api/queue/idle` accepts any thread id as a scope, and `agent.live` then lies

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Related: SERVER-112, CONTRACT-053, CLI-046

## Spec References

- SPEC.md **§7** — presence is the parked request; a lane is a designated
  thread's scope

## Summary

`recipient` is validated against `isDesignatedRoot` and refused with a 422.
**`scope` on `GET /api/queue/idle` is validated only as `LaneSchema`** — any
`th_` id passes — and flows straight into `observePark(scope)`.

`LaneTracker.presence()` aggregates over every lane anything has parked on, so
**parking on an undesignated thread makes `agent.live` true indefinitely**,
while `GET /api/agents` never lists that lane.

`packages/contract/src/schemas/queue.ts` publishes: *"`agent.live` is true
exactly when some `AgentLane.live` is."* That is false as shipped.

**It is reachable exactly as the converse skill predicts** — *"a wrong lane is
honoured in silence"*. A typo'd or stale `--thread` parks forever and the
workspace reports an agent listening when none is.

**And it is a decision use, not a display.** `apps/cli/src/commands/queue/
control.ts` and `docs/cli.md` advertise
`corpus queue status --json | jq -e '.agent.live'` as *"a guard before enqueuing
work"*. CONTRACT-053's "display-only, nothing should change on the server" does
not cover this.

## A second, smaller way the same sentence is false

`liveness.ts`'s `presence().since` takes the max `lastSeen` across **all**
records regardless of liveness, so `agent.since` can be an instant belonging to
a lapsed, non-roster lane — one no `AgentLane.since` carries. The contract says
"the most recent of theirs". The direction is safe (a client can only be more
generous about expiring), but it is a second falsehood in one published
sentence, and CONTRACT-053 names neither.

## Acceptance Criteria

- [x] `scope` on `idle` is validated the way `recipient` is: a scope that is not
      a designated root is refused, with the same 422 shape and a message that
      names the fix
- [x] Decide and state whether a lane that **lapses out of designation** while
      parked is refused on re-park or tolerated until it returns — a resident
      released mid-park is a real sequence and the answer should be deliberate
- [x] `presence().since` is the most recent among **live** lanes, matching the
      published sentence
- [x] A test asserts `agent.live` and `GET /api/agents` cannot disagree in this
      direction — CONTRACT-053's grace-window disagreement is a different case
      and must still be allowed
- [x] Every test checked red first

## Testing Strategy

Route-level for the refusal; unit for `presence()`. An integration test that
parks on an undesignated thread and asserts `agent.live` stays false is the one
that matters.

## E2E Verification Log

Model: **Opus 5 (1M context)**. Real `corpus init` workspace, real server started
with `corpus server start` (port 8767, never 8765), real HTTP.

### Reproduction, before any code changed

Workspace with one standalone thread `th_l3jjksy4` and **no resident**; roster
holds only the orchestrator's row.

```
$ curl "…/api/queue/idle?scope=th_l3jjksy4&timeout=30"    # parked, accepted
$ curl "…/api/queue/status"
{"agent":{"live":true,"since":"2026-08-17T14:23:02Z"}, …}
$ curl "…/api/agents"
{"agents":[{"lane":"orchestrator", …,"live":false,"since":null, …}]}
```

`agent.live` true, and **no** `AgentLane.live` is — the published sentence
falsified. A thread this workspace does not hold at all behaves identically, and
the lie outlives the park:

```
$ curl -o /dev/null -w "%{http_code}" "…/api/queue/idle?scope=th_deadbeef&timeout=1"
204
$ curl "…/api/queue/status"            # after the window closed
{"agent":{"live":true,"since":"2026-08-17T14:23:25Z"}, …}
```

Nothing was designated at any point; that `live: true` stands for a whole grace
window (960 s) and is re-armed by every re-park, i.e. indefinitely.

### After the fix

1. **Refusal.** `idle?scope=th_l3jjksy4` (thread exists, no resident) →
   `422 unknown_recipient`, message naming the value and the recovery
   ("omit `scope` to take the orchestrator's lane, designate a resident on that
   thread first, or pick a lane from `GET /api/agents`"). `scope=th_deadbeef`
   returns a byte-identical body apart from the quoted id — no existence oracle.
2. **Presence untouched.** After both refusals: `{"live":false,"since":null}`
   and the roster still lists only `orchestrator`. No tracker record was created,
   so there is nothing to expire.
3. **Real lane still works.** `corpus thread designate th_l3jjksy4 --agent
   researcher`, then park: status `{"live":true,"since":"…14:33:44Z"}` and the
   roster row for `th_l3jjksy4` carries the same `live`/`since`.
4. **Released mid-park (the judgment call).** With the listener parked, `DELETE
   /api/threads/th_l3jjksy4/resident` → 200. Status still `live: true`; roster
   lanes back to `["orchestrator"]` — CONTRACT-053's window, deliberately still
   legal. The **in-flight** park ran to its own end undisturbed (`HTTP 204` after
   its full window, verified with a 6 s park released at t+2 s). The **re-park**
   is `422`. `POST /api/queue/claim-all?scope=th_l3jjksy4` still returns `200`,
   so events already stamped for that lane are drainable by the listener still
   holding it rather than stranded until the lapse.
5. **CLI surface.** `corpus queue idle --thread th_deadbeef` prints
   `corpus: 422 unknown_recipient: …` with the full recovery; `--json` emits
   `{"error":{"code":"unknown_recipient","message":"…","hint":null}}`.

### Checks

- `apps/server` unit suite: **4030 passed / 191 files** (`vitest run apps/server/src`).
- `eslint` on every touched path: clean. `tsc --noEmit -p apps/server`: clean
  (run through `node_modules/.bin/tsc`, exit 0, empty output — not the proxy's
  line). `prettier --check` on touched files: clean.

### Every new test checked red first

- `liveness.test.ts` "carries the most recent instant among the live lanes" —
  red against the pre-fix `presence()`: `since` `22:14:20Z` (the lapsed lane's)
  vs `22:13:20Z` (the live one's).
- `roster.test.ts` "leaves agent.live false and the roster untouched" — red on
  the **property**, not the status code: `{live: true, since: "…"}` while the
  roster listed nothing live. (Presence is read while the attempt is outstanding
  precisely so the assertion cannot be satisfied by the 422 alone.)
- The other three route-level refusals and all four `assertScopeIsLane` unit
  refusals — red with the assertion stubbed to a no-op.
- Deliberately green in both runs, and meant to be: "still reports when a
  listener was last parked once every lane has lapsed", "still admits the
  orchestrator's lane", and the CONTRACT-053 half of "keeps a park admitted
  before the release".

### Decisions taken, and what they cost

- **A lane that lapses out of designation mid-park is tolerated until the
  re-park.** Presence is the held request (§7), so a lane the server is at that
  moment holding an `idle` open on *does* have somebody listening on it. Ending
  the request would abort it for a reason that is not the request's, and dropping
  the record would answer "nobody is listening" about a request the server is
  listening on. The park ends when its window does, the re-park is refused, and
  the lane leaves presence one grace window later — at which point §7's own
  fallback hands its already-stamped events to the orchestrator's unscoped claim.
  This is also the semantics the shipped converse skill already assumes
  ("a park already holding does not end because a designation ended").
- **The refusal guards `idle` and not `claim-all`**, for the reason in item 4
  above: refusing the claim would make a just-released lane's stamped events
  claimable by nobody for a whole grace window.
- **`presence().since` is the most recent instant among the live lanes**, per the
  criterion — **with a fallback to the most recent overall when nothing is
  live**. `since` is published as "when a listener was last observed parked —
  null when none ever has been", so a bare null there would assert something
  larger and falser than the bug being fixed, and it is the field `corpus agents`
  and `corpus queue status` tell `lapsed` from `waiting` on. The existing
  `roster.test.ts` case "says nobody is there until something parks…" already
  asserts `after.since` is **not** null once every lane has lapsed.
- **Contract gap, for the orchestrator.** `contractRoutes.idleQueue` declares
  `200/204/400/401` and no `422`, so the OpenAPI document and the generated
  client are one refusal behind the server. The body stays inside the published
  `ApiError` union (`unknown_recipient`, whose own field description reads "the
  value that named no lane" without naming a parameter), so nothing breaks — but
  a companion CONTRACT issue should declare the response and consider whether the
  carried field should stop being spelled `recipient`.

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-118]` prefix
