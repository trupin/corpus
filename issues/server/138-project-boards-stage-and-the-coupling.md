# [SERVER-138] Project boards and `stage`, keep one default-open board, and let a stage decide a status

## Domain
server

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: CONTRACT-074
- Blocks: UI-148, UI-152, CLI-060

## Spec References
- SPEC.md §5 — "The document model" (`stage`, "while a document is in a kanban, its stage decides its status")
- SPEC.md §9.1 — "Projection (SQLite)"
- SPEC.md §9.2 — "HTTP API" ("a response's warnings also carry effects on documents the request never named")
- SPEC.md §10 — "UI — the board" (boards as documents, kanban boards)

## Summary

> **Amended 2026-08-22 (Phase 41 prep).** This issue was written before v0.18.0 removed the plugin surface and derived status (SHARED-067). The clauses that named them are struck below, and the §-citations are renumbered to the post-v0.18.0 SPEC.

The server reads and writes the fields CONTRACT-074 put on the wire, indexes `stage` so it filters, drops `pinned` from the projection, and owns the two rules that are facts about documents rather than gestures: at most one board is `default-open`, and a document's stage decides its status while it is in a kanban. Nothing here migrates a workspace: a view file that still says `pinned: true` projects with that key in `extra`, and CLI-061 tells the agent what to do about it.

