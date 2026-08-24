# [SERVER-053] Flaky: rollback's "nothing to restore" test has a 5s budget it needs 1s of

## Domain
server

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- —

## Investigation 2026-08-05 — it failed CI too, and the obvious fix is wrong

The same test failed **`CI / validate`** on `8f94954c` (run 31043340079), not
just a local gate — so this is not a property of one laptop.

**Measured cost.** `REVISION_SEARCH_LIMIT` is **50**, not fifteen as INFRA-020
recorded. The test commits `LIMIT + 1 = 51` revisions (52 `git` spawns, since only
the first needs an `add`) and the walk it then triggers runs one `git show` per
revision — roughly **a hundred processes in a single test case**. That is the
whole cost, and it is why an idle box needs ~1 s of the 5 s budget and a loaded
one has nothing left.

**The fix that looks right and is not.** Parameterise the bound
(`rollbackSkill(..., revisionSearchLimit = REVISION_SEARCH_LIMIT)`) and let the
test drive the same walk at depth 3. Implemented and then **reverted**: the test
exercises the **HTTP route**, so a function parameter is unreachable from it
without adding a query parameter or a server option that exists only for tests —
a production API surface bought for a test's convenience. An unused parameter is
worse than the flake.

**So the next attempt has to choose one, deliberately:**

1. Have this one test call `rollbackSkill` directly instead of through the route,
   asserting the thrown `notFound` rather than a 404. The refusal and its scoping
   are asserted unchanged; what is lost is route coverage for *this* case, which
   the three sibling 404 tests in the same describe already cover.
2. Lower `REVISION_SEARCH_LIMIT` itself. 50 `git show` calls inside a request
   handler is a real cost in production too, and the docblock already says the
   answer "is almost always the first or second one". If the shipped bound were
   ~10, the test would cost a fifth of what it costs now with no test-only seam
   at all — but this changes product behaviour and needs its own justification.
3. Raise the timeout for this file only, and say plainly that the hundred
   processes are irreducible. The weakest option; the criteria below prefer the
   others.

Option 2 is the most interesting and the least explored: it is the only one that
makes the *product* cheaper rather than the test.

## Summary
`apps/server/src/skills/rollback.test.ts:292` — _"refuses when the walk found
nothing, scoping the claim to what it examined"_ — timed out at the default
5000 ms during a pre-push gate on 2026-08-03, failing the whole run at
**1 failed / 9013 passed** and costing a full push cycle.

Re-run in isolation immediately afterwards: the same test passes in **1036 ms**,
whole file 33 tests in 7.5 s. So it is not broken, it is expensive — roughly a
fifth of the default budget when the machine is idle, which leaves no room on a
machine that has just finished an e2e run. The test walks fifteen revisions and
has `checkSave` refuse all of them.

This is the second load-sensitive failure in two days (UI-047 is the other), and
both cost a full gate cycle. Worth fixing the cause rather than raising the
timeout: a test that needs 20% of its budget idle is a test that will fail again.

## Resolution 2026-08-24 — the test does not exist, and the class does

**The subject was deleted, so nothing was fixed here.** `git log --diff-filter=D`
finds `apps/server/src/skills/rollback.test.ts` (755 lines) and
`apps/server/src/skills/rollback.ts` (333 lines) removed in **`6c523edb`**
(SHARED-041, 2026-08-12), together with `apps/cli/src/commands/skill/rollback.ts`
and the route behind them — CLI-040, status `done`. `skills/routes.ts` now says so
in its header: *"There is no rollback verb, and that is a decision rather than a
gap"*. The string `REVISION_SEARCH_LIMIT` appears nowhere in `apps/`, `packages/`
or `issues/` outside this file, and the test title *"scoping the claim to what it
examined"* survives only in this issue's own Summary.

So the three options the 2026-08-05 investigation posed are all moot. Option 2 —
lower `REVISION_SEARCH_LIMIT` and make the *product* cheaper — was the most
interesting, and it was answered in the strongest available form: the hundred
processes are not fewer, they are none, because the walk that spawned them is not
shipped. A rollback is now `PUT /api/docs/{id}` with the key of the revision the
agent read.

**This did not close the pattern, and the pattern was measured.** See the log
below. Two surviving `apps/server` tests sit at 82% and 91% of the default
5000 ms budget with **no** timeout of their own, and neither is load-sensitive:
their cost is a fixed ~4 s that INFRA-020's "verify under load" criterion would
have reported as stable. The rollback test used 20% of its budget idle. Its
successors use four times that, and one of them is not even doing its own work.

## Acceptance Criteria

