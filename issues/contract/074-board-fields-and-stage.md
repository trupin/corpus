# [CONTRACT-074] Board fields, `stage`, and the end of `pinned`

## Domain
contract

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SHARED-064 (riders 2, 5, 6, 7 signed)
- Blocks: SERVER-138, CLI-060, CLI-061, UI-148, UI-152

## Spec References
- SPEC.md §5 — "The document model" (`stage`, the coupling rule)
- SPEC.md §9.2 — "HTTP API" (`GET /api/docs` params, the document row)
- SPEC.md §11 — "UI — the board" (boards as documents, kanban boards)

## Summary
A board is a `type: board` document whose frontmatter lists its columns, its position, its kanban definition and whether it receives the explorer's opens. `stage` is a new core field on every document. `pinned` goes away: nothing reads it once a board lists its columns. This issue puts all of that on the wire — schemas, route definitions, the generated `openapi.json` and the typed client — so the server and the three clients build against one shape. **Breaking by the user's decision (2026-08-22)**: `pinned` and the `pinned=` filter are removed, not deprecated; CLI-061 tells an existing workspace what to do.

## Acceptance Criteria
- [ ] `DocRow` carries `stage: string | null`, `columns: string[] | null`, `kanban: Kanban | null`, `defaultOpen: boolean`, and `order: number | null` documented as "a board's position among boards".
- [ ] `DocRow` no longer carries `pinned`; `DocsQuerySchema` no longer accepts `pinned`; `sort=order` stays.
- [ ] `DocsQuerySchema` accepts `stage=<string>`; `GET /api/search` does too.
- [ ] `"board"` is in `CORE_DOC_TYPES`; `DocTypeSchema` stays an open string.
- [ ] Create and update bodies accept `stage`, `columns`, `kanban`, `defaultOpen`, `order`; a write refuses, with a message naming the field, when: `kanban.field` is not `status` or `stage`; `kanban.stages` is empty or has duplicates; a `transitions` key or value is not in `stages`, or a value equals its key; a `status` map key is not in `stages` or a value is not `open | resolved | archived`; `kanban.field` is `status` and a stage is not one of the three.
- [ ] `npm run generate -w packages/contract` is idempotent and the drift check passes; `openapi.json` is committed.
- [ ] Schema round-trip tests cover a board with every field, a kanban over `status`, a kanban over `stage` with transitions and a status map, and each refusal above.

## Technical Design

### Files to Create/Modify
- `packages/contract/src/schemas/doc.ts` — `KanbanSchema`, the board fields, `stage`, remove `pinned` (lines ~319-325 hold the view block today)
- `packages/contract/src/schemas/query.ts` — remove `pinned` (lines ~248-260), add `stage` to `docFilterShape`
- `packages/contract/src/routes/*.ts` — bodies for create/update carry the new fields
- `packages/contract/openapi.json` — regenerated
- `packages/contract/src/**/*.test.ts` — round trips and refusals

### Key Implementation Details
```ts
export const KANBAN_FIELDS = ["status", "stage"] as const;
export const KanbanSchema = z.object({
  field: z.enum(KANBAN_FIELDS),
  stages: z.array(z.string().min(1)).min(1),
  transitions: z.record(z.string(), z.array(z.string())).optional(),
  status: z.record(z.string(), DocStatusSchema).optional(),
}).superRefine(/* the refusals in the acceptance criteria */);
```
- The board fields live beside the view fields in the same "first-class, present on every row" block, defaulting to `null`/`false`/`[]`-free nulls exactly as `query` and `column` do today, so a note's row carries `columns: null, kanban: null, defaultOpen: false`.
- `order` keeps its schema line; only its description changes. `sort=order` keeps its semantics (nulls last, then title, then id) — it now orders boards.
- `stage` joins `docFilterShape` so `/api/docs` and `/api/search` get it together; like `status`, it is an exact match.
- Key names on the wire are camelCase (`defaultOpen`); the frontmatter key is `default-open` — the server maps, as it does for every field today.

### Edge Cases
- A `type: view` document that still carries `pinned`/`order` in its file: not the contract's problem; the server puts unknown keys in `extra` (SERVER-138) and CLI-061 names the migration.
- `transitions` missing a stage means that stage leads nowhere by drag; `transitions` absent altogether means the linear funnel (a UI rule; the contract only validates shape).

## Testing Strategy
Vitest round trips in `packages/contract`; one test per refusal; a test that `pinned` in a query is rejected as unknown.

## E2E Verification Plan
### Verification Steps
1. `npm run build && npm run generate -w packages/contract && git diff --exit-code packages/contract/openapi.json`.
2. `npm run typecheck` across workspaces: every consumer that read `pinned` fails to compile until its own issue lands — expected, and why the server/UI issues depend on this one.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review against riders 2, 5, 6, 7

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[CONTRACT-074]` prefix
