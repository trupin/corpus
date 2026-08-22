# [SERVER-138] Project boards and `stage`, keep one default-open board, and let a stage decide a status

## Domain
server

## Status
todo

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
- SPEC.md §11 — "UI — the board" (boards as documents, kanban boards)

## Summary
The server reads and writes the fields CONTRACT-074 put on the wire, indexes `stage` so it filters, drops `pinned` from the projection, and owns the two rules that are facts about documents rather than gestures: at most one board is `default-open`, and a document's stage decides its status while it is in a kanban. Nothing here migrates a workspace: a view file that still says `pinned: true` projects with that key in `extra`, and CLI-061 tells the agent what to do about it.

## Acceptance Criteria
- [ ] `documents` gains `stage TEXT` (indexed) and `board_json TEXT` (columns, kanban, default-open) and loses `pinned`; the schema version bumps and the projection rebuilds from files on start.
- [ ] `GET /api/docs?stage=x` and `GET /api/search?stage=x` filter exactly; `sort=order` orders boards.
- [ ] Frontmatter `default-open` ↔ wire `defaultOpen`; `kanban`, `columns`, `order`, `stage` round-trip through create, update and `doc show`.
- [ ] A write that sets `default-open: true` on a board clears it on every other board in the same commit; the response's warnings name each cleared board, and nothing is said when none was cleared.
- [ ] A write that changes `stage` (create, update, patch) on a document **in a kanban** also writes `status`: the board's `kanban.status[stage]` when mapped, `open` otherwise; in one commit; the response names the status change beside the stage change. "In a kanban" means: some `type: board` document, not archived, with `kanban.field: stage`, whose scope query matches the document **with archived documents included**. When several kanbans match, the one with the lowest `order` decides and the warning says which.
- [ ] A write that changes only `status` never touches `stage`.
- [ ] A `stage` write is never refused for being off the board's transitions (the UI governs the drag; the CLI and the reader may set any stage).
- [ ] Validation of `kanban` at the write boundary matches CONTRACT-074's refusals; `404`/`400` messages name the field.
- [ ] Unknown frontmatter keys, `pinned` included, keep landing in `extra` unchanged.
- [ ] `unset: [..]` on the update body removes each named key from the file's frontmatter (core or `extra`) in the same commit as any `changes`; `id`, `type`, `created` refuse `400` naming the key; an absent key is a no-op, not an error.
- [ ] A document whose status is **derived** (§12, e.g. `todo`) never has `status` written by the stage coupling: the stage is written, the status is left to its derivation, and the response's warnings say so (§5, amendment signed 2026-08-22).
- [ ] `documents` gains `last_actor TEXT` (`user` | `agent`), written on every write from the acting party the write carried, and `user` for a change the watcher picks up from outside the server (§4); projected as `lastActor` on the row (CONTRACT-074). A rebuild from files reads it from the last commit's author on that path, which is the same fact §4 records.

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
- A kanban over `status` has no stage coupling to run (the field is status itself).
- A document whose `stage` is not in any matching board's `stages`: no status write, and no warning — the stage is simply not part of a kanban's vocabulary yet.
- A board archived after mapping: it no longer decides anything.
- `stage: null` (clearing) on a document in a kanban writes `open` — it is the unmapped case.

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
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-138]` prefix
