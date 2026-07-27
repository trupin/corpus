# [SERVER-011] Collection query endpoint: filters + FTS + needs=me

## Domain
server

## Status
todo

## Priority
P0

## Model
opus — a single endpoint with an enumerated filter surface; the semantics are spelled out in §9.2 and §11.

## Dependencies
- Depends on: SERVER-004
- Blocks: UI-003

## Spec References
- SPEC.md §9.2 — `GET /api/docs` (the single collection query endpoint), `GET /api/tree`
- SPEC.md §11 — "Attention" (`needs=me` union with reason chips), "Search overlay" (FTS + filter chips, archived excluded by default), "Folder scoping"
- SPEC.md §5 — staleness (`max(updated, reviewed)` against 30/90/180-day thresholds, `evergreen` exemption)
- SPEC.md §9.1 — projection tables backing every filter

## Summary
Build `GET /api/docs` — the one collection endpoint behind every list in the product: board columns, the search overlay, autocompletes, and the Attention view all issue the same query with different parameters. Structured filters compose with optional full-text search over titles, bodies, and turns (returning snippet highlights), thread-specific filters no-op for non-thread types, archived documents are excluded unless asked for, and `needs=me` returns the Attention union with per-row reasons. Ship `GET /api/tree` alongside it: the `data/docs/` folder tree with names and counts for folder pickers and filter chips.

## Acceptance Criteria
- [ ] `GET /api/docs` accepts and composes `q`, `type`, `status`, `tag`, `folder`, `parent`, `references`, `agent`, `author`, `since`, `due`, `stale`, `unread`, `needs`, `sort`, plus pagination (`limit`, `offset`).
- [ ] `q` runs FTS5 across document titles, bodies, and turn bodies; matches on a thread's turns attribute to the thread, and each hit carries a highlighted `snippet`.
- [ ] Thread-specific filters (`parent`, `agent`, `unread`, awaiting-reply) **no-op** for non-thread types rather than emptying the result.
- [ ] Results exclude `status: archived` by default; an explicit `status` including `archived` brings them back.
- [ ] `folder` scopes to a directory under `data/docs/` **and** includes threads whose parent document lives in that folder (§11 folder scoping).
- [ ] `references=<id>` returns documents whose bodies/turns link to that id (via the `links` table).
- [ ] `stale` filters by tier computed from `max(updated, reviewed)` against the 30/90/180-day thresholds; `evergreen: true` documents are never anything but fresh.
- [ ] Every row carries its staleness tier so the UI can render the ramp without recomputing.
- [ ] `needs=me` returns the Attention union — unread agent replies ∪ unanswered forms ∪ due/overdue ∪ stale-for-review ∪ failed jobs — with each row carrying its `reasons` array (a row matching two reasons appears once with both).
- [ ] `sort` supports `last-activity` (default), `created`, `updated`, `due`, `title`, with a stable tiebreak.
- [ ] `GET /api/tree` returns the `data/docs/` folder tree (path, name, direct and recursive document counts), built from the projection, not the filesystem.
- [ ] The whole query executes as a single SQL statement per request (plus one count), with indexes covering the common filters.

## Sprint-004 Adjudications (binding, 2026-07-27)

Orchestrator decision on the sprint-004 Open Conflicts affecting this issue — full reasoning in `issues/sprints/sprint-004.md`:

1. **The contract wins on all eleven prose mismatches** (status/tag/stale/sort/awaiting/since/reason names; `attention` not `reasons`; structured `snippets` not `<mark>` strings; the declared envelope; limit over-max is a 400 from the validation hook, not a clamp). Implement `DocsQuerySchema`/`DocRowSchema` exactly as shipped.
2. **Two ACs are unsatisfiable inside the shipped contract** (staleness tier and thread fields are absent from `DocRow`): implement the contract exactly; the fields arrive via CONTRACT-005 (filed, sequenced before UI-003) — do not invent extra response fields.
3. **Seeding**: no write endpoints exist in this batch — seed with real files + real watcher/restart projection, real `seen.json`, and failed jobs produced over the real queue API.

## Technical Design

### Files to Create/Modify
- `apps/server/src/docs/query.ts` — parameter → SQL builder (filters, FTS join, sorting, pagination)
- `apps/server/src/docs/needs.ts` — the `needs=me` union with reason attribution
- `apps/server/src/docs/staleness.ts` — tier computation + thresholds (shared with row serialization)
- `apps/server/src/docs/tree.ts` — folder tree from `documents.path`
- `apps/server/src/docs/routes.ts` — handlers bound to the CONTRACT-002 route definitions
- `apps/server/src/docs/*.test.ts` — colocated Vitest specs
- `apps/server/src/db/schema.sql` — add the indexes the query plan needs

