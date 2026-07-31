# [SHARED-006] Spec pass: retrieval — corpus search, semantic index, auto-context

## Domain
shared (spec)

## Status
todo

## Priority
P0

## Model
fable

## Dependencies
- Depends on: —
- Blocks: all retrieval-track issues (Phases A/B/C of the retrieval plan)

## Spec References
- SPEC.md §2.2 (projection, rebuild/doctor), §7 (agent behavior), §9.2 (endpoints), §11 (search overlay), §14 (validation) — amendment targets

## Summary
User-approved direction (2026-07-30): as the corpus grows, the agent must stay
efficient via retrieval, not enumeration. Design (orchestrator proposal, user signed):

- **No separate RAG service.** The semantic index is a third derived index inside the
  existing SQLite projection (after FTS5 and `links`) — same lifecycle: rebuildable,
  doctor-checked, never in git, lives in `.corpus/`.
- **Phase A — retrieval discipline (no embeddings):** agent-facing `corpus search`
  over the existing FTS5 (ranked doc ids + heading/anchor + one-line snippets —
  token-frugal, never bodies), a links-graph "related" expansion, and
  retrieval-first stewardship rules in the product skills (search before reading;
  never enumerate; hand subagents top-k anchors, not documents).
- **Phase B — semantic index:** deterministic chunking by markdown heading path
  (~500-token budget; chunk id = hash of doc id + heading path + content, so
  re-embeds are proportional to edits); async server-internal embed worker (writes
  never blocked; staleness visible); **local-first embedder by default** (Ollama if
  reachable, else a bundled local model; the tool stays a zero-key local tool — user
  decision 2026-07-30), optional configured API provider; provider+model recorded in
  index metadata, provider switch forces rebuild; hybrid `GET /api/search` (FTS5 +
  KNN, reciprocal-rank fusion) composing the same filters as `GET /api/docs`;
  `corpus index status` / `rebuild` verbs; §9.2 inventory additions.
- **Phase C — auto-context:** thread-scoped context packs for the agent (anchor's
  chunk + top-k related, by verb), UI related-documents panel, ⌘K overlay consuming
  the same `/api/search`.

The spec-writer drafts the full behavioral amendment **in this file** (section below)
— not applied to SPEC.md until user sign-off, and then on the retrieval branch (the
working tree currently carries an unrelated in-flight UI PR).

## Acceptance Criteria
- [ ] Amendment draft covers Phases A/B/C behaviorally (WHAT, not HOW), placed against concrete SPEC sections with exact insertion points
- [ ] §9.2 endpoint list additions enumerated (inventory test will pin them)
- [ ] §7 stewardship rules amended for retrieval-first agent behavior
- [ ] Local-first embedder default + provider-switch-forces-rebuild semantics stated
- [x] User sign-off recorded here; amendments applied to SPEC.md afterwards (application pending — first commit of the retrieval phase branch)

## Amendment Draft

_Drafted by spec-writer (Fable), 2026-07-30. Not applied to SPEC.md — apply after user
sign-off, on the retrieval branch. Each edit names its SPEC section and the exact anchor
text it inserts after or replaces; insertion/replacement text is ready to paste._

### Conventions and drafting decisions

- **Phase tags.** Every added behavior carries an explicit `_(Retrieval Phase A|B|C)_`
  tag inline, so retrieval-track issues can cite their phase boundary directly from
  spec text. Untagged sentences inside a tagged block inherit the block's phase.
- **`GET /api/search` lands in Phase A, lexical-only.** The issue files the hybrid
  endpoint under Phase B, but Phase A's `corpus search` output contract (per-hit
  heading path + snippet, never bodies) is not what `GET /api/docs?q=` returns
  (document rows). Rather than fork a temporary shape, the endpoint exists from
  Phase A with lexical ranking; Phase B upgrades its ranking in place with an
  unchanged response shape. One contract, three phases, no migration.
- **Ranked search vs. lists.** `GET /api/docs` remains "the single collection query
  endpoint behind every list"; `/api/search` is ranked retrieval. Saved views and
  board columns stay filtered lists (served by `GET /api/docs`) even after the ⌘K
  overlay adopts `/api/search` — relevance ranking is a property of interactive
  search, not of persisted views. This resolves the tension with §9.2's
  "single collection query endpoint" sentence without editing it.
- **Sticky zero-config model choice.** The issue pins "provider switch forces
  rebuild". The draft closes the adjacent gap: the zero-config choice is sticky —
  a local runtime appearing later never triggers a surprise background rebuild;
  the effective model changes only through an explicit act (config change, or
  `corpus index rebuild`). Any identity change still forces a full rebuild.
