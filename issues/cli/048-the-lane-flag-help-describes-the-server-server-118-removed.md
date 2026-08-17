# [CLI-048] `--thread`'s help asserts the behaviour SERVER-118 removed

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Related: SERVER-118, CLI-043

## Summary

`apps/cli/src/commands/queue/lane.ts:55-56` ships this in `--help`, and in
`docs/cli.md` at lines 1404 and 1596:

> "The thread need not already be designated — the server accepts the call on
> whatever lane it is given, since a lane may be designated a moment later;
> `corpus agents` is where to check that the lane is real."

`SERVER-118` made `corpus queue idle --thread th_undesignated` exit 5 with a
422. The sentence is now false for `idle`.

**And it is still true for `claim-all`**, which SERVER-118 deliberately did not
guard — a just-released lane's already-stamped events are invisible to the
orchestrator until the lapse, so refusing the claim would strand them. One
shared string feeds both verbs, and they now need different prose.

## Acceptance Criteria

- [ ] `idle`'s help says a scope that names no lane is refused, and what to do
      about it — the server's own message already names all three recoveries
      (omit `scope`, designate first, pick from `corpus agents`) and the help
      should not say less
- [ ] `claim-all`'s help keeps the tolerant statement **and says why it differs**,
      since a reader meeting two rules for one flag will assume one is stale
- [ ] `docs/cli.md` regenerated
- [ ] Pinned, both directions — CLI-045 pinned its rule after the same class of
      drift recurred four times

## Testing Strategy

Unit on the help text. No drill: SERVER-118's plumbing has its own tests.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-048]` prefix