_Not applicable: the test named below was deleted on 2026-08-12 (see Resolution).
Left unticked rather than ticked falsely._

- [ ] The test passes reliably under load — verify with `--repeat-each`-style
      repetition while the machine is deliberately busy, not on an idle box
- [ ] Prefer making the test cheaper (fewer revisions, or a faster refusal path)
      over raising `testTimeout`; if the budget genuinely must rise, say why the
      work is irreducible
- [ ] Check its siblings in the same file for the same shape — the fifteen-deep
      walk may not be the only one
- [ ] What it asserts is unchanged: the refusal, and the claim being scoped to
      what was examined

## Technical Design
### Files to Create/Modify
- ~~`apps/server/src/skills/rollback.test.ts`~~ — deleted 2026-08-12 in `6c523edb`.
  Nothing was modified for this issue. The two tests that inherited the pattern
  are `apps/server/src/attachments/serve.real-listener.test.ts:139` and
  `apps/server/src/events/sse.test.ts:306`, and they belong to INFRA-020 rather
  than here.

## Testing Strategy
Repeat runs under CPU load; compare wall time before and after.

## E2E Verification Log

**Model: Opus 5 (1M context).** Investigated 2026-08-24.

### The cause was established before anything was changed, and nothing was changed

The issue asks whether the test is slow or the code is wrong. The answer is
neither: **the test and the code it tested were both deleted twelve days ago.**

```
$ git log --oneline --diff-filter=D --all -- 'apps/server/src/skills/rollback*'
6c523edb [SHARED-041] A key you must present, not a lock you can forget (#43)

$ git show --stat 6c523edb -- apps/server/src/skills/rollback.ts \
      apps/server/src/skills/rollback.test.ts apps/cli/src/commands/skill/rollback.ts
 apps/cli/src/commands/skill/rollback.ts |  92 ----
 apps/server/src/skills/rollback.test.ts | 755 ----------------------------
 apps/server/src/skills/rollback.ts      | 333 --------------
 3 files changed, 1180 deletions(-)

$ grep -rn "REVISION_SEARCH_LIMIT|findLastKnownGood" apps packages issues
(no matches)
$ find apps/server/src -name 'rollback*'
(no matches)
```

`issues/cli/040-remove-skill-rollback.md` is `done`. No test file was edited and
no timeout was raised for this issue.

### The pattern was still measured, because the pattern is what INFRA-020 owns

Two runs of the whole `apps/server` suite, one under deliberate contention and one
without it, with `--reporter=verbose` so every test reports its own duration. The
machine has 8 cores and was already carrying two other agents.

```
$ for i in 1 2 3; do (while :; do :; done) & done          # 3 spinners
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run --reporter=verbose apps/server
  EXIT=0
  Test Files  205 passed (205)
       Tests  4671 passed (4671)
    Duration  131.24s (tests 727.63s summed across workers)
  load averages before: 1.86 3.97 4.40      after: 45.14 17.06 9.38
```

**The whole server suite is green under a load average of 45 on 8 cores** — harder
than a real gate, which runs vitest beside one Playwright browser. No test came
close to failing.

The three most expensive cases, and what removing the added load does to each:

| Test | loaded | unloaded | own timeout? |
| --- | --- | --- | --- |
| `attachments/serve.real-listener.test.ts` → "serves a legitimate attachment" | 4570 ms | **4328 ms** | **none — 91% of the 5000 ms default** |
| `events/sse.test.ts` → "releases attached streams so shutdown does not hang on them" | 4107 ms | **4042 ms** | **none — 82% of the default** |
| `docs/bulk.test.ts` → "archives twenty documents as one commit whose files are exactly `changed`" | 4056 ms | 2338 ms | yes, `}, 20_000)` with reasons |

`vitest.config.ts` is the only Vitest config in the repository and sets no
`testTimeout`, so anything without its own third argument runs on 5000 ms.

**`bulk.test.ts` is already handled and is the model answer.** Someone met exactly
this and wrote it down at `apps/server/src/docs/bulk.test.ts:177`: *"Measured at
~4.3 s alone and over the 5 s default under a full-suite run, so it failed on the
clock rather than on an assertion. Given room rather than trimmed: the twenty is
the point of the test."* That is a diagnosis, a measurement and a reason — INFRA-020's
criteria met. It is also the only one of the three that is genuinely
load-sensitive (2338 → 4056 ms, a factor of 1.7).

**The other two are not load-sensitive at all**, and that is the finding worth
keeping. Load moved them 242 ms and 65 ms. Their siblings, doing the same work in
the same file, place the cost exactly:

