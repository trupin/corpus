# [SERVER-147] A designation is written without its identity

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-071 (declares the field; landed)
- Blocks: AGENT-050 (the listener's response)
- Related: SERVER-128, SERVER-129, AGENT-040

## Spec References
- SPEC.md **§7** — designation, release, and a resident's lane

## Summary

CONTRACT-071 added `Resident.designationId` — an opaque `des_…` id naming
**which designation** a resident is, so a listener launched for one designation
can find out that the lane now serves a different one. The contract declares it.
Nothing populates it, so every response currently answers `null`, which the
contract defines as *no id to compare* — the pre-CONTRACT-071 behaviour, safely.

This issue makes the server mint, store and report it.

The server does not compile against the landed contract until this is done:
`Resident` gained a required field, so every construction of one is a type error
(`core/resident.ts`, `threads/read.ts`, `threads/resident.ts`, plus
`core/resident.test.ts`).

## The rule, stated once

**The id changes exactly when the designation changes, and never otherwise.**

- A designation that **writes** — a different profile, the same profile at a
  different weight, a first designation — mints a fresh id.
- A designation that asks for the state already in force **writes nothing,
  displaces nobody, and keeps the id it had**. That path already exists
  (`designateResident`'s `unchanged` branch) and its meaning is unchanged: it is
  how a person asks for a stopped listener to be relaunched, and nothing about
  the designation moved.
- A release removes the resident and its id with it. Nothing is remembered
  across a release, and a re-designation after one is a new designation.

## The trap, named because the code invites it

`sameResident` in `apps/server/src/threads/resident.ts` compares *every field of
a `Resident`*, and its docblock instructs the next person to add the next field
to it. **`designationId` must not be added to it.** A fresh mint differs from
anything, so including it would make every re-designation a write, a
`resident.released` with reason `replaced`, and a displaced listener — for a
request that asked for the state that already held.

The contract publishes `DesignatedResident` (`Omit<Resident, "designationId">`)
for exactly this. Type `residentFor`'s return and `sameResident`'s parameters as
`DesignatedResident` and the mistake stops being spellable.

## Acceptance Criteria
- [ ] `apps/server` compiles and its suite passes against the landed contract
- [ ] A designation that writes reports a fresh `designationId` on the thread,
      the thread summary, the roster row and the `resident.designated` payload
- [ ] A re-designation naming the same profile at the same weight writes
      nothing, enqueues no `resident.released`, and reports the **same** id
- [ ] A re-designation changing only the profile, at the same weight, reports a
      **different** id — the defect CONTRACT-071 exists for
- [ ] A re-designation changing only the weight reports a different id
- [ ] A release, then a designation, reports an id different from the released
      one
- [ ] A thread whose stored `resident:` block has no `designationId` reports
      `null` rather than failing to parse — the pre-existing designations in
      every workspace on disk today
- [ ] `residentToStored` writes the key only when there is one, so a workspace
      never grows a second spelling of "no id"

## Technical Design

### Files to Create/Modify
- `apps/server/src/core/resident.ts` — the stored ↔ wire normalization. It
  already fills an absent `weight` with `null` before parsing
  (`withStoredWeight`); `designationId` needs the same treatment, and for the
  same reason: the wire field is required-and-nullable, and a *file* must have
  one spelling of absence. Every designation written before this issue omits the
  key. `residentToStored` spreads it in only when set, as it does `weight`.
- `apps/server/src/threads/resident.ts` — `residentFor` returns a
  `DesignatedResident`; `sameResident` compares `DesignatedResident`s; the write
  path mints the id and hands the full `Resident` to `writeResident`.
- `apps/server/src/threads/read.ts` — the two `Resident` constructions there.
- Wherever ids are minted (the same generator behind `doc_`/`th_`/`evt_`), with
  the `des_` prefix `DesignationIdSchema` publishes: `^des_[A-Za-z0-9]+$`.

### Key Implementation Details

The mint happens **inside the mutex, on the branch that writes**, beside the
`writeResident` call — not in `residentFor`, which is also reached by the
comparison. Reading the current id off the file and carrying it through the
`unchanged` branch is what keeps a re-announce stable.

The projection: check whether `resident` is projected in a way that needs the
new key, and whether `SCHEMA_VERSION` must move. A projected column derived from
the resident would need it; a column that only records *whether* there is a
resident would not.

### Edge Cases
- A hand-edited `resident:` block with a malformed `designationId` (a number, a
  wrong prefix). It fails the contract's shape check, which takes the whole
  block with it — the same rule an ill-shaped `weight` already follows, and for
  the same reason: the block is one value.
- A hand-edited block with a *plausible but foreign* id. Nothing verifies it;
  the id addresses no resource and there is nothing to verify it against. A
  listener comparing against it simply finds a mismatch and stands down, which
  is the safe direction.
- Backfilling existing workspaces is **optional and not required here**. Null is
  a defined answer. If a backfill is wanted, it belongs in the upgrade path and
  should mint a fresh id per designated thread, since the id is opaque and any
  fresh value is as good as another.

## Testing Strategy

Unit tests over `core/resident.ts` for the stored/wire normalization in both
directions, and integration tests over `designateResident` for the six
transitions in the acceptance criteria — in particular the profile-only
re-designation at an unchanged weight, which is the case that had no observable
difference before this field.

## E2E Verification Plan

### Verification Steps
1. Start a server on a scratch workspace.
2. Create a standalone thread. `POST /api/threads/{id}/resident` with no body.
   Record `resident.designationId`.
3. `POST` again with no body. Assert the id is unchanged and that no
   `resident.released` was enqueued.
4. `POST` with `{"name": "<some agent-def>"}`. Assert the id changed and
   `GET /api/agents` reports the new id on that lane's row.
5. Re-designate a *second* profile at the same weight. Assert the id changed
   again while `weight`, `live` and the row's presence did not — the defect.
6. `DELETE`, then `POST` again. Assert an id different from every previous one.
7. Hand-write a `resident:` block with no `designationId` into a thread file,
   restart, and read the thread: `designationId` is `null` and nothing else
   about the response changed.

## E2E Verification Log

### Post-Implementation Verification
_[Agent fills — state the model]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