- **Doctor: drift vs. staleness.** Async embedding means content can legitimately
  await indexing. Doctor fails on drift (stale chunk content, mixed model
  identity) but treats pending indexing as staleness — reported by
  `corpus index status`, never a doctor failure — so §14's `rebuild && doctor`
  clean invariant stays immediately achievable.

---

### Edit 1 — §1 Context and goals: retrieval-first principle _(Phase A)_

**Insert after** the bullet beginning "**The corpus is the agent's memory, and the
agent is its steward.**" (ends "…organization improves over time."):

```markdown
- **The agent retrieves; it never enumerates.** As the corpus grows, the agent's efficiency comes from ranked search and targeted expansion — anchors and excerpts, not bodies — so the cost of finding and using knowledge scales with what is relevant, never with corpus size (§7 Retrieval discipline).
```

### Edit 2 — §2.2 rule 1: the semantic index shares the projection lifecycle _(Phase B)_

**Replace** these two sentences of rule 1:

> SQLite (`.corpus/cache.db`) is a derived, rebuildable projection used for lists, filters, and search. `corpus db rebuild` reconstructs it from files; `corpus db doctor` fails when files and rows drift.

**with:**

```markdown
SQLite (`.corpus/cache.db`) is a derived, rebuildable projection used for lists, filters, and search — including every search structure: the lexical full-text index, the links graph, and _(Retrieval Phase B)_ the semantic index (§9.1). `corpus db rebuild` reconstructs it from files; `corpus db doctor` fails when files and rows drift. The semantic index follows the same lifecycle with one asynchronous twist: a rebuild restores everything else synchronously and queues semantic re-indexing, which proceeds in the background with progress visible via `corpus index status` (§9.1) — derived state, never in git, always reconstructible from files alone.
```

### Edit 3 — §7 Comment skill: context via the pack _(Phase C)_

**Replace** (in the "**Comment skill**" paragraph):

> Handles `comment.created`: read the thread, plus the parent document and anchor context when present

**with:**

```markdown
Handles `comment.created`: read the thread, plus the parent document and anchor context when present — from Retrieval Phase C, gathered by starting from the thread's context pack (`corpus thread context`, see Retrieval discipline below) and escalating to full-document reads only when the pack is insufficient
```

### Edit 4 — §7 new block: Retrieval discipline _(Phases A and C)_

**Insert after** the paragraph "The stewardship rules live in the skills
(orchestrate/comment), not in code — the mechanism is just the CLI + server
auto-commit + SSE, which the UI reflects live." — i.e. immediately **before**
"**Skills and agent definitions are documents.**":

```markdown
**Retrieval discipline** _(Retrieval Phase A; context packs are Phase C)_. As the corpus grows, the agent stays efficient by retrieving, never enumerating (§1). Two agent-facing verbs make that possible; skill rules make it binding:

- `corpus search "<query>"` — ranked retrieval over the whole corpus (documents, threads, skills alike), via `GET /api/search` (§9.2). Its output is **token-frugal by contract**: a ranked list where each hit is a document id, the heading path of the best-matching passage (its address inside the document — for a hit inside a thread turn, that is the turn's heading), and a one-line snippet — **never a document body**. It accepts the same filters as `GET /api/docs` (type, tag, status, folder, …) and a result cap. In Phase A ranking is lexical; from Phase B it combines lexical and semantic relevance (§9.1) with the same output shape — the verb's contract never changes.
- `corpus doc related <id>` — expansion from a known document: the documents most related to it, in the same frugal shape (id, title, one-line excerpt, and **why** each is related). Phase A relates through the reference graph — outgoing `[[refs]]` and backlinks; from Phase B, semantically similar documents join the same ranked list, each row labeled linked / similar / both.

The rules (they live in the orchestrate/comment skills, and bind the orchestrator and every subagent alike):

- **Search before reading.** Locating content is always a `corpus search` or `corpus doc related` call — never a directory listing, never a read-everything sweep. Reading a full document body is a separate, deliberate act, taken only on a retrieved id.
- **Never enumerate the corpus.** No skill or subagent lists or reads the corpus wholesale to find something; the cost of finding a document must not grow with corpus size.
- **Subagents receive anchors, not documents.** A delegated dispatch (orchestrator skill, above) hands the subagent the task plus the top-k retrieval results — ids, heading paths, snippets. The subagent retrieves and reads what it needs through the same verbs; it is never handed, and never asks for, a corpus dump.

**Context packs** _(Retrieval Phase C)_. `corpus thread context <id>` (via `GET /api/threads/:id/context`, §9.2) returns a thread's **briefing**: the anchored passage with its enclosing section from the parent document (a whole-document thread gets the parent's title and opening content; a standalone thread has no parent content), plus the most-related excerpts from across the corpus — each an id + heading path + short excerpt, ranked by relatedness to the thread's anchor and text (links, and with Phase B, semantic similarity). The pack is **bounded**: reading it costs roughly the same however large the corpus grows — a briefing, never a dump. From Phase C the comment skill starts from the pack (above).
```

