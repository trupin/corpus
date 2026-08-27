# [CONTRACT-092] A vocabulary endpoint: the tags and `extra` keys this workspace uses

## Domain
contract

## Status
done

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

- [x] The §9.2 bullet above is applied to SPEC.md
- [x] `GET /api/vocabulary` is defined in `packages/contract/src/routes/`
- [x] The response schema carries `tags` and `extraKeys`, each an array of
      `{ value, count }` / `{ key, count }`
- [x] The route declares `200` and `401` and nothing else
- [x] It is listed in the route inventory test alongside its neighbours
- [x] `npm run openapi:check` regenerates cleanly

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

**Implemented on: opus.**

### One rule the issue did not have, and running it supplied

Against a real workspace `corpus init` had just created, plus two hand-written
notes, the first answer was:

```
tags:  [{value: core, count: 4}, {value: work, count: 2}]
keys:  [{key: description, count: 5}, {key: name, count: 5},
        {key: assignee, count: 2}, {key: estimate, count: 1}, ...]
```

`name` and `description` are **Claude Code's** frontmatter on a `SKILL.md`
(SPEC.md §7: the two sets coexist in one YAML block), and `core` is the shipped
skills' tag. They are not conventions this workspace invented, and on a fresh
workspace they outnumber everything a person has written — a completion menu
would have offered the tool's own machinery above the user's `assignee`.

The fix reuses a decision rather than inventing one: `rankableSql`, the
`skill`/`agent-def` list the §7 rider signed 2026-08-24, whose stated bar is
exactly this — *the tool wrote it, not the user*. It excludes them from a
**menu** and from nothing else: `extra.name=comment` still runs and
`doc list --type skill` is untouched.

After:

```
tags: [{'value': 'work', 'count': 2}]
keys: [{'key': 'assignee', 'count': 2}, {'key': 'estimate', 'count': 1},
       {'key': 'for', 'count': 1}, {'key': 'owners', 'count': 1}]
```

**Open question, deliberately not decided here.** `for` comes from a seed
`type: view` document that `corpus init` writes, so by the "tool wrote it" test
it arguably belongs out too. The signed list is "exactly the two types
`corpus init` puts on disk", written before seed views existed, and widening it
would be making a decision the rider did not. One key of noise is the cheaper
error.

### Generated output

```
$ npm run generate -w packages/contract
generated ./openapi.json
generated ./src/client/schema.generated.ts
```

`GET /api/vocabulary` appears once in the document, declaring `200` and `401`.
The route inventory test failed until it was registered, which is what that test
is for.

### E2E

```
$ curl -H "Authorization: Bearer …" http://127.0.0.1:8791/api/vocabulary
{"tags":[{"value":"work","count":2}],"extraKeys":[…]}
$ curl -o /dev/null -w "%{http_code}" http://127.0.0.1:8791/api/vocabulary
401
```

## Completion Checklist (domain agent)
- [x] Tests pass
- [x] `openapi.json` regenerated
- [x] SPEC.md bullet applied
