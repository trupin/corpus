# [SERVER-011] Collection query endpoint: filters + FTS + needs=me

## Domain
server

## Status
done — verified 2026-08-13 (INFRA-027): the work landed and PLAN.md has said so; this file was never ticked. Evidence: a commit carrying the id, or the named implementation and its tests in the tree.

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
- [x] `GET /api/docs` accepts and composes `q`, `type`, `status`, `tag`, `folder`, `parent`, `references`, `agent`, `author`, `since`, `due`, `stale`, `unread`, `needs`, `sort`, plus pagination (`limit`, `offset`).
- [x] `q` runs FTS5 across document titles, bodies, and turn bodies; matches on a thread's turns attribute to the thread, and each hit carries a highlighted `snippet`. _(Adjudication 1i: structured `snippets[]`, never `<mark>`.)_
- [x] Thread-specific filters (`parent`, `agent`, `unread`, awaiting-reply) **no-op** for non-thread types rather than emptying the result. _(Awaiting-reply is `needs=form`, Adjudication 1e.)_
- [x] Results exclude `status: archived` by default; an explicit `status` including `archived` brings them back. _(Adjudication 1a: `status` is a single enum, so `status=archived`.)_
- [x] `folder` scopes to a directory under `data/docs/` **and** includes threads whose parent document lives in that folder (§11 folder scoping).
- [x] `references=<id>` returns documents whose bodies/turns link to that id (via the `links` table).
- [x] `stale` filters by tier computed from `max(updated, reviewed)` against the 30/90/180-day thresholds; `evergreen: true` documents are never anything but fresh. _(Adjudication 1c: one tier, at-or-beyond.)_
- [ ] Every row carries its staleness tier so the UI can render the ramp without recomputing. — **`DEFERRED → CONTRACT-005`** (Adjudication 2: `DocRow` declares no such field; emitting one would defeat §9.3).
- [x] `needs=me` returns the Attention union — unread agent replies ∪ unanswered forms ∪ due/overdue ∪ stale-for-review ∪ failed jobs — with each row carrying its `reasons` array (a row matching two reasons appears once with both). _(Adjudication 1g/1h: the field is `attention`, the reasons are `form` and `stale`.)_
- [x] `sort` supports the contract's enum — `updated`, `-updated`, `created`, `-created`, `due`, `title`, `relevance` — defaulting to `-updated`, with `documents.id` as the stable tiebreak. _(Adjudication 1d: `last-activity` is not in the contract and is a 400.)_
- [x] `GET /api/tree` returns the `data/docs/` folder tree (path, name, direct and recursive document counts), built from the projection, not the filesystem.
- [x] The whole query executes as a single SQL statement per request (plus one count), with indexes covering the common filters.

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
Not a bug — new endpoints. No pre-fix reproduction applies.

### Post-Implementation Verification

**Implemented on: opus.**

**Environment.** Real `corpus init` workspace (`npm run dev -w apps/cli -- init /tmp/corpus-s011-ZSAa6X/ws --port 8825 --json`), real server process
(`npx tsx apps/server/src/main.ts --workspace <ws>`) on **port 8825** (sprint-004 allocation;
8765 untouched), real `.md` files on disk, real projection, real HTTP. Baseline corpus =
`init`'s 6 seed documents (1 template, 3 views, 2 skills) + 9 hand-written documents (one
`archived`) + 2 threads + a real `.corpus/seen.json`. Server stopped by pid; scratch removed by
variable.

Seeding through `POST /api/docs` / `POST /api/threads` is **`DEFERRED → SERVER-005/006`**
(pre-authorized substitute: real files + real projection). `POST /api/threads/:id/seen` is
**`DEFERRED → SERVER-006`** (substitute: a real `.corpus/seen.json`). There is no watcher in
this worktree (SERVER-007), so out-of-band file edits were re-projected by **restarting the
real server**.

**1. Envelope, defaults, archived** (`curl … | jq`):
```
{"keys":["items","page"],"page":{"total":15,"limit":50→200,"offset":0}, …}
default excludes doc_retired: null        # archived is out by default
?status=archived  → {"total":1,"ids":["doc_retired"]}
?status=open,archived → 400               # contract's `status` is a single enum
```

**2. FTS** — title, body and turn hits, structured snippets, no markup:
```
?q=escrow                     → ["doc_mortgage"]
?q=amortization               → ids ["doc_q1"], field "body", matched ["amortization"]
?q=cherry-picked assumption   → ["th_form"], snippet {field:"turn", threadId:"th_form",
      segments:[{"That is a ",false},{"cherry",true},{"-",false},{"picked",true},
                {" ",false},{"assumption",true},{", so let us decide explicitly.…",false}]}
```
Adversarial: `"unbalanced`, `NEAR(a b)`, `a OR b`, `*`, `""`, `)))`, a 1 KB `q` → **200** every
time (no 500, no FTS syntax error).

**3. Composition, folder scoping, references:**
```
?type=thread&agent=engaged&folder=finance&sort=-updated → ["th_reply"] (total 1)
?folder=finance      → [doc_mortgage, doc_q1, th_reply, th_form, doc_oldrates]  # threads included
?folder=finance/2026 → [doc_q1, th_form]
?folder=finance/     → identical to ?folder=finance
?folder=/            → 13 rows (everything under data/docs/ + their threads)
?folder=nope         → 200 {"items":[],"total":0}   # not a 404
?references=doc_mortgage → ["doc_q1"]
```
Note: `?folder=` (empty) is a **400**, not the root — the contract's `folder` is `.min(1)`,
the same rule that makes `?type=` a 400 (TEST-53). The root is `?folder=/` or
`?folder=data/docs`.

