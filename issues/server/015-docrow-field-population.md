# [SERVER-015] Populate CONTRACT-005's new DocRow fields in the collection query

## Domain

server

## Status

in_progress

## Priority

P1

## Model

opus — mapping already-projected data into newly declared response fields; the shapes are pinned by CONTRACT-005 and the projection schema.

## Dependencies

- Depends on: CONTRACT-005, SERVER-011
- Blocks: — (merges together with CONTRACT-005; UI-003/004 consume the result)

## Spec References

- SPEC.md §11 — staleness ramp, thread-row affordances
- `issues/contract/005-board-contract-growth.md` — the field shapes (authoritative)
- `issues/sprints/sprint-005.md` — Open Conflict 2 (why this issue exists: CONTRACT-005's DocRow growth reds merged SERVER-011)

## Summary

CONTRACT-005 adds staleness-tier and thread fields (agent participation, unread/awaiting) to `DocRowSchema`. SERVER-011 is done and merged, so the new fields red `apps/server`'s typecheck until its row-builder populates them. This issue does exactly that — from data the projection already holds (staleness cutoffs exist in `docs/staleness.ts`; thread agent-state and seen joins exist in `docs/needs.ts`) — and merges together with CONTRACT-005 as one gate.

## Acceptance Criteria

- [x] Every new DocRow field is populated from existing projection data; non-thread rows carry the contract's absent/null shape exactly.
- [x] Staleness tier agrees with the `stale` filter and the `stale` attention reason (one shared cutoff source — no second constant).
- [x] Thread fields agree with the `agent`/`unread` filters (same joins, no drift).
- [x] The undated-document sentinel behavior follows whatever CONTRACT-005's nullable-timestamps decision lands as.
- [x] Repo-wide typecheck green against the regenerated client; SERVER-011's eval-verified behaviors unchanged (its filter/FTS/needs suites stay green untouched).
- [x] E2E: one real-workspace query showing a stale doc's tier, a fresh doc, and a thread row's fields — through the typed client.

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/query.ts` (row building), possibly `staleness.ts`/`needs.ts` exports
- Colocated tests

## Testing Strategy

Row-shape tests per doc type; agreement tests (tier ↔ filter, thread fields ↔ filters); the E2E query.

## E2E Verification Plan

### Verification Steps

1. Real workspace with stale/fresh/thread docs; query through the typed client; fields match the projection's ground truth via sqlite3.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_N/A — coupled growth._

### Post-Implementation Verification

**implemented on: opus.** Main tree, alongside the uncommitted CONTRACT-005 harvest. Real workspace
at `/tmp/corpus-s015-e2e` (created by `corpus init`), probe under `/tmp/corpus-s015-probe`, real
server on 127.0.0.1:8765, stopped and the port freed afterwards.

#### 1. Field mapping — every field from a shipped projection column

| DocRow field    | SQL in `docs/query.ts`                                    | Null when                                   |
| --------------- | --------------------------------------------------------- | ------------------------------------------- |
| `stale`         | `STALE_TIER_SQL` (`docs/staleness.ts`)                    | fresh, evergreen, or age unknown            |
| `parent`        | `t.parent_id`                                             | non-thread, or standalone thread            |
| `agent`         | `t.agent`                                                 | non-thread (`threads.agent` is `NOT NULL`)  |
| `anchorQuote`   | `an.exact_text` via `anchors ON (t.parent_id, t.anchor_id)` | non-thread, whole-document, standalone, or the parent no longer carries the entry |
| `turnCount`     | `t.turn_count`                                            | non-thread                                  |
| `lastAuthor`    | `t.last_author`                                           | non-thread, or a thread with no turns       |
| `lastTurn`      | `lt.body_md` via `turns ON (t.id, t.last_ts)`, excerpted by `bodyExcerpt` | non-thread, or a thread with no turns |
| `unread`        | `threadOnly(UNREAD_SQL)` (`docs/needs.ts`)                | non-thread                                  |
| `awaitingAgent` | `threadOnly(AWAITING_AGENT_SQL)` (`docs/needs.ts`)        | non-thread                                  |

Both new joins key on their table's **full primary key** (`anchors(doc_id, anchor_id)`,
`turns(thread_id, ts)`), so neither can multiply a row; they live in `ROW_FROM_SQL`, which only the
page statement uses — the COUNT keeps `FROM_SQL` and does no work the total does not depend on.
`page.total === items.length` is asserted over the fixture that exercises both joins, and
`routes.test.ts`'s "runs one SELECT and one COUNT per request" is unchanged and green.

`lastTurn` reuses the projection's own `bodyExcerpt` (now exported) rather than a second slicing
rule, so a row's document preview and its turn preview trim and truncate alike.

#### 2. Sentinel removal (the half the compiler could not catch)

`UNDATED_INSTANT` is **deleted** — the constant, its export from `docs/index.ts`, and both call
sites. `toDocRow` now passes `row.created` / `row.updated` through unchanged. Proof on the wire, over
the real workspace's hand-written `.claude/skills/handwritten/SKILL.md` (name + description only, no
Corpus frontmatter — SPEC.md §7):

```
$ curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8765/api/docs?limit=200" -o resp.json
bytes 7143 | contains 1970: false
rows with null created: [ 'doc_skill07d757a3' ]
```

That row reads `{"created":null,"updated":null,"stale":null,…}` — an unknown age is fresh, not
ancient. The two `corpus init`-installed skills, which *do* carry timestamps, keep them.

#### 3. Agreement — one predicate, two readings

`STALE_TIER_SQL` is composed **from `atOrBeyondSql` itself**, descending, with no `ELSE`:

```
CASE WHEN <atOrBeyondSql('very-stale')> THEN 'very-stale'
     WHEN <atOrBeyondSql('stale')>      THEN 'stale'
     WHEN <atOrBeyondSql('aging')>      THEN 'aging' END
```

So the column a row carries and the `stale=` filter that selects it are literally the same SQL —
no second cutoff, no second threshold table. `staleness.test.ts` pins the descending order, the
`WHEN <filter predicate> THEN <tier>` composition, and the absent `ELSE`. `AWAITING_AGENT_SQL` is
written as the conjunction of exactly the columns `agent=` and `author=` filter on, and both
thread-state columns are wrapped in `threadOnly(...)`, which splices the filter's fragment verbatim.

Agreement tests (`query.test.ts` → `field/filter agreement`, over SERVER-011's own fixture):
tier ↔ `stale=` for all three tiers; tier ↔ the `stale` Attention reason, in both directions;
`agent` ↔ `agent=` for all three states; `unread` ↔ `unread=` true *and* false; `lastAuthor` ↔
`author=`; `parent` ↔ `parent=`; every thread field null on every non-thread row.
`row fields` → "keeps `awaitingAgent` in step with the `agent` and `author` filters" checks the
equivalence row by row.

Re-verified end-to-end against the running server, through the typed client:

```
stale=aging:      filter=["doc_ancient","doc_mortgage"] field=["doc_ancient","doc_mortgage"] agree=true
stale=stale:      filter=["doc_ancient","doc_mortgage"] field=["doc_ancient","doc_mortgage"] agree=true
stale=very-stale: filter=["doc_ancient"]                field=["doc_ancient"]                agree=true
unread=true:      filter=["th_awaiting"]  field=["th_awaiting"]  agree=true
unread=false:     filter=["th_anchored"]  field=["th_anchored"]  agree=true
agent=engaged:    filter=["th_anchored"]  field=["th_anchored"]  agree=true
agent=requested:  filter=["th_awaiting"]  field=["th_awaiting"]  agree=true
agent=none:       filter=[]               field=[]               agree=true
```

#### 4. E2E: typed-client rows vs. sqlite3 ground truth

`createCorpusClient(...).api.GET("/api/docs", …)` against the real server (rows abridged):

```
doc_ancient   note   created 2025-06-01T09:00:00Z updated 2025-12-20T09:00:00Z stale "very-stale" attention ["stale"]
doc_mortgage  note   created 2026-01-02T09:00:00Z updated 2026-04-17T09:00:00Z stale "stale"      attention ["stale"]
doc_fresh     note   created 2026-07-25T09:00:00Z updated 2026-07-25T09:00:00Z stale null         attention []
doc_skill07d757a3 skill created null updated null stale null
  every thread field null on all four: parent/agent/anchorQuote/turnCount/lastAuthor/lastTurn/unread/awaitingAgent

th_anchored  parent "doc_mortgage" agent "engaged"   anchorQuote "taxes and insurance" turnCount 2
             lastAuthor "agent" lastTurn "Because taxes and insurance are paid annually."
             unread false awaitingAgent false
th_awaiting  parent "doc_mortgage" agent "requested" anchorQuote null                  turnCount 1
             lastAuthor "user"  lastTurn "Can you double-check the numbers?"
             unread true  awaitingAgent true
```

Ground truth from `.corpus/cache.db` over the same joins:

```
$ sqlite3 -header -column .corpus/cache.db "SELECT d.id, d.created, d.updated, MAX(...) AS activity,
    t.parent_id, t.agent, t.status, t.turn_count, t.last_author, t.last_ts,
    an.exact_text, substr(lt.body_md,1,50), s.last_seen_ts FROM documents d LEFT JOIN … "

id                 created               updated               activity              parent_id     agent      status turn_count last_author last_ts               anchor_quote         last_turn                                      last_seen_ts
doc_ancient        2025-06-01T09:00:00Z  2025-12-20T09:00:00Z  2025-12-20T09:00:00Z
doc_fresh          2026-07-25T09:00:00Z  2026-07-25T09:00:00Z  2026-07-25T09:00:00Z
doc_mortgage       2026-01-02T09:00:00Z  2026-04-17T09:00:00Z  2026-04-17T09:00:00Z
doc_skill07d757a3  (null)                (null)                (empty)
th_anchored        2026-07-20T09:00:00Z  2026-07-22T09:00:00Z  2026-07-22T09:00:00Z  doc_mortgage  engaged    open   2          agent       2026-07-22T09:00:00Z  taxes and insurance  Because taxes and insurance are paid annually. 2026-07-23T00:00:00Z
th_awaiting        2026-07-24T09:00:00Z  2026-07-24T09:00:00Z  2026-07-24T09:00:00Z  doc_mortgage  requested  open   1          user        2026-07-24T09:00:00Z                       Can you double-check the numbers?
```

Every field matches column for column. The derived ones check out too: `doc_ancient`'s activity is
218 days old → `very-stale`; `doc_mortgage`'s is 100 → `stale`; `doc_fresh`'s is 1 → `null`;
`th_anchored`'s `last_seen_ts` (07-23) is after its `last_ts` (07-22) → `unread: false`, and its last
turn is the agent's → `awaitingAgent: false`; `th_awaiting` has no `seen` row → `unread: true`, and is
open + agent-requested + user-last → `awaitingAgent: true`. `anchorQuote` came through the
`anchors` join on the **parent's** frontmatter, which is where SPEC.md §6 stores selectors.

The undated skill was dropped into the running workspace and picked up **by the watcher**, without a
restart — the null-timestamp row above is a live re-projection, not a cold start.

#### 5. Gate

| Gate                                  | Result                                                          |
| ------------------------------------- | ---------------------------------------------------------------- |
| `npm run build`                       | pass                                                            |
| `npm run lint`                        | pass                                                            |
| `npm run format:check`                | pass                                                            |
| `npm run typecheck` (repo-wide)       | **pass in every workspace** — CONTRACT-005's expected red closed |
| `npm run test:coverage` (repo)        | **2473 passed / 133 files**; 99.11 % stmts, 95.79 % branch, 99.4 % funcs |
| `apps/server` alone                   | 1280 passed / 60 files                                          |
| `src/docs/query.test.ts`              | 56 tests (was 39)                                               |
| `src/docs/staleness.test.ts`          | 6 tests (was 3)                                                 |

SERVER-011's eval-verified suites are untouched behaviorally: the only edits to them are the
23-key row-shape list, the epoch→null expectation in "serializes a row whose projected columns are
damaged", and a `stale: null` assertion added beside it. Every filter, FTS, needs, sorting, tree and
performance test is byte-identical and green.

#### 6. Scope

Touched: `apps/server/src/docs/{query,needs,staleness,index,corpus-fixture}.ts`,
`apps/server/src/docs/{query,staleness}.test.ts`,
`apps/server/src/projection/{project-document,index}.ts` (export `bodyExcerpt`), and this issue file.
No git commands run; `packages/contract` untouched; nothing committed.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-015]` prefix
