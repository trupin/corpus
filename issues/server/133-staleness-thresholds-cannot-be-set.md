# [SERVER-133] SPEC calls the staleness thresholds defaults, and nothing can change them

## Domain
server

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Related: SERVER-004 (the projection the tiers are computed in)

## Spec References
- SPEC.md **§5** — *"A document's age runs from `max(updated, reviewed)` against global thresholds … (**defaults**: 30/90/180 days → fresh, aging, stale, very stale)"*

## Summary

Reported from live use, 2026-08-21, and verified in this repository.

SPEC §5 calls 30/90/180 **defaults**. A default is a value something else can
override. Nothing can.

- `WorkspaceConfigSchema` (`apps/server/src/config.ts:107`) holds `version`,
  `port`, `host`, `token`, `dataDir`, and optional `attachments`,
  `editAcknowledgment` and `embedding` blocks. There is **no staleness block**.
- `STALENESS_THRESHOLD_DAYS` (`apps/server/src/docs/staleness.ts:16`) is a
  constant, and its own comment calls it *"SPEC.md §5's default thresholds"*.
- `corpus workspace` has no config verb.

So the word "defaults" in the spec is not true of the code. This is a spec/code
disagreement, not a feature request, which is why it is P1 rather than P2.

**The user's position, which is the substance of the report:** the only lever
available today is the per-document `evergreen` flag, so tuning the ramp means
marking reference material evergreen one document at a time — using an opt-out
to simulate a threshold.

## Why this is cheap

The config schema already has the pattern: `attachments`, `editAcknowledgment`
and `embedding` are exactly this shape — an optional block with defaults that
fall back to the constants. A `staleness` block follows a path already worn.

## Decisions to make and record

1. **Whether the thresholds are per workspace only, or also per document type.**
   A reference note and a todo do not age at the same rate, and someone will ask.
   Build the simpler one if the harder one is not clearly wanted, but say which
   you chose.
2. **What happens to the projection when they change.** The tiers are computed
   in SQL (`STALE_TIER_SQL`), and rows already projected were computed against
   the old numbers. Say whether a change triggers a reprojection, and make
   `db doctor` agree either way — a doctor that fails after a legal config edit
   is worse than no config.
3. **Validation.** Ascending, positive, and three of them. A misordered set must
   be refused at boot with a sentence naming the problem, not silently sorted.

## Acceptance Criteria
- [x] A `staleness` block in `.corpus/config.json` sets the three thresholds
- [x] Omitting it keeps 30/90/180 exactly as today
- [x] A misordered or negative set is refused at boot, naming the fault
- [x] Changing them and restarting changes which tier a document reports, shown
      end to end against a real workspace
- [x] `db rebuild && db doctor` is clean after a change
- [x] SPEC §5 needs no amendment — this makes an existing sentence true

## Testing Strategy
Unit over the schema and the validation. One end-to-end: set a threshold, restart,
observe a document change tier, then `rebuild && doctor`.

## Decisions recorded

**1. Per workspace, not per document type.** §5 says "global thresholds", and the
harder shape is not clearly wanted: a per-type ramp needs a second answer this
issue has none for — what a `type:` the core does not recognise ages at, given
§5's open type. The block is nested, so a later `perType` key has somewhere to go
without moving anything.

**2. A change triggers no reprojection, and `db doctor` cannot notice it.** This
is a property of the existing design rather than a choice made here: the tiers
are computed **at query time**, and the thresholds reach the SQL only as three
bound parameters (`@cutoff_aging`, `@cutoff_stale`, `@cutoff_very_stale`).
`atOrBeyondSql` and `STALE_TIER_SQL` spell no day count, and no projected row
stores a tier — `DocRow.stale` is a `CASE` in the collection query's column list.
So a `db rebuild` after a threshold change writes the same bytes it wrote before,
and `db doctor` compares files against rows that never held the numbers.
Confirmed both ways: a unit test diffs the `documents` rows across a reproject,
and `db rebuild && db doctor` were run against the real workspace below.

**3. Validation.** Three keys, each a whole number of days ≥ 1, strictly
ascending. A misordered set is **refused at boot with a sentence naming both
members**, never sorted — a tier that begins before the one below it can never be
reached, and quietly reordering would run a workspace on numbers nobody wrote.
The floor is one day rather than zero because a tier beginning at 0 holds every
document written today, which is the absence of a ramp rather than a faster one.
The rule lives in the schema (a `superRefine`), so the CLI's reader of the same
file cannot disagree with the server about what a valid config is.

