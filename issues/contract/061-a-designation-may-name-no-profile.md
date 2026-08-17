# [CONTRACT-061] A designation may name no profile

## Domain

contract

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-048
- Blocks: SERVER-121, CLI-049, UI-122, AGENT-033

## Spec References

- SPEC.md **§7** — the SHARED-048 rider: *"A designation may name a
  `type: agent-def` document … or it may name **none**, in which case the
  conversation gets a **general resident**"*
- SPEC.md **§9.2** — `POST /api/threads/:id/resident`, `GET /api/agents`

## Summary

Make the wire admit a designation that names no profile, and a roster row that
reports one.

Today `DesignateResidentRequestSchema` is `z.strictObject({ name: AgentNameSchema })`
with `AgentNameSchema` at `.min(1)` and a non-blank refinement, so there is no
spelling of "designate, no profile" the server could accept. `ResidentSchema`
carries `{name, docId}` both non-null, so there is no shape for a resident that
resolved to no document.

## Acceptance Criteria

- [x] `POST /api/threads/{id}/resident` accepts a body naming **no** profile
- [x] It still accepts `{name: "<invocable name>"}` unchanged — picking a profile
      is the other half of the feature, not a casualty of it
- [x] `ResidentSchema` expresses a general resident without inventing a sentinel
      name that could collide with a real agent-def title
- [x] `AgentRoster` rows report a general resident distinguishably from **no**
      resident — a lane with a general resident is designated; a thread with no
      designation is not a lane at all
- [x] Every refusal CONTRACT-051 enumerates still applies where it applied:
      a thread with a parent is still refused, an unknown **named** profile is
      still `404`
- [x] The description of each changed field says what a *consumer* may conclude,
      and never restates a derivation the server owns (the SERVER-114 rule)
- [x] `openapi.json` regenerated and committed; the drift check passes
- [x] The generated client typechecks, and every existing consumer of
      `Resident`/`DesignateResidentRequest` still compiles or is listed for its
      owning domain to fix

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/agents.ts` — `DesignateResidentRequestSchema`,
  `ResidentSchema`, and the roster row
- `packages/contract/openapi.json` — regenerated
- `packages/contract/src/client/schema.generated.ts` — regenerated

### Key Implementation Details

**Two shapes are plausible and the choice is yours to make and record.** Either

1. `name` becomes optional on the request, and `Resident` becomes
   `{name: string, docId: string} | {name: null, docId: null}`; or
2. the request keeps one field whose absence is the general case, and `Resident`
   keeps `name` as a display string with `docId: string | null`.

Pick one, state in the schema's doc comment **what a reader may conclude from
each shape**, and say why the other lost. The trap to avoid is a `name` that is
non-null but synthesised (`"agent"`, `"general"`), because that value would
appear in the composer's recipient list beside real profile names and nothing
would tell them apart — and it could collide with a real agent-def titled the
same.

**Strictness stays.** Request bodies are `strictObject` (CONTRACT-017); do not
relax that to make an optional field convenient.

### Edge Cases

- **Designating again, from profile to general and back.** Single-valued
  replacement must work in both directions.
- **A named profile that does not resolve** is still a refusal, and must not
  silently degrade to a general resident — that would make a typo look like it
  worked.
- **`resident.designated` payload** carries the resolved resident (SERVER-111);
  its shape follows whatever is chosen here.

## Testing Strategy

Schema unit tests for: general designation accepted, named designation accepted,
a blank-string name still refused (a blank name is not the same request as an
absent one), round-tripping a general resident through `ResidentSchema`, and the
roster distinguishing general-resident from no-lane. Regenerate and assert the
OpenAPI document contains the new shapes.

## E2E Verification Plan

### Verification Steps

1. `npm run build -w packages/contract` and the drift check
2. A real server is not required here; SERVER-121 verifies the behaviour E2E

## E2E Verification Log

**Model actually run: opus (Opus 5, 1M context). 2026-08-17.**

### The shape chosen, and why the other lost

**Request — `name` optional, absence is the general case.** `POST` body is
`z.strictObject({ name: AgentNameSchema.optional() })` and the route declares
`body.required: false`, so a **bare `POST`, or `{}`, designates a general
resident**. §7 makes naming no profile *"the ordinary case"* that *"requires
nothing to exist first"*, so the ordinary case is the one that costs a caller
nothing to express — the same shape `POST /api/queue/halt` already uses, and the
same request/response asymmetry `schemas/form-answer.ts` already uses (a request
omits what it does not have; a response states it as null).

`{name: null}` lost: it would make the ordinary case the ceremonious one, and
`null` already has two jobs on the response side (nobody, on `residentField`; no
profile, inside `Resident`). It is still refused, so there is exactly one
spelling. A sentinel name lost for the reason the issue gave.

The cost of absence-as-meaning is stated in the schema's doc comment rather than
left to be discovered: a caller whose variable is `undefined` designates a
general resident instead of getting a `400`. It is bounded on both sides — a
blank name (`""`, `"   "`) is still a `400` and not absence, and the body is
still strict, so `{agent: "x"}` is an `unrecognized_keys` `400` naming the key.

**Response — `Resident` flat, both halves nullable, both still required.**
Three states, and the fourth refined away:

| `name` | `docId` | meaning |
| --- | --- | --- |
| `null` | `null` | general resident (ordinary) |
| set | set | profiled resident |
| set | `null` | profiled resident whose profile has gone — §7's *"the missing profile is reported rather than silently substituted"* |
| `null` | set | not a state; `.refine()` rejects it on `path: ["docId"]` |

The third row is why `docId` became nullable and not merely `name`:
AGENT-033 requires *"no profile"* and *"a profile that has gone"* not read as the
same thing, and a non-nullable `docId` would have foreclosed it and cost a second
contract change.

The union `{name: string, docId: string|null} | {name: null, docId: null}` lost:
it makes the fourth combination unrepresentable, but a union publishes `oneOf`,
which has no `type: "object"` and so cannot be a **named** component under this
document's invariant (CONTRACT-037). `Resident` would have inlined into every
route mentioning it and the four consuming domains would have lost the one name
they refer to it by. The refinement buys the same guarantee at runtime.

### Commands run

1. `npm run build -w packages/contract` → exit 0.
2. `npm run generate -w packages/contract` → `openapi.json` + `src/client/schema.generated.ts`.
   **Drift check** (the property CI asserts): saved both artifacts, rebuilt,
   regenerated, `diff -q` on both → identical. **Generation is idempotent.**
3. §9.2 survived the regeneration: `grep -c "§9.2" openapi.json` → **50**;
   `grep "§9.4"` → **0 matches**. No §9.4 reintroduced (SHARED-046 intact).
4. `VITEST_MAX_THREADS=4 vitest run packages/contract` → **65 files, 2597 tests,
   all passing**, exit 0.
5. `eslint packages/contract` → exit 0. `prettier --check` → exit 0.
6. `tsc --noEmit` in `packages/contract` → exit 0.

### The published shapes, read out of the generated document

```
Resident.properties.name.type   = ["string", "null"]   (minLength 1, maxLength 100)
Resident.properties.docId.type  = ["string", "null"]   (pattern ^doc_[A-Za-z0-9]+$)
Resident.required               = ["name", "docId"]
Resident.type                   = "object"             (the .refine() did not corrupt it)
DesignateResidentRequest        = { properties: { name }, additionalProperties: false }
                                  — no `required` array at all
