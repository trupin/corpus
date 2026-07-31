# [CONTRACT-025] Rider: doctor response gains a report-only warnings surface

## Domain
contract

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: SERVER-038

## Spec References
- SPEC.md §14 doctor bullet; SERVER-038's report-only recovery pass (sprint-018 Open Conflict 1 adjudication, 2026-07-30)

## Summary
`GET /api/db/doctor`'s response deliberately carries failures only (`DRIFT_KINDS` is
a closed enum; `routes/db.ts` records that `warnings` is absent by design). SERVER-038
needs a home for report-only findings — files the projection will never index, named
with their creating commit — that must NOT fail doctor (§14's `rebuild && doctor`
clean invariant). Add an optional `warnings` array to the doctor response: each entry
a warning kind (its own open-ended literal set, separate from `DRIFT_KINDS`), path,
human message, and optional commit. Additive only; existing clients unaffected.
Note for the ledger: a one-line §14 mention ("doctor may carry report-only warnings")
goes into the next spec sign-off round — this rider implements an already-planned
issue, it does not change pass/fail semantics.

## Acceptance Criteria
- [x] Doctor response schema gains optional `warnings`; failures/exit semantics untouched; A-era client types still compile
- [x] Warning kind space is extensible without a contract edit per new kind (single literal union owned here, or a pattern — decide and document)
- [x] openapi.json + client regenerated, drift check green; CLI doctor output unaffected until SERVER-038 consumes it

## Technical Design
### Files to Create/Modify
- `packages/contract/src/routes/db.ts` (+ tests), regenerated artifacts

## Testing Strategy
packages/contract scoped: schema round-trip with and without warnings; compat assertion.

## E2E Verification Plan
Build + drift check green; server compiles unchanged (optional field).

## E2E Verification Log

**Model: opus** (`claude-opus-5[1m]`), matching the issue's recommendation. Branch `phase-6-dogfood`,
main tree, 2026-07-31. No git command was run by this agent. No server started, no port bound —
this issue's whole surface is generation + types, and the drills below say so with hashes rather
than with curl.

### Decisions taken, with the reasoning the acceptance criteria asked for

**1. The kind space is an open token, not a union — and the asymmetry with `DRIFT_KINDS` is the
design, not an inconsistency.** A *drift* kind is the pass/fail vocabulary `ok` is derived from, so
a kind a client cannot recognise is a verdict it cannot render; that is why `DRIFT_KINDS` is closed
and stays closed. A *warning* kind carries no verdict: the only thing a consumer must do with one
is render `detail` verbatim, so an unrecognised kind degrades to a printed line rather than to a
broken report. A single literal union — the criterion's other offered option — was rejected because
it fails the criterion's own headline ("extensible **without a contract edit per new kind**"): every
new report-only pass would cost a contract release plus a lockstep client regeneration. The shape
follows `QueueEvent.type`'s shipped precedent (`schemas/queue.ts:65-70`): open string on the wire,
known values published as a constant (`DOCTOR_WARNING_KINDS`) plus a closed narrowing schema
(`CoreDoctorWarningKindSchema`) for consumers that want to switch exhaustively. Openness is bounded
rather than total — `^[a-z][a-z0-9_]*$`, 1–64 chars — so a kind stays a key to switch on and cannot
quietly become a second prose field beside `detail`.

**2. `warnings` is optional at the report level; every key *inside* a warning is required-and-
nullable.** These look inconsistent and are not. The array is optional because it ships *ahead* of
its producer by construction: the rider exists so SERVER-038 has somewhere to land, and a required
key would make this contract change a compile error in the shipped doctor handler until that issue
lands. It is also what makes the change additive for a client generated before it. That argument
does not apply to `warningsField` on mutation responses, which is required-and-empty precisely
because one carrier is spread into every mutation response at once, so no handler can be behind it.
Inside an entry, `path` and `commit` follow `ProjectionDrift.path`'s convention (nullable, never
absent) — and `path` nullable is load-bearing rather than merely conventional: the kind space is
open, so a later kind concerning no single file must be expressible **without** a contract edit, or
criterion 2 is only half true. `commit` reuses `SkillRollbackResult.commit`'s `^[0-9a-f]{7,64}$`
and its null-is-honest rationale.