**4. Staleness and Attention** (`doc_oldrates` 100 d old; `doc_handbook` 200 d old but
`evergreen`):
```
?stale=aging → ["doc_oldrates"]   ?stale=stale → ["doc_oldrates"]   ?stale=very-stale → []
doc_handbook appears in no tier, ever.
```
The failed job was produced through the **real queue API**: an event file in
`.corpus/queue/pending/` → `POST /api/queue/claim-all` → `POST /api/queue/evt_s011failed/fail`
(`{"halted":false,…,"failed":1}`, file in `failed/`).
```
?needs=me →
  {"id":"doc_failing","attention":["failed-job"]}
  {"id":"th_reply","attention":["unread-reply","failed-job"]}   # two reasons, ONE row
  {"id":"doc_idea","attention":["due"]}
  {"id":"th_form","attention":["form"]}
  {"id":"doc_oldrates","attention":["stale"]}
per-reason: unread-reply→[th_reply] form→[th_form] due→[doc_idea] stale→[doc_oldrates]
            failed-job→[doc_failing, th_reply]   (union == ?needs=me)
?needs=me&folder=finance → [th_reply, th_form, doc_oldrates]     # intersection, not replacement
```
The same `attention` arrays appear on the **unfiltered** `GET /api/docs`.

**5. Handling each reason clears the row.** Seen mark advanced past the last turn; a `user`
turn appended after the form turn; `due` moved 30 days out; `reviewed` set to now;
`DELETE /api/queue/evt_s011failed` (abandon, the real endpoint — `POST …/abandon` is a 404,
the contract spells it `DELETE /api/queue/{id}`). Server restarted to re-project:
```
?needs=me → {"total":0,"items":[]}
unfiltered attention chips → []
?stale=aging|stale|very-stale → []          # "still current" took it off the ramp
?type=thread&unread=true → ["th_form"]      # the new user turn is newer than its mark
```

**6. Sorting, paging, validation, auth:**
```
?sort=title&limit=2&offset=0 → ["Attention","Comment"]
?sort=title&limit=2&offset=2 → ["Escrow basics","Handbook"]      # disjoint, in order
?sort=last-activity → 400   ?limit=201 → 400   ?limit=200 → 200
400 + issues: stale=ancient→[query.stale] type=→[query.type] agent=maybe→[query.agent]
  needs=everyone→[query.needs] due=next-tuesday→[query.due] since=not-a-date→[query.since]
  unread=perhaps→[query.unread] offset=-1→[query.offset] sort=relevance (no q)→[query.sort]
?colour=blue&type=note → 200, byte-identical ids to ?type=note
GET /api/docs and /api/tree with no Authorization → 401 {"code":"unauthorized",…}, no ids,
  no counts, no folder names in the body
```

**7. `GET /api/tree`:**
```
{"path":"finance","count":3,"totalCount":5,"children":[{"path":"finance/2026","count":2,"totalCount":2}]}
{"path":"inbox","count":2,…} {"path":"legal","count":1,…} {"path":"reference","count":1,…}
{"path":"templates","count":1,…} {"path":"views","count":3,…}
finance totalCount vs ?folder=finance&limit=200 .page.total → 5 vs 5
```
Paths are relative to `data/docs/`; threads are not nodes but count in their parent's folder;
archived rows are excluded from both the tree and the default list, which is what makes the
badge and the list agree.

**8. Generated typed client** (`createCorpusClient` from `@corpus/contract/client`, run with
`tsx` against the live server, and typechecked with a real `tsc --noEmit` — exit 0):
```
GET /api/docs {q:"amortization", folder:"finance", sort:"relevance"} →
  {"page":{"total":1,"limit":50,"offset":0},
   "rows":[{"id":"doc_q1","title":"Q1 numbers","attention":[],
            "snippetFields":["body"],"matched":["amortization"]}]}
GET /api/tree → [{"path":"finance","count":3,"totalCount":5,"children":["finance/2026"]}, …]
GET /api/docs {stale:"ancient"} → 400 {"code":"bad_request","issues":[{"path":"query.stale",…}]}
```

**9. Performance.** Vitest, 2000 generated documents + 200 threads projected for real,
uninstrumented: filtered search (`q` + `type` + `tag` + `folder` + `sort`) **min 8.1 / median
8.4 / max 8.6 ms**; `?needs=me` **median 1.1 ms**. Query plan for the common filters:
`SEARCH d USING INDEX documents_type (type=?)` — no `SCAN documents`. Statement count asserted
by instrumenting `prepare`: exactly **2** executions per request (one SELECT, one COUNT). Over
real HTTP on the seeded workspace: 5.1 ms cold, then 0.8–1.2 ms.

**10. Gate.** `npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck` all
clean; `npm run test:coverage` **2222 tests passing, 120 files**, totals lines 99.25 %,
branches 96.10 %, functions 99.66 % (gate 90 %); `apps/server/src/docs/` alone 99.8 % lines /
97.4 % branches.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified (the two the shipped contract cannot express — a
      `staleness` tier field and thread fields on `DocRow` — are Adjudication 2's
      `DEFERRED → CONTRACT-005`; nothing undeclared is emitted)

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, powers every list surface in the product)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-011]` prefix
