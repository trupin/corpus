# [CONTRACT-061] A designation may name no profile

## Domain

contract

## Status

todo

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

- [ ] `POST /api/threads/{id}/resident` accepts a body naming **no** profile
- [ ] It still accepts `{name: "<invocable name>"}` unchanged — picking a profile
      is the other half of the feature, not a casualty of it
- [ ] `ResidentSchema` expresses a general resident without inventing a sentinel
      name that could collide with a real agent-def title
- [ ] `AgentRoster` rows report a general resident distinguishably from **no**
      resident — a lane with a general resident is designated; a thread with no
      designation is not a lane at all
- [ ] Every refusal CONTRACT-051 enumerates still applies where it applied:
      a thread with a parent is still refused, an unknown **named** profile is
      still `404`
- [ ] The description of each changed field says what a *consumer* may conclude,
      and never restates a derivation the server owns (the SERVER-114 rule)
- [ ] `openapi.json` regenerated and committed; the drift check passes
- [ ] The generated client typechecks, and every existing consumer of
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

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-061]` prefix