### Key Implementation Details

- **ValidationError requires `issues`** _(evaluator, sprint-002, 2026-07-26)_: `ApiErrorSchema`'s `bad_request` variant makes `issues` required — every server-generated 400 (not just zod-hook ones) must carry a non-absent `issues` array or the body fails its own contract parse.


**Shape.** One `SELECT` over `documents` LEFT JOINed to `threads`, `seen`, and (when `q` is present) the `search` FTS table, with `EXISTS` subqueries for tag, link, and form conditions. Parameters bind positionally — never interpolate user input. Response rows: core document fields, `staleness` tier, thread fields when `type = thread` (`parent`, `agent`, `anchor` quote, `turnCount`, `lastAuthor`, `lastTs`, `unread`), optional `snippet`, optional `reasons`. Envelope: `{items, total, limit, offset}`.

**Filter semantics** (each is a no-op when the parameter is absent):
- `q` — `search MATCH ?` joined by rowid. Sanitize the user's text into a safe FTS expression: strip FTS operators, quote each token, and join with `AND`; append `*` to the final token for prefix matching (autocomplete). Highlights via `snippet(search, -1, '<mark>', '</mark>', '…', 12)`. When `q` is present without an explicit `sort`, order by FTS rank.
- `type` — repeatable/CSV, `IN (…)`.
- `status` — repeatable/CSV; when absent, `status != 'archived'`.
- `tag` — repeatable; multiple tags are **ANDed**; matched against the normalized (lowercased) tag rows.
- `folder` — normalized path under `data/docs/` (trailing slash tolerated): `documents.path LIKE '<folder>/%'` OR the row is a thread whose `parent_id` resolves to a document with that path prefix.
- `parent` — `threads.parent_id = ?`, applied only to thread rows.
- `references` — `EXISTS (SELECT 1 FROM links WHERE from_id = documents.id AND to_id = ?)`.
- `agent` — `threads.agent IN (…)` (`none` | `requested` | `engaged`), thread rows only.
- `author` — `threads.last_author = ?`, thread rows only (git authorship is not projected; document rows are unaffected).
- `since` — `max(updated, reviewed) >= ?` (ISO date or duration shorthand like `7d`).
- `due` — `overdue` | `today` | `week` | an ISO date: `due IS NOT NULL AND due <= <bound>`.
- `stale` — `fresh` | `aging` | `stale` | `very-stale` (repeatable), computed as below.
- `unread` — `true`: thread rows where `threads.last_ts > COALESCE(seen.last_seen_ts, '')`.
- `awaiting` — `form`: thread rows whose **last** turn is an `agent` turn containing a fenced ` ```form ` block and which has no later `user` turn.
- `needs` — `me`: see below (composes with the other filters, which further narrow the union).

**Staleness.** `age = now - max(updated, reviewed)`; tiers `fresh < 30d ≤ aging < 90d ≤ stale < 180d ≤ very-stale`. Thresholds live in one exported constant so the UI ramp and the filter agree. `evergreen: true` forces `fresh` and excludes the row from every non-fresh tier and from the stale-for-review Attention reason.

**`needs=me`.** Five reason subqueries UNIONed, each selecting `(id, reason)`:
1. `unread-reply` — thread rows with `last_author = 'agent'` and `last_ts > COALESCE(seen.last_seen_ts, '')`.
2. `unanswered-form` — the `awaiting=form` condition above.
3. `due` — `due IS NOT NULL AND due <= now` (overdue or due today).
4. `stale-review` — tier ≥ `stale` and not `evergreen`.
5. `failed-job` — documents/threads referenced by an `events` row with `status = 'failed'` (resolve `payload_json`'s `threadId`/`parentId` through the projection at query time; if that proves awkward in SQL, project an `events.subject_id` column in `queue/project.ts` and join on it).
Group by id, aggregating reasons into an array. The default sort for `needs=me` is `last-activity`.

**`GET /api/tree`.** Derive folder nodes from `documents.path` for rows under `data/docs/`, returning `{path, name, count, totalCount, children}` where `count` is documents directly in that folder and `totalCount` includes descendants. Threads (flat in `data/threads/`) are not tree nodes but do count toward the folder of their parent, matching the `folder` filter's scoping so a folder column's count agrees with its list length.

**Performance.** Add indexes on `documents(status)`, `documents(type)`, `documents(updated)`, `documents(due)`, `documents(path)`, `threads(parent_id)`, `threads(last_ts)`, `links(to_id)`, `seen(thread_id)`. Default `limit` 50, max 200. Pagination sorts always carry `documents.id` as the final tiebreak so paging is stable across ties.

**Validation.** Parameters are parsed by the CONTRACT-002 Zod query schema; an unknown filter value (e.g. `stale=ancient`) is a 400 from validation, not a silent no-op. If the contract's query schema is missing a parameter this issue needs, escalate to the orchestrator for a CONTRACT change rather than accepting untyped extras.

### Edge Cases
- `q` containing FTS syntax (`"`, `*`, `NEAR`, `OR`, unbalanced quotes) → sanitized into a literal token search, never a 500.
- `q` matching a turn of a thread whose parent also matches → both rows returned, each with its own snippet, no duplicate thread row.
- `folder` that does not exist → empty list with `total: 0`, not a 404.
- `folder=""` or `/` → the whole `data/docs/` root.
- Thread whose parent document was deleted → the thread still lists (orphaned record per §9.2) and is excluded from folder-scoped results.
- `unread` for a thread with no `seen` row → unread (never seen).
- `status=archived` explicitly requested → archived rows included; combined with `needs=me` they still surface only if they match a reason.
- Tag matching is case-insensitive; `tag=Finance` and `tag=finance` behave identically.
- `due=week` crossing a month/year boundary → computed from an ISO date, not string arithmetic.
- `limit` above the cap → clamped, not rejected; negative `offset` → 400.
- Empty corpus → `{items: [], total: 0}` for both endpoints.

