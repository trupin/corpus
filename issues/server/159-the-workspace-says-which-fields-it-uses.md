# [SERVER-159] Enumerate the workspace's vocabulary from the projection

## Domain
server

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: CONTRACT-092
- Blocks: UI-178

## Spec References
- SPEC.md §9.2 — `GET /api/vocabulary`

## Summary

Answer `GET /api/vocabulary` out of the projection: every tag and every extra
frontmatter key the corpus actually carries, each with a document count.

## Acceptance Criteria

- [ ] `GET /api/vocabulary` answers the contract's shape
- [ ] Tags come from `tags_json`, keys from `extra_json`, both counted by
      **distinct document**, not by occurrence
- [ ] The default archived exclusion applies, the way every list applies it — an
      archived document's tags do not appear
- [ ] Ordering is count descending, then name ascending
- [ ] An empty corpus answers two empty arrays with `200`
- [ ] It refuses without a token

## Technical Design

### Files to Create/Modify
- `apps/server/src/docs/vocabulary.ts` — new
- `apps/server/src/docs/vocabulary.test.ts` — new
- `apps/server/src/app.ts` — mount it

### Key Implementation Details

Two statements, each a `json_each` join over `documents` with
`notArchivedSql("d")` applied:

```sql
SELECT lower(tg.value) AS value, count(DISTINCT d.id) AS count
  FROM documents d, json_each(d.tags_json) tg
 WHERE <not archived>
 GROUP BY 1 ORDER BY count DESC, value ASC
```

and the same shape over `json_each(d.extra_json)` selecting `key`.

**Lowercase the tags**, because the tag filter lowercases both sides. Offering
`Finance` from a menu whose filter matches case-insensitively is harmless;
offering two entries that differ only in case is a menu bug.

**Do not lowercase extra keys.** A key is an identifier the author chose and
`json_extract` is case-sensitive, so `Owner` and `owner` are genuinely two
fields.

**Reuse `notArchivedSql`** rather than writing `status <> 'archived'` again —
that constant exists so the places that must agree do.

### Edge Cases
- `extra_json` holding `{}` contributes nothing
- A tag that differs only by case collapses into one row with the summed count
- A workspace with no documents at all

## Testing Strategy
Against a real projection with a seeded corpus: counts, ordering, the archived
exclusion, and the empty case.

## E2E Verification Plan
Real server, real workspace. `curl` the route and compare its counts against
`corpus doc list --tag <t> --json | jq '.page.total'` for two tags.

## E2E Verification Log
_Filled by the implementer._

## Completion Checklist (domain agent)
- [ ] Tests pass
- [ ] E2E log filled
- [ ] Lint and typecheck clean
