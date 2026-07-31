# Evaluation: CONTRACT-022

**Date**: 2026-07-31
**Sprint**: sprint-019 (Phase 7, Retrieval A)
**Evaluator model**: Opus 5 (1M context)
**Verdict**: PASS

Evaluated **through the wire**, not by reading the contract package: the OpenAPI document served by
a running server on port **8810** (`GET /api/openapi.json`), compared against the committed
`packages/contract/openapi.json`, and every declared behaviour exercised with real requests.

Note for anyone repeating this: `/openapi.json` and `/doc` are swallowed by the SPA fallback and
return HTML. The served document is at **`/api/openapi.json`**.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                            |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | `issues/contract/022-search-related-routes.md:96+` — build/test table, generation hashes, before/after artifact diffs, C5 and C6 corrections      |
| Commands are specific and concrete      | PASS   | Two `shasum -a 256` values, exact `diff` hunk lists with `^<` counts, the runtime `ctor: ZodObject` probe, the full `/api/docs` param order       |
| Real E2E (not mocked)                   | PASS   | This issue ships no runtime behaviour — its E2E surface *is* the build, the generator and the drift check, and the log says so plainly rather than inventing a server drill. The routes' runtime behaviour is proven in SERVER-040/041 |
| Scenarios cover acceptance criteria     | PASS   | TEST-660…671 each addressed; the two that no test can satisfy (661, 666) are handled by written assertion with the finding stated                 |
| Application restarted after changes     | N/A→PASS | No server. `npm run build` + full-workspace `typecheck` is the equivalent gate and both are recorded green                                       |
| Actual model recorded (implemented on:) | PASS   | "**Implemented on: opus** (2026-07-31, sprint-019, phase-7-retrieval-a, main tree)"                                                               |
| Reproduction logged before fix (bugs)   | N/A    | Feature, not a bug                                                                                                                              |

The log's most valuable move is refusing a false claim: TEST-661 required the agent to *state* that
nothing in the repository parses `SPEC.md`, so a green inventory suite must not be read as proof of
§9.2 alignment. The log does exactly that (C6 section) instead of letting the suite stand in for the
argument. It also corrects the sprint's own premise C5 with a runtime probe (`DocsQuerySchema` is a
`ZodObject` under Zod 4, not a `ZodEffects`) while keeping the adjudicated approach.

## Criteria Results

| #   | Criterion                                            | Result | Observed over the wire                                                                                                                                                                    |
| --- | ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 660 | Both routes declared                                 | PASS   | Served document carries `/api/search` and `/api/docs/{id}/related`. Served == committed `openapi.json`, **exactly** (sorted-key JSON comparison)                                          |
| 662 | Exactly the signed 16-param set, and three forbidden  | PASS   | `q, type, status, includeArchived, tag, folder, parent, references, agent, author, since, due, stale, unread, needs, limit` — **in the signed order**, nothing missing, nothing extra. `pinned`/`sort`/`offset` absent. `q` is the only `required` |
| —   | What `sort`/`offset` actually do                     | PASS   | Observed: `GET /api/search?q=rate&sort=relevance&offset=10` → **200, silently stripped** (not rejected). Recorded in the issue file at line 221. The behaviour is stated once and matches  |
| 663 | Filters shared, one definition site                  | PASS   | Behaviourally confirmed by the 18-filter parity table in SERVER-040's eval: every filter behaves identically on both endpoints, and `/api/docs`'s own param list and **order** are unchanged |
| 664 | `/api/docs` behaviourally unchanged                  | PASS   | `sort=relevance` still ranks + snippets; `sort=relevance` without `q` still 400s; `pinned=true` → 200; `offset=2` → 200                                                                    |
| 665 | Search hit shape is frugal by construction           | PASS   | `SearchHit` = `{id, title, headingPath, snippet}`, all four required. **No body, no excerpt, no segments array.** Every live response matched                                              |
| 666 | Semantic-state seam, optional and documented         | PASS   | `SearchResults` = required `hits` + optional `semanticIndex ∈ {current, indexing, stale, disabled}`, documented as "**Retrieval Phase B's seam, inert in Phase A**" with an explicit instruction to treat any non-`current` value as degraded rather than matching exhaustively. Field name `semanticIndex` recorded in the issue file (Recorded Decision 1). A Phase A response omitting it parses; I drove the CLI with all four values plus an undefined one and none required a shape change |
| 667 | Related row frozen with the full relation enum       | PASS   | `RelatedDoc` = `{id, title, excerpt, relation}`, `relation ∈ {linked, similar, both}`. `similar`/`both` are in the vocabulary now; Phase A emitted only `linked` in every observed response |
| 668 | Related reuses the shipped param and error vocabulary | PASS   | Query params `limit` and `includeArchived` **only**, plus the `id` path param. Responses: `200, 400, 401, 404`; the 404 is `NotFoundError`, and SERVER-041 confirmed the body is byte-identical to `GET /api/docs/{id}`'s |
| 669 | Generated artifacts regenerate to a no-op            | PASS   | `node --import tsx scripts/check-generated-artifacts.ts` → `✓ API contract is up to date` and `✓ CLI reference is up to date`, exit 0, on the committed tree                                |
| 670 | Registration placement is deliberate                 | PASS   | Over HTTP: `GET /api/docs/<id>/related` reaches the related handler; `GET /api/docs/<id>` still reaches the document read. Neither swallows the other                                      |
| 671 | The `limit` cap is a decision with a reason          | PASS   | Both routes: `integer, minimum 1, maximum 50, default 10`. Enforced live (51 → 400, 0 → 400, default proved as 10 against 14 candidates). The reason is written **into the schema description**: "Lower than the list endpoints' cap on purpose: retrieval is read by an agent that pays for every line… There is no `offset` — a ranked result set is a top-k, not a page." Recorded Decision 2 names the constants |

## Failures

None.

## Note

`docs/cli.md`'s `corpus doc related --json` example shows `{"related":[…],"semanticIndex":"current"}`
while the Phase A server omits the field entirely. This is consistent with the contract (the field is
optional, absent-or-`current`) and the example is illustrative of what a caller may see once Phase B
lands. Not a defect; recorded so nobody re-litigates it.

## Summary

12 of 12 criteria passed. The shape freeze is real and I checked it from the outside: the enum
already carries the two values Phase A never emits, the semantic-state field already exists on both
envelopes with instructions not to match it exhaustively, and the hit schema has no field a body
could ever arrive in. Phase B can add values without touching a shape.