paths./api/threads/{id}/resident.post.requestBody.required = false
```

The generated client emits `name: string | null` on `Resident` and
`requestBody?:` on the designation, which is the surface the CLI and the UI write
against.

### Falsification — each new assertion made to fail on purpose

- **The optional body.** Flipped `body.required` back to `true`, regenerated, ran
  `tsc --noEmit -p packages/contract`:
  `src/client/request-body-required.test.ts(54,44): error TS1360: Type 'false'
  does not satisfy the expected type 'true'.` The compile-time probe is the
  non-vacuous one — a `vitest` run alone passes either way, because hono's JSON
  validator is content-type-gated and a bodiless `POST` reaches the handler in
  both worlds. Restored and regenerated; artifacts byte-identical again.
- **The refinement.** Deleted the `.refine()` from `ResidentSchema`:
  `× Resident > refuses a docId with no name, which would be a document nobody
  named` — 1 failed, 47 passed. Restored; `diff` against the backup identical.

### Downstream: what this breaks, and where

The repo does **not** typecheck between this landing and its consumers — that is
the intended forcing function, and each break is the exact line its blocked issue
already names. Per-workspace `tsc --noEmit`:

| workspace | exit | errors |
| --- | --- | --- |
| `packages/contract` | 0 | — |
| `packages/kit` | 0 | — |
| `apps/ui` | 0 | — |
| `plugins/todos` | 0 | — |
| `apps/server` | 2 | `src/threads/read.ts:94`, `src/threads/resident.ts:179` |
| `apps/cli` | 2 | `src/commands/agents.ts:154`, `src/commands/thread/designate.ts:49` |

`npm run build` therefore fails at `apps/cli` until CLI-049 lands. Fixtures inside
this workspace were fixed here (`routes/index.test.ts`, `client/index.test.ts`
mount stubs); no other domain's were touched.

### Not resolved here, and deliberately

- `apps/ui` and `packages/kit` **compile** but are now semantically wrong for a
  general resident, so no type error will remind anyone: `packages/kit/src/recipient/laneRows.ts:80`
  (`row.resident?.name ?? row.origin?.title ?? …` silently falls through to the
  conversation title), `apps/ui/src/thread/ResidentBadge.tsx`,
  `apps/ui/src/thread/ThreadPanel.tsx:127`, `apps/ui/src/thread/residentActions.ts`.
  UI-122 owns all four; flagged because a green typecheck is not evidence here.
- `resident.designated`'s payload is an open `payload` on `QueueEvent`, so it is
  not declared in this package. Its resident half follows `Resident` by
  construction; SERVER-121 carries it.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-061]` prefix
