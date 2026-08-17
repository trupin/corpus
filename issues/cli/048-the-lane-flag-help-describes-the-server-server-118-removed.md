# [CLI-048] `--thread`'s help asserts the behaviour SERVER-118 removed

## Domain

cli

## Status

done

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

- [x] `idle`'s help says a scope that names no lane is refused, and what to do
      about it — the server's own message already names all three recoveries
      (omit `scope`, designate first, pick from `corpus agents`) and the help
      should not say less
- [x] `claim-all`'s help keeps the tolerant statement **and says why it differs**,
      since a reader meeting two rules for one flag will assume one is stale
- [x] `docs/cli.md` regenerated
- [x] Pinned, both directions — CLI-045 pinned its rule after the same class of
      drift recurred four times

## Implementation Notes

`LANE_FLAG` is gone; `lane.ts` now exports `IDLE_LANE_FLAG` and
`CLAIM_ALL_LANE_FLAG`, both built by concatenating one private
`LANE_FLAG_COMMON` — everything a caller needs to *pick* a value — with the one
paragraph where the verbs differ. The split is exactly as wide as the divergence:
the shared half is still a single string, and a test asserts both descriptions
still open with the whole of it, so what the flag *is* cannot drift apart even
though what happens to an undesignated thread now differs.

Wording is taken from `packages/contract/src/routes/queue.ts`'s `idleQueue`
description (CONTRACT-058) and `apps/server/src/errors.ts`'s `unknownLaneScope`,
translated into CLI vocabulary (`omit the flag` for `omit scope`, `corpus agents`
for `GET /api/agents`, and `exit 5` beside the `422` as `--job` already does in
`input.ts`) rather than phrased a third time from the behaviour.

Two things carried over that the issue did not name but the same 422 makes
load-bearing:

- **`idle`'s own description and module comment** both asserted the lane
  "changes nothing else" about the verb. True of an *accepted* lane, and now the
  one thing a lane can do is fail — so the presence paragraph states the refusal
  (the derivation is the same one it already makes: the park is the presence, so
  a park the roster cannot name would leave `corpus agents` reporting a lane that
  does not exist) and points at the flag for the three recoveries.
- **`lane.ts`'s "Why there is no `CORPUS_LANE`"** rested on "a lane has no such
  check", which SERVER-118 falsified as written. The argument survives intact and
  is now stated as what it always meant: the new guard cannot fire on the mistake
  an inherited variable makes, because the lane it names is entirely real —
  somebody else's.

## E2E Verification Log

**Model: Opus 5 (1M context).** Documentation-only; no behavioural change —
`resolveLaneScope` is untouched and no request path moved.

**No E2E drill was staged, deliberately.** SERVER-118's refusal has its own tests
(`apps/server/src/queue/scope.test.ts`, `routes.test.ts`) and CONTRACT-058's 422
declaration has `packages/contract/src/routes/queue.test.ts`. A drill here would
have started a server only to re-observe their assertions; what this issue
changes is prose, and prose is verified by reading it against the two sources it
must agree with — which is what the pins do, on every run, rather than once.

Checks run:

```
$ ./node_modules/.bin/eslint apps/cli/src/commands/queue/   →  exit 0
$ ../../node_modules/.bin/tsc --noEmit -p tsconfig.json     →  exit 0   (in apps/cli; output to file — the rtk proxy prints success regardless of tsc's status)
$ npm run docs:cli -w apps/cli                              →  generated ../../docs/cli.md
$ npx prettier --check docs/cli.md apps/cli/src/commands/queue/*.ts  →  clean
$ npm test -w apps/cli                                      →  see report
```

`docs/cli.md`'s diff is exactly the two `--thread` rows (1404 claim-all, 1596
idle), their table rules re-widened by Prettier, and `idle`'s presence paragraph.

### Sweep for other prose invalidated on this branch

Beyond the two lines the issue named, the whole CLI source tree was swept for
help text describing lane, scope, designation, residency, presence or liveness
against the three server changes that landed here — SERVER-112 (presence is a
parked request), SERVER-117 (the scope walk follows both edges), SERVER-118 (a
scope naming no lane is refused). Findings are in the report; the two carried
over above came out of it, not out of the issue.

## Testing Strategy

Unit on the help text. No drill: SERVER-118's plumbing has its own tests.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-048]` prefix
