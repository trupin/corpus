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
| SERVER-005 | Doc write paths + git auto-commit with author attribution | todo | P0 | SERVER-002, SERVER-004, SERVER-013 |
| SERVER-006 | Thread write paths: creation, turns, events, cascade | todo | P0 | SERVER-005, CONTRACT-002 |
| SERVER-007 | Watcher + SSE invalidation | in_progress | P0 | SERVER-004 |
| SERVER-008 | Queue over HTTP: event store + long-poll | done | P0 | SERVER-003, CONTRACT-002 |
| SERVER-009 | Document locks + job logs | todo | P0 | SERVER-007, CONTRACT-002 |
| SERVER-010 | Attachments: ingest + serving | todo | P1 | SERVER-006 |
| SERVER-011 | Collection query endpoint: filters + FTS + needs=me | in_progress | P0 | SERVER-004 |
| CLI-001 | CLI scaffold: bin, command registry, workspace resolution, typed client | done | P0 | CONTRACT-001, INFRA-007 |
| SERVER-012 | Anchor engine: partial-path truncated selectors beside edited near-identical siblings | done | P2 | SERVER-002 |
| CONTRACT-003 | Request schemas with `.default()` render as required in the generated client | done | P1 | CONTRACT-002 |
| CONTRACT-004 | Mandatory request bodies are typed optional in the generated client | in_progress | P1 | CONTRACT-002 |
| SERVER-013 | Anchor engine: substitution class — anchors handed unrelated text while their own survives | in_progress | P1 | SERVER-012 |
| CONTRACT-005 | Board contract growth: query-key vocabulary, DocRow staleness + thread fields | todo | P1 | CONTRACT-002 |
| CLI-002 | `corpus init` + server lifecycle verbs | done | P0 | CLI-001, SERVER-003, AGENT-001 |
| CLI-003 | Doc & thread verbs | todo | P0 | CLI-001, SERVER-005, SERVER-006 |
| CLI-004 | Queue, lock, job verbs (agent loop surface) | todo | P0 | CLI-001, SERVER-008, SERVER-009 |

---

## Phase 3 — UI

The board, editor, threads, console. design/index.html is authoritative for look & feel.

| ID | Title | Status | Priority | Dependencies |
|----|-------|--------|----------|--------------|
| UI-002 | @corpus/kit data layer: hooks + SSE bridge | todo | P0 | CONTRACT-002, SERVER-007, UI-001 |
| UI-003 | Board columns: pinned view docs, reorder, new-list | todo | P0 | UI-002, SERVER-011 |
| UI-004 | Type-aware rows: badges, reasons, staleness ramp | todo | P0 | UI-002 |
| UI-005 | Reader, navigation stacks, doc menu, focus shell, lock banner | todo | P0 | UI-003, UI-004 |
| UI-006 | Always-editable TipTap document editor | todo | P0 | UI-005 |
| UI-007 | Anchored threads: highlights, comment-from-selection, chips ↔ margin cards | todo | P0 | UI-006 |
| UI-008 | Thread view, composer, attachments, forms, read state | todo | P0 | UI-005, SERVER-010 |
| UI-009 | Search overlay, omnibox create, save-as-view | todo | P0 | UI-003 |
| UI-010 | Global Ask/Capture composer + keyboard scheme | todo | P1 | UI-008, UI-009 |
| UI-011 | Console drawer: jobs master-detail, live logs, HALT | todo | P1 | UI-002, SERVER-009 |
| INFRA-004 | Merge Playwright e2e coverage into the combined 90% gate | todo | P1 | INFRA-003, UI-001 |

---

## Phase 4 — Agent Loop, Plugins, Packaging

| ID | Title | Status | Priority | Dependencies |
|----|-------|--------|----------|--------------|
| AGENT-002 | Orchestrate skill: the agent's main loop | todo | P0 | CLI-004, AGENT-001 |
| AGENT-003 | Comment skill: thread handling + inbox filing + skill genesis | todo | P0 | CLI-003, AGENT-002 |
| PLUGINS-001 | Plugin extension points: discovery across UI, server, CLI | todo | P1 | UI-003, CLI-001, SERVER-003 |
| PLUGINS-002 | Todos reference plugin | todo | P1 | PLUGINS-001, AGENT-003 |
| INFRA-008 | npm packaging & release: the installable `corpus` tool | todo | P1 | CLI-002, UI-010 |
| CLI-005 | `corpus workspace upgrade`: refresh template files after a tool update | todo | P1 | CLI-002, AGENT-001 |

---

<!-- Additional phases will be added as the project grows -->