## Acceptance Criteria
- [x] `documents` gains `stage TEXT` (indexed) and `board_json TEXT` (columns, kanban, default-open) and loses `pinned`; the schema version bumps and the projection rebuilds from files on start.
- [x] `GET /api/docs?stage=x` and `GET /api/search?stage=x` filter exactly; `sort=order` orders boards.
- [x] Frontmatter `default-open` ↔ wire `defaultOpen`; `kanban`, `columns`, `order`, `stage` round-trip through create, update and `doc show`.
- [x] A write that sets `default-open: true` on a board clears it on every other board in the same commit; the response's warnings name each cleared board, and nothing is said when none was cleared.
- [x] A write that changes `stage` (create, update, patch) on a document **in a kanban** also writes `status`: the board's `kanban.status[stage]` when mapped, `open` otherwise; in one commit; the response names the status change beside the stage change. "In a kanban" means: some `type: board` document, not archived, with `kanban.field: stage`, whose scope query matches the document **with archived documents included**. When several kanbans match, the one with the lowest `order` decides and the warning says which.
- [x] A write that changes only `status` never touches `stage`.
- [x] A `stage` write is never refused for being off the board's transitions (the UI governs the drag; the CLI and the reader may set any stage).
- [x] Validation of `kanban` at the write boundary matches CONTRACT-074's refusals; `404`/`400` messages name the field.
- [x] Unknown frontmatter keys, `pinned` included, keep landing in `extra` unchanged.
- [x] `unset: [..]` on the update body removes each named key from the file's frontmatter (core or `extra`) in the same commit as any `changes`; `id`, `type`, `created` refuse `400` naming the key; an absent key is a no-op, not an error.
- [x] ~~A document whose status is **derived** never has `status` written by the stage coupling.~~ **Struck 2026-08-22 (Phase 41 prep).** Derived status was removed with the plugin surface (SHARED-067), so no document has one. The coupling writes `status` for every document in a kanban, with no carve-out. **Corrected 2026-08-23 (PR #58):** the struck sentence originally claimed a rider signing this carve-out "survives as dead text" in §5. **There is no such text in SPEC.md.** `issues/PLAN.md`'s Phase 41 prep note says so directly — "SPEC §5 and §10 were checked to carry no derived-status carve-out — the carve-out lived only in the issue files" — and a re-read of §5's stage rider on 2026-08-23 confirms it. Nothing in the spec was ever left dead by this strike.
- [x] `documents` gains `last_actor TEXT` (`user` | `agent`), written on every write from the acting party the write carried, and `user` for a change the watcher picks up from outside the server (§4); projected as `lastActor` on the row (CONTRACT-074). A rebuild from files reads it from the last commit's author on that path, which is the same fact §4 records.

## Technical Design

### Files to Create/Modify
- `apps/server/src/projection/schema.ts` — columns, version bump
- `apps/server/src/projection/project-document.ts` — read `stage`, `columns`, `kanban`, `default-open`, `order` (lines ~396-422 hold the view block)
- `apps/server/src/core/view-frontmatter.ts` → rename or sibling `board-frontmatter.ts` — readers for the board block
- `apps/server/src/docs/write-routes.ts` and the write service — the default-open rule and the coupling rule, both as "effects on documents the request never named"
- `apps/server/src/docs/query.ts` (wherever `docFilterShape` is compiled to SQL) — `stage`
- tests beside each

### Key Implementation Details
- **Scope matching for "in a kanban"** reuses the same query compiler the list endpoint uses, run for one id: `matchesQuery(boardQuery, docId, { includeArchived: true })`. Do not reimplement the filter grammar.
- The coupling runs inside the same write transaction as the stage change and produces one commit whose message names both fields (§4: a write that names its own delta).
- The default-open rule is the same shape: collect the other boards carrying the flag, rewrite them, one commit, warnings per document.
- `order` projection stays in `sort_order`; only its meaning moves.

### Edge Cases

> **Reconciled 2026-08-23 (PR #58).** The second bullet below contradicted this
> issue's own ticked acceptance criterion ("the board's `kanban.status[stage]`
> when mapped, `open` otherwise") and, more importantly, the signed rider it
> claimed to be reading. **§5's literal sentence is "a stage the board maps to a
> status writes that status on entry, and a stage with no mapping writes
> `open`"** — it draws its line at the `status` map and says nothing about the
> `stages` list. The acceptance criterion is the one that was right. The carve-out
> is removed from the code (`docs/kanban.ts`), and the bullet is struck rather
> than deleted so the record shows what was implemented between 2026-08-22 and
> this correction. The remaining bullets are kept, with the two that are **this
> issue's rules rather than the spec's** now saying so.

- A kanban over `status` has no stage coupling to run (the field is status itself).
- ~~A document whose `stage` is not in any matching board's `stages`: no status write, and no warning — the stage is simply not part of a kanban's vocabulary yet.~~ **Struck 2026-08-23 (PR #58).** A stage the board does not draw has no mapping, so §5's second outcome covers it: the document is in the kanban, and `open` is written and named in the response like any other unmapped stage. The warning says which of the two outcomes happened, so nobody goes looking in `kanban.status` for an entry that is not there.
- A board archived after mapping: it no longer decides anything. **This is SERVER-138's rule, not §5's** (noted 2026-08-23): the rider is silent on an archived board. Kept because an archived board is out of sight, and a board nobody can see deciding a status is a change with no visible cause.
- A document whose **root** fixes its status — an archived skill under `.claude/skills-archived/` (§7) — gets no status written by the coupling. **Also SERVER-138's rule, not §5's** (noted 2026-08-23): its status is not in its frontmatter at all, so there is nothing there for a board to decide, and `POST /api/docs/{id}/unarchive` stays the operation that brings one back.
- Which board decides when two kanbans claim one document — the lowest `order`, nulls last, then `title`, then `id` — is **SERVER-138's rule too** (noted 2026-08-23). §5 says a stage decides a status and never says whose map.
- `stage: null` (clearing) on a document in a kanban writes `open` — a cleared stage is in no `status` map, so §5's "a stage with no mapping writes `open`" covers it with no rule of its own.

## Testing Strategy
Vitest against a real temp workspace and a real projection (the server's existing pattern): one test per acceptance criterion, and a parity test that the scope match for coupling agrees with `GET /api/docs` on the same query.

## E2E Verification Plan
### Verification Steps
1. `corpus init` a temp workspace, `corpus server start`.
2. `corpus doc create --type board --title K --kanban '{"field":"stage","stages":["a","b"],"status":{"b":"resolved"}}' --query '{"folder":"inbox"}'`.
3. `corpus doc create --title x` (lands in inbox), then `corpus doc edit <id> --stage b` → `doc show` has `status: resolved`; `--stage a` → `open`; `git log -1` shows one commit naming both.
4. Two boards with `default-open: true` → the second write's output names the first as cleared.
5. `GET /api/docs?stage=b` returns exactly the document.

## E2E Verification Log

**server-dev, 2026-08-22, on opus.** A real workspace at
`scratchpad/e2e`, `corpus init` + `corpus server start` on port 8767, every
request over real HTTP with the workspace's own bearer token. `sleep 62` between
writes wherever a commit count is the claim, so §4's window folds nothing.

**1. A kanban board over `stage`.** `POST /api/docs` with
`kanban: {field: stage, stages: [a, b], status: {b: resolved}}`, `query: {folder: inbox}`.
The file at `data/docs/views/k.md` carries the block verbatim, and the response
reads `kanban`, `order` and `query` back off the row.

**2. The coupling.** `POST /api/docs {type: note, title: x}` lands in
`data/docs/inbox/x-2.md`. Then `PUT {stage: "b"}`:

- response `stage= b status= resolved`
- warning: ``stage `b` set status to `resolved`: this document is in the kanban K (doc_r6ufhzn5), whose `kanban.status` map decides a status on entry (SPEC.md §5).``
- `git show --name-only HEAD` → **one** commit, `doc edit: x (doc_knzxpkqr) by user`, one file
- its diff: `-status: open` / `+status: resolved` / `+stage: b` — both fields, one commit

Then `PUT {stage: "a"}` → `stage= a status= open`, with the warning naming the
unmapped case. §5's "a stage with no mapping writes `open`".

**3. The filter.** `GET /api/docs?stage=b` → 0. `?stage=a` → 1 (`x`).
`?stage=` → 11 (every unstaged document). `?stage=,a` → 12 — the union a kanban's
first column needs, in one request.

**4. Two default-open boards.** `POST` First (`defaultOpen: true`), then `POST`
Second (`defaultOpen: true`):

- Second's warnings: ``First (doc_v6vleg4m) is no longer the default-open board: at most one board carries `default-open` (SPEC.md §10), and this write took it.``
- `git show --name-only HEAD` → **one** commit holding `views/first.md` **and**
  `views/second.md`
- `grep -c default-open first.md` → 0; `second.md:15:default-open: true`

The first board's own create carried no such warning, because nothing was
cleared. Setting it back on First later cleared Second, and the SSE frame carried
both: `{"keys":[["docs"],["docs","doc_v6vleg4m"],["docs","doc_oc2d6u63"]]}`.

**5. The schema upgrade, verified rather than assumed.** With the server stopped,
the live `cache.db` was rewritten into its **v20** shape — `pinned` back,
`stage`/`last_actor`/`board_json` gone, stamp set to `20` — and the server
restarted. After boot: stamp `21`, the v21 column list, 14 rows back from the
files, `('doc_knzxpkqr', 'a', 'user')` for the staged document, and
`json_extract(board_json,'$.defaultOpen')=1` finding the one default-open board.
The nullability of two of the three new columns is not what carried them;
supersede-and-repopulate is.

**6. `last_actor`.** An agent write (`x-corpus-author: agent`) moved the column to
`agent`. `corpus db rebuild` — which throws every row away — brought it back as
`agent`, from `git log -1 --format=%an` on that path (`agent doc edit: x
(doc_knzxpkqr) by agent`). Whole-workspace tally after the rebuild:
`[('agent', 1), ('user', 13)]`.

**7. `corpus db doctor`** → `projection is clean — 14 documents from 14 files (3ms)`.

**8. The comma refusal.** `POST {stage: "in review, blocked"}` → `400`,
`json.stage`, ``a stage may not contain a comma: `GET /api/docs?stage=` is a
comma-separated OR list (SPEC.md §5, §10), so a stage with one could never be
filtered for.`` The filter is named, which is the whole point of the message.

**9. `unset`.** `PUT doc_seedattention {unset: ["pinned"]}` — the seed view still
carries the `pinned: true` a pre-rider-2 workspace wrote. Afterwards `extra` is
`{}`, `grep -c pinned attention.md` is 0, and it is one commit naming that file.
That is CLI-061's migration, working over HTTP today.

**Not verified here, because it does not exist yet:** the issue's plan spells step
3 as `corpus doc edit <id> --stage b`. CLI-060 adds `--stage`, so the equivalent
was exercised over HTTP, which is the surface this issue owns.

### Falsification

Every rule was broken and its test watched go red, then restored:

| Break | Went red |
| --- | --- |
| `stage=`'s empty element stops meaning "unstaged" | 3 — two in `board-query.test.ts`, one parity row |
| the coupling ignores `kanban.status` and always writes `open` | 6 in `kanban.test.ts` |
| the board's scope stops forcing `includeArchived` | 3 (incl. "keeps an archived document in the kanban") |
| the default-open clears produce no file writes | 2 (both "same commit" cases) |
| `SCHEMA_VERSION` stays at 20 | 1 — the 20 → 21 upgrade case |
| `readLastActors` answers the default instead of reading git | 2, incl. the rebuild case |
| `unset` silently does nothing | 1 |
| the coupling reads the **stored** row instead of the speculative one | 1 on update, 2 on create |
| `stage` leaves the shared filter builder | 1 — the direct `GET /api/search?stage=` assertion |

**The speculative row found a real test gap.** Removing
`withSpeculativeDocumentRow` from the *update* path first broke **nothing** — none
of the original cases used a board whose own scope named a stage. The gap is now
closed by "asks the scope about the stage this write is landing, not the one it is
leaving", which fails without it in both directions.

**The parity table cannot prove a filter narrows.** Adding `stage` rows to
`search.test.ts`'s parity table and then disabling the filter entirely left all 66
tests green: the table compares the two endpoints against each other, not against
the truth. A direct assertion (`narrows by \`stage\`…`) was added, and it does go
red.

### Tests

`VITEST_MAX_THREADS=4 vitest run apps/server` → **4426 passed, 1 failed**.
`vitest run packages/contract` → **2830 passed**. Typecheck clean over
`apps/server` (excluding `folders/acts.test.ts`, which is SERVER-136's, running in
the same tree). ESLint and Prettier clean on every touched file.

The one failure is **not this issue's and predates it**:
`queue/project.test.ts > covers every key the contract says a queue transition
emits` — CONTRACT-074 published a `reflect` query key whose description claims a
queue transition emits it, and no server emitter does yet. That is SERVER-137's.

---

**server-dev, 2026-08-23, on opus — PR #58, the coupling now says what §5 says,
and the comments cite only what §5 contains.**

**The finding.** `docs/kanban.ts` carried three rules that appear nowhere in
SPEC.md, and its comments **quoted them as "§5's edge case says…"** — verbatim
quotes of text the spec does not hold. The signed rider's whole sentence on this
is:

> a stage the board maps to a status writes that status on entry, and a stage
> with no mapping writes `open`

It draws its line at the **map**. It says nothing about the `stages` list, about
archived boards, or about clearing.

**What changed.**

1. **A stage the deciding board does not draw now writes `open`** and is named in
   the response, like any other unmapped stage. It used to write nothing and say
   nothing. `StageCoupling.status` is therefore `DocStatus`, never `null` — a
   board that claims the document always decides, and "no board claimed it" stays
   the one silence (`decideStageStatus` returning `null`).
2. **Clearing is not a rule of its own.** A cleared stage is in no `status` map,
   so the same sentence covers it. The code says so instead of citing an "edge
   case".
3. **An archived board still decides nothing** — kept, because a board nobody can
   see deciding a status is a change with no visible cause — but it is now cited
   as **SERVER-138's** rule, not §5's. The same correction was applied to the two
   other silences this module fills: the deciding order (lowest `order`, nulls
   last, then `title`, then `id`) and the carve-out for a document whose root
   fixes its status (an archived skill under `.claude/skills-archived/`, §7).

**Every false citation in the file, corrected:**

| Line | Claimed | Truth |
| --- | --- | --- |
| `StageCoupling` doc | §5 leaves an undrawn stage alone | not in §5 — rule removed |
| `stageKanbanBoards` doc | §5's edge case: an archived board "no longer decides anything" | not in §5 — recited as SERVER-138 |
| `stageKanbanBoards` doc | §5 makes "the one with the lowest `order` decides" | not in §5 — recited as SERVER-138 |
| `decideStageStatus` doc | §5's edge case makes `stage: null` the unmapped case | not in §5 — it follows from the rider's own sentence |
| `decideStageStatus` body | §5's edge case for an undrawn stage | not in §5 — rule removed |
| `boardScopeQuery` doc | §10 promises "an unknown key degrades in the client, never on the wire" | **no such sentence anywhere in SPEC.md** — the reasoning stands on its own and is now stated as this module's |
| `stageStatusWarning` **warning text** | "the board with the lowest `order` decides (SPEC.md §5)" | citation dropped from the user-visible string |

**The warning now says which outcome happened**, because they are two different
facts for the person reading it. A message claiming the map decided, when the map
holds no such stage, would send somebody looking for an entry that is not there.

**E2E, real server on port 8766**, kanban `K` over `stage` with
`stages: [triage, done]`, `status: {done: resolved}`, scoped to `folder: inbox`;
`Stray` created `status: resolved`.

| `PUT /api/docs/<id>` | file | warning |
| --- | --- | --- |
| `{"stage":"elsewhere"}` (undrawn) | `-status: resolved` `+status: open` `+stage: elsewhere`, **one** commit `doc edit: Stray (doc_g6g3jcem) by user` | ``stage `elsewhere` set status to `open`: this document is in the kanban K (doc_6j6skvpp), which maps no status to that stage, and a stage with no mapping is `open` (SPEC.md §5). It also matches K (doc_ylnxdxt5); the board with the lowest `order` decides.`` |
| `{"stage":"done"}` (mapped) | `status: resolved` | ``…whose `kanban.status` map decides a status on entry (SPEC.md §5).`` |
| `{"stage":null}` (cleared) | `status: open` | ``stage cleared set status to `open`: …and a document in a kanban with no stage has no mapping, so `open` (SPEC.md §5).`` |

Each message cites §5 for exactly the sentence §5 contains, and for nothing else.

**Falsification** (`docs/kanban.test.ts`, 24 tests):

| Break | Went red |
| --- | --- |
| the undrawn-stage carve-out put back (writes `null`) | 1 — "writes `open` for a stage the deciding board does not even draw" |
| the warning always says the map decided | 2 — both unmapped cases |

**Routed elsewhere, not fixed here** (this session is scoped to `apps/server`):
`packages/contract/src/schemas/warning.ts`'s `stage_status` description still
ends "Silent … when the stage is one the deciding board does not draw — that last
one writes no status either", which is now false on the wire; `apps/ui/e2e/stubCorpus.ts`
mirrors the removed carve-out in its fake coupling. UI-152's **stray-stage count**
is unaffected — it counts documents in scope whose stage the board does not list,
which is a fact about `stage` and not about `status`.


## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [x] `/audit` run (P0, cross-domain)
- [x] `/evaluate` passes
- [x] Committed with `[SERVER-138]` prefix