```
serve.real-listener.test.ts › "over a real socket"   (unloaded)
  serves a legitimate attachment ....................... 4328 ms   ← first to bind
  refuses ... an encoded dot segment ....................  255 ms
  refuses ... a literal dot segment .....................  266 ms
  refuses ... a mixed dot segment .......................  245 ms
  refuses ... an upper-case encoded dot segment .........  260 ms
  refuses a raw traversal out of the attachments root ...  241 ms
  refuses a backslash target ............................  243 ms

sse.test.ts › "GET /events over a real socket"       (unloaded)
  streams text/event-stream and only `invalidate` frames    76 ms
  accepts the token as a query parameter ................    42 ms
  prunes a client that hangs up, and keeps serving ......    41 ms
  releases attached streams so shutdown does not hang ... 4042 ms   ← last, not first
```

The attachment case is **one-time warm-up billed to whichever test runs first**:
it is the first in its file to bind a real listener and boot a server, and its six
identical siblings cost a sixteenth of it. Reordering the file would move the 4.3 s
onto a different test without changing anything real, which is why no assertion
in it is the problem.

The SSE case is the opposite: it is the **last** test in its describe, so nothing
is being amortised — it holds a real ~4 s wait of its own, in `await server.close()`
or in the `readUntil(body, () => false)` that follows it. Unverified hypothesis for
whoever picks it up: `SHUTDOWN_GRACE_MS` is **5000** (`lifecycle.ts:28`), and a
shutdown that waits out a grace period would explain both the magnitude and the
indifference to load.

### For infra-dev, in terms INFRA-020 can generalise from

Four findings, none of which is "raise the timeout".

**1. INFRA-020's tell has a mirror image, and this suite is full of it.** The issue
records *"a test that fails without contention is not load-sensitive; it is racy"*.
The mirror is now measured: **a test that is slow without contention is not
load-sensitive either — it is just slow, and adding load will not reveal that.**
Both untimeouted tests above moved less than 250 ms between load average ~4 and
~45. The verification INFRA-020's criteria ask for — `--repeat-each` on a busy box —
would have reported them *stable* while they sit at 82% and 91% of budget. The
question to ask first is not "does it flake under load" but **"what fraction of its
budget does it use, and does that fraction move when the machine gets busy"**. The
two answers point at different fixes.

**2. The proposed rule wants a different constant and a second clause.** INFRA-020
floats *">20% of its timeout idle will flake under the gate"*. As measured that
flags all three of these plus roughly two dozen more in this suite, so it would be
ignored. What the data supports: *a test above ~50% of its budget **when measured
under contention** is a gate risk, and the load multiplier observed in this suite
tops out near 1.7×.* Everything the rollback test's 20%-idle figure was meant to
catch is caught by 50%-loaded, and far less is swept up with it.

**3. Two different faults are being hidden by one symptom.** A 4 s test is a gate
risk whether the 4 s is its own work (SSE), its neighbours' warm-up (attachments),
or genuine load-sensitive cost (bulk). Only the third wants a bigger timeout. The
first wants the wait removed, and the second wants the warm-up moved into a
`beforeAll` so it stops being charged to an arbitrary test — a fix that also stops
a harmless reordering from moving the risk around. Recording *which* of the three
is what makes the diagnosis criterion worth having.

**4. Both rows of INFRA-020's table are now deleted code, and the issue is still
right.** The e2e todos spec went with the plugin surface, and the rollback test went
with the rollback verb. The class did not go with them. **INFRA-020 was not touched
by this issue** — it stays open, as instructed — but its Technical Design still
names `apps/server/src/skills/rollback.test.ts` as the file to modify, and that
file does not exist. The two replacements are
`apps/server/src/attachments/serve.real-listener.test.ts:139` and
`apps/server/src/events/sse.test.ts:306`.

### Correction, recorded because it nearly went into this log

The first pass of this investigation reported that none of the three tests carried
an explicit timeout. That was wrong about `bulk.test.ts`, and the cause was the
grep, not the file: `grep -E "\}, *[0-9]{4,}\)"` does not match `}, 20_000)`,
because the numeric separator is an underscore. Any sweep for per-test timeouts in
this repository must use `[0-9_]`, and must also match the options-object form
`{ timeout: N }`, which several files use instead.

## Completion Checklist (domain agent)
- [x] Tests written and passing — none written: the subject was deleted, and the
      whole `apps/server` suite was run instead (4671 passed, exit 0)
- [x] `/lint` passes — no source file was changed for this issue
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified — retired as not applicable, with reasons

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
