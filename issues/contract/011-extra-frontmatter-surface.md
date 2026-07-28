# [CONTRACT-011] Extra-frontmatter surface: view keys, pinned/order, parentTitle rider

## Domain

contract

## Status

todo

## Priority

P0

## Model

fable — the open-vs-closed frontmatter surface is an architectural call with plugin-system consequences (§10/§12); the shape decided here is what every plugin builds against.

## Dependencies

- Depends on: CONTRACT-005
- Blocks: SERVER-026, UI-003

## Spec References

- SPEC.md §11 — columns are pinned `type: view` documents (`pinned`, `order`, `query`, `column` frontmatter)
- SPEC.md §12 — plugin doc types carry their own frontmatter (`todo.items`)
- `issues/sprints/sprint-009.md` — Open Conflict 1 (discovery: no wire path for any view key; ~13 of UI-003's 16 ACs blocked)

## Summary

Sprint-009's planner found §11's view-document model has no HTTP surface: `docRowBaseShape`, `DocFrontmatterSchema`, `CreateDocRequestSchema`, `UpdateDocRequestSchema` are closed sets omitting `pinned`/`order`/`query`/`column`; no `pinned` query param; no `order` in `DOC_SORTS`. Adjudicated design (orchestrator, 2026-07-27): a **namespaced open extra-frontmatter object** carried on doc rows, create and update requests — serving §11's view keys now and §12's plugin keys (`todo.items`) without reopening the contract per doc type. Core keys stay closed and validated; the extra object is the explicit escape hatch, passed through byte-preserving (the server's YAML-splice machinery already does this on disk).

Riders: a `pinned` filter param and `order` sort on `GET /api/docs`; `DocRow.parentTitle` (nullable, required — mirrors `Job.originTitle`; UI-004's "show the parent's title" has no data source today).

## Acceptance Criteria

- [x] Extra-frontmatter object (name and constraints are this issue's design work: collision rules with core keys, depth/size bounds, no core-key shadowing) on DocRow + create/update requests; round-trips through the generated client.
- [x] `pinned` query param + `order` sort; view documents' keys reachable end-to-end in the schema.
- [x] `DocRow.parentTitle` nullable-required rider.
- [x] All standing invariants; artifacts regenerated, idempotent; known consequence: apps/server compile breaks at the response-shape sites — SERVER-026 consumes in the same coupled commit (TEST-76 waiver precedent).

## Technical Design

**As implemented (design decisions of record, 2026-07-27):**

1. **The split: view keys first-class, plugin keys in `extra`.** §11's four view keys (`pinned`,
   `order`, `query`, `column`) graduated to first-class optional core fields on
   `DocFrontmatter`/`DocRow`/create/update — NOT into the extra object. Rationale (recorded in
   `doc.ts`): (a) `pinned` is a filter and `order` a sort — a key the server filters and sorts on
   is by definition not opaque passthrough, and routing them through `extra` would force the
   server to reach into a blob it promises never to read; (b) §11 is core product, and `query`'s
   flat-map shape and `column`'s `<plugin>/<type>` format deserve 400s at the write boundary,
   which `extra` deliberately never provides; (c) it keeps `extra`'s contract absolute — nothing
   in it is ever interpreted by the server, no asterisk.
2. **`extra` — name, nesting, semantics** (`schemas/extra.ts`). One wire key, `extra`, on
   `DocRow`, `DocFrontmatter`, `CreateDocRequest`, `UpdateDocRequest`. **Flat, mirroring the
   file**: on disk a plugin key is a YAML key beside the core ones (§12's `todo` carries a
   top-level `items:`), so the object holds `key → value` verbatim with no per-plugin
   sub-namespacing (a plugin→key mapping does not exist anywhere; the object itself is the
   namespace). Required-always-`{}` on responses; optional on requests. **Update is a shallow
   merge patch** (RFC 7386 at the top level): named key replaced wholesale, `null` removes it,
   unnamed keys byte-untouched — key-granular, so two plugins writing different keys never race.
3. **Collision rule (shadowing impossible).** `RESERVED_FRONTMATTER_KEYS` (18 keys: §5 base ×11,
   §6 thread ×3, §11 view ×4) rejected inside `extra` with 400, exact and case-sensitive (YAML
   keys are); enforced by the shared schema on requests *and* responses, so a client can never
   receive an `extra.title` disagreeing with `title`. Drift-pinned against the real schemas in
   `extra.test.ts`. `extra` itself is not reserved — it is a wire envelope, not a disk key.
4. **Value bounds.** Values typed `unknown` (a plugin validates its own keys via its `validate`
   extension point — that is what keeps a new plugin doc type at zero contract changes) but
   runtime-checked plain JSON: `null`/string/finite number/boolean/array/plain object, ≤ 8
   containers deep (`EXTRA_MAX_DEPTH`), ≤ 64 KiB serialized UTF-8 (`EXTRA_MAX_BYTES`).
   `todo.items` is depth 2. All rules published in one description paragraph carried verbatim on
   all four components — the descriptions are the plugin contract.
5. **Riders.** `pinned` filter: `stringbool` like `unread` (`pinned=true&type=view&sort=order`
   is the board's whole column set — one bounded query, sprint-009 TEST-2). `order` sort:
   ascending only, documented tiebreak `order` nulls-last → `title` → `id` (TEST-3's
   determinism), any finite number legal so reorders can write midpoints (TEST-10's minimal
   writes). `DocRow.parentTitle`: nullable-required, `Job.originTitle`'s one-sentence rule
   (live join, never a stored copy). Update semantics for `order`/`query`/`column`: `null`
   clears the key from the file.

## E2E Verification Log

**Implemented on: fable** (matches the Model recommendation). Worktree
`.claude/worktrees/contract-011`, `npm install` run there first (exit 0).

### Post-Implementation Verification

**Generation idempotent — three consecutive runs, hashes identical (md5):**

```
a0d43e1682d4b828a49200e0ed0e29da  openapi.json                    (runs 1, 2, 3)
f4b8bf97131d6d5800d0575042403d95  src/client/schema.generated.ts  (runs 1, 2, 3)
```

**Drift check fires and is deterministic** — `node --import tsx scripts/check-generated-artifacts.ts`
run twice: exit 1 both times, output byte-identical (`cmp` clean). The ✗ is the
working-tree-vs-HEAD diff (273/64 insertions across the two artifacts) — the CONTRACT-009
precedent exactly: it goes green the moment the orchestrator commits the regenerated artifacts,
which this agent may not do. `docs/cli.md` reported ✓ up to date.

**Contract suite and checks in isolation — every exit code read from the tool itself, never a
pipeline's (the CONTRACT-009 `timeout … | tail` trap avoided by construction):**

```
vitest run packages/contract                     → VITEST_EXIT=0   (34 files / 987 tests)
tsc --noEmit -p packages/contract/tsconfig.json  → TSC_NOEMIT_EXIT=0
tsc -p packages/contract/tsconfig.build.json     → BUILD_EXIT=0
eslint packages/contract                         → ESLINT_EXIT=0   (no rule disabled anywhere)
prettier --check packages/contract/src/** …      → PRETTIER_EXIT=0
```

**Typed client against a mounted app** — a tsx script mounting the real `contractRoutes.listDocs`
/ `createDoc` / `updateDoc` on `OpenAPIHono` and driving them through `createCorpusClient` over
`app.fetch` (real validation chain, generated types):

```
E2E-1 OK: pinned=true&type=view&sort=order round-trips the seed view row
E2E-2 OK: create carries todo extra.items through the generated client
E2E-3 OK: extra.title rejected with 400  (zod issue path ["extra","title"])
E2E-4 OK: order=15 accepted; order=null clears and reads back null
E2E-5 OK: pinned=maybe is a 400
E2E_EXIT=0
```

Illegal probes (E2E-3, E2E-5) required `@ts-expect-error` to even compile — the generated types
reject them statically as well as at runtime. Seed-view round-trip fixtures in `doc.test.ts` are
the literal frontmatter of `assets/workspace/data/docs/views/attention.md`.

**Standing invariants** — all pre-existing `openapi.test.ts` suites green, including: closed error
union untouched, no request-body defaults, non-nullable named components (the new record schemas
are deliberately unregistered/inlined so no derived form can rewrite a component), inventory at 41
endpoints / 12 bodies unchanged (no new routes, no new bodies). New invariants added: view keys +
`extra` required on both response components and never demanded on requests; the full extra
contract (all 18 reserved keys, bounds, merge patch) published on all four components;
`parentTitle` nullable-required with the originTitle rule; `order` tiebreak prose pinned.

**Blast radius — measured, not derived** (contract + kit dist rebuilt first, then `tsc --noEmit`
per workspace, exit codes read directly):

```
apps/server   → SERVER_TSC_EXIT=2   3 errors / 2 files   ← SERVER-026's coupled commit
    apps/server/src/docs/query.ts:245  ORDER_BY missing the "order" sort key
    apps/server/src/docs/query.ts:358  row shape missing parentTitle, pinned, order, query, column, extra
    apps/server/src/docs/read.ts:138   frontmatter response missing pinned, order, query, column, extra
apps/cli      → CLI_TSC_EXIT=2      1 error / 1 file    ← NOT in the issue's known-consequence list
    apps/cli/src/commands/doc/fixtures.ts:10  test fixture missing the five new frontmatter fields
packages/kit  → KIT_TSC_EXIT=0  (build also 0)
apps/ui       → UI_TSC_EXIT=0
```

The `apps/cli` break is a five-line test-fixture addition (`pinned: false, order: null,
query: null, column: null, extra: {}`) — flagged to the orchestrator for routing (cli-dev or
ridden alongside SERVER-026's coupled commit).

Worktree `git status --porcelain` (read-only) shows only `packages/contract/**` changes plus this
issue file — no stray files, scratch dir `/tmp/corpus-c011-*` created and removed.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint 0, prettier 0, tsc 0 — contract in isolation)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed (coupled with SERVER-026)
