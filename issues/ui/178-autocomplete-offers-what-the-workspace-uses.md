# [UI-178] Autocomplete offers the keys and tags the workspace already uses

## Domain
ui

## Status
todo

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

- [ ] A kit hook reads `GET /api/vocabulary`
- [ ] Typing `extra.` in the query editor offers the workspace's extra keys,
      most-used first
- [ ] Typing `tag=` offers the workspace's tags, most-used first
- [ ] The search overlay's `tag:` chip offers options on the hybrid path, which
      it cannot do today
- [ ] An empty or failed vocabulary read degrades to today's behaviour — the
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
_Filled by the implementer._

## Completion Checklist (domain agent)
- [ ] Tests pass
- [ ] E2E log filled
- [ ] Lint and typecheck clean
