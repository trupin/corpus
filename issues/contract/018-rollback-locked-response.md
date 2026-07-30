# [CONTRACT-018] Rider: `423` on the skill-rollback route + inventory docblock correction

## Domain
contract

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-008 (route exists), SHARED-002 (amendment applied)
- Blocks: SERVER-035

## Spec References
- SPEC.md §9.2 — routes + "document write paths refuse edits to a document locked by the other party"
- SPEC.md §7 — skill rollback "lands as a normal auto-commit … like any mutation"

## Summary
PR #11 review (finding 1, MAJOR): skill rollback is the only document write path whose
contract declares no lock-conflict response — every other mutating route carries
`423: LOCKED_RESPONSE` (`routes/docs.ts`, `routes/threads.ts`, `routes/thread-create.ts`).
The amended §9.2 makes no carve-out for rollback; CONTRACT-008's log shows the missing
423 was derived from this gap, not decided. This rider adds the response so SERVER-035
can enforce the guard. Also folds review finding 4 (MINOR): the
`routes/inventory.ts` docblock still claims §9.2 "does not yet name" the two new routes
and the amendment is "awaiting sign-off" — SHARED-002 applied it in this same PR
(SPEC.md:323-325), so the contract's spec-compliance record is now false.

## Acceptance Criteria
- [x] `POST /api/skills/{name}/rollback` route definition declares `423: LOCKED_RESPONSE`, with description text matching the house style ("Refused with `423` when the other party holds the document's edit lock." — see `routes/docs.ts`)
- [x] Route response-key test updated to include `"423"` (pattern: `thread-create.test.ts:252`)
- [x] `routes/inventory.ts:2-9` docblock corrected: the §9.2 amendment is applied (SHARED-002, SPEC.md:323-325), not pending
- [x] `openapi.json` regenerated; no other route's surface changes
- [x] Generated client picks up the response type (typecheck across consumers passes)

## Technical Design

### Files to Create/Modify
- `packages/contract/src/routes/` — the rollback route definition (added by CONTRACT-008; locate the file defining `POST /api/skills/{name}/rollback`)
- `packages/contract/src/routes/inventory.ts` — docblock correction only
- `packages/contract/openapi.json` — regenerated
- colocated route tests

### Key Implementation Details
Mirror exactly how `routes/docs.ts` declares `423: LOCKED_RESPONSE` on doc mutations.
This is a declaration-only rider — no schema changes, no new types.

### Edge Cases
- None; additive response declaration.

## Testing Strategy
Update the route's response-key assertion test; regenerate and drift-check openapi.json.

## E2E Verification Plan

### Verification Steps
1. `npm run build -w packages/contract` then the OpenAPI generation script
2. Confirm `openapi.json` diff is exactly the one new `423` response entry
3. `npm run typecheck` passes in contract + consumers

## E2E Verification Log

Implemented on: **opus** (contract-dev, 2026-07-29).

### 1. Route definition + docblock

`packages/contract/src/routes/skills.ts`:

- `423: LOCKED_RESPONSE` added to `rollbackSkill.responses`, imported from `./responses.js`
  exactly as `routes/docs.ts` does.
- Description gains the house-style sentence: _"A skill is an ordinary document, and this is an
  ordinary document write path: refused with `423` when the other party holds the document's edit
  lock."_
- Module docblock records **why** the 423 belongs (a rollback rewrites
  `.claude/skills/{name}/SKILL.md`, §9.2 admits no carve-out, and rolling back under the other
  party's lock discards mid-flight work) so the next reader does not re-derive the CONTRACT-008 gap.

`packages/contract/src/routes/inventory.ts:2-9` corrected — the "does not yet name … awaiting
sign-off" claim is replaced with the true record: the amendment is signed off and applied,
§9.2 now carries both bullets (SPEC.md:323-325, SHARED-002).

### 2. Regeneration — the diff is exactly the one 423 entry

```
$ npm run build -w packages/contract   # exit 0
$ npm run generate -w packages/contract
generated ./openapi.json
generated ./src/client/schema.generated.ts

$ git diff --stat HEAD -- packages/contract/openapi.json packages/contract/src/client/schema.generated.ts
 packages/contract/openapi.json                   | 12 +++-
 packages/contract/src/client/schema.generated.ts | 11 ++++
```

The `openapi.json` hunk is two changes and nothing else: the one appended description sentence,
and the new response entry

```json
"423": {
  "description": "The document is held by the other party's edit lock; `lock` identifies the holder (SPEC.md §7).",
  "content": { "application/json": { "schema": { "$ref": "#/components/schemas/LockedError" } } }
}
```

No other path, component or operation moved. Read back out of the regenerated document:

```
$ node -e '<read packages/contract/openapi.json>'
codes: 200,400,401,404,423
423 schema: {"$ref":"#/components/schemas/LockedError"}
total paths: 39            # unchanged — no endpoint added or removed
```

### 3. Generation is idempotent (drift check would pass post-commit)

```
$ shasum -a 256 openapi.json schema.generated.ts > before
$ npm run generate -w packages/contract
$ shasum -a 256 openapi.json schema.generated.ts > after
$ diff before after   →  identical   (IDEMPOTENT)
51bf8830…  packages/contract/openapi.json
c3a2d668…  packages/contract/src/client/schema.generated.ts
```

The real drift check **fires correctly** on the uncommitted state (it diffs against `HEAD`), naming
exactly these two files and no others — i.e. it is seeing this change and nothing stray:

```
$ node --import tsx scripts/check-generated-artifacts.ts     # exit 1, as expected pre-commit
✗ API contract is stale: packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts
 packages/contract/openapi.json                   | 12 +++++++++++-
 packages/contract/src/client/schema.generated.ts | 11 +++++++++++
✓ CLI reference is up to date (docs/cli.md).
```

### 4. Typed client against a mounted app

`skills.test.ts` mounts the real route definition on an `OpenAPIHono` and drives it through
`createCorpusClient`. New case — a skill the other party holds answers `423` and the client
surfaces the `LockedError` envelope with the holder:

```
✓ the skill-rollback route > answers 423 with the blocking lock when the other party holds the skill
✓ … > declares exactly the codes the rollback can answer with, 423 among them
✓ … > types the 423 body as the locked envelope carrying the holder
```

The last is a compile-time probe over the generated
`paths["/api/skills/{name}/rollback"]["post"]["responses"][423]` — it fails `tsc --noEmit` if the
generated client ever loses the response type.

### 5. Test + gate results

```
$ vitest run packages/contract          → 39 files, 1219 tests passed (exit 0)
$ npm run typecheck -w packages/contract → exit 0
$ npm run typecheck -w apps/server       → exit 0   (measured before CONTRACT-019 landed)
$ npm run typecheck -w apps/cli          → exit 0
$ eslint <7 changed files>               → exit 0
$ prettier --check <changed files + artifacts + this issue> → exit 0
```

Response-key assertions updated in both places that pin them:
`openapi.test.ts` "declares only the codes a rollback can produce" → `["200","400","401","404","423"]`,
and the 423 sweep's `it.each` now includes `/api/skills/{name}/rollback` alongside the doc and
thread write paths.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
