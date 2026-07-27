# Evaluation: SERVER-011 — Collection query endpoint: filters + FTS + `needs=me` + tree

**Date**: 2026-07-27
**Sprint**: sprint-004
**Verdict**: **PASS** (32 of 32 criteria)

Method: a real server process on **port 8841** over a real `corpus init` workspace, queried over real
HTTP with `/usr/bin/curl`, cross-checked with the `sqlite3` CLI against the real projection, and
exercised at least once through the **generated typed client** (`createCorpusClient` from
`@corpus/contract/client`) with a real `tsc --noEmit`. A separate 2000-document workspace for TEST-56
and a separate emptied workspace for TEST-27. The authority for every parameter name, value domain
and response field was `packages/contract/openapi.json` (`DocsQuery`, `DocRow`) — **not** the issue's
prose, per Adjudication 1. Server stopped by pid; 8841 confirmed free; 8765 and 5173 untouched.

Baseline corpus stated: `corpus init` seeds **6 documents** (1 template, 3 views, 2 skills, all
`evergreen: true`); 52 hand-written files were added on top, growing to 65 with probes — all landed,
with **zero** `skipped`/`malformed` lines in the server log.

Independent corroboration from the sprint-004 integration workspace (port 8843, see TEST-77 below):
`?q=6.4` returned the edited document with a structured `snippets` entry and no HTML; `?folder=finance`
returned **both** the document and its thread; `?needs=me` surfaced `failed-job` and `unread-reply` and
cleared on abandon. Those four hops were verified twice, on two workspaces, by two harnesses.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                          |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | Ten sections with real `curl`/`jq` output.                                                                                       |
| Commands are specific and concrete      | PASS   | Real ids, real totals, real 400 bodies with `issues` paths, real snippet segment arrays, real query plans.                        |
| Real E2E (not mocked)                   | PASS   | Real process on the assigned port, real `.md` files, real projection, real HTTP, plus a real typed-client run. `app.request()` is confined to the unit suite. |
| Scenarios cover acceptance criteria     | PASS   | Every AC evidenced; the two unsatisfiable-in-contract ACs are `DEFERRED → CONTRACT-005` rather than met with undeclared fields.  |
| Application restarted after changes     | PASS   | Restart used deliberately for re-projection (no watcher in that worktree) and said so.                                           |
| Actual model recorded (implemented on:) | PASS   | "Implemented on: opus".                                                                                                          |
| Reproduction logged before fix (bugs)   | N/A    | New endpoints, not a bug.                                                                                                        |

The three pre-authorized deferrals (`POST /api/docs`/`/api/threads` seeding, `POST /api/threads/:id/seen`)
are each recorded with their substitute evidence. Nothing silently omitted.

## Criteria Results

