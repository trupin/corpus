# Sprint 022 — Retrieval C: the briefing, and the two lanes that must not collide

**Issues**: CONTRACT-024 · SERVER-047 · CLI-021 · AGENT-009 · UI-025 · UI-026
**Domains**: contract, server, cli, agent-runtime, ui
**Branch**: `phase-9-retrieval-c` (orchestrator-owned)
**Date**: 2026-08-01
**Test numbering**: continues the ladder from sprint-021's `TEST-941`; this sprint runs
`TEST-942`–`TEST-1050`.

---

## What this wave is

Phase C is the payoff of Phases A and B, and it is two unrelated shapes of work in one batch:

1. **A hard chain** — CONTRACT-024 → SERVER-047 → CLI-021 → AGENT-009. Each link is genuinely
   blocked on the previous one, and the last link is blocked by a **test**, not merely by taste
   (C7): the workspace-template suite resolves every `` `corpus …` `` invocation in the skill text
   against `docs/cli.md`'s headings, so AGENT-009 writing `corpus thread context` before CLI-021
   has regenerated the docs turns a green suite red.
2. **A UI lane** — UI-025 and UI-026, which depend on Phase A/B endpoints that already ship and on
   nothing in this sprint's chain. They are ~85 % disjoint and share four files, and one of those
   four is a single-holder file that cannot be merged twice (C10).

The pre-flight verified every premise against the tree as it stands after Phases 7 and 8 (all
twelve issues `done`, `issues/PLAN.md:246-259`). **Eleven premises are wrong, incomplete, or
under-specified**, and the two carrying the most weight are wrong in opposite directions:

- **SERVER-047 is easier than its issue file implies.** The "does an anchor map to a chunk cleanly?"
  question has a better answer than chunks: `headingSections(body)` already returns the *whole*
  enclosing section for any offset, fence-aware, from the same scan the chunker and the search
  address use (C2). No chunk reassembly, no new addressing. And the `forThread`/`forText` seam the
  brief asked about **already exists** — `SemanticRetrieval.forQuery(text, scope, limit)` embeds an
  arbitrary string (C3).
- **UI-025 is harder than its issue file implies.** "kit query hook if the pattern requires one" is
  not a conditional: `apps/ui` reaches the network *only* through kit hooks by explicit
  architectural rule, and `CorpusClient` has no `related` method at all. UI-025 and UI-026 both
  require kit changes, which need a named exception (C9).

**The bar for this wave is "the pack is a briefing, and nothing else moved".** Phase A's and Phase
B's ranked surfaces are signed, shipped, snapshot-pinned and covered. Everything below is contracted
twice: once for what it adds, and once for what it must leave byte-identical.

---

## Premise corrections — what the pre-flight found

Verified against the tree at contract time (2026-08-01), read-only: no git, no builds, no installs,
no test runs. Every "X appears nowhere" claim below was produced by `/usr/bin/grep`, never the
proxy.

### C1 — SERVER-047: the four thread shapes are five, and every input is already addressable

`LoadedThread` (`apps/server/src/threads/read.ts:33-45`) carries `parent: string | null` and
`anchor: string | null`, both read leniently from the file. The projection carries the rest:

| Shape | Discriminant | Where the parent-side input lives |
| --- | --- | --- |
| **Anchored** | `parent ≠ null`, `anchor ≠ null`, `anchors.resolved_offset ≠ NULL` | `anchors` row + the parent's body |
| **Whole-document** | `parent ≠ null`, `anchor = null` | parent title + opening section |
| **Standalone** | `parent = null` | — (no parent block) |
| **Orphaned anchor** | `parent ≠ null`, `anchor ≠ null`, `anchors.resolved_offset = NULL` | `anchors.exact_text` — the preserved quote |
| **Deleted parent** | `parent ≠ null`, no `documents` row for it | — (see Open Conflict 9) |

The `anchors` table is `(doc_id, anchor_id, exact_text, prefix, suffix, resolved_offset)`
(`projection/schema.ts:229-237`), and `resolved_offset` is populated by `insertAnchors`
(`project-document.ts:368-397`) with **`resolveAnchorExact` only** — never the fuzzy ladder, per
sprint-003 Adjudication 1, quoted verbatim in that function's comment. `NULL` *is* §6's orphan
state, already, with no extra work.

The fifth shape is real and is not in the issue file: `DELETE /api/docs/{id}` leaves threads as
**orphaned records that still name a deleted parent** (`SPEC.md:349`;
`apps/server/src/docs/delete.ts:15-19, :85`). `loadDocument` on that parent throws the contract's
404, so a naive pack implementation answers 404 for a thread that plainly exists. Open Conflict 9.

### C2 — SERVER-047: the "whole enclosing section" is one existing function call, not chunk reassembly

