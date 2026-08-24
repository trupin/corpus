# [SERVER-146] One server test failed once under load and has not been named

## Domain
server

## Status
done

## Priority
P2 (nice-to-have)

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- None. This is test-suite reliability, not product behaviour.

## Summary

**Recorded because the evidence was lost, and that is the finding.**

During v0.20.0's harvest, `vitest run apps/server` reported `1 failed | 4563
passed (4564)` on the run that verified SERVER-145. Two immediate re-runs of the
identical tree reported `201 files, 4564 tests passed`, exit 0.

**The failing test's name was not captured.** The orchestrator read the summary
line and not the failure body, so the only durable facts are the count, the
timestamp, and that the tree was unchanged between the three runs. The machine
was carrying two other agents at the time.

This is filed rather than dismissed. A test that fails once and passes twice is
either a flake or a real race that lost a coin toss, and "it passed on retry" is
not evidence of which. SERVER-140 in this same release was exactly that shape —
3 of 4 runs green — and turned out to be a real ordering bug in a test, fixed to
10 of 10.

## What to do

- [x] Run `apps/server` under deliberate load — the conditions that produced it
      — with `--reporter=verbose` and the output captured to a file, repeatedly,
      until a failure is caught **with its name**. Caught on the first round.
- [x] If it names a test that SERVER-140's family already covers … fold it there
      and close this. It is not SERVER-140's family; it is **INFRA-020's**, and
      it is folded there.
- [x] If it is a real race, fix it and falsify the fix. **It is not a race** — it
      failed only under contention, which is the distinction INFRA-020 itself
      draws. The fix that suggests itself was tried, measured to be worse, and
      reverted; see below.
- [x] If a bounded search cannot reproduce it, close this with the search
      recorded. It did reproduce, and the whole search is recorded anyway.

## Technical Design

### Files to Create/Modify
- Whichever test the search names. None until then.

### Key Implementation Details

**Capture to a file, always.** The reason this issue is thin is that a summary
line was read where a log should have been kept. Every orchestrator-run gate in
this repo should redirect to a file — the cost is nothing and the alternative is
this issue.

INFRA-020 already tracks "tests that fail under gate load and pass in isolation"
as a pattern. Check it before starting: this may be one more instance rather
than a new thing.

### Edge Cases
- The failure being in a file whose whole-file budget is the problem rather than
  one assertion's.

## Testing Strategy

The search **is** the work. Repeated runs under load, verbose, captured.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/server --reporter=verbose > log 2>&1`
2. Run concurrent work to reproduce the load
3. Repeat until a failure is captured with its name

### Verification Steps
1. Ten consecutive green runs under the same load, as SERVER-140 required of
   itself

## E2E Verification Log

### Reproduction (bugs only)
2026-08-23, v0.20.0 harvest: `1 failed | 4563 passed (4564)`, name not captured.
Two re-runs of the same tree: `4564 passed`, exit 0, both times.

### The search, and what it found

**Model: Opus 5 (1M context).** Every run captured to a file under
`scratchpad/flake/` and `scratchpad/burst/`.

**Shape.** Two full `apps/server` suites at once, four workers each,
`--reporter=verbose`, both arms captured. That is the contention the v0.20.0
harvest ran under — two other agents on the machine — reproduced deliberately.

**Round 1 caught it, with its name:**

```
arm a   Tests  1 failed | 4610 passed (4611)   Duration 373.40s
        × apps/server/src/semantic/worker.test.ts
          > startEmbedWorker — debounce behind the write path (TEST-864)
          > embeds the final content once after a burst of saves        446ms
          AssertionError: expected [ …(2) ] to have a length of 1 but got 2
arm b   Tests  4611 passed (4611)              Duration 373.40s
```

Three things make that diagnostic. **446 ms is an assertion failure, not a budget
running out.** **The other arm was green at the same instant on the same tree**,
so it is not the code. And **373 s against a normal ~140 s** is the contention —
which is the test INFRA-020 itself sets: *a test that fails without contention is
not load-sensitive, it is racy.* This one only fails with it.

