# [CONTRACT-071] A profile-only re-designation is invisible to the listener it replaces

## Domain
contract

## Status
done

## Priority
P1

## Model
fable

## Dependencies
- Related: AGENT-040 (which found it), AGENT-041, CONTRACT-067, SERVER-129, CLI-053, SHARED-055

## Spec References
- SPEC.md **§7** — designation, release, and a resident's lane

## Summary

Escalated by AGENT-040's implementer, 2026-08-21, as beyond its own domain.

A re-designation that changes **only the profile**, at the same weight, cannot be
detected by the listener it replaces:

- `converse` detects a **changed weight** and a **vanished row**. Neither happens
  here — the weight is identical and the row is still there.
- The roster's resident cell is **display text written for a person**, and the
  skill correctly forbids parsing it. AGENT-040's own fix records that rule.

AGENT-040 made the successor launch — a designation following a release now
launches even while the outgoing listener still holds its park. But the duplicate
is then resolved by the **contested claim**, which is a race. **The stale-persona
listener can win it and keep the lane**, answering as a profile the person
replaced.

## Why the wire has to answer this

Every fix available inside the skills has been taken. The successor launches; the
old listener has no signal to act on; and the tie is broken by whoever claims
first. There is nothing left to write in prose that would change the outcome —
which is precisely the point at which a defect stops being an agent-runtime one.

What is missing is a **machine-readable** statement of which designation a
listener is serving, either on the roster row or in the park path, so a sitting
listener can compare what it was launched for against what the lane now says and
stand down when they differ.

## Decisions to make and record

1. **Roster row, or the park path, or both.** A field on the row is read on a
   poll; a field in the park answer reaches the listener at the moment it
   unparks, which is when it is about to act. The second is more timely and the
   first is simpler.
2. **An identity, not a rendering.** Whatever is added must be something a
   machine compares — a designation id, or the profile's document id — never the
   display string. The display string already exists and is already forbidden,
   and adding a second parseable-looking rendering would invite the same mistake.
3. **What a listener does when they differ.** Standing down is the obvious
   answer and it belongs to `converse`, not here. This issue supplies the fact;
   the skill decides the act. Say which issue owns that half.
4. **Whether the same field answers the weight case more cleanly.** `converse`
   detects a changed weight today by comparison. If a designation identity
   covers both, the weight-specific path may be redundant — check before adding
   a second mechanism beside it.

## Decisions made and recorded (2026-08-23, opus)

Answering the four the issue asked for, in its order.

**1. The roster row, not the park path — and the park's advantage does not
exist.** The fact rides on `Resident`, which the roster row, the thread, the
thread summary and the `resident.designated` payload all already carry. So one
field with one description answers both halves of the listener's comparison —
what it was launched for, and what the lane says now — with nothing to keep in
step.

The park was considered on the issue's own reasoning (*"reaches the listener at
the moment it unparks, which is when it is about to act"*) and loses on a fact
about the park: **a window that returns no work returns `204`, which has no
body.** `IdleResultSchema`'s docblock already says so. A re-designation while a
listener is parked ends that park at the next timeout with an empty answer, so a
park-carried identity would be absent on exactly the passes where it was needed
and present on the passes where the listener is busy claiming. The loop reads
the roster once a pass regardless, so the row is not less timely — it is the
only one of the two that is always there.

A third option was considered and deferred, not rejected: **an active refusal**
— `GET /api/queue/idle` taking the designation id the caller serves and refusing
a park whose id is not current. That is decisive rather than advisory, since a
stale listener could no longer stay present. It costs a new query parameter, a
new refusal code and a change to park semantics, and it can be built on top of
this field later without a breaking change. Named in AGENT-050 as an option, not
required.

**2. An identity, not a rendering.** `Resident.designationId`, an opaque
`des_…` id (`DesignationIdSchema`). It addresses no resource — there is no
designation to fetch — and encodes nothing about the profile, the weight, the
thread or the instant, so the only sound operation on it is equality. That is
stated in the published description, because the reader who would be tempted to
order two of them or derive a label from one is reading `openapi.json`.

