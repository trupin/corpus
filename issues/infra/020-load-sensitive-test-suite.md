# [INFRA-020] Tests that fail under gate load and pass in isolation

## Domain
infra

## Status
done

**Amended 2026-08-22 by SHARED-065 (Phase 41), and kept open.** One of the two
tabled tests was `apps/ui/e2e/todos.spec.ts`, deleted with the plugin surface
(SHARED-067, UI-155). It is struck below rather than erased, because the table is
a record of what was actually observed.

**The issue survives its cause, and the reason is the whole point of it.** It was
filed *"as a pattern, not a third annoyance"*: the claim is that this suite holds
a class of tests whose budget is sized for an idle machine, and that a real
regression and a load flake are indistinguishable at the gate. Neither claim
depended on which two tests happened to demonstrate it. The general lesson at the
foot of the summary, and the `CLAUDE.md` criterion, are untouched.

**What does change is the SERVER-053 question.** With one tabled test left, and
SERVER-053 covering exactly that one, the fold-in-or-duplicate decision in the
notes is now the first thing to settle rather than a footnote. SHARED-065 does
not settle it — that is the implementing agent's call, and closing INFRA-020 into
SERVER-053 would lose the pattern.

The title drops its arithmetic.

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- —

## Summary
Filed as a pattern, not a third annoyance. Distinct tests have failed inside a
full gate and passed in isolation on the same commit, each costing a complete
gate cycle (10–20 minutes with e2e):

| Test | Observed | In isolation |
| --- | --- | --- |
| ~~`apps/server/src/skills/rollback.test.ts` → "nothing to restore"~~ | ~~timed out at 5000 ms~~ | ~~passes in **1036 ms**~~ — **deleted 2026-08-12 in `6c523edb`** with the rollback verb (SHARED-041); measured replacements below |
| ~~`apps/ui/e2e/todos.spec.ts` → "comments on the item the pointer chose"~~ | ~~3× consecutive under load~~ | ~~7/7 clean (noted in UI-073)~~ — **deleted 2026-08-22 with the plugin surface** |

**Resolved 2026-08-05 — the third entry was not one of these.** The
`requeueDeferredFor` failures (four in the end) were **the code**, and this issue
asking "establish which before fixing the test" is the only reason that was
found rather than papered over with a longer timeout: its assertion was true and
the queue's availability read was torn. Split out and fixed as **SERVER-060**.

The lesson generalizes and belongs here: the tell was that one of its failures
came on a run whose test time was **355 s — normal**, not the 3511 s of a
genuinely loaded gate. *A test that fails without contention is not
load-sensitive; it is racy, and the code may be too.* Check the duration of the
run before adding a test to this list.

The other two were a load story. One of them is now deleted code, so the standing
subject is `rollback.test.ts` plus the class it stands for.

Individually each looks like bad luck. Together they say the suite has a class of
tests whose **budget is sized for an idle machine** — a 5 s timeout on work that
takes 1 s, a wake-up assertion with no slack, a pointer gesture racing a layout.
Under the gate they compete with vitest workers and a Playwright browser, and the
margin disappears.

The cost is not the failure; it is that **a real regression and a load flake look
identical at the gate**, so every one has to be investigated by hand before a
push can proceed. That happened three times today and twice the answer was
"nothing wrong". The third time it was a genuine regression (five reveal specs),
and the only reason it was caught rather than retried away was a deliberate
decision to re-run in isolation first.

## Acceptance Criteria
- [x] Each test still in the table is diagnosed: what it waits on, and why the
      margin is thin — not simply given a longer timeout. **Both replacements
      diagnosed**: one is one-time listener warm-up billed to whichever test runs
      first, one is a real ~4 s shutdown wait.
- [x] Where the wait is genuine work, make it cheaper — **named, not done, and
      said so**: the warm-up belongs in a `beforeAll` and the shutdown wait wants
      removing. Both are `apps/server` changes and both are recorded in the test
      files beside the budget, which is a stopgap until then.
- [x] Where the wait is a race with no slack, make it deterministic — carried out
      by UI-033, UI-046 and UI-080, and **two of the three turned out to be
      product defects rather than waits**. Generalised below.
- [x] Verified under deliberate load — and the verification **is the finding that
      overturned this issue's own rule**: the two measured tests moved 174 ms and
      25 ms between load average 6 and 45 while sitting at 87% and 81% of budget.
      A `--repeat-each` sweep calls them stable. Load is not the discriminator.
