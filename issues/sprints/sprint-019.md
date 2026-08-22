# Sprint 019 — Retrieval Phase A: the agent stops enumerating

**Issues**: SHARED-006 (kickoff commit, orchestrator-owned) · CONTRACT-022 · SERVER-040 · SERVER-041 ·
CLI-019 · AGENT-008
**Domains**: contract, server, cli, agent-runtime
**Branch**: the Phase 7 branch (`phase-7-*`), orchestrator-owned
**Date**: 2026-07-31
**Test numbering**: continues the ladder from sprint-018's `TEST-656`; this sprint runs
`TEST-657`–`TEST-732`.

---

## What this wave is

One feature, split five ways, and it is the first wave in this repository where **the five issues are
a chain, not a batch**. CONTRACT-022 freezes shapes that three phases will live inside; SERVER-040
and SERVER-041 fill them; CLI-019 renders them into the agent's one-line-per-hit surface;
AGENT-008 writes the rules that make the agent use it. Nothing downstream can start on a guess.

The product claim being built is §1's new sentence: **the agent retrieves; it never enumerates.**
Today it does the opposite, in writing — `comment/SKILL.md:74-77` explicitly licenses reading
`data/docs/` off the disk to "survey which folders exist", and `comment/SKILL.md:198` *directs* it.
Those two paragraphs are the shipped behavior this wave replaces, and AGENT-008 is not decoration on
top of four backend issues: it is the only issue here that changes what the product actually does.

**The bar for Phase A is not "search works" — it is "search is frugal, and the frugality is
provable".** A `GET /api/search` that returns document rows is `GET /api/docs?q=&sort=relevance`,
which already ships (`apps/server/src/docs/query.ts:287-288`). The whole reason a second endpoint
exists is the output contract: id + heading path + one-line snippet, never a body. Every issue below
carries at least one test that fails if a body leaks.

**The second bar is the shape freeze.** Phase B upgrades ranking *in place* with an unchanged
response shape — that was the signed drafting decision, and it is the thing that stops the retrieval
track from needing a migration in six weeks. CONTRACT-022's shapes are load-bearing for CONTRACT-023,
CONTRACT-024, UI-025 and UI-026, none of which exist yet to complain.

---

## Premise corrections — what the pre-flight found

Verified against the tree at contract time (2026-07-31), read-only. **Nine of the issue files'
factual premises are wrong or incomplete.** They are corrected here once; the acceptance tests below
are written against the corrected facts, not the issue text.

### C1 — SERVER-040: bm25 ranking, FTS snippets and the filter builder already ship

The issue reads as though lexical ranking is being built. It is not.

| Fact                                                                                                                   | Evidence                                              |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `ORDER_BY.relevance` is `m.rank ASC, d.id ASC` — "FTS5 `rank` is a bm25 score: more negative is a better match"          | `apps/server/src/docs/query.ts:287-288`                |
| The FTS hit CTE with per-document `MIN(rank)` and `snippet()` on columns 3/4                                             | `apps/server/src/docs/query.ts:381-391`                |
| `sort=relevance` is a shipped, tested `/api/docs` mode; it 400s without `q` via a contract refinement                    | `packages/contract/src/schemas/query.ts:224-227`; `apps/server/src/docs/fts.test.ts:202-203` |
| `compileFilters(query, nowMs)` is **already** a standalone pure function returning `{conditions, binder, match, …}` — no request object, no pagination, no ordering, no row mapping | `apps/server/src/docs/query.ts:146`                    |

So SERVER-040's genuinely new work is **three things**: the frugal hit shape, heading-path
derivation, and the route. "Extract the shared filter builder" means *export or relocate*
`compileFilters` — a moderate refactor, not a rewrite. Reinventing bm25 beside the shipped one is a
fail (TEST-672).

### C2 — SERVER-040: the FTS `search` table is a plain fts5 table that **stores the body text**

