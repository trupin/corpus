# [CONTRACT-033] Claiming work reports the in-progress set

## Domain

contract

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-015 (signed 2026-08-05; SPEC.md §7 amended)
- Blocks: SERVER-061, CLI-029, AGENT-013

## Spec References

- SPEC.md §7 — "**The agent can see what the server still thinks it is doing.**"
  (the bullet appended by SHARED-015)
- SPEC.md §9.2 — Queue route inventory (`idle`, `claim-all`)
- `issues/shared/015-queue-reconciliation-rider.md` — the reasoning, the four
  open questions, and the decomposition table naming this issue

## Summary

`POST /api/queue/claim-all` and the `200` of `GET /api/queue/idle` gain an
`inProgress` field: the events the server currently holds `in-progress`, each
with its id, type, origin and the instant it was claimed. It rides beside the
claimed batch as its own field — never mixed into `events` — so an agent can
never confuse work it just claimed with work the server thinks it already had.
The list is capped with an explicit overflow signal, because a short list that
looks complete is the failure mode. Contract only: SERVER-061 populates it,
CLI-029 surfaces it, AGENT-013 writes the loop rule.

## Acceptance Criteria

- [x] `ClaimBatch` carries the in-progress set as its own required field, not
      merged into `events`
- [x] `IdleResult` carries the same field (rider Q1: `claim-all` **and** `idle`
      when it returns work)
- [x] Each entry carries at least: event id, type, origin, and how long it has
      been held
- [x] Origin uses the `Job.originId` / `originTitle` shape and derivation rule
      rather than a second vocabulary for "where this came from"
- [x] Bounded, with an explicit overflow signal — never a silent truncation
- [x] "How long it has been held" is decided deliberately between an instant and
      a duration, with the reason in the schema docblock
- [x] `openapi.json` and `client/schema.generated.ts` regenerated, never
      hand-edited
- [x] Contract tests in the style of `schemas/job.test.ts`, reasoning in
      docblocks