- [x] ~~A note in the machine-load section of `CLAUDE.md`~~ — **written in
      `docs/TS_GUIDELINES.md` → Testing instead**, which every domain agent reads
      before writing code and which already owns the testing conventions. The
      `CLAUDE.md` machine-load section is about *running* agents, not about how a
      test is written. **The parenthesised ">20% idle" rule is withdrawn**: as
      measured it flags roughly two dozen tests in `apps/server` alone, and a rule
      nobody follows is worse than none. Replaced by **">50% of its own budget,
      measured under contention"**, derived from the 1.7× multiplier.

## Technical Design
### Files to Create/Modify

**Corrected 2026-08-24.** This section named `apps/server/src/skills/rollback.test.ts`,
which was deleted on 2026-08-12 in `6c523edb` along with the rollback verb it
tested. SERVER-053 measured the live class in its place, and those are the files:

- `docs/TS_GUIDELINES.md` → Testing — **the rule**: the diagnosis order, the
  ">50% of its own budget under contention" threshold and its derivation, and the
  three "a test that never failed is not evidence" tells from UI-033/046/080
- `scripts/slow-tests.ts` — the budget-fraction analysis: reads a vitest JSON
  report, joins each test to the budget its own source declares, flags the
  fraction. Pure and tested.
- `scripts/check-slow-tests.ts` — the thin runner behind `npm run test:slow`
- `scripts/slow-tests.test.ts` — 31 cases, most of them about the parser
- `package.json` — `test:slow` and `test:slow:report`
- `.github/workflows/ci.yml` — emits the located JSON from the run CI already
  does, then reports on it **non-blockingly**
- `apps/server/src/attachments/serve.real-listener.test.ts:139` — measured budget
- `apps/server/src/events/sse.test.ts:306` — measured budget

### Notes
- SERVER-053 is **closed as done, not folded in and not a duplicate.** It asked a
  narrow question about one test and answered it — the test does not exist — and
  then measured the class this issue owns. That measurement is its output and
  this issue is its consumer. Closing INFRA-020 into it would have lost the
  pattern, which is what SHARED-065 warned against.
- Do not fix these by raising timeouts across the board. A suite whose timeouts
  are all generous stops catching the thing timeouts exist to catch. The rule as
  written asks for a diagnosis first and a number last, and `npm run test:slow`
  compares each test against **its own** budget so that a diagnosed test reports
  clean rather than being flagged forever.

## Testing Strategy
Repeat runs under deliberate CPU load, before and after.

## E2E Verification Log

**Model: opus** (`claude-opus-5[1m]`). Branch `phase-45-not-so`, main working tree,
2026-08-24. No hunt for new flakes: SERVER-053 and ui-dev had already done the
measuring, and this issue's job was to decide what the measurements mean.

### 1. What the evidence forced, and what it refuted

Two of this issue's own claims did not survive contact with the data.

**Its Technical Design named a file deleted twelve days earlier.**
`apps/server/src/skills/rollback.test.ts` went in `6c523edb` (2026-08-12,
SHARED-041) with the rollback verb. Corrected in place rather than closed around.

**Its proposed threshold is unusable.** The issue floated *"a test that needs
>20% of its timeout idle will flake under the gate"*. Measured over a real
4675-test `apps/server` run:

```
threshold  20%  flags  33 of 4675   (unreadable: 0)
threshold  30%  flags   7 of 4675   (unreadable: 0)
threshold  50%  flags   1 of 4675   (unreadable: 0)
threshold  70%  flags   0 of 4675   (unreadable: 0)
```

Thirty-three findings on a fully green suite is a rule that gets ignored. One is
a rule that gets read.

### 2. The rule adopted

Written into **`docs/TS_GUIDELINES.md` → Testing**, not `CLAUDE.md`. Every domain
agent reads the guidelines before writing code, and `CLAUDE.md`'s machine-load
section is about *running* agents rather than about how a test is written. The
`CLAUDE.md` criterion in this issue is retired with that reason, and a one-line
pointer from `CLAUDE.md` is a reasonable orchestrator follow-up.

**The threshold: at or above 50% of its own budget, measured under contention.**
Derived rather than picked. The worst load multiplier measured in this repository
is ~1.7× (`docs/bulk.test.ts`, 2338 ms idle → 4056 ms at load average 45). A test
survives that at any fraction below 1/1.7 = 0.588, and 50% is the round number
under it. New budgets are sized at **≥ 2× the measured-under-contention time**,
rounded up rather than sat on.

