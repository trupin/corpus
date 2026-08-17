# [CONTRACT-055] `QUERY_KEY_VOCABULARY` does not say that queue transitions change the roster

## Domain

contract

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: SERVER-115
- Related: CONTRACT-045, SERVER-114

## Spec References

- SPEC.md **§9.2** — invalidate keys

## Summary

`SERVER-115` needs queue transitions, job-log appends, thread edits, rebuilds
and deletions to name `["agents"]`, because all of them change what
`GET /api/agents` would answer — the roster's `summary` reads the same `events`
and `jobs.last_line` a queue transition writes.

The published `emittedBy` for those keys does not say so. A server that emits a
frame the vocabulary denies is the same drift `CONTRACT-052` spent a pass
cleaning out of the diff descriptions: the artifact ships, someone reads it, and
it is confidently wrong.

Note the one thing the vocabulary already got **right**, which is why SERVER-114
needed no contract change: `QUERY_KEY_VOCABULARY.queue.emittedBy` has said "plus
every change to agent presence" since CONTRACT-045. The server was the only side
out of step there. This issue is the converse — the server is about to become
correct, and the vocabulary is what will be lying.

## Acceptance Criteria

- [x] `emittedBy` for the affected keys states that the roster changes with
      them, and says **why** (the roster's summary is derived from the same
      rows), so the next reader does not have to rediscover the coupling
- [x] The published `openapi.json` is regenerated and swept structurally, as
      CONTRACT-052 established — not grepped
- [x] The vocabulary and `SERVER-115`'s emitters are checked against each other,
      in a test if one can be written: a vocabulary that drifts from the
      emitters is the failure this issue exists to prevent, and it should not be
      prevented only by someone remembering
      — **partially, and the boundary is stated rather than blurred**: the
      internal-consistency half is tested here; the half that holds the prose
      against the server's actual emitters cannot live in `packages/contract`
      and belongs on SERVER-115. See "The cross-check" below.

## Testing Strategy

Generation and drift check. The cross-check against the server's emitters is the
valuable test if it can be expressed — say so if it cannot, rather than leaving
the impression it was covered.

## E2E Verification Log

**Model: Opus 5 (1M context), as contract-dev.** Prose-only issue — no route, no
schema, no shape, no behaviour. The "E2E" is therefore the generated artifact
itself: regeneration, idempotence, a structural sweep of the published document,
and a fingerprint proving the shape did not move.

### The wording, and why it is worded that way

The rule is published **above the list**, not buried in one entry, because it is
the generative fact and the list is only its instances (`routes/events.ts`):

> **An emitter names every key a route carrying the changed fact is cached
> under, not the key of the route the fact is named after** — so several of
> these travel in frames named after some other resource, and each entry below
> says which and why.

`["agents"]` then carries the full truth, since it is the key being emitted:

> …**plus every write that moves a row a lane is derived from**: a queue
> transition or a job-log append, over HTTP or out of band, since a lane's
> `summary` is read off the same `events` and `jobs` rows that write touches; a
> designated root thread being retitled or deleted, since a row carries that
> conversation's title and its existence; and a projection rebuild, which
> re-derives all of it. The rule behind that list is worth stating, because no
> single call site shows it: **a lane row is computed at read time and never
> stored**, so the roster goes stale on frames named after other resources, and
> an emitter names this key whenever it writes a row the roster reads — not only
> when it writes something called an agent. The derivation itself may change
> without a contract change (`AgentLane.summary` says as much of its own
> content); the invalidation may not.

Four decisions inside that paragraph:

1. **The derivation is given as a reason, not as a promise.**
   `AgentLane.summary` already publishes that *how* it is derived "may change
   without a contract change". Stating the coupling without that caveat would
   have created a second, contradicting promise in the same document. The last
   sentence separates them: the derivation may move, the invalidation may not.