- [x] Whether SPEC §9.2's route inventory needs a line is stated in the report
      rather than silently shipped

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/queue.ts` — `InProgressEventSchema`,
  `InProgressSetSchema`, `MAX_IN_PROGRESS_REPORTED`; `inProgress` added to
  `ClaimBatchSchema` and `IdleResultSchema`
- `packages/contract/src/schemas/queue.test.ts` — contract tests
- `packages/contract/src/routes/queue.ts` — route descriptions for `claim-all`
  and `idle` state the reconciliation contract
- `packages/contract/src/openapi.test.ts` — published-document pins
- `packages/contract/src/routes/index.test.ts` — stub app now returns the field
- `packages/contract/openapi.json`, `packages/contract/src/client/schema.generated.ts`
  — regenerated

### Key Implementation Details

**Its own field.** `inProgress` is a sibling of `events`, required on both
`ClaimBatch` and `IdleResult`. Required, not optional: an absent field would be
indistinguishable from an empty one, which is the same silent-incompleteness
failure the cap's overflow signal exists to prevent.

**`heldSince` is an instant, not a duration.** Four reasons, written into the
schema docblock: (1) an instant stays true after the response is read, while a
server-computed duration is stale the moment it is serialised; (2) it survives
clock skew — the caller can subtract against whichever clock it trusts, and a
duration hides which clock produced it; (3) every other timestamp on this wire
is an ISO instant (`created`, `started`, `updated`), so a duration would be the
only unit-bearing number in the queue surface and would need its unit in its
name; (4) readability is a presentation concern and belongs one layer up, in
CLI-029.

**Origin reuses `Job`'s vocabulary.** `originId` / `originTitle`, both nullable,
derived by the same rule (`apps/server/src/jobs/project.ts`'s `resolveOrigin`:
first of `threadId`, `parentId`, `docId` in the payload that names a document
the corpus still holds; title read at response time, never stored).

**Bounded, newest first, with the inventory one route away.**
`MAX_IN_PROGRESS_REPORTED = 20`, published as `maxItems`. Ordering is
`heldSince` descending — most recently claimed first — so the window always
shows the work this session most plausibly did, and ancient residue ages out of
it into `reap-stale`'s domain rather than crowding out a fresh discrepancy. The
overflow signal is the `DocDiff.truncated` / `fullLength` pairing (CONTRACT-032):
`truncated: boolean` says the cut happened, `total: number` says the real size.
The description names `GET /api/jobs?status=in-progress` as the complete
inventory, so truncation never hides anything unreachable.

### Edge Cases

- Halted queue: `claim-all` returns `events: []` but a non-empty `inProgress` is
  still possible and still correct — halting stops claims, not holdings.
- `idle`'s `204` carries no body and therefore no list. Per the rider's resolved
  Q1 this is deliberate: the list rides on `idle` **when it returns work**.
- Nothing held: `{ events: [], total: 0, truncated: false }`, not an absent field.

## Testing Strategy

Unit contract tests in `schemas/queue.test.ts` (round-trips, the cap, the
overflow pairing, the separation from `events`, rejection of a non-event id and
of a duration where the instant belongs) plus published-document pins in
`openapi.test.ts` (components, required arrays, `maxItems`, the prose that
publishes the reconciliation contract and the never-settle clause).

## E2E Verification Plan

Generation is the E2E surface for this package: regenerate, confirm the
committed artifacts change as intended, confirm regeneration is idempotent, and
exercise the shape through a Hono app with the real route definitions mounted
(`routes/index.test.ts`'s stub app) so the published document and the typed
client are both proven against a live server rather than against the schemas
that produced them.

### Verification Steps

1. `npm run generate -w packages/contract`, then re-run it and confirm no diff
   (idempotence).
2. `npm run build -w packages/contract`.
3. Mount the real route definitions on a Hono app and request
   `/api/queue/claim-all` and `/api/queue/idle`; confirm the response carries
   `inProgress` as its own field beside `events`.
4. Confirm the generated client types carry the field.

## E2E Verification Log

**Implemented on: opus.**

### Post-Implementation Verification

**1. Generation, and idempotence.** Artifacts are regenerated, never hand-edited.

```
$ npm run generate -w packages/contract
> tsx scripts/generate.ts
generated ./openapi.json
generated ./src/client/schema.generated.ts

