# [CONTRACT-027] Upgrade routes: check + trigger

## Domain
contract

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-007
- Blocks: SERVER-050, UI-035

## Spec References
- SPEC.md §2.4 "Upgrading" (SHARED-007 rider, applied 2026-08-05, commit a7cc53bb)
- SPEC.md §9.2 (HTTP API), §9.3 (contract-first)

## Summary
Two routes for the UI's on-demand upgrade flow. `GET /api/upgrade/check`:
`{installed, latest, upgradeAvailable, notesUrl}` (server proxies GitHub on
demand; no caching semantics in the contract beyond an honest fetch).
`POST /api/upgrade` → 202 `{started: true}` — the server spawns the detached
CLI upgrade; the restart itself is observed by the client as the SSE drop and
reconnect, not modeled in this response. Error shapes follow the house
envelope; a check that cannot reach GitHub is a described failure, not a 500.

## Acceptance Criteria
- [x] Both routes defined in zod-openapi with strict schemas; openapi.json and
      the generated client regenerated (drift-checked)
- [x] Unreachable-GitHub check response modeled explicitly
- [x] 202 semantics documented on the trigger route

## Technical Design
### Files to Create/Modify
- `packages/contract/src/routes/upgrade.ts` + schemas, inventory, index; the
  generated artifacts

### As built
- `packages/contract/src/schemas/upgrade.ts` — `UpgradeCheck`, `UpgradeStarted`.
- `packages/contract/src/routes/upgrade.ts` — `checkUpgrade` (`GET
  /api/upgrade/check`), `startUpgrade` (`POST /api/upgrade`).
- Wired into `schemas/index.ts`, `routes/index.ts`, `routes/inventory.ts`
  (with the §2.4 derivation note), and the `upgrade` tag in `openapi.ts`.
- Regenerated `openapi.json` + `src/client/schema.generated.ts`.

Decisions worth carrying forward:
1. **`upgradeAvailable` and `verifiable` are two fields, not one.** §2.4 makes
   `corpus upgrade` verify the published checksum, and INFRA-016 is what
   publishes it (`corpus-<version>.tgz.sha256`, `shasum -a 256` two-field
   format, bare filename). A release cut before that asset existed is a real
   newer release the upgrade will nonetheless refuse. One boolean could not
   distinguish "up to date" from "newer, but not installable automatically".
2. **`reachable` is a field, not `latest === null`.** An offline/rate-limited
   check and a distribution with no releases yet are different facts; conflating
   them would tell an offline operator that Corpus has never shipped. The
   unreachable case is a `200` body, never a `5xx` — the endpoint did its job.
3. **`started: literal(true)` + a `409`.** The only refusal is the in-flight
   guard, so a `started: false` body would be an unreachable client branch. The
   inverse of `AppendLogResult.appended`, and the docblocks state why.
4. **`logPath` on the 202.** §2.4's conflict rule ("a conflict is unresolved
   work rather than a notice", listed distinctly) cannot be satisfied over this
   connection: the report is written minutes later by another process, across
   the restart that drops the client's SSE stream. Naming the file is the only
   way the requirement stays reachable from the HTTP surface, and it is what
   makes SERVER-050's "discoverable path" literally discoverable.
5. **Neither route carries `x-corpus-author`.** The upgrade does commit, but the
   *server* does not: its whole contribution is `spawn`, and the writes happen
   in a detached process that outlives it. Added to `openapi.test.ts`'s
   `UNATTRIBUTED_POSTS` with the reasoning; additive if later wired through.
6. **The template sync is not modelled on the check.** The three-way rule
   compares against the files the *new* tool ships, which do not exist in the
   workspace until the install has happened — a running server cannot compute
   the incoming side, so the field would be a guess.

