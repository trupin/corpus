# [UI-178] Autocomplete offers the keys and tags the workspace already uses

## Domain
ui

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: CONTRACT-092, SERVER-159, UI-177
- Blocks: —

## Spec References
- SPEC.md §9.2 — `GET /api/vocabulary`
- SPEC.md §5 — **Structured fields**

## Summary

SHARED-011's own finding: *"Tag filtering already worked and the user did not
know."* An invented field is worse — it appears in no list anywhere. This issue
feeds the real vocabulary into the query editor's completion and the search
overlay's `tag:` chip, which is the affordance CONTRACT-026 asked for in 2026-08.

**This is the release's droppable issue.** UI-177 makes the feature usable
without it. If the endpoint does not hold, this issue moves out and the headline
still stands.

## Acceptance Criteria

- [x] A kit hook reads `GET /api/vocabulary`
- [x] Typing `extra.` in the query editor offers the workspace's extra keys,
      most-used first
- [x] Typing `tag=` offers the workspace's tags, most-used first
- [x] The search overlay's `tag:` chip offers options on the hybrid path, which
      it cannot do today
- [x] An empty or failed vocabulary read degrades to today's behaviour — the
      editor still works, and offers nothing rather than breaking

## Technical Design

### Files to Create/Modify
- `packages/kit/src/query/useVocabulary.ts` — new
- `packages/kit/src/index.ts` — export it, and its entry in the surface test
- `apps/ui/src/board/query/QueryEditor.tsx` — wire the source
- `apps/ui/src/board/query/grammar.ts` — the `extra` field's `ValueSource`
- the search overlay's tag chip

### Key Implementation Details

**A query, not a mutation.** The vocabulary describes the corpus and changes when
the corpus does, so it is cached by TanStack Query under a key that the existing
document invalidations already touch. Do not invent a new invalidation channel —
find the key the doc list uses and share its family.

**The grammar stays pure.** `grammar.ts` imports no React and reads no server.
The `ValueSource` for `extra` names a source; the editor resolves it. That is how
the existing dynamic sources work, so follow them rather than reaching for the
hook inside the grammar module.

**Failure is silence.** A vocabulary read that errors leaves the menu with the
static entries. Nothing about the query language depends on the endpoint being
reachable, and an editor that refuses to complete because a hint request failed
would be worse than one that never had hints.

### Edge Cases
- A workspace with hundreds of extra keys — bound the menu the way the existing
  completion bounds its lists, and say what the bound is
- A key already typed in the query — offering it again is harmless, and filtering
  it out costs a second parse. Leave it

## Testing Strategy
Hook test at the transport boundary, and editor tests that seed a vocabulary
response and assert the offered list and its order.

## E2E Verification Plan
Real dev server against a real workspace holding two invented fields. Type
`extra.` in a column query editor and confirm both keys appear with the
more-used one first.

## E2E Verification Log

**Implemented on: opus.**

### CONTRACT-026 closed itself

`apps/ui/src/search/filters.ts` had already written down what would fix the
`tag:` chip:

> the day this function returns real tags, the chip becomes a normal cycling
> chip again with no other edit.

That is what happened. `tagOptions` now takes the vocabulary and `tagChipState`
was not touched at all — the three states it distinguishes (`cycles`, `clears`,
`unavailable`) were already written against "is there a vocabulary", so the chip
went from disabled-with-an-apology to an ordinary cycling chip by one function
returning something.

`queryVocabulary.ts` had the same note about tags being sampled from one page:
"`CONTRACT-026` … is the fix that would make it exhaustive, and until it lands
this is the honest approximation". Tags now come from the endpoint, so a tag used
only on documents older than the sampled page is offered for the first time.

### Where the key completions go

`extra.` is the only completion in the editor that offers part of a **field
name**, and it has to be: an invented field appears in no list anywhere, so a
person who has not memorised their own convention cannot find it. The namespace
is recognised by `values.kind === "extraKey"` rather than by the literal string,
so `useQueryAutocomplete` still names no field.

Values are deliberately **not** offered. A workspace with a `customer` field on
four hundred documents would put four hundred strings in one menu, and the
endpoint does not return them.

### The cache key

`["docs", "vocabulary"]`, a child of the documents key. The published SSE key
vocabulary is closed and a new name there is a server emission to wire; this
resource changes exactly when documents change, and `invalidateQueries` matches
by prefix — so every frame that already names `["docs"]` refetches this, with no
new channel and no way for the menu to go stale while the corpus moves.

### A hint, never a gate

`retry: false`, and a failed read is silence: the tag menu is empty, the `extra.`
menu is empty, the chip stays disabled with the sentence it already had, and
every other chip is unaffected. Nothing the query language accepts depends on a
name appearing in a menu — `extra.customer=acme` runs for a field no document
carries yet. Three tests hold that, including one that answers the endpoint with
a `500`.

### Fixtures

Both stubs now answer the route, **derived from their seeded documents** rather
than canned — `boardFixture.ts` for the unit suites and `e2e/stubCorpus.ts` for
Playwright. That is the rule those files have learned twice already: an answer
of `{ tags: [], extraKeys: [] }` is indistinguishable from a workspace that uses
neither, so no spec could ever reach a chip that offers something.

## Completion Checklist (domain agent)
- [x] Tests pass
- [x] E2E log filled
- [x] Lint and typecheck clean