| #   | Criterion                                       | Result | Notes                                                                                                                                                            |
| --- | ----------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25  | Envelope is `{items, page}` exactly             | PASS   | `keys` → `["items","page"]`; `page` → `{"total":57,"limit":50,"offset":0}` (57 = 58 − 1 archived). Not the flat envelope.                                          |
| 26  | A row is exactly `DocRow`                       | PASS   | Key sets compared programmatically against `DocRow.required` over 57 unfiltered + 7 thread + 3 FTS + 10 `needs=me` rows: **0 mismatches**. No `staleness`, no thread sub-fields. `attention` present on **every** row with no `needs=`; `snippets` present and empty (0/57 non-empty) with no `q`. |
| 27  | Empty corpus answers honestly                   | PASS   | `{"items":[],"page":{"total":0,"limit":50,"offset":0}}` **200** and `{"folders":[]}` **200**. Neither 404 nor 500.                                                  |
| 28  | `type` is CSV and ORs                           | PASS   | `?type=note,view` → 47 rows, types `note`/`view` only.                                                                                                             |
| 29  | Archived excluded by default, returned on request | PASS | Default → 0 archived; `?status=archived` → **only** `doc_archivedone`; `?status=open` → 0; `?status=open,archived` → **400** naming `query.status`.                 |
| 30  | `tag` is CSV, **ORs**, case-insensitive         | PASS   | `tag=finance,urgent` → the **union** of 4, not the intersection. `tag=Finance` ≡ `tag=finance`; a stored `Finance` tag matched a lowercase query.                   |
| 31  | `folder` prefix + descendants + threads         | PASS   | `finance` → 4 docs **plus** `th_unreadone` (the thread parented into it); `finance/2026` → only its 3, sibling excluded; `finance/` identical to `finance`; `nosuchfolder` → empty **200**, not 404. Bonus: `folder=fin` → 0, so matching is segment-aware, not raw string prefix. |
| 32  | Thread-only filters no-op for non-threads       | PASS   | Baseline 50 non-thread rows. `parent=`, `agent=`, `author=`, `unread=` each on its own: **all four returned a byte-identical non-thread id set** to the unfiltered baseline, with only the thread rows narrowed. Neither threads-only nor empty. |
| 33  | `parent` and `agent` narrow threads             | PASS   | `type=thread&parent=doc_nda01` → exactly the two parented threads; `agent=engaged` → exactly the engaged one.                                                       |
| 34  | `references` reads the `links` table            | PASS   | `?references=doc_blink` → `doc_alink`. Appending `[[doc_blink]]` to a third document on disk added a `links` row and made it appear **within 3 s, no restart**.     |
| 35  | `unread` is thread-relative; never-seen is unread | PASS | T1 (seen newer than last turn) **excluded**; T2 (seen older) included; T3 (no `seen` row at all) included. `unread=false` is the exact complement. Seeded via a real `.corpus/seen.json` — `DEFERRED → SERVER-006` for the endpoint. |
| 36  | `since` filters on `updated`, strictly after    | PASS   | The document whose `updated` **equals** the boundary is **excluded**; the two after it are returned.                                                                |
| 37  | `due` accepts a date and the three keywords     | PASS   | `overdue` → yesterday only; `today` → yesterday + today; `week` → those plus the 4-day one; the 40-day one never in `week`; `due: null` never in any. Boundary probed at today+7 (in) / today+8 (out), and `?due=week` was **identical to the explicit ISO date across the month boundary**. |
| 38  | `q` matches titles, bodies and turn bodies      | PASS   | `q=escrow` → the title hit only; `q=amortization` → the body hit only; `q=cherry-picked assumption` → **the thread row**, one row — not the parent document, not one row per turn. |
| 39  | Snippets are structured segments, match flagged | PASS   | `{"field":"body","segments":[{"text":"\nThe ",match:false},{"text":"amortization",match:true},{"text":" table is attached below.\n",match:false}]}`. `field` tracks the hit site; a `turn` snippet carries `threadId`, title/body snippets do not; concatenation is a readable excerpt. **Grep for `<mark`/`<b>`/`<em`/`&lt;` across all snippet text on 4 queries → 0.** No HTML anywhere. |
| 40  | Adversarial queries sanitized, never 500        | PASS   | `"unbalanced`, `NEAR(a b)`, `a OR b`, `*`, `""`, `)))`, a 1 KB `q`, `foo AND (bar`, `^ * : - "` → **all 200** with a well-formed envelope. Zero `fts5: syntax`/`malformed MATCH`/`SQLITE_ERROR`/500 in the server log. |
| 41  | `sort=relevance` requires `q`                   | PASS   | No `q` → **400**, `{"path":"query.sort","message":"`sort=relevance` is only meaningful with a `q` query."}`. With `q`, on a corpus built so `updated` order is deliberately inverted against relevance: `-updated` → zlow,zmid,zbest but `relevance` → **zbest,zmid,zlow** — the known-best row is `items[0]`. |
| 42  | Tiers at-or-beyond from `max(updated, reviewed)` | PASS  | `aging` → 45/100/200; `stale` → 100/200; `very-stale` → 200. The recently-`reviewed` 200-day document and the `evergreen` 200-day document appear in **none**, at any tier. Thresholds pinned by probe: 31 d in / 29 d out of `aging`; 91 d in / 89 d out of `stale`; 181 d in / 179 d out of `very-stale` ⇒ **exactly 30/90/180, at-or-beyond**. |
| 43  | Stale Attention reason agrees with the filter   | PASS   | The set of rows carrying `"stale"` in `attention` on an unfiltered GET is **byte-identical** to `?stale=stale` (8 ids). No `evergreen` row ever carries it; `aging`-tier rows correctly do not. Same constant behind both. |
| 44  | `needs=me` is the five-reason union, one row per doc | PASS | 15 rows, **15 unique ids**, all five reasons present. The contrived two-reason document appears **once** with `["due","stale"]` — not twice. `"me"` never appears as a value inside `attention`. The failed job was produced for real: `evt_*.json` → `POST /api/queue/claim-all` → `POST /api/queue/{id}/fail`. |
| 45  | Each reason individually filterable             | PASS   | Five per-reason result sets, and their **union equals `?needs=me` exactly** (15 == 15, byte-identical after sorting).                                              |
| 46  | Handling the reason clears the row              | PASS   | All five handled → 15 → **9** rows, and in each case the reason also vanished from that document's `attention` on an unfiltered GET: seen mark advanced; a `user` turn appended after the form turn; `due` moved out; `reviewed: now` (which also dropped it from `?stale=stale`); the failed event moved out of `failed/`. |
| 47  | `needs` composes by intersection                | PASS   | `?needs=me&folder=finance` → a strict subset of the 15 (the overdue document and the unread-reply thread inside that folder) — narrowed, not replaced. `?needs=me&status=archived` → `[]`, the archived row matching no reason. |
| 48  | Every declared sort works; default is `-updated` | PASS  | All six enum values ordered correctly and in the direction their name says. The no-`sort` response was **byte-identical** to `?sort=-updated` over the whole corpus. `?sort=last-activity` → **400** naming `query.sort`. |
| 49  | Pagination stable across ties                   | PASS   | 10 documents, 4 sharing an identical `updated`. `limit=5&offset=0` and `&offset=5` **disjoint**, union = all 10, no gaps, no duplicates, and **both pages byte-identical on re-run** — a stable tiebreak is in the ORDER BY. |
| 50  | `limit` above the cap is a 400, not a clamp     | PASS   | `201` → **400** naming `query.limit`; `200` → 200; `0` → 400; `offset=-1` → 400. No clamping. `limit=abc`, `limit=1.5`, `offset=abc` also 400. |
| 51  | `GET /api/tree` with both counts                | PASS   | `{"folders":[…]}`, every node exactly `{path,name,count,totalCount,children}`. `finance` `count:1 totalCount:4`, `finance/2026` `count:3 totalCount:3`; `path` is `finance/2026` — relative, not absolute, not `data/docs/finance/2026`; `name` is `2026`. |
| 52  | Tree counts agree with the list they scope      | PASS   | **Every one of 15 nodes**: `totalCount` == `?folder=<path>&limit=200` `.page.total`, including `finance` 5 == 5 with the thread present. Projection-derived, proved two ways: an archived document on disk produces **no** `misc` node; and `rm`-ing a file left the tree reporting the projected count for >1.2 s before the watcher settled it. |
| 53  | Unknown filter **values** are 400s with `issues` | PASS  | All seven named cases → **400** with `code:"bad_request"` and a present, non-empty `issues` array naming the parameter (`query.stale`, `query.type`, `query.agent`, `query.needs`, `query.due`, `query.since`, `query.unread`), plus seven more. No silent 200-with-empty-set anywhere. |
| 54  | An unknown filter **name** is ignored           | PASS   | `?colour=blue&type=note` → **200**, result set identical to `?type=note` alone. Same for `foo=1`, `limit_=5`, `NEEDS=me`. |
| 55  | Both endpoints behind the bearer guard          | PASS   | `/api/docs`, `/api/tree`, and a filtered `/api/docs` with no header → **401** `{"code":"unauthorized",…}`; bad token → 401. Bodies leak no row count and no folder name. |
| 56  | One statement per request, fast enough to type against | PASS | 2000 documents generated and projected. Composite query `?q=…&type=note&tag=finance&folder=finance&sort=-updated&limit=50` → **min 9.7 / median 10.1 / max 10.3 ms** (target <100 ms). `?needs=me` → **min 1.6 / median 1.7 / max 1.8 ms** (target <250 ms). `EXPLAIN QUERY PLAN` shows index use, not a full scan: FTS-driven `SCAN s VIRTUAL TABLE INDEX 0:M5` + `SEARCH d USING INTEGER PRIMARY KEY`; `type` → `documents_type`; `due` → `documents_due`; default sort → ordered scan of `documents_updated` with early `LIMIT` termination. Correctness at scale independently cross-checked against a generator's ground truth on four filters (716/1008/217/107 — all exact). |

