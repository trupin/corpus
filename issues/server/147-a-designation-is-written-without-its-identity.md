# [SERVER-147] A designation is written without its identity

## Domain
server

## Status
done

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
- [x] `apps/server` compiles and its suite passes against the landed contract
- [x] A designation that writes reports a fresh `designationId` on the thread,
      the thread summary, the roster row and the `resident.designated` payload
- [x] A re-designation naming the same profile at the same weight writes
      nothing, enqueues no `resident.released`, and reports the **same** id
- [x] A re-designation changing only the profile, at the same weight, reports a
      **different** id — the defect CONTRACT-071 exists for
- [x] A re-designation changing only the weight reports a different id
- [x] A release, then a designation, reports an id different from the released
      one
- [x] A thread whose stored `resident:` block has no `designationId` reports
      `null` rather than failing to parse — the pre-existing designations in
      every workspace on disk today
- [x] `residentToStored` writes the key only when there is one, so a workspace
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

**Model: Opus 5 (1M context).**

### The change

- **`core/ids.ts`** — a `des` kind, twelve base32 characters. Twelve rather than
  eight for the reason a queue event gets twelve: a designation is minted per
  *act*, every re-designation gets a fresh one, and UI-168's weight picker makes
  re-designating ordinary. It is also the one id nothing indexes — there is no
  table to check it against — so the entropy is the whole of the collision
  argument.
- **`core/resident.ts`** — `withStoredDesignationId`, exactly
  `withStoredWeight`'s case and reason, and the duplication is why both now go
  through one `withStoredKey`. `residentToStored` spreads the key in only when
  there is one, so a workspace never grows a second spelling of "no id".
- **`threads/resident.ts`** — `residentFor` returns a `DesignatedResident`,
  `sameResident` takes two, and the id is minted **inside the mutex, on the
  branch that writes**. The `unchanged` branch carries the id it *found*.
- **`threads/read.ts`** — carried through unchanged, for the reason `weight` is:
  it answers "which designation is this", and the workspace holds nothing to
  re-resolve it against.
- **The projection** — `threads.resident_designation_id`, `SCHEMA_VERSION`
  21 → 22. `GET /api/agents` builds every roster row from these columns and must
  not open a file per lane, so the fourth independent fact about a designation is
  projected as the first three are. The bump is what carries the DDL into an
  existing workspace; every carried-over row correctly reads NULL.

### The trap, held shut two ways

**By type.** Adding `designationId` to `sameResident` is now a **compile error**,
not a behaviour change:

```
$ # designationId added to the comparison
apps/server/src/threads/resident.ts(269,74): error TS2339:
  Property 'designationId' does not exist on type 'DesignatedResident'.
```

**By test.** Forcing it through anyway — widening `sameResident` back to
`Resident` and minting inside `residentFor`, which is what a next person would
have to do to make it compile — turns **five** tests red, three of which predate
this issue:

```
× writes nothing when the resident is already the one asked for — but still announces it
× writes nothing when it is already general — but still announces it
× writes nothing when the profile and the weight are both unchanged
× keeps the id when a re-designation asks for the state already in force
× keeps null on a legacy designation a re-designation did not change
```

### Post-Implementation Verification — real server, fresh workspace

`corpus init` at `scratchpad/ws147`, `corpus server start` on 8792, two
agent-defs seeded, driven over HTTP. The issue's seven steps, in order:

```
2. first designation (no body):        200  des_ztxx3lelx2xa
3. the same designation again:         200  des_ztxx3lelx2xa   UNCHANGED
   events for this thread:             ['resident.designated', 'resident.designated']
                                        — no resident.released
4. designated with a profile:               des_o6rnoipgt4ey   changed
   GET /api/agents row reports:             des_o6rnoipgt4ey
5. a SECOND profile, same weight:           des_rgfrv2hs64fg   changed
   weight None -> None | live False -> False | roster row present both times
6. DELETE:                             200  resident: None
   designated again:                        des_svqfz2cy6jxw
   all three ids distinct:                  True
7. hand-written legacy block on disk:
   resident:
     name: researcher
     docId: doc_research1
   read back: {name: 'researcher', docId: 'doc_research1',
               weight: None, designationId: None}
```

**Step 5 is the defect CONTRACT-071 exists for, live**: the profile changed at an
unchanged weight, the lane stayed present and `live` did not move — nothing else
on the row is different — and the id is the only machine-readable evidence that a
replacement happened.

**Step 3 is the trap, live**: the identical profile at the identical weight kept
its id, wrote nothing, and released nobody, while still announcing itself —
because that re-announce is how a person asks for a stopped listener to be
relaunched.

**Step 7 is every workspace on disk today**: `null` is a defined answer, and
nothing else about the response moved.

### Backfill: deliberately not done

The issue lists it as optional and it stays optional. A legacy designation a
re-designation did *not* change keeps `null`, and that is pinned by a test —
inventing an id on a read would make the id change without the designation
changing, which is the one rule this field has.

### Tests

Nine new tests in `threads/resident.test.ts` under
`which designation this is (SERVER-147)` — the six transitions plus a legacy
block re-designated at a new weight, a legacy block left alone, and a malformed
id taking the whole block with it (the rule an ill-shaped `weight` already
follows). Four new in `core/resident.test.ts` for the stored/wire normalization
in both directions.

Thirty-two existing assertions across six files were updated to carry the new
field. Two needed more than a field added, and both are recorded in the code:

- **`treats an empty body and no body as the same designation`** compared two
  threads' whole `resident:` blocks. Two designations are two *acts*, so their
  ids must differ — it now compares what the two requests **asked for** and
  asserts the ids differ, which is a stronger statement than the one it replaced.
- The roster and thread assertions take `A_DESIGNATION`, a *shape* matcher
  (`/^des_[a-z2-7]{12}$/}`), because the value is opaque and freshly minted; the
  id's **behaviour** across designations is pinned in one place, the block above.

```
VITEST_MAX_THREADS=4 vitest run apps/server --reporter=verbose
  Test Files  204 passed (204)
       Tests  4611 passed (4611)     exit 0
tsc --noEmit -p apps/server/tsconfig.json → clean
```

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
