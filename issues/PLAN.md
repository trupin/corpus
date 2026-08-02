# Project Plan

This file tracks all issues and their status across phases. It is the orchestrator's primary input for deciding what to implement next.

## How to Read This

- **Status**: `todo` (ready to start when deps met), `in_progress`, `done`, `blocked`
- **Dependencies**: Issues that must be `done` before this one can start
- **Priority**: P0 (critical path) > P1 (important) > P2 (nice-to-have)

An issue is **ready** when its status is `todo` and all dependencies are `done`.

Domain prefixes: `SHARED` (cross-domain, orchestrator-handled), `CONTRACT`, `SERVER`, `CLI`, `UI`, `AGENT` (agent-runtime), `PLUGINS`, `INFRA`.

---

## Phase 0 — Project Setup

| ID | Title | Status | Priority | Dependencies |
|----|-------|--------|----------|--------------|
| INFRA-001 | Dev tooling scaffold: monorepo, lint/typecheck/test, git hooks | done | P0 | — |
| INFRA-002 | CI GitHub Action + PR-based landing flow | done | P0 | INFRA-001 |
| INFRA-003 | PR reviewer agent, critical-only lint policy, 90% coverage gate | done | P0 | INFRA-002 |
| INFRA-005 | Reviewer drift dimensions: interface-docs + spec-code | done | P1 | INFRA-003 |
| INFRA-006 | Per-issue model recommendations; pr-reviewer pinned to Fable | done | P1 | INFRA-005 |
| SHARED-001 | Revise SPEC.md for the standalone-tool architecture | done | P0 | — |
| CONTRACT-001 | Bootstrap @corpus/contract: zod-openapi routes, spec generation, typed client | done | P0 | SHARED-001, INFRA-007 |

---

## Phase 1 — Foundations

Contract, core server libraries, UI shell. Filed by /decompose on 2026-07-26 against SPEC.md + the Architecture Decisions in CLAUDE.md (SHARED-001 still lands first; any spec-revision drift is reconciled into these issues when it does).

| ID | Title | Status | Priority | Dependencies |
|----|-------|--------|----------|--------------|
| INFRA-007 | Package build & exports wiring; plugins workspace; type-aware lint | done | P0 | — |
| SERVER-001 | Document model core: parse/serialize, ids, validation | done | P0 | SHARED-001 |
| SERVER-002 | Anchor engine: text-quote resolution + reconciliation | done | P0 | SHARED-001 |
| UI-001 | App scaffold + design system from design/index.html | done | P0 | INFRA-007 |
| AGENT-001 | Workspace template: skills layout, seed views, templates | done | P1 | SHARED-001 |

---

## Phase 2 — Server Backbone + CLI

The sole-writer server and the thin-client CLI.

