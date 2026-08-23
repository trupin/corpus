# [CONTRACT-074] Board fields, `stage`, and the end of `pinned`

## Domain
contract

## Status
done

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
- SPEC.md §10 — "UI — the board" (boards as documents, kanban boards)

## Summary
A board is a `type: board` document whose frontmatter lists its columns, its position, its kanban definition and whether it receives the explorer's opens. `stage` is a new core field on every document. `pinned` goes away: nothing reads it once a board lists its columns. This issue puts all of that on the wire — schemas, route definitions, the generated `openapi.json` and the typed client — so the server and the three clients build against one shape. **Breaking by the user's decision (2026-08-22)**: `pinned` and the `pinned=` filter are removed, not deprecated; CLI-061 tells an existing workspace what to do.

## Acceptance Criteria
- [x] `DocRow` carries `stage: string | null`, `columns: string[] | null`, `kanban: Kanban | null`, `defaultOpen: boolean`, and `order: number | null` documented as "a board's position among boards"; `query` (already on the row as `ViewQuerySchema | null`) is documented as "a view's query, or a kanban board's scope".
- [x] `DocRow` carries `lastActor: "user" | "agent"` — the acting party of the document's last write (§4 attribution; an out-of-band edit the watcher picks up is `user`). It is what §7's reflection marks and counts read, so it is on the row rather than behind a request.
- [x] The update body accepts `unset: string[]` beside `changes`: each named frontmatter key is removed (core or `extra`); `id`, `type`, `created` refuse with a message naming the key. This is what CLI-060's `--unset` and CLI-061's migration send.
- [x] `DocRow` no longer carries `pinned`; `DocsQuerySchema` no longer accepts `pinned`; `sort=order` stays.
- [x] `DocsQuerySchema` accepts `stage=<string>`; `GET /api/search` does too. (Ticked 2026-08-23 after PR #58's review found it left unticked though implemented — `stage` is on both parameter lists in `openapi.json`, with tests.)
- [x] `"board"` is in `CORE_DOC_TYPES`; `DocTypeSchema` stays an open string.
- [x] Create and update bodies accept `stage`, `columns`, `kanban`, `defaultOpen`, `order`; a write refuses, with a message naming the field, when: `kanban.field` is not `status` or `stage`; `kanban.stages` is empty or has duplicates; a `transitions` key or value is not in `stages`, or a value equals its key; a `status` map key is not in `stages` or a value is not `open | resolved | archived`; `kanban.field` is `status` and a stage is not one of the three.
- [x] `npm run generate -w packages/contract` is idempotent and the drift check passes; `openapi.json` is committed.
- [x] Schema round-trip tests cover a board with every field, a kanban over `status`, a kanban over `stage` with transitions and a status map, and each refusal above.

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

### Decision: `stage=` is comma-separated OR, and its **empty element** is the null sentinel (2026-08-22)

UI-152 asked this issue to decide, and the answer is the server form.

**The shape.** `stage=` takes a comma-separated list, values OR together exactly
as `type` and `tag` do, and each is an exact match. **An empty element selects
documents with no `stage` at all.** So:

- `stage=review` — that stage.
- `stage=,triage` — nothing, or `triage`: a kanban's **first column in one
  request**, which is what §10 asks for (the first stage *and* everything
  unstaged sit in it).
- `stage=` — the unstaged alone. Omitting the parameter filters nothing.

**Why OR at all, and not just a presence flag.** A `hasStage=false` would AND
with `stage=triage` and select nothing, so the first column would still be two
requests ORed in the client. The union has to be expressible inside one
parameter or the sentinel buys nothing.

**Why the empty element and not a word like `none`.** It cannot collide. A
written stage is a non-empty string, so the empty element names a value no
document can hold; a reserved word would be a stage vocabulary the product
forbids, and §5 calls `stage` free-form.

**What it costs, and why that is the same price already paid.** A stage may not
contain a comma — `StageValueSchema` refuses one on write, with the filter named
in the message — exactly as tags are "validated comma-free on write, so the
separator needs no escaping scheme". One reserved character is the price of being
filterable, which §5 asks for in the same sentence that calls the field
free-form.

**A kanban over `status` needs none of this**: every document has a status, so
its columns are `status=` and the first-column rule is vacuous there.

### Decision: `lastActor` is declared once and the predicate is shipped

CONTRACT-076's `changed` count and UI-153's per-row mark are the same question at
two grains, so they are not two descriptions. `lastActor` is one field object on
`docRowBaseShape` (not on `DocFrontmatter` — it is projected, not a frontmatter
key, and claiming a file key that does not exist would be a lie), and the rule
itself ships as `isUnreflected` in `schemas/reflect.ts`, which the server counts
with and the UI marks with. `ReflectStatus.changed`'s published prose names that
function, so a client can check its own marks against the number.

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

**contract-dev, 2026-08-22, on opus** (model actually run: opus).

**1. Generation is idempotent.** `npm run generate -w packages/contract` twice in
a row, diffing `git diff --stat` between the runs: identical
(`1597 insertions(+), 153 deletions(-)` both times, over `openapi.json` and
`src/client/schema.generated.ts`). Both artifacts are committed.

**2. The drift check fires on a hand edit.** Hand-edited
`openapi.json` (`paths./api/docs.get.parameters[5].description = "hand-edited"`),
regenerated, diffed: `git diff --exit-code` was **non-zero**, so CI's drift check
would fire. Repeated against the vitest guard: hand-set `info.title = "Tampered"`
→ `has openapi.json committed in sync with the route definitions` **FAILED**;
restored by regenerating.

**3. The published document carries the surface.** 62 operations. `DocRow` and
`DocFrontmatter` both require `stage`, `order`, `query`, `columns`, `kanban`,
`defaultOpen`, with byte-identical descriptions (asserted by JSON pointer against
the generated document, CONTRACT-045's rule). `Kanban` is a plain
`type: "object"` with `additionalProperties: false` — the `.superRefine()`
survives registration, and the row references it as
`anyOf: [{$ref: Kanban}, {type: "null"}]`, never `.nullable()` (CONTRACT-037).
`grep '"pinned"' openapi.json` → **0**.

**4. The typed client is genuinely typed, proved by counterfactual `tsc`.**
Removed `askReflection`/`getReflectStatus` from `contractRoutes`, regenerated,
ran `tsc --noEmit -p packages/contract`: `TS2345 Argument of type
'"/api/workspace/reflect"' is not assignable to parameter of type
'PathsWithMethod<FetchPaths, "post">'` plus `TS2339 Property 'pending' does not
exist on type 'never'`. Restored → 0 errors. Vitest does not typecheck, so this
is what proves the client carries the routes rather than the test merely passing.

**5. The client exercises the surface against the real definitions.**
`client/index.test.ts` mounts `contractRoutes` on a Hono app and drives the
generated client through it: `stage=review` and `stage=,triage`; a kanban board
created in one call; a `kanban.transitions` naming an undeclared stage refused
`400` **before any handler runs**; `unset: ["pinned"]` accepted and
`unset: ["id"]` refused `400`.

**6. Checks.** `npx eslint packages/contract` → 0 issues (no rule disabled).
`prettier --check` → clean. `tsc --noEmit -p packages/contract` → 0 errors.
`vitest run packages/contract` → **2827 passed, 67 files**.
`npm run build -w packages/contract` → 0.

**7. The intended forcing function fired, and the repo typecheck is red.** As the
verification plan predicted, every consumer that read `pinned` now fails to
compile: `packages/kit` 3, `apps/server` 12, `apps/cli` 3, `apps/ui` 9 — 27
errors, every one of them naming `pinned`, and each row constructor among them
will still be short of `stage`, `lastActor`, `columns`, `kanban` and
`defaultOpen` once `pinned` is deleted. That is what SERVER-138, CLI-060,
CLI-061, UI-148 and UI-152 are for. `npm run build` therefore fails at
`packages/kit` until they land. No other domain's files were touched.

**8. A SPEC discrepancy found, not fixed.** §5's canonical frontmatter block
still comments `type:` as `"note" | "thread" | "view" | "template" | "skill" |
"agent-def"` while §10's rider 2 makes `type: board` first-class. `board` is in
`CORE_DOC_TYPES` here (beside `view`, since a board lists view ids), and the
docblock records that §5's line is the one to correct. This package never edits
SPEC.md — the amendment is the orchestrator's to take to the user.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review against riders 2, 5, 6, 7

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[CONTRACT-074]` prefix
