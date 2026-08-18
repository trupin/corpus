# [SERVER-116] "Ranking is degraded" keeps saying so after the index has caught up

## Domain

server

## Status

todo

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

- [ ] A search overlay open across an index catching up stops claiming degraded
      ranking, without a reload
- [ ] The same for the related panel
- [ ] Progress ticks do not cause board-wide re-reads — state the measurement,
      do not assert it
- [ ] Whichever design is chosen, say why the other two were not, in the code

## Testing Strategy

Unit on the emitted keys. The tick-storm criterion needs a count, not an
assertion — count the invalidations a full index run emits, before and after.

## E2E Verification Log

_Filled by the implementing agent._

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-116]` prefix
