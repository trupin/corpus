# [CLI-068] `queue claim-all` inside a batch loses its payload, silently

## Domain
cli

## Status
todo

## Priority
P0 (critical path)

## Model
opus

## Dependencies
- Depends on: CLI-064
- Blocks: —

## Spec References
- SPEC.md Section 2 — the CLI is the agent's whole surface
- SPEC.md Section 7 — the queue and claiming

## Summary

**Found by AGENT-051's implementer, hours after CLI-064 shipped in this same
release, while trying to use it.**

```
corpus batch --json   with  ["queue","claim-all"]  in the array
  → "value": null
```

The claim payload is **silently lost**. `queue status` and `doc show` in the
same array carry theirs. Human mode is fine — this is `--json` only, which is
the mode a caller parses.

CLI-064's whole design turns on one guarantee, stated in its own decision
record: `value` is **explicitly `null` when a command emits nothing**, so
*ran-and-returned-nothing* is written down rather than inferred. A command that
emits plenty and reports `null` breaks exactly that guarantee, and breaks it in
the direction that cannot be detected — the report says the command ran, says it
succeeded, and hands back nothing.

The agent worked around it rather than reaching into `apps/cli`: the loop's
claim is kept out of every batch and the skill says why. **That workaround is a
rule the skill states, not a mechanism**, so it holds only as long as nobody
writes a batch by hand.

## Why P0

An agent batching a claim gets an empty answer that reads as success, and then
works on nothing — or worse, on an event list it thinks is empty. This is the
same class as CLI-066: a value the caller sent or expected, dropped at exit 0.
That one took weeks to surface as an orphaned anchor. This one shipped today and
was caught within the hour by the first thing that tried to use it.

## Acceptance Criteria

- [ ] `queue claim-all` inside `corpus batch --json` carries the same payload it
      carries alone.
- [ ] **The cause is named, not patched at the call site.** Find out why this
      command's value is lost where `queue status` and `doc show` keep theirs —
      if the batch runner captures output by a mechanism some commands bypass,
      every command that bypasses it is affected and `claim-all` is the one that
      was noticed.
- [ ] Every command the registry knows is checked for the same loss. A sweep,
      not a spot fix, and the result is stated: which commands were affected and
      which were not.
- [ ] A test asserts the payload's **contents**, not merely that `value` is
      non-null. A test checking non-nullity would pass on an empty object.
- [ ] Human mode stays exactly as it is.
- [ ] Once fixed, AGENT-051's prohibition is revisited — the skill currently
      keeps the claim out of every batch, and that rule should either go or be
      restated for a reason that survives this fix.

## Technical Design

### Files to Create/Modify
- `apps/cli/src/commands/batch.ts` — the runner's output capture
- whichever command surface bypasses it
- the tests beside each

### Key Implementation Details

Read CLI-064's decision record in `issues/cli/064-*.md` first. The envelope's
shape — `{command, ran, ok, value|error}` — and the meaning of `value: null` are
settled and signed; this issue makes the implementation honour them, and must
not change them.

**Do not fix this by special-casing `claim-all`.** The interesting question is
what class of command is affected, and a special case would leave the rest of
that class broken and unfindable.

### Edge Cases
- A command that genuinely emits nothing — `value: null` is correct there, and
  the fix must not turn it into an empty object.
- A command whose payload is large: the batch caps at 200 entries and a claim
  payload can be long.
- Human mode, which is reported working and must stay so.

## Testing Strategy

A batch containing `queue claim-all` beside `queue status`, against a real
server with claimable events, asserting the claim's own fields in the envelope.

**Falsify**: restore the loss and watch the contents assertion fail. A test
asserting only `value !== null` would pass with an empty object in place.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Start a real server with at least one claimable event
2. `echo '[["queue","claim-all"],["queue","status"]]' | corpus batch --json`
3. Expected: both envelopes carry their payloads
4. Actual: the claim's `value` is `null`, and the status's is not

### Verification Steps
1. Repeat after the fix and compare the claim envelope against the same command
   run alone
2. Run the sweep and record which other commands were affected

## E2E Verification Log

### Reproduction (bugs only)
Reported by AGENT-051's implementer, 2026-08-23, against a real workspace:
`corpus queue claim-all` inside `corpus batch --json` returns `"value": null`
while `queue status` and `doc show` in the same array carry theirs.

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