**Typed client.** `createCorpusClient` against the live server: 200, `total: 4`, `attention: ["due"]`;
`DocListSchema.parse` and `DocRowSchema.parse` both succeeded; `tsc --noEmit` **exit 0**. Negative
control confirms the types really bind — substituting `sort:"last-activity"` yields
`TS2322: Type '"last-activity"' is not assignable to type '"updated" | "-updated" | … | "relevance"'`.

## Sanctioned deviations — verified

- **`?folder=` (empty) is a 400**, not the root, because the contract's `folder` is `.min(1)` — the same
  rule that makes `?type=` a 400. The root is `?folder=/` or `?folder=data/docs`, both of which return
  everything under `data/docs/`. Correct per the contract.
- **`DocRow` carries no `staleness` tier and no thread sub-fields.** Confirmed absent — emitting them
  would have failed TEST-26. `DEFERRED → CONTRACT-005` is the right disposition.
- **Undated documents** serialize with an epoch sentinel and are treated as fresh; they never appear in
  a stale tier.

## Observations for the orchestrator (none are SERVER-011 defects)

1. **TEST-53's wording says `error: "bad_request"`; the server emits `code: "bad_request"`.** The
   contract's `ValidationError` requires `code`, `message`, `issues` and declares no `error` field.
   The server matches its contract — the sprint's wording is what is wrong. Worth correcting so the
   next evaluator does not chase it.