Three alternatives lost:

- **An instant** (`designatedAt`). It compares correctly, and it would be
  rendered — "resident since 09:14" is too obviously useful to stay unrendered —
  which puts a comparison key and a display value in the same field. It would
  also sit on a roster row beside `since`, which is the *park* instant, and two
  ISO instants meaning different things one line apart is a confusion generator.
- **The `resident.designated` event's id.** One designation may be announced
  more than once: a re-designation asking for the state already in force writes
  nothing and still enqueues an event, because that is how a person asks for a
  stopped listener to be relaunched. An event id would therefore differ where
  nothing had been replaced — the one wrong answer this field must not give.
  Stated in the published description.
- **A fingerprint of `{name, docId, weight}`.** It needs no storage and no
  legacy null, and it is a rendering of the fields rather than an identity of
  the act: it can never express a decision that a re-announce *is* a new
  designation, and a listener gains nothing from it over comparing the three
  fields itself.

**Null is the absence of an answer, not an answer.** Designations already
written to disk have no id, and the description says a reader meeting a null on
either side must do what it did before this field existed rather than read two
nulls as a match.

**3. The listener's response is AGENT-050**, filed with this issue:
`issues/agent-runtime/050-a-listener-does-not-check-which-designation-it-serves.md`.
The server half is **SERVER-147**,
`issues/server/147-a-designation-is-written-without-its-identity.md`.

**4. It does subsume the weight case, and the follow-up owns the collapse.** A
weight change is a different designation and mints a different id, so
`converse`'s weight-specific reading becomes a special case of one comparison.
No second mechanism was added beside it here — the field is the mechanism, and
AGENT-050 decides whether the weight reading collapses into it or is kept with a
written reason. AGENT-050 also carries the transition guard: while any workspace
holds designations made before SERVER-147, the id is null on both sides and the
weight reading is the only reading available.

**One hazard created, and closed by a type.** `sameResident` in
`apps/server/src/threads/resident.ts` compares every field of a `Resident` and
its docblock tells the next person to add the next field to it. Adding
`designationId` there would make every re-designation a replacement — a write, a
release event and a displaced listener for a request that asked for the state
that already held. The contract therefore publishes
`DesignatedResident = Omit<Resident, "designationId">`, and SERVER-147 types the
comparison with it, which makes the mistake unspellable rather than merely
documented.

**Held for the user, not written.** SPEC.md §7 describes designation and
release, and says nothing about how a replaced listener finds out. One sentence
would close that, and a SPEC change needs a signature. Drafted for the
orchestrator to read aloud:

> *A designation has an identity, and a listener may ask which designation it
> serves. Re-designating replaces the designation, and the replacement carries
> an identity of its own, so a listener launched for the one it replaced can see
> that the lane has moved on without reading anything written for a person.*

Nothing in this issue depends on it: the field is a contract mechanism, and the
behaviour it enables is AGENT-050's, which is where a signed sentence would be
cited.

## Acceptance Criteria
- [x] A listener can tell, without parsing display text, that the designation it
      serves is no longer the lane's designation — `resident.designationId`, on
      the roster row and in the launch payload, read from `corpus agents --json`
- [x] A profile-only change at the same weight is detectable
- [x] The roster's human-facing cell is unchanged and still not parseable — no
      CLI or UI rendering was touched
- [x] The contract declares the field — **the server populating it is
      SERVER-147**, filed and named below, because `apps/server` is held by
      another agent mid-flight
- [x] The follow-up owning the listener's response is filed and named here —
      AGENT-050

## Testing Strategy
Contract round-trip plus a server test that a profile-only re-designation changes
the field. The listener half is a skill change with its own pin.

**Done here**: `schemas/agents.test.ts` gains a `Resident.designationId` block —
required-and-nullable, the `des_` prefix refusing every other id, the
profile-only replacement at an unchanged weight, the published prose that null
is not a match, and the one property `DesignatedResident` exists for.
`openapi.test.ts` pins the generated document: the field's type and pattern, its
`$ref` from `Thread`, `ThreadSummary` and `AgentLane`, and that the document
declares it exactly once. The server test is SERVER-147's; the listener pin is
AGENT-050's.