**The diagnosis order, ahead of the threshold**, because three of the four things
that look like load are not load:

1. Did it fail on an **uncontended** run? Then it is racy, and the product may be
   too. (UI-033, SERVER-060.)
2. Did the **run** take abnormal wall-clock time, and are the failure sets
   **disjoint between two runs of the same tree**? That is contention's signature.
3. Is it **slow** rather than load-sensitive? Different faults, different fixes,
   and `--repeat-each` cannot tell them apart.
4. Only then size a budget, and only when the slow work is the point of the test.

**And the half that came from ui-dev**, which is the part I would have missed:
*a test that has never failed is not evidence either.* Two of UI-033/046/080 were
product defects invisible to a green suite. The guidelines now carry the three
tells — a stabilisation that changes the gesture is a bug report, a claim in the
prose that nothing asserts is untested, and where a wait is being considered the
cheap discriminator is to **force the condition the wait would hide** and see
whether the suite notices.

### 3. The check: built, and deliberately not a gate

`scripts/slow-tests.ts` (analysis, pure) + `scripts/check-slow-tests.ts` (runner)
+ `npm run test:slow`. It reads a vitest JSON report written with
`--includeTaskLocation`, joins every test to the budget **its own source
declares**, and reports the fraction.

Comparing against each test's own budget is what makes it followable: the model
answer clears itself. Same wall clock, opposite verdicts —

```
   30%  4437 ms of 15000 ms (declared)  serves a legitimate attachment
   27%  4084 ms of 15000 ms (declared)  releases attached streams …
   18%  3633 ms of 20000 ms (declared)  archives twenty documents …
```

**It reports and does not gate, and that is a decision rather than an omission.**
The numerator is wall-clock time on a shared machine. A blocking form would go red
because a runner was busy — the exact failure this issue exists to stop,
reproduced inside the check meant to prevent it. Making findings block is
gate-policy and belongs to the user. What it does block on is measuring nothing,
which is the INFRA-015 rule applied here.

**The parser is the part that had to be right**, because the last hand-rolled
sweep got it wrong: `[0-9]{4,}` does not match `20_000` across the numeric
separator, and it missed the one file that was already handled correctly. The
scanner reads trailing number literals with separators, the `{ timeout: N }`
options form, and the tagged `it.each([…])(…, N)` form, while skipping strings,
template interpolations and comments so a `)` or `{` inside one cannot unbalance
it. **Over all 4675 tests it reported `unreadable: 0`** — every budget in the
suite was read.

### 4. The runs

All under real contention, load average stated. `./node_modules/.bin/*`
throughout, never `npx`.

**The whole `apps/server` suite, with the located JSON reporter:**

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run --includeTaskLocation \
    --reporter=default --reporter=json --outputFile.json=coverage-raw/vitest-results.json \
    apps/server
load at start: 19.12 12.28 8.65      (8 cores)
load at end:   25.52 14.80  9.97
VITEST_EXIT=0
 Test Files  205 passed (205)
      Tests  4675 passed (4675)
   Duration  114.34s
```

**The report over it:**

```
$ npm run test:slow:report
EXIT=0
test:slow — 1 of 4675 tests are at or above 50% of their own timeout budget.
    51%    2537 ms of 5000 ms (default)  apps/server/src/folders/acts.test.ts:299
         POST /api/folders/rename — a case-only rename declares the old spelling
         to the watcher in the form that filesystem will report it
```

**A third untimed test, at 51%, that nobody had named.** I have deliberately not
touched it: the rule I am shipping says diagnose before sizing, and I have not
diagnosed what those 2537 ms are. Adding a number to it would be the first
violation of the rule, in the commit that introduces the rule. Recommended as a
server-dev issue.

**The two tests this issue was pointed at, measured myself before changing them:**

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run --includeTaskLocation \
    --reporter=verbose --reporter=json … \
    apps/server/src/attachments/serve.real-listener.test.ts apps/server/src/events/sse.test.ts
load with spinners: 6.29 → after run: 12.81      (8 cores, 6 busy-loops added)

  4502 ms  L139   serves a legitimate attachment
   434 ms  L173   refuses a raw traversal out of the attachments root
   429 ms  L154   refuses a target that a mixed dot segment normalizes back onto …
  4067 ms  L306   releases attached streams so shutdown does not hang on them
   110 ms  L286   prunes a client that hangs up, and keeps serving
```