2. **The rule is stated as well as the cases**, so an eighth emitter does not
   falsify the description. (There is a plausible eighth — see "Observed, not
   changed".)
3. **Stated in both directions.** `["queue"]` and `["jobs"]` each gain one
   sentence naming `["agents"]` and pointing at that entry for the reason. A
   server author adding a queue transition reads the queue entry, not the agents
   entry; a rule stated only where it is not needed is how the two come to
   disagree.
4. **`["docs"]`, `["docs","<id>"]` and `["threads","<id>"]` deliberately do not
   gain a clause**, even though `docs/write.ts` and `docs/delete.ts` will emit
   `["agents"]` for a *designated root thread*. That case is narrow, and hanging
   a conditional on the busiest key in the vocabulary buys noise; the agents
   entry names it.

The roster's own route (`routes/agents.ts`) gains the same warning, because a UI
author implementing `useAgents` lands there and not on `/events`:

> **Every row here is derived, so the frame that stales it is often named after
> something else.** … A client that refetches this only on designation and
> presence changes will show a stale roster; `GET /events` lists the full set of
> emitters.

### The structural sweep — walked, not grepped

`allDescriptions()` (now a test helper in `openapi.test.ts`, so the sweep is
repeatable) walks every `description`/`summary`/`title`/`example` node in the
generated document by JSON pointer.

- **1184 prose nodes**, before and after — identical, so the change added and
  removed none.
- **12** mention an invalidation, a refetch or a key literal. Read in full. Only
  two make emitter claims: `/events` and `GET /api/agents`. The other ten are
  the `key`-vs-lock prose (`Doc.key`, `UpdateDocRequest.key`), `IndexStatus.
  rebuilding`, the move/seen/job-log/upgrade-check routes and the SSE tag — none
  claims anything about which writes stale which key.
- **11** name an emitter, an announcement or a broadcast at all
  (`emitted|emits|broadcast|goes stale|stales|announce`). The extra ones are
  `Warning.code`, the two `relation` enums ("Phase A emits only `linked`"), the
  diff and flush routes' `doc.edited` prose, `POST /api/threads/{id}/resident`
  and `POST /api/skills`. None describes an invalidation emitter.
- **12** mention the roster. The five `recipient` fields, `AgentLane.live`,
  `AgentPresence` (×2), `GET /api/queue/status` and the two changed nodes. No
  contradiction with the new claims: `AgentPresence` still states the aggregate
  identity CONTRACT-045 published, and nothing anywhere says the roster changes
  *only* on designation and presence.

**Two further defects of the same family, found by the sweep and fixed** — both
describe an emitter by the route the fact is named after rather than by the
routes that carry it, and both were describing **already-shipped** behaviour:

- **`["docs"]` never named queue transitions.** `QUEUE_QUERY_KEYS` has carried
  `DOCS_KEY` since SERVER-028, because `needs=failed-job` is computed from
  `events.status` (`docs/needs.ts`, `FAILED_JOB_SQL`) — so a transition into or
  out of `failed` changes what `GET /api/docs?needs=me` answers. The published
  vocabulary described that emission only under `["queue"]`. Same for the
  watcher's out-of-band copy (`watcher.ts:457`).
- **The projection rebuild was named by no entry at all.** `REBUILD_QUERY_KEYS`
  is `[DOCS, TREE, QUEUE, JOBS]`, emitted unconditionally — and deliberately so,
  per its own docblock: a rebuild is a resynchronisation instruction, not a
  report of a change. Four keys, four descriptions, none of which mentioned it.
  `["docs"]`, `["tree"]`, `["queue"]` and `["jobs"]` now do, and `["agents"]`
  does with the rest.

**And one plain falsehood in the sentence this issue had to edit anyway**: the
`/events` description said *"these **ten** shapes and no others"* above a list
of **nine**. A count hand-written beside a rendered list is the one arrangement
guaranteed to drift; it is now `QUERY_KEY_NAMES.length`, interpolated, and a
test asserts the claimed count equals the rendered bullet count.

### Observed, not changed

- **A possible eighth emitter for SERVER-115.** A row's `resident.docId` is
  re-resolved on every response through `resolveMentionTarget(…, "agent-def", …)`,
  which indexes `type: agent-def` documents by path stem and title. So creating,
  deleting, renaming or archiving an **agent-def document** can change what
  `GET /api/agents` answers, and `docs/write.ts` names `["agents"]` for none of
  it. Not in SERVER-115's table. The published rule covers it ("whenever it
  writes a row the roster reads"), so no wording changes if it is fixed later.
- **`["docs","<id>"]` and `["threads","<id>"]` do not mention out-of-band
  watcher edits** though `watcher.ts:291` emits both, while `["docs"]` does.
  Incomplete rather than wrong, and a different family from this issue's, so it
  is recorded here rather than fixed silently.
- **SPEC.md has no §9.2.** This issue, SERVER-115, SPEC §7 (line 329) and SPEC
  §9.2's `GET /api/agents` bullet (line 459) all cite "§9.2 — invalidate keys";
  §9 stops at 9.3. A dangling spec cross-reference, needing sign-off rather than
  an agent's edit. Flagged, not touched.

### The cross-check — expressible, but not from here

**It cannot be written in `packages/contract`, for two independent reasons.**
The dependency direction forbids importing `apps/server` (CLAUDE.md), so this
package cannot see an emitter; and `emittedBy` is prose, so even with the
import there is no machine-readable relation on the contract side to compare a
key list against.

What *is* expressible here, and is now tested, is the **internal** consistency
that made CONTRACT-052's stale descriptions survive — a half-finished update:
the set of entries cross-referencing `["agents"]` must be exactly
`["queue","jobs"]`, each must give the derivation as its reason, and the agents
entry must name those same two families back.

**Where the real cross-check belongs: `apps/server` — and the pattern already
exists there.** `apps/server/src/queue/liveness.test.ts:339` reads the
contract's published `emittedBy` back and holds `PRESENCE_QUERY_KEYS` to it:

```ts
const claimed = QUERY_KEY_NAMES.filter((name) =>
  /presence|liveness/i.test(QUERY_KEY_VOCABULARY[name].emittedBy),
);
expect(claimed).toEqual(["queue", "agents"]);
for (const name of claimed) {
  expect(PRESENCE_QUERY_KEYS).toContainEqual(QUERY_KEY_VOCABULARY[name].key(""));
}
```

SERVER-115 should write the converse of that over `QUEUE_QUERY_KEYS`,
`REBUILD_QUERY_KEYS` and the watcher's inlined lists — and, better than any
per-site assertion, a bus-level invariant test: drive real operations through
the app (enqueue → claim → complete, a job-log append, a retitle of a designated
root thread, a rebuild, a watcher-observed event move) and assert that every
frame carrying `["queue"]` or `["jobs"]` also carries `["agents"]`.

**A mechanically-derived version was considered and rejected.** Publishing a
co-emission relation from the contract (`{queue: ["agents"], …}`) would make the
server's assertion derived rather than hand-written — but it would pin an
invariant this package cannot ground, and SERVER-115 explicitly forbids a
blanket addition ("does not where it does not — a blanket addition that makes
unrelated writes re-read the roster is a different defect"). Whether
`halt/resume` owes the roster a frame is the server's call, site by site, and
the contract should not decide it by publishing a matrix first. Worth revisiting
once SERVER-115 has settled the per-site answers.

**The window this opens, stated plainly.** Contract-first is the order this
issue mandates, and it means that between this landing and SERVER-115 the
published description over-promises: the server does *not* yet name
`["agents"]` on a queue transition. Everything else added here — the queue
transition under `["docs"]`, the rebuild under all four — describes behaviour
that ships today.

### Regeneration, idempotence and the drift check

```
$ npm run generate -w packages/contract          # exit 0
generated ./openapi.json
generated ./src/client/schema.generated.ts

$ shasum -a 256 …                                 # run three times, identical
bbd2b837381d45ceed69e2d55c4d7a8efb05521d34e298a4961b324328740e71  openapi.json
c436b4c04f6ad98419ba0d29020bfeafc69ca6d96cd3ab8fa5196937ecd69d43  src/client/schema.generated.ts
```

### That the shape did not move

Every source edit is a string literal inside `description:` / `.describe(...)`
or a JSDoc block, plus one added import (`QUERY_KEY_NAMES` into
`routes/events.ts`, so the shape count is interpolated rather than hand-typed).
No `z.` call, no `createRoute` field other than `description`, no component
registration changed.

Prose-stripped fingerprint of the regenerated document (every `description`,
`summary`, `example`, `title` removed, keys sorted) — **50 paths, 107 component
schemas**, `sha256 a9427541ae4a34f31b46274c89b42f2c8e376d0c246fb80b9ccafe5d30c305ba`
over 80 828 bytes. That is **byte-identical to the fingerprint CONTRACT-052
recorded in its own log**, which is a stronger statement than "my edit moved
nothing": the published API shape has not moved since that issue ran. (This
agent runs no git command, so it has no committed baseline to diff; the
orchestrator can compute the same projection over
`HEAD:packages/contract/openapi.json` and confirm.)

### Tests

Twelve assertions added, in the two files where the mistake would recur.

`query-keys.test.ts` — a new `keys the roster is invalidated by (CONTRACT-055)`
block over the source of truth: the roster key names every roster-staling write;
it says *why* (the "computed at read time and never stored" clause, the
`events`/`jobs` rows, the generative rule); it gives the derivation without
promising it; the cross-reference is bidirectional and its set is exactly
`["queue","jobs"]`; every key the rebuild emits names the rebuild; `["docs"]`
names queue transitions and `needs=failed-job`.

`openapi.test.ts` — the same claims asserted against the **generated** document,
where a client author who never opens the package reads them, plus the shape
count and a sweep-as-a-test that no description anywhere presents the roster's
emitters as designation and presence and stops there.

Non-vacuity checked directly against the retired strings:

```
sweep regex vs OLD rendered agents line: true      # "…grace window. Refetch:"
sweep regex vs NEW document:             false
count regex vs OLD claim:                [ 'ten' ]
count regex vs NEW claim:                [ '9'  ]
```

```
$ VITEST_MAX_THREADS=4 vitest run packages/contract        → 63 files, 2536 tests, 0 failed
$ VITEST_MAX_THREADS=4 vitest run apps/server/src/queue/liveness.test.ts
                                                            → 21 tests, 0 failed
                                          (the existing contract↔emitter cross-check, unbroken)
$ rtk proxy npx tsc --noEmit -p packages/contract > out.txt 2>&1; echo $?   → 0
$ npx eslint <5 touched files>                              → exit 0, no issues
$ npx prettier --check <5 sources + 2 generated>            → exit 0
```

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-055]` prefix
