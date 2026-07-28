# [CONTRACT-012] `DocRow.unreadThreads` — aggregate unread count for document rows

## Domain

contract

## Status

done (contract half; the commit is coupled with SERVER-027)

## Priority

P1

## Model

opus — mirrors the parentTitle/originTitle rider pattern.

## Dependencies

- Depends on: CONTRACT-011
- Blocks: SERVER-027

## Spec References

- SPEC.md §11 — document rows' unread indicator
- `issues/ui/004-type-aware-rows.md` — deferral 2 (discovery: no wire data; per-row `?parent=&type=thread&unread=true` is the N+1 sprint-009 TEST-66 forbids)

## Summary

UI-004 shipped the pill behind an `unreadCount` prop seam reading `new` (no number) because `DocRow` carries no aggregate. Add `unreadThreads: number` (required, 0 for threads and childless docs) to `DocRow`, computed server-side in the collection query.

## Acceptance Criteria

- [x] `DocRow.unreadThreads` required number; description states the semantics (count of this document's threads currently unread for the user).
- [x] All standing invariants; artifacts regenerated, idempotent; downstream break list measured for SERVER-027.
- [x] Rider: `DocRow.parentTitle`'s description no longer tells a client to render an orphaned thread as standalone.
- [x] Rider: `Job.type` carries the event type (open string, `QueueEvent.type`'s vocabulary).
- [x] Rider: `DocsQuerySchema.includeArchived` (stringbool) lifts the default archived exclusion as a union.

## E2E Verification Log

**Implemented on: opus.** Worktree `.claude/worktrees/contract-012` (branch `wt-contract-012`, cut
from `phase-3-ui` @ `1377154`). Scratch: `/tmp/corpus-s010-c012-*`. No server was started — this half
is verifiable by schema/route/client tests plus regeneration; the runtime half (TEST-76…82) is
SERVER-027's, on port `8972`. Nothing bound in `8970`–`8974`; `8765` never touched.

### The schema diff surface

`packages/contract/src/schemas/query.ts`

- **`DocRowSchema.unreadThreads`** — `z.number().int().min(0)`, **required**, placed directly after
  `threadRowShape` so it reads beside the per-thread `unread` it aggregates. Generated as
  `{"type":"integer","minimum":0}` in `DocRow.required`. The description states, in order: what it
  counts (this document's own threads unread for the user, SPEC.md §7); that it equals the item count
  of `?parent=<id>&type=thread&unread=true`; that a partial read (`seen` marked at a `lastSeenTs`
  before the last turn) counts as unread in **both**, so aggregate and flag agree by construction;
  that it is **`0` on a thread row** and **`0` on a document with no threads**; and that it is never
  null and never absent, so `0` means "nothing unread" and never "unknown". (TEST-71)
- **`DocRowSchema.parentTitle`** — description's last clause replaced. Was
  *"…SPEC.md §9.2); render such a thread as standalone rather than showing a raw id."* Now
  *"…SPEC.md §9.2). An orphaned thread — `parent` set, title gone — renders an **empty** context cell
  rather than a raw `doc_*` id, which is not the same as a standalone thread (no `parent` at all) and
  must not be labelled as one."* This matches `packages/kit/src/row/threadRow.ts`'s `rowContext`,
  which returns the word `standalone` **only** when `row.parent === null` and returns `null` (an
  empty cell) for a set-parent/null-title row. The two sentences `openapi.test.ts` already pinned
  ("current title of whatever `parent` names", "never a stored copy") are unchanged. (TEST-72)
- **`DocsQuerySchema.includeArchived`** — `z.stringbool().optional()`, `type: "boolean"` in the
  document, declared immediately after `status` (the default it lifts). No `default` — the server
  owns it, per the no-request-defaults invariant. Description: `true` widens the default result set
  into the **union** of archived and non-archived documents (the archived chip's "include archived"
  reading), where `status=archived` selects archived documents *only*; absent/`false` keeps today's
  behaviour; it modifies the **default and nothing else**, so it is a **no-op alongside an explicit
  `status`** (`status` already replaces the default filter, and `status=open&includeArchived=true` is
  just `status=open`). `status`'s own description was updated to point at it rather than claiming
  `status=archived` is "how the archived chip brings them back", which was the false half.
- **`DocRowSchema`'s docblock** gained "how many of its threads are unread".

`packages/contract/src/schemas/job.ts`

- **`JobSchema.type`** — `z.string().min(1)`, **required**, placed second (after `eventId`), mirroring
  `QueueEventSchema`'s own field order. Open string, not an enum, for the same reason
  `QueueEvent.type` is open: plugins define their own event types. Description names the core values
  (`comment.created, form.respond, agent.done`), says it is the same value as `QueueEvent.type` read
  from the projection rather than re-derived, and states the console row is `<type> · <originTitle>`.

Non-contract, mechanically forced by the above (see "Breaks outside apps/server"):
`packages/kit/src/testing/docRow.ts` (`unreadThreads: 0` in the fixture) and
`packages/kit/src/row/Row.tsx` (`unreadCount` docblock — TEST-83's second half).

### Regeneration and the standing invariants (TEST-73)

```
$ npm run generate -w packages/contract        # ×3, hashes captured between runs
generated ./openapi.json
generated ./src/client/schema.generated.ts
$ diff hash-a hash-b && diff hash-b hash-c
IDEMPOTENT across 3 runs
5cfdfd74cb462ed5bba768eff629d1155fcfa0f5461afad525ae9b2fb1f8aea7  packages/contract/openapi.json
34df9d073a97a1a55c1d1200348a1ec83b0574048e80f2bd7d0148aceceeef2a  packages/contract/src/client/schema.generated.ts
```

`docs/cli.md` is byte-identical after `npm run docs:cli -w apps/cli`
(`cab318c7…` before and after) — this rider adds no CLI surface.

`node --import tsx scripts/check-generated-artifacts.ts`, run twice, prints the **same** output both
times: `✓ CLI reference is up to date`, and for the API contract the *regeneration* half is clean
(the script's hash comparison is a no-op) while the `diffAgainstHead` half reports the 28/10-line
diff against `HEAD` — because the artifacts are, correctly, **uncommitted** in this worktree. That
half goes green the moment the orchestrator commits them with the source. Both runs identical, so
there is no drift and no nondeterminism; the only outstanding condition is the commit itself.

Endpoint count unchanged at **42** operations in `openapi.json`; `ENDPOINT_INVENTORY` untouched
(`inventory.test.ts`, 49 tests, green). No route was added, moved or removed.

Standing invariant suites extended rather than merely kept green:

| Invariant | Where | What was added |
| --- | --- | --- |
| 400-on-validated-input | `routes/index.test.ts` | `includeArchived=true\|false\|1\|0` → 200; `maybe\|archived\|""` → 400, through the **mounted** app, not the schema |
| No request-body defaults | `openapi.test.ts` | `includeArchived` asserted to carry no `schema.default`; the existing repo-wide walk already covers it |
| Published-prose pins | `openapi.test.ts` | new `DocRow.unreadThreads (CONTRACT-012)` describe (required + `integer`/`minimum: 0` + never `"null"`; the §7 reference, the `?parent=…` equality, the thread-row `0`, the childless `0`, "unknown"; and that it names the per-thread `unread` flag rather than a second rule); `Job.type` open-string + core-values + `QueueEvent.type` pin; `Job.required` order pin updated; a negative pin that `parentTitle` no longer says "render such a thread as standalone" |
| Parameter grammar | `openapi.test.ts` | `includeArchived` added to the pinned `/api/docs` parameter list (exact-order equality), plus a pair asserting `status` and `includeArchived` publish the archived-only vs. archived-as-well distinction in both directions |
| Typed-client surface | `client/index.test.ts` | `data.items[0].unreadThreads` assigned to a `number` (compile-time proof it is neither nullable nor optional); `params.query.includeArchived: true` round-trips through the generated client against the mounted app |
| Schema round-trip | `schemas/query.test.ts`, `schemas/job.test.ts` | `unreadThreads` required/`0`-on-thread-row/rejects `-1`, `1.5`, `"2"`; `includeArchived` stringbool truth table + absent-not-defaulted; orphaned-vs-standalone thread row; `Job.type` core values, plugin value, empty/absent rejection, and equality with `QueueEvent.parse().type` |

```
$ VITEST_MAX_THREADS=4 vitest run packages/contract
Test Files  34 passed (34)
     Tests  1027 passed (1027)          # 1017 before the new cases
$ npm run typecheck -w packages/contract   → exit 0
$ eslint packages/contract/src …           → exit 0
$ prettier --check packages/contract …     → exit 0
```

One real defect the new tests caught before it shipped: zod 4's `z.stringbool()` accepts
`yes`/`no`/`on`/`off`/`y`/`n`/`enabled`/`disabled` alongside `true`/`false`/`1`/`0`, so a first draft
asserting `includeArchived=yes` → 400 failed with 200. The rejection cases now mirror the `pinned`
precedent (`maybe`, `""`) plus `archived` — the spelling a user might plausibly try.

### The downstream break list SERVER-027 must fix (TEST-74)

Measured, not guessed: `npm run build -w packages/contract` in this worktree, then
`npm run typecheck -w apps/server`. **Exit 2, exactly two errors, both in production code:**

```
src/docs/query.ts(406,3): error TS2741: Property 'unreadThreads' is missing in type
  '{ id: string; type: string; title: string; …18 more…; snippets: {…}[]; }'
  but required in type '{ unreadThreads: number; attention: …; snippets: …; …26 more…; excerpt: string; }'.

src/jobs/project.ts(108,3): error TS2741: Property 'type' is missing in type
  '{ eventId: string; status: …; started: string; updated: string; lastLine: string | null;
     originId: string | null; originTitle: string | null; }'
  but required in type '{ eventId: string; type: string; status: …; … }'.
```

That is the whole work item. Two row mappers:

1. `apps/server/src/docs/query.ts:406` — add `unreadThreads` to the row it builds, as a **correlated
   subquery over the doc's child threads reusing `unreadSql`/`UNREAD_SQL` from
   `apps/server/src/docs/needs.ts`** (TEST-75; a second hand-written copy of
   `t.last_ts > COALESCE(s.last_seen_ts, '')` fails even if the numbers are right). `0` for
   `type = 'thread'` rows. Query-time only — no projection column, no `SCHEMA_VERSION` bump (TEST-82).
2. `apps/server/src/jobs/project.ts:108` — add `type`, read from the projection's `events.type`
   beside the existing `originId`/`originTitle` resolution.
3. Not a typecheck error but a runtime one: `apps/server/src/docs/query.test.ts` and
   `apps/server/src/jobs/*.test.ts` assert exact row shapes with `toEqual`/property lists
   (`query.test.ts:170` field list, `:731/:744/:762/:784/:885`; `jobs/routes.test.ts:378` field list,
   `:390`; `jobs/project.test.ts:135/:144/:174`). Those fixtures need the two new fields.
4. `DocsQuerySchema.includeArchived` reaches the handler validated but is currently **ignored**.
   `apps/server/src/docs/query.ts:155-161` is
   `query.status === undefined ? "d.status <> 'archived'" : "d.status = @status"`; the change is to
   drop the `<>` predicate when `includeArchived === true` **and** `status` is undefined. This
   produces no typecheck error, so it will not announce itself — it is on the list because the
   contract now promises it.

**Breaks outside `apps/server` — measured and already fixed here**, because leaving them would make
the coupled commit red in a workspace nobody is assigned to:

- `packages/kit/src/testing/docRow.ts` declares its return type as `DocRow`, so the new required
  field broke `packages/kit`'s typecheck. Fixed with the one line `unreadThreads: 0`.
- `packages/kit/src/row/Row.tsx`'s `unreadCount` docblock explained *why the wire could not supply
  the count* — a docblock describing a solved problem, which is TEST-83's second half. Rewritten to
  name `DocRow.unreadThreads`. Comment only.
- `issues/ui/004-type-aware-rows.md`'s `DEFERRED → a filed CONTRACT issue` entry is closed with this
  issue's id, original text kept struck through for the record (TEST-83's first half).

After those two kit edits: `npm run typecheck` is **exit 0** in `packages/contract`, `packages/kit`,
`apps/cli` and `apps/ui`. `apps/server` is the only red workspace, by design, and goes green with
SERVER-027 inside the single `[CONTRACT-012][SERVER-027]` commit (TEST-84).

`git status --porcelain` in the worktree — ten files, no strays:

```
 M packages/contract/openapi.json
 M packages/contract/src/client/index.test.ts
 M packages/contract/src/client/schema.generated.ts
 M packages/contract/src/openapi.test.ts
 M packages/contract/src/routes/index.test.ts
 M packages/contract/src/schemas/job.test.ts
 M packages/contract/src/schemas/job.ts
 M packages/contract/src/schemas/query.test.ts
 M packages/contract/src/schemas/query.ts
 M packages/kit/src/testing/docRow.ts
```

(plus the three markdown files above; `dist/` and the `node_modules/@corpus` symlinks are gitignored)

### Criteria not verifiable from this half

`TEST-76`…`TEST-82` (value correctness across the four-thread case, thread/childless rows reporting
`0`, the property-level agreement with `?parent=…&unread=true`, live movement in both directions, the
statement count and `EXPLAIN QUERY PLAN`, the 500-document p50/p95, `db rebuild && db doctor`) all
require the server to compute the field: `DEFERRED → SERVER-027`, in the same commit. `TEST-84`
(one commit, green at that commit) is the orchestrator's. Substitute evidence supplied here: the
schema's own definition pins the semantics those tests assert, and the break list above names the
exact call sites.

## Completion Checklist (orchestrator)

- [x] `/evaluate` passes
- [ ] Committed (coupled with SERVER-027)

## Rider (orchestrator, 2026-07-28)

`DocRow.parentTitle`'s description in `packages/contract/src/schemas/query.ts` ends
"render such a thread as standalone rather than showing a raw id" — adjudicated wrong during the
UI-004 parentTitle fix: an orphaned thread had a parent, and kit renders an empty context cell,
not the word "standalone". Correct the description to match (one line) while touching this file.

## Riders (orchestrator, 2026-07-28 — sprint-010 adjudications)

1. **`Job.type`** — add the event type to `JobSchema` (the projection already stores
   `events.type`); the console's job rows are `<event type> · <title>` per the prototype and §11.
   SERVER-027 populates it in the coupled commit.
2. **`DocsQuerySchema.includeArchived`** — stringbool (the `pinned` precedent). When true, the
   default `status <> 'archived'` exclusion is lifted (union — archived rows appear alongside
   open ones); absent/false keeps today's behavior; `status=archived` alone still means "archived
   only". SERVER-027 implements the query change. SPEC §11 clarification goes to the phase-end
   spec pass.