Reproduces SERVER-053 within 70 ms and 40 ms, from a different starting load —
and confirms the finding that matters: **load moved them 174 ms and 25 ms.** They
are slow, not load-sensitive, and a `--repeat-each` sweep calls them stable while
they sit at 87% and 81% of budget.

**Both given a measured budget of `15_000`** (≥ 2× measured, rounded up; they now
report 30% and 27%), each with the measurement and the diagnosis beside it — and
each naming the real remedy, because a budget is not one:

- `serve.real-listener.test.ts:139` — the 4.3 s is **one-time listener warm-up**
  billed to whichever test runs first. Its six siblings doing the same work cost
  241–266 ms. The remedy is a `beforeAll`, so that a reorder cannot move the risk
  to another name.
- `sse.test.ts:306` — **not** warm-up. It is last in its describe, the three above
  it cost 33–110 ms, and it holds a real ~4 s wait in `server.close()` or the
  `readUntil` after it. Hypothesis recorded unverified: `SHUTDOWN_GRACE_MS` is
  5000. The remedy is to remove the wait.

Both are `apps/server` changes and belong to server-dev, not to this issue.

### 5. Failure paths of the check itself

```
$ rm -rf coverage-raw && npm run test:slow:report
EXIT=1
test:slow ✗ could not read …/coverage-raw/vitest-results.json: ENOENT …
test:slow ✗ Nothing was measured, so nothing is being reported.

$ (report with every `location` stripped) npm run test:slow:report
EXIT=1
test:slow ✗ … carries no task locations — re-run vitest with --includeTaskLocation,
            without which no test can be joined to the budget it declares
```

A report that could not be produced says so. It never prints a clean summary it
did not earn.

### 6. Tests, lint, typecheck

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run --reporter=verbose scripts/slow-tests.test.ts
 Test Files  1 passed (1)
      Tests  31 passed (31)
EXIT=0

$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run --reporter=verbose scripts
 Test Files  21 passed (21)
      Tests  1058 passed (1058)
EXIT=0