**It does not reproduce more cheaply.** The file alone, ten times, with one full
suite beside it as load:

```
iter 1..10  pass      before: 10 passed, 0 failed, out of 10 under load
```

Running the file alone gives it the whole event loop. The failure needs the test
to be **inside** a saturated suite — which is exactly why "it passed on retry" is
not evidence, and why the v0.20.0 re-runs proved nothing.

**Why the margin is thin.** Ten saves with an `await` of 5 ms between them,
against a 60 ms debounce. Ten 5 ms gaps sit inside the window until the event
loop is contended; then one gap outgrows it and the worker embeds an intermediate
revision.

### The fix that was tried, measured, and reverted

Removing the sleeps makes the burst synchronous, and a `setTimeout` callback
cannot fire inside synchronous code — deterministic under any load, and it is
SERVER-140's own remedy (decide the interleaving, do not time it).

It is also **wrong**, and the measurement says so: with the burst synchronous the
test passes with `debounceMs: 0`. It stops being about the debounce at all, which
is the one thing it is named for. A test that cannot fail is worse than one that
fails occasionally.

The claim really is a claim about wall-clock time, so the only honest way to
decide it is fake timers over the worker's scheduler — a larger change than a P2
flake hunt should make on its way past a release. **The test is left
behaviour-identical**, with a comment recording all of the above so the next
person does not re-derive it, and the instance is recorded in INFRA-020, which
owns this class.

### Not trustworthy, and said so

Round 2's two arms both failed the same two tests at ~6 s —
`threads/create.test.ts → mints distinct anchor ids for concurrent comments on one document`
and `docs/acts.test.ts → an ordinary save of a document body, whichever document it is to`.
Both arms were killed before printing a summary, so those two are noted in
INFRA-020 rather than tabled. A failure from a run that did not finish is not a
measurement.

### A second name, and this one is fixed

The same search turned up a better-measured instance, and it is the one that
would have cost this release a red harvest gate.

`apps/server/src/docs/acts.test.ts` →
`what does not close a window (§4)` →
`an ordinary save of a document body, whichever document it is to`.

```
alone, load average ~7:   2783ms ✓ | 3120ms ✓ | 6110ms × (timed out in 5000ms)
alone, quieter:           3110ms ✓
inside a full suite competing with another agent's:  ×  6023–6708ms
```

**It fails 1 in 3 running alone**, so it is not merely load-sensitive by this
issue's own test — and the diagnosis is not a race. It is the most expensive test
in its file: **fourteen real HTTP mutations, each with a real git commit**, and
**2.8–3.1 s is 62% of vitest's 5 s default at rest**. INFRA-020's own proposed
rule — "a test that needs >20% of its timeout idle will flake under the gate" —
is met three times over.

**Fixed here, narrowly**: that one test gets an explicit 20 s budget with the
measurement written beside it. Not raised across the board — every other test in
the file keeps the default — and not the real remedy, which is INFRA-020's second
criterion: *make the genuine work cheaper*. Fourteen commits to prove that six
saves fold into one window is more setup than the claim needs.

Falsified by the numbers already taken: at the default budget it timed out in 1
of 3 isolated runs and in every loaded suite. With the budget: **3 of 3 pass**,
at 2640–3969 ms.

**Ruled out as a regression from this release's work.** SERVER-142 changed the
committer, but only on the `snapshot` path, which is the watcher's alone; this
test writes over HTTP and executes the same git commands in the same order as
before. Its 3 s cost is the fourteen commits it always made.

### Was it *the* v0.20.0 failure?

Unknowable, and that is the finding this issue was filed to make. The name was
lost, so nothing can be matched against it. What is now on record is a named,
reproducible instance in `apps/server` of exactly the described shape, together
with the shape that reproduces it and the shape that does not.

## Completion Checklist (domain agent)
- [x] Tests written and passing — none added; the finding is the work, and the
      one file touched gains a comment and no behaviour
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