$ md5 -q packages/contract/openapi.json packages/contract/src/client/schema.generated.ts
f4cd382d07f2b9a2cf332fc2fd498129
be543b74b8d3c1e9cfdb78dad868c602
$ npm run generate -w packages/contract >/dev/null 2>&1; echo "gen exit=$?"
gen exit=0
$ md5 -q packages/contract/openapi.json packages/contract/src/client/schema.generated.ts
f4cd382d07f2b9a2cf332fc2fd498129
be543b74b8d3c1e9cfdb78dad868c602
```

Byte-identical on the second run: generation is idempotent, so the pre-push drift
check cannot fire on a clean tree.

**2. The published document carries the new components, the cap and the reference.**

```
$ node -e '
const d=JSON.parse(require("fs").readFileSync("packages/contract/openapi.json","utf8"));
console.log(Object.keys(d.components.schemas).filter(n=>n.startsWith("InProgress")));
console.log(JSON.stringify(d.components.schemas.ClaimBatch,null,1).slice(0,600));
console.log(JSON.stringify(d.components.schemas.InProgressSet.properties.events).slice(0,120));
console.log("type:",d.components.schemas.InProgressSet.type);'
[ 'InProgressSet', 'InProgressEvent' ]
{
 "type": "object",
 "properties": {
  "events": { "type": "array", "items": { "$ref": "#/components/schemas/QueueEvent" } },
  "inProgress": { "$ref": "#/components/schemas/InProgressSet" }
 },
 "required": [ "events", "inProgress" ]
}
{"type":"array","items":{"$ref":"#/components/schemas/InProgressEvent"},"maxItems":20,"descr...
type: object
```

`inProgress` resolves to a **bare `$ref`**, which is the check that matters for
this package's known hazard: `.describe()` on a registered schema makes
zod-to-openapi carry the component name onto the derived one and rewrite the
shared definition. The prose therefore lives on the component, and
`openapi.test.ts` pins the `$ref` so a future `.describe()` fails the suite.

**3. Against a live Hono app with the real route definitions mounted.**
`routes/index.test.ts` builds an app from `contractRoutes` — the same objects
`apps/server` mounts — and drives it over `app.request`, so `@hono/zod-openapi`
validates the handler's object against the published schema on every call. The
stub deliberately returns a *different* event in `inProgress` (`evt_held`) from
the one it claims (`evt_7c1d`), and the assertions check they stay apart:

```
$ VITEST_MAX_THREADS=4 npx vitest run packages/contract/src/routes/index.test.ts
 ✓ packages/contract/src/routes/index.test.ts (80 tests) 462ms
```

New, passing:
- "hands the agent the in-progress set beside the events it just claimed" —
  `POST /api/queue/claim-all` → `events: ["evt_7c1d"]`,
  `inProgress.events: ["evt_held"]`, `heldSince: "2026-07-19T09:41:00Z"`,
  `originTitle: "Re: 30-year fixed assumption"`.
- "reports the in-progress set on a live long-poll too" — `GET /api/queue/idle`
  → `inProgress: {events: [{id: "evt_held"}], total: 1, truncated: false}`.

**4. The generated client type carries the field.**

```
$ grep -n "InProgress" packages/contract/src/client/schema.generated.ts
4852:            inProgress: components["schemas"]["InProgressSet"];   # ClaimBatch
4875:        InProgressSet: {
4877:            events: components["schemas"]["InProgressEvent"][];
4883:        InProgressEvent: {
4907:            inProgress: components["schemas"]["InProgressSet"];   # IdleResult
```

All five properties are required (no `?`), so no
`exactOptionalPropertyTypes` widening asymmetry is introduced (CONTRACT-025).
`heldSince` emits with `Format: date-time`.

**5. Build and the workspace suite.**

```
$ npm run build -w packages/contract        → exit 0
$ VITEST_MAX_THREADS=4 npx vitest run packages/contract
 Test Files  52 passed (52)
      Tests  1863 passed (1863)
```

Scoped counts for the three touched suites: `schemas/queue.test.ts` 70 (was 51,
**+19**), `routes/index.test.ts` 80 (**+2**), `openapi.test.ts` 319 (**+11**) —
32 new tests, all passing.

**6. Lint and format on everything touched.**

```
$ npx eslint packages/contract/src/schemas/queue.ts \
    packages/contract/src/schemas/queue.test.ts \
    packages/contract/src/routes/queue.ts \
    packages/contract/src/routes/index.test.ts \
    packages/contract/src/openapi.test.ts
EXIT=0 — ESLint: No issues found
$ npx prettier --check <those five> packages/contract/openapi.json \
    packages/contract/src/client/schema.generated.ts \
    issues/contract/033-in-progress-set.md
All matched files use Prettier code style!
```

**7. Downstream blast radius, measured rather than assumed.**

```
$ (cd apps/server && npx tsc --noEmit)   → exit 2
src/queue/routes.ts:29:40 - error TS2345:
  Property 'inProgress' is missing in type '{ events: ... }' but required in type
  '{ events: ...; inProgress: { events: ...; total: number; truncated: boolean } }'
Found 1 error in src/queue/routes.ts:29

$ (cd apps/cli    && npx tsc --noEmit)   → exit 0
$ (cd apps/ui     && npx tsc --noEmit)   → exit 0
$ (cd packages/kit && npx tsc --noEmit)  → exit 0
```

**Known, expected, out of scope.** Exactly one downstream error, in the one
handler SERVER-061 owns: `inProgress` is a **required** response field and the
server's `claim-all` handler does not produce it yet. That is the contract-first
mechanism working as designed (CLAUDE.md Architecture Decision 3, "drift between
server and clients is a type error"), and SERVER-061 is the issue that clears it.
The CLI, UI and kit are unaffected — they read `.events` and a widened response
type does not reach them — so CLI-029 is an additive surfacing job, not a repair.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier on touched files)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[CONTRACT-033]` prefix
</content>
</invoke>
