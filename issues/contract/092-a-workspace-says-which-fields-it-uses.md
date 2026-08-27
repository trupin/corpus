# [CONTRACT-092] A vocabulary endpoint: the tags and `extra` keys this workspace uses

## Domain
contract

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: SHARED-011, CONTRACT-091
- Blocks: SERVER-159, UI-178
- Supersedes: CONTRACT-026 (closed by this issue)

## Spec References
- SPEC.md §9.2 — the server's read routes
- SPEC.md §5 — **Structured fields**: "a convention a workspace invents … becomes
  a filter the moment it is written"

## Summary

CONTRACT-091 makes a field a filter. Nothing tells anybody the field exists.

SHARED-011 says so in its own words: *"Discoverability is half the feature. Tag
filtering already worked and the user did not know."* The same trap is worse for
`extra`, because a core filter at least appears in the editor's field list and an
invented one appears nowhere.

`CONTRACT-026` asked the same question two releases ago for tags alone — the
search overlay's `tag:` chip cannot offer options on the hybrid path, because
ranked hits carry no tags. It listed a dedicated route as candidate (b). One
route answers both, so CONTRACT-026 closes here rather than being built twice.

## The SPEC line this adds

`GET /api/vocabulary` is a new route, so §9.2 gains one bullet. The user
authorized it in the v0.26.0 go-ahead — *"plus the vocabulary endpoint if it
holds"* — rather than in a separate signature, and the release notes say so.

> - `GET /api/vocabulary` — the values a workspace actually uses, for the filter
>   chips and the query editor's completion: every `tag` and every extra
>   frontmatter key present in the corpus, each with the number of documents
>   carrying it. Derived from the projection on demand and cached nowhere; it
>   describes the corpus rather than configuring it, so it is read-only and has
>   no acting party.

## Acceptance Criteria

- [ ] The §9.2 bullet above is applied to SPEC.md
- [ ] `GET /api/vocabulary` is defined in `packages/contract/src/routes/`
- [ ] The response schema carries `tags` and `extraKeys`, each an array of
      `{ value, count }` / `{ key, count }`
- [ ] The route declares `200` and `401` and nothing else
- [ ] It is listed in the route inventory test alongside its neighbours
- [ ] `npm run openapi:check` regenerates cleanly

## Technical Design

### Files to Create/Modify
- `SPEC.md` §9.2 — the bullet above
- `packages/contract/src/routes/vocabulary.ts` — new
- `packages/contract/src/routes/inventory.ts` — register it
- `packages/contract/src/schemas/vocabulary.ts` — new
- `packages/contract/openapi.json` — regenerated

### Key Implementation Details

Counts, not bare lists. A completion menu that ranks by use is worth more than
one that ranks alphabetically, and the count is one column in the same
`GROUP BY` — free at the point it is computed and impossible to add later
without a wire change.

**No values for extra keys.** The response says which keys exist, never which
values they hold. A workspace with a `customer` field on four hundred documents
would otherwise return four hundred strings for one menu. Keys are bounded by
the conventions a workspace invents; values are bounded by nothing.

**Tags carry their values** because a tag vocabulary is what a tag *is* — the
whole point of CONTRACT-026 — and tags are already a closed, comma-free,
low-cardinality set.

### Edge Cases
- An empty corpus answers `{ tags: [], extraKeys: [] }`, never a `404`
- A document whose `extra_json` is `{}` contributes no keys
- Ordering is by count descending, then by name — deterministic, so a client may
  render it without sorting

## Testing Strategy
Schema round-trip, and the inventory test that every declared route is mounted.

## E2E Verification Plan
`npm run openapi:generate`, then read the new path out of `openapi.json`.

## E2E Verification Log
_Filled by the implementer._

## Completion Checklist (domain agent)
- [ ] Tests pass
- [ ] `openapi.json` regenerated
- [ ] SPEC.md bullet applied