## Testing Strategy
Route/schema tests matching house patterns (see routes/*.test.ts).

## E2E Verification Log

Ran on **opus** (`contract-dev`), 2026-08-05, in place on `phase-13-dogfood-wave3`.
No git commands were run.

**1. Generation, not hand-editing (§9.3).** `npm run generate -w
packages/contract` → `generated ./openapi.json`, `generated
./src/client/schema.generated.ts`. Re-ran it and compared checksums — byte-identical,
so generation is idempotent:

```
3b1507330929719e679ac815316fa234c5fa761298bd9f8925198bffb17b697e  packages/contract/openapi.json
6f7b50165a6a49b061e8058ddd5ae442ee1829b2cebdc83c4fd89e5b546bad73  packages/contract/src/client/schema.generated.ts
```

**2. The drift check actually fires.** Tampered with the committed
`openapi.json` (changed `paths./api/upgrade/check.get.summary` to `"tampered"`)
and re-ran the artifact specs: `artifacts.test.ts` failed with
`openapi.json is stale — run: npm run generate -w packages/contract`, exit 1.
Restored the backup and re-ran — `PASS (69) FAIL (0)`, and the file's sha256 is
back to `3b150733…`, so nothing was left disturbed.

**3. The generated client carries the shapes a consumer will meet.** Read back
from `src/client/schema.generated.ts` (not from the Zod source):

```ts
UpgradeCheck: {
  installed: string; latest: string | null; upgradeAvailable: boolean;
  verifiable: boolean; notesUrl: string | null; reachable: boolean;
  detail: string | null;
};
UpgradeStarted: { started: true; logPath: string };
```

`started` is `true`, not `boolean` — the literal survived generation.

**4. Typed client against a mounted app.** `src/routes/upgrade.test.ts` mounts
both definitions on a real `OpenAPIHono` and drives them through
`createCorpusClient`:
- `GET /api/upgrade/check` (reachable) → `data` equals the full check body.
- `GET /api/upgrade/check` (unreachable stub) → **`error` is undefined and
  `data.reachable` is `false`** — the acceptance criterion: a described `200`,
  not a thrown/`5xx` failure. `installed` is still `"0.3.0"` offline.
- `POST /api/upgrade` → HTTP **202**, body `{started: true, logPath:
  ".corpus/upgrade.log"}`.
- A second `POST /api/upgrade` on the same app → HTTP **409**, body
  `{code: "conflict", message: …}` — the house envelope, narrowable by `code`.

**5. Prose that no schema can hold is pinned by tests.** `upgrade.test.ts`
asserts the published descriptions contain §2.4's on-demand rule ("never checks
for, downloads, or installs anything in the background, and never phones home"),
the conditional restart ("if and only if the server was running when the upgrade
began"), the SSE ride-through, the checksum requirement, and — on the trigger
and on `logPath`'s own description — "**a conflict is unresolved work rather
than a notice**" plus `corpus workspace diff <path>`.

**6. Checks.** Exit codes read from the tool, not through a pipeline:
- `npm run build -w packages/contract` → exit 0
- `npm run typecheck -w packages/contract` → exit 0
- `VITEST_MAX_THREADS=4 npx vitest run packages/contract` → exit 0,
  **PASS (1831) FAIL (0)** (contract workspace only; the repo-wide gate is the
  orchestrator's)
- The two new files alone: **41 tests**, all passing
- `npx eslint <10 touched sources>` → exit 0, "No issues found" (no rule
  disabled anywhere)
- `npx prettier --check <12 touched files, generated artifacts included>` →
  exit 0

**7. One pre-existing test needed updating, deliberately.**
`openapi.test.ts`'s "declares the optional actor header on every mutating
operation" failed on `POST /api/upgrade` — correctly, since it is a mutating
`POST`. Added it to `UNATTRIBUTED_POSTS` with the reasoning recorded in that
set's docblock (the server does not commit; the detached process does), and the
set's mirror test ("exempts %s by declaring no header at all") now covers it
from the other side too.

**Not verified here, by scope:** no real GitHub call, no real spawn, no server
handlers. Those are SERVER-050's E2E.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