```sql
CREATE VIRTUAL TABLE search USING fts5(
  ref UNINDEXED, kind UNINDEXED, doc_id UNINDEXED, title, body,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

`apps/server/src/projection/schema.ts:242-249`. Not external-content, not contentless — deliberately
so (`schema.ts:83-88`: "the indexed text spans two source tables… which external content cannot
express"). Column order is positional and load-bearing for `snippet()`.

Two consequences the issue does not name:

1. **bm25 works** because this is a real fts5 table — the premise holds, and is already exercised.
2. The `body` column **holds the text**, so a heading-path deriver has a projection-resident source
   available and may not need a disk read at all. The issue asserts the body must be read on read.
   That is one of two options, not a fact. The implementer picks and **states which and why**
   (TEST-681) — the FTS copy is lossy by exactly two stripped control characters
   (`toIndexableText`, `apps/server/src/docs/fts.ts:53-56`) and, for threads, carries only the
   preamble; the disk copy is authoritative but costs a `readFileSync`
   (`apps/server/src/docs/read.ts:119`).

### C3 — SERVER-040: a thread's document row indexes **only its preamble**; turns are their own rows

`apps/server/src/projection/project-document.ts:389-417`: one `kind='doc'` row per document, then one
`kind='turn'` row per turn with `ref = "<docId>#<turn ts>"`. The comment at `:398-401` says why —
indexing the whole thread file too "would return two hits for one occurrence of a word".

This makes the issue's "threads: the turn's H2 is the path" **cheaper than it sounds**: a turn hit's
heading path is derivable from `ref` plus the `turns` row (`author`, `ts`) — the H2 format is pinned
in `apps/server/src/core/turns.ts:25-27` and SPEC §6. **No body read is needed for turn hits at all.**
It also opens a case the issue never mentions: a hit on a thread's *preamble* is neither a turn nor a
sectioned document body (TEST-679).

### C4 — SERVER-040: no markdown parser exists server-side, and none may be added

`remark`/`unified`/`mdast` are `apps/ui` dependencies only; `apps/server`'s dependencies are
`@corpus/contract, @hono/node-server, @hono/zod-openapi, better-sqlite3, chokidar, diff-match-patch,
hono, yaml, zod`. Zero repo-wide matches for `headingPath|heading_path|buildToc|extractHeadings`, and
the projection stores nothing heading-shaped (`PROJECTION_TABLES`, `schema.ts:47-60` — the `anchors`
table is text-quote selectors for comments, not headings). The issue's premise that heading paths
must be derived on read is **correct**.

The prior art to build on is the repo's existing line-scanner pattern:
`apps/server/src/core/code.ts` (`fencedCodeRanges`) and `apps/server/src/core/turns.ts:52-64`, which
already scans H2 turn headings while ignoring fenced code. Adding a markdown AST dependency to the
server is out of scope (Adjudication 5) — it is a packaging decision, not a search decision.

### C5 — CONTRACT-022: the docs-list query schema **cannot be shared as-is**

`DocsQuerySchema` is `PaginationQuerySchema.extend({…}).refine(…)`
(`packages/contract/src/schemas/query.ts:76` and `:224-227`). The `.refine()` makes it a `ZodEffects`,
so it has **no `.omit()`/`.pick()`** — you cannot derive a narrower search schema from the exported
symbol, and there is no intermediate bare-filters object exported today.

And it is a genuine superset: `DocsQuerySchema` carries `pinned` (`:196-208`), `sort` (`:216-223`,
including the `relevance` value) and `offset` (via `PaginationQuerySchema`, `pagination.ts:12-40`) —
**none of which appear in Edit 7's signed param list.** So "reuse the existing docs-list query schema
(shared, not copied)" is not a one-line import. See Open Conflict 3.

### C6 — CONTRACT-022: the inventory test does **not** parse SPEC.md

The issue's first acceptance criterion — "§9.2 spelling matches exactly (inventory test green)" —
describes a check that does not exist. `ENDPOINT_INVENTORY`
(`packages/contract/src/routes/inventory.ts:31-87`) is a hardcoded `"METHOD /path"` array; both tests
(`openapi.test.ts:157-159` against the in-memory document, `routes/inventory.test.ts:53-56` against
the committed `openapi.json`) compare it to the **generated routes**. Nothing anywhere reads
`SPEC.md`. §9.2 alignment is review discipline, recorded in `inventory.ts`'s module comment by
citing the amendment (`inventory.ts:9-16` is the precedent). TEST-660 and TEST-661 split the
criterion accordingly.

### C7 — SERVER-041: `links` stores dangling refs, and captures refs written inside thread turns

```sql
CREATE TABLE links (from_id TEXT NOT NULL, to_id TEXT NOT NULL, PRIMARY KEY (from_id, to_id));
```

`apps/server/src/projection/schema.ts:224-228`. A row is the pair and **nothing else** — no link
text, no position, no resolved flag. `insertLinks` (`project-document.ts:347-355`) never checks that
the target exists, and SPEC.md:155 says that is deliberate ("referencing a not-yet-created document
is legitimate"). A related query must therefore **inner-join `documents`**, or it will hand the agent
ids that 404.

`insertLinks` is called with the document body **plus every turn body**
(`project-document.ts:504-507`), so a `[[ref]]` typed in a thread reply is a `links` row keyed on the
thread's own document id. Related sets will contain threads. The issue never says what should happen
to them (TEST-691).

There is also **no existing backlinks module** to model on: the §10 panel is the general collection
query's `references=` filter (`query.ts:207-211`, consumed at
`apps/ui/src/reader/Backlinks.tsx:1-16`). Forward links have no query filter at all today.

### C8 — SERVER-041: the excerpt source is not "the opening body line"

`bodyExcerpt` (`apps/server/src/projection/project-document.ts:209-218`) is **the first 280
characters from the first non-blank character** — it spans lines, cuts mid-sentence, and strips no
markdown whatsoever. It is already computed and stored as `documents.body_excerpt`
(`schema.ts:152`), so no disk read is needed; but it is **not** a line, and the contract's own field
description ("Leading plain-text excerpt of the body", `packages/contract/src/schemas/doc.ts:214`) is
already generous about it. Edit 8 promises "a one-line excerpt". Deriving one is small, new work
(TEST-692).

### C9 — CLI-019: the list output is **padded columns, not tab-separated**

`renderRows` (`apps/cli/src/commands/doc/list.ts:141-161`) pads each cell with `padEnd` and joins
with **two literal spaces**, last column left ragged. The asserted output
(`list.test.ts:46-74`) is:

```
doc_a1b2c3  note   open      Mortgage options  data/docs/finance/mortgage-options.md
doc_zz      skill  archived  Weekly review     .claude/skills/weekly-review/SKILL.md
showing 1–2 of 2 documents
```

The issue's criterion — "fields tab-separated **in the existing list-output style**" — names two
mutually exclusive things. Since AGENT-008 depends on this being a stable parse target, it is
escalated rather than guessed: **Open Conflict 1.**

### C10 — CLI-019: the filter flags are **not** a single definition site today

`doc list`'s nineteen filter flags are inline object literals in the command spec
(`apps/cli/src/commands/doc/list.ts:206-332`). There is no exported `DOC_LIST_FLAGS`. Only the
cross-cutting flags are shared (`GLOBAL_FLAGS`, `apps/cli/src/registry/globals.ts:9-53`) — `--json`
among them, which is why `list.test.ts:306` asserts `doc list` declares no `json` flag of its own.
The helpers a second command would otherwise duplicate — `collectQuery` (`list.ts:78-124`) and the
enum validator `oneOf` (`list.ts:126-139`) — are local and unexported. The extraction the issue
assumes has already happened is the work (TEST-701).

### C11 — AGENT-008: the "subagent-dispatch brief template" does not exist

Zero matches for `template|brief` in either skill. What exists is prose:
`orchestrate/SKILL.md:148-156` says what the subagent's prompt must carry, and `:171-186` is the
"every invariant binds inside the subagent" bullet list. Those are the two edit sites (TEST-715). The
N=10 rule the issue tells the agent to weave into lives at `orchestrate/SKILL.md:229-233`.

### C12 — AGENT-008: `format:check` does not police these files

`.prettierignore` excludes `assets/workspace/` with a stated rationale ("its bytes are what
`corpus init` installs… Prettier must never rewrap or re-mark it"). The issue's Testing Strategy
names `npm run format:check` on the touched files; it is a no-op. And
`apps/cli/src/commands/init/scaffold.test.ts:76-90` is a **copy-fidelity** test (byte equality
between source and installed), not a content test — it will not notice a wrong rule.

**The real gate is one nobody named**: `scripts/workspace-template.test.ts:1132` resolves *every*
`corpus …` invocation in the whole template tree against `docs/cli.md`'s command headings
(`scripts/workspace-template.ts:211-270`). The moment a skill says `corpus search`, the suite goes
red until CLI-019's regenerated `docs/cli.md` is on the branch. The allowlist that could paper over
it (`CLI_COMMANDS_PENDING_CLI_006`, `workspace-template.ts:239`) is **empty by design** and stays
empty (Adjudication 8). This makes AGENT-008 ⇄ CLI-019 a build-breaking ordering constraint, not a
soft dependency.

### C13 — the read verb is `corpus doc show`, not `corpus doc get`

`apps/cli/src/commands/doc/index.ts:41-49` and `docs/cli.md:646`. There is no `doc get`. Every
skill, test and log line in this wave says `corpus doc show`.

### C14 — none of this exists yet, anywhere

`/usr/bin/grep -rn` for `corpus search`, `doc related`, `/api/search` across `apps packages plugins
assets scripts docs` returns **nothing**. No collisions, no dead code, no half-built prior attempt —
and `docs/cli.md` documents neither verb, which is what makes C12 bite.

---

## Machine rules — binding on every agent in this batch

### Ports

Probed at contract time (2026-07-31, `lsof -nP -iTCP:<port> -sTCP:LISTEN`): `8804`–`8810` and
`5282`–`5286` are all **free**. `5173` is bound by `ssh` (pid 16094).

**`8765` was free at probe time — and that changes nothing.** The maintainer's live server respawns;
the standing directive (2026-07-29, carried through sprints 015–018) is that `8765` is **never bound,
never killed, and never proxied into, by anyone, for any reason.** It reads as free precisely when it
is most tempting to take. `corpus init` with no `--port` probes upward from `DEFAULT_PORT` 8765
(`apps/cli/src/commands/init/port.ts`), so **every `corpus init` in this sprint passes `--port`
explicitly**, including runs expected to fail.

| Consumer             | Server range  | Primary | Vite dev port |
| -------------------- | ------------- | ------- | ------------- |
| CONTRACT-022         | —             | —       | —             |
| SERVER-040           | `8804`–`8805` | `8804`  | —             |
| SERVER-041           | `8806`–`8807` | `8806`  | —             |
| CLI-019              | `8808`        | `8808`  | —             |
| AGENT-008            | `8809`        | `8809`  | —             |
| sprint-019 evaluator | `8810`        | `8810`  | `5282`        |
| Automated tests, every workspace | — | `0` (ephemeral). **Never hardcode.** | — |

CONTRACT-022 needs no port: its verification is `npm run build`, the generator, and the drift check.

**No issue in this batch starts a Vite dev server or runs `npm run e2e`.** There is no UI work here,
which retires this sprint's biggest historical hazard — the `CORPUS_SERVER_ORIGIN` proxy default at
`apps/ui/vite.config.ts:14` that has twice pointed agent writes at the maintainer's corpus. Should an
agent believe it needs a browser, it stops and asks rather than starting one.

### Scratch directories

All scratch lives under `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp` — **never bare `/tmp`**,
**never inside the repository**.

| Issue        | Prefix                                                                    |
| ------------ | ------------------------------------------------------------------------- |
| CONTRACT-022 | `mkdir -p …/tmp/s019-contract && mktemp -d …/tmp/s019-contract/022-XXXXXX` |
| SERVER-040   | `mkdir -p …/tmp/s019-server && mktemp -d …/tmp/s019-server/040-XXXXXX`     |
| SERVER-041   | `mkdir -p …/tmp/s019-server && mktemp -d …/tmp/s019-server/041-XXXXXX`     |
| CLI-019      | `mkdir -p …/tmp/s019-cli && mktemp -d …/tmp/s019-cli/019-XXXXXX`           |
| AGENT-008    | `mkdir -p …/tmp/s019-agent && mktemp -d …/tmp/s019-agent/008-XXXXXX`       |
| evaluator    | `mkdir -p …/tmp/s019-eval && mktemp -d …/tmp/s019-eval/XXXXXX`             |

(`…` is `/Users/theophanerupin/.claude/jobs/4dd0ddef`.) **`s019-server` is shared by two agents** —
so the standing rule is load-bearing again: **never glob-delete a prefix.** Delete only paths you
created and captured in a variable. Automated tests use `fs.mkdtemp`/`mkdtempSync`, never these paths.

### Workspace creation — the subshell-cd rule still applies

```sh
# Preferred — the subshell cd is what makes the target real
( cd "$WS" && node --import tsx "$REPO/apps/cli/src/bin/corpus.ts" init --port 8804 )

# Legal since CLI-013, but only from a cwd outside this repository
corpus init --workspace "$WS" --port 8804
```

- **Every drill runs from a cwd OUTSIDE this repository.** `cd` to your scratch directory first and
  `pwd` into the log. The 2026-07-29 CLI-014 drill got this wrong and clobbered the repo's
  `README.md` and `.gitignore` irrecoverably.
- **Verify `/Users/theophanerupin/code/corpus/.corpus` is absent** at the end of your session and
  paste the check (TEST-728). Confirmed absent at contract time.
- From-source CLI is `node --import tsx apps/cli/src/bin/corpus.ts`, or built
  `apps/cli/dist/bin/corpus.js` after `npm run build` — **never `npx`** (rtk rewrites it).

### Process cleanup — pid-targeted only

`pkill -f main.ts`, `pkill -f tsx`, `pkill node`, `killall node` kill sibling agents' servers and the
maintainer's — **forbidden.** Stop what you started, by recorded pid, and verify with
`lsof -nP -iTCP:<port> -sTCP:LISTEN` before declaring done.

### Tests and load

- **Scoped tests only**: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run <path>`. Never the
  repo-wide suite, never `npm test` unfiltered, never `npm run coverage`, `npm run test:coverage`, or
  `npm run e2e`. The orchestrator's harvest run is the single repo-wide gate.