**3. The human string is named `detail`, not `message`.** The issue's summary says "human message";
this is the one place the implementation reads that as description rather than as a field name.
Three sibling shapes in this same module already call the render-verbatim string `detail`
(`ProjectionDrift.detail`, `Warning.detail`, and `CheckFinding`'s), and a fourth name for the fourth
one is a coin flip every consumer pays for. Flagged here rather than buried: **if the orchestrator
prefers `message`, it is a one-word rename plus a regenerate.**

### Drill 1 — generation is idempotent, and byte-stable across a revert

```
$ npm run generate -w packages/contract
generated ./openapi.json
generated ./src/client/schema.generated.ts
$ H1=<sha256 of both artifacts>; npm run --silent generate -w packages/contract; H2=<same>
artifacts before=40b46e21e2137b21c9951dd73ef60d0267e7a40c119ca8b8c9b911d0fcd5e2cc
artifacts  after=40b46e21e2137b21c9951dd73ef60d0267e7a40c119ca8b8c9b911d0fcd5e2cc
IDEMPOTENT
```

Stronger evidence from the negative control below: after mutating `db.ts`, regenerating, reverting
`db.ts` from backup and regenerating again, both artifacts came back **byte-identical** to the
pre-mutation copies (`diff -q` → `openapi.json IDENTICAL`, `schema.generated.ts IDENTICAL`). Byte
stability is what makes the drift check mean anything.

### Drill 2 — the shipped drift check

`node --import tsx scripts/check-generated-artifacts.ts` (the exact script `.githooks/pre-push` and
`CI / validate` run). Read its three branches (`scripts/generated-artifacts.ts:55-91`) before reading
the output — they are not the same failure:

- **regeneration failed** → did not fire.
- **hash changed across regeneration** (the real staleness branch, and the only one that survives a
  commit) → **did not fire**. This is the drill's green light.
- **`git diff HEAD` non-empty** → fired, printing `openapi.json | 50 ++`, `schema.generated.ts | 18 ++`.
  This is the check correctly reporting *uncommitted* work and is expected to persist until the
  orchestrator commits; it is not resolvable by an agent forbidden from running git. All 68 inserted
  lines are this rider's.

Post-commit the check is green by construction, since the artifacts are already at their generator
fixed point (Drill 1).

### Drill 3 — the additive claim, proven by making it false

Not an assertion in prose. `warnings`'s `.optional()` was removed, artifacts regenerated, and the
gates re-run:

```
required now: ["ok","drift","stats","warnings"]

$ npm run typecheck -w packages/contract          → EXIT 2, 4 errors
src/schemas/db.compat.test.ts(100,11): error TS2741: Property 'warnings' is missing in type
  'AEraDoctorReport' but required in type '{ ok: boolean; …; warnings: {…}[]; }'.
src/schemas/db.compat.test.ts(114,11): error TS2741: Property 'warnings' is missing in type
  '{ ok: true; drift: never[]; stats: {…}; }' but required in type '{ …; warnings: {…}[]; }'.

$ vitest run …/db.test.ts …/db.compat.test.ts …/openapi.test.ts   → EXIT 1
  × the doctor rider is additive… > still parses an A-era payload, so no shipped handler's output turns invalid
  × DoctorReport > round-trips a clean projection
  × DoctorReport > round-trips a drifted projection with several findings
  × DoctorReport > omits the key entirely when the server runs no warning pass
  × the projection maintenance routes > the report-only warnings surface > leaves `warnings` out of
    `required`, which is what makes the rider additive
```

Line 100 is the **write** direction (an A-era payload must still satisfy the post-rider type); line
114 is the generated client component keeping `warnings?` optional. Both bite, at compile time and
at runtime, on the exact regression the criterion names. Reverted and regenerated; artifacts
byte-identical (Drill 1).

### Drill 4 — the compat assertion, and what it actually asserts

`src/schemas/db.compat.test.ts` transcribes the pre-rider `DoctorReport`, `ProjectionDrift` and
`DoctorStats` **by hand** from `schema.generated.ts` as it stood before this change. Deliberately
not derived from anything in the package: a snapshot that tracks the current types asserts nothing.
Four directions:

| Direction | Meaning | Assertion |
| --------- | ------- | --------- |
| Read | A-era consuming code compiles against a post-rider payload | `const consumed: AEraDoctorReport = POST_RIDER_PAYLOAD` |
| Write | An A-era payload satisfies the post-rider type and still parses | `const produced: DoctorReport = A_ERA_PAYLOAD`; `DoctorReportSchema.parse(A_ERA_PAYLOAD)` |
| Generated | `warnings` is optional in the client component `apps/cli`/`packages/kit` see | object literal typed `components["schemas"]["DoctorReport"]` with no `warnings` |
| Wire → schema | A wire-typed payload flows into the inferred type | `const fromSchema: DoctorReport = WIRE_PAYLOAD` |

**Finding, pre-existing and worth recording.** The reverse of the last row — zod-inferred assigned
*to* the generated type — does not compile, and it is nothing to do with this rider. Under
`exactOptionalPropertyTypes`, `z.infer` widens an optional property to `warnings?: T[] | undefined`
while `openapi-typescript` emits `warnings?: T[]`: `/usr/bin/grep -c "| undefined"
src/client/schema.generated.ts` → **0**, against 749 optional properties. So zod-inferred types are
assignable *from* generated ones and never *to* them, uniformly, for every optional field in this
contract. My first draft asserted that direction, it failed typecheck, and the assertion was
corrected rather than the schema contorted. Written into the test's docblock so the next person
does not rediscover it.

### Drill 5 — the downstream consumers compile, untouched

The point of "additive": nobody has to change.

```
$ npm run build -w packages/contract                 → OK
$ npm run typecheck -w packages/contract             → EXIT 0
$ npm run typecheck -w apps/server                   → EXIT 0   (zero edits to apps/server)
$ vitest run apps/server/src/projection              → 12 files, 168 tests, all pass
```

The server run is the load-bearing one: `apps/server/src/projection/routes.test.ts` parses real
`GET /api/db/doctor` responses through `DoctorReportSchema` (lines 272–339). The shipped handler
still builds a report with no `warnings` key, and that output is still valid — which is the whole
claim, checked against the real handler rather than against a fixture. `toDoctorReport`
(`routes.ts:84`) needed no edit.

CLI doctor output is unaffected: `apps/cli/src/commands/db/doctor.ts` renders `drift` and `stats`
and never reads an unknown key. Confirmed by negative evidence — `/usr/bin/grep -rn "warning"
apps/cli/src/commands/db/` returns nothing.

### Test results

| File | Tests | Note |
| ---- | ----- | ---- |
| `src/schemas/db.test.ts` | 53 | +22: a `DoctorWarning` block (17) and `DoctorReport` warnings cases (5) |
| `src/schemas/db.compat.test.ts` | 6 | new file — the additivity assertion |
| `src/openapi.test.ts` | 202 | +10 document-level pins, 1 rewritten |
| **`packages/contract` (scoped)** | **1353 in 40 files, all pass** | `VITEST_MAX_THREADS=4` |

`npm run typecheck -w packages/contract` → 0 · `eslint packages/contract` → 0 · `prettier --check` → 0.
No rule was disabled and no suppression added.

### Tripwire I had to trip, deliberately

`openapi.test.ts`'s "finds no other component carrying a differently-shaped `warnings` field" sweep
fails the moment a new component grows a `warnings` key that is not `Warning[]`. That is the sweep
working: `DoctorReport` was added to `FOREIGN_WARNINGS` **with** its rationale, beside
`CheckReport`'s, so the exception is declared rather than absorbed. The route docblock in
`routes/db.ts` that recorded `warnings` as deliberately absent was rewritten rather than deleted —
its original claim (doctor performs no write, so it can produce no §14 commit warning) is still
true and still pinned by a test; what was wrong was reading "no §14 warnings" as "no findings beyond
drift".

### Held for the next spec sign-off round — NOT applied

Per the issue's ledger note, and following CONTRACT-014's precedent, SPEC.md was **not** edited.
Drafted line for §14, for the orchestrator to carry into the user sign-off round:

> `corpus db doctor` may also carry report-only warnings — findings worth a person's attention that
> are not drift. They never affect its verdict or its exit code.

This rider changes no pass/fail semantics, so nothing here is blocked on that line landing.

### Open question for the orchestrator

Field name `detail` vs. the issue's "human message" (Decision 3 above). Chose consistency with the
three sibling shapes; a one-word rename plus a regenerate if ruled otherwise.

### Tree hygiene

Touched only `packages/contract/**`, the two regenerated artifacts, and this issue file. No
`data/`, no `.corpus/`, no scratch workspace, no server, no port. **One caveat to report:**
`scripts/check-generated-artifacts.ts` *runs* each regeneration command before diffing
(`generated-artifacts.ts:63`), so running it also re-ran `npm run docs:cli -w apps/cli` and it
reported `docs/cli.md` stale by 62 lines. That diff is **not** mine — the CLI docs generator imports
nothing from the contract (`/usr/bin/grep -rln "@corpus/contract\|openapi" apps/cli/scripts` → no
hits) and `docs/cli.md` contains no doctor-warnings content. It is the concurrent cli-dev agent's
uncommitted work, and `docs/cli.md` is now verified at its generator fixed point (re-running
`docs:cli` leaves the sha256 unchanged), so nothing is half-written. Flagging it so it is not
mistaken for contract drift at harvest.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