| ID | Title | Status | Priority | Dependencies |
|----|-------|--------|----------|--------------|
| CONTRACT-002 | Contract growth: full API surface (queue, locks, jobs, attachments, SSE, query params) | done | P0 | CONTRACT-001 |
| SERVER-003 | Server bootstrap: Hono app, config, auth, static UI | done | P0 | CONTRACT-001 |
| SERVER-004 | SQLite projection: schema, projectors, FTS, rebuild/doctor | done | P0 | SERVER-001, SERVER-003 |
| SERVER-005 | Doc write paths + git auto-commit with author attribution | done | P0 | SERVER-002, SERVER-004, SERVER-013 |
| SERVER-006 | Thread write paths: creation, turns, events, cascade | done | P0 | SERVER-005, CONTRACT-002 |
| SERVER-007 | Watcher + SSE invalidation | done | P0 | SERVER-004 |
| SERVER-008 | Queue over HTTP: event store + long-poll | done | P0 | SERVER-003, CONTRACT-002 |
| SERVER-009 | Document locks + job logs | done | P0 | SERVER-007, CONTRACT-002 |
| SERVER-010 | Attachments: ingest + serving | done | P1 | SERVER-006 |
| SERVER-011 | Collection query endpoint: filters + FTS + needs=me | done | P0 | SERVER-004 |
| CLI-001 | CLI scaffold: bin, command registry, workspace resolution, typed client | done | P0 | CONTRACT-001, INFRA-007 |
| SERVER-012 | Anchor engine: partial-path truncated selectors beside edited near-identical siblings | done | P2 | SERVER-002 |
| CONTRACT-003 | Request schemas with `.default()` render as required in the generated client | done | P1 | CONTRACT-002 |
| CONTRACT-004 | Mandatory request bodies are typed optional in the generated client | done | P1 | CONTRACT-002 |
| SERVER-013 | Anchor engine: substitution class — anchors handed unrelated text while their own survives | done | P1 | SERVER-012 |
| CONTRACT-005 | Board contract growth: query-key vocabulary, DocRow staleness + thread fields | done | P1 | CONTRACT-002 |
| SERVER-014 | Anchor engine: duplicate-survivor policy (remap-one vs orphan) — TEST-64/66 tension | done | P2 | SERVER-013 |
| SERVER-015 | Populate CONTRACT-005's new DocRow fields in the collection query | done | P1 | CONTRACT-005, SERVER-011 |
| CLI-002 | `corpus init` + server lifecycle verbs | done | P0 | CLI-001, SERVER-003, AGENT-001 |
| CLI-003 | Doc & thread verbs | done | P0 | CLI-001, SERVER-005, SERVER-006, SERVER-017 |
| CLI-004 | Queue, lock, job verbs (agent loop surface) | done | P0 | CLI-001, SERVER-008, SERVER-009 |
| CONTRACT-006 | Thread-response warnings, appended honesty, db routes | done | P0 | CONTRACT-005 |
| SERVER-017 | Mount db rebuild/doctor routes (CONTRACT-006 rider) | done | P1 | SERVER-004 |
| SERVER-018 | `["tree"]` key gaps: thread deletion + archive/unarchive | done | P2 | SERVER-006, SERVER-009 |
| CONTRACT-010 | MarkSeen `unread` honesty + client attachment-path exclusion | done | P1 | CONTRACT-006 |
| SERVER-021 | Capture cleanup deletes committed attachment bytes | done | P1 | SERVER-010 |
| CLI-007 | `corpus job log` stdin-socket hang under agent harness | done | P1 | CLI-003, CLI-004 |

---

## Phase 3 — UI

The board, editor, threads, console. design/index.html is authoritative for look & feel.