**Wire spelling.** The tier is `very-stale`; the config key is `veryStale`. This
file is JSON and its other compound keys are `maxFileBytes` and `idleMs`, so the
block follows them, and `stalenessThresholdsOf` is the single translation.

## E2E Verification Log

**Model: Opus 5 (1M context).** Real server, real workspace — port **8791**,
never 8765 or 5173.

### Pre-fix reproduction (2026-08-23)

Workspace `scratchpad/ws096`. `doc_nfviq4cf` is a note whose `updated` is
`2026-08-08T00:00:00Z` — **15 days** before the clock.

```
.corpus/config.json:
  "staleness": { "aging": 7, "stale": 14, "veryStale": 30 }

corpus server stop && corpus server start     → pid 86743, uptime 2.283 s
GET /api/docs?stale=aging   → []
GET /api/docs               → doc_nfviq4cf  updated 2026-08-08T00:00:00Z  stale=null
```

Fifteen days old against a configured 7-day `aging` threshold, and the server
reports **fresh**. The block was accepted (the schema parses non-strictly) and
read by nothing — the same failure mode `dataDir` recorded in SERVER-022.

### Post-fix, same workspace, same block, real restart

```
corpus server stop && corpus server start     → pid 89622, uptime 2.262 s
GET /api/docs?stale=aging   → [ doc_nfviq4cf : stale ]
GET /api/docs               → doc_nfviq4cf  stale = "stale"
```

Fifteen days is past `stale` (14) and short of `very-stale` (30), which is the
tier reported.

### Projection, after the change

```
corpus db rebuild → rebuilt the projection in 32ms — 13 documents, ...
corpus db doctor  → projection is clean — 13 documents from 13 files (4ms)
GET /api/docs     → doc_nfviq4cf still stale
```

Clean, and the tier survives the rebuild — because no row ever held it.

### Omitting the block

```
staleness key deleted from .corpus/config.json, server restarted (pid 37843)
GET /api/docs             → doc_nfviq4cf  stale = null
GET /api/docs?stale=aging → []
```

Back to 30/90/180 exactly as before, with no other change.

### Refusals at boot

Each set written to `.corpus/config.json`, then `corpus server start`. All three
exited during startup; `.corpus/server.log`:

```
staleness: {"aging":90,"stale":30,"veryStale":180}
  .../config.json is not a valid workspace config — staleness.stale: the staleness
  thresholds must ascend, and "aging" (90 days) is not less than "stale" (30 days).
  SPEC.md §5 ramps a document fresh → aging → stale → very stale, so each tier
  begins further back than the one before it; remove the block to use the
  defaults 30/90/180

staleness: {"aging":30,"stale":30,"veryStale":180}
  ... "aging" (30 days) is not less than "stale" (30 days) ...

staleness: {"aging":0,"stale":90,"veryStale":180}
  ... staleness.aging: a staleness threshold is a whole number of days and must be
  at least 1: a tier that begins at 0 holds every document written today, which is
  the absence of a ramp rather than a faster one
```

(The zero message was widened after this run — the first cut reported Zod's
`Too small: expected number to be >=1`, which names the key but not the fault.)

### Tests

```
./node_modules/.bin/vitest run apps/server/src/docs/query.test.ts \
    apps/server/src/docs/staleness-config.test.ts apps/server/src/config.test.ts
  → 237 passed
```

New: `apps/server/src/docs/staleness-config.test.ts` (3, route-level through
`createServer`), `query.test.ts`'s *ramps on the workspace's configured
thresholds*, and eight cases in `config.test.ts`.

**Falsification**, twice, restoring the file byte-for-byte each time:

1. Dropping `staleness: config.staleness` from `mountDocsRoutes` in `app.ts` —
   **2 failed | 1 passed** in `staleness-config.test.ts`. The surviving test is
   the *no block* one, which is correct: it asserts the default path.
2. Making `stalenessCutoffs` ignore its `thresholds` argument — **3 failed** across
   `query.test.ts` and `staleness-config.test.ts`.

Both files were compared with `diff` against their pre-break copies afterwards.

**Tests that could not fail with the fix absent**: `is 30/90/180 for a workspace
whose config carries no block` and `is exactly 30/90/180 when the block is
absent` pass either way by construction — they pin the *unchanged* behaviour the
first acceptance criterion asks for, which is the thing a regression would break
in the other direction.