$ ./node_modules/.bin/eslint <the five TS files touched>   → 0
$ ./node_modules/.bin/prettier --check <the nine files>    → 0
$ ./node_modules/.bin/tsc --noEmit -p scripts/tsconfig.json → 0
```

One test failed on its first run and caught a real error in my own evidence:
SERVER-053 cites `bulk.test.ts:177`, which is the **comment** line, while the
`it(` starts at **141**. The parser was right and the citation was wrong.

Two of the 31 exist so a constant cannot become a lie: they import
`vitest.config.ts` and assert it still sets no `testTimeout`, and check that
`apps/ui` has not grown a config that shadows it. `VITEST_DEFAULT_TIMEOUT_MS` is
5000 only while that holds.

### 7. What was rejected

- **">20% idle", this issue's own proposal.** Refuted by measurement: 33 findings
  on a green suite. Withdrawn in the acceptance criteria rather than quietly
  dropped.
- **A flat wall-clock threshold** ("no test may exceed 2500 ms"). It would flag
  `bulk.test.ts` forever, which is the file that did everything right. The
  quantity has to be a fraction of the test's **own** budget or the model answer
  is punished for being the model answer.
- **Making the check block.** Refused with a reason, not skipped: a wall-clock
  gate on a shared runner fails on contention, which is the disease. Escalated as
  gate policy.
- **A static grep or ESLint rule.** ui-dev already declined one over
  `click()`-then-`keyboard` after a sweep produced four correct sites, and the
  same objection applies to any purely textual rule here: source text cannot say
  how long a test takes. The check is built on **measurements**, which is why it
  can be precise — and the parser it needs is exactly the one the hand-rolled
  grep got wrong.
- **Fixing the third finding at 51%.** Diagnosing it is server-dev work, and
  sizing a budget without a diagnosis is the thing the new rule forbids.
- **Touching `CLAUDE.md`.** Outside the boundary I was given. Recommended instead.

### 8. Machine hygiene

Six busy-loop spinners started for the contention measurement, all killed by
recorded pid. One `apps/server` run hit a 2-minute tool timeout and was re-run in
the background; the spinners it had left were swept by pid and confirmed gone
with `ps`. No process on port 8765 was touched. Final check: no `vitest` or
spinner processes remained.

## Completion Checklist (domain agent)
- [x] Tests written and passing — 31 new in `scripts/slow-tests.test.ts`
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified — including the one that was **withdrawn** on measurement rather than met

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix

---

## Another instance, v0.20.0 harvest (2026-08-23)

Recorded here rather than filed, because this issue exists for exactly this
pattern and a fourth issue describing it would be a fourth description of one
thing.

Two whole-suite Playwright runs under load, single worker, on an unchanged tree:

- run 1 failed `query-editor`, `reflect`, `resident`
- run 2 failed `menu-room-geometry`, `table-pipes` — **a disjoint set**

All 33 tests across those five files pass in isolation. The disjointness is the
finding: it is the load, not the specs. The orchestrator's own final harvest run
of the same suite passed 609 of 609.

Two related facts from the same release, both worth having beside this:

- **SERVER-140** was this shape and turned out to be a real ordering bug in a
  test, not load — 3 of 4 runs green before, 10 of 10 after. So this pattern is
  not a safe thing to assume.
- **SERVER-146** was filed because one server test failed once in a gate and the
  orchestrator read the summary line instead of keeping the log, losing the
  name. Whatever is done here, capture to a file.

---

## A third instance, named at last (SERVER-146, 2026-08-23)

SERVER-146's bounded search caught a server test under deliberate load **with its
name**, which is what that issue existed for. Recorded here because it is this
pattern rather than a new thing, and because the diagnosis matters more than the
instance.

**The test.**
`apps/server/src/semantic/worker.test.ts` →
`startEmbedWorker — debounce behind the write path (TEST-864)` →
`embeds the final content once after a burst of saves`.

**The shape that reproduces it.** Two full `apps/server` suites running at once,
four workers each. Round 1:

```
arm a   Tests  1 failed | 4610 passed (4611)   Duration 373.40s
        × embeds the final content once after a burst of saves   446ms
          AssertionError: expected [ …(2) ] to have a length of 1 but got 2
arm b   Tests  4611 passed (4611)              Duration 373.40s
```

Same tree, same instant, one arm red and one green — so it is not the code.
373 s against a normal ~140 s is the contention, which is what separates this
from INFRA-020's own warning about tests that fail on an *uncontended* run.

**It does not reproduce more cheaply.** The file alone, ten times, with one full
suite beside it as load: **10 passed, 0 failed**. Running the file alone gives it
the whole event loop. The failure needs the test to be *inside* a saturated
suite, which is precisely why "it passed on retry" is not evidence of anything.

**Why the margin is thin.** The test makes ten saves with an `await` of 5 ms
between them, against a 60 ms debounce. Ten 5 ms gaps sit comfortably inside the
window until the event loop is contended; then one gap outgrows it, the worker
embeds an intermediate revision, and the count is 2.

**The obvious fix is worse, and was tried and reverted.** Removing the sleeps
makes the burst synchronous, and a `setTimeout` callback cannot fire inside
synchronous code — deterministic under any load. It also makes the test pass with
`debounceMs: 0`, **measured**, which is to say vacuous about the one thing it is
named for. The claim is a claim about wall-clock time, so the only honest way to
decide it is fake timers over the worker's scheduler. That belongs to this issue,
not to a P2 flake hunt passing through. The test now carries a comment saying so.

**A second observation, weaker, kept for the record.** Round 2's two arms both
failed the *same* two tests at ~6 s —
`threads/create.test.ts → mints distinct anchor ids for concurrent comments on one document`
and `docs/acts.test.ts → an ordinary save of a document body, whichever document it is to`.
Both arms were killed before they printed a summary, so those two are **not**
trustworthy evidence and are noted rather than tabled.

### A fourth instance, and the best-measured one (same search)

`apps/server/src/docs/acts.test.ts` →
`what does not close a window (§4)` →
`an ordinary save of a document body, whichever document it is to`.

It is the most expensive test in its file: **fourteen real HTTP mutations, each
with a real git commit** — two creates, five create/save pairs, two more saves.

```
alone, load average ~7:   2783ms  ✓ | 3120ms ✓ | 6110ms × (timed out at 5000ms)
alone, quieter:           3110ms  ✓
inside a full suite competing with another agent's:  ×  6023–6708ms
```

**2.8–3.1 s against vitest's 5 s default is 62% of its budget at rest** — which
is this issue's own proposed rule ("a test that needs >20% of its timeout idle
will flake under the gate") met three times over. It failed **1 in 3 running
alone**, which is why it is tabled rather than merely noted.

**Given an explicit 20 s budget, with the measurement written beside it.** Not
raised across the board — every other test in that file keeps the default — and
not a fix: the real remedy is this issue's second criterion, *make the genuine
work cheaper*. Fourteen commits to prove that six saves fold into one window is
more setup than the claim needs.

| Test | Observed | Alone |
| --- | --- | --- |
| `apps/server/src/semantic/worker.test.ts` → "embeds the final content once after a burst of saves" | assertion failure at 446 ms inside a doubly-saturated suite | 10/10 pass |
| `apps/server/src/docs/acts.test.ts` → "an ordinary save of a document body, whichever document it is to" | timed out at 5000 ms, 1 in 3 | **2.8–3.1 s of a 5 s budget** |

### And the disjoint-set signature again, on `apps/server` this time

Three full `apps/server` runs on the same tree while other agents ran their own
suites, after the two fixes above:

```
run A  2 failed | 4609 passed   Duration 474s   update.test.ts, key.test.ts
run B  5 failed | 4606 passed   Duration 452s   acknowledgment.test.ts ×2, resident.test.ts, acts.test.ts ×2
run C  0 failed | 4611 passed   Duration 373s
```

Every failure is a **5.1–7.0 s timeout**, never an assertion, and the sets are
**disjoint between runs** — the same signature the Playwright note above records.
All of them pass in isolation: `update.test.ts` + `key.test.ts` → 83 of 83 at
load average 12.

A normal `apps/server` run on this machine is ~140 s. At 450–475 s the suite is
not measuring the code.

## A third instance, v0.21.0 (2026-08-24)

`apps/cli/src/commands/workspace/maintenance.test.ts > stops git repacking the
repository behind us across a run of commits` — **timed out at 5000ms** in a
full `apps/cli` run while a ui-dev agent worked, and passed **3 of 3** in
isolation immediately afterwards.

It is the same shape SERVER-146 diagnosed hours earlier in `apps/server`: a
git-heavy test on a fixed millisecond budget, where the budget was chosen when
the machine was quiet. SERVER-146's own fix is the precedent worth copying —
**measure what the test costs at rest, then size the budget to the
measurement**, rather than raising budgets across the board.

Routed to cli-dev with that instruction. Recorded here because this issue exists
for the pattern, and because the pattern now has instances in two workspaces
found on the same day.

## A fourth instance, and an unnamed one (2026-08-24)

`vitest run scripts` reported `1 failed | 990 passed` on the **first** of four
runs during AGENT-052, and **scrolled without naming the test**. Three runs since
are green, the template file alone is green five times, and the orchestrator ran
it twice more afterwards at 991 passed, exit 0.

**The name is lost, again.** That is the second time in two releases — SERVER-146
was filed for exactly this and closed with its own search recorded. The agent
recorded it rather than dismissing it as a retry-pass, which is the right
instinct and the reason it is here.

The standing instruction stands and is evidently not enough on its own: **capture
every run to a file**. A summary line that scrolls is a summary line that cannot
be read twice. Where a suite is being run repeatedly to chase a flake,
`--reporter=verbose` into a file is the only form that survives.

## What was actually inflating every measurement (2026-08-24)

**Five orphaned vitest workers, ppid 1, running two hours ten minutes each** —
pids 33081, 33219, 39589, 42251, 57590 — holding roughly 15% CPU and 400 MB
apiece. Their parents were long gone, so they reported to nobody and no agent's
own cleanup could reach them.

They were found by an agent that recorded them and **declined to kill them**,
because it only sweeps pids it recorded itself. That is the right rule for an
agent and the wrong outcome for the machine, so the orchestrator killed them
after confirming each was `node (vitest N)` with ppid 1 and that neither of the
user's server pids was among them.

**This is very likely a contributing cause of this issue's own instances.** Every
timing taken today — the CLI's 5 s git budget, the server's disjoint timeout
sets, this file's own entry-point measurements — was taken with most of a core
and 2 GB missing. Those readings are conservative, which is the right direction
for a budget to be wrong in, but the flakes attributed to "other agents' load"
were partly attributable to load nobody was running.

**The orchestrator's sweep missed them, twice.** `ps | grep -Ei 'vitest|…'`
returned nothing on two attempts earlier in the session, because the shell proxy
had filtered the output down to the lines matching the port query. The lesson is
not "sweep more often" — it is that **a sweep returning nothing must be verified
rather than believed**, by naming pids directly or by disabling the proxy.

## A fifth instance — and this one has its name (2026-08-24, v0.21.0 harvest)

`apps/ui/e2e/changelog.spec.ts:243 — a conversation anchored inside a clipped
entry > expands the clip when the conversation is revealed`, failing
`expect(locator).toBeInViewport()`.

- Full Playwright run 1: **1 failed, 617 passed**
- The same spec file alone: **7 passed**
- Full Playwright run 2, unchanged tree: **618 passed, exit 0**

**Recorded because the name was captured, which is the improvement.** The two
earlier instances in this release lost their names to a scrolled summary line.
This one was found by grepping the captured log backwards from the assertion
text to the test id — worth writing down as the technique, since a Playwright
failure prints its title far above its error.

It was checked as a possible regression before being called load. UI-165 changed
when a column earns a thread margin, and a viewport assertion on a revealed
conversation is exactly what that could disturb — so it was run in isolation and
then in a second full suite before the release moved on. Neither reproduced it.

## Three UI instances closed, and what generalises (2026-08-24, ui-dev, v0.22.0)

**Not closing this issue.** UI-080, UI-033 and UI-046 were the three UI issues
this file's *"make it deterministic — wait on the condition, not on a duration"*
rule pointed at. All three are done. What they establish is a sharper form of the
criterion at the foot of the summary, and the sharpening is the part worth
keeping.

**None of the three was a load flake, and two of them were product defects.**

- **UI-033** — a test that failed on an idle machine, every run, once the width
  transition it raced was waited out. The cause was an **event order** in the
  product: Chromium dispatches a movement's boundary events before its
  `mousemove`, and the board activated on `mouseover` while releasing a keyboard
  latch on `mousemove` — so the first movement's activation was dropped by the
  latch that same movement released. The spec had been stabilised earlier with an
  honest two-move gesture, which is exactly the shape of a fix written **around**
  a defect rather than over it. The rule that catches this: *a stabilisation that
  changes the gesture rather than the wait is a bug report.*
- **UI-046** — dev-only, and it never failed at all, because nothing asserted the
  thing that was dropped. `comments-tab.spec.ts` said "expanded and flashing" in
  its own comment and asserted only the expansion. A green suite was proving half
  of what its author believed. The rule: *a claim in a test's prose that the test
  does not assert is an untested claim, and the prose is where to look for them.*
- **UI-080** — genuinely test-side, and the one that fits this file's original
  description. But its sites did **not** fail under load; they failed silently and
  passed. An unfocused `Ctrl/Cmd+A` selects the page rather than the editor body,
  and the copy that follows carries the page's chrome onto the clipboard while the
  assertion — "both flavours are present" — stays true. Forcing the condition (a
  `blur()` between the click and the key) reproduced it byte for byte on an idle
  machine.

**The generalisation for this issue's criterion.** *A test that fails without
contention is not load-sensitive* was the tell recorded here after SERVER-060.
The three above add its neighbour: **a test that has never failed is not evidence
either.** Two of these three defects were invisible to the suite — one because
the assertion was too loose to notice a wrong result, one because the assertion
was missing. Where a wait is being considered, the cheap discriminator is to
**force the condition the wait would hide** — blur the surface, park the pointer,
render under `StrictMode` — and see what the suite says. If it still passes, the
suite is not watching, and adding the wait would make that permanent.

**A grep-check or ESLint rule over `click()`-then-`keyboard` was considered and
declined**, and the reason belongs here rather than in UI-080. That sweep produced
**four** sites that are correct as they stand — three document-level hotkeys where
no element needs focus, one right-click whose key is aimed at a menu — each
carrying prose that a rule cannot read. A rule suppressed at a quarter of its hits
teaches people to suppress it. If infra-dev wants the guard, the honest shape is a
check that requires *any* awaited assertion between the click and the key, not
`toBeFocused()` specifically, so a justified site satisfies it by carrying the
condition it actually needs.

**Load measurement taken while closing them**, on the machine this file keeps
notes about: `clipboard`, `autocomplete-keys`, `turn-breaks` and `context-menu` at
`--workers=4 --repeat-each=10` — **500 passed in 5.1 min**, zero flaky. Full
Playwright suite at `--workers=2`: **640 passed**, twice, on two different trees.
