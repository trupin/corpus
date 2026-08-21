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
| PLUGINS-003 | Item-level anchored commenting on plugin-rendered docs (design closed; impl = PLUGINS-005/006/007) | done | P1 | UI-014 |
| INFRA-010 | npm audit cleanup: scoped overrides, eslint 10, phantom deps | done | P2 | INFRA-001 |
| SERVER-033 | @hono/node-server v2 migration (serve-static traversal advisory) | done | P1 | SERVER-003 |
| UI-016 | Migrate to react-router v8 (audit advisory; RSC-CSRF not applicable) | done | P1 | UI-029 |
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
| UI-070 | Attachments in every composer, through one kit surface | done | P1 | SHARED-012 |
| UI-071 | A highlight briefly lands on the wrong words while a document re-anchors | done | P1 | UI-062 |
| UI-072 | Hard-wrapped prose shows its line breaks in the document editor (dogfood) | done | P1 | — |
| UI-073 | A plugin panel loading late moves the document under the pointer (UI-071 finding) | done | P1 | — |
| UI-074 | Board surfaces have UI-073's late-plugin exposure (rows shift, false "missing" card) | todo | P2 | UI-073 |
| INFRA-020 | Two tests fail under gate load and pass in isolation (pattern, cycles lost) | todo | P2 | — |
| SERVER-060 | A poll ticking mid-requeue reports half a batch as the whole of it (was INFRA-020's 3rd) | done | P2 | — |
| SERVER-055 | Read path implements two of SPEC §6's three anchor rungs; fuzzy rung unwired | closed | P1 | — |
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
| SERVER-087 | Apply a mixed staged Save as one act, and one commit (SHARED-032) | done | P1 | CONTRACT-048 |
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
| UI-081 | Console's job list / log split is not resizable — needs a one-line SPEC amendment signed | blocked | P2 | — |
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
| PLUGINS-012 | Todos item composer takes attachments (2nd kit-consumer test) | done | P2 | UI-070 |

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
| SHARED-031 | `status` is one vocabulary, not per-type | done | P1 | — |
| SHARED-036 | A todo list says `open` after its last item is checked | done | P1 | SHARED-031 |
| SHARED-030 | Frontmatter hides behind an edit mode the reader abolished | done | P1 | — |
| SHARED-032 | Bulk actions are a mode, staged per row, the one edit/save left (SIGNED 2026-08-09, applied) | done | P1 | SHARED-030 |
| UI-093 | Frontmatter controls are always live and save on change | todo | P1 | SHARED-030 |
| PLUGINS-016 | A plugin doc type can derive its own status | todo | P1 | SHARED-036 |
| SERVER-085 | The board, queries and the file all agree on a derived status | todo | P1 | SHARED-036, PLUGINS-016 |
| UI-092 | A derived status shows its value and its source, uneditable | todo | P2 | PLUGINS-016, SERVER-085, UI-093 |
| PLUGINS-015 | The Todos column's checkbox opens the item instead of checking it | done | P1 | SHARED-036 |
| UI-094 | Right-clicking a document offers no Resolve, though every document has one | todo | P2 | SHARED-031 |
| SHARED-038 | `--unstable` reaches §2.4 before it reaches the code | done | P1 | — |
| INFRA-026 | A PR's package cannot be told from any other PR's | todo | P1 | — |
| CLI-034 | `corpus upgrade --unstable` installs the latest PR build | todo | P2 | SHARED-038, INFRA-026 |
| UI-095 | Clicking a comment does not take you to it, opened | done | P1 | — |
| UI-096 | The collapse control is a 13px glyph crowded against resolve | todo | P2 | — |
| SHARED-033 | The UI claims an agent that is not working, and one that is not there | done | P1 | — |
| UI-097 | A request nobody has picked up says "agent is working…" | done | P1 | SHARED-033 |
| CONTRACT-045 | `QueueStatus` cannot say whether an agent is there | done | P1 | SHARED-033 |
| SERVER-086 | The server does not record that an agent is there | done (absorbed by SERVER-112) | P1 | CONTRACT-045 |
| UI-098 | The console says `agent: idle` when no agent exists | done | P1 | CONTRACT-045, SERVER-086 |
| UI-099 | Commenting on a document selection leaves no visible anchor | done | P0 | — |
| UI-103 | Opening a document and typing one character can silently restructure a list (UI-099 finding) | done | P0 | — |
| UI-104 | The first save still rewrites 68 of 618 documents, and one changes meaning (UI-103 sweep) | done | P1 | UI-103 |
| UI-105 | `soft-wrap.spec.ts` places the caret at the end of a visual line, and flakes | todo | P2 | — |
| UI-100 | Focus mode shows two controls that read as the same exit | todo | P2 | — |
| SHARED-035 | Styled text: in the body, stripped for retrieval, themed by a style doc | done | P1 | — |
| SHARED-034 | Full-screen editing has no persistent formatting toolbar | done | P1 | SHARED-035 |
| SHARED-037 | The patch operation reaches §9.2 before it reaches the code | done | P1 | — |
| CONTRACT-046 | The only body edit is a whole-body replacement | done | P1 | SHARED-037 |
| SERVER-079 | Apply an anchored string patch through the ordinary write path | done | P1 | SHARED-037, CONTRACT-046 |
| CLI-035 | `corpus doc patch` — edit a line without shipping the document | done | P1 | SHARED-037, CONTRACT-046, SERVER-079 |
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
| SERVER-097 | A `doc.edited` range starts at a commit that touched a different document (SERVER-095 finding) | done | P1 | — |
| SERVER-102 | Adding a tag merges in bulk and races on a single document (PR #43 review) | done | P1 | — |
| SERVER-103 | A rollback replaces a whole file and presents nothing (PR #43 review) | blocked | P0 | needs a CONTRACT issue first |

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
| SERVER-099 | Remove the lock subsystem | done | P0 | SERVER-098 |
| CLI-038 | `corpus doc read` hands you a key; the write verbs demand one | done | P0 | CONTRACT-049, SERVER-098 |
| UI-107 | The board presents a key, and never goes read-only | done | P0 | CONTRACT-049, SERVER-098 |
| AGENT-022 | The skills teach keys, and stop teaching locks | done | P0 | CLI-038 |
| PLUGINS-017 | The todos plugin writes from a captured read, and still reaches for a lock | done | P0 | CONTRACT-049, SERVER-098, UI-107 |


### Phase 30 addendum — a revert is a write like any other (SHARED-042, 2026-08-12)

PR #43's review found `corpus skill rollback` destroys uncommitted edits
unrecoverably. The user's answer — revert rather than overwrite — led further: a
revert is a write whose content came from history, so the verb goes and the skill
teaches the loop. **SERVER-090 is promoted from P1 tidiness to load-bearing**:
with no verb, the operator's recovery is a hand `git restore`, and §7 now
guarantees the watcher commits it as the `user` edit it is.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| SHARED-042 | A revert is a write like any other (applied 2026-08-12) | done | P0 | SHARED-041 |
| CLI-040 | Remove `corpus skill rollback` — the route and the verb | done | P0 | SHARED-042 |
| AGENT-023 | Teach the revert loop, and the operator's git path | done | P0 | SHARED-042 |
| SERVER-104 | Delete the server's rollback module | done | P0 | SHARED-042 |
| SERVER-090 | An external editor's change is committed under someone else's name, or not at all | done | P0 | SHARED-042 |
| CLI-041 | `corpus doc diff` dies with `EPIPE` when piped into `head` (AGENT-023 finding) | todo | P2 | — |
| SERVER-105 | The fold guard is blind at directory granularity (PR #43 review, latent) | done | P1 | — |
| SERVER-106 | §4 says archiving closes a window; archiving through `PUT` does not (PR #44 review) | todo | P2 | — |
| CLI-042 | `--json` carries no `hint`, so a machine caller is told what happened and not what to do | done | P1 | — |
| INFRA-027 | `issues/PLAN.md` and the issue files disagree, and nothing checks (PR #44 review) | done | P1 | — |

### Phase 33 — the reader's shape follows the person using it (2026-08-16)

Filed from use rather than from a plan. The user, writing a comment on a long
section: *"I often have to scroll up to see what I'm commenting on… I want to be
able to keep typing while seeing the content I'm commenting on."* The reply box
sits in ordinary flow, so reading what you are answering and seeing where you
type it are currently exclusive.

Three more from the same sitting, all the same shape — **the surface you write
in gets in the way of the thing you are writing about**. `UI-111` is not a
feature request but a **spec-compliance defect**: §11's rider of 2026-08-05 says
"every composer takes attachments" and names "a comment on a document selection"
in its own list, and that popover has no attachment code at all. `UI-112` is the
comment modal sitting on the evidence, and a highlight that arrives only after
the comment is posted — `useTurnComments.tsx` says it outright: "the highlight is
the anchor the server resolved", i.e. painted at the moment it stops mattering.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| UI-110 | The composer you are typing in stays visible while you scroll what you are commenting on | done | P0 | — |
| UI-111 | The comment popover takes no attachments, and §11 says every composer does | done | P0 | — |
| UI-112 | The comment popover can be moved, and what it is about stays lit while you write | done | P0 | — |
| UI-113 | A column shrinks when you open something in it, and cannot be resized while it is open | done | P0 | — |
| SERVER-113 | `GET /api/docs/{id}/diff`'s default base is a commit that touched a different document (SERVER-097 finding) | done | P1 | — |
| UI-116 | No e2e spec has ever posted an attachment, on any surface (PLUGINS-012 finding) | done | P1 | — |
| UI-117 | `anchor-layer.spec.ts:475` reads between two generations of highlight (UI-116 finding) | done | P2 | — |

### PR #48 review — REQUEST_CHANGES, 2026-08-17

The pr-reviewer ran cold on the phase branch and returned six MAJOR findings.
Four are fixed before merge; two are recorded here because they are the user's.

The one that matters most to how this phase was run: **finding 2 overturned my
own adjudication of `SHARED-044`.** I recorded origin-first as decided after the
agent I spawned for an independent read died before reading anything, and said
so in the issue — the reviewer supplied the second opinion and disagreed, on the
ground that §7 lists `origin` as a scope edge only for *documents*, and that
origin-first has no beneficial case: the only input where it differs from
parent-first is the one where it annexes another scope's conversation.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| SERVER-117 | The scope walk abandons the parent edge, so a resident loses conversations on its own artifacts | done | P0 | — |
| SERVER-118 | `GET /api/queue/idle` accepts any thread id as a scope, and `agent.live` then lies | done | P0 | — |
| UI-118 | An explicit recipient equal to the client's computed lane is sent as absence | done | P0 | — |
| AGENT-029 | A resident working longer than the grace window reads as absent, and gets a second listener | done | P0 | — |
| CONTRACT-058 | `GET /api/queue/idle` does not declare the 422 it now returns (SERVER-118 finding) | done | P1 | SERVER-118 |

**PR #48 re-review — REQUEST_CHANGES again, 2026-08-17.** The cold reviewer
returned a CRITICAL and three MAJORs against the fixes themselves. **The CRITICAL
is an orchestration failure, not a domain one**: `SERVER-117` (fix the server's
scope walk) and `UI-118` (make an explicit pick reach the wire) ran in parallel
and neither was told the other existed. The client keeps its own copy of that
walk in `packages/kit/src/recipient/scopeWalk.ts`, still on the deleted
`origin ?? parent` — which was a label bug until `UI-118` armed the picker, and
is now a routing bug. Both suites are green and each asserts it encodes the
other's rule.

The other three are the same shape one layer out: `SERVER-118` changed a
behaviour and its consumers were not swept — the CLI's help still promises the
old server, and the converse skill both teaches it and has no instruction for
the refusal, so a release timed one rearm badly strands a claimed event and
skips the sign-off. `AGENT-031` is a defect in `AGENT-029`'s own fix: its
discriminator is a conjunction whose second clause discards the signal the
moment a second message arrives.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| UI-119 | The client's scope walk still follows the rule SERVER-117 deleted | done | P0 | — |
| AGENT-030 | The converse skill teaches the old server, and dies at the shell on a refused park | done | P0 | — |
| AGENT-031 | The stand-down rule is a conjunction, and the second conjunct throws away the signal | done | P0 | — |
| CLI-048 | `--thread`'s help asserts the behaviour SERVER-118 removed | done | P1 | — |

**PR #48 third review — one MAJOR, 2026-08-17.** The reviewer was asked to hunt
for rules written down twice, having caused the previous round's CRITICAL, and
found one this round had created: `AGENT-029` wrote the stand-down rule into
**both** skills and `AGENT-031` fixed only `converse`. The copies now
contradict, and orchestrate's is the justification for its "let the lane settle
it" invariant. **Fourth finding in three passes from one rule in two places.**

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| AGENT-032 | The stand-down rule is written in both skills, and they now contradict | done | P0 | — |
| CONTRACT-060 | The grace window is derived two different ways, and both tests pass by coincidence | done | P1 | — |
| UI-120 | A stale statement of the walk's order, and a hand-copied server message that drifted | done | P2 | — |
| SERVER-120 | Two leftovers from PR #48's fourth review: a stale literal, and a rule the pin cannot see | todo | P2 | — |
| UI-121 | A highlight blinks out between the optimistic mark and the server's (UI-117 finding) | todo | P1 | — |
| CONTRACT-059 | `PUT /api/docs/{id}` returns 403 and declares none (CONTRACT-058 sweep) | todo | P1 | — |
| SERVER-119 | Nothing checks that a status the server returns is one the contract declares | todo | P1 | — |

**Two findings are the user's, not mine to close:**

- **SPEC.md was edited in this PR without sign-off** (`5356a8a9 [CONTRACT-051]`,
  two §9.2 bullets), which breaches a standing constraint. The content describes
  SHARED-043's already-signed rider rather than new behaviour, and the issue
  file for that very change says "This package never edits SPEC.md" — so the
  commit and its issue contradict each other. It also adds a fresh `§9.2`
  citation, increasing the count `SHARED-046` was filed to reduce. Awaiting the
  user's decision: ratify, revert, or amend.
- The reviewer confirmed **no defect in `SERVER-115`** after enumerating all 17
  `bus.invalidate` sites and re-deriving the declared status-pair table, which
  is worth recording since that was the largest forced addition to this release.
| SERVER-114 | An agent arriving never reaches the console — presence invalidates the wrong key (UI-098 finding) | done | P0 | — |
| AGENT-028 | Two product skills still say the empty tree is the repository's first commit (CLI-045 finding) | done | P1 | — |
| CONTRACT-055 | `QUERY_KEY_VOCABULARY` does not say that queue transitions change the roster | done | P0 | — |
| SERVER-115 | Six emitters never name `["agents"]`, and this release is what makes them bite | done | P0 | CONTRACT-055 |
| SERVER-116 | "Ranking is degraded" keeps saying so after the index has caught up | todo | P1 | — |
| CONTRACT-052 | The diff route's published description tells API consumers the wrong default base | done | P1 | SERVER-113 |
| CLI-045 | `corpus doc diff --help` describes the old default base | done | P2 | SERVER-113 |
| CONTRACT-053 | `QueueStatus.agent` is defined against the roster, and the two can legitimately disagree | todo | P2 | SERVER-112 |
| CLI-046 | `corpus queue status` never shows whether an agent is there | done | P1 | SERVER-112 |
| CONTRACT-054 | Designating an archived agent succeeds silently, and the response cannot say so | todo | P2 | — |
| CLI-047 | `corpus doc create` prints no key, so a create-then-edit turn needs a second read | todo | P2 | — |
| CONTRACT-056 | `Job` carries no lane, so a surface showing "who is waiting on this" has to guess | todo | P1 | — |
| CONTRACT-057 | A roster row cannot say a lane is working, so a reader has to guess or parse prose (AGENT-029 finding) | todo | P1 | — |

**Scope addition, forced 2026-08-16.** `CONTRACT-045` made `QueueStatus.agent`
a required field, which breaks every constructor of one: `SERVER-086` (the
server's status handler) and `UI-098` (the console model and its fixtures). Both
are pulled into this release rather than left — a contract nothing satisfies is
not a shippable state, and the rule this release is being run under is that a
release which starts a feature finishes it. `CONTRACT-045`'s own report also
notes that `SERVER-086` is now partly superseded: its standalone "last agent
contact" scalar is exactly the second definition of liveness the shared
vocabulary removed, so it must aggregate `SERVER-112`'s tracker rather than keep
its own clock.

**Third scope addition, 2026-08-16 — `CONTRACT-055` + `SERVER-115`, forced by
this release's own UI work.** `SERVER-114`'s sweep found six more emitters that
never name `["agents"]` although they change what the roster would answer — queue
transitions, job-log appends, a designated thread's title, projection rebuild,
out-of-band thread edits and queue-event moves, and deleting a designated root
thread. They are latent **only because nothing caches `/api/agents` yet**, and
`UI-108` and `UI-109` exist to put the roster on screen. The day either lands a
cached `useAgents`, all seven become live staleness bugs: a recipient picker that
keeps offering an agent that left, a board that keeps showing a resident whose
thread was deleted. So this release either fixes them or ships the feature and
the bugs together. `SERVER-116` (the index's "degraded ranking" word, same shape,
three routes and one key) is **not** pulled in: it is a different subsystem, and
its fix is a real design question — the obvious emit makes every progress tick
re-read every board column.

**Second scope addition, 2026-08-16 — `PLUGINS-012`.** `UI-111` audited every
surface §11's attachment rider names and fixed all but one: the Todos plugin's
*Comment on item* composer, which it could not reach, because a plugin may import
only `@corpus/kit` and the kit published no intake hook at the time. `UI-070` has
now published it — that was its entire purpose. So this release would otherwise
ship a §11 claim ("every composer takes attachments") with one composer in the
repo still refusing files, which is exactly the half-finished feature the release
rule forbids. Pulled in.

**Scope for v0.10.0** (agreed 2026-08-16). This phase carries the four issues
above plus three that share their theme and their files: `UI-070` (attachments
through one kit surface — `UI-111` is its missing half, and doing them apart
means extracting the same surface twice), `UI-095` (clicking a comment does not
take you to it) and `PLUGINS-015` (the Todos checkbox opens the item instead of
checking it). Two correctness bugs ride along because they sit in files this
phase is already in: `SERVER-102` (adding a tag races on a single document) and
`SERVER-097` (a `doc.edited` range starts at a commit that touched a different
document — in the provenance path v0.9.0 shipped).

### Unrowed backlog — issues that existed with no PLAN row (INFRA-027, 2026-08-13)

Seven issue files were on disk and in nobody's plan, which is the quieter half of
the drift `INFRA-027` closes: a stale row is at least visible, an issue with no
row is invisible. Found by the check rather than by eye, and listed here so they
are schedulable. They are unstarted work, not a phase — the priorities are the
ones their own files carry.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| SHARED-002 | Reconcile SPEC.md with adjudicated Phase 2 behavior (PR #9 findings 2–4) | done | P0 | — |
| SHARED-011 | Structured filtering — arbitrary fields and glob matching (SIGNED 2026-08-04, applied at its phase kickoff) | todo | P1 | — |
| SERVER-054 | The board row's pending-agent dot uses the heuristic UI-058 just replaced | todo | P1 | UI-058 |
| CONTRACT-029 | `Job.started` means two different instants | todo | P2 | — |
| CLI-039 | A hung `git gc` leaves children the timeout does not kill | todo | P2 | — |
| SERVER-100 | A document with no `title:` wakes the agent on the save that adds one | todo | P2 | — |
| SERVER-101 | Starting a thread is not one of §4's acts, so its commit gets renamed | todo | P2 | — |

### Found in flight during Phase 33, deliberately not in v0.10.0 (2026-08-16)

Both were surfaced by `UI-070`'s agent while running the suite for an unrelated
change, and neither is caused by this phase's work. They are filed rather than
folded in: the release scope grew twice already, and a harness bug and a keyboard
route are not what this release is about.

`INFRA-028` is the more useful of the two, because it explains a confusion this
repo has been living with. Vite proxies `/api` to `127.0.0.1:8765` by default, so
running `npm run e2e` beside a live workspace server makes two "server
unreachable" specs fail against a server that is, in fact, reachable. That has
been written off repeatedly as "the pair that needs 8765 free" — a true statement
of the symptom that leaves every local run carrying two failures a reader has to
remember to discount. Two expected failures is how three unexpected ones get
through.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| INFRA-028 | Running the e2e suite beside a live workspace server silently tests the wrong thing | todo | P1 | — |
| UI-114 | `⇧F10` does not open the todo item menu, and the e2e spec that says so is red | done | P1 | — |
| SHARED-044 | §7 claims an artifact belongs to at most one scope, and its four clauses do not guarantee it | todo | P1 | — |
| SHARED-045 | SPEC §9.2 still says the diff base is `to`'s parent, which §4 made wrong | todo | P1 | SERVER-113 |
| SHARED-047 | §7 does not say whether parked listeners count against the concurrency bound | todo | P2 | — |
| UI-115 | A deferred request reads as "waiting", which is honest but not the whole answer | todo | P2 | UI-097 |

`SHARED-044` is the one of the three that is not merely deferred work. `SERVER-111`
had to pick a precedence between an artifact's own `origin` and its `parent`
chain when the two reach different designated scopes, and §7 states a guarantee
("an artifact belongs to at most one scope") whose stated reason — origin is
single-valued — covers only one of the two routes into a scope. The code took
origin-first and ships that way; what needs a signed rider is the spec sentence
that made both readings look correct. It needs user sign-off, so it cannot ride
in v0.10.0 unattended.

### Phase 31 — the anchored patch reaches the skills (2026-08-12)

CONTRACT-046, SERVER-079 and CLI-035 shipped `corpus doc patch`. §9.2's bullet
says **the agent's skills prefer it over a whole-body edit for bounded changes**,
which is a promise about the workspace template rather than about the route — and
it was false until the skills knew the verb existed.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| AGENT-024 | The skills reach for a patch when the change is bounded | done | P0 | CLI-035 |
| SERVER-107 | A resolved document does not age — and the ramp never heard about it (PR #44 review) | done | P0 | SHARED-031 |
| SERVER-108 | Unarchiving returns a document to `resolved`, not to `open` (PR #44 review) | done | P1 | SHARED-031 |

## Phase 32 — A resident agent for a conversation (2026-08-12; rider AUTHORIZED and applied 2026-08-13)
A top-level (standalone) thread can designate a **resident**: a long-lived agent
that owns the thread's whole **scope** — the thread, its subthreads, and every
artifact whose provenance walks back to it — and runs its own claim → work →
settle → park loop on a **lane** of the queue. Messages in the scope reach the
resident directly, warm, with no dispatch hop, which is what makes a Corpus
conversation stop feeling async. Users see who is running (`corpus agents`, the
composer's roster) and pick a recipient per message; the default is computed from
where they post, and an override routes one message without rewiring anything.
This deliberately revokes three standing doctrines, which is why SHARED-043 gates
everything: the single-consumer assumption becomes **one consumer per lane**,
"queue state never crosses the subagent boundary" becomes **a lane's owner settles
its own lane**, and §7's "every event is delegated — the orchestrator never works
a job inline" is scoped to the orchestrator's lane: **a resident works its
conversation inline**. Fallback keeps the revocation safe: presence is the parked scoped
`idle`, and a lane whose listener lapses falls back to the orchestrator at claim
time — slower, never silent, nothing rewritten.
Provenance (CONTRACT-050/SERVER-110/CLI-044) is the load-bearing first step and is
independently valuable: `CORPUS_JOB` makes every write name the job it serves, the
`↳` trace line verifiable, and scope membership computable rather than stored.
**AGENT-025 is the one that decides whether this works** — the converse skill is
where "direct conversation with a subagent" either feels synchronous or doesn't.
| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| SHARED-043 | A resident agent for a conversation (AUTHORIZED 2026-08-13, applied to §7/§8/§9.2) | done | P0 | — |
| CONTRACT-050 | Every write can name the job it serves | done | P0 | SHARED-043 |
| CONTRACT-051 | Lanes, designation, and the roster on the wire | done | P0 | SHARED-043 |
| SERVER-110 | Stamp a document with the thread it came from | done | P0 | CONTRACT-050 |
| SERVER-109 | Designate a resident, and dissolve it cleanly | done | P0 | CONTRACT-051 |
| SERVER-111 | The queue learns lanes | done | P0 | CONTRACT-051, SERVER-110, SERVER-109 |
| SERVER-112 | Presence is a parked request — liveness and the roster | done | P0 | SERVER-111 |
| CLI-044 | Mutating verbs carry the job they serve | done | P0 | CONTRACT-050, SERVER-110 |
| CLI-043 | Lane verbs, designation, and `corpus agents` | done | P0 | CONTRACT-051, SERVER-111, SERVER-112, SERVER-109 |
| AGENT-025 | The converse skill — a resident's own loop | done | P0 | SHARED-043, CLI-044, CLI-043 |
| AGENT-026 | Orchestrate learns to share the queue | done | P0 | AGENT-025, CLI-043 |
| AGENT-027 | The converse skill can still adopt work the orchestrator is holding (AGENT-026 finding) | done | P0 | AGENT-026 |
| UI-108 | The composer offers the recipient | done | P0 | CONTRACT-051, SERVER-111, SERVER-112 |
| UI-109 | The board shows who is resident, and who is live | done | P1 | CONTRACT-051, SERVER-112 |

## Phase 34 — A resident without a profile (2026-08-17; rider SHARED-048 SIGNED)
v0.10.0 shipped resident agents and the user could not reach them: `corpus init`
creates `.claude/agents/` holding a `.gitkeep`, so the designate menu says *"no
agent-def documents in this workspace"* and offers nothing. Two independent
causes, both found 2026-08-17.
**A profile was never required.** §7 says a standalone thread *"may designate a
resident agent"* and stops; the requirement was invented one layer down by
`DesignateResidentRequestSchema`'s non-blank `name`. SHARED-048 states the rule
§7 always implied — a designation may name a profile or **none**, and everything
else about a resident is identical either way.
**And the agent could not create one.** `orchestrate/SKILL.md:1392` tells the
agent *"a new `type: agent-def` document is all it takes"*, architecture decision
2 confines it to the CLI, and `corpus doc create --type agent-def` writes to
`data/docs/inbox/` — the agent-def root refuses creation two ways. It survived
because a misfiled agent-def **works**: the roster query filters on frontmatter
`type`, never on path, so every test passes and the only symptom is personas in
the inbox with the wrong id shape.
The user asked for a skill to create profiles and will test it by hand against
the shipped release, which is why AGENT-034 is in scope rather than deferred.
| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| SHARED-048 | A resident need not have a profile (SIGNED 2026-08-17) | done | P0 | — |
| SHARED-046 | SPEC.md cited a §9.4 that does not exist; corrected to §9.2 everywhere | done | P1 | — |
| CONTRACT-061 | A designation may name no profile | done | P0 | SHARED-048 |
| SERVER-121 | Designate a resident without naming a profile | done | P0 | CONTRACT-061 |
| SERVER-122 | `.claude/agents/` is a legal create target | done | P0 | — |
| CLI-049 | `corpus thread designate` without naming an agent | done | P1 | CONTRACT-061, SERVER-121 |
| CONTRACT-062 | `FOLDER_DESCRIPTION` describes two routes whose grammars have diverged | done | P1 | SERVER-122 |
| CLI-050 | `corpus doc create --type agent-def` lands in `.claude/agents/` | done | P0 | SERVER-122 |
| CONTRACT-063 | `MoveDocRequest.folder` is required and still says it defaults to `inbox` | done | P2 | CONTRACT-062 |
| UI-122 | The designate menu offers a general resident first, and never dead-ends | done | P0 | CONTRACT-061, SERVER-121 |
| AGENT-033 | A resident with no persona to bind | done | P0 | CONTRACT-061, SERVER-121, CLI-049 |
| AGENT-034 | A skill that creates an agent profile | done | P0 | SERVER-122, CLI-050 |
| SERVER-123 | A created agent-def carries none of Claude Code's frontmatter, and nothing says so (AGENT-034 finding) | done | P1 | SERVER-122 |
| SERVER-124 | Under a `.claude/` root, Corpus's own frontmatter goes entirely unvalidated (PR #49 review 3) | done | P1 | SERVER-123 |
| SERVER-125 | An off-root agent-def is offered, resolvable, and dead (PR #49 review 5) | done | P1 | SERVER-123 |
| AGENT-036 | A transcript line the CLI cannot print; SERVER-125 made the other finding true | done | P2 | — |
| AGENT-035 | A `$` in a quoted argument is eaten by the shell, and no skill says so (AGENT-033 finding) | done | P1 | — |
| INFRA-029 | Nothing checks that a SPEC cross-reference names a real section (PR #49 review) | done | P1 | — |
| SHARED-049 | SPEC enumerates two product skills and the workspace ships four (SIGNED 2026-08-20) | done | P2 | — |
| UI-123 | The autocomplete offers what the server now refuses (SERVER-125 consequence) | done | P0 | SERVER-125 |
| CONTRACT-064 | The designate schema still states the pre-SERVER-125 resolution rule (PR #50 review sweep) | done | P1 | SERVER-125 |
| SERVER-127 | A bare .claude/skills/SKILL.md is addressable and loaded by nothing (UI-123 derived fixture) | done | P1 | SERVER-125 |
| SHARED-051 | A persona is addressable by where it lives, and §11 said otherwise (SIGNED 2026-08-19) | done | P0 | SERVER-125 |
| SHARED-052 | A check can report what a save accepts, and §14 says it cannot (SIGNED 2026-08-20) | done | P1 | SERVER-124 |
| SHARED-053 | §7 says a renamed or archived profile goes missing; archiving does not (SIGNED 2026-08-20) | done | P1 | — |

**v0.12.0** is the `done` rows above: *everything the profile release left
half-true*. One story, one tag. The controlled-language work below is a second
story and gets its own.

**Five issues were agreed with the user on 2026-08-18. Nine shipped.** The four
additions each came from a review finding about work already in the release, not
from new scope:

| added | why it could not wait |
| --- | --- |
| UI-123 | SERVER-125 left both client surfaces offering rows the server had begun refusing — its own acceptance criterion forbids that |
| CONTRACT-064 | the same resolution rule, stated stale at four contract sites, two of them published to the wire |
| SERVER-127 | SERVER-125's gate condition, in a shape that change missed — found by UI-123's derived fixture |
| CONTRACT-065, SERVER-126 | filed **out** of scope, to stop the release growing further |

Three review rounds, and each round found the previous round's fix incomplete
rather than wrong. That is the record worth keeping: the first review found the
rule stated stale in the CLI, the second found it in the contract, the third
found a clause the contract sweep had itself rewritten and left false.

**Four riders are drafted and unsigned** — SHARED-049, -050, -051, -052. SPEC.md
is unchanged by this phase. The waiver is the orchestrator's, recorded here and
in the release notes rather than described as unnecessary.

## Phase 35 — Write to be read once (2026-08-18, user directive)

The user asked for the ASD-STE100 skill to be installed by default and applied
consistently to all communication with them. ASD-STE100 is a controlled-language
standard from the aerospace and defence industry. It removes the two largest
sources of misreading: words with more than one meaning, and sentences with more
than one possible structure. The vendored skill borrows the discipline for a
reader who cannot ask a clarifying question.

**Three things were settled with the user before any work started**, and none of
them is open: it goes into **both** the harness and the product; it applies to
**everything the product agent writes**, thread replies included; and the mode is
**STE-flavored**, not Strict.

**A skill file alone is inert.** A skill fires when something invokes it, and
this one's triggers are on-demand. The behaviour the user asked for is the
standing rule that sits beside the file — in `CLAUDE.md` for the harness, and in
the workspace template for the product. Either half alone does nothing.

The two halves are deliberately separate trees. `.claude/` is the development
harness and reaches no user, so **INFRA-030 ships nothing** and lands straight on
`main`. `assets/workspace/` is the product, so AGENT-037 is what a user receives
and is the whole of **v0.13.0**.

**The cost is known and accepted.** The skill warns against applying STE where
voice is the point, and the user chose everything the agent writes. Replies to a
person about their own document will read flatter. AGENT-037 reports how the
comment skill reads afterwards, because that is the surface where the cost lands.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| INFRA-030 | The orchestrator writes in controlled language (harness; ships nothing) | done | P1 | — |
| SHARED-050 | The product agent's register is controlled language (SIGNED 2026-08-19) | done | P1 | — |
| AGENT-037 | The workspace ships the skill, and the agent writes by it | done | P1 | INFRA-030, SHARED-050 |

### Found in flight during Phase 34, deliberately not in v0.12.0 or v0.13.0

Surfaced by AGENT-035's implementer, which named the idea and did **not** file it
so as not to prejudge it. Filing it here preserves the idea without widening
either release. Its first acceptance criterion is a measurement that may close it
unbuilt, which is the right first step for a mechanism whose necessity is
uncertain.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| CLI-051 | A flag value that never touches the shell (AGENT-035 finding) | todo | P1 | — |
| SERVER-126 | Should a description-less SKILL.md fail doc check? (SERVER-124 residual) | todo | P2 | SERVER-124 |
| CONTRACT-065 | A move refuses by its source, and nothing published says so (CONTRACT-064 sweep) | todo | P2 | — |
| CONTRACT-066 | A menu filters a page the server already truncated (PR #50 review 3 NIT) | todo | P2 | — |
| UI-124 | The board badge's resident note truncates, and always has (PR #50 review 3 measurement) | todo | P2 | — |
| SHARED-054 | The missing-profile causes are typed again, one layer out (PR #50 review 4) | todo | P2 | — |
| CLI-052 | doc move's help omits .claude/ from what cannot be moved (PR #50 review 4 NIT) | todo | P3 | — |

## Phase 36 — Residents you can see, stop, and choose (2026-08-19, user feedback)

Five reports from the user after running residents for real. One of them turned
out to be a **contradiction between two signed riders**, and it is the root of
three of the five symptoms — so SHARED-055 gates most of this phase.

**The contradiction.** §7's weight rider (signed 2026-08-06) says a stated weight
is *"honoured, not weighed again"* and *"travels to whatever actually does the
work"*. §7's resident rider (signed 2026-08-13) says *"a resident works its
conversation inline"*. Neither mentions the other. A resident is a running
session on a fixed model, so it cannot honour a weight for its **own** turn
without discarding the conversation it exists to hold. The `converse` skill
instructs it to anyway, with a failure clause that cannot detect its own failure
— which is why the user saw the choice discarded **silently**.

**What was already true.** The user asked to *"make sure"* residents work serially
and inline, without hopping between subagents. They do, by the skill's own text
and by design. What is missing is that nothing **proves** it — AGENT-038 is that,
not a behaviour change.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| SHARED-055 | A resident cannot honour a stated weight, and §7 says it must (SIGNED 2026-08-19) | done | P0 | — |
| SERVER-128 | Releasing a resident tells nobody | done | P0 | CONTRACT-069 |
| CONTRACT-067 | A designation carries the model its resident runs at | done | P0 | SHARED-055 |
| CONTRACT-068 | A scope is computed, and nothing can ask what is in it | done | P0 | — |
| UI-125 | The console shows who is resident and what they own | done | P0 | CONTRACT-068 |
| UI-126 | The composer is overloaded, and one of its controls does nothing | done | P0 | SHARED-055 |
| AGENT-038 | A resident works serially and inline, and nothing proves it | done | P0 | SHARED-055 |
| CONTRACT-069 | A release reaches the wire as an event | done | P0 | — |
| SERVER-129 | A designation stores and reports its weight | done | P0 | CONTRACT-067 |
| SERVER-130 | The server answers what a scope holds | done | P0 | CONTRACT-068 |
| CLI-053 | `corpus thread designate` names a weight, and `corpus agents` prints it | done | P0 | CONTRACT-067, SERVER-129 |
| CLI-054 | `corpus thread scope` lists what a resident owns | done | P1 | CONTRACT-068, SERVER-130 |
| AGENT-039 | A listener is launched at the designation's weight | done | P0 | CONTRACT-067, SERVER-129, CLI-053, CONTRACT-069 |
| SERVER-131 | A claim batch is in `readdir` order, not the conversation's (AGENT-038 drill) | done | P0 | — |
| SHARED-056 | §7 enumerates the core events, §9.2 the routes, §11 the console (SIGNED 2026-08-20) | done | P1 | CONTRACT-068, CONTRACT-069, UI-125 |
| SERVER-132 | An ill-shaped `resident:` block vanishes a designation, and nothing reports it (PR #52 review) | todo | P2 | SERVER-129 |

## Phase 37 — Nothing moves under your cursor (2026-08-20, user report)

Two reports in one day, and the second is the first generalized. A P0: *"The drop
down to pick an agent when commenting is blinking up and down which makes it
impossible to use."* Then the class behind it: *"Elements resize based on their
content, which then moves other elements that are stacked on top of it or aligned
right."*

**Nothing in SPEC.md forbade it**, which is why it shipped. SHARED-057 is the
rule, signed before the audit measures anything against it — an audit without a
rule produces taste, and an audit with one produces findings a person can check.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| SHARED-057 | Nothing resizes because of what it holds (SIGNED 2026-08-20) | done | P0 | — |
| UI-127 | The recipient picker oscillates under the pointer | done | P0 | SHARED-057 |
| UI-128 | Audit: every surface whose size follows its content | done | P0 | SHARED-057 |
| UI-130 | The address popover has no ceiling, and rises behind the reader head (UI-127 measurement) | done | P1 | — |
| UI-137 | The address line widens when its weight arrives, and pushes Send (UI-131 measurement) | done | P0 | SHARED-057 |
| UI-138 | A lane's liveness word re-cuts the name beside it, on a 15s clock (PR #53 review) | todo | P2 | — |
| UI-136 | Two surfaces are drawn taller than the room they open into (UI-129/130 findings) | todo | P2 | — |

**UI-128's ledger ranks six reachable clusters**, each measured in a real browser
and each filed below in the order a person hits them. The audit also found that
UI-127's hover shape occurs in **exactly one place** — the class behind it is the
late-arriving value, which is three of these six.

| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| UI-129 | An image reserves no box until it decodes (rank 1) | done | P0 | UI-128 |
| UI-135 | The reader head's controls leave the column after a save (rank 2) | done | P0 | UI-128 |
| UI-131 | A label that arrives late reflows the row it lands in (rank 3) | done | P0 | UI-128 |
| UI-132 | The toast stack collapses toward its anchor (rank 4) | done | P1 | UI-128 |
| UI-133 | The console strip's height is its text, and the board pays (rank 5) | done | P1 | UI-128 |
| UI-134 | Counts and durations are not digit-stable (rank 6) | done | P2 | UI-128 |

**Two things UI-128 escalated rather than filed.** `.title-grow`
(`Reader.css:168-215`) makes the title box's height its text **on purpose** —
UI-065 argued for it and SHARED-057 was signed after, so it is a spec
adjudication, not a defect. And eight latent sites look reachable on reading and
lack only a browser measurement (`RefNodeView`, `ScopeProvenance`, the anchor
chips, the search filter chips, the todo item preview, `useAnchorLayer`'s
margin-mode guard, the todo comment popover's guessed size, and the autocomplete's
stale `top`) — a second sweep should measure those eight first.

**The riders v0.14.0 carried forward are signed and applied in this phase**:
SHARED-049, -052, -053, -056 as drafted. SHARED-053's two stale quotations were
corrected with it.

**The audit ran against the signed rule and found 12 reachable sites in 6
clusters, 31 latent, 58 compliant.** All six reachable clusters were built, plus
three more the fixes themselves surfaced: the popover's missing ceiling (UI-130),
the address line pushing Send (UI-137), and the reader head's overflow (UI-135).
`.title-grow` was adjudicated compliant under SHARED-057's stated exception.

**Left filed, and named rather than omitted**: UI-136 (three surfaces drawn
larger than the room they open into), SHARED-054's code half, SERVER-132, and the
31 latent sites — eight of which the ledger flags as promotion candidates.

**Phase 36 landed 2026-08-19/20**, and is the scope agreed for v0.14.0 — a release is a separate, deliberate act and is not in the phase's PR. Fourteen issues: the seven filed
from the user's reports, six filed to make them usable end to end, and one
correctness bug a drill found (SERVER-131 — the claim batch was in `readdir`
order, so a resident could answer the third message before the first).

**Three agents were killed mid-flight by a session limit and three more by an
expired login**, each at its last step, with code written and tests green but no
E2E log. The orchestrator verified and closed all six by hand rather than
respawning. Two defects surfaced only in that sweep: a test stub declaring two
members `BoardNavigation` does not have, which broke `apps/ui`'s typecheck, and
a `String(unknown)` that would have printed `[object Object]` at a person.

**2026-08-19, v0.14.0 scope agreed.** SHARED-055 signed as drafted. Six issues
added so the release ships the feature whole rather than its wire and a stamp:
the event type a release travels as, the server and CLI halves of designation
weight and scope, and the orchestrate skill that turns a weight into a model at
launch. The decisions each issue was filed on are recorded in the issue under
*Decided by the orchestrator, 2026-08-19*.