The issue file (and the brief's question) assume the section comes out of SERVER-042's chunk tables.
It should not, for a measurable reason: **a section larger than `CHUNK_CHAR_BUDGET = 2000` is split
into several chunks** (`semantic/chunker.ts:59`, `splitSection` at `:189-204`), so a chunk is a
*fragment* of a section by construction — precisely what the acceptance criterion forbids.

The right seam is `headingSections(text)` in `apps/server/src/core/headings.ts:58-79`, which the
chunker itself consumes (`chunker.ts:28, :229`) and whose own contract states it:

> A body's sections are contiguous and cover it exactly, so a chunker can slice along them without
> re-deriving a single boundary.

So the assembly is: `headingSections(parentBody).find(s => off >= s.start && off < s.end)` — one
scan, fence-aware, with `headings` already in hand for the heading path. `enclosingHeadings(text,
offset)` (`headings.ts:91-95`) is the same answer for the path alone. Both are exported from
`core/headings.ts`; **neither is re-exported from `core/index.ts`**, so the import is
`../core/headings.js`, exactly as `chunker.ts:28` does it.

This makes AC 4 ("a thread whose anchor sits mid-section returns the WHOLE enclosing section") a
one-line assertion rather than a reassembly algorithm — and it collides with the pack's bound.
Open Conflict 1.

`chunks` is still the right table for the *related excerpts*' addresses, because a `chunk_search`
row carries `heading_path` **and** `body` together (`schema.ts:329-337`) and the semantic scan hands
back the `chunkId` that earned each document its place (`DocumentVectorMatch`,
`semantic/vectors.ts:101-107`).

### C3 — SERVER-047: `forQuery` *is* the `forText` seam; no new method is needed

`SemanticRetrieval` (`semantic/retrieval.ts:111-153`) exposes exactly two ranking methods:

```ts
forQuery(text: string, scope: SemanticScope, limit: number): Promise<SemanticOutcome>;
forDocument(docId: string, scope: SemanticScope, limit: number): Promise<SemanticOutcome>;
```

`forQuery` embeds an arbitrary string through the resolved provider at request time
(`retrieval.ts:471-490`). The pack's ranking input — "the thread's anchor and text" (SPEC.md:285) —
is a string. **No `forThread` and no `forText` is required, and adding one would be a second
implementation of `readiness()`.**

Two properties the pack inherits for free by using it, and must not re-derive:

- **`SemanticOutcome.state`** is the honest-degrade word, computed from the same facts the ranking
  was computed from (`retrieval.ts:11-15`) — this is the whole of SERVER-047's "semantic-degrade
  path mirrors search's flag semantics" criterion. There is nothing to build.
- **A provider failure degrades the request, never the response code** (`retrieval.ts:44-48`). A
  pack whose semantic half throws is a 200 with a `disabled`-family word, never a 500.

`forDocument` is available too and is the wrong call here: it ranks by a *document's centroid*, and
for an anchored thread the question is about one passage plus the conversation, not the thread
document's average. Open Conflict 2 settles which.

### C4 — SERVER-047: `relatedDocs()` cannot be reused wholesale — its row shape is short one field

`RelatedDoc` is `{id, title, excerpt, relation}` (`packages/contract/src/schemas/retrieval.ts:262-279`).
The pack's excerpt row, per **signed** SPEC text, is *"each an id + heading path + short excerpt"*
(`SPEC.md:285`, repeated at `:344`). **`RelatedDoc` has no `headingPath`**, and `related.ts`'s
excerpt is deliberately the document's *opening* line — `toOneLine(raw.excerpt)` over the stored
`body_excerpt` (`docs/related.ts:110-122`), chosen explicitly to avoid a disk read.

So the pack's row is closer to `SearchHit` (`{id, title, headingPath, snippet}`) plus a `relation`.
The machinery to build it exists and is **private**: `loadSemanticOnlyHits`
(`search/search.ts:300-357`) already turns `{id, chunkId}[]` into `{id, title, headingPath,
snippet}` in one bounded statement over `chunk_search`, with a documented first-`ord`-wins rule for
a chunk id that addresses two positions. Open Conflict 2 rules whether that is extracted or
re-expressed.

The fusion primitives *are* reusable as-is and must be reused, not re-invented: `fuseRankings`,
`overFetchLimit`, `RETRIEVAL_OVERFETCH_FACTOR = 5`, `RETRIEVAL_OVERFETCH_CAP = 250`
(`search/fusion.ts:38-61`), and `notArchivedSql("d")` (`docs/filters.ts:112`).

### C5 — CONTRACT-024: there is no house pattern for a bounded *response*, because there has never been one

The issue's AC says the caps go "in the schema … so 'a briefing, never a dump' is enforceable **at
the type level**". Two corrections, both mechanical:

`/usr/bin/grep -rn "\.max(" packages/contract/src/schemas/*.ts packages/contract/src/routes/*.ts`
returns **seven** hits, and every one of them is on a *request* value:

| Site | What it bounds |
| --- | --- |
| `pagination.ts:17`, `retrieval.ts:138`, `retrieval.ts:230` | a `limit` query parameter |
| `queue.ts:141` | the idle timeout |
| `job.ts:79` | `recent=` |
| `db.ts:175`, `skill.ts:50` | request-body identifiers |

`SearchHitSchema.snippet` and `RelatedDocSchema.excerpt` — the two shipped frugal fields — carry
**no `.max()` at all**; their bound is prose in `.describe()` and enforcement is the server's
(`retrieval.ts:176-183`, `:270-276`). CONTRACT-024 would be the contract's **first response-side
bound**.

And it is not a type-level guarantee: `z.infer` of `z.string().max(n)` is `string`, and of
`z.array(T).max(n)` is `T[]`. Nothing in the shipped stack validates a *response* — `app.openapi`
handlers return `c.json(...)` unvalidated (`search/routes.ts:32-36`), and `openapi-fetch` does no
runtime parsing. What `.max()` *does* buy is real and worth having: `maxItems`/`maxLength` published
into the committed `openapi.json`, and a `safeParse` that rejects overflow — which is exactly what
the issue's own Testing Strategy asks for ("bound violations rejected"). Open Conflict 4 restates
the criterion so it is true.

### C6 — CONTRACT-024: `semanticIndex` is module-private, and the issue never mentions it

`semanticIndexField` is a **`const`, not exported** (`packages/contract/src/schemas/retrieval.ts:100-109`).
`SemanticIndexStateSchema` (`:94`) is exported. `/usr/bin/grep -n "semanticIndex"
issues/contract/024-thread-context-route.md` returns **nothing** — the pack envelope is not
specified to carry the word at all.

But SERVER-047's AC 3 says the pack's degrade "mirrors search's flag semantics", and CLI-021 asks
for "the degrade note when semantic ranking wasn't available" (`issues/cli/021-thread-context-verb.md:25`),
whose only implementation is `semanticIndexNote(result.semanticIndex)`
(`apps/cli/src/commands/retrieval.ts:28-34`). Three issues assume a field the fourth does not
declare. Open Conflict 3.

### C7 — AGENT-009: the CLI-verb cross-check exists, and it hard-blocks the ordering

`scripts/workspace-template.ts:211-344` scans every template `.md` for `corpus …` invocations —
**fenced blocks and inline code spans in prose** (`:321-324`) — normalises each to `topic verb`
(`:336`), and resolves them against the headings of `docs/cli.md`, regexed at `:254-265` with
`/^#{2,3} \`corpus ([^\`]+)\`/gm`. The assertion, `scripts/workspace-template.test.ts:1132-1136`:

```ts
  it("resolves every `corpus …` invocation in the whole template tree against docs/cli.md", () => {
    for (const relPath of templateFiles.filter((file) => file.endsWith(".md"))) {
      expect(unresolvedIn(readTemplateFile(relPath)), relPath).toEqual([]);
    }
  });
```

`docs/cli.md` documents five thread verbs today — `create` (:1683), `reopen` (:1742), `reply`
(:1772), `resolve` (:1817), `show` (:1847) — and **no `corpus thread context`**. The moment
AGENT-009 writes the verb, in prose or in a fence, that test goes red with `["thread context"]`.
There is a documented allowlist escape hatch (`CLI_COMMANDS_PENDING_CLI_006`,
`workspace-template.ts:239`, currently `[]`) whose companion assertions
(`workspace-template.test.ts:1145-1150`, `:1158-1169`) would themselves have to be edited to use it.
**CLI-021 lands first. This is not a preference.**

The generated heading will be exactly ``### `corpus thread context` `` with anchor
`#corpus-thread-context`, sorted `byName` **above `corpus thread create`** (`docs/generate.ts:22,
:27, :199-205`). Regeneration is `npm run docs:cli -w apps/cli`, and the drift test
(`apps/cli/src/docs/generate.test.ts:26-28`) is a **unit test**, not just a hook — adding a command
without regenerating fails `vitest`.

### C8 — AGENT-009: the skill's structure is pinned by seven assertions, and prettier will not touch it

`assets/workspace/claude/skills/comment/SKILL.md` is 491 lines. The block AGENT-009 replaces is
**`:72-124`**, the whole of `## Gather context`, which today opens:

> Read before you act, and read in this order. Two rules govern where a read comes from:

and lays out the three shapes as `**Anchored**` (`:92`), `**Whole-document**` (`:105`) and
`**Standalone**` (`:111`), each with a read order and a stopping rule.

`scripts/workspace-template.test.ts` pins, and a rewrite must survive, all of:

| Assertion | Constraint |
| --- | --- |
| `:261` | the comment skill's heading keywords include **`"gather context"`** |
| `:546` | **exactly 13** `##` sections — none added, none removed |
| `:551` | every section body **> 400 characters** |
| `:582-589` | literal `**Anchored**`, `**Whole-document**`, `**Standalone**`, `` `parent: null` ``, `/orphaned/`, and **≥ 3** occurrences of "stop" |
| `:573-580` | literal `corpus thread show <id>`, `corpus doc show <id>`, `/anchor resolution/i`, `data/docs/`, and ``never parse anything under `.corpus/` `` |
| `:555-570` | the non-negotiable command list, verbatim |
| `:141-155` | one fixed authoring timestamp, `updated` advanced only where a body was rewritten |
| `:503-504` | the skill may not contain `SPEC.md`, `CLAUDE.md`, `issues/`, `npm run`, `/implement` |

`assets/workspace/` is **excluded from prettier** (`.prettierignore:12-14`: "its bytes are what
`corpus init` installs"), and the format scripts are unglobbed — so `npm run format:check` is a
no-op here and **`scripts/workspace-template.test.ts` is the only real gate**. The byte-fidelity
copy test (`apps/cli/src/commands/init/scaffold.test.ts:76`) compares bytes and cannot notice a
wrong rule.

`updated:` is currently `2026-07-31T00:00:00Z` against `created: 2026-07-26T00:00:00Z`
(`SKILL.md:7-8`) — bumping it is safe, dropping it fails `:141-155`.

**And the orchestrate skill narrates the very read path AGENT-009 changes**
(`assets/workspace/claude/skills/orchestrate/SKILL.md:470-473`):

> Inside the subagent, the comment skill reads `th_4b8e2c` with `corpus thread show` and opens the
> one anchor that matters — `corpus doc show doc_a1b2c3`, the second line never read at all —

That sentence goes stale on commit. Open Conflict 8.

### C9 — CLI-021: there is no shared hit-line formatter, and building one is a documentation break

The issue's Technical Design says "share the hit-line formatter with `search`/`related`"
(`issues/cli/021-thread-context-verb.md:35`). **No such function exists.**
`apps/cli/src/commands/retrieval.ts` is 35 lines with **one** export, `semanticIndexNote`
(`:28-34`) — which *is* genuinely reusable, handles all four enum values generically, and must not
grow per-state wording (sprint-021 C15, honoured).

What exists is a generic table padder and a collapser, `apps/cli/src/commands/columns.ts`:
`renderColumns(rows)` (`:18`) — **pads every column but the last, deliberately** (`:5-7`, `:19`) —
and `oneLine(text)` (`:41`), which **truncates nothing** (`:38-40`). Each verb assembles its own
tuple inline, and the two disagree:

```ts
// apps/cli/src/commands/search.ts:56-58
results.hits.map((hit) => [hit.id, oneLine(hit.headingPath), oneLine(hit.snippet)])
// apps/cli/src/commands/doc/related.ts:52-54
result.related.map((doc) => [doc.id, doc.relation, oneLine(doc.excerpt)])
```

`search` has no relation column; `related` has no heading path. Unifying them means editing
`search`'s exact-output assertion, which `apps/cli/src/commands/search.test.ts:12-19` declares:

> The exact-output assertion below is the parse target the product's own skills quote, so changing
> it is a documentation break, not a formatting choice.

That is literally true — both product skills paste a rendered transcript
(`comment/SKILL.md:464-466`, `orchestrate/SKILL.md:455-457`). Open Conflict 5.

Two further CLI facts: `--json` needs no branch (`Output.emit` is a no-op without the flag,
`Output.line` a no-op with it — `apps/cli/src/output.ts:54-66`; a second `emit` throws), and a
local `--json` flag would be rejected outright (`registry/validate.ts:126-128` — shadows a global).
404 handling is **prose, not code**: `client.request` throws `ServerResponseError` with
`exitCode = ExitCode.serverError = 5` (`apps/cli/src/client.ts:112, :198-215`;
`apps/cli/src/errors.ts:8-16`), and every verb documents it in its `description` rather than
catching it (`thread/show.ts:73-74`).

### C10 — UI-025/UI-026: both need kit changes, and they collide on four files

`apps/ui` reaches the network **only** through kit hooks, by explicit rule
(`apps/ui/src/app/apiClient.ts:9-11`: "the last place in `apps/ui` that is allowed to know a
transport exists"; `packages/kit/src/index.ts:2-11`: "a plugin that can construct its own client
bypasses the kit's cache, its keys and its invalidation"). `CorpusClient`
(`packages/kit/src/client/createCorpusClient.ts:156-364`) has **34 methods and neither a `related`
nor a `search` one**. `/usr/bin/grep -rni "related" apps/ui/src packages/kit/src` returns zero
functional hits.

So UI-025's "kit query hook if the pattern requires one" is not conditional — the pattern requires
one, and so does UI-026. **Both need a named kit exception.** Each needs, minimally: one
`CorpusClient` method, one `use*` hook, one key builder, one `index.ts` export.

The backlinks precedent they sit beside is thinner than it looks. `Backlinks.tsx` is 45 lines and
**presentational** — no hook of its own, rows arrive as props (`:18-27`), and it returns `null` when
empty (`:24`). The fetch is one line inside the four-query aggregator
`apps/ui/src/reader/useReaderDoc.ts:62`: `const backlinks = useDocs({ references: docId });` — i.e.
the *existing* `useDocs` with a filter, which is why no new key or client method was ever needed.
`related` has no such filter to ride on.

Mount point is `apps/ui/src/reader/DocView.tsx:304`, the last child of `.doc-main`; both hosts go
through that one component (`Reader.tsx:50, :150-158`; `FocusMode.tsx:47, :130-138`), and both
implement `onNavigate` identically as `stack.push(next, surface.currentScroll())`
(`Reader.tsx:92-97`, `FocusMode.tsx:76-81`). CSS lives in **two** files (`Reader.css:526-532`,
`FocusMode.css:90`).

**The file overlap between the two issues, verified:**

| Shared file | UI-025 needs | UI-026 needs |
| --- | --- | --- |
| `apps/ui/e2e/stubCorpus.ts` | a `/api/docs/{id}/related` branch **before** the `:361` `startsWith("/api/docs/")` block, and the `references` short-circuit at `:248-250` relaxed | a `/api/search` branch and `q` support in `matches()` |
| `packages/kit/src/query/keys.ts` | a related key builder | a search key builder |
| `packages/kit/src/index.ts` | one hook export | one hook export |
| `packages/kit/src/client/createCorpusClient.ts` | `relatedDocs` | `search` |

`apps/ui/e2e/stubCorpus.ts` is one `page.route("**/api/**", …)` handler (`:258`) — a single function
body, and it currently answers **neither** endpoint: `/api/search` falls to the `{}` catch-all
(`:405`) and `/api/docs/{id}/related` is swallowed by the doc-by-id branch and 404s (`:361, :383`).
Open Conflict 6.

### C11 — UI-026: `toApiParams` and `toViewFrontmatter` are the same function, and that is the point

`apps/ui/src/search/searchQuery.ts:111-118` — `toViewFrontmatter` **calls** `toApiParams` (`:113`)
and stringifies its output. The module docstring (`:5-16`) makes it a promise:

> They are the **same** map — the view frontmatter is the wire form, stringified — which is what
> makes save-as-view literally "write the current search to a document" … so there is exactly one
> grammar in play and nothing to keep in sync.

`/api/search` deliberately omits `sort`, `offset` and `pinned`
(`packages/contract/src/schemas/retrieval.ts:43-51`). So **repointing `toApiParams` at `/api/search`
silently corrupts every saved view**, and breaks the round-trip closed by `fromViewFrontmatter`
(`:141-160`) and `apps/ui/src/board/viewDoc.ts`. UI-026 must add a *second* serializer and leave
`toApiParams` / `toViewFrontmatter` / `fromViewFrontmatter` on the `GET /api/docs` grammar
untouched. This is contracted below, not left to judgement.

Also: the overlay's fetch is `useSearch` → `useDocs(settled.params)`
(`apps/ui/src/search/useSearch.ts:63`), debounced at 200 ms (`:26`) with a last-arrived ref so the
list does not blank between keystrokes (`:73-75`); grouping is a pure partition of the one response
(`results.ts:34-47`) under an invariant worth preserving verbatim (`results.ts:10-12`: "No branch in
this file can issue a request"). Every consumer is typed `readonly DocRow[]`; `/api/search` returns
`SearchHit[]`. That type change *is* UI-026.

Archived semantics are already correct and must not move (`searchQuery.ts:18-22`, sprint-010 Open
Conflict 3): the default is expressed by **omission**, and the chip emits `includeArchived=true`
rather than a status.

### C12 — the query-key vocabulary is closed at nine names, and prefix matching is the way out

`QUERY_KEY_NAMES` (`packages/contract/src/query-keys.ts:66-76`) is
`["docs","doc","tree","thread","queue","jobs","job","locks","lock"]`, pinned by
`query-keys.test.ts` and rendered into `openapi.json`'s description — so **a tenth name is a
contract change and an artifact regeneration**. `packages/kit/src/query/keys.ts:24-35` states the
failure mode plainly:

> a client that caches under a key no `invalidate` frame ever names type-checks perfectly, passes
> every unit test, and then serves stale data forever.

The server emits `["docs"]` on **every** document or thread mutation and every watcher-projected
out-of-band change (`query-keys.ts` vocabulary entry for `docs`; bus at
`apps/server/src/events/bus.ts:28, :45`), and TanStack invalidation is **prefix**-based. So a key
*under* the `["docs"]` prefix is invalidated for free with no new vocabulary name. Open Conflict 7.

---

## Machine rules — binding on every agent in this batch

### Ports

| Issue | Server port | Vite | Notes |
| --- | --- | --- | --- |
| CONTRACT-024 | — | — | starts nothing |
| SERVER-047 | 8804 | — | |
| CLI-021 | 8805 | — | |
| AGENT-009 | 8806 | — | `corpus init` smoke only |
| UI-025 | 8807 | 5282 | e2e is single-holder — see below |
| UI-026 | 8808 | 5283 | e2e is single-holder — see below |

**`8765` is never bound, never killed, never proxied into** — it is `DEFAULT_PORT`
(`apps/server/src/config.ts:22`), the maintainer's own workspace, and the port
`apps/ui/e2e/search.spec.ts` deliberately expects *nothing* on. **`5173` is never taken**: it is
Playwright's default (`apps/ui/playwright.config.ts:12`) and `--strictPort` (`:38`) turns a
collision into a loud failure rather than a silent reuse.

**`npm run e2e` is single-holder for the whole sprint.** It starts its own Vite with
`reuseExistingServer` disabled (`playwright.config.ts:41`). UI-025 and UI-026 may not run it
concurrently with each other or with anything else. Each records its pid, sets `CORPUS_UI_PORT` to
its own value, and confirms the port is free before and after
(`lsof -nP -iTCP:<port> -sTCP:LISTEN`, pasted).

### Scratch directories

Every workspace an agent creates lives under its own tmp as `s022-<issue-lowercase>/` (e.g.
`s022-server-047/`). **Never `corpus init` inside `/Users/theophanerupin/code/corpus`** — a
`.corpus/` at the repo root is a contract violation.

### The warm model cache is authorised

The embedded engine caches its model per-user under `XDG_CACHE_HOME`/home, overridable with
`CORPUS_MODEL_CACHE_DIR` (`apps/server/src/semantic/engine/cache.ts:31, :112`;
`engine/engine.ts:150, :165`). This machine already holds a warm cache from Phase 8.

**E2E legs in this sprint may use the warm cache** — that is, they leave `CORPUS_MODEL_CACHE_DIR`
unset and let the engine find the already-downloaded model. Rationale: the pack's payoff test
(TEST-1044) needs real embeddings, and re-downloading per issue is minutes of wall clock and
bandwidth for no additional evidence. **Two obligations follow.** An agent that uses the warm cache
says so in its E2E log ("warm per-user model cache, no download"), and **no agent deletes, prunes or
writes to the shared cache** — an issue that genuinely needs a cold start sets
`CORPUS_MODEL_CACHE_DIR` to a path inside its own `s022-*/` scratch.

### The rebuild-first rule still holds

`SCHEMA_VERSION` is 9 since SERVER-042 and a stale projection is wiped, never migrated
(sprint-021 C1). **Every E2E procedure that touches a pre-existing workspace begins with
`corpus db rebuild`.**

### Tests and load

- **Scoped only**: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run <path>`. Never the repo-wide
  suite, never unfiltered `npm test`, never `npm run coverage` or `npm run test:coverage`.
- **One workspace-scoped run at the very end of a session is the maximum.**
- **`npm run build` before lint/typecheck/test** — `@corpus/*` resolves through `dist/`.
- **Three concurrent implementation agents maximum**; the chain caps the real number at two for most
  of the sprint.

### Raw binaries for evidence — recorded proxy hazards

Two harness failures are on the record and both bind every agent here:

- **`/usr/bin/grep` for every grep-based claim.** The `rtk` proxy has produced false negatives. Any
  "X appears nowhere" statement pastes the `/usr/bin/grep` command that produced it.
- **`node_modules/.bin/tsc --noEmit` for every typecheck.** A proxied typecheck printed success over
  two real TS errors (sprint-021, post-046 adjudications). Never `npm run typecheck` as evidence.
- Likewise `/usr/bin/find`, `/bin/ls` for filesystem evidence.

### Process cleanup — pid-targeted only

`pkill -f vite`, `pkill -f tsx`, `pkill node`, `killall node` are **forbidden** — they kill sibling
agents' servers and the maintainer's. Stop what you started by recorded pid.

### Deferred verification is recorded, not skipped

Any criterion that cannot be executed is marked `STRUCK → Open Conflict N` or `DEFERRED → <reason>`
in the E2E Verification Log, **with the reason and the substitute evidence**. Silent omission is a
fail. Each agent states `implemented on: opus | fable` per CLAUDE.md's record-actuals rule.

---

## Acceptance Tests

### CONTRACT-024: `GET /api/threads/{id}/context` — the bounded pack

Model: **opus**. No server. **First in wall-clock terms** — it blocks SERVER-047 and CLI-021. Read
C5 and C6 first: there is no house pattern for a response-side bound, and the envelope's staleness
word is undeclared. Open Conflicts 1, 3 and 4 must be ruled before this is spawned.

TEST-942: The route is in the inventory, spelled as §9.2 spells it
  Then: `ENDPOINT_INVENTORY` gains exactly `"GET /api/threads/{id}/context"`, placed among the
  thread entries in §9.2's own bullet order (`packages/contract/src/routes/inventory.ts:65-72`), and
  `openapi.test.ts:166` — `expect(operations()).toEqual([...ENDPOINT_INVENTORY].sort())` — is green.
  The E2E log quotes `SPEC.md:344` verbatim and walks the parameter list against the entry by hand,
  because nothing in this repository parses `SPEC.md` (`inventory.ts:33-38`).

TEST-943: The three parent cases are distinguishable without guessing
  Given: the pack schema
  Then: a consumer can tell an **anchored** pack from a **whole-document** pack from a
  **standalone** pack by reading one discriminated field, not by testing whether an optional object
  happens to be present and happens to contain a quote. Proven by three `safeParse` round-trips plus
  one negative: a payload that claims one case while carrying another case's fields is **rejected**.

TEST-944: The orphaned case carries the preserved quote and says it is orphaned
  Then: the schema admits a parent block that names no resolved passage but does carry the anchor's
  `exact` text, and a pack asserting a resolved passage *and* orphaned status fails to parse. §6's
  orphan state is a claim the pack makes, not an absence a client infers.

TEST-945: Every bound is a named exported constant, and the schema carries it
  Then: the caps are exported constants in the shape `RETRIEVAL_DEFAULT_LIMIT` set — at minimum a
  max excerpt **count** and a max excerpt **length**, plus whatever Open Conflict 1's ruling adds
  for the parent section — and each is applied with `.max()` on the response schema so
  `maxItems`/`maxLength` reach `openapi.json`. A magic number inline is a fail.

TEST-946: Bound violations are rejected by `safeParse`, in both directions
  Given: the pack schema
  Then: an excerpt array one element past the count cap fails; an excerpt string one character past
  the length cap fails; both at exactly the cap succeed. Four assertions, and the test names the
  constant rather than repeating its value.

TEST-947: The E2E log states what the bound is and is not
  Then: the log records C5's finding in the agent's own words — that `z.infer` erases `.max()`, that
  no shipped path validates a response, and that the enforcement is therefore SERVER-047's
  (rank-then-cut) with this schema as its published ceiling and its test oracle. The issue's phrase
  "enforceable at the type level" is corrected in the issue file.

TEST-948: The staleness word is the shared one, not a parallel enum
  Then: per Open Conflict 3's ruling, the pack envelope's `semanticIndex` field reuses
  `SemanticIndexStateSchema` — `/usr/bin/grep -n "SEMANTIC_INDEX_STATES"
  packages/contract/src/schemas/retrieval.ts` still shows
  `["current", "indexing", "stale", "disabled"]`, byte-identical, and `catching-up` and
  `lexical-only` appear nowhere in the repository. If the ruling adds the field, the shared
  `semanticIndexField` description is *reused*, not retyped — one workspace cannot report `stale` on
  search and `current` on a pack.

TEST-949: The excerpt row carries a heading path, because the signed text says so
  Then: the pack's related-excerpt schema has `id`, `headingPath` and a short excerpt, matching
  `SPEC.md:285` and `:344` ("each an id + heading path + short excerpt"). The E2E log quotes both
  lines and notes C4 — that `RelatedDoc` was considered and is one field short.

TEST-950: The frozen shapes did not move
  Then: `git diff packages/contract/src/schemas/retrieval.ts` shows documentation prose only — no
  executable change to `SEMANTIC_INDEX_STATES`, `RELATIONS`, `SearchHitSchema`, `RelatedDocSchema`
  or the two limit constants. A new file (`schemas/context.ts`) is the expected shape.

TEST-951: A CONTRACT-022-era client still typechecks
  Given: a value constructed against the pre-sprint `SearchResults` and `RelatedDocs` types
  Then: it typechecks against the current ones, under `node_modules/.bin/tsc --noEmit`. Phase C adds
  a route; it does not migrate a shape.

TEST-952: The route is read-only and carries no acting party
  Then: the route definition declares no `ActorHeaderSchema` and no request body, and its `responses`
  include the shared `NOT_FOUND_RESPONSE` and `UNAUTHORIZED_RESPONSE` — the shape `getThread`
  already uses (`packages/contract/src/routes/threads.ts:34-48`). `SPEC.md:344` says "Read-only; no
  acting party" and the definition says it too.

TEST-953: A thread id that names a non-thread is a 404 on this surface
  Then: the route documents it, matching `GET /api/threads/{id}`'s shipped rule
  (`threads/read.ts:60-71`: "A document that exists but is not a thread is a 404 on *this* surface
  rather than a 400"). One doctrine, not two.

TEST-954: The generated artifacts regenerate with no diff
  Then: `npm run generate -w packages/contract` produces an `openapi.json` and a client whose
  regeneration is a no-op, and `node --import tsx scripts/check-generated-artifacts.ts` is green.
  The typed client exposes the method at `paths["/api/threads/{id}/context"]["get"]`.

TEST-955: The query surface is empty in v1
  Then: the route takes a path parameter and nothing else — no `limit`, no `includeArchived`. CLI-021
  says "No flags beyond `--json` in v1 — the bounds live in the contract"
  (`issues/cli/021-thread-context-verb.md:26`), and a query parameter here would make that false. A
  test asserts the parameter list.

---

### SERVER-047: Context pack assembly

Model: **opus**. Port `8804`. Read C1–C4 first: five thread shapes not four, `headingSections` not
chunk reassembly, `forQuery` is the seam that already exists, and `relatedDocs` cannot be reused
whole. Open Conflicts 1, 2 and 9 change this issue's shape and are ruled before it is spawned.
Qualifies for `/audit` (cross-domain, > 5 files, changes a signed endpoint family).

TEST-956: An anchored thread's pack names the passage and the whole section around it
  Given: a parent document with several heading sections and a thread anchored mid-way through
  section 3
  When: `GET /api/threads/{id}/context` runs
  Then: the pack carries the **anchor's own quote** and the **entire enclosing section** — from that
  section's heading line to the next heading that closes it — not a snippet window and not a chunk.
  Asserted by comparing against `headingSections(parentBody)`'s own answer for that offset
  (`core/headings.ts:58-79`), which is the definition, and by a byte comparison against the file on
  disk.

TEST-957: A section larger than one chunk is still returned whole
  Given: a section deliberately longer than `CHUNK_CHAR_BUDGET = 2000` (`semantic/chunker.ts:59`),
  which the chunker therefore splits into several chunks
  Then: the pack returns the **section**, not one of its chunks — subject to Open Conflict 1's cap,
  whose truncation is explicit and flagged rather than silent. This is the test that proves the
  implementation went to `headingSections` and not to the chunk table (C2), and a pack whose parent
  block happens to be exactly 2000 characters is the failure signature.

TEST-958: The anchor's offset comes from the projection, exact-only
  Given: an anchor whose selector no longer matches verbatim
  Then: the pack reports **orphaned**, because `anchors.resolved_offset` is `NULL` — populated by
  `resolveAnchorExact` and never the fuzzy ladder (`project-document.ts:380-390`, sprint-003
  Adjudication 1). A pack that re-runs the fuzzy ladder to "find" the passage fails this test; it
  would reintroduce exactly the misattachment SERVER-002 was fixed to prevent.

TEST-959: The orphaned pack carries the preserved quote and says so
  Given: an orphaned anchor
  Then: the pack states the orphan condition explicitly and carries `anchors.exact_text` — the quote
  the user selected — so the agent can still see what the comment was about. §6's promise is that an
  orphaned thread keeps its quote; the pack is where the agent reads it.

TEST-960: A whole-document thread gets the parent's title and its opening content
  Given: `parent ≠ null`, `anchor = null`
  Then: the pack carries the parent's title and its **opening section** — `headingSections`' first
  entry, the preamble above the first heading, or the first section when the preamble is empty —
  bounded by the same cap. Not `body_excerpt` (280 raw characters, mid-word), and not the whole body.

TEST-961: A standalone thread's pack has no parent block at all
  Given: `parent = null`
  Then: the parent block is **absent**, not an empty object and not a null-filled one, and the pack
  is related-excerpts-only, ranked against the thread's own text. `SPEC.md:285`: "a standalone thread
  has no parent content."

TEST-962: A thread whose parent was deleted answers, and does not 404
  Given: a thread whose `parent` names a document that `DELETE /api/docs/{id}` removed
  (`SPEC.md:349`; `docs/delete.ts:85`)
  Then: per Open Conflict 9's ruling, the route answers 200 with a pack that says the parent is gone
  — never a 500, and never a 404 about a thread that demonstrably exists. `loadDocument` throwing
  the contract's 404 for the *parent* must not become the *thread's* answer. Asserted through the
  route, not the assembly function.

TEST-963: The related half is ranked against the anchor and the thread text
  Given: an anchored thread whose turns discuss a subject the anchored passage does not mention
  Then: the ranking input is the anchor text **plus** the thread's text, per `SPEC.md:285` ("ranked
  by relatedness to the thread's anchor and text"), and a document related only to the turns is
  reachable. Proven by a fixture where a document matches the turns alone and appears, and a control
  where it matches neither and does not.

TEST-964: The semantic half is `forQuery`, and no new retrieval method was added
  Then: `/usr/bin/grep -rn "forThread\|forText" apps/server/src` returns nothing, and the pack calls
  `SemanticRetrieval.forQuery(text, scope, limit)` (`semantic/retrieval.ts:151`). C3's finding is
  recorded in the E2E log. A second implementation of `readiness()` is a fail.

TEST-965: Fusion reuses the shipped primitives
  Then: the pack fuses through `fuseRankings` and over-fetches through `overFetchLimit`
  (`search/fusion.ts:38-61`) — not a new RRF, not a new constant, not a score blend. A grep shows no
  second `RRF_K` and no second overfetch factor.

TEST-966: Excerpt addresses come from the chunk that matched
  Given: a related document promoted by the semantic half
  Then: its `headingPath` and excerpt come from the **matching chunk's** `chunk_search` row, first
  `ord` winning for a chunk id that addresses two positions — the rule `search.ts:341-347` already
  documents and which exists because `chunkId` hashes (document, heading path, text). A document
  related only through the links graph, with no matching chunk, falls back to §9.2's floor: the
  document's title.

TEST-967: Relations are labelled from the two graphs, using the frozen enum
  Then: a related row is `linked`, `similar` or `both` per `RELATIONS`
  (`packages/contract/src/schemas/retrieval.ts:212`), assigned by the same rule `related.ts:177-183`
  uses. No fourth value, and `both` is produced by a fixture that is genuinely both.

TEST-968: The archived default holds on both halves through one fragment
  Given: an archived document that would otherwise rank
  Then: it is absent from the pack, and it is excluded by `notArchivedSql("d")`
  (`docs/filters.ts:112`) handed to the semantic scan as its scope — one fragment governing both
  graphs, the shape `related.ts:142-150` established. A second archived predicate is a fail.

TEST-969: The pack never contains the thread or its parent
  Then: neither the thread's own id nor its parent's id appears among the related excerpts — the
  pack is context *around* the conversation. Asserted for all four live shapes.

TEST-970: Bounds are enforced by rank-then-cut, and the pack parses its own schema
  Given: a corpus large enough that the unbounded candidate set exceeds every cap
  Then: the pack is within every contract cap, the surviving excerpts are the **best-ranked** ones
  (not the first ones the scan happened to read), and the assembled object is fed through
  CONTRACT-024's schema with `safeParse` inside the test and **passes**. The order is ranking first,
  cutting second; cutting first and ranking the remainder is the bug this test exists for.

TEST-971: A single oversized excerpt is truncated, not dropped
  Given: a related document whose matching chunk is longer than the per-excerpt cap
  Then: it appears, truncated to the cap, in its ranked position. A pack that silently drops its
  best-ranked excerpt because the excerpt was long has failed the frugality contract in the
  expensive direction.

TEST-972: Reading the pack costs the same at 50 documents and at 5,000
  Given: two workspaces, one small and one seeded past 5,000 documents
  Then: the two packs for equivalent threads are within the same bounds and the response sizes are
  comparable, and the number of SQL statements the request issues does **not** grow with the corpus
  — asserted by counting through the injectable loader seam, the way `search.ts`'s `loadAddresses`
  and Phase A's `loadPassageTexts` are counted (`search/search.ts:155-160`). `SPEC.md:285`: "reading
  it costs roughly the same however large the corpus grows."

TEST-973: The degrade word is the shared one, computed once
  Given: a workspace with no usable semantic index
  Then: the pack reports the same `semanticIndex` word `/api/search` and `/api/docs/{id}/related`
  report for that same workspace, taken from the same `SemanticOutcome.state`
  (`semantic/retrieval.ts:105-109`) — asserted by calling all three in one test and comparing. A pack
  that says `current` while search says `disabled` is the lie CONTRACT-022's single-word design
  exists to prevent.

TEST-974: A provider that throws degrades the pack, never the status code
  Given: a provider stub that throws while embedding
  Then: the response is **200** with links-only excerpts and an honest state word
  (`semantic/retrieval.ts:44-48`, `:363-380`). A 500 is a fail.

TEST-975: A workspace with no semantic index answers links-only, and that path is the default
  Given: `deps.semantic === undefined` — a unit test constructing the assembly directly
  Then: the pack is the links graph alone with `disabled`, exactly as `related.ts:108` and
  `search.ts:174` already answer. This is the code path a fresh workspace runs on.

TEST-976: The route mounts with the semantic half and reads it per request
  Then: `mountThreadRoutes` gains an options argument carrying `semantic`, mounted after
  `createSemanticRetrieval` (`app.ts:393`, threads at `:423`), and the handler reads it **per
  request** — the reason `search/routes.ts:11-16` gives: the embedded engine binds *after* routes
  are mounted. A handler capturing a resolved provider at mount time fails when the model download
  lands.

TEST-977: Phase A and Phase B did not move
  Then: `apps/server/src/search/`, `apps/server/src/docs/related.test.ts`,
  `apps/server/src/docs/related-semantic.test.ts` and both committed snapshots
  (`search/phase-a-search.snapshot.json`, `docs/phase-a-related.snapshot.json`) pass with **no
  assertion edited**, and the two suite results are pasted. If `loadSemanticOnlyHits` is extracted
  per Open Conflict 2, the extraction is pure motion — the E2E log pastes the diff and states that
  no logic changed.

TEST-978: Nothing durable landed in SQLite, and no new table appeared
  Then: `SCHEMA_VERSION` is unchanged at 9 and `PROJECTION_DDL` gains nothing — the pack is
  assembled per request from tables that already exist. `/usr/bin/grep -n "SCHEMA_VERSION"
  apps/server/src/projection/schema.ts` shows `9`.

TEST-979: The pack takes no lock and writes nothing
  Then: the handler is a pure read like `related` and `search` (`docs/related.ts:30-31`) — no
  `runMutation`, no git commit, no `bus.invalidate`, no lock acquisition. Asserted by running it
  against a workspace whose document is locked by the other party and getting a 200.

TEST-980: E2E — a comment on a section, and the pack read back against the files
  Given: a workspace on port `8804`, after `corpus db rebuild`, seeded with a multi-section document
  and at least one keyword-disjoint related document
  When: a thread is created on a text selection inside section 3 and the pack is fetched with `curl`
  Then: the log pastes the pack, the parent file, and a `/usr/bin/grep`-verified comparison showing
  the returned section is byte-identical to the file's section 3; the related excerpts' heading paths
  are checked against `chunk_search` with `sqlite3`. The log states whether the warm model cache was
  used.

TEST-981: E2E — all five shapes against one running server
  Then: the same server answers, and the log pastes, one pack per shape: anchored, whole-document,
  standalone, orphaned (produced by editing the parent so the quote no longer resolves verbatim),
  and deleted-parent (produced by `corpus doc delete`). Five responses, five status codes, all 200.

---

### CLI-021: `corpus thread context <id>`

Model: **opus**. Port `8805`. Read C9 first: **there is no shared hit-line formatter**, and building
one is a documentation break. Open Conflict 5 is ruled before this is spawned. Blocks AGENT-009 —
its `docs/cli.md` regeneration is AGENT-009's gate (C7).

TEST-982: The verb reads the route through the generated client
  Then: the command calls `api.GET("/api/threads/{id}/context", { params: { path: { id } } })`
  through `context.client.request`, with the route's types pinned from the generated `paths` map the
  way `search.ts:28` and `doc/related.ts:25` pin theirs — so a contract rename breaks the build. A
  hand-constructed request is a §2.2 rule 4 violation.

TEST-983: The four live shapes render legibly, each asserted on exact output
  Then: four rendering tests against stubbed packs — anchored, whole-document, standalone, orphaned
  — each asserting the exact lines. The orphaned pack says the anchor is orphaned and prints the
  preserved quote; the standalone pack prints no parent block and does not print an empty heading
  for one. The absent-value glyph, where one is needed, is `—` (`thread/show.ts:24`, "matching
  `corpus doc show`").

TEST-984: The reading order is passage first, excerpts second, note last
  Then: the human output is the anchored passage and its section, then the related excerpts one per
  line, then the degrade note if any. That is the order an agent reads and the order the issue
  specifies (`issues/cli/021-thread-context-verb.md:23-25`).

TEST-985: The excerpt line is four columns with the free-text field last
  Then: per Open Conflict 5's ruling, each excerpt is one `renderColumns` row of
  `[id, headingPath, relation, excerpt]` — **excerpt last**, because `renderColumns` pads every
  column but the last (`columns.ts:5-7, :19`) and padding to the widest excerpt in the pack would
  add trailing whitespace to every line. `oneLine` is applied to `headingPath` and `excerpt`; not to
  `relation`, which is a closed enum (`doc/related.ts:53`'s rule).

TEST-986: `search` and `related` output is byte-identical to today
  Then: `apps/cli/src/commands/search.test.ts` and `apps/cli/src/commands/doc/related.test.ts` pass
  with **no assertion edited**, and `search.ts:56-58` / `doc/related.ts:52-54` are unchanged. This is
  the test Open Conflict 5 exists to make possible: those assertions are the parse target the
  product's own skills paste verbatim (`comment/SKILL.md:464-466`,
  `orchestrate/SKILL.md:455-457`).

TEST-987: The degrade note is CLI-019's generic one, unchanged
  Then: the note comes from `semanticIndexNote(pack.semanticIndex)`
  (`apps/cli/src/commands/retrieval.ts:28-34`), fires for each of the three non-`current` wire
  values, and is silent on `current` and on absent. **No per-state wording** — sprint-021 C15's
  ruling stands, and `retrieval.ts` is not edited.

TEST-988: `--json` emits the server envelope once and suppresses every human line
  Then: with `--json`, `Output.emit` writes the raw envelope as one line and `Output.line` is inert
  (`apps/cli/src/output.ts:54-66`); without it, the reverse. No branch in the handler tests the flag,
  and a second `emit` would throw `InternalError` — asserted by the single-emit test.

TEST-989: The command declares no local flags
  Then: `flags: []`, like `showCommand` (`thread/show.ts:76`). A local `--json` shadows a global and
  is rejected outright by `registry/validate.ts:126-128` at module load.

TEST-990: The spec object satisfies every registry constraint
  Then: kebab-case name, at least one example, every example starting with `"corpus "` and carrying
  a description, every arg described, no required-after-optional
  (`registry/validate.ts:74-114`). The command is registered on `threadTopic`
  (`thread/index.ts:20-30`) and the registry validates at load.

TEST-991: 404 is documented, not caught
  Then: the description states that a thread id naming nothing is the server's 404, which is exit
  **5** — the sentence pattern `thread/show.ts:73-74` and `doc/related.ts:75-76` already use — and
  the handler contains no status check. `ServerResponseError.exitCode = ExitCode.serverError = 5`
  (`apps/cli/src/errors.ts:8-16, :94-97`).

TEST-992: The ordinary client, not the untimed one
  Then: `context.client.request` with the standard timeout — **not** `client.untimedApi`. That seam
  exists only for `db rebuild`'s ten-minute run (`db/rebuild.ts:20-26`, sprint-021 C15); a pack read
  is a projection read.

TEST-993: `docs/cli.md` is regenerated in the same commit
  Then: `npm run docs:cli -w apps/cli` produces no diff afterwards, and
  `apps/cli/src/docs/generate.test.ts:26-28` — `expect(committed).toBe(generateCliDocs(registry))` —
  is green. The committed file gains ``### `corpus thread context` `` **above**
  ``### `corpus thread create` `` (byName sort, `docs/generate.ts:22, :27`) with anchor
  `#corpus-thread-context`, and the ToC gains its entry. **This is AGENT-009's hard gate (C7); the
  E2E log says so explicitly.**

TEST-994: E2E — the briefing through the real bin
  Given: a workspace on port `8805`, after `corpus db rebuild`, with a document, a related document
  and an anchored comment
  When: `corpus dev -w apps/cli` runs `corpus thread context th_…` and then `--json`
  Then: the log pastes both outputs and verifies the passage against the file on disk with
  `/usr/bin/grep`. The `--json` run emits exactly one line.

TEST-995: E2E — the shapes through the bin, and the exit codes
  Then: the log pastes `corpus thread context` against a standalone thread, against an orphaned
  anchor, and against a nonexistent id — the last showing exit **5** via `echo $?`.

---

### AGENT-009: Comment skill starts from the context pack

Model: **opus**. Port `8806`. Read C7 and C8 first: the CLI-verb cross-check hard-blocks the ordering,
and seven structural assertions pin the file. **Spawned only after CLI-021 has committed its
`docs/cli.md` regeneration.** Open Conflict 8 decides whether orchestrate is in scope.

TEST-996: The template CLI-resolution test is green
  Then: `scripts/workspace-template.test.ts:1132-1136` passes — every `corpus …` invocation in every
  template `.md`, in fences **and inline prose spans** (`workspace-template.ts:321-324`), resolves
  against a `docs/cli.md` heading. `CLI_COMMANDS_PENDING_CLI_006` is still `[]`
  (`workspace-template.ts:239`) and its two companion assertions (`test:1145-1150`, `:1158-1169`) are
  untouched. An agent that had to edit the allowlist ran out of order.

TEST-997: `## Gather context` opens with the context verb
  Then: the section's first instruction is `corpus thread context <id>` and the pack is named as the
  **default** context. `SPEC.md:253`: handling `comment.created` starts "by starting from the
  thread's context pack … and escalating to full-document reads only when the pack is insufficient".

TEST-998: "Insufficient" is defined, not gestured at
  Then: the skill states what insufficiency looks like, concretely — at minimum the two cases the
  issue names (`issues/agent-runtime/009-comment-skill-context-pack.md:26-28`): the ask references
  content the pack did not carry, and an edit must preserve surrounding structure the pack did not
  include. A rule that says "when the pack is not enough" without saying how you know is a fail.

TEST-999: No step reads the parent wholesale by default
  Then: `corpus doc show <parentId>` appears **only** under the escalation, never in the default read
  order. The old step 2 of the anchored path (`SKILL.md:96-98`) is gone as a default. Asserted by
  reading the rewritten section, and by `/usr/bin/grep -n "corpus doc show" ` over the file showing
  every remaining occurrence sits under an escalation or a non-gathering section.

TEST-1000: Both literal read commands survive
  Then: `corpus thread show <id>` and `corpus doc show <id>` still appear **verbatim in that exact
  form** — `scripts/workspace-template.test.ts:573-580` requires both, plus `/anchor resolution/i`,
  `data/docs/`, and ``never parse anything under `.corpus/` ``. The escalation path is where they now
  live.

TEST-1001: The three shape labels, the stopping rules, and the orphan word survive
  Then: literal `**Anchored**`, `**Whole-document**`, `**Standalone**`, `` `parent: null` ``,
  `/orphaned/`, and **≥ 3** occurrences of "stop" (`workspace-template.test.ts:582-589`). The
  standalone path now reads naturally with the pack's related-only shape — the current line "the
  thread is the whole context" (`SKILL.md:112`) is reconciled rather than contradicted: the pack
  returns no parent content for a standalone thread (`SPEC.md:285`), so the pack **is** that rule
  expressed as a command.

TEST-1002: Thirteen sections, each over 400 characters, heading keyword intact
  Then: `workspace-template.test.ts:546` (`expect(sections.size).toBe(13)`), `:551` (> 400 chars
  each), and `:261` (heading keywords include `"gather context"`) all pass. No section added, none
  removed, none thinned below the floor.

TEST-1003: One retrieval doctrine, not two
  Then: invariant 6 (`SKILL.md:65-70`) and the rewritten section agree — the pack **is** bounded
  retrieval, an instance of "you retrieve; you never enumerate", not an exception to it. A
  `/usr/bin/grep` audit for contradicting instructions is pasted, and the E2E log quotes invariant 6
  and the new opening side by side.

TEST-1004: The retitle obligation for standalone threads survives
  Then: the "after the first exchange, give it a real one" obligation and its worked
  `corpus doc edit` line (`SKILL.md:116-124`) are still present. It is an obligation, not part of
  the read order, and losing it in a rewrite of the surrounding block is the accident this test
  exists for.

TEST-1005: Frontmatter is bumped, and only where a body was rewritten
  Then: `updated` advances past `2026-07-31T00:00:00Z` and stays strictly greater than `created`
  (`SKILL.md:7-8`); `workspace-template.test.ts:141-155` passes. `name`, `description`, `type`,
  `title` are unchanged (`:221-229`), and the file still contains none of the forbidden dev-harness
  strings (`:503-504`).

TEST-1006: The orchestrate skill does not describe a read path that no longer exists
  Then: per Open Conflict 8's ruling, `orchestrate/SKILL.md:470-473` — which today narrates "the
  comment skill reads `th_4b8e2c` with `corpus thread show` and opens the one anchor that matters —
  `corpus doc show doc_a1b2c3`" — either is corrected to the pack-first path, or is explicitly ruled
  out of scope with the ruling quoted in the E2E log and a follow-up issue filed. **Silence is a
  fail**; the two skills describing different read paths is the drift the doctrine rule forbids.

TEST-1007: No prettier pass is needed, and none is run
  Then: `.prettierignore:12-14` excludes `assets/workspace/`, the E2E log says so, and `npm run
  format:check` is confirmed a no-op on the file. The bytes are what `corpus init` installs; a
  rewrap would be a product change.

TEST-1008: E2E — the installed skill opens with the verb
  Given: a scratch workspace at `s022-agent-009/` created by `corpus init` on port `8806` from the
  **current build**
  Then: the log pastes the installed `SKILL.md`'s `## Gather context` section from the *installed*
  path (not the repo path), showing it opens with `corpus thread context`, and pastes a
  `corpus thread context` run against a real thread in that workspace proving the verb the skill
  now names actually exists.

---

### UI-025: Related-documents panel beside backlinks

Model: **opus**. Port `8807`, Vite `5282`. Read C10 and C12 first: this needs kit changes (a named
exception) and its query key must sit under a prefix the server already invalidates. Open Conflicts
6 and 7 are ruled before it is spawned. **e2e is single-holder** — never concurrent with UI-026's.

TEST-1009: The kit gains exactly one method, one hook, one key, one export
  Then: the named exception is honoured to the letter — one `relatedDocs` method on `CorpusClient`
  (`packages/kit/src/client/createCorpusClient.ts:156-364`), one `useRelated` hook in
  `packages/kit/src/query/`, one key builder in `keys.ts`, one line in `index.ts`. Nothing else in
  `packages/kit` changes, and `git diff --stat packages/kit` is pasted in the E2E log.

TEST-1010: The panel's cache key is invalidated by the frames the server already sends
  Then: per Open Conflict 7's ruling, the key sits **under the `["docs"]` prefix** — no tenth entry
  in `QUERY_KEY_NAMES` (`packages/contract/src/query-keys.ts:66-76`), no contract change, no
  artifact regeneration. Proven behaviourally: a test dispatches an `invalidate` frame naming
  `["docs"]` through `sseBridge` (`packages/kit/src/events/sseBridge.ts:134-159`) and asserts the
  related query refetches. `keys.ts:24-35`'s failure mode — "type-checks perfectly, passes every unit
  test, and then serves stale data forever" — is what this test is for.

TEST-1011: `apps/ui` never touches a transport
  Then: `/usr/bin/grep -rn "openapi-fetch\|@corpus/contract/client" apps/ui/src` returns nothing new,
  and the panel reads through the kit hook alone (`apps/ui/src/app/apiClient.ts:9-11`'s rule).

TEST-1012: The panel renders ranked rows with their relation labels
  Given: a related payload with `linked`, `similar` and `both` rows
  Then: all three render, in the server's order, each row saying **why** it is related. The UI
  renders whatever the route returns — `/usr/bin/grep` shows no phase logic, no `similar`-specific
  branch, and no client-side re-sort.

TEST-1013: Clicking a row pushes the navigation stack, and Back returns
  Then: a click calls `onNavigate` — `DocView`'s existing prop (`DocView.tsx:66`), implemented
  identically in both hosts as `stack.push(next, surface.currentScroll())` (`Reader.tsx:92-97`,
  `FocusMode.tsx:76-81`) — and Back pops with scroll restored. Asserted the way the backlinks test
  asserts it (`apps/ui/src/reader/Reader.test.tsx:316`).

TEST-1014: Absent, not empty-boxed
  Given: a document with no related documents
  Then: the panel renders **nothing** — `null`, the rule `Backlinks.tsx:24` sets — and no heading,
  no empty container, no "None" line. Asserted for both hosts.

TEST-1015: Present in both hosts, through the one component
  Then: the panel is mounted in `DocView` beside `Backlinks` (`DocView.tsx:304`, the last child of
  `.doc-main`), so the column reader (`Reader.tsx:150-158`) and focus mode
  (`FocusMode.tsx:130-138`) get it from one edit. A second mount in either host is a fail —
  `DocView.tsx:20-25`: "One component, two hosts."

TEST-1016: "Beside" is styled in both stylesheets
  Then: the pair layout is defined in `Reader.css` (near the `.backlinks` block at `:526-532`) **and**
  `FocusMode.css` (near `:90`), because focus mode restyles the measure. A panel that looks right in
  one host and wrong in the other has half-shipped, and this is the file pair that causes it.

TEST-1017: The panel does not fetch when there is nothing to fetch
  Then: the hook follows the precedent in `useReaderDoc` — conditional fetching by passing
  `undefined` (`useReaderDoc.ts:57`'s `useThread(isThread ? docId : undefined)`), not an ad-hoc
  `enabled` flag — so a reader with no open document issues no related request. Asserted by counting
  requests.

TEST-1018: SSE invalidation refreshes it like backlinks
  Given: the panel rendered
  When: a document mutation's `invalidate` frame arrives
  Then: it refetches, coalesced through `sseBridge`'s 50 ms window
  (`sseBridge.ts:134-159`), in the same flush as the backlinks query. One reconnect
  (`refetchQueries({ type: "active" })`, `:172`) also refreshes it.

TEST-1019: The backlinks panel is byte-identical
  Then: `git diff apps/ui/src/reader/Backlinks.tsx` is empty, and
  `apps/ui/src/reader/Reader.test.tsx:316` and `apps/ui/src/reader/DocView.test.tsx:76` pass with no
  assertion edited. The related panel sits *beside* backlinks; it does not refactor it.

TEST-1020: The e2e stub answers `/api/docs/{id}/related`
  Then: `apps/ui/e2e/stubCorpus.ts` gains a related branch **inserted before** the
  `url.pathname.startsWith("/api/docs/")` block at `:361` — otherwise `rest = "<id>/related"` falls
  through to `store.get(id)` and 404s (`:383-384`) — and the reader spec covers the panel with a
  stubbed payload. Per Open Conflict 6, this edit lands in the shared prep commit, not in two
  branches.

TEST-1021: E2E — real app, real navigation
  Given: a workspace on port `8807`, Vite `5282`, with two linked documents and (warm cache) one
  semantically related one
  Then: the log pastes a screenshot or DOM extract showing the panel beside backlinks in **both**
  hosts, a click navigating, and Back returning with scroll restored. Ports confirmed free
  afterwards with `lsof -nP -iTCP:5282 -sTCP:LISTEN`.

---

### UI-026: ⌘K overlay adopts `GET /api/search`

Model: **opus**. Port `8808`, Vite `5283`. Read C11 first: **`toViewFrontmatter` calls
`toApiParams`**, so repointing one silently corrupts every saved view. Open Conflict 6 is ruled
before it is spawned. **e2e is single-holder** — never concurrent with UI-025's.

TEST-1022: Save-as-view stays on `GET /api/docs`, proven by a fork
  Then: `toApiParams`, `toViewFrontmatter` and `fromViewFrontmatter`
  (`apps/ui/src/search/searchQuery.ts:86-160`) are **unchanged**, and the overlay's fetch uses a
  *separate* serializer for `/api/search`'s narrower grammar. `git diff` over those three functions
  is empty. C11 is quoted in the E2E log.

TEST-1023: The round-trip test still passes untouched
  Then: `apps/ui/src/search/searchQuery.test.ts` passes with **no assertion edited**, including the
  `toApiParams(fromViewFrontmatter(toViewFrontmatter(q)))` identity (`searchQuery.ts:132-134`). This
  is the structural proof the fork was real.

TEST-1024: A view saved before the change and one saved after are identical
  Given: the same query
  Then: the `type: view` document written today and the one written after UI-026 are byte-identical
  in their `query` frontmatter — asserted by comparing the two documents against a real server, and
  by a unit test over `toViewFrontmatter`. `SPEC.md:409`'s signed rule: "saved views and board
  columns remain filtered lists served by `GET /api/docs` — relevance ranking is a property of
  interactive search, not of persisted views."

TEST-1025: The overlay's results are ranked, with heading-path subtitles
  Then: results come from `GET /api/search`, in the server's order, each row carrying the hit's
  `headingPath` as its subtitle and its one-line `snippet`. `/usr/bin/grep` shows no client-side
  re-sort and no `sort=relevance` parameter on the search request — `/api/search` has one order, its
  ranking, and silently ignores `sort` (`packages/contract/src/schemas/retrieval.ts:43-51`).

TEST-1026: `SearchHit` replaced `DocRow` everywhere downstream, and grouping still cannot fetch
  Then: `results.ts`, `SearchResults.tsx`, `Snippet.tsx` and the chip helpers consume the hit shape,
  and `results.ts:10-12`'s invariant holds verbatim — "No branch in this file can issue a request,
  which is the structural reason the overlay cannot grow a second one per group." Grouped-by-type
  presentation is preserved (`results.ts:34-47`); a `SearchHit` carries no `type`, so the grouping's
  new discriminant is named explicitly and tested, not inferred from an id prefix by accident.

TEST-1027: The chips are unchanged in behaviour and in count
  Then: all twelve chips still compose (`FilterChips.tsx:72-168`), each still owning one query
  parameter and never touching the network (`FilterChips.tsx:22-23`). The chips derived from the
  response — `tag` (`:93`) and `references` (`:138`) — still populate from whatever the new payload
  returns, or the E2E log states plainly which lost their options and why.

TEST-1028: The archived default is still expressed by omission
  Then: no `status` parameter is sent by default; the "include archived" chip emits
  `includeArchived=true` (`searchQuery.ts:103`). `/api/search` accepts `includeArchived` in the
  shared `docFilterShape` (`schemas/retrieval.ts:133`), so this survives the endpoint change — the
  test asserts the request, not the intent. Sprint-010 Open Conflict 3 is quoted.

TEST-1029: The staleness note appears exactly when flagged, and is absent on `current`
  Then: a quiet one-line note renders for `indexing`, `stale` and `disabled`, and for nothing else —
  including an **absent** field, which means the server makes no claim
  (`schemas/retrieval.ts:100-109`). Four assertions. The issue's words `catching-up`/`lexical-only`
  do not exist (sprint-021 C3) and appear nowhere in the diff.

TEST-1030: Debounce and the no-blank-between-keystrokes behaviour survive
  Then: `SEARCH_DEBOUNCE_MS = 200` still governs (`useSearch.ts:26`), and the last-arrived-results
  ref (`:73-75`) still prevents the list blanking mid-typing. Asserted by a typing test that counts
  requests and asserts the list is never momentarily empty.

TEST-1031: Result click-through navigation is unchanged
  Then: opening a hit into a column behaves exactly as today, and `resultPath` / `cursorTargets` /
  `hasExactTitle` / `shouldOfferCreate` (`results.ts`) keep their behaviour — the create row still
  appears at two characters with no exact title match, asserted by the existing e2e case
  (`apps/ui/e2e/search.spec.ts:155`).

TEST-1032: The kit gains exactly one method, one hook, one key, one export
  Then: same shape as TEST-1009 — one `search` method on `CorpusClient`, one hook, one key builder,
  one export; the search key sits under an existing prefix or is justified in the log against
  `query-keys.ts:66-76`. `git diff --stat packages/kit` pasted.

TEST-1033: The e2e stub answers `/api/search`
  Then: `apps/ui/e2e/stubCorpus.ts` gains a `/api/search` branch returning the `SearchResults`
  envelope, with `q` support added to `matches()` (which has none today) — and `/api/search` no
  longer falls through to the `{}` catch-all at `:405`. Per Open Conflict 6, this edit lands in the
  shared prep commit.

TEST-1034: The existing overlay e2e passes with its assertions intact
  Then: `apps/ui/e2e/search.spec.ts`'s eleven tests pass. They deliberately verify only what does
  not need rows (`:5-19`), so the endpoint change should not move any of them — including
  `:77`'s `save as view` chip assertion, `:92`'s verbatim footer legend, `:135`'s archived chip wash,
  and `:200`'s "the board's own shortcuts do not fire while the overlay owns the keyboard". Any edit
  is named and justified.

TEST-1035: E2E — ranked results, and a save-as-view column identical to a pre-change one
  Given: a workspace on port `8808`, Vite `5283`, after `corpus db rebuild`
  Then: the log pastes ranked results with section subtitles, and a diff of two saved view documents
  — one written by the pre-change build, one by the post-change build, for the same query — showing
  them identical. This is the sprint's UI-side regression headline.

TEST-1036: E2E — the note under a degraded index
  Then: with the semantic index deliberately degraded (a workspace whose vectors carry a foreign
  identity, or one with none), the log pastes the overlay showing the one-line note, and the same
  workspace's `corpus index status` output beside it showing the matching state word. Two surfaces,
  one word.

---

### Cross-cutting

TEST-1037: The end-to-end payoff — a comment lands, the agent's first act is the pack, and the pack
carries a semantically related document
  Given: a fresh workspace, `corpus init`, the warm model cache, seeded with a document and a
  **keyword-disjoint** paraphrase of a related subject (the sprint-021 TEST-879 fixture pair)
  When: a user comments `@agent …` on a section of the first document, the event enqueues
  (`comment.created`), and `corpus thread context <threadId>` is run as the first act
  Then: the pack's related excerpts include the keyword-disjoint document, labelled `similar` or
  `both`. **This is the only test that proves the sprint delivered a feature rather than a schema**,
  and it is the Phase 8 payoff surfacing in the Phase C surface. The log names the provider and
  states that the warm cache was used. If no provider resolves on the machine, it is
  `DEFERRED → provider` with the stub evidence supplied and the orchestrator completing it before
  the PR merges.

TEST-1038: The chain committed in order
  Then: the commit sequence on the branch is CONTRACT-024 → SERVER-047 → CLI-021 → AGENT-009, with
  the UI lane landing at any point after its prep commit. An out-of-order commit means an agent ran
  against a tree that did not yet have its dependency — and for AGENT-009 it means a red
  `workspace-template.test.ts` (C7).

TEST-1039: Phase A and Phase B are byte-stable through the real bin
  Given: a workspace on any of the batch's ports, after `corpus db rebuild`
  When: `corpus search <q> --json` and `corpus doc related <id> --json` run against the pre-sprint
  build and the post-sprint build over the identical workspace
  Then: the two JSON documents are **identical**. Phase C adds a surface; it moves nothing. Run by
  the evaluator, not only by the implementing agents.

TEST-1040: The generated artifacts drift checks are green
  Then: `node --import tsx scripts/check-generated-artifacts.ts` passes — `openapi.json` and
  `docs/cli.md` both regenerate with no diff. Both are §14 obligations and both are touched here.

TEST-1041: `SPEC.md` is unchanged
  Then: `git diff SPEC.md` is empty. Every Phase C behaviour in this batch is already signed text
  (SHARED-006 Edits 3, 4, 9, 11, 12). If any Open Conflict ruling turns out to require a spec edit,
  that edit goes to the **user** for sign-off through the orchestrator, never from an agent.

TEST-1042: No dependency was added
  Then: `git diff` over every `package.json` and `package-lock.json` is empty. Nothing in this
  sprint needs a package: the pack is assembly over shipped modules, the CLI verb is a client call,
  the skill is prose, and both UI issues are hooks over the existing transport.

TEST-1043: The kit exception was used exactly as granted
  Then: `git diff --stat packages/kit` shows changes confined to `client/createCorpusClient.ts`,
  `query/keys.ts`, two new `query/use*.ts` files, and `index.ts` — nothing else. The ruling
  authorising it is quoted in both UI commit bodies. `packages/kit/src/index.ts:2-11`'s rule
  (no transport re-export) holds: `/usr/bin/grep -n "openapi-fetch" packages/kit/src/index.ts`
  returns nothing.

TEST-1044: The query-key vocabulary did not widen
  Then: `/usr/bin/grep -n "QUERY_KEY_NAMES" -A 12 packages/contract/src/query-keys.ts` shows the same
  nine names, byte-identical, and `openapi.json`'s rendered vocabulary description is unchanged.

TEST-1045: Coverage holds without a new exemption
  Then: the repo-wide coverage gate passes at harvest at ≥ 90 % on all four metrics with **no new
  entry** in `scripts/coverage-config.ts`. A new assembly module and two new kit hooks are exactly
  the code that tempts an exemption.

TEST-1046: The pack is bounded, measured
  Then: the E2E log carries a measured table — pack byte size for a small corpus and for a corpus
  past 5,000 documents, for each of the four live shapes. `SPEC.md:285`'s "a briefing, never a dump"
  is an observable promise, and this is where the numbers live.

TEST-1047: `rebuild && doctor` is clean
  Then: `corpus db rebuild && corpus db doctor` is clean, exit 0, pasted, on a workspace carrying
  packs' worth of chunk and embedding state. Phase C adds no projection state, so this should be
  unremarkable — which is exactly why a failure here would matter.

TEST-1048: The packaging gates are unchanged
  Then: `npm run pack:check` passes with **no rule edited** in `scripts/pack-audit.ts`. Phase C ships
  no artifact: no model, no runtime, no extension, no new staged tree. INFRA-012's negative proof
  still holds and the packed size is recorded in the log for comparison against sprint-021's
  baseline.

TEST-1049: Machine hygiene
  Then: `git status` is clean of scratch escape, `/Users/theophanerupin/code/corpus/.corpus` is
  absent, `8765` was never bound, `5173` was never taken, no two e2e runs overlapped, the shared
  model cache was not written to or pruned, and every port in the table is free at session end
  (`lsof -nP -iTCP:<port> -sTCP:LISTEN`, pasted).

TEST-1050: Every issue's E2E log states its model, its evidence tooling, and its deferrals
  Then: each of the six issue files carries `implemented on: opus | fable`; every grep-based claim
  pastes a `/usr/bin/grep` invocation and every typecheck pastes `node_modules/.bin/tsc --noEmit`;
  and every `STRUCK` or `DEFERRED` criterion carries its reason and substitute evidence. A log that
  silently omits a criterion fails the sprint, not the criterion.

---

## Out of Scope

- **Any new projection table, column or `SCHEMA_VERSION` bump.** The pack is assembled per request
  from `documents`, `anchors`, `links`, `chunks`, `chunk_search` and `chunk_embeddings`, all of which
  ship.
- **Chunk ids on the wire.** Sprint-021 put them out of scope and they stay there: the pack publishes
  a document id and a heading path, never a chunk id.
- **Widening any frozen enum** — `SEMANTIC_INDEX_STATES`, `RELATIONS`, `DRIFT_KINDS`,
  `QUERY_KEY_NAMES`. All four are frozen and three of them are published.
- **Changing `corpus search` or `corpus doc related` output.** Their exact-output assertions are the
  parse target the product's own skills paste (C9); Open Conflict 5's recommendation is precisely to
  leave them alone.
- **Moving lists off `GET /api/docs`.** Board columns and saved views stay filtered lists
  (`SPEC.md:409`, signed). UI-026 changes the overlay's *ranked result list* and nothing else.
- **A pack for a document.** `GET /api/threads/{id}/context` is a thread's briefing. A document-level
  pack is not in §9.2 and is not this sprint.
- **Reranking, query expansion, a second model, or fusion-weight tuning.** SERVER-047's own Technical
  Design says "no new ranking logic beyond fusion weights", and `RRF_K = 60` is not tuned per corpus
  by design (`search/fusion.ts:26-37`).
- **Caching the pack.** It is a projection read like `related` and `search`; a cache would need an
  invalidation story nothing in this sprint provides.
- **`corpus thread context --limit` or any flag beyond `--json`.** The bounds live in the contract.
- **Backlinks panel refactoring.** UI-025 sits beside it (TEST-1019).
- **A publish/npm release.** The package name is provisional and there is no `NPM_TOKEN` —
  sprint-013 Adjudication 9 and the standing user decision stand.

---

## Integration Points

- **CONTRACT-024 produces**: `GET /api/threads/{id}/context` → the pack schema (parent block in three
  discriminated cases + orphan, ranked excerpt rows carrying `id`/`headingPath`/excerpt/`relation`,
  the bound constants, and — per Open Conflict 3 — `semanticIndex` reusing
  `SemanticIndexStateSchema`). **SERVER-047 consumes** it as a route definition to register a handler
  against and as its assembly's test oracle; **CLI-021 consumes** it through the generated typed
  client. Neither may hand-construct a request (§2.2 rule 4).
- **SERVER-047 consumes** and does not re-implement: `headingSections`/`enclosingHeadings`
  (`core/headings.ts:58-95`), `SemanticRetrieval.forQuery` + `SemanticOutcome.state`
  (`semantic/retrieval.ts:151, :105-109`), `fuseRankings`/`overFetchLimit` (`search/fusion.ts:38-61`),
  `notArchivedSql("d")` (`docs/filters.ts:112`), the `anchors` row's `resolved_offset`
  (`projection/schema.ts:229-237`), and `chunk_search`'s `heading_path`+`body`
  (`projection/schema.ts:329-337`). It **produces** `apps/server/src/threads/context.ts` plus a
  `semantic` option on `mountThreadRoutes`.
- **CLI-021 consumes** SERVER-047's route through the client, plus `renderColumns`/`oneLine`
  (`commands/columns.ts:18, :41`) and `semanticIndexNote` (`commands/retrieval.ts:28-34`). It
  **produces** the `docs/cli.md` heading ``### `corpus thread context` `` — which is **AGENT-009's
  gate**.
- **AGENT-009 consumes** that heading, via `scripts/workspace-template.ts:254-265`'s regex over
  `docs/cli.md`. It produces nothing any other issue depends on, which is why it is last.
- **UI-025 and UI-026 both consume** the kit seam and **share four files** (C10). Per Open Conflict 6
  they consume a **shared prep commit** rather than editing them concurrently.
- **Shared fixtures, defined once and reused**: the keyword-disjoint paraphrase pair (sprint-021
  TEST-879) is reused verbatim by SERVER-047's TEST-963 and by TEST-1037; the multi-section parent
  document with an oversized section is defined by SERVER-047 (TEST-956/957) and reused by CLI-021's
  E2E; the five-shape thread fixture is defined by SERVER-047 (TEST-981) and reused by CLI-021
  (TEST-983/995) and AGENT-009 (TEST-1008). An issue that invents its own version of one of these has
  made the cross-issue tests unverifiable.

---

## Escalations and Open Conflicts

**Open Conflict 1 — "the WHOLE enclosing section" and "bounded" are in direct tension, and the
contract has to say which wins.**
SERVER-047's AC 4 demands the whole enclosing section; SPEC.md:285 demands that reading the pack
"costs roughly the same however large the corpus grows". A single section can be 50 KB. `headingSections`
returns it whole (C2), so the two criteria collide on the first large document.
**Recommendation: the bound wins, visibly.** CONTRACT-024 exports a section-length cap; SERVER-047
returns the enclosing section truncated to it, **anchored on the anchor** (the anchor's own quote and
its immediate surroundings always survive), and the parent block carries an explicit truncation flag
so the agent knows to escalate to `corpus doc show` rather than assuming it saw the section. AC 4 is
restated as "returns the whole enclosing section up to the contract's cap, never a snippet window,
and says so when it truncated". Rationale: a silently-truncated section is worse than no section —
the agent would edit against text it thinks is complete — and the escalation path AGENT-009 is
writing is exactly the answer for the rare oversized case.
**Orchestrator rules, before CONTRACT-024 is spawned** — it adds a schema field and a constant.

**Open Conflict 2 — where the pack's related half comes from.**
`relatedDocs()` is fused, bounded and degrade-honest today, but its row is one field short of the
signed shape (C4): `RelatedDoc` has no `headingPath`, and its excerpt is the document's *opening*
line by deliberate design, not the matching passage. Three options:
- **(A) New assembly in `threads/context.ts`** over the same primitives: links neighbours from the
  `links` table, semantic neighbours from `forQuery(anchor + thread text)`, fused with
  `fuseRankings`, addressed through `chunk_search` the way `loadSemanticOnlyHits`
  (`search/search.ts:300-357`) already does — extracted to a shared module so there is one
  chunk→row mapping, not two.
- **(B) Call `relatedDocs(db, threadId, …)` and accept `excerpt`-without-`headingPath`.** Cheapest,
  and it contradicts `SPEC.md:285` and `:344`, both signed.
- **(C) Widen `RelatedDoc` with an optional `headingPath`.** Touches a frozen, published, snapshot-
  pinned shape for one caller's benefit.
**Recommendation: (A)**, with `loadSemanticOnlyHits` extracted (pure motion, TEST-977 guards it) and
the links half taken as the **union of the thread's own `links` rows and its parent's**, excluding
both the thread and the parent. Rationale: for an anchored thread the parent's reference graph is the
useful one, and a `[[ref]]` typed in a turn is already keyed on the thread's own id
(`docs/related.ts:22-28`), so the union is the honest "what bears on this conversation".
**Orchestrator rules, before SERVER-047 is spawned** — it decides whether a search module is
refactored.

**Open Conflict 3 — does the pack envelope carry `semanticIndex`?**
The issue file never mentions it; three other issues assume it (C6). `semanticIndexField` is
module-private (`schemas/retrieval.ts:100-109`).
**Recommendation: yes.** Export the shared field (or build it from `SemanticIndexStateSchema` with
the identical description) and put it on the pack envelope. Rationale: SERVER-047's own AC 3 requires
the degrade to "mirror search's flag semantics", CLI-021's degrade note has no other input, and the
alternative — a third retrieval surface that stays silent about its own degradation — is precisely
the inconsistency `retrieval.ts:17-25` says the single word exists to prevent. It is additive, needs
no SPEC edit, and reuses a frozen enum rather than widening one.
**Orchestrator rules in CONTRACT-024.**

**Open Conflict 4 — "enforceable at the type level" is not achievable, and the criterion should say
what is.**
`z.infer` erases `.max()`; nothing in the shipped stack validates a response; there is no precedent
for a response-side bound in this contract (C5).
**Recommendation: restate the criterion** as: named exported constants; `.max()` on the response
schemas so `maxItems`/`maxLength` publish into `openapi.json`; contract tests asserting `safeParse`
rejects overflow in both directions; SERVER-047 enforcing by rank-then-cut; and a server test that
parses its own assembled pack through the schema (TEST-970). That is a real, testable ceiling in
four places instead of an imaginary one in the type system. Correct the issue file's wording.
**Orchestrator rules** — it is a factual correction inside the contract domain, not a design choice.

**Open Conflict 5 — CLI-021's "one formatter, shared" would edit a documented parse target.**
No shared formatter exists; unifying `search` and `related` onto one means editing `search.test.ts`'s
exact-output assertion, which the file itself calls "a documentation break, not a formatting choice"
— and it is right, because both product skills paste rendered transcripts (C9,
`comment/SKILL.md:464-466`, `orchestrate/SKILL.md:455-457`).
**Recommendation: do not build it.** CLI-021 reuses `renderColumns`, `oneLine` and
`semanticIndexNote` — the shipped shared pieces — and assembles its own four-column tuple
`[id, headingPath, relation, excerpt]`, excerpt last so the ragged-last-column rule
(`columns.ts:5-7`) keeps free text unpadded. Restate the AC as "excerpt lines are built from the
shared `renderColumns`/`oneLine` helpers and follow CLI-019's frugal one-line-per-row shape".
**Orchestrator rules.** If the user prefers one true formatter, that is a legitimate answer and it
makes the skill transcripts a deliberate documentation change requiring sign-off — see the escalation
list.

**Open Conflict 6 — UI-025 and UI-026 collide on four files, one of which cannot be merged twice.**
Both need a `CorpusClient` method, a hook, a key builder and an `index.ts` export, and both must edit
`apps/ui/e2e/stubCorpus.ts`'s single route handler (C10). Running them concurrently in one workspace
guarantees conflicts; running them sequentially wastes the sprint's only genuine parallelism.
**Recommendation: a shared prep commit, then concurrency.** One agent (recommend the UI-026 agent —
its client method is the more constrained of the two) lands **one commit** carrying: both
`CorpusClient` methods, both hooks, both key builders, both exports, and **both** `stubCorpus.ts`
branches (`/api/search` with `q` support in `matches()`, and `/api/docs/{id}/related` inserted before
the `:361` block). That commit is `[UI-026]`-prefixed with UI-025 named in the body. UI-025 and
UI-026 then run concurrently on `apps/ui/src/reader/**` and `apps/ui/src/search/**`, which are
strictly disjoint. **`npm run e2e` remains single-holder regardless** — the two agents coordinate
their e2e runs through the orchestrator.
**Also grant the named kit exception here**, scoped exactly as TEST-1009/1032/1043 describe: two
methods, two hooks, two key builders, one export block, nothing else in `packages/kit`.
**Orchestrator rules, before either UI issue is spawned.**

**Open Conflict 7 — the related panel's cache key.**
`QUERY_KEY_NAMES` is closed at nine and published into `openapi.json` (C12); a tenth name is a
contract change plus an artifact regeneration, in a sprint that is already regenerating them for
CONTRACT-024.
**Recommendation: `["docs", <id>, "related"]`** — under the `["docs"]` prefix the server already
emits on every document and thread mutation, so TanStack's prefix matching invalidates it for free,
with no vocabulary change and no contract edit. Same reasoning applies to UI-026's search key.
**Orchestrator rules.**

**Open Conflict 8 — is `orchestrate/SKILL.md` in AGENT-009's scope?**
Its worked example narrates the exact read path AGENT-009 replaces (`:470-473`), and its own
retrieval rules (`:53-60`, `:167-174`, `:197-200`) will describe a doctrine one skill no longer
follows (C8). AGENT-009's Files-to-Modify names only `comment/SKILL.md`.
**Recommendation: yes, minimally.** AGENT-009 corrects `orchestrate/SKILL.md:470-473` to the
pack-first path and touches nothing else in that file. Rationale: the two skills are read by the same
agent in the same loop, and "one retrieval doctrine, not two" is AGENT-009's own third acceptance
criterion — a stale worked example in the sibling skill is the second doctrine. The dispatch rules at
`:167-174` stay as they are: a dispatch still carries anchors, and the pack is anchors.
**Orchestrator rules, before AGENT-009 is spawned.**

**Open Conflict 9 — what does the pack do for a thread whose parent was deleted?**
`DELETE /api/docs/{id}` leaves threads as orphaned records naming a document that no longer exists
(`SPEC.md:349`; `docs/delete.ts:15-19`). `loadDocument` on that parent throws the contract's 404
(C1), so the naive implementation answers 404 for a thread that exists.
**Recommendation: 200, with the standalone shape plus an explicit "parent deleted" statement.**
Rationale: the thread is real, its conversation is real, and the related excerpts are still useful —
this is precisely the case where an agent most needs a briefing, because the document it was about is
gone. A 404 here would make `corpus thread context` unusable on exactly the threads that are hardest
to reconstruct by hand.
**Orchestrator rules in SERVER-047.**

**Escalate to the user, not resolvable here:**
- **If Open Conflict 5 is rejected** and the user wants one true shared hit-line formatter: that
  changes `corpus search`'s exact output, which changes the transcripts pasted into both product
  skills (`comment/SKILL.md:464-466`, `orchestrate/SKILL.md:455-457`). It is a deliberate
  documentation change to shipped product prose and should be signed, not absorbed.
- **If Open Conflict 1's truncation flag turns out to need SPEC text.** §7's context-packs paragraph
  says "bounded" and nothing about truncation; if the reviewer judges that an explicit truncation
  claim is behaviour the spec must describe, that is a §7 amendment the orchestrator prepares for
  sign-off, never an agent.
- **If the pack in practice is not enough** — i.e. if TEST-1037's payoff test shows the agent
  escalating to `corpus doc show` on most real threads. That would mean the caps are wrong, and
  "what size is a briefing" is a product judgement, not an implementation bug.

---

## Orchestrator bookkeeping (not an agent's work)

1. **Rule Open Conflicts 1, 3 and 4 before spawning CONTRACT-024.** All three change the schema —
   ruling them later means regenerating `openapi.json` and the client twice.
2. **Rule Open Conflicts 2 and 9 before spawning SERVER-047.** OC2 decides whether a search module
   is refactored; OC9 decides a route's status code.
3. **Rule Open Conflict 5 before spawning CLI-021**, and Open Conflict 8 before spawning AGENT-009.
4. **Rule Open Conflicts 6 and 7 before spawning either UI issue**, and grant the kit exception in
   writing so both commit bodies can quote it.
5. **CLI-021 commits before AGENT-009 is spawned.** Not a preference — `workspace-template.test.ts:1132`
   resolves the skill's verbs against `docs/cli.md`'s headings (C7). Verify the heading exists in the
   committed `docs/cli.md` before dispatching AGENT-009.
6. **Correct the issue files as each is picked up**: CONTRACT-024's "enforceable at the type level"
   (C5) and its missing `semanticIndex` (C6); SERVER-047's chunk-addressing premise and its
   four-shapes-not-five count (C1, C2); CLI-021's "share the hit-line formatter" (C9); UI-025's
   "kit query hook if the pattern requires one" (C10); UI-026's `catching-up`/`lexical-only` (which
   do not exist — sprint-021 C3).
7. **The UI lane's prep commit is orchestrator-sequenced**: it lands before both UI agents run, and
   only one agent writes it.
8. **`npm run e2e` is single-holder for the sprint.** Schedule UI-025's and UI-026's e2e legs; never
   let them overlap, and never while a build or a scoped test run is alive.
9. `/audit` qualifies for **SERVER-047** (cross-domain, > 5 files, new endpoint on a signed surface,
   reads the projection every other subsystem writes) and for the **UI prep commit** (it edits the
   kit's public contract and the single e2e stub, and both UI issues build on it). CONTRACT-024
   qualifies as cross-domain by construction.
10. **The PR body carries**: every Open Conflict ruling, the CLI-021-before-AGENT-009 ordering note
    with its reason, the kit exception and its scope, and TEST-1046's measured pack sizes.

---

## Merge order (recommendation)

1. **CONTRACT-024 alone, first.** Rule Open Conflicts 1, 3 and 4 before spawning. It blocks two
   issues and its artifacts must be regenerated once, early, so downstream agents build against a
   stable client.
2. **The UI prep commit, concurrent with CONTRACT-024** — disjoint workspaces (`packages/kit`,
   `apps/ui/e2e` vs `packages/contract`). Rule Open Conflicts 6 and 7 first.
3. **SERVER-047 second in the chain**, after CONTRACT-024 commits. The largest issue in the batch: a
   new endpoint, five thread shapes, two graphs fused, and a bound to enforce. Closest read, and an
   `/audit`.
4. **UI-025 and UI-026 concurrently**, after the prep commit — the batch's real parallelism, on
   strictly disjoint trees. They serialize only on `npm run e2e`.
5. **CLI-021 after SERVER-047**, alone. Small: one command, one topic registration, one docs
   regeneration. Its docs commit is checked before step 6 begins.
6. **AGENT-009 last**, after CLI-021's `docs/cli.md` is committed. Prose only, but pinned by seven
   assertions.
7. **Harvest** — regenerate both drift-checked artifacts, then the single repo-wide gate.
8. **PR, then babysit** to merge.
9. **Evaluate** with **TEST-1037** (the payoff: a comment lands, the pack is the first act, and the
   Phase 8 semantic neighbour is in it), **TEST-1039** (Phase A/B byte-stability through the real
   bin), **TEST-1024** (a saved view is identical before and after) and **TEST-996** (the template
   suite is green) as the four headline behavioural checks. They are, respectively, "the feature
   works", "nothing broke", "the signed lists/ranking split held", and "the product's own agent can
   run what its skill tells it to run".

---

## Done Criteria

This sprint is complete when:

- All non-struck acceptance tests PASS in the evaluator's verdict, with every `STRUCK`/`DEFERRED`
  criterion carrying its reason and substitute evidence
- **TEST-1037 passes** — a comment lands on a document, the agent's first act is
  `corpus thread context`, and the pack's excerpts include a keyword-disjoint semantically related
  document. This is the only test that proves Phase C delivered the thing Phases A and B were for
- **TEST-1039 passes** — `corpus search --json` and `corpus doc related --json` are byte-identical
  before and after the sprint. Phase C adds a surface and moves nothing
- **TEST-956 and TEST-957 pass** — the anchored pack carries the *whole* enclosing section, and a
  section larger than one chunk is still whole (up to Open Conflict 1's cap, flagged). This is the
  criterion the issue exists for, and a chunk-shaped answer is the failure signature
- **TEST-970 and TEST-1046 pass** — bounds are enforced by rank-then-cut, the assembled pack parses
  its own schema, and the measured sizes are in the log. "A briefing, never a dump" is an observable
  promise
- **TEST-962 passes** — a thread whose parent was deleted gets a pack, not a 404. It is the case an
  agent most needs one
- **TEST-973 and TEST-974 pass** — the pack's degrade word agrees with search's and related's in one
  call, and a throwing provider yields a 200. Three surfaces, one honest word
- **TEST-986 passes** — `corpus search` and `corpus doc related` output is byte-identical, with no
  assertion edited. Those assertions are pasted verbatim into the product's own skills
- **TEST-996 passes** — the workspace-template suite is green, `CLI_COMMANDS_PENDING_CLI_006` is
  still `[]`, and no allowlist assertion was edited. An agent that had to touch it ran out of order
- **TEST-1002 and TEST-1003 pass** — thirteen sections, each over 400 characters, and one retrieval
  doctrine across both skills
- **TEST-1022, TEST-1023 and TEST-1024 pass** — `toApiParams`/`toViewFrontmatter`/`fromViewFrontmatter`
  are unchanged, the round-trip test is untouched, and a view saved after the change is byte-identical
  to one saved before. §11's signed ranked-search-vs-lists rule is the one thing a plausible-looking
  UI-026 breaks by accident
- **TEST-1010 and TEST-1044 pass** — the new panel's cache key is invalidated by the frames the
  server already sends, and the nine-name vocabulary did not widen
- **TEST-1043 passes** — the kit exception was used exactly as granted and quoted in both commit
  bodies
- **TEST-1040 passes** — `openapi.json` and `docs/cli.md` both regenerate with no diff
- **TEST-1048 passes** — `pack:check` is green with no rule edited; Phase C ships no artifact
- `/test` passes with no regressions and `/lint` passes
- The repo-wide coverage gate passes at harvest at ≥ 90 % with **no new exemption** in
  `scripts/coverage-config.ts` (TEST-1045)
- `git diff SPEC.md` is empty (TEST-1041) and no manifest changed (TEST-1042)
- `git status` is clean of scratch escape, `/Users/theophanerupin/code/corpus/.corpus` is absent,
  `8765` was never bound, `5173` was never taken, no two e2e runs overlapped, the shared model cache
  was not written to, and every port in the table is free at session end (TEST-1049)
- Every Open Conflict is either ruled or explicitly carried forward, and all ten orchestrator
  bookkeeping items are cleared

## Orchestrator adjudications (2026-08-02, pre-dispatch)

All nine Open Conflicts resolved per the contract's recommendations: (1) bound wins
with anchor-centred truncation + explicit flag (fits §7's signed "bounded briefing";
no spec text now — revisit only if the evaluator finds friction); (2) assembly in
threads/context.ts reusing fusion seams, loadSemanticOnlyHits extracted, links =
thread ∪ parent; (3) pack carries semanticIndex via the shared field export; (4)
bounds criterion restated (constants + .max() in the document + safeParse tests +
rank-then-cut + self-parse test); (5) NO new shared formatter — reuse renderColumns/
oneLine/semanticIndexNote (skills' pasted transcripts stay valid); (6) one shared UI
prep commit (kit exception GRANTED, scoped: client methods, hooks, keys, stub
branches), then true UI-025/026 concurrency on disjoint dirs, e2e single-holder;
(7) related key ["docs", <id>, "related"]; (8) orchestrate/SKILL.md minimal fix at
:470-473 only; (9) deleted-parent → 200 standalone shape + explicit statement.
Ordering: CONTRACT-024 → SERVER-047 → CLI-021 → AGENT-009 serial; UI lane
(prep → UI-025 ∥ UI-026) runs parallel to the spine (its deps all landed in
Phases 7/8).
