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
| SHARED-001 | Revise SPEC.md for the standalone-tool architecture | todo | P0 | — |
| CONTRACT-001 | Bootstrap @corpus/contract: zod-openapi routes, spec generation, typed client | todo | P0 | SHARED-001 |

---

## Phase 1 — Core Implementation

| ID | Title | Status | Priority | Dependencies |
|----|-------|--------|----------|--------------|
<!-- Run /decompose after SHARED-001 lands to fill this phase from the revised SPEC.md milestones -->

---

<!-- Additional phases will be added as the project grows -->
