# [SERVER-073] Answer `isParent` in the collection query

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-042
- Blocks: UI-088

## Spec References

- SPEC.md §9.2 — the collection query endpoint
- SPEC.md §9.1 — the projection

## Summary

The server half of the user's `isParent` request (see CONTRACT-042 for the
decided semantics): `isParent=true` selects documents with **no parent**.

## Acceptance Criteria

- [x] `isParent=true` returns only rows whose `parent` is null; `isParent=false`
      only rows where it is set
- [x] Absent changes nothing about the result set — asserted, not assumed
- [x] It **composes** with every other filter, including `q` (FTS), `type`,
      `needs=` and paging. A filter that works alone and breaks under
      composition is the failure mode worth testing for here, because views
      combine filters by nature
- [x] `total` / paging counts reflect the filter, so a windowed answer does not
      look complete (the defect CONTRACT-035 exists for)
- [x] The contradiction case (`parent=<id>` together with `isParent=true`)
      behaves as CONTRACT-042 declared — same behaviour, not merely compatible
- [x] A query plan that does not table-scan: check whether the existing index
      set covers a null test on `parent`, and say what you found — measured, see
      the log below. **No index added, so no `SCHEMA_VERSION` bump.**

## Technical Design

### Files to Create/Modify

- The collection query builder in `apps/server/src/docs/`, and the projection
  index set in `apps/server/src/projection/` if one is needed.

### Notes

- If an index is added, that is a `SCHEMA_VERSION` bump and a rebuild — say so
  and follow the note convention already in `projection/schema.ts`, which
  records *why* each bump changes verdicts for bytes already on disk.
- Check what `parent` actually holds for non-thread rows before implementing the
  null test; CONTRACT-042 flags this as a thing to verify rather than assume.

## Testing Strategy

Fixtures with top-level documents, child threads, and a standalone document with
no children (which must match `isParent=true`). Composition with `q`, `type`,
`needs=` and paging. Plus the contradiction case.

## E2E Verification Log

**Model: Opus 5 (1M context)** — server-dev, 2026-08-07.

### What was implemented

One predicate in `apps/server/src/docs/filters.ts`, in the contract's own
parameter order (between `pinned` and `needs`):

```
query.isParent ? "t.parent_id IS NULL" : "t.parent_id IS NOT NULL"
```

Unguarded — deliberately **not** the `t.id IS NULL OR …` form the four
thread-only filters carry. `parent`/`agent`/`author`/`unread` ask questions only
a thread row can answer; this one every row answers, because a non-thread row's
`parent` is null by genuinely having none. It is the same null the row reports
(`query.ts` selects `t.parent_id AS parent` through the same LEFT JOIN), so the
filter and the field cannot disagree. Neither branch binds a value: the boolean
picks between two of the module's own fragments.

Nothing else changed. `whereClause`, both statements and the COUNT already
compose whatever `compileFilters` returns, which is why `total` and paging follow
for free rather than needing a second edit — and why `/api/search` does not
acquire the filter it was not signed for (its query type simply has no
`isParent`, and the builder finds it absent).

### Indexing — what was found

**No index is warranted, and none was added; `SCHEMA_VERSION` stays at 12.**
Measured with `EXPLAIN QUERY PLAN`, both on a synthetic 7 000-row projection
(5 000 documents, 2 000 threads, `ANALYZE`d) and on the real workspace's own
`.corpus/cache.db` below. The plan is **identical with and without the filter**:

```
== no isParent
    SCAN d
    SEARCH t USING COVERING INDEX sqlite_autoindex_threads_1 (id=?) LEFT-JOIN
== isParent=true / isParent=false
    SCAN d
    SEARCH t USING INDEX sqlite_autoindex_threads_1 (id=?) LEFT-JOIN
```

The collection query drives from `documents` (a LEFT JOIN pins the outer table)
and reaches `threads` by its own PRIMARY KEY, one bounded seek per row — that
seek happens on *every* collection query already, filter or not, because the join
is in `FROM_SQL` unconditionally. The only delta the filter makes is that the
seek stops being *covering*: `parent_id` is read off the row instead of answered
from the index key. Timed at 200 iterations over the 7 000-row set: 1.138 ms
(no filter) / 1.177 ms (`true`) / 1.083 ms (`false`) — inside the noise.

An index cannot help, for a structural reason rather than a cost one:
`threads(parent_id)` (which already exists, as `threads_parent_id`) can only
enumerate rows that are *in* `threads`, and `isParent=true`'s answer is dominated
by documents that have no `threads` row at all. Probed it anyway — added
`CREATE INDEX … ON threads (parent_id) WHERE parent_id IS NULL`, re-`ANALYZE`d,
and the planner did not consider it: byte-identical plan, 1.174 ms. The probe
index was discarded. Composition still picks up whatever index the *other* filter
brings (`type=thread&isParent=false` plans as `SEARCH d USING INDEX
documents_type`), which is the same story every filter here tells.

### E2E — real server, real workspace, real HTTP

