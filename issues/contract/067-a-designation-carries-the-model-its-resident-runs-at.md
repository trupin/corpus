# [CONTRACT-067] A designation carries the model its resident runs at

## Domain

contract

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: **SHARED-055** — which way the spec resolves decides this schema
- Blocks: UI-126, AGENT-038
- Related: SERVER-128

## Spec References

- SPEC.md **§7** — the resident rider, and the weight rider
- SPEC.md **§9.3** — contract-first: the OpenAPI document is generated

## Summary

Requested by the user, 2026-08-19: *"When designating a resident, I want to be
able to select its model."*

`DesignateResidentRequestSchema` (`packages/contract/src/schemas/agents.ts:432`)
is a `strictObject` carrying exactly one field, `name`. Nothing in the resident
schemas mentions a model — `grep model packages/contract/src/schemas/agents.ts`
returns nothing.

**This is not only a missing feature.** SHARED-055 establishes that a resident
*cannot* honour a per-message weight, so the designation is the only place its
model can be chosen at all. Until it is here, the model a resident runs at is
whatever the session that started it happened to be, chosen by nobody and
recorded nowhere.

## Why this waits on SHARED-055

If the spec resolves the other way — residents delegate per message rather than
working inline — then a designation-level model is wrong and the per-message
weight is right. The user has rejected that reading by name, but the rider is
what makes it binding, and building the schema first would be building against a
sentence nobody has signed.

**Do not start this before SHARED-055 is signed.**

## What to decide

1. **A model name, or a weight level?** §7's weight levels are declared by the
   workspace's own skill, so the levels a workspace offers match the skill it
   runs. A designation naming a *level* inherits that property; one naming a raw
   model name does not, and goes stale when the workspace's guidance changes
2. **Is it optional?** Omitting it should mean what it means today — the resident
   runs at whatever the operator started it as — so an existing designation stays
   valid and this is not a breaking change
3. **Does `Resident` report it back?** A surface that shows who is resident (§11,
   UI-125) needs to show what it runs at, or the choice is write-only
4. **What happens when the named level no longer exists?** §7 already answers
   this for a stated weight — do the work, say so twice — and the same answer may
   not fit a designation, which is long-lived rather than per-request

## Decided by the orchestrator, 2026-08-19 (SHARED-055 signed as drafted)

1. **A weight level key, never a model name.** The field is `weight`, its schema is the existing `RequestedWeightSchema` (`schemas/weight.ts`) — the same token that travels on a message — so the vocabulary is the workspace's own tier table and no model name reaches the wire. "No model names in the UI" is a signed non-goal.
2. **Optional on the request, nullable on `Resident`.** Omitting it keeps today's behaviour; `Resident.weight` is `string | null`, `null` meaning *none chosen — the launcher decides and says so*. Not a breaking change.
3. **`Resident` reports it**, on the thread, the thread summary, the roster row, and the `resident.designated` event payload (which carries a `Resident`).
4. **A level that no longer exists** is not the contract's to refuse — the table is skill text the server never reads. The description says the launcher reports a level it cannot meet, per §7's weight rider, and that a designation is long-lived so the report lands in the listener's first reply (AGENT-038/039).
5. **The description states the boundary** in one sentence, reused verbatim by SERVER-129 and CLI-053: *"governs the resident's own turns; a weight stated on a message still governs what the resident hands off (SPEC.md §7, rider signed 2026-08-19)"*.

## Acceptance Criteria

- [ ] SHARED-055 is signed before this starts
- [ ] A designation may name the weight its resident runs at, and omitting it
      keeps today's behaviour exactly
- [ ] `Resident` reports it, so a reader can see what a lane runs at
- [ ] The description states the boundary SHARED-055 draws: this governs the
      resident's **own** turns, and a per-message weight still governs what the
      resident hands off
- [ ] One wording, and it agrees with the CLI's and the server's — this rule was
      stated at eight sites in v0.12.0 and every new phrasing is a future drift
      (CONTRACT-064)
- [ ] `openapi.json` and `schema.generated.ts` **regenerated**, never hand-edited

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/agents.ts` — `DesignateResidentRequestSchema`,
  `ResidentSchema`
- `packages/contract/src/routes/thread-resident.ts` — the route description
- regenerated artifacts

### Key Implementation Details

Read `packages/kit/src/weight/useWeightLevels.ts` and `weightLevels.ts` first.
The levels are read from the workspace's own orchestrate skill, which is what
makes them match the installed guidance — a designation-level choice should reuse
that, not invent a parallel vocabulary.

Read `ResidentSchema`'s existing `docId` prose, corrected twice in v0.12.0. It is
the model for how much a description here has to say.

## Testing Strategy

Schema tests plus a pin in `openapi.test.ts` against the **generated** document,
in the shape CONTRACT-064 used. Falsify by reverting the field and running that
pin alone.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Designate with a weight; read it back through `GET` and through `corpus agents`
3. Designate without one; confirm behaviour is unchanged from today
4. Stop the server; confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-067]` prefix