| ID | Title | Status | Priority | Dependencies |
|----|-------|--------|----------|--------------|
| UI-002 | @corpus/kit data layer: hooks + SSE bridge | done | P0 | CONTRACT-002, SERVER-007, UI-001 |
| UI-003 | Board columns: pinned view docs, reorder, new-list | done | P0 | UI-002, SERVER-011, SERVER-024, SERVER-026 |
| UI-004 | Type-aware rows: badges, reasons, staleness ramp | done | P0 | UI-002 |
| UI-005 | Reader, navigation stacks, doc menu, focus shell, lock banner | done | P0 | UI-003, UI-004 |
| UI-006 | Always-editable TipTap document editor | done | P0 | UI-005 |
| UI-007 | Anchored threads: highlights, comment-from-selection, chips ↔ margin cards | done | P0 | UI-006 |
| UI-008 | Thread view, composer, attachments, forms, read state | done | P0 | UI-005, SERVER-010, CONTRACT-007, CONTRACT-009, SERVER-016, SERVER-023 |
| UI-009 | Search overlay, omnibox create, save-as-view | done | P0 | UI-003 |
| UI-010 | Global Ask/Capture composer + keyboard scheme | done | P1 | UI-008, UI-009 |
| UI-011 | Console drawer: jobs master-detail, live logs, HALT | done | P1 | UI-002, SERVER-009, UI-009, SERVER-027 |
| CONTRACT-007 | Forms surface: formAnswer schema + form.respond producer routes | done | P1 | CONTRACT-002 |
| CONTRACT-009 | Multipart createThread + declared 413 (attachments rider) | done | P1 | CONTRACT-002 |
| SERVER-016 | Form answer write path (form.respond producer) | done | P1 | CONTRACT-007, SERVER-006 |
| SERVER-020 | Watcher path breaks the tree-key invariant (heuristic vs. signature) | done | P2 | SERVER-018 |
| SERVER-022 | Server hardening batch: PR #9 MINOR findings | done | P2 | SERVER-010, SERVER-018 |
| SERVER-023 | Consume CONTRACT-007/009 riders: warnings, reap failed, originTitle, multipart, 413 | done | P1 | CONTRACT-007, CONTRACT-009, SERVER-006, SERVER-010 |
| SERVER-024 | Provision the bearer token to the served UI | done | P1 | SERVER-003 |
| SERVER-025 | Emit an invalidate when the boot projection completes | done | P2 | SERVER-007 |
| CONTRACT-011 | Extra-frontmatter surface: view keys, pinned/order, parentTitle | done | P0 | CONTRACT-005 |
| SERVER-026 | Consume CONTRACT-011: extra frontmatter, pinned/order, parentTitle | done | P0 | CONTRACT-011, SERVER-011, SERVER-015 |
| CLI-008 | CLI hardening batch: PR #9 MINOR findings | done | P2 | CLI-003, CLI-004 |
| CONTRACT-012 | `DocRow.unreadThreads` aggregate unread count | done | P1 | CONTRACT-011 |
| SERVER-027 | Populate `DocRow.unreadThreads` in the collection query | done | P1 | CONTRACT-012, SERVER-011 |
| SERVER-028 | Queue transitions must invalidate `["docs"]` (needs=me lag) | done | P1 | SERVER-007, SERVER-011 |
| UI-013 | UI hardening batch: PR #10 MINOR findings | done | P2 | UI-006, UI-007, UI-008 |
| SERVER-029 | Server hardening batch: PR #10 MINOR findings | done | P2 | SERVER-016, SERVER-026 |
| CONTRACT-014 | Form-fence grammar edges + SSE token transport decision | done | P2 | CONTRACT-007, CONTRACT-013 |
| CLI-009 | `server stop` must not delete a live foreign pidfile | done | P2 | CLI-002 |
| INFRA-009 | Coverage gate: empty in-scope set must fail | done | P2 | INFRA-004 |
| CONTRACT-013 | Export uploadCreateThread from client barrel; FORM_ANSWER_LABEL to contract | done | P1 | CONTRACT-007, CONTRACT-009 |
| UI-012 | DocMenu actions never toast (callback teardown) | done | P2 | UI-005 |
| INFRA-004 | Merge Playwright e2e coverage into the combined 90% gate | done | P1 | INFRA-003, UI-001 |

---

## Phase 4 — Agent Loop, Plugins, Packaging

