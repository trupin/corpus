# [SERVER-026] Consume CONTRACT-011: extra frontmatter, pinned/order, parentTitle

## Domain

server

## Status

done

## Priority

P0

## Model

opus — projection/query plumbing on established patterns (originTitle precedent).

## Dependencies

- Depends on: CONTRACT-011, SERVER-011, SERVER-015
- Blocks: UI-003

## Spec References

- SPEC.md §10 (views), §12 (plugin frontmatter)
- `issues/contract/011-extra-frontmatter-surface.md`

## Summary

Server half of the CONTRACT-011 coupled commit: project the extra-frontmatter object into doc rows (byte-preserving via the existing YAML machinery), honor it on create/update through the standard mutation pipeline (validation per the contract's collision rules), support the `pinned` filter and `order` sort in the collection query, and populate `parentTitle` (one query with the parent resolution, read at response time — the `originTitle` pattern).

## Acceptance Criteria

- [x] apps/server compiles against the regenerated contract; extra frontmatter round-trips disk → row → create/update E2E (seed views' `pinned`/`order`/`query`/`column` visible via `GET /api/docs?pinned=true&sort=order`).
- [x] parentTitle populated for parented threads; null otherwise.
- [x] Colocated tests + E2E evidence; full gate green as the coupled unit.

## Technical Design

**As implemented (2026-07-27).**

1. **One reader, two consumers** (`core/view-frontmatter.ts`). `readViewFrontmatter(data)` returns
   all five wire fields off a frontmatter mapping, and *both* the projection
   (`projection/project-document.ts`) and the single-document read (`docs/read.ts`) call it. That
   is CONTRACT-005's nullable-timestamp lesson applied: one file read through `GET /api/docs` and
   `GET /api/docs/{id}` must not answer two different things, which is also why the contract
   shares `viewFrontmatterShape` between the row and the frontmatter component.
2. **Five new `documents` columns** — `pinned`, `sort_order`, `query_json`, `column_ref`,
   `extra_json`; `SCHEMA_VERSION` 2 → 3, so every existing `cache.db` is dropped and rebuilt from
   files on first open. §9.1's column list predates §10 having a wire surface; a filter
   (`pinned`) and a sort (`order`) cannot be answered from the files at request time without one
   read per row, which is the N+1 the collection query exists to prevent. All five are still
   derived — `db rebuild` reconstructs them from frontmatter. `sort_order` is spelled apart from
   the frontmatter key because `order` is SQL.
3. **`parentTitle` is a fourth page-only join** (`LEFT JOIN documents pd ON pd.id = t.parent_id`),
   in `ROW_FROM_SQL` and not in `FROM_SQL`, so the COUNT does no work the total does not depend
   on. Alias `pd`, not `p`: the folder filter's correlated subquery already binds `p`, and
   shadowing it would be a silent trap for the next filter added. Read at query time, never
   stored, so a rename is reflected immediately and a deleted parent reads `null` (verified both
   ways E2E).
4. **`order` sort**: `d.sort_order IS NULL, d.sort_order ASC, d.title COLLATE NOCASE ASC, d.id ASC`
   — the contract's tiebreak spelled out, nulls last, with the title rung using the same collation
   as the `title` sort.
5. **Create writes only what the request named.** `pinned: false` / `order: null` / `query: null` /
   `column: null` write **no key** (absent and false are one state for `pinned`; `null` is "no
   key" for the other three per the contract), so a plain note's frontmatter stays §5's canonical
   block. `extra` keys are spread in **flat**, beside the core ones — no `extra:` mapping is ever
   written, because the file format has never had one (§12's `todo` carries a top-level `items:`).
6. **Update is a shallow merge patch, key-granular.** `changedFields` grew two more passes:
   `CLEARABLE_FRONTMATTER_KEYS` (`order`/`query`/`column`, where `null` deletes the key — `due`
   and `reviewed` deliberately stay literal-`null` §5 fields) and `patch.extra`'s entries. A
   removal is expressed as `undefined`, which is `setFrontmatterFields`' own spelling for it, so
   untouched keys keep their source bytes through the existing splice machinery — no new
   serializer, no re-emit. `sameValue` is now canonical-JSON (recursively key-sorted, depth-capped,
   throw-safe) because `query` and `extra` are the first object-valued keys a `PUT` can carry:
   re-sending one query with its keys in a different order must not count as a change.
7. **Validation is the schema's, not the server's.** Reserved keys, depth, size, `column`'s
   `<plugin>/<type>` and `query`'s flat-map shape are all rejected by `@hono/zod-openapi` before a
   handler runs; the server adds no second check (verified: four 400 classes E2E, and the file is
   byte-unchanged after each refusal). On the **read** path the readers are lenient instead —
   a hand-edited `order: first` reads as `null` rather than failing the document — and
   `MAX_EXTRA_READ_DEPTH` is a safety cap, not a policy one: a YAML anchor can build a value that
   refers to its own ancestor, and that value has no JSON form at all.

## E2E Verification Log

**Implemented on: opus** (matches the Model recommendation). Main tree, no worktree; no git
command run by this agent. Scratch `/tmp/corpus-s026-UVJZwf`, server on **8937** (sprint-009 has
no SERVER-026 row; the orchestrator's allocation `8935`–`8939` was used). `8765` verified UNBOUND
before and after. Server stopped by pid (`stopped (pid 16764)`), scratch removed.

### Post-Implementation Verification

Real `corpus init` workspace, real server process, `curl` against it.

**E2E-1 — the board's whole column set, one bounded query** (`GET /api/docs?pinned=true&type=view&sort=order`):

```
total 3
{"title":"Attention","pinned":true,"order":1,"query":{"needs":"me"},"column":null,"extra":{},"parentTitle":null}
{"title":"Inbox","pinned":true,"order":2,"query":{"folder":"inbox"},"column":null,"extra":{},"parentTitle":null}
{"title":"Open threads","pinned":true,"order":3,"query":{"type":"thread","status":"open"},"column":null,"extra":{},"parentTitle":null}
```

The seed views round-trip untouched — the shipped files were not edited for this issue.

**E2E-2 — `extra` disk → row.** `POST /api/docs` with `extra.items` (+ `board`, `note`) wrote the
plugin keys as **top-level YAML keys beside the core ones**, with no `extra:` mapping anywhere:

```
evergreen: false
items:
  - text: Call the broker
    done: false
    ts: 2026-07-27T09:00:00Z
  - text: File the statement
    done: true
    ts: 2026-07-27T09:05:00Z
board:
  lane: doing
  swimlane: home
note: untouched
```

`GET /api/docs?type=todo` returned the same object on the row, and the create response carried it
on `doc.frontmatter.extra`.

**E2E-3 — the merge patch is byte-preserving.** `PUT` with `{"extra":{"board":{...}}}`, diffed
against the file's bytes captured immediately before:

```
-updated: 2026-07-28T01:31:47Z
+updated: 2026-07-28T01:31:58Z
 board:
-  lane: doing
+  lane: done
   swimlane: home
 note: untouched
```

Two lines. `items:`, `note:`, `swimlane:` and every core line but `updated` are the original
bytes. A subsequent `{"extra":{"note":null}}` removed exactly that key (`grep -c "note:"` → 0)
and left `lane` alone.

**E2E-4 — the 400s the contract owns, surfaced unchanged:**

```
{"code":"bad_request","issues":[{"path":"json.extra.title","message":"`title` is a core frontmatter key; core keys cannot be set or shadowed through `extra`."}]}   <- 400
{"code":"bad_request","issues":[{"path":"json.column","message":"A column reference is `\"<plugin>/<type>\"` — exactly one slash."}]}                                <- 400
```

`ls data/docs/inbox` after both refusals: only the one legitimately created document — a rejected
mutation left the workspace byte-for-byte as it was.

**E2E-5/6 — view keys through create and update.** A `POST` with `order: 1.5` (a midpoint, as a
reorder writes) landed `pinned: true` / `order: 1.5` / `query:` / `column: todos/board` in the
file and re-sorted the board to `Attention@1 | Finance@1.5 | Inbox@2 | Open threads@3`. A `PUT`
with `{"order":null,"column":null}` removed exactly those two lines (diff: `-order: 1.5`,
`-column: todos/board`, `updated` restamped, `pinned`/`query` byte-identical) and the column moved
to the end of the board — `Attention@1 | Inbox@2 | Open threads@3 | Finance@null` — placed, not
dropped.

**E2E-7 — `parentTitle` is a live join.** A real `POST /api/threads` on the todo document:

```
{"id":"th_vgf7kag6","parent":"doc_o3unhrwy","parentTitle":"Mortgage errands"}
rename the parent → {"id":"th_vgf7kag6","parentTitle":"Mortgage errands, revised"}
DELETE the parent  → {"id":"th_vgf7kag6","parent":"doc_o3unhrwy","parentTitle":null}
```

**E2E-8/9 — out-of-band and rebuild.** Hand-editing `order`/`column` into a view file on disk
moved it on the board within ~1 s (`Finance@0/todos/board | Attention@1/null | …`) via the
watcher; `POST /api/db/rebuild` reproduced the identical answer from files alone. `corpus db
doctor` after every phase: `projection is clean — 8 documents from 8 files (1ms)`.

**Checks (whole repo, exit codes read from the tool itself):**

```
npm run build       → BUILD_EXIT=0
npm run lint        → LINT_EXIT=0   (no rule disabled; the one eslint finding, a redundant
                                     `unknown | typeof SENTINEL` union, was fixed by making the
                                     converter return a result shape instead of a sentinel value)
npm run format:check→ FMT_EXIT=0
npm run typecheck   → TC_EXIT=0     (all five workspaces; the three CONTRACT-011 breaks are gone)
npm test            → TEST_EXIT=0   218 files / 3968 tests
```

The first full-suite run failed one test — `apps/cli/.../queue/idle.test.ts > "writes nothing at
all while parked"`, a 5 s timeout on the long-poll parking test under a loaded machine. It passes
alone (9/9) and in the immediately following full re-run (3968/3968, exit 0); it is unrelated to
this change and touches no code in `apps/server`.

**Tests added** (all colocated): `core/view-frontmatter.test.ts` (19), `docs/view-query.test.ts`
(12), `docs/view-write.test.ts` (13). Both new suites seed from the **shipped**
`assets/workspace/data/docs/views/*.md`, so a change to what `corpus init` writes fails here
rather than in a user's first board. Three existing pins were updated with their reason recorded
in place: `projection/db.test.ts`'s retyped `documents` column list, `docs/query.test.ts`'s row
key set, and `core/frontmatter.test.ts`'s "file schema output is wire-acceptable" case — the file
schema's output is now a *subset* of the wire shape, because `extra` is a wire envelope and not a
disk key.

**Known consequence, deliberately not fixed here:** `FileFrontmatterSchema` still passes the four
view keys through as loose keys rather than validating them, so a hand-edited `order: first` is
reported by neither `doc check` nor the save path — both readers degrade it to `null`. Making
them validated file fields would turn a malformed view key into a §11 *blocking* failure on every
save of that document; that is a §11 policy call, not this issue's.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint 0, prettier 0, tsc 0 across all workspaces)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] `/evaluate` passes
- [ ] Committed with CONTRACT-011
