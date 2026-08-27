# [SERVER-159] Enumerate the workspace's vocabulary from the projection

## Domain
server

## Status
done

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

- [x] `GET /api/vocabulary` answers the contract's shape
- [x] Tags come from `tags_json`, keys from `extra_json`, both counted by
      **distinct document**, not by occurrence
- [x] The default archived exclusion applies, the way every list applies it — an
      archived document's tags do not appear
- [x] Ordering is count descending, then name ascending
- [x] An empty corpus answers two empty arrays with `200`
- [x] It refuses without a token

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

**Implemented on: opus.**

### The two asymmetries this had to get right

- **Tags collapse by case, extra keys do not.** The `tag` filter matches
  case-insensitively, so offering `Finance` and `finance` would be two menu
  entries for one query. An extra key reaches SQL as a JSON path and
  `json_extract` is case-sensitive, so `Owner` and `owner` genuinely find
  different documents and collapsing them would offer a key that answers wrongly.
- **`count(DISTINCT d.id)`, not `count(*)`.** `json_each` yields one row per
  element, so a document carrying a tag twice — which nothing forbids in a
  hand-written file — would otherwise count as two.

Both are pinned by tests.

### What running it added

See CONTRACT-092's log: the first real answer put Claude Code's `name` and
`description` at the top of the list, from the skills `corpus init` installs.
`rankableSql` — the list the §7 rider signed 2026-08-24 — is now applied to both
statements, reusing a signed decision rather than inventing one.

### E2E, against the real server

```
$ curl … /api/vocabulary
tags: [{'value': 'work', 'count': 2}]
keys: [{'key': 'assignee', 'count': 2}, {'key': 'estimate', 'count': 1},
       {'key': 'for', 'count': 1}, {'key': 'owners', 'count': 1}]

$ curl -o /dev/null -w "%{http_code}" … /api/vocabulary   # no token
401
```

The counts agree with the documents on disk: two notes carry `assignee`, one
carries `estimate` and one carries `owners`.

## Completion Checklist (domain agent)
- [x] Tests pass
- [x] E2E log filled
- [x] Lint and typecheck clean
