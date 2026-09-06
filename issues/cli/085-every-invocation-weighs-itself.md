# [CLI-085] Every invocation weighs itself

## Domain

cli

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: CONTRACT-097, SERVER-166; the SHARED-079 rider signed
- Blocks: UI-190 (nothing to plot until something reports)

## Spec References

- SPEC.md §2, §9 — the drafted telemetry rider (SHARED-079)

## Summary

The dispatcher measures every invocation and reports it fire-and-forget:

- **Wrote**: argv bytes (joined, as received) + stdin body bytes where a verb
  consumed stdin. **Read**: bytes written to stdout + stderr, counted at the
  output layer (`out.ts` is one funnel — verify and use it; if any verb
  writes past it, that is a finding to fix, not to work around).
- **Subjects**: the doc/thread ids the invocation resolved — from parsed
  args, not regex over argv. `batch` reports per entry, under the entry's own
  command path.
- **Fire-and-forget, after the work**: the report POSTs after the command's
  own output is flushed and the exit code decided. A failed/slow report
  never changes the outcome, never prints, never retries (SHARED-079's
  invariant: no verb's outcome may depend on the telemetry channel). Decide
  and record the mechanics honestly — a detached POST races process exit;
  options: await with a short cap (~50ms), or piggyback the next invocation
  (buffer under .corpus/). Measure the chosen shape's cost against CLI-058's
  bench and record it; the budget is ~5ms added latency.
- **Exclusions, recorded**: `--help` (no server), `corpus init`/`server`
  lifecycle (no workspace yet or server down), the telemetry POST itself
  (never self-reporting), `--json` and human mode both count.

## Acceptance Criteria

- [ ] A `thread show` on a seeded thread produces one report whose readBytes
      matches `wc -c` of its output, subject = the thread id — E2E, real
      server, verified in the server's table
- [ ] A dead server: every verb's behaviour and exit code byte-identical to
      today (assert the absence of any telemetry error surface)
- [ ] `bench:startup` delta recorded, ≤ ~5ms
- [ ] `batch` attributes per entry
- [ ] `docs/cli.md` regenerated; a short help note under `corpus` names the
      measurement and its unit

## E2E Verification Log

_Implementing agent fills; state the model._