`corpus init /tmp/s073ws`, port moved to **8791** (8765 and 5173 untouched),
`corpus server start` (pid 93428), `corpus server stop` at the end; port
confirmed free afterwards. Seeded through the real write endpoints: two root
notes (`doc_dyzxtr6s` "Cormorant survey", `doc_jevcxsig` "Cormorant field notes"),
two child threads on the survey, one standalone thread, plus the 10 documents
`corpus init` ships. `corpus db doctor`: *projection is clean — 14 documents from
14 files*; 8 git commits, each with the acting party as author.

| Request | Answer |
| --- | --- |
| `?limit=50` | `total=14` |
| `?isParent=true` | `total=12` — every root, of every type: the standalone thread, both notes, 2 skills, 3 views, 2 templates, 2 more skills |
| `?isParent=false` | `total=2` — `th_nhcioe2w`, `th_xngrvab2` |

12 + 2 = 14: the two answers partition the unfiltered set. **`doc_jevcxsig` — a
note nothing hangs off — is in `isParent=true`**, which is the case the rejected
"has children" reading would have dropped; `doc_dyzxtr6s`, which has two threads,
is a root by the same rule.

Composition, each verified over HTTP:

| Request | Answer |
| --- | --- |
| `?type=thread&isParent=true` | `total=1` → `th_ksne6kfy` |
| `?type=thread&isParent=false` | `total=2` |
| `?type=note&isParent=false` | `total=0` — genuinely empty, not no-opped into the whole set |
| `?q=cormorant` | `total=5` |
| `?q=cormorant&isParent=true` | `total=3` |
| `?q=cormorant&isParent=false` | `total=2` |
| `?q=counted&isParent=false` | `total=1` → `th_nhcioe2w` |
| `?q=cormorant&isParent=true&sort=relevance` | `total=3`, re-ranked |
| `?needs=me` | `total=2` (one child, one root, after agent replies) |
| `?needs=me&isParent=true` | `total=1` → `th_ksne6kfy` |
| `?needs=me&isParent=false` | `total=1` → `th_nhcioe2w` |
| `?folder=/&isParent=false` | `total=2` |
| `?isParent=true` after archiving `doc_jevcxsig` | `total=11` — the archived default runs first |
| `?isParent=true&status=archived` | `total=1` → `doc_jevcxsig` |
| `?isParent=true&includeArchived=true` | `total=12` |

Paging (`total` reflects the filter — the CONTRACT-035 defect):
`?isParent=true&limit=5` reports `total=12` while the unfiltered query reports
`14`; offsets 0/5/10 return 5 + 5 + 2 rows and walking them yields exactly the
12 roots with nothing else leaking in. `?isParent=false&limit=1` reports
`total=2` and offsets 0/1 return the two children.

The contradiction, over the wire:

```
GET /api/docs?parent=doc_dyzxtr6s&isParent=true   -> 400
{"code":"bad_request","message":"request failed validation",
 "issues":[{"path":"query.isParent","message":"`parent=<id>` and `isParent=true` contradict: …"}]}
GET /api/docs?parent=doc_dyzxtr6s&isParent=false  -> 200, total=2 (that parent's children)
GET /api/docs?isParent=maybe                      -> 400
```

Same behaviour CONTRACT-042 declared, and it is *the contract's* refusal — the
handler adds no second check, so there is one rule rather than two that could
drift. The query suite pins that reliance directly (`DocsQuerySchema.safeParse`
must fail on the pair), because the day the refinement is relaxed the unguarded
predicate starts answering a question nobody asked.

### Tests

`VITEST_MAX_THREADS=4 npx vitest run apps/server` → **3532 passed, 0 failed**.

New: a `describe("isParent — what a document is under, never what is under it")`
block in `apps/server/src/docs/query.test.ts` with its own seeded workspace (a
root nothing hangs off, a root with children, two children, an **orphaned** child
whose parent document does not exist, two standalone threads, an archived root, a
`view` root) — 15 cases covering both directions, the partition property,
field/filter agreement, the orphan, composition with `type`/`q`/`sort=relevance`/
`needs=`/archived/`author`, three paging cases, and the contradiction. Plus three
route-level cases in `routes.test.ts` (`isParent` over the wire on both sides,
the two 400s, and the accepted redundant pairing).

Fixture gotcha worth recording: document ids are `^(doc|th)_[A-Za-z0-9]+$` — no
underscore after the prefix. `doc_root_childless` is silently *skipped* by the
projector (`frontmatter carries no valid id`), so the whole workspace comes back
empty rather than failing loudly.

`npx tsc --noEmit -p apps/server/tsconfig.json`, `eslint` and `prettier --check`
on the three touched files: all clean.

### Not done, deliberately

- No `SCHEMA_VERSION` bump (see indexing above).
- `/api/search` does not gain the filter — CONTRACT-042 left it off
  `docFilterShape` pending a SPEC rider, and this change respects that by doing
  nothing.
- No re-check of the contradiction in the handler.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