### Edit 5 — §9.1 table list: semantic index entry _(Phase B)_

**Insert after** the bullet:

> - `search` — FTS5 over document titles + bodies + turn bodies

```markdown
- semantic index _(Retrieval Phase B)_ — content chunks, their semantic representations, and index metadata (provider/model identity, per-chunk state); derived like every other table — see the Semantic index block below
```

### Edit 6 — §9.1 closing block: the semantic index _(Phase B)_

**Insert at the end of §9.1**, after the chokidar paragraph (ends "…without
double-broadcasting."), before the "### 9.2 HTTP API" heading:

```markdown
**Semantic index** _(Retrieval Phase B)_. The third derived search structure, beside the full-text index and the links graph — same home (inside the projection database under `.corpus/`, gitignored, never in git), same lifecycle (rebuildable and doctor-covered, §2.2 rule 1, §14), same sole writer (the server). It powers the semantic half of ranked search (`GET /api/search`, §9.2) and of related-document expansion.

- **Deterministic chunking, content-addressed identity.** Document and turn bodies are split into chunks along the markdown heading structure — each chunk is a section addressed by its heading path, split further when it exceeds a bounded size budget. A chunk's identity derives from its document id, heading path, and content: the same content always yields the same chunks. The observable consequence: **re-indexing is proportional to the edit.** Saving a small change to a large document recomputes only the edited sections' chunks; untouched sections are never recomputed; moving or renaming a file (path is presentation, id is identity, §5) re-indexes nothing.
- **Asynchronous, never blocking.** Semantic indexing runs inside the server, in the background, after the write path completes: **no save — UI, CLI, or out-of-band — ever waits on indexing.** Watcher-detected out-of-band edits queue re-indexing exactly like server saves. Staleness is visible, not hidden: `corpus index status` reports how much content awaits indexing, and search stays honest meanwhile — lexical ranking is always current, and a search response says when semantic ranking is not yet caught up.
- **Local-first by default** _(user decision, 2026-07-30)_. With zero configuration, semantic indexing works entirely locally — no network account, no API key: the server uses a local model runtime already present on the machine when one is reachable, and otherwise a model bundled with the tool. Corpus remains a local tool out of the box. An external embedding provider may be configured explicitly in `.corpus/config.json`.
- **One index, one model — switching forces a rebuild.** The index records the identity of the provider and model that produced it, and results from different models are never mixed. Changing the effective provider or model invalidates the entire semantic index: it is rebuilt from scratch asynchronously, and until it catches up, search degrades to lexical ranking and says so. The zero-config choice is **sticky**: an index built with the bundled model keeps using it even if a preferable local runtime appears later — the effective model changes only through an explicit act (a config change, or `corpus index rebuild`, which re-picks the current default), never as a surprise background rebuild.
- **Verbs.** `corpus index status` — coverage (indexed vs. pending), the recorded provider/model identity, and whether a full rebuild is in progress. `corpus index rebuild` — discards the semantic index and re-queues everything (the narrow counterpart of `corpus db rebuild`, which reconstructs the whole projection and likewise queues semantic re-indexing). Both are thin typed-client calls (§2.2 rule 4) over the §9.2 index endpoints.
```

### Edit 7 — §9.2: `GET /api/search` _(Phase A; ranking upgraded in Phase B)_

**Insert after** the bullet beginning "`GET /api/docs?q=&type=&status=…` — **the
single collection query endpoint** behind every list…" (ends "…∪ failed jobs."):

```markdown
- `GET /api/search?q=&type=&status=&includeArchived=&tag=&folder=&parent=&references=&agent=&author=&since=&due=&stale=&unread=&needs=&limit=` _(Retrieval Phase A)_ — **ranked retrieval** over documents, threads, and turns. `q` is required; the structured filters are the same set, with the same semantics (including the archived default), as `GET /api/docs`. Results come back relevance-ranked: each hit carries the document id, title, the heading path of the best-matching passage (for a hit in a thread turn, the turn's heading), and a one-line snippet — **never a body**. Phase A ranks lexically; from Phase B, ranking combines lexical and semantic relevance in one list with the same response shape, and the response flags when the semantic index is not fully caught up (§9.1). Lists stay on `GET /api/docs` (§11 columns and saved views are filtered lists); `/api/search` is what `corpus search` — and, from Phase C, the ⌘K overlay — consume. Read-only; no acting party.
```

### Edit 8 — §9.2: `GET /api/docs/:id/related` _(Phase A; semantic rows join in Phase B)_

**Insert after** the bullet:

> - `GET /api/docs/:id` — frontmatter + body + this doc's anchors (id, resolved range or orphaned, thread id, thread status)

```markdown
- `GET /api/docs/:id/related?limit=&includeArchived=` _(Retrieval Phase A)_ — the documents most related to this one, ranked: Phase A relates through the reference graph (outgoing `[[refs]]` and backlinks, via `links`); from Phase B, semantically similar documents join the same ranked list. Each row carries the document id, title, a one-line excerpt, and its relation (linked / similar / both) — never bodies. Archived documents are excluded unless `includeArchived` lifts the default, like every list. Read-only; no acting party.
```

### Edit 9 — §9.2: `GET /api/threads/:id/context` _(Phase C)_

**Insert after** the bullet:

> - `GET /api/threads/:id` — thread with turns (thread _lists_ go through `GET /api/docs` with `type=thread`)

```markdown
- `GET /api/threads/:id/context` _(Retrieval Phase C)_ — the thread's **context pack** (§7 Retrieval discipline): the anchored passage with its enclosing section from the parent (a whole-document thread gets the parent's title and opening content; a standalone thread, no parent content), plus the top most-related excerpts across the corpus — each an id + heading path + short excerpt — bounded in total size. Read-only; no acting party.
```

### Edit 10 — §9.2: index endpoints _(Phase B)_

**Insert after** the `POST /api/check` bullet (ends "…so it carries no acting party."):

```markdown
- `GET /api/index/status` _(Retrieval Phase B)_ — semantic-index health: indexed vs. pending counts, the recorded provider/model identity, and whether a full rebuild is in progress (§9.1) · `POST /api/index/rebuild` — discards and asynchronously rebuilds the semantic index (§9.1): returns immediately, progress observable via status. Both touch only derived runtime state — no workspace file changes, no git commit, no acting party.
```

### Edit 11 — §11 search overlay: adopt unified search _(Phase C)_

**Replace** (at the end of the "**Search overlay.**" bullet):

> **"Save as view"** pins the current query as a new board column. All through the single `GET /api/docs` endpoint.

**with:**

```markdown
**"Save as view"** pins the current query as a new board column. Until Retrieval Phase C the overlay queries the single `GET /api/docs` endpoint (`q` + filters); _(Retrieval Phase C)_ its ranked result list is served by `GET /api/search` (combined lexical+semantic ranking, same filter chips and archived semantics), while saved views and board columns remain filtered lists served by `GET /api/docs` — relevance ranking is a property of interactive search, not of persisted views.
```

### Edit 12 — §11 document view: related-documents panel _(Phase C)_

**Replace** (inside the "**Document view — always editable, Google-Docs-like.**" bullet):

> along with a **backlinks panel** ("referenced by", via the `links` table)

**with:**

```markdown
along with a **backlinks panel** ("referenced by", via the `links` table) and — _(Retrieval Phase C)_ — a **related-documents panel**: the same ranked related set as `GET /api/docs/:id/related` (linked and, with Phase B, semantically similar documents, each row saying why it is related), where clicking a row pushes onto the reader's navigation stack like following any ref
```

### Edit 13 — §14: doctor covers the semantic index _(Phase B)_

**Replace** the bullet:

> - **Projection integrity is checkable and reconstructible.** `corpus db doctor` fails when files and projection rows drift; `corpus db rebuild` reconstructs the projection from files alone. `rebuild && doctor` clean is the standing invariant.

**with:**

```markdown
- **Projection integrity is checkable and reconstructible.** `corpus db doctor` fails when files and projection rows drift; `corpus db rebuild` reconstructs the projection from files alone. `rebuild && doctor` clean is the standing invariant. _(Retrieval Phase B)_ Doctor's coverage extends to the semantic index (§9.1): it fails on **drift** — a chunk whose recorded document, heading path, or content no longer matches the files, or an index mixing more than one provider/model identity — but treats **pending asynchronous indexing as staleness, not drift**: content queued but not yet indexed is `corpus index status`'s business, and doctor stays clean while indexing is merely in flight, so `rebuild && doctor` remains immediately achievable.
```

## Sign-off Record

**2026-07-30 — user sign-off (AskUserQuestion round): "Approve all 13"** — including
the drafting decisions preamble: `/api/search` + `corpus doc related` in Phase A
lexical-only (ranking upgraded in place in Phase B, response shape frozen); sticky
zero-config model choice; doctor drift-vs-staleness split; ranked-search-vs-lists
classification. Scheduling decision, same round: **retrieval Phases A/B/C slot after
the existing Phase 6 backlog** (the 7 ready issues land first).

Amendments are applied to SPEC.md as the first commit of the retrieval phase branch —
not before (the working tree carried an unrelated in-flight UI PR at sign-off time).
This issue closes when the applied text matches the draft.