2. **TEST-51 and TEST-52 contradict each other.** TEST-51 demands `finance count:1 totalCount:4`;
   TEST-52 demands `totalCount` equal `?folder=finance`'s total *with a thread parented there*. With
   the thread present the server reports `count:2 totalCount:5` and the list also returns 5 —
   self-consistent; remove the thread and it is exactly `count:1 totalCount:4`. Both readings were
   verified. The server picked the one that satisfies TEST-52 and matches "threads are documents too".
3. **The `due` Attention reason is broader than the `due=overdue` keyword.** A document due *today*
   carries the `due` reason but is not returned by `?due=overdue`. SPEC §11 says Attention covers
   "due/overdue", so this is by design — but the two thresholds differ and that is worth knowing
   before UI-003 renders both.
4. **Due keywords resolve in UTC, not local time.** Defensible ("the workspace's clock"), but a user in
   PDT sees `due=today` flip at 17:00 local.
5. **`.corpus/seen.json` is not live-watched.** Editing it out of band did not re-project after 9 s; a
   restart was required. Every other out-of-band write — document frontmatter, thread turns, links,
   queue status directories — re-projected in ~3 s. Outside SERVER-011's scope (the shipped write path
   is `POST /api/threads/:id/seen`, SERVER-006), but it means the seen mark has no catch-all today.
   **Recommend folding this into SERVER-006 or a watcher follow-up so it is not lost.**
6. **Statement-count could not be verified through a public interface.** No endpoint or artifact exposes
   per-request SQL counts, and confirming it would require reading source. Wall-clock and query plan are
   reported instead; the AC's "single SELECT plus one COUNT" is taken on the unit suite's evidence.
7. **Tags are stored as `tags_json` with no index**, and the `path LIKE 'data/docs/finance/%'` form does
   not use the `path` unique index. Immaterial at 2000 documents (~1 ms), a note for a much larger corpus.

## Summary

**32 of 32 criteria pass.** The endpoint serves exactly the shape its contract declares — envelope,
`DocRow` key set, `attention` on every row, structured `snippets` with no HTML — and every one of the
eleven prose mismatches was resolved the contract's way, verified by observation rather than by
assertion. The filter surface composes correctly, thread-only filters genuinely no-op instead of
emptying results, staleness thresholds are pinned at 30/90/180 at-or-beyond with `evergreen` exempt at
every tier, the five-reason Attention union is one-row-per-document and clears when each reason is
handled, pagination is stable across ties, and validation is a 400 with populated `issues` in all
fourteen cases probed. At 2000 documents the composite query runs in ~10 ms against a 100 ms budget and
`needs=me` in ~1.7 ms against 250 ms, on index-backed plans. The observations above are sprint-wording
issues and downstream notes, not defects in this issue.