| ID | Title | Status | Priority | Dependencies |
|----|-------|--------|----------|--------------|
| AGENT-002 | Orchestrate skill: the agent's main loop | done | P0 | CLI-004, CLI-007, AGENT-001 |
| CONTRACT-008 | Validation + skill-rollback routes (doc check / skill rollback surface) | done | P1 | CONTRACT-002 |
| CONTRACT-016 | Rider: nullable rollback commit | done | P1 | CONTRACT-008 |
| SERVER-019 | Mount validation + skill-rollback handlers | done | P1 | CONTRACT-008, CONTRACT-016 |
| CLI-006 | `corpus doc check` + `corpus skill rollback` verbs | done | P1 | CLI-003, SERVER-019 |
| AGENT-003 | Comment skill: thread handling + inbox filing + skill genesis | done | P0 | CLI-003, CLI-006, CLI-010, AGENT-002 |
| CLI-010 | Read verbs: `corpus doc show` + `corpus thread show` | done | P1 | CLI-003 |
| CLI-011 | `corpus skill create` (server write path) + `corpus doc list` | done | P1 | CLI-006, SERVER-019 |
| PLUGINS-003 | Item-level anchored commenting on plugin-rendered docs (design closed; impl = PLUGINS-005/006/007) | done | P1 | UI-014 |
| INFRA-010 | npm audit cleanup: scoped overrides, eslint 10, phantom deps | done | P2 | INFRA-001 |
| SERVER-033 | @hono/node-server v2 migration (serve-static traversal advisory) | done | P1 | SERVER-003 |
| UI-016 | Migrate to react-router v8 (audit advisory; RSC-CSRF not applicable) | done | P1 | UI-029 |
| CLI-013 | corpus init ignores --workspace; guard misses repo-like dirs | done | P1 | CLI-002 |
| AGENT-004 | Emit trace lines in agent turns | done | P2 | AGENT-002 |
| PLUGINS-001 | Plugin extension points: discovery across UI, server, CLI | done | P1 | UI-003, CLI-001, SERVER-003 |
| PLUGINS-002 | Todos reference plugin | done | P1 | PLUGINS-001, AGENT-003, CONTRACT-015 |
| CONTRACT-015 | Graduate plugin-facing types into @corpus/contract | done | P1 | CONTRACT-002 |
| UI-014 | Editor ownership of non-core document bodies | done | P2 | UI-006, PLUGINS-001 |
| INFRA-008 | npm packaging & release: the installable `corpus` tool | done | P1 | CLI-002, UI-010 |
| CLI-005 | `corpus workspace upgrade`: refresh template files after a tool update | done | P1 | CLI-002, AGENT-001 |
| SERVER-031 | Empty JSON body returns 500 instead of 400 | done | P2 | SERVER-003 |
| CONTRACT-017 | CreateThreadRequest strictness (silent unanchored threads) | done | P2 | CONTRACT-009 |
| CONTRACT-018 | Rider: `423` on skill-rollback route + inventory docblock (PR #11 review 1, 4) | done | P1 | CONTRACT-008 |
| CONTRACT-019 | Rider: atomic read-modify-write seam on PluginServerContext (PR #11 review 2) | done | P1 | CONTRACT-015 |
| SERVER-034 | Implement PluginServerContext atomic mutate under the document mutex | done | P1 | CONTRACT-019 |
| SERVER-035 | Skill rollback honors edit locks (+ lane TOCTOU, truncation wording) | done | P1 | CONTRACT-018 |
| PLUGINS-004 | Todos mutateItems uses the atomic seam (lost-update fix) | done | P1 | SERVER-034 |
| CLI-014 | `stop` unowned-pidfile deletion + `upgrade --adopt` manifest honesty (PR #11 review 12, 13) | done | P1 | CLI-009, CLI-005 |
| INFRA-011 | Pre-push e2e hermetic vs. a live personal server on 8765 | done | P1 | INFRA-004 |

---

## Phase 5 — Follow-ups: delegation, UX polish, debt (branch `phase-5-followups`)

Phase 4 landed 2026-07-29 (PR #11, squash `1ab882f`). This phase combines the user's
2026-07-29 feature requests (spec pass first), the ready backlog, and the PR #11 review
follow-ups. SHARED-004 is the spec-writer pass — it gates the four feature issues and
carries the §12 + §2.1 wording reconciliation held over from the PR.

| ID | Title | Status | Priority | Dependencies |
| --- | --- | --- | --- | --- |
| SHARED-004 | Spec pass: delegation, doc-abandon, context menu, view width, §12/§2.1/§7 reconciliation | done | P0 | — |
| CLI-013 | corpus init ignores --workspace; guard misses repo-like dirs | done | P1 | CLI-002 |
| CONTRACT-020 | Route: POST /api/skills (skill create) | done | P1 | CONTRACT-008 |
| SERVER-036 | Skill-create write path (documents outside data/docs) | done | P1 | CONTRACT-020 |
| CLI-011 | `corpus skill create` + `corpus doc list` (doc list unblocked; skill create after SERVER-036) | done | P1 | CLI-006, SERVER-019, SERVER-036 |
| AGENT-006 | Comment skill: upgrade skill genesis from propose to create | done | P1 | CLI-011, AGENT-003 |
| CONTRACT-021 | Rider: queue deferred-status surface | done | P2 | CONTRACT-002 |
| SERVER-030 | Queue defer/requeue transition for lock-deferred work | done | P2 | CONTRACT-021, SERVER-008, SERVER-009, AGENT-002 |
| AGENT-007 | Orchestrate skill: replace the `deferred:`-prefixed failure with the defer transition | done | P2 | SERVER-030, AGENT-002 |
| AGENT-005 | Orchestrate skill: delegate jobs to subagents by default | done | P1 | SHARED-004, AGENT-002 |
| UI-017 | Never leave an empty untitled document behind | done | P1 | SHARED-004, UI-005, UI-006 |
| UI-018 | Right-click context menu for actions on the selected item | done | P2 | SHARED-004, UI-004, UI-012 |
| UI-019 | Wider views: user-adjustable view/column width | done | P2 | SHARED-004, UI-003 |
| CLI-012 | Install plugin seed templates at corpus init | done | P2 | PLUGINS-002 |
| UI-015 | Remaining teardown callbacks | done | P2 | UI-012 |
| SERVER-032 | needs=form drops threads with a second answerable form | done | P2 | SERVER-029 |
| SHARED-003 | PR #11 review — non-blocking MINOR/NIT findings ledger (triage) | todo | P2 | — |
| SERVER-037 | POST /api/docs dot-segment folder commits an invisible document | done | P2 | SERVER-005 |
| CLI-015 | `corpus queue defer` verb | done | P1 | CLI-004, CONTRACT-021, SERVER-030 |
| SHARED-005 | Wave-3 spec pass: §12 body-checkbox todos + residual §7 deferral sentences | done | P0 | SHARED-004 |
| PLUGINS-005 | Todos items move into the body as GFM task-lists | done | P1 | SHARED-005 |
| PLUGINS-006 | Todos drops its View: core editor renders items, anchors apply | done | P1 | PLUGINS-005 |
| PLUGINS-007 | Todos column re-sourced off the body aggregate | done | P1 | PLUGINS-005 |
| CLI-016 | `corpus doc edit --extra`: agent-writable extra frontmatter (UI-019 escalation) | done | P1 | CLI-003 |
| CLI-017 | `corpus doc unarchive` + `--status open` half-state fix (evaluator MAJOR) | done | P1 | CLI-003 |
| SERVER-038 | Recovery path for already-committed invisible documents (SERVER-037 TEST-564) | done | P2 | SERVER-037 |
| SERVER-039 | Archived-status guard at the write boundary (audit FIX 5, sole-writer) | done | P1 | SERVER-005 |
| UI-020 | Unarchive affordance in the reader menu (audit SPEC 34) | done | P1 | SERVER-039, UI-012 |
| CLI-018 | Agent-writable view keys: §11 "pin me a view" reachable (audit SPEC 37+38) | done | P1 | CLI-016 |
| UI-021 | Renderer: both-answer-and-form turn divergence (audit FIX 10 follow-up) | done | P2 | UI-008 |

Deferred beyond Phase 5 unless capacity allows: UI-016 (react-router v8), SERVER-033 (@hono/node-server v2).

## Phase 6 — Dogfood feedback + remaining backlog

Phase 5 landed 2026-07-30 (PR #12, squash `ffc9ea8`). The user is dogfooding; this
phase collects their live UX reports plus the ready backlog carried in the Phase 5
table (SHARED-003, SERVER-038, UI-020, UI-021, CLI-018) and the deferred pair
(UI-016, SERVER-033).

| ID | Title | Status | Priority | Dependencies |
| --- | --- | --- | --- | --- |
| CONTRACT-025 | Rider: doctor response gains report-only warnings (SERVER-038 seam) | done | P2 | — |
| UI-022 | Focus mode: redundant back-to-list button next to ✕ Close (user report) | done | P1 | — |
| UI-023 | Reader-open column widening must cap at the content measure (user report) | done | P1 | — |
| UI-024 | Selection context menu (comment on selection) + item menus win over stray selections (user reports) | done | P1 | UI-018, UI-008 |
| UI-027 | Anchor highlights never render in the document body (eval finding, §11) | done | P1 | UI-008 |
| UI-028 | ↵ does not activate context-menu items (eval finding, §11) | done | P2 | UI-018 |
| CLI-022 | No CLI surface for anchored thread creation (CLI-018 finding, §7) | done | P2 | CLI-003 |
| UI-029 | React 18 → 19 across apps/ui, packages/kit, plugins (UI-016 prerequisite) | done | P1 | — |
| UI-030 | Reader ⋯ popover: no keyboard navigation (eval finding) | done | P2 | UI-005 |
| UI-031 | Focus close must not adopt the column under the resting pointer (signed rule) | done | P2 | UI-005 |
| CLI-023 | corpus tree: expose GET /api/tree to the agent (sprint-019 OC2) | todo | P2 | CLI-003 |
| INFRA-013 | npm-audit gate: zero findings at pre-commit and CI (user request; strict after router 8) | done | P1 | UI-016 |
| INFRA-014 | CI packaging: PR tarball artifacts; deliberate v*-tag releases only (user request, amended) | done | P1 | — |
| CLI-024 | SIGPIPE guard for piped output (eval finding) | todo | P2 | CLI-001 |
| UI-032 | Board ↵ shortcut preempts focused chrome buttons (UI-030 escalation) | todo | P2 | UI-028, UI-030 |
| INFRA-015 | Audit checker: overflow/spawn failure must fail closed locally (PR #16 review) | todo | P2 | INFRA-013 |
| CONTRACT-026 | Tag vocabulary source for the search overlay tag chip (UI-026 finding) | todo | P2 | CONTRACT-022 |
| UI-033 | First pointer move after focus-close never activates the hovered column (UI-031 race, v0.1.0 flake diagnosis) | todo | P2 | UI-031 |
| PLUGINS-008 | Legacy frontmatter-items todo renders a silently empty body (dogfood 2026-08-02) | todo | P1 | PLUGINS-005 |
| PLUGINS-009 | Todo item rows: right-click quick actions — toggle, comment, open thread (dogfood) | todo | P2 | PLUGINS-005, PLUGINS-003 |
| PLUGINS-010 | Clicking a todo item opens its document with the item revealed (dogfood) | todo | P2 | PLUGINS-005, UI-037 |
| UI-034 | Task-list items render unstyled: bullet + stacked checkbox (dogfood, sprint-023) | in_progress | P1 | PLUGINS-005 |
| UI-036 | Todo document rows on the board have no context menu at all (sprint-023 OC3) | todo | P1 | — |
| UI-037 | Reveal-target seam: discriminated open payload through kit + reader (sprint-023 OC5) | todo | P2 | — |
| UI-038 | Column header sort control wraps in narrow columns; degrade label to "last ↓" (dogfood) | todo | P2 | — |
| UI-039 | Column query editor: autocomplete + syntax help (dogfood) | todo | P2 | — |
| SERVER-051 | Embed worker emits SSE invalidations for index status (§11 pill rider) | todo | P1 | — |
| UI-040 | Console strip: semantic-index pill with live progress (§11 rider, signed) | todo | P1 | SERVER-051 |
| UI-041 | Copy button on fenced blocks in rendered turns (§11 canvas rider, signed) | todo | P1 | — |
| AGENT-010 | Skills: reusable deliverables go in labeled fenced blocks | todo | P2 | — |
| UI-042 | Clipboard fidelity: rich HTML copy out, rich paste in as markdown (§11 rider, signed) | todo | P1 | — |

Note: the SPEC §11 plugin-surface amendment was **signed 2026-08-02** (sprint-023 OC2: "Amend — plugin menus in"); PLUGINS-009 is unblocked pending UI-037.

## Phase 10 — Self-upgrade (signed rider SHARED-007, 2026-08-02)

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| SHARED-007 | Self-upgrade spec rider — apply to SPEC.md at phase kickoff (orchestrator) | todo | P1 | — |
| INFRA-016 | Release workflow publishes .sha256 checksum asset beside the tarball | todo | P1 | SHARED-007 |
| CLI-025 | `corpus upgrade` / `--check`: fetch latest release, verify, reinstall, conditional server restart | todo | P1 | SHARED-007, INFRA-016 |
| CONTRACT-027 | Upgrade routes: check + trigger | todo | P1 | SHARED-007 |
| SERVER-050 | Upgrade endpoints: check proxy + detached upgrade trigger | todo | P1 | CONTRACT-027, CLI-025 |
| UI-035 | Upgrade UI: on-demand check + "Upgrade & restart" with SSE ride-through | todo | P1 | CONTRACT-027, SERVER-050 |

## Phase 7b — React 19, router 8, CI directives (branch `phase-7b-upgrades-ci`)

User-directed batch (2026-07-31): UI-029 → UI-016 → INFRA-013 (upgrade first, then the
strict audit gate), INFRA-014 in the parallel infra lane; UI-030/031 ride along. Rows
live in the Phase 6 table above. Sprint contract: sprint-020.

## Phase 7 — Retrieval A: retrieval discipline (lexical)

The retrieval track (SHARED-006, spec signed 2026-07-30; scheduling decision: after the
Phase 6 backlog). Phase A: the agent retrieves, never enumerates — over the existing
FTS5 index. SHARED-006's amendment is applied to SPEC.md as this phase's kickoff commit.

| ID | Title | Status | Priority | Dependencies |
| --- | --- | --- | --- | --- |
| SHARED-006 | Spec pass: retrieval (signed; apply amendment at phase kickoff) | done | P0 | — |
| CONTRACT-022 | Routes: GET /api/search + GET /api/docs/{id}/related (frozen shapes) | done | P0 | SHARED-006 |
| SERVER-040 | /api/search: lexical ranked retrieval with heading-path hits | done | P1 | CONTRACT-022 |
| SERVER-041 | /api/docs/:id/related: links-graph expansion | done | P1 | CONTRACT-022 |
| CLI-019 | `corpus search` + `corpus doc related` token-frugal verbs | done | P1 | CONTRACT-022, SERVER-040, SERVER-041 |
| AGENT-008 | Retrieval-first stewardship rules in the product skills | done | P1 | CLI-019 |

## Phase 8 — Retrieval B: semantic index

| ID | Title | Status | Priority | Dependencies |
| --- | --- | --- | --- | --- |
| SERVER-042 | Deterministic heading-path chunker, content-addressed identity | done | P0 | SERVER-040 |
| SERVER-043 | Embedding provider seam: configured > embedded > disabled (OC1-REVISED) | done | P0 | SERVER-042 |
| SERVER-048 | Embedded embedding engine: in-process model, downloaded once, no model server | done | P0 | SERVER-043 |
| SERVER-044 | Async embed worker: never blocks writes, visible staleness | done | P0 | SERVER-042, SERVER-043, SERVER-048 |
| CONTRACT-023 | Routes: index status/rebuild; search staleness flag; similar rows | done | P0 | CONTRACT-022 |
| SERVER-045 | Vector storage + hybrid ranking; related gains `similar` | done | P1 | SERVER-044, CONTRACT-023 |
| SERVER-046 | Index endpoints; rebuild queueing; doctor drift-vs-staleness | done | P1 | SERVER-044, CONTRACT-023 |
| SERVER-049 | Embedded inference off the main thread (SERVER-046 finding; blocks the phase PR) | done | P0 | SERVER-048, SERVER-044 |
| CLI-020 | `corpus index status` / `rebuild`; search degrade note | done | P1 | CONTRACT-023, SERVER-046, CLI-019 |
| INFRA-012 | Pack stays lean: negative proof — no model/runtime/extension ships (rescoped, OC1/OC2) | done | P1 | SERVER-043, SERVER-045 |

## Phase 9 — Retrieval C: auto-context

| ID | Title | Status | Priority | Dependencies |
| --- | --- | --- | --- | --- |
| CONTRACT-024 | Route: GET /api/threads/{id}/context (bounded pack) | done | P0 | CONTRACT-022 |
| SERVER-047 | Context pack assembly | done | P1 | CONTRACT-024, SERVER-041, SERVER-045 |
| CLI-021 | `corpus thread context <id>` | done | P1 | CONTRACT-024, SERVER-047 |
| AGENT-009 | Comment skill starts from the context pack | done | P1 | CLI-021, AGENT-008 |
| UI-025 | Related-documents panel beside backlinks | done | P2 | CONTRACT-022, SERVER-041 |
| UI-026 | ⌘K overlay adopts GET /api/search | done | P2 | SERVER-045 |

---

<!-- Additional phases will be added as the project grows -->
