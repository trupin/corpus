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
| PLUGINS-008 | Legacy frontmatter-items todo renders a silently empty body (dogfood 2026-08-02) | done | P1 | PLUGINS-005 |
| PLUGINS-009 | Todo item rows: right-click quick actions — toggle, comment, open thread (dogfood) | done | P2 | PLUGINS-005, PLUGINS-003 |
| PLUGINS-010 | Clicking a todo item opens its document with the item revealed (dogfood) | done | P2 | PLUGINS-005, UI-037 |
| UI-034 | Task-list items render unstyled: bullet + stacked checkbox (dogfood, sprint-023) | done | P1 | PLUGINS-005 |
| UI-036 | Todo document rows on the board have no context menu at all (sprint-023 OC3) | done | P1 | — |
| UI-037 | Reveal-target seam: discriminated open payload through kit + reader (sprint-023 OC5) | done | P2 | — |
| UI-038 | Column header sort control wraps in narrow columns; degrade label to "last ↓" (dogfood) | done | P2 | — |
| UI-039 | Column query editor: autocomplete + syntax help (dogfood) | done | P2 | — |
| SERVER-051 | Embed worker emits SSE invalidations for index status (§11 pill rider) | done | P1 | — |
| UI-045 | Kit surface for plugin menus, selectors, mutations (PLUGINS-009 debt; selector-drift hazard) | todo | P1 | PLUGINS-009 |
| UI-046 | Dev-only: StrictMode drops thread reveals on cached docs (PLUGINS-009 finding) | todo | P2 | — |
| UI-040 | Console strip: semantic-index pill with live progress (§11 rider, signed) | done | P1 | SERVER-051 |
| UI-041 | Copy button on fenced blocks in rendered turns (§11 canvas rider, signed) | done | P1 | — |
| AGENT-010 | Skills: reusable deliverables go in labeled fenced blocks | done | P2 | — |
| UI-042 | Clipboard fidelity: rich HTML copy out, rich paste in as markdown (§11 rider, signed) | done | P1 | — |
| INFRA-017 | Coverage merge OOMs: every browser dump parsed at once (PR #19 CI blocker) | done | P0 | — |
| INFRA-018 | Halve the e2e coverage payload at the collector (INFRA-017 follow-up) | todo | P2 | INFRA-017 |
| UI-047 | Flaky spec: focus-ring check tabs before the app is interactive (PR #19 CI) | todo | P2 | — |
| UI-048 | PR #19 re-review MINORs: paste edges, composer draft loss, completion whitespace | todo | P2 | — |
| INFRA-019 | A slow pre-push gate outlives the SSH session git opened (141, blocked v0.2.0 + phase 12) | done | P0 | — |
| SERVER-053 | Flaky: rollback "nothing to restore" needs 1s of a 5s budget, fails under load | todo | P2 | — |

Note: the SPEC §11 plugin-surface amendment was **signed 2026-08-02** (sprint-023 OC2: "Amend — plugin menus in"); PLUGINS-009 is unblocked pending UI-037.

## Phase 10 — Self-upgrade (signed rider SHARED-007, 2026-08-02)

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| SHARED-007 | Self-upgrade spec rider — apply to SPEC.md at phase kickoff (orchestrator) | done | P1 | — |
| INFRA-016 | Release workflow publishes .sha256 checksum asset beside the tarball | done | P1 | SHARED-007 |
| CLI-025 | `corpus upgrade` / `--check`: fetch latest release, verify, reinstall, conditional server restart | done | P1 | SHARED-007, INFRA-016, CLI-027 |
| CONTRACT-027 | Upgrade routes: check + trigger | done | P1 | SHARED-007 |
| SERVER-050 | Upgrade endpoints: check proxy + detached upgrade trigger | todo | P1 | CONTRACT-027, CLI-025 |
| CLI-027 | `corpus workspace diff <path>`: what the tool changed under an edited file | done | P1 | SHARED-007 |
| UI-035 | Upgrade UI: on-demand check + "Upgrade & restart" with SSE ride-through | todo | P1 | CONTRACT-027, SERVER-050 |

Rider **amended 2026-08-03** (signed): `corpus upgrade` also runs the workspace
template sync, and a file the workspace edited that the tool also changed is
reported as **unresolved work** — named, with `corpus workspace diff` to see it,
never auto-merged. The audience for that report is the agent.

## Phase 11 — Edit acknowledgment (signed rider SHARED-008, 2026-08-02)

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| SHARED-008 | Edit-acknowledgment spec rider — apply at phase kickoff (orchestrator) | done | P1 | — |
| CONTRACT-028 | doc.edited queue event + bounded doc-diff route | done | P1 | SHARED-008 |
| SERVER-052 | Edit-session end detection (close flush + 3m inactivity) → actor-scoped emission | done | P1 | CONTRACT-028 |
| CLI-026 | `corpus doc diff` verb | done | P1 | CONTRACT-028, SERVER-052 |
| CONTRACT-031 | Explicit edit-session flush route (SERVER-052 disproved the lock-release premise) | done | P1 | CONTRACT-028, SERVER-052 |
| SERVER-057 | Mount the edit-session flush route (the plan had no issue for the handler) | done | P1 | CONTRACT-031, SERVER-052 |
| SERVER-058 | Diff truncation keeps the frontmatter and drops the change (401 of 16000) | done | P1 | SERVER-052 |
| SHARED-013 | Diff truncation is line-aligned, not hunk-aligned (SIGNED 2026-08-05, applied to §9.2) | done | P2 | SERVER-058 |
| CONTRACT-032 | Diff-truncation contract forces a 401-char answer (SERVER-058 waiver) | todo | P2 | SHARED-013 |
| CLI-028 | Truncation notice says "hunk boundary" when the cut may be a line boundary | todo | P2 | SHARED-013 |
| UI-044 | Reader close flushes the edit session | done | P1 | SERVER-057 |
| AGENT-011 | Orchestrate: reflect-on-edit (retrieval-first ripple check, triviality guidance) | done | P1 | CLI-026 |

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

## Phase 12 — Dogfood wave 2 (signed rider SHARED-009, 2026-08-03)

Five live reports on v0.2.0. Rider signed; apply the SPEC text before the domain
issues start. UI-049/051/052/053 are independent of each other and can run in
parallel once SHARED-009 lands; PLUGINS-011 follows UI-052.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| SHARED-009 | Five SPEC amendments — apply at phase kickoff (orchestrator) | done | P1 | — |
| UI-049 | Images open full-size on click; inline attachment images actually load | done | P1 | SHARED-009 |
| UI-051 | Select text in a turn and comment on it, with the selection quoted | done | P1 | SHARED-009 |
| UI-052 | One composer key contract: ↵ newline, ⌘↵ send, ⇧⌘↵ secondary | done | P1 | SHARED-009 |
| UI-053 | One keyboard contract for all three autocompletes; ⇥ accepts | done | P1 | SHARED-009 |
| UI-054 | Newlines typed into a turn don't render — `a\nb` shows as `a b` (UI-052 finding) | done | P1 | UI-052 |
| UI-050 | Fenced canvases: wrap long lines, collapse tall blocks (2nd report) | done | P1 | SHARED-009 |
| PLUGINS-011 | Todos item composer adopts the composer key contract | done | P2 | UI-052 |
| UI-055 | Design mockup still shows and binds the old composer keys (UI-052 finding) | todo | P2 | UI-052 |
| UI-056 | E2E stub misrepresents anchor resolution; no threads route (UI-051 finding) | done | P1 | UI-051 |
| AGENT-012 | A snippet containing ``` splits into several snippets — widen the fence (dogfood) | done | P1 | AGENT-010 |
| UI-057 | No test guards the widened-fence round-trip (AGENT-012 investigation) | done | P2 | — |
| UI-058 | A "note only" turn still shows "agent is working" (dogfood) | done | P1 | — |
| UI-059 | Links unstyled in rendered bodies; long URLs overflow the measure (dogfood) | done | P1 | — |
| UI-060 | Source trace doesn't reproduce the renderer's block joins; some selections decline (PR #20) | todo | P1 | UI-051 |
| UI-061 | A selection spanning several turns is silently truncated to one (PR #20) | todo | P2 | UI-051 |
| CONTRACT-030 | Jobs query by origin: ask "is a job outstanding for this thread" on the wire | done | P1 | — |
| SERVER-056 | Filter jobs by origin (originId is derived at response time, not a column) | done | P1 | CONTRACT-030 |
| UI-069 | Outstanding-job lookup reads a 50-row window; deferred jobs fall out of it | done | P1 | CONTRACT-030, SERVER-056 |
| UI-062 | Document comment sometimes anchors at the top, not at the selection (dogfood) | done | P1 | — |

<!-- Additional phases will be added as the project grows -->

---

## Phase 13 — Dogfood wave 3 (signed rider SHARED-010, 2026-08-04)

Four live reports on the Phase 12 build. UI-064 and UI-065 are bug/refinement and
need no spec text; UI-063 and UI-066 are new user-visible surfaces and wait on
the rider. UI-062 (comment anchors at the top) is tracked in the wave-2 table and
belongs to the same fix wave.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| SHARED-010 | Three SPEC amendments — apply at phase kickoff (orchestrator) | done | P1 | — |
| UI-064 | `<br>` inside a table cell renders as literal text | done | P1 | — |
| UI-063 | Comments list: open/resolved × anchored/unanchored, both hosts | todo | P1 | SHARED-010 |
| UI-066 | Document body width is resizable, uniformly | todo | P1 | SHARED-010 |
| UI-067 | Comment without selecting; reply to each thread in place (forum-shaped) | todo | P1 | SHARED-010, UI-063 |
| UI-065 | A long document title wraps instead of being cut | done | P2 | — |
| SHARED-012 | Attachments in every comment — SPEC amendment (signed 2026-08-05) | done | P1 | — |
| UI-070 | Attachments in every composer, through one kit surface | todo | P1 | SHARED-012 |
| UI-071 | A highlight briefly lands on the wrong words while a document re-anchors | done | P1 | UI-062 |
| UI-072 | Hard-wrapped prose shows its line breaks in the document editor (dogfood) | done | P1 | — |
| UI-073 | A plugin panel loading late moves the document under the pointer (UI-071 finding) | done | P1 | — |
| UI-074 | Board surfaces have UI-073's late-plugin exposure (rows shift, false "missing" card) | todo | P2 | UI-073 |
| INFRA-020 | Two tests fail under gate load and pass in isolation (pattern, cycles lost) | todo | P2 | — |
| SERVER-060 | A poll ticking mid-requeue reports half a batch as the whole of it (was INFRA-020's 3rd) | done | P2 | — |
| SERVER-055 | Read path implements two of SPEC §6's three anchor rungs; fuzzy rung unwired | reverted | P1 | — |
| SERVER-059 | Orphan repair, not fuzzy resolution — **umbrella**, route chosen 2026-08-07 | done | P1 | UI-068, SERVER-071, CONTRACT-041, SERVER-072, UI-086 |
| UI-075 | UI-069's per-thread jobs query fans out once per thread card (PR #24 review MAJOR) | done | P1 | UI-069 |
| SHARED-015 | Agent sees the server's in-progress set and reconciles it (SIGNED, applied to §7) | done | P1 | — |
| CONTRACT-033 | claim-all/idle carry the in-progress set (id, type, origin, held-since) | done | P1 | SHARED-015 |
| SERVER-061 | Populate the in-progress set from `in-progress/`; settle nothing | done | P1 | CONTRACT-033 |
| CLI-029 | Surface the in-progress set in `corpus queue claim-all`, `--json` included | done | P1 | CONTRACT-033 |
| AGENT-013 | Loop rule: reconcile the in-progress set; never settle what you cannot account for | done | P1 | CLI-029 |
| SHARED-014 | Snippets in every composer (SIGNED 2026-08-05, applied) | done | P1 | — |
| SHARED-016 | Mentions, invocations and bare doc ids render as handles (SIGNED, applied) | done | P2 | — |
| UI-076 | Escalation reads a stale snapshot on a second truncation episode (PR #24 re-review) | done | P2 | UI-075 |
| CLI-030 | Exit 7 promised "nothing changed" on paths that changed things (PR #24 re-review) | done | P1 | CLI-025 |
| UI-077 | Collapse anything, anywhere: by rule + on demand, every placement | done | P1 | SHARED-018 |
| AGENT-014 | Agent resolves a settled subthread in the same turn as its reply | done | P1 | SHARED-019 |
| SERVER-062 | A person's reply reopens a resolved thread (SHARED-019 Amendment 1; fixes UI-078) | done | P1 | SHARED-019 |
| SHARED-017 | Multi-select + bulk actions (SIGNED, applied) | done | P2 | — |
| SHARED-023 | Model choice by consequence; splitting with context isolation (SIGNED, applied) | done | P1 | SHARED-022 |
| UI-083 | Selecting rows and acting on the selection — **rewrite** against SHARED-032, not patch | todo | P2 | SHARED-032, SERVER-087 |
| CONTRACT-048 | The bulk request cannot express a staged set (SHARED-032) | done | P1 | SHARED-032 |
| SERVER-087 | Apply a mixed staged Save as one act, and one commit (SHARED-032) | todo | P1 | CONTRACT-048 |
| SERVER-077 | Apply a bulk action as one act, and one commit (SHARED-017) | done | P2 | CONTRACT-037 |
| SERVER-078 | A nested skill's id changes when the skill above it is archived (PR #37 review) | done | P1 | — |
| CONTRACT-047 | An archive can rewrite a document it never named, and say nothing (PR #38 review) | done | P2 | SERVER-078 |
| SERVER-088 | Emit the carried-skill warnings the contract now publishes (CONTRACT-047) | done | P1 | CONTRACT-047 |
| SERVER-089 | `rollback.test.ts` fails in CI at a git object the fixture should have — **blocks PR #41** | done | P0 | — |
| CLI-037 | Corpus maintains the workspace's git; git no longer maintains it in the background (SERVER-089) | done | P0 | SERVER-089 |
| UI-106 | A carried effect is not an error, and the UI renders every warning as one | todo | P2 | SERVER-088 |
| CONTRACT-037 | One action, one commit: several document mutations as one act (SHARED-017) | done | P2 | SHARED-017 |
| CONTRACT-038 | Form grammar: choose-any and write fields, and the richer answer (SHARED-021) | done | P1 | SHARED-021 |
| SERVER-068 | Parse and answer the richer form grammar (SHARED-021) | done | P1 | CONTRACT-038 |
| UI-084 | Render choose-any and write fields; the attention row that survives being read (SHARED-021) | done | P1 | CONTRACT-038, CONTRACT-040 |
| UI-102 | The e2e stub's row builder returns `unknown`, so field drift is silent (UI-084 finding) | done | P1 | — |
| AGENT-017 | Ask with a form: batch the questions into one form, in one turn (SHARED-021) | done | P1 | SERVER-068 |
| AGENT-018 | Weigh consequence before difficulty; split stages, withhold the gathering context (SHARED-023) | done | P1 | SHARED-023 |
| CONTRACT-039 | A chosen weight has no way to reach the work it governs (SHARED-022) | done | P2 | SHARED-022 |
| SERVER-069 | Carry the chosen weight into the dispatch, and name it in the job log (SHARED-022) | done | P2 | CONTRACT-039 |
| SHARED-018 | Collapse anything, anywhere — on demand and by rule (SIGNED, applied) | done | P1 | — |
| SHARED-019 | Agent resolves settled subthreads (SIGNED, applied) | done | P1 | — |
| SHARED-020 | Collect subthread answers; agent revises its latest turn (SIGNED 2026-08-05, applied) | done | P1 | — |
| UI-078 | Resolve confirmation promises replying reopens the thread; it does not | done | P1 | — |
| SHARED-021 | Richer forms: choose-any, write fields, and the attention asymmetry (SIGNED, applied) | done | P1 | — |
| SHARED-022 | Choosing the model for a request — weight levels, honoured as a directive (SIGNED, applied) | done | P2 | — |
| UI-082 | Composer offers the weight; the orchestrator honours it (SHARED-022) | done | P2 | SHARED-022, CONTRACT-039, SERVER-069, AGENT-015 |
| AGENT-015 | Skill states the weight levels the picker reads, and honours a stated one | done | P2 | SHARED-022 |
| PLUGINS-014 | The todos composer offers no weight control (PR #35 review) | todo | P2 | UI-082 |
| CONTRACT-034 | Stale prose: a resolved thread no longer stops re-triggering (SERVER-062 finding) | todo | P2 | SERVER-062 |
| CLI-031 | `job list --status`/`--origin`: the full in-progress inventory from the CLI | done | P2 | CLI-029 |
| SERVER-063 | One unreadable queue file stops the server booting (SERVER-061 finding) | done | P1 | — |
| SERVER-064 | One unreadable document stops the server booting; the docblock forbids it | done | P1 | — |
| UI-079 | `reveal.spec` waits on a decoration with a finite lifetime (duration-shaped) | todo | P2 | — |
| UI-080 | Ten e2e sites send a key straight after click() with no focus wait | todo | P2 | — |
| SERVER-065 | Plugin discovery says "never throws" and throws, killing boot | todo | P2 | — |
| INFRA-021 | Audit gate: narrow expiring exception for GHSA-5p4m-2wfm-xmqj (expires 2026-10-01) | done | P1 | — |
| INFRA-022 | `npm version --workspaces` leaves every workspace manifest uncommitted (v0.4.0 cut) | done | P1 | INFRA-008 |
| INFRA-023 | New nanoid advisory blocks every commit; scoped override clears it | done | P1 | INFRA-010 |
| AGENT-019 | Loop block renders dispatch as a comment; chaining `claim-all && idle` drops it | done | P0 | — |
| UI-087 | Child threads render twice in a thread reader — per turn and again below the body | done | P1 | — |
| SHARED-024 | `isParent`: a view can show top-level documents only (SIGNED, applied) | done | P1 | — |
| CONTRACT-042 | No filter can express "top-level only", so views cannot exclude children | done | P1 | SHARED-024 |
| SERVER-073 | Answer `isParent` in the collection query | done | P1 | CONTRACT-042 |
| UI-088 | A view cannot be told to show top-level documents only | done | P1 | CONTRACT-042, SERVER-073 |
| CLI-032 | `corpus doc list` cannot ask for top-level documents only | done | P2 | CONTRACT-042, SERVER-073 |
| SHARED-025 | A changelog in the document instead of a thread per change (SIGNED, applied) | done | P1 | — |
| SHARED-026 | A write is refused when it would not read back (SIGNED, applied) | done | P1 | — |
| SHARED-027 | An agent turn says which model wrote it (SIGNED, applied) | done | P1 | — |
| SHARED-028 | Four riders signed one by one; §4 contradiction with SHARED-025 found and fixed (SIGNED, applied) | done | P1 | — |
| CONTRACT-043 | A turn has nowhere to record the model that wrote it | done | P1 | SHARED-027 |
| SERVER-074 | Write the deciding model onto the agent's turn | done | P1 | CONTRACT-043 |
| UI-090 | Show which model wrote an agent turn | done | P1 | CONTRACT-043, SERVER-074 |
| CLI-033 | Nothing can state a model, so every turn shows blank (SERVER-074 finding) | done | P1 | SERVER-074 |
| AGENT-021 | The agent states the model that wrote the turn | done | P1 | CLI-033 |
| PLUGINS-013 | An installed plugin skill teaches a reply without `--model` (AGENT-021 finding) | done | P1 | AGENT-021 |
| SERVER-075 | A person's reply with an unterminated fence swallows every later turn | done | P0 | — |
| SERVER-076 | A turn body can still fabricate a turn heading on the reply path (SERVER-075 finding) | done | P2 | SERVER-075 |
| CONTRACT-044 | The UI cannot pre-check a fence, because the scanner lives in the server | done | P1 | — |
| UI-091 | Pre-check the two refusals the composer still cannot see | done | P2 | CONTRACT-044 |
| INFRA-024 | A prose-only commit pays the full ten-minute gate — **superseded by INFRA-025** | closed | P1 | — |
| INFRA-025 | Defer the slow suites to CI; run only fast tests locally | done | P1 | — |
| AGENT-020 | Noting a change writes to the document's changelog, not a new thread | done | P1 | SHARED-025 |
| UI-089 | The changelog's older entries clip, and the clip reports its size | done | P2 | SHARED-025, AGENT-020 |
| AGENT-016 | Closing fence must sit on its own line — an unclosed fence swallows later turns | done | P0 | — |
| SERVER-066 | `doc check` reports an unterminated fence, naming the line it opened on | done | P1 | — |
| SERVER-067 | Non-blocking errors reach the log but not the response: needs a §14 warning-channel decision | todo | P2 | SERVER-066 |
| UI-081 | Console's job list / log split is not resizable (SIGNED §11 line applied) | todo | P2 | — |
| CONTRACT-036 | Thread resource carries no `unread`; the UI derives it (PR #25 re-review) | todo | P2 | — |
| CONTRACT-035 | `JobList` carries no `total`, so a windowed answer looks complete (CLI-031 finding) | todo | P2 | CLI-031 |
| CONTRACT-040 | An open form's count is not on the row, so "more than one" cannot be shown (UI-084 finding) | done | P2 | CONTRACT-038 |
| SERVER-084 | Count the unanswered forms on a row, from the query that already finds them | done | P1 | CONTRACT-040 |
| SERVER-070 | A malformed form still reaches disk through thread creation (SERVER-068 finding) | todo | P2 | SERVER-068, CONTRACT-038 |
| UI-085 | The e2e stub answers unhandled routes with `{}` instead of failing (UI-078 finding) | todo | P2 | — |
| UI-068 | Selector capture quotes the canonical spelling, not the file's (SERVER-059 phase A) | done | P1 | UI-062 |
| SERVER-071 | `thread create` stores the context it was sent, so agent anchors are born context-free (SERVER-059 phase A) | done | P1 | — |
| CONTRACT-041 | A thread has no way to be re-attached to a range a person chose (SERVER-059 phase B) | done | P1 | — |
| SERVER-072 | Write the corrected selector when a person re-attaches a thread (SERVER-059 phase B) | done | P1 | CONTRACT-041, SERVER-071 |
| UI-086 | An orphaned comment offers candidate sites, and the person picks (SERVER-059 phase B) | done | P1 | CONTRACT-041, SERVER-072 |
| PLUGINS-012 | Todos item composer takes attachments (2nd kit-consumer test) | todo | P2 | UI-070 |

## Phase 14 — Dogfood wave 4: status semantics, no edit mode, bulk staging (2026-08-08)

Seven live reports, filed in a worktree while the weight-travels phase (PRs
#30–35) ran concurrently. Nine riders lead, and **nothing below them starts
before its rider is signed** — SHARED-031 in particular re-bases SHARED-036, so
the two are read in that order.

The wave's throughline is that three surfaces disagree with the contract they
sit on. `DOC_STATUSES` is type-independent, yet the row menu gates Resolve on
threads; §11 abolishes edit mode, yet frontmatter kept one; §12 makes a todo's
items the record, yet nothing reads them into its status. SHARED-031 settles the
vocabulary all three were guessing at.

SHARED-032 revises the bulk-selection rider signed 2026-08-05 **before** UI-083
implements it — the design changed while it was still only text, which is the
cheapest moment for that to happen.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| SHARED-031 | `status` is one vocabulary, not per-type (DRAFTED — sign-off) | todo | P1 | — |
| SHARED-036 | A todo list says `open` after its last item is checked (DRAFTED — sign-off) | todo | P1 | SHARED-031 |
| SHARED-030 | Frontmatter hides behind an edit mode the reader abolished (DRAFTED — sign-off) | todo | P1 | — |
| SHARED-032 | Bulk actions are a mode, staged per row, the one edit/save left (SIGNED 2026-08-09, applied) | done | P1 | SHARED-030 |
| UI-093 | Frontmatter controls are always live and save on change | todo | P1 | SHARED-030 |
| PLUGINS-016 | A plugin doc type can derive its own status | todo | P1 | SHARED-036 |
| SERVER-085 | The board, queries and the file all agree on a derived status | todo | P1 | SHARED-036, PLUGINS-016 |
| UI-092 | A derived status shows its value and its source, uneditable | todo | P2 | PLUGINS-016, SERVER-085, UI-093 |
| PLUGINS-015 | The Todos column's checkbox opens the item instead of checking it | todo | P1 | SHARED-036 |
| UI-094 | Right-clicking a document offers no Resolve, though every document has one | todo | P2 | SHARED-031 |
| SHARED-038 | `--unstable` reaches §2.4 before it reaches the code (DRAFTED — sign-off) | todo | P1 | — |
| INFRA-026 | A PR's package cannot be told from any other PR's | todo | P1 | — |
| CLI-034 | `corpus upgrade --unstable` installs the latest PR build | todo | P2 | SHARED-038, INFRA-026 |
| UI-095 | Clicking a comment does not take you to it, opened | todo | P1 | — |
| UI-096 | The collapse control is a 13px glyph crowded against resolve | todo | P2 | — |
| SHARED-033 | The UI claims an agent that is not working, and one that is not there (DRAFTED — sign-off) | todo | P1 | — |
| UI-097 | A request nobody has picked up says "agent is working…" | todo | P1 | SHARED-033 |
| CONTRACT-045 | `QueueStatus` cannot say whether an agent is there | todo | P1 | SHARED-033 |
| SERVER-086 | The server does not record that an agent is there | todo | P1 | CONTRACT-045 |
| UI-098 | The console says `agent: idle` when no agent exists | todo | P1 | CONTRACT-045, SERVER-086 |
| UI-099 | Commenting on a document selection leaves no visible anchor | done | P0 | — |
| UI-103 | Opening a document and typing one character can silently restructure a list (UI-099 finding) | done | P0 | — |
| UI-104 | The first save still rewrites 68 of 618 documents, and one changes meaning (UI-103 sweep) | done | P1 | UI-103 |
| UI-105 | `soft-wrap.spec.ts` places the caret at the end of a visual line, and flakes | todo | P2 | — |
| UI-100 | Focus mode shows two controls that read as the same exit | todo | P2 | — |
| SHARED-035 | Styled text: in the body, stripped for retrieval, themed by a style doc (DRAFTED — sign-off) | todo | P1 | — |
| SHARED-034 | Full-screen editing has no persistent formatting toolbar (DRAFTED — sign-off) | todo | P1 | SHARED-035 |
| SHARED-037 | The patch operation reaches §9.2 before it reaches the code (DRAFTED — sign-off) | todo | P1 | — |
| CONTRACT-046 | The only body edit is a whole-body replacement | todo | P1 | SHARED-037 |
| SERVER-079 | Apply an anchored string patch through the ordinary write path | todo | P1 | SHARED-037, CONTRACT-046 |
| CLI-035 | `corpus doc patch` — edit a line without shipping the document | todo | P1 | SHARED-037, CONTRACT-046, SERVER-079 |
| UI-101 | Build the persistent formatting toolbar for focus mode | todo | P1 | SHARED-034 |

## Phase 29 — Commit windows: a commit per act, not per save (2026-08-10)

SHARED-040, signed 2026-08-10 and applied to §4, replaced "Autosave and commit
granularity" with **commit windows**. Today the write path folds saves along two
axes — same document *and* same actor. §4 now scopes the window to the **party
alone**, so the agent's stewardship for one queue event is one commit that names
the thread it answered, rather than one commit per document it touched.

SERVER-091 is the mechanism and everything else waits on it; 092, 093 and 094 are
independent of each other and run in parallel behind it. **SERVER-091 carries one
adjudication the implementer must not re-litigate**: keep the eager-commit-then-
amend mechanism, do not build a deferred commit buffer — the rider's "holds work
outside git" is a stated worst-case bound, not an instruction, and a buffer
contradicts §5 and §14 harder than the amend model does.

SERVER-090 is not part of the rider and is deliberately filed apart from it: an
external editor's change is committed under the *next* mutation's author, or not
at all. It is a defect on its own terms and must not be recorded as a consequence
of a design change.

The sweep found one live contradiction the rider leaves behind — §4 line 179's
"the squashing above is about repeated saves of **one** document" is now false of
the mechanism above it — plus a §7 absolute worth one cross-reference. Both are
one-clause corrections **held for user sign-off** in `issues/shared/040`; neither
changes behaviour and nothing below waits on them.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| SHARED-040 | Commit on acts, not saves — commit windows (SIGNED 2026-08-10, applied) | done | P1 | — |
| SERVER-091 | A commit window belongs to a party, not to a document | done | P1 | SHARED-040 |
| SERVER-092 | Every act closes the window it ends, and names it | done | P1 | SERVER-091 |
| SERVER-093 | Nothing reads a history the open window is still holding | done | P1 | SERVER-091 |
| SERVER-094 | A window never outlives the server silently | done | P1 | SERVER-091 |
| SERVER-095 | Resizing a board column wakes the agent to reflect on it (user report) | done | P0 | — |
| SERVER-096 | Dragging a column wider moves its document to the top of every list (SERVER-095 finding) | todo | P2 | — |
| SERVER-097 | A `doc.edited` range starts at a commit that touched a different document (SERVER-095 finding) | todo | P1 | — |
| SERVER-090 | An external editor's change is committed under someone else's name, or not at all | todo | P1 | — |

## Phase 30 — A key instead of a lock (2026-08-11)

SHARED-041, authorized and applied to §7. The per-document edit lock is
**removed** — not deprecated beside the new mechanism, because two coexisting
mechanisms is how the forgettable one survives.

The user's report: agents forget to lock. Verified, and worse than reported — §7
claimed the CLI's edit verbs locked implicitly, they never did, the skill told
the agent to do it by hand, and the user's live workspace holds zero lock files
against a git log full of agent edits. **A lock is forgettable because forgetting
it still lets the write through.** A key cannot be, because a write without a
valid one does not happen: enforcement moves from the agent's memory into the
write path.

CONTRACT-049 is the wire shape and everything waits on it. SERVER-098 adds keys
and SERVER-099 removes locks — separate so each is reviewable, landing together.
CLI-038 and UI-107 are the two writers. **AGENT-022 is the one that decides
whether this works**: the skill instructions are what made the old mechanism
forgettable, and a mechanism the agent cannot misuse is not the same as one it
uses well.

Two things carried forward from the rider: the key is **derived from content**
rather than issued, so there is no registry and an out-of-band edit invalidates
it for free; and §4's "Three acts commit alone" is now **two** — this deletes the
force-unlock flush SERVER-092 built on 2026-08-10, which is correct under the new
mechanism rather than waste.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| SHARED-041 | A key you must present, not a lock you can forget (AUTHORIZED 2026-08-11, applied) | done | P0 | — |
| CONTRACT-049 | A key on every read, and on every write that overwrites | done | P0 | SHARED-041 |
| SERVER-098 | Derive the key, verify it, and refuse with the document | done | P0 | CONTRACT-049 |
| SERVER-099 | Remove the lock subsystem | todo | P0 | SERVER-098 |
| CLI-038 | `corpus doc read` hands you a key; the write verbs demand one | done | P0 | CONTRACT-049, SERVER-098 |
| UI-107 | The board presents a key, and never goes read-only | todo | P0 | CONTRACT-049, SERVER-098 |
| AGENT-022 | The skills teach keys, and stop teaching locks | todo | P0 | CLI-038 |
| PLUGINS-017 | The todos plugin writes from a read it captured, and the key now catches it | todo | P0 | CONTRACT-049, SERVER-098 |