## Testing Strategy
Vitest in `apps/server` against a temp workspace fixture seeded with a deliberately varied corpus (documents across folders, tags, statuses, due dates, `reviewed`/`evergreen` combinations; threads anchored/whole-doc/standalone with mixed `agent` values, seen marks, a form turn; links between documents; a failed queue event), driving the real Hono app via `app.request()`:
- One spec per filter asserting exact id sets, including the no-op behavior of thread-only filters on non-thread types.
- Archived default exclusion and explicit inclusion.
- FTS: title hit, body hit, turn hit (attributed to the thread), snippet contains `<mark>`, adversarial query strings do not throw.
- Folder scoping: a folder column's result includes threads on documents in that folder; a nested folder excludes siblings.
- Staleness: fixed clock, boundary dates at exactly 30/90/180 days, `reviewed` newer than `updated` resets the tier, `evergreen` stays fresh.
- `needs=me`: one seeded row per reason, plus one row matching two reasons → appears once with both; handling a reason (marking seen, answering the form, setting `reviewed`, retrying the job) removes the row on the next query.
- Sorting: each `sort` value plus stable pagination across a tie (page 1 + page 2 have no overlap and no gaps).
- `GET /api/tree`: counts match a manual tally, including recursive `totalCount`.

## E2E Verification Plan

### Verification Steps
1. Start the real server against a scratch workspace seeded with a varied corpus (create documents and threads through the real write endpoints so the projection is genuine); export the bearer token.
2. Baseline: `curl "localhost:8765/api/docs" -H "Authorization: Bearer $TOKEN" | jq '.total, [.items[].id]'` → everything except archived.
3. Archived: archive a document, re-run → it disappears; `?status=open,archived` → it returns.
4. FTS: `?q=<a phrase that exists only inside a thread turn>` → the thread row comes back with a `<mark>`-highlighted snippet; `?q="unbalanced` → 200, not 500.
5. Composition: `?type=thread&agent=engaged&folder=finance&sort=last-activity` → only engaged threads whose parent lives under `data/docs/finance/`.
6. Folder scoping: create a document in `data/docs/finance/` and comment on it → `?folder=finance` lists both the document and its thread.
7. References: `?references=<docId>` → the documents whose bodies contain `[[<docId>]]`.
8. Staleness: backdate a document's `updated` past 90 days → `?stale=stale` includes it; `POST` a `reviewed: <now>` update → it drops out; set `evergreen: true` on another old document → it never appears in any stale tier.
9. Attention: produce one row per reason (an agent reply left unread, a thread with an unanswered form, an overdue `due`, a stale document, a failed queue event), then `?needs=me | jq '.items[] | {id, reasons}'` → five rows with correct reasons. Mark the thread seen and re-run → that row is gone.
10. Sorting and paging: `?sort=title&limit=2&offset=0` then `offset=2` → disjoint, correctly ordered pages.
11. `curl "localhost:8765/api/tree" -H "Authorization: Bearer $TOKEN" | jq` → folder names and counts match `find data/docs -name '*.md' | ...`.
12. Validation: `?stale=ancient` → 400 with a clear message.

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work. Must be from real E2E
testing — no mocks, no test clients. Real application, real requests, real
interfaces. Include specific commands run, actual outputs observed, and pass/fail
conclusions. State which model the implementing agent ran on ("implemented on:
opus | fable")._

### Reproduction (bugs only)
_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification
_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, powers every list surface in the product)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-011]` prefix