- **One workspace-scoped run at the very end of your session is the maximum.**
- **One heavy command at a time** — never overlap builds, test runs, or `npm install`. **No issue in
  this batch has any reason to run `npm install`**; one that thinks it does has probably decided to
  add a markdown parser to the server (Adjudication 5) and should escalate instead.
- **Three concurrent implementation agents maximum** — and the dependency chain means the real
  ceiling is two (SERVER-040 ∥ SERVER-041).
- `npm run build` before lint/typecheck/test — `@corpus/*` imports resolve through `dist/`.

### Grep, and why this rule exists

**Use `/usr/bin/grep` for any grep-based evidence.** The `rtk` proxy has produced **false negatives**.
Every "X does not appear anywhere" claim must come from `/usr/bin/grep` with the command pasted.
AGENT-008's TEST-721 is entirely such claims.

### Deferred verification is recorded, not skipped

Any criterion that cannot be executed is marked `STRUCK → Open Conflict N`,
`STRUCK → Adjudication N`, or `DEFERRED → <reason>` in the E2E Verification Log, **with the reason
and the substitute evidence supplied**. Silent omission is a fail. Each agent also states
`implemented on: opus | fable` per CLAUDE.md's Record-actuals rule.

---

## Acceptance Tests

### Kickoff: SHARED-006's amendment (orchestrator-owned, before any agent starts)

SPEC.md carries **none** of this text today — verified at contract time: no "Retrieval discipline",
no `/api/search`, no "retrieves; it never enumerates". Every issue below cites spec sections that do
not yet exist, so the kickoff commit is a hard gate, not a formality.

TEST-657: The four Phase A edits are applied verbatim, at their named anchors
  Given: the phase branch, before any implementation commit
  When: `SPEC.md` is diffed against `main`
  Then: **Edit 1** inserted after the "agent is its steward" bullet (`SPEC.md:16`); **Edit 4**
  inserted between `SPEC.md:271` and `:273` — after "The stewardship rules live in the skills…",
  before "**Skills and agent definitions are documents.**"; **Edit 7** after the `GET /api/docs`
  bullet (`SPEC.md:314`); **Edit 8** after the `GET /api/docs/:id` bullet (`SPEC.md:316`). Text
  matches the draft **character for character** — the draft is what the user signed, and the four
  blocks are quoted verbatim in three issue files.

