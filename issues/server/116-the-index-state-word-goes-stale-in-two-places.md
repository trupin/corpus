# [SERVER-116] "Ranking is degraded" keeps saying so after the index has caught up

## Domain

server

## Status

done

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Related: SERVER-114 (the same defect shape), SERVER-115 (the other family)

## Spec References

- SPEC.md **§9.2** — invalidate keys
- The retrieval sections covering index state and degraded ranking

## Summary

The semantic index's `state` word rides on **three** routes:

- `/api/index/status` — cached under `["index"]`
- `/api/search` (`search/search.ts:272`) — cached under `["docs","search",{…}]`
- `/api/docs/{id}/related` (`related.ts:188`) — cached under `["docs",id,"related"]`

Both emitters name `["index"]` alone (`semantic/maintenance.ts:65`,
`semantic/worker.ts:397`). Both other consumers are mounted:
`SearchOverlay.tsx:82,278` renders the degraded-ranking note, and
`reader/useReaderDoc.ts:95` reads the related panel.

So an open search overlay **keeps telling the reader that ranking is degraded
after the index has caught up**, until something else invalidates its query.
Found by SERVER-114's sweep, not by anyone noticing — which is its own small
argument for the sweep.

## Why this is not a one-line fix, and is filed rather than folded in

The obvious emit — `["index"], ["docs"]` — makes **every throttled progress tick
re-read every board column**, because `["docs"]` is a prefix and TanStack matches
by prefix. That trades a stale sentence for a rebuild storm during exactly the
operation that is already working the machine hardest.

So the real question is a design one: **where should the index's state word be
cached at all?** Plausible answers, and none is obviously right:

- Serve it only from `/api/index/status` and have the two other surfaces read
  that route rather than embedding a copy — one fact, one cache, and the
  duplication disappears instead of being synchronised.
- Keep the copies but emit a narrower key that only the affected surfaces hold.
- Emit `["docs"]` but only on state *transitions*, never on progress ticks — the
  word changes far less often than the progress does.

The first is the one to beat: this is a fact copied onto three routes, and every
one of the invalidation bugs found this week is a copied fact whose copies were
not all named.

## Acceptance Criteria

- [x] A search overlay open across an index catching up stops claiming degraded
      ranking, without a reload
- [x] The same for the related panel
- [x] Progress ticks do not cause board-wide re-reads — state the measurement,
      do not assert it
- [x] Whichever design is chosen, say why the other two were not, in the code

## Testing Strategy

Unit on the emitted keys. The tick-storm criterion needs a count, not an
assertion — count the invalidations a full index run emits, before and after.

## E2E Verification Log

**Model: Opus 5 (1M context).**

### Reproduction — measured on a real server

Real workspace, `corpus server start`, a listener on `/events` for a whole
`POST /api/index/rebuild` cycle over 227 chunks:

```
rebuild: 202
  ["index"]      19
  (no ["docs"] frame at all)
search said 'indexing' while indexing, 'current' after; final state current
```

**Nineteen frames, none of which names anything a search or a related panel is
cached under.** The last line is the bug in one sentence: `/api/search`'s own
`semanticIndex` field went from `indexing` to `current`, and nothing ever told a
client holding the first answer that the second existed. The overlay keeps
saying ranking is degraded until something unrelated invalidates its query.

### The design chosen, and the two that were not

**Chosen: emit `["docs"]` on state *transitions* only** — the issue's third
option. The word is **read**, from the same `SemanticRetrieval.state()` that
`/api/index/status`, `/api/search` and `/api/docs/{id}/related` all publish, and
never re-derived: a fourth copy of the state table is exactly the pathology this
issue names.

`apps/server/src/semantic/announce.ts` is the whole of it. `["index"]` goes out
synchronously on every announcement, unchanged; `["docs"]` follows only when the
word has moved. One announcer is built in `app.ts` and shared by both emitters
(`worker.ts`'s `send`, `maintenance.ts`'s two rebuild edges), so **one** memo
decides whether the word moved — two would each announce the same transition.

**Not chosen: serve the word only from `/api/index/status`.** The issue is right
that this is the one to beat, and it stays the right answer. It is also three
domains: `SearchResults.semanticIndex` and `RelatedDocs.semanticIndex` are
contract fields, two UI components read them, and the CLI prints them. Not a
change `apps/server` can make. **Escalated.** Nothing here stands in its way —
the day those fields go, this module goes with them, and that is said in the
module's own comment.

**Not chosen: a narrower key.** TanStack matches by prefix and both affected
caches sit *under* `["docs"]` — `["docs","search",{…}]` and
`["docs",<id>,"related"]`. No key covers those two without covering the board's
lists, unless the UI re-keys them. Another domain again.

Two smaller decisions, both in the code:

- **The first reading is announced.** Treating it as a silent baseline misses a
  transition in the case that matters: a server that booted `current`, answered
  a search, and only then had work to do would set its baseline at `stale` and
  never say the word had left `current`. One extra frame per process buys that.
- **`["docs"]` on a state change is honest, not collateral.** When the index
  reaches `current`, relevance-ranked columns genuinely rank differently.

### The measurement, which is the criterion

**On the real server**, same rebuild, same workspace, after the change:

```
rebuild: 202
  ["docs"]       2      ← at t = 1.0s and t = 37.6s
  ["index"]     19
  ["reflect"]    2      (the bus widens ["docs"]; events/bus.ts)
final state: current   pending 0   indexed 227
```

**Nineteen index frames, unchanged. Two board-wide frames across the whole run**
— one at `current → indexing`, one at `indexing → current` — against **zero**
before. Not one lands on a progress tick.

The same measurement in a unit, so it cannot regress unnoticed: forty batches
plus two edges gives `[42 index frames, 2 board-wide frames]`
(`announce.test.ts`).

### Falsification

| mutation | result |
| --- | --- |
| the `state === announced` guard removed | 2 red — the transition test and the count |
| `readState` dropped from `app.ts`'s announcer | the wiring test red: `expected [ '["index"]', '["index"]' ] to include '["docs"]'` — the pre-fix behaviour exactly |
| both emitters reverted to `bus.invalidate([INDEX_KEY])` | the wiring test red |

One test could **not** be falsified by the mutation aimed at it: dropping
`announcer` from `worker-attach.ts` leaves the rebuild's edges coming from
`maintenance`, which still holds the shared announcer, so the integration test
stayed green. Said out loud rather than papered over — what that wiring buys is
a shared memo, and its absence costs duplicate frames rather than missing ones,
which no assertion here isolates.

### Runs

```
VITEST_MAX_THREADS=4 vitest run apps/server/src/semantic apps/server/src/events \
  apps/server/src/app.test.ts apps/server/src/lifecycle.test.ts
  Test Files  35 passed (35)
       Tests  572 passed (572)     exit 0
```

Seven new tests: six in `semantic/announce.test.ts` (the rule, coalescing, a
throwing reader, the no-reader and no-bus degenerates, and the count) and one in
`semantic/routes.test.ts` over a real `createServer` — which is the half a unit
cannot see, that `app.ts` and `worker-attach.ts` really hand both emitters the
one announcer.

### Escalated

`/api/search` and `/api/docs/{id}/related` still each carry a copy of a fact that
belongs to one route. This makes the copies agree; it does not remove them. The
design that does is a contract change plus two UI components plus the CLI.

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-116]` prefix