## E2E Verification Log

**Model: opus** (`claude-opus-5[1m]`). The issue recommended fable; the design
questions turned out to be answerable from the repo's own written rules rather
than from open judgment, and every alternative considered is recorded above with
the fact that decided it.

### Post-Implementation Verification

Regeneration, and the field on the wire:

```
$ npm run generate -w packages/contract
generated ./openapi.json
generated ./src/client/schema.generated.ts

$ node -e "const d=require('./packages/contract/openapi.json'); \
  console.log(d.components.schemas.Resident.required); \
  console.log(d.components.schemas.Resident.properties.designationId.pattern)"
[ 'name', 'docId', 'weight', 'designationId' ]
^des_[A-Za-z0-9]+$
```

Published **once**, and reached by `$ref` from every surface a listener could
read it from — pinned by `openapi.test.ts`'s new case, which counts the
declarations in the generated document and asserts `Thread`, `ThreadSummary` and
`AgentLane` all reference the one component.

Generated client carries it, as one declaration (the other two hits are the
field's own prose and the route's response description):

```
$ grep -n "designationId" packages/contract/src/client/schema.generated.ts
2696:  ... gets a fresh `Resident.designationId`, and one that asks for the state ...
2724:  ... `{name, docId, weight, designationId}` — the first two null for a general ...
5741:            designationId: string | null;
```

Contract suite, whole workspace:

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract
Test Files  70 passed (70)
     Tests  2934 passed (2934)
```

`tsc --noEmit -p packages/contract` clean.

**The forcing function, measured.** A required response field is additive on the
wire and breaking in TypeScript: every *reader* of a `Resident` compiled
unchanged, every *constructor* outside this package did not. `npm run typecheck`
across the repo reports 60 errors in 16 files, none of them in `apps/ui` (which
constructs no `Resident` outside `packages/kit`):

- `apps/cli` — `src/commands/resident.test.ts` (22), `src/commands/agents.test.ts` (14)
- `apps/server` — `src/core/resident.ts` (1, source), `src/threads/read.ts` (2, source), `src/threads/resident.ts` (2, source), `src/core/resident.test.ts` (3)
- `packages/kit` — `src/recipient/laneRows.test.ts` (9), `src/recipient/useComposerRecipient.test.tsx` (2), `src/address/ComposerAddress.test.tsx` (2), `src/recipient/useScopeWalk.test.tsx` (1), `src/recipient/useResidentLane.test.tsx` (1), `src/query/useAgentsRoster.test.tsx` (1), `src/address/addressModel.test.ts` (1)

Every one is a fixture literal wanting `designationId: null` (or an id), except
the four `apps/server` source errors, which are SERVER-147's subject. This
package's own two stubs (`routes/index.test.ts`, `client/index.test.ts`) were
fixed here; the others belong to the issues that will rewrite those lines.

One pre-existing failure was found and **not** touched, because it is unrelated
to this change and sits in another agent's tree:
`apps/server/src/threads/context.test.ts(945,19): error TS2339: Property 'parent'
does not exist on type ...`.

### The defect, reproduced as a comparison

The case is a re-designation naming a different profile at the same weight.
Before this field, the two residents differ in `name` and `docId` — which a
listener cannot read, because it reads the roster's rendered cell and the skill
forbids parsing it — and in nothing else: the weight is identical, the row is
present, and the lane is live. `schemas/agents.test.ts` pins it directly
("tells a profile-only replacement at the same weight apart"): `after.weight`
equals `before.weight` and `after.designationId` does not equal
`before.designationId`.

The end-to-end half — designating twice against a running server and watching a
listener stand down — cannot be run until SERVER-147 populates the field and
AGENT-050 teaches the listener to read it. Both carry that verification in their
own E2E plans, and neither can be faked from here: the server currently answers
`null`, which the contract defines as *no id to compare*, so a listener reading
it today would correctly conclude nothing.