TEST-658: The Phase B/C edits are handled deliberately, and the decision is recorded
  Given: the sign-off record reads "Approve all 13", while only Edits 1/4/7/8 bind Phase A
  When: the kickoff commit is composed
  Then: the orchestrator applies all thirteen (Open Conflict 4's recommended default) or names which
  it held back and why, **in SHARED-006's issue file**. Either way, every added sentence carries its
  `_(Retrieval Phase A|B|C)_` tag — that tagging convention is the whole reason the amendment can
  land ahead of the code, and an untagged Phase B sentence is a spec that lies about what ships.

TEST-659: SHARED-006 closes only when the applied text matches the draft
  Given: the issue's own closing condition ("This issue closes when the applied text matches the
  draft")
  When: the kickoff commit lands
  Then: SHARED-006 is marked `done` in both the issue file and `issues/PLAN.md`, with the commit
  hash recorded. No agent is spawned before this is true — CONTRACT-022's, SERVER-040's,
  SERVER-041's, CLI-019's and AGENT-008's Spec References all point at text that would otherwise not
  exist.

---

### CONTRACT-022: two routes, and shapes that three phases have to live inside

`packages/contract/src/routes/` + `src/schemas/query.ts`, regenerated artifacts. Model: **opus**.
No port. Spec: §9.2 Edits 7 and 8, §7 Edit 4.

This is the issue with the longest shadow and the shortest diff. Read C5 and C6 before starting: the
schema you were told to reuse cannot be reused as written, and the test you were told would enforce
§9.2 does not read §9.2.

TEST-660: Both routes are declared and the inventory equality holds
  Given: `ENDPOINT_INVENTORY` (`routes/inventory.ts:31-87`) and the two tests that compare it to the
  generated document (`openapi.test.ts:157-159`) and to the committed `openapi.json`
  (`routes/inventory.test.ts:53-56`)
  Then: `"GET /api/search"` and `"GET /api/docs/{id}/related"` are added, both tests green, and the
  `inventory.ts` module comment records the provenance the way every prior addition did
  (`inventory.ts:9-16` cites amendment ids and sign-off records) — here, SHARED-006 Edits 7 and 8,
  signed 2026-07-30.

TEST-661: §9.2 alignment is asserted by a person, because no test does it
  Given: **nothing in the repository parses `SPEC.md`** (C6)
  When: the agent verifies its criterion "§9.2 spelling matches exactly"
  Then: the E2E log **states that finding**, then pastes the two applied §9.2 bullets beside the two
  route definitions and walks the param lists item by item. The issue's criterion is not satisfiable
  by a green suite and the log must not imply otherwise.

TEST-662: The search query carries exactly the signed param set — and three params it must not
  Given: Edit 7's signed string: `q, type, status, includeArchived, tag, folder, parent, references,
  agent, author, since, due, stale, unread, needs, limit`
  Then: `q` is **required** (missing → 400). All fifteen filters present with `GET /api/docs`
  semantics. **`pinned`, `sort` and `offset` are absent** — they are on `DocsQuerySchema`
  (`query.ts:196-208`, `:216-223`, `pagination.ts:12-40`) and not on the signed bullet. What a
  request carrying `sort=relevance&offset=10` to `/api/search` actually does (rejected vs. silently
  ignored by Zod stripping) is **observed, stated once, and tested** — an agent that passes it and
  gets silence deserves to have been told.

TEST-663: The filters are shared, not copied — one definition site, provably
  Given: `DocsQuerySchema` is a `ZodEffects` (`.refine()`, `query.ts:224-227`) with no `.omit()`
  (C5)
  Then: a single base filter object is the source for both schemas, and a test proves it: adding a
  filter to the base makes it appear on **both** `/api/docs` and `/api/search` with no second edit.
  Two hand-maintained lists that must agree is the exact drift the criterion exists to prevent.

TEST-664: `/api/docs` is behaviorally unchanged by the extraction
  Given: the refactor touches a schema the UI and CLI both consume
  When: the shipped docs-list suites run, **unmodified**
  Then: `apps/server/src/docs/query.test.ts`, `routes.test.ts` and `fts.test.ts` are green with no
  assertion edited; `sort=relevance` without `q` still 400s (`query.ts:224-227`); `pinned`, `sort`
  and `offset` still work. A weakened or deleted assertion here is a fail, not a cleanup.

TEST-665: The search hit shape is frugal by construction
  Given: Edit 7 — "the document id, title, the heading path of the best-matching passage…, and a
  one-line snippet — **never a body**"
  Then: the hit schema has exactly those four fields (plus a rank/score only if the agent justifies
  it in writing). There is **no body field, no excerpt field, no segments array**. Round-trip parse
  tests for a document hit and a turn hit.

TEST-666: The response envelope carries the semantic-state seam, optional and documented
  Given: the signed freeze — Phase B is additive-only
  Then: the envelope carries an optional semantic-state field, absent-or-`current` in Phase A,
  documented in the route description as §9.1's Phase B seam. A Phase-A response omitting it parses;
  a future response carrying a not-yet-current value parses **without a shape change**. Its exact
  name is recorded in CONTRACT-022's issue file, because CLI-019 (TEST-705) and CLI-020 both key off
  it. Note the envelope cannot reuse `DocListSchema`'s `{items, page}` (`query.ts:381-383`) as-is:
  with no `offset`, `PageMetaSchema`'s `{total, limit, offset}` (`pagination.ts:42-48`) describes
  paging that does not exist.

TEST-667: The related row shape is frozen with the full relation enum today
  Then: row = id, title, one-line excerpt, `relation ∈ {linked, similar, both}`. `similar` and
  `both` parse now though Phase A never produces them — that is the shape freeze, and a Phase B
  enum widening would be exactly the migration the drafting decision was signed to avoid.

TEST-668: The related route reuses the shipped param and error vocabulary
  Then: query params are `limit` and `includeArchived` **only** (Edit 8); the path param reuses
  `DocIdParamSchema` (`routes/docs.ts:23-25`); the 404 is `NOT_FOUND_RESPONSE` /
  `NotFoundErrorSchema` — `{code: "not_found", message}` (`schemas/error.ts:50-52`,
  `routes/responses.ts:56`). No new error shape is invented for a read-only route.

TEST-669: Generated artifacts regenerate to a no-op
  Then: `npm run generate -w packages/contract` rewrites `openapi.json` and
  `src/client/schema.generated.ts`, both committed (both are tracked, not gitignored), and
  `node --import tsx scripts/check-generated-artifacts.ts` is green. Neither is ever hand-edited.

TEST-670: Registration placement is deliberate, not incidental
  Given: `routes/index.ts:63-70` documents that registration order is load-bearing where a static
  segment competes with a path param
  Then: `GET /api/docs/{id}/related` is placed with that comment consulted, and a real request to
  `/api/docs/<id>/related` reaches the related route rather than being swallowed by `/api/docs/{id}`.
  Verified over HTTP once SERVER-041 lands, not asserted from reading.

TEST-671: The search `limit` cap is a decision with a reason
  Given: the list convention is `DEFAULT_PAGE_LIMIT = 50` / `MAX_PAGE_LIMIT = 200`
  (`pagination.ts:3-4`), while Edit 7 says "token-frugal by contract" and SERVER-040's issue says
  "cap `limit` sanely"
  Then: the chosen default and maximum are enforced by the schema and **recorded in the issue file
  with the rejected alternative**. Inheriting 200 silently is not a decision; 200 one-line hits is a
  page of text the agent did not ask for.

---

### SERVER-040: ranked retrieval that costs what the answer costs

`apps/server/src/search/` (new) + the `compileFilters` extraction in `apps/server/src/docs/query.ts`.
Model: **opus**. Port `8804`. Spec: §9.2 Edit 7, §7 Edit 4.

Read C1–C4 first. Ranking, FTS snippets and the filter builder already ship; the new work is the
frugal shape, the heading path, and the route.

TEST-672: Ranking is the shipped bm25 path, reused rather than reinvented
  Given: `ORDER_BY.relevance` (`query.ts:287-288`) and `HITS_CTE` (`query.ts:381-391`)
  Then: the search query composes the same `search MATCH @q` → `rank` machinery. There is **no
  second bm25 implementation** in the tree — `/usr/bin/grep -rn "bm25\|rank" apps/server/src` shows
  one ranking source, pasted. The `MATERIALIZED` hint is preserved with its reason intact
  (`query.ts:376-380`: without it "the statement fails to run at all") — a search query that drops
  it fails loudly, and one that copies it without understanding why will drop it later.

TEST-673: One hit per document, ranked by its best-matching passage
  Given: a document whose title, body and three turns all match `q`
  When: `GET /api/search?q=…`
  Then: **exactly one hit** for that document, ranked by `MIN(rank)` across its rows (`query.ts:388`)
  — the same aggregate the list uses. Ordering is deterministic and ends in `id ASC`, the convention
  every `ORDER_BY` entry follows (`query.ts:272-289`, "so paging over ties is stable").

TEST-674: Filters compose through one predicate builder, and a parity table proves it
  Given: `compileFilters` (`query.ts:146`) exported or relocated, called by both paths
  When: each of the fifteen filters is exercised against the same seeded corpus, once through
  `GET /api/docs?q=…` and once through `GET /api/search?q=…`
  Then: the **document id sets are identical**, filter by filter, in a table pasted into the log.
  This is the criterion's real content — "a filter added later cannot diverge" is only true if there
  is one builder, and only provable if the two endpoints are compared on every filter, not on one.

TEST-675: The archived rule is the list's rule, including the no-op case
  Given: `query.ts:159-182` — explicit `status` **replaces** the default; `includeArchived=true`
  widens; otherwise `d.status <> 'archived'`
  Then: all three behave identically on `/api/search`, and `includeArchived` alongside an explicit
  `status` is the same documented no-op it is on the list.

TEST-676: A hit in a nested section reports the full heading path
  Given: a document with `# A` → `## B` → `### C` and the match under `C`
  Then: the path names all three, in order, with a separator chosen once and used everywhere
  (stated in the issue file). Verified against the file on disk, pasted.

TEST-677: A hit with no heading above it reports the document title
  Then: path = title — the issue's own rule, and the reason a hit always has an address.

TEST-678: A turn hit's path is the turn heading, derived without reading anything
  Given: turn rows are keyed `ref = "<docId>#<ts>"`, `kind='turn'` (`project-document.ts:415`), and
  `turns` carries `author`/`ts`; the H2 format is pinned at `core/turns.ts:25-27` and SPEC §6
  Then: the path is the turn's `## <author> · <ts>` heading, built from `ref` + the `turns` row —
  **no file read for turn hits at all**, stated in the log. The middle dot is U+00B7 (`turns.ts:12-19`).

TEST-679: A thread preamble hit is neither a turn nor a document section
  Given: a thread's `kind='doc'` row indexes **only its preamble** (`project-document.ts:398-413`)
  Then: a hit there reports the thread's title as its path and does not claim a turn's text, nor
  walk headings that are not in the preamble. The case is named in the log — it is the one the issue
  does not mention and the one a naive implementation gets silently wrong.

TEST-680: Headings inside fenced code are not headings
  Given: `core/code.ts`'s `fencedCodeRanges`, already used for exactly this by `core/turns.ts:52-64`
  Then: a match under a real `## Rates` heading, with a ```` ```md ```` block containing `# Fake`
  above it, reports `Rates`. Reusing the existing scanner rather than a fresh regex is the point.

TEST-681: Derivation is bounded to top-k, and the body's source is a stated decision
  Given: two available sources (C2) — the standalone fts5 table's stored `body` column
  (`schema.ts:242-249`, lossy by two stripped control characters, `fts.ts:53-56`) or the
  authoritative file via `readFileSync` (`docs/read.ts:119`)
  Then: the implementer **names which it used and why** in the issue file, and a test over a corpus
  of ≥ 50 documents with `limit=5` proves the cost is O(k), not O(N) — by counting reads (or
  materializations), not by timing. "Only top-k bodies are read" is the criterion; a number is the
  evidence.

TEST-682: The snippet is one line, plain text, and carries no FTS control characters
  Given: `snippet()` marks hits with U+0002/U+0003 (`fts.ts:32-34`) and the shipped wire shape is a
  `Snippet[]` of `{text, match}` segments (`fts.ts:117,175`) — a **different** shape from Edit 7's
  one-line snippet
  Then: the hit's snippet is a single-line string containing **no U+0002, no U+0003, no `\n`** —
  asserted by code-point check, not by looking at it. A control character reaching the CLI's
  one-line output is the failure this test exists for.

TEST-683: `q` is required, and the shipped FTS grammar is the grammar
  Then: missing `q` → 400 from the schema. A `q` that tokenizes to nothing (`"***"`) behaves as the
  list already does (`query.test.ts:358` is the precedent) — an empty result, never a 500. The
  `MAX_QUERY_TOKENS = 24` cap (`fts.ts:65`) applies unchanged.

TEST-684: Never a body, and the response size proves it
  Given: a workspace holding a 50 KB document that matches
  Then: no response field carries a body or a 280-character excerpt, and the whole `limit=10`
  response stays under a stated byte budget. Pasted, with the byte count.

TEST-685: The semantic-state field is inert
  Then: `current` or absent per the frozen contract, with **no Phase B machinery** behind it — no
  staleness computation, no index table, no provider identity. Phase B is SERVER-044's.

TEST-686: Real server, real corpus, real curl
  Given: a seeded workspace outside this repository, server on `8804`
  Then: `curl /api/search?q=…` returns ranked frugal hits; a nested-section hit's path is verified
  against the file on disk and both are pasted; a turn hit's path is verified against the thread
  file's H2.

---

### SERVER-041: expansion from a known document, through the only graph there is

`apps/server/src/docs/related.ts` (new), mounted as a projection read. Model: **opus**. Port `8806`.
Spec: §9.2 Edit 8, §7 Edit 4.

Read C7 and C8. The `links` table is two columns; it stores refs to documents that do not exist; and
it captures refs written inside thread turns.

TEST-687: Outgoing, incoming and mutual all surface
  Given: a fixture graph — `A → B`, `C → A`, `A ↔ D`, plus an orphan `E`
  When: `GET /api/docs/A/related`
  Then: `B` (outgoing), `C` (incoming) and `D` (mutual) appear; `E` does not.

TEST-688: Mutual ranks first, and the order is deterministic
  Then: `D` outranks `B` and `C`; ties break by recency then `id ASC`, following the convention every
  shipped ordering uses (`query.ts:272-289`). The same request twice returns the same order, proved
  by two calls, not by reading the SQL.

TEST-689: A dangling ref is never handed to the agent
  Given: `links` stores refs to non-existent documents by design (`project-document.ts:347-355`, no
  FK, no existence check; SPEC.md:155 — "referencing a not-yet-created document is legitimate")
  When: `A` contains `[[doc_nope]]`
  Then: no row for `doc_nope`. An id the agent cannot then `corpus doc show` is worse than no row.

TEST-690: A document is never related to itself
  Given: a document containing a `[[ref]]` to its own id
  Then: it does not appear in its own related set.

TEST-691: Thread neighbours are a decision, not an accident
  Given: `insertLinks` scans the body **plus every turn body** (`project-document.ts:504-507`), so a
  `[[ref]]` typed in a reply is a `links` row keyed on the thread's document id
  When: a thread references `A`
  Then: whether that thread appears in `A`'s related set is **stated and tested** either way, with
  the reasoning in the issue file. Edit 8 says "the documents most related to this one"; a thread is
  a document (§6). What is not acceptable is the behavior existing without anyone having decided it.

TEST-692: The excerpt is one line, from the projection, and is not `body_excerpt` verbatim
  Given: `bodyExcerpt` is 280 characters from the first non-blank character, spanning lines and
  stripping no markdown (`project-document.ts:209-218`), already stored as `documents.body_excerpt`
  Then: the row's excerpt is a **single line** derived from that column — newline-collapsed, bounded,
  no disk read, no body. The 280-character multi-line slice is not "a one-line excerpt" and shipping
  it as one is the failure mode this test names.

TEST-693: Archived neighbours are excluded by default and lifted by the flag
  Given: `notArchivedSql` (`query.ts:129-181`)
  Then: an archived neighbour is absent by default, present with `includeArchived=true` — the same
  rule as every list, using the same fragment rather than a second copy of it.

TEST-694: Unknown id → the shipped 404
  Then: `{code: "not_found", message: "no document with id <id>"}` via `notFound()`
  (`apps/server/src/errors.ts:92-94`), the same shape `GET /api/docs/:id` produces
  (`docs/read.ts:109-125`). Verified over HTTP.

TEST-695: `relation` is `linked`, and only `linked`
  Then: Phase A never emits `similar` or `both`, though both parse (TEST-667). A row labelled
  `similar` in Phase A is Phase B leaking early.

TEST-696: `limit` is capped, decided, and recorded
  Then: as TEST-671 — default and maximum enforced by the schema, chosen with a reason, written down.

TEST-697: Reads only, tables only
  Given: the issue's own constraint — "reads `links` + `documents` only; no new tables"
  Then: no schema change (`PROJECTION_TABLES` unchanged), no write, no lock, no mutex; mounted
  alongside the other pure projection reads in `mountDocsRoutes` (`docs/routes.ts:36-52`), **not** in
  `write-routes.ts`. `git diff apps/server/src/projection/schema.ts` empty.

TEST-698: Real server, real graph
  Given: server on `8806`, a workspace with three linked documents and one archived neighbour
  Then: ranked rows with relation labels via curl, pasted; the archived neighbour appears only with
  the flag.

---

### CLI-019: the surface the agent actually touches

`apps/cli/src/commands/search.ts` (new), `apps/cli/src/commands/doc/related.ts` (new), a shared
filter-flag module, regenerated `docs/cli.md`. Model: **opus**. Port `8808`. Spec: §7 Edit 4, §9.2
Edits 7 and 8.

Read C9, C10 and C13. The output style is padded columns, not tabs; the flags are not shared yet; and
the read verb is `doc show`.

TEST-699: The output format follows Open Conflict 1's ruling, and it is a parse target
  Given: OC1 — "tab-separated" and "the existing list-output style" are mutually exclusive (C9)
  Then: the ruled format is implemented, and its stability is asserted by an exact-output test in the
  spirit of `list.test.ts:46-74`. AGENT-008's skill text quotes this format; a change to it after
  AGENT-008 lands breaks the product's own documentation.

TEST-700: One line per hit, fixed field order, nothing else
  Then: `corpus search "<q>"` prints exactly one line per hit — id, heading path, snippet (and for
  `doc related`: id, relation, excerpt) — in a stable order, no wrapping, no body, no blank lines
  between hits, no decorative header. A hit whose snippet contains a newline prints on one line
  anyway (SERVER-040 TEST-682 guarantees the field is already single-line; the CLI does not rely on
  that alone).

TEST-701: The filter flags have one definition site, and it is the search subset
  Given: today's flags are inline literals at `apps/cli/src/commands/doc/list.ts:206-332`, with
  `collectQuery` (`:78-124`) and `oneOf` (`:126-139`) local and unexported (C10)
  Then: the shared flags live in one module imported by `doc list` and `search`; `doc list`'s
  behavior is unchanged (its suite green, unmodified); and a parity test in the spirit of
  `list.test.ts:310-335` ("declares a flag for every filter it sends") covers **both** commands.
  `search` declares **no** `--pinned`, `--sort` or `--offset` — a flag the endpoint does not accept
  (TEST-662) is a fail, not a convenience.

TEST-702: `--json` is the global flag, and it mirrors the wire
  Given: `--json` is declared once in `GLOBAL_FLAGS` (`registry/globals.ts:11-16`) and implemented
  once in `Output.emit` (`output.ts:54-63`); `list.test.ts:306` asserts `doc list` declares none of
  its own
  Then: neither new command declares a `json` flag; `--json` emits the wire response **unaltered**
  (a byte comparison against the stubbed client's payload), and suppresses every human line
  (`output.ts:65-68`).

TEST-703: Empty results are honest and exit 0
  Given: the precedent — `"no documents match."` / `"no documents on this page."`
  (`list.ts:54-59`, `list.test.ts:213-231`)
  Then: an equivalent single line for each verb, exit 0, and nothing at all under `--json` beyond the
  empty envelope.

TEST-704: `doc related` on an unknown id follows the shipped error path
  Given: 404 has no special case in `hintFor` (`client.ts:225-239` handles only 401 and 423), so it
  becomes a `ServerResponseError` with **exit code 5** — the convention asserted across a dozen
  suites (`doc/unarchive.test.ts:233`, `thread/create.test.ts:247`, `client.test.ts:111-115`)
  Then: exit 5, message `404 not_found: no document with id <id>`, and `{"error": …}` on stderr under
  `--json` (`output.ts:74-79`). The one existing carve-out (`lock/break.ts:55` treating 404 as a
  benign no-op) is **not** precedent here: an unknown id is a real error for a read verb.

TEST-705: The degraded-ranking note is silent in Phase A
  Then: the note prints only when the server's semantic-state field says ranking is degraded. In
  Phase A the field is absent-or-`current` (TEST-666, TEST-685), so **nothing prints** — asserted by
  a stub returning each of: field absent, field `current`, field degraded. Only the third prints, and
  it prints to stderr or as a `#`-prefixed line so it never corrupts the parse target.

TEST-706: Registration is clean and the registry validates
  Given: the hand-rolled registry (`registry/index.ts:39-54`) and dispatcher
  (`dispatch.ts:37-68`) — no commander
  Then: `corpus search` is a top-level command; `corpus doc related` joins `docTopic.commands`
  (`commands/doc/index.ts:26-51`); `validateRegistry` is green, including its global-flag-shadowing
  check.

TEST-707: `docs/cli.md` is regenerated, never hand-edited — and this is AGENT-008's gate
  Given: `docs/cli.md` is a generated artifact (`scripts/generated-artifacts.ts:30-35`), and
  `scripts/workspace-template.ts:254-265` parses its `## `/`### ` `` `corpus …` `` headings
  Then: `npm run docs:cli -w apps/cli` produces `` ## `corpus search` `` and
  `` ### `corpus doc related` ``; the drift check
  (`node --import tsx scripts/check-generated-artifacts.ts`) is green; the file is committed with the
  CLI-019 commit. **Until this lands, AGENT-008 cannot name either verb without turning the suite
  red** (C12).

TEST-708: Thin client, no local logic
  Then: both handlers are a single `context.client.request((api) => api.GET(...))`
  (`client.ts:94-113`) plus formatting. No client-side filtering, ranking, truncation of the server's
  snippet, or re-derivation of anything — the frugality is the server's contract, and a CLI that
  trims a body the server should not have sent is hiding a SERVER-040 bug.

TEST-709: The frugal claim is measured, not asserted
  Given: a seeded workspace whose documents are ≥ 20 KB each
  When: the same query runs through `corpus search` and through `corpus doc list --q`
  Then: both outputs' byte counts are pasted, and search's is a small multiple of the number of hits
  — independent of document size. §1's new sentence is a claim about cost; this is the number that
  backs it.

TEST-710: The end-to-end retrieval-first path, walked as the agent
  Given: a workspace where the answer lives in one section of one document among many
  When: the agent runs `corpus search "<phrase>"`, reads the ranked lines, picks the winning id, and
  runs **`corpus doc show <id>`** (there is no `corpus doc get` — C13)
  Then: the transcript shows retrieval and reading as **two separate acts**: the search output
  contains no body, the `doc show` output contains the body, and nothing in between listed a
  directory or read a file. Pasted in full. This is §7's amended discipline, executed once, and it is
  the seam AGENT-008 then writes down.

TEST-711: Real server, real bin
  Given: server on `8808`, the from-source bin (`node --import tsx apps/cli/src/bin/corpus.ts`), cwd
  outside this repository
  Then: search a phrase, follow a related id, confirm the one-line-per-hit output — all pasted.

---

### AGENT-008: the rules that make the product actually retrieve

`assets/workspace/claude/skills/{orchestrate,comment}/SKILL.md`. Model: **opus**. Port `8809`.
Spec: §1 Edit 1, §7 Edit 4's three rules.

Read C11 and C12. There is no dispatch template to edit; `format:check` does not police these files;
and the real gate is the CLI-doc resolver. **Read both files end to end before touching either** —
they are 473 and 471 lines of tightly cross-referenced prose.

TEST-712: All three rules are stated in both skills, in the surrounding voice
  Given: the signed rules — search before reading, never enumerate, subagents receive anchors
  Then: both files state all three, woven into the existing sections (orchestrate's "Delegation" /
  "Stewardship"; comment's "Gather context" / "Inbox filing"), not appended as a foreign block. The
  issue's own criterion: don't bolt on a section that contradicts the surrounding flow.

TEST-713: The tree-read licence is reconciled with the rule that forbids it
  Given: `comment/SKILL.md:74-77` today reads *"**Content may be read from the tree.** Reading
  `data/docs/` markdown directly — to survey which folders exist, or to skim a neighbouring document
  — is a read, not a mutation, and it is allowed."*
  When: Edit 4's "Locating content is always a `corpus search` or `corpus doc related` call — never a
  directory listing, never a read-everything sweep" applies
  Then: that paragraph is rewritten. **Locating** goes through the verbs; if any direct read survives
  it is narrowly justified in the text itself, and Open Conflict 2 governs the folder-survey case.
  Leaving this paragraph standing while adding the rule above it ships a skill that contradicts
  itself in two screens.

TEST-714: Inbox filing no longer directs a directory sweep
  Given: `comment/SKILL.md:198` — *"Survey the folders that already exist by reading `data/docs/`…"*
  Then: replaced per Open Conflict 2's ruling. This is the single most concrete instance of the
  behavior §1 now forbids, and it is an instruction, not a permission.

TEST-715: Delegation carries anchors, and forbids carrying documents
  Given: there is **no template** (C11); the edit sites are `orchestrate/SKILL.md:148-156` (what the
  subagent's prompt must carry — "the event id and type, the payload's ids… and the binding rules
  below") and `:171-186` (the "every invariant binds inside the subagent" list)
  Then: `:148-156` gains the top-k retrieval results — ids, heading paths, snippets — as prompt
  contents, and `:171-186` gains the rule that a subagent is never handed, and never asks for, a
  corpus dump. Both quoted before-and-after in the log.

TEST-716: Nothing else in either skill moved
  Then: the N=10 concurrency block (`orchestrate/SKILL.md:229-233`), the lock/deferral rules, the
  trace-line rule and the job-log rules read identically. `git diff` on both files is reviewed
  hunk by hunk in the log — these are 944 lines of load-bearing product prose and the issue's third
  criterion is that the result stays internally consistent.

TEST-717: The worked examples use the verbs
  Given: `orchestrate/SKILL.md:419+` and `comment/SKILL.md:386+`
  Then: at least one worked example in each retrieves before reading — `corpus search`, then
  `corpus doc show` on a retrieved id. An example that still opens with a tree read teaches the
  opposite of the rules above it.

TEST-718: Every `corpus …` invocation resolves against the generated CLI reference — the build gate
  Given: `scripts/workspace-template.test.ts:1132` resolves every invocation in the template tree
  against `docs/cli.md`'s headings (`workspace-template.ts:211-270`)
  Then: that suite is **green**, and `CLI_COMMANDS_PENDING_CLI_006` (`workspace-template.ts:239`)
  is still **empty** — no allowlist entry is added for `corpus search` or `corpus doc related`
  (Adjudication 8). A red suite here means CLI-019's regenerated `docs/cli.md` is not on the branch
  yet and AGENT-008 started too early.

TEST-719: The testing strategy is corrected in the log, with substitute evidence
  Given: `.prettierignore` excludes `assets/workspace/` ("its bytes are what `corpus init` installs
  … Prettier must never rewrap or re-mark it"), so `npm run format:check` on these files is a no-op;
  and `apps/cli/src/commands/init/scaffold.test.ts:76-90` is a byte-fidelity **copy** test, not a
  content test
  Then: the log states both findings and names what it ran instead — TEST-718's resolver suite,
  TEST-721's grep audit, and the TEST-720 install drill.

TEST-720: The installed workspace carries the rules
  Given: `corpus init` into a scratch workspace under `…/tmp/s019-agent/`, from a cwd outside this
  repository, with an **explicit `--port 8809`**
  Then: the installed `.claude/skills/{orchestrate,comment}/SKILL.md` carry the three rules and the
  verb-using examples — read back from the installed copy, not from `assets/`, and pasted.

TEST-721: No contradicting instruction survives, proved by grep
  Then: `/usr/bin/grep -n` over both files for each of `data/docs/`, `read.*tree`, `survey`,
  `directory`, `enumerate`, `corpus doc list` — every hit pasted with its line and a one-line
  verdict (rewritten / deliberately kept and why). "We read it and it looks consistent" is not
  evidence for a 944-line prose change.

---

## Cross-cutting

TEST-722: `SPEC.md` moved exactly once, in the kickoff commit
  Then: `git log --oneline -- SPEC.md` on the branch shows the single kickoff commit; no
  implementing agent amended it. A spec gap found mid-implementation is escalated, never patched in
  passing.

TEST-723: `packages/contract` moved exactly once, in CONTRACT-022's commit
  Then: `git diff` of `packages/contract` is empty for SERVER-040, SERVER-041, CLI-019 and
  AGENT-008. The standing rule since sprint-008: a consumer that needs a contract change stops and
  escalates.

TEST-724: `/api/docs` is unchanged across the whole batch
  Given: the `compileFilters` extraction (SERVER-040) and the query-schema extraction
  (CONTRACT-022) both cut into the single busiest read path in the product
  Then: the shipped docs-list suites pass **unmodified** (TEST-664), and one real-HTTP spot check
  against a running server confirms `GET /api/docs?q=…&sort=relevance` still ranks and still
  snippets. A refactor that is only proven by the tests it was allowed to edit is not proven.

TEST-725: No new runtime dependency in `apps/server`
  Then: `git diff apps/server/package.json` empty; no `remark`/`unified`/`mdast` (they are `apps/ui`
  dependencies and must stay there). The heading-path scanner is hand-rolled on the existing
  `core/code.ts` pattern (Adjudication 5). The server is bundled by `npm run package:build` with
  third-party imports left external — a new dependency is a packaging decision.

TEST-726: No implementing agent ran a state-changing git command
  Then: no `commit`, `push`, `checkout`, `reset`, `stash`, `merge`, `rebase` in any agent's session.
  Only the orchestrator commits.

TEST-727: Scratch discipline held
  Then: every agent worked under its `…/tmp/s019-*` prefix, never bare `/tmp`, never inside the
  repository; **no glob-delete** of `s019-server`, which two agents share; only captured paths
  removed.

TEST-728: No workspace was scaffolded into the dev repo
  Then: `/Users/theophanerupin/code/corpus/.corpus` is absent — checked and pasted by every agent
  that ran `corpus init`. Confirmed absent at contract time.

TEST-729: Ports and processes are clean, and `8765` was never touched
  Then: each agent's recorded pids are stopped and its ports show no listener; `8765` was never
  bound, never killed, never proxied into. It read as **free** at contract time — the rule is
  unchanged, and every `corpus init` in this sprint passed `--port` explicitly.

TEST-730: Generated artifacts regenerate cleanly at harvest
  Then: on the merged tree, `node --import tsx scripts/check-generated-artifacts.ts` is green for
  both groups — `packages/contract/openapi.json` + `src/client/schema.generated.ts`, and
  `docs/cli.md`. Regenerated, never hand-merged.

TEST-731: The repo-wide gate passes at harvest
  Then: `/lint` and `/test` green, `npm run coverage` ≥ 90% on all four metrics, and **no new
  per-path exemption** in `scripts/coverage-config.ts` (Adjudication 9).

TEST-732: The wave's one seam, demonstrated end to end by the evaluator
  Given: a workspace the evaluator seeds itself, server on `8810`
  When: it plays the agent — `corpus search` a phrase, read the one-line hits, `corpus doc show` the
  winner, then `corpus doc related` that id and follow one row
  Then: the whole transcript is pasted, and it contains **no directory listing, no file read, and no
  document body before the deliberate `doc show`**. This is the sprint's product claim; TEST-710
  proves the CLI can do it, TEST-720 proves the skills say to, and this proves the two meet.

---

## Out of Scope

- **Everything Phase B.** Embeddings, chunking, the embed worker, vector storage, hybrid ranking,
  provider identity, `corpus index status|rebuild`, and the `/api/index/*` endpoints are
  SERVER-042–046, CONTRACT-023, CLI-020, INFRA-012. The only Phase B artifact in this wave is the
  **inert** semantic-state field (TEST-666, TEST-685).
- **Everything Phase C.** Context packs (`GET /api/threads/:id/context`, `corpus thread context`),
  the comment skill starting from a pack, the related-documents UI panel, and the ⌘K overlay
  adopting `/api/search` are CONTRACT-024, SERVER-047, CLI-021, AGENT-009, UI-025, UI-026. Edit 4's
  spec text describes context packs; **no code in this wave implements them.**
- **Any UI change.** `apps/ui` and `packages/kit` are untouched. The overlay keeps querying
  `GET /api/docs` (§10 is unamended in Phase A by design — Edit 11 is Phase C).
- **Making saved views or board columns ranked.** The signed drafting decision keeps them filtered
  lists on `GET /api/docs`; relevance ranking is a property of interactive search.
- **Multi-hop graph expansion.** SERVER-041 is one hop through `links` — outgoing, incoming, mutual.
  No transitive closure, no shared-tag or same-folder heuristic, no scoring model.
- **A `links` schema change.** No link text, no position, no resolved flag (C7). If related-row
  quality needs one, that is a separate issue with a projection migration.
- **Adding a markdown AST parser to `apps/server`** (Adjudication 5, TEST-725).
- **Exposing `GET /api/tree` as a CLI verb.** It may turn out to be Open Conflict 2's answer — in
  which case it is a **new CLI issue**, filed and scheduled, not smuggled into CLI-019.
- **Reworking `GET /api/docs`'s own behavior.** The two extractions are refactors with an
  unchanged-behavior bar (TEST-664, TEST-724), not an invitation to tidy the busiest query in the
  product.
- **UI-029, UI-030, UI-031** — the open Phase 6 rows. A separate batch.

---

## Integration Points

The five issues are a chain. Four seams are load-bearing enough to be contracted rather than
discovered:

- **CONTRACT-022 → SERVER-040 / SERVER-041 / CLI-019: the frozen shapes.** The producer is the
  contract package; three consumers compile against the generated client. The freeze has a specific
  meaning: the **semantic-state field exists in Phase A and does nothing** (absent-or-`current`), the
  **relation enum carries `similar` and `both` in Phase A and never emits them**, and neither may
  change shape in Phase B — only values. Its field name is recorded in CONTRACT-022's issue file
  (TEST-666) because CLI-019's TEST-705 and, later, CLI-020 key off it. `git diff packages/contract`
  must be empty for every other issue in this batch (TEST-723).
- **SERVER-040 → CLI-019: the snippet is already one line, and already clean.** The FTS layer marks
  hits with U+0002/U+0003 (`fts.ts:32-34`) and the shipped wire shape is a segment array. The search
  hit's snippet is a **plain single-line string with neither delimiter and no newline** (TEST-682) —
  contracted on the server side precisely so the CLI's one-line-per-hit output cannot be corrupted by
  a control character it never expected. The CLI still does not rely on that alone (TEST-700).
- **CLI-019 → AGENT-008: the output is a parse target, and `docs/cli.md` is a build gate.** Two
  distinct couplings. First, the one-line-per-hit format is what the skills teach the agent to read,
  so it is pinned by an exact-output test (TEST-699) and changing it later is a product-documentation
  break. Second — and this one breaks the build, not just the docs —
  `scripts/workspace-template.test.ts:1132` resolves every `corpus …` invocation in the template tree
  against `docs/cli.md`'s headings, and the pending-verb allowlist is empty by design. **AGENT-008
  cannot name `corpus search` until CLI-019's regenerated `docs/cli.md` is committed on the branch**
  (TEST-707, TEST-718). This is a hard ordering constraint that neither issue file mentions.
- **AGENT-008 ⇄ SPEC §7: the skills are where the rule becomes real.** Edit 4 says the rules "live in
  the orchestrate/comment skills, not in code". Today those skills say the opposite in two places
  (`comment/SKILL.md:74-77` and `:198`). The seam is that **the spec text and the skill text must
  agree after this wave** — TEST-713 and TEST-714 are the ones that make §1's new sentence true of
  the shipped product rather than true of the specification.

---

## Escalations and Open Conflicts

### 1. CLI-019's output format: "tab-separated" contradicts "the existing list-output style" (**P1 — ESCALATED, default supplied**)

The issue's first acceptance criterion asks for both, and they are not the same thing. The shipped
style is **space-padded aligned columns** joined by two spaces, last column ragged
(`apps/cli/src/commands/doc/list.ts:141-161`, asserted verbatim at `list.test.ts:46-74`). There is no
tab-separated output anywhere in the CLI.

It matters more here than it would for a human-facing verb, because AGENT-008 teaches an agent to
read these lines, and TEST-709 measures their cost:

- **Padded columns** match the house style and read well, but padding is computed from the widest
  value in the page — so column offsets shift between runs, and a heading path or snippet containing
  runs of spaces has no unambiguous field boundary.
- **Tab-separated** is unambiguous to a parser and cheaper in bytes, but it is a second output
  convention in a CLI that has exactly one, and it looks broken in a terminal.

**Recommended default (proceed on this unless overruled):** follow the **house padded-column style**
for the human path and treat `--json` as the parse target for anything mechanical, with the skills
(AGENT-008) reading the human lines positionally — *id first, always* — and using `--json` whenever
they need a field rather than a glance. Rationale: a second output grammar is a lasting cost paid to
avoid a problem `--json` already solves, and `--json` is a shared global flag that both new verbs get
for free (`registry/globals.ts:11-16`). **The orchestrator rules this before CLI-019 starts** — it is
upstream of AGENT-008's text, and re-deciding it after either lands is two rewrites.

### 2. AGENT-008 must delete the folder survey, and no verb replaces it (**P1 — ESCALATED, default supplied**)

`comment/SKILL.md:198` directs the agent to *"Survey the folders that already exist by reading
`data/docs/`"* before filing an inbox capture — so it can prefer an existing `finance/` over a new
`money/`. Edit 4 forbids exactly that ("never a directory listing"). But **the CLI has no verb that
answers the question**:

- `GET /api/tree` exists on the server (SPEC.md:315, "the `data/docs/` folder tree (names + doc
  counts), for folder pickers and filter chips") and is consumed by the UI.
- **No CLI verb exposes it** — `/usr/bin/grep -rn 'api/tree' apps/cli/src` returns nothing, and
  `docs/cli.md`'s command list has no `tree` heading. `corpus doc list --folder <f>` filters by a
  folder you already know; it cannot enumerate folders.
- `corpus search` does not answer it either: folders are not documents.

So AGENT-008 as written cannot both remove the instruction and leave the agent able to file
correctly. Three ways out: **(a)** file a new CLI issue exposing `GET /api/tree` as `corpus tree` (or
`corpus doc folders`) and let AGENT-008 name it — but the pending-verb allowlist is empty by design
(Adjudication 8), so AGENT-008 would have to wait for it; **(b)** reword the filing step to choose a
destination from **retrieval** — `corpus search` for similar documents and file alongside the winner,
which is arguably the better instruction anyway; **(c)** carve out a narrow, justified exception
permitting a folder-name read, which weakens the rule the wave exists to establish.

**Recommended default (proceed on this unless overruled): (b).** "File it where similar documents
already live, found by searching for them" is retrieval-first, needs no new verb, and is a better
filing heuristic than reading folder names. If the agent judges (b) insufficient in practice it
**stops and escalates the same session**, marks TEST-714 `STRUCK → Open Conflict 2`, and the
orchestrator rules between filing the CLI issue now or carrying it to Phase C.

### 3. `/api/search`'s filter set cannot be the docs-list schema, and the docs-list schema cannot be narrowed (**P2 — ESCALATED, default supplied**)

CONTRACT-022's criterion says filters "reuse the existing docs-list query schema (shared, not
copied)". Two facts make that non-trivial (C5):

1. Edit 7's signed param list **omits `pinned`, `sort` and `offset`**, all of which
   `DocsQuerySchema` carries.
2. `DocsQuerySchema` ends in `.refine(…)` (`query.ts:224-227`), making it a `ZodEffects` with no
   `.omit()`/`.pick()`. There is no exported bare-filters object to build a subset from.

So the choices are: reuse it wholesale and ship an `/api/search` that silently accepts `sort` and
`offset` (contradicting the signed bullet), or refactor `query.ts` to export a base filter object —
touching the single query schema the UI, the CLI and the docs list all consume.

**Recommended default (proceed on this unless overruled):** the refactor. Export a plain
`ZodObject` of the shared filters; rebuild `DocsQuerySchema` as
`PaginationQuerySchema.extend(base.shape).extend({pinned, sort}).refine(…)` — or the smallest
equivalent that leaves its **observable shape and every refinement identical** — and build
`SearchQuerySchema` from the same base with `q` required and `limit` added. The unchanged-behavior
bar is TEST-664 and TEST-724. **If the refactor cannot preserve `/api/docs`'s shape exactly** — if a
param's optionality, coercion, default or error message would move — the agent **stops and
escalates** rather than shipping a subtle change to the busiest read path in the product, and marks
TEST-663 `STRUCK → Open Conflict 3`.

### 4. How much of the amendment lands in the kickoff commit (**P3 — ESCALATED, default supplied**)

The sign-off reads "Approve all 13", and the issue says the amendment is applied as the phase
branch's first commit — but only Edits 1, 4, 7 and 8 describe Phase A behavior. Applying all
thirteen puts spec text for unbuilt endpoints (`/api/index/*`, `/api/threads/:id/context`) into §9.2.

**Recommended default (proceed on this unless overruled): apply all thirteen.** The drafting
conventions exist precisely for this — "every added behavior carries an explicit
`_(Retrieval Phase A|B|C)_` tag… so retrieval-track issues can cite their phase boundary directly
from spec text" — and nothing in the repository parses §9.2 (C6), so unbuilt endpoints in the
inventory bullet break no test. The alternative (apply four now, nine later) means three more spec
commits and three more sign-off checks for text the user has already approved. Whichever is chosen,
TEST-658 requires it be **recorded in SHARED-006's issue file**.

---

## Orchestrator Adjudications (2026-07-31)

Binding rulings. Implementing agents follow these; the evaluator evaluates with them.

1. **`8765` is never bound, never killed, and never proxied into, by anyone** — including when it
   probes free, as it did at contract time. Every `corpus init` passes `--port` explicitly, because
   init's default probes upward from 8765 (`apps/cli/src/commands/init/port.ts`). Carried forward
   from sprints 015–018.
2. **The kickoff commit precedes every agent.** No CONTRACT-022, SERVER-040, SERVER-041, CLI-019 or
   AGENT-008 work starts before SHARED-006's amendment is on the branch (TEST-659). Five issue files
   cite spec text that does not exist until then.
3. **No agent reinvents what ships.** bm25 ranking, the FTS hit CTE, `snippet()`, the filter builder,
   `notArchivedSql`, the `id ASC` tie-break, `notFound()`, `bodyExcerpt`, `GLOBAL_FLAGS`,
   `Output.emit`, `ServerResponseError` — all exist and are cited above with file:line. A second
   implementation beside any of them is a fail, whatever its test coverage.
4. **The extractions carry an unchanged-behavior bar, and the shipped suites are not editable to
   reach it.** `compileFilters` (SERVER-040) and the query schema (CONTRACT-022) are the two, and
   `apps/server/src/docs/{query,routes,fts}.test.ts` pass **unmodified** (TEST-664). A weakened
   assertion is a fail even when the suite is green — the standing rule since sprint-018.
5. **No markdown AST parser is added to `apps/server`.** Heading-path derivation is a hand-rolled
   line scanner built on the existing `core/code.ts` fence-aware pattern that `core/turns.ts:52-64`
   already uses. `remark`/`unified`/`mdast` stay `apps/ui` dependencies. Adding a server dependency is
   a packaging decision (`npm run package:build` leaves third-party imports external) and is not
   SERVER-040's to make (TEST-725).
6. **Every "never a body" criterion is tested against a large document**, not a fixture paragraph
   (TEST-684, TEST-709). The frugality claim is about cost at scale; a 200-byte fixture proves
   nothing about it.
7. **Both `limit` caps are decisions with written reasons** (TEST-671, TEST-696). Silently inheriting
   `MAX_PAGE_LIMIT = 200` is not a decision, and 200 hits is not token-frugal.
8. **`CLI_COMMANDS_PENDING_CLI_006` stays empty.** The self-expiring allowlist
   (`scripts/workspace-template.ts:222-239`) exists for a skill that must name a verb before it
   exists. AGENT-008 is not in that position — CLI-019 is its declared dependency and lands first. No
   entry is added (TEST-718).
9. **No new per-path coverage exemption** in `scripts/coverage-config.ts`, in any issue.
10. **Deleting or weakening a test to reach green is a fail.**
11. **Scoped tests only**, `VITEST_MAX_THREADS=4`, one workspace-scoped run per session maximum, one
    heavy command at a time. Nobody runs `npm run e2e`, `npm run coverage`, or `npm install`. No
    agent starts a Vite dev server; there is no UI work in this batch.
12. **All scratch lives under `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`**, one prefix per
    domain, never bare `/tmp`, never inside the repository, **never glob-deleted** — two agents share
    `s019-server`. Every drill runs from a cwd outside this repository and every agent verifies
    `/Users/theophanerupin/code/corpus/.corpus` is absent (TEST-728).
13. **`/usr/bin/grep` for every grep-based claim.** The `rtk` proxy has produced false negatives, and
    AGENT-008's TEST-721 is entirely such claims.
14. **No implementing agent runs a state-changing git command in this repository** (TEST-726).
15. **The read verb is `corpus doc show`.** There is no `corpus doc get`. Skills, tests and logs say
    `doc show` (C13).

---

## Merge order (recommendation)

1. **Kickoff commit first** — SHARED-006's amendment, orchestrator-owned, before any agent is
   spawned (Adjudication 2). Rule **Open Conflict 4** while composing it.
2. **Rule Open Conflict 1 and Open Conflict 3 before spawning anyone.** OC1 is upstream of both
   CLI-019 and AGENT-008; OC3 is upstream of CONTRACT-022's whole diff. Both are cheap now and
   expensive at harvest.
3. **CONTRACT-022 alone.** Nothing else can start: three issues compile against its generated client.
   It is also the smallest diff in the wave, so the serialization costs little.
4. **SERVER-040 ∥ SERVER-041** — different files (`search/` vs `docs/related.ts`), no shared
   surface except the contract they both consume. Two agents, which is this wave's real concurrency
   ceiling. SERVER-040 is the larger and the riskier (it refactors `query.ts`); give it the first
   slot and the closer read.
5. **CLI-019 after both servers**, because its E2E plan drives real endpoints and its
   `docs/cli.md` regeneration is AGENT-008's gate. Commit the regenerated `docs/cli.md` **with**
   CLI-019, never separately.
6. **AGENT-008 last**, and only once `docs/cli.md` names both verbs on the branch (TEST-718). It is
   prose, but it is 944 lines of load-bearing prose and it is the only issue here that changes what
   the product does — do not treat it as the cheap one.
7. **Audit** — `/audit` qualifies for **CONTRACT-022** (cross-domain by construction: one diff that
   three domains compile against, plus a refactor of the shipped docs-list schema) and for
   **SERVER-040** (>5 files, refactors the busiest read path). SERVER-041 and CLI-019 qualify only
   if they reached beyond their stated files.
8. **Harvest** — regenerate `docs/cli.md` and the contract artifacts on the merged tree, run the
   drift checks (TEST-730), then the single repo-wide gate.
9. **Evaluate** with TEST-732 as the headline, then route any spec rider this wave surfaces — the
   likeliest is §9.2's "single collection query endpoint" sentence, which the drafting decision
   deliberately left unedited — to spec-writer for the phase PR with user sign-off. Not patched in
   passing.

---

## Done Criteria

This sprint is complete when:

- All non-struck acceptance tests PASS in the evaluator's verdict, with every `STRUCK`/`DEFERRED`
  criterion carrying its reason and substitute evidence
- **TEST-732 passes** — the evaluator plays the agent end to end (`corpus search` → `corpus doc
  show` → `corpus doc related`) and the pasted transcript contains no directory listing, no file
  read, and no document body before the deliberate `doc show`. This is the wave's product claim, and
  no combination of passing unit tests substitutes for it
- **TEST-713 and TEST-714 pass** — `comment/SKILL.md:74-77` and `:198`, the two paragraphs that
  today instruct the shipped agent to do the thing §1 now forbids, are reconciled. A wave that adds
  three rules and leaves their contradiction in place has changed a specification, not a product
- **TEST-674's filter-parity table is pasted in full** — every filter, both endpoints, identical id
  sets. "Shared predicate builder" is only provable filter by filter
- **TEST-664 and TEST-724 pass** — `/api/docs` is unchanged by two refactors that cut into it, proved
  by unmodified suites plus one real-HTTP spot check, not by the tests the refactor was allowed to
  edit
- **The frozen shapes are recorded, not just implemented** — the semantic-state field's name and the
  two `limit` caps are written into their issue files with the rejected alternatives (TEST-666,
  TEST-671, TEST-696), because Phase B reads those decisions and Phase B is not in the room
- **TEST-718 passes with an empty allowlist** — every `corpus …` invocation in the workspace
  template resolves against a regenerated `docs/cli.md`
- Each of SERVER-040's and SERVER-041's open decisions (body source, thread neighbours) is recorded
  in its issue file with reasoning (TEST-681, TEST-691)
- `/test` passes with no regressions and `/lint` passes
- The repo-wide coverage gate passes at harvest with no new exemptions
- `git diff SPEC.md` shows only the kickoff commit, and `git diff packages/contract` is empty for
  every issue but CONTRACT-022; `apps/ui` and `packages/kit` are untouched
- `git status` is clean of scratch escape, `/Users/theophanerupin/code/corpus/.corpus` is absent, and
  `8765` was never bound, killed, or proxied into
- Every escalated Open Conflict is either ruled or explicitly carried forward

## Orchestrator adjudications (2026-07-31, pre-dispatch)

1. **OC1 (output format): padded columns**, matching `doc list`; `--json` is the
   mechanical parse target. AGENT-008's skill text reads the human output and never
   field-parses it.
2. **OC2 (folder survey): reword to retrieval-first** as defaulted. The missing tree
   verb is filed as CLI-023 (backlog, not this phase).
3. **OC3: accepted as defaulted** — extract a base ZodObject; stop-and-escalate if
   `/api/docs`'s observable shape would move.
4. **OC4: resolved in fact** — all 13 edits applied at kickoff (commit on this
   branch); recorded in SHARED-006.
