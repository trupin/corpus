# [SERVER-133] SPEC calls the staleness thresholds defaults, and nothing can change them

## Domain
server

## Status
todo

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
- [ ] A `staleness` block in `.corpus/config.json` sets the three thresholds
- [ ] Omitting it keeps 30/90/180 exactly as today
- [ ] A misordered or negative set is refused at boot, naming the fault
- [ ] Changing them and restarting changes which tier a document reports, shown
      end to end against a real workspace
- [ ] `db rebuild && db doctor` is clean after a change
- [ ] SPEC §5 needs no amendment — this makes an existing sentence true

## Testing Strategy
Unit over the schema and the validation. One end-to-end: set a threshold, restart,
observe a document change tier, then `rebuild && doctor`.

## E2E Verification Log
_[Agent fills — state the model]_
