# [INFRA-017] The coverage merge OOMs: every browser dump is parsed into memory at once

## Domain
infra

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: —
- Blocks: PR #19 (dogfood-todos-polish) — `CI / validate` cannot go green

## Spec References
- INFRA-004 (the combined coverage gate), INFRA-009 (empty-scope guard)

## Summary
`CI / validate` on PR #19 failed at the **merged coverage gate** with
`FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of
memory`, exit code 134. No test failed: the unit suite passed, Playwright
reported **236 passed, 1 flaky** (`smoke.spec.ts:223 › theme › focus rings`),
and the process died in the step after — `npm run coverage:merge`.

Run: https://github.com/trupin/corpus/actions/runs/30785254409 (head `323cb8d`).
Main's last run (`41a85cc`, 2026-08-02) passed the same step, so this branch
pushed a pre-existing margin over the edge rather than introducing a new defect.

**Root cause (measured, not inferred).** `apps/ui/e2e` writes one V8 dump per
spec; locally `coverage-raw/browser-v8/` holds **239 files totalling 2.2 GB**,
about 9 MB each — each dump carries the full script text of a 1.35 MB bundle
alongside its source-map payload. `readBrowserEntries`
(`scripts/merge-coverage.ts:48-63`) `JSON.parse`s **every one of them into a
single array** and returns it, so peak heap holds the whole 2.2 GB corpus as
live JS objects *before* `executedLines` adds the first entry to monocart. The
OOM stack bottoms out in `node::worker::Message::Deserialize` — monocart's
source-map workers posting results back while that array is still retained.

The dumps are consumed strictly one at a time (`for (const dump of browser)` →
`await report.add(...)`, `merge-coverage.ts:90-95`); nothing after the loop
needs the raw entries. The eager materialisation buys nothing.

## Acceptance Criteria
- [x] `npm run coverage:merge` completes on the existing 2.2 GB
      `coverage-raw/browser-v8/` without raising the heap limit, and peak RSS is
      reported in the issue log (before and after)
- [x] Dumps are read and released one at a time; the malformed-dump error
      (`"is not a coverage dump this version writes"`) still fires per file, with
      the offending filename, and still fails the run
- [x] The "no browser coverage" early exit still fires when the directory is
      empty or holds no `.json` — it must not become "zero dumps merged silently"
- [x] Deterministic order preserved (the current `.sort()` on filenames)
- [x] The gate's numbers are unchanged: merged totals for all four metrics match
      the pre-change run on the same input, to the same precision
- [x] Headroom for growth on top of the streaming fix (an explicit
      `--max-old-space-size`, a shrunk per-dump payload, or both) — state which
      and why; the suite will keep growing
- [x] `scripts/coverage-gate.test.ts` extended to cover the streaming path

## Technical Design
### Files to Create/Modify
- `scripts/merge-coverage.ts` — stream `readBrowserEntries`; hand monocart one
  dump at a time and let each be collected before the next is parsed
- `package.json` — `coverage:merge` heap headroom if warranted
- `scripts/coverage-gate.test.ts` — coverage for the new path

### Notes
- Consider whether the e2e collector needs to write 9 MB per spec at all:
  monocart resolves sources from `baseDir` (`merge-coverage.ts:76-77`), so
  inlined script text and source maps may be redundant. If trimming the dumps is
  the better lever, say so — but do not make it the *only* fix, since the eager
  parse is a defect independent of payload size.
- Do not weaken the gate to make it pass. The 90% bar, the empty-scope guard and
  the out-of-scope warning all stay exactly as they are.

## Testing Strategy
Reproduce against the real 2.2 GB `coverage-raw/` already on disk (it is this
branch's own e2e output). Record the pre-fix OOM and the post-fix peak RSS
(`/usr/bin/time -l` on darwin). Compare the merged summary JSON before and after
to prove the numbers did not move.

## E2E Verification Log

**Model:** opus (`claude-opus-5[1m]`), infra-dev agent, 2026-08-03.

### Test input
The reproduction ran against the branch's own `coverage-raw/browser-v8/` —
**237 dumps, 2.2 GB**, untouched and not regenerated. The unit half of the merge
was missing from this worktree (`coverage/` did not exist), so it was produced
with a **scoped** run, not the repo-wide suite (the orchestrator owns that gate):

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/coverage-gate.test.ts \
    --coverage --coverage.reporter=json
$ shasum -a 256 coverage/coverage-final.json
56e4f463cf4d904041f2458d7ae511872e3fe1bbbab6dc4ae362ae98327002c8
```

Vitest's `coverage.all` still walks `COVERAGE_INCLUDE`, so this is the real
574-file universe with real statement maps — only the hit counts are low. Both
runs below consumed that byte-identical file, so the merged output is comparable;
the 90% thresholds fail in both for that reason and that reason alone.

### Diagnosis confirmed
Dump anatomy, measured over three dumps spread across the directory:

```
$ node -e '<count entries and source bytes per dump>'
dumps: 237
003bd470… bytes: 10327610  entries: 363  dropped: 53  droppedSrcMB: 4.2  keptSrcMB: 4.3
85e72eb8… bytes: 10243063  entries: 363  dropped: 53  droppedSrcMB: 4.2  keptSrcMB: 4.3
fea2ab39… bytes: 10005507  entries: 363  dropped: 53  droppedSrcMB: 4.2  keptSrcMB: 4.3
```

~10 MB and 363 entries per dump, of which **53 entries carrying 4.2 MB — half the
payload — are Vite client/HMR/prebundled-dep code the reporter's `entryFilter`
discards anyway**. `readBrowserEntries` parsed all 237 into one array before
`executedLines` added the first, so the whole corpus was live for the length of
the merge.

### Before (`readBrowserEntries`, eager)
```
$ /usr/bin/time -l node --import tsx scripts/merge-coverage.ts
       24.71 real        28.81 user         6.19 sys
          4038115328  maximum resident set size      <-- 4.04 GB
          4706129664  peak memory footprint
EXIT=1   (thresholds only; the merge itself completed)
```
4.04 GB of RSS against a V8 old space that a 16 GB GitHub runner sizes at ~4 GB
is the OOM: locally there is headroom, in CI there is not.

### After (`readBrowserDumps`, streaming) — same flags, same input
```
$ /usr/bin/time -l node --import tsx scripts/merge-coverage.ts
       16.87 real        16.31 user         2.00 sys
          1235435520  maximum resident set size      <-- 1.24 GB
          1232731392  peak memory footprint
EXIT=1   (thresholds only)
```
**Peak RSS 4.04 GB → 1.24 GB (−69%); wall clock 24.71 s → 16.87 s (−32%).**

Both runs used the plain `node --import tsx` invocation, i.e. V8's default heap,
so this pair isolates the streaming fix from the `--max-old-space-size` headroom
added on top of it. 1.24 GB against the ~4 GB old space a 16 GB CI runner
defaults to is a 3.3× margin where there was none.

### The numbers did not move
All three merged artifacts are byte-identical, as is the whole gate report on
stdout:

```
$ diff before.coverage-summary.json coverage/merged/coverage-summary.json  ->  identical
$ diff before.e2e-attribution.json  coverage/merged/e2e-attribution.json   ->  identical
$ diff before.stdout.log            after.stdout.log                       ->  identical

$ shasum -a 256 coverage/merged/*.json         # after == before, all three
6b8d6cba…  coverage/merged/coverage-final.json
a3560a2b…  coverage/merged/coverage-summary.json
bddebe82…  coverage/merged/e2e-attribution.json
```
Same 237 dumps merged, same 278 in-scope files attributed, same per-file gains,
same `ALL` row, and no `WARNING:` out-of-scope block in either run.

### A concurrent e2e run destroyed the input, and found a real gap
The first attempt to run the *shipped* command (`npm run coverage:merge`, with
the 8 GB flag) died 9 s in:

```
Error: ENOENT: no such file or directory, open
  '.../coverage-raw/browser-v8/970f9f4b-….json'
    at readBrowserDumps (scripts/coverage-gate.ts:231:29)
```

Not a defect in the merge: another agent started `npm run e2e`, whose global
setup empties `coverage-raw/browser-v8`, while the merge was running. But it is a
window this change *widens* — the names are listed once and the reads now span
the whole merge instead of its first two seconds — and it surfaced as a raw `fs`
stack. `readBrowserDumps` now reports it as what it is, with the file named and
the original kept as `cause`:

```
Error: .../coverage-raw/browser-v8/<name>.json was listed for this merge but
could not be read. A concurrent `npm run e2e` empties this directory in its
global setup — re-run the merge once it has finished.
```

That run's merged output was stale (left over from the previous run), so its
numbers are discarded and do not appear above. The 2.2 GB corpus was gone by
then, so the shipped command was re-verified on what the concurrent run had
written so far — 26 dumps — purely to prove the flag does not break it:

```
$ /usr/bin/time -l npm run coverage:merge
> node --max-old-space-size=8192 --import tsx scripts/merge-coverage.ts
  inputs: 575 files …, 26 browser dumps …, 0 NODE_V8_COVERAGE dumps …
  e2e attributed coverage to 279 in-scope source files
ALL  |  24.44% 10248/41924 | … |  69.57% 400/575 | 69.57% 400/575
ERROR: coverage for lines (24.44%…) does not meet threshold (90%) …
        2.57 real   776650752  maximum resident set size
EXIT=1
```
Full report, four thresholds enforced, non-zero exit. The RSS figures that matter
are the matched pair above, not this one.

### Guard rails re-exercised against the real script
```
$ # directory emptied / removed / holding only notes.txt
coverage: no browser coverage in coverage-raw/browser-v8.
coverage: run `npm run e2e` first, or use `npm run coverage`.
EXIT=1                                     (all three cases)

$ echo '{"entries":[]}' > coverage-raw/browser-v8/000-malformed.json
$ node --import tsx scripts/merge-coverage.ts
Error: /Users/…/coverage-raw/browser-v8/000-malformed.json is not a coverage dump
this version writes. Re-run `npm run e2e` — its global setup clears the directory.
```
The dumps directory was restored to its exact prior state after each (237 files,
2.2 GB). The error now names the full path rather than
`coverage-raw/browser-v8/<name>` — the reader takes the directory it is given, so
the message names the file to delete unambiguously.

### Headroom: streaming **and** `--max-old-space-size=8192`
Three levers were available; two were taken.

1. **Streaming (the defect).** The eager parse is a bug independent of payload
   size and is where the 2.8 GB came from.
2. **Halving the per-dump payload handed downstream.** `isRepoSourceEntry` — the
   predicate that was already the reporter's `entryFilter` — is now applied
   *before* the rewritten copy of a dump's entries is built, so the 4.2 MB of
   Vite internals in each dump never gets a second copy. Identical predicate in
   both places, so it cannot move a number, and the byte-identical output proves
   it did not.
3. **Explicit 8 GB heap cap on `coverage:merge`.** Kept on top of the fix, not
   instead of it: V8 derives its default old space from host RAM (~4 GB on the CI
   runner), which is precisely the ceiling that was hit, and the corpus grows
   with every spec added. A cap is not a reservation, so it costs nothing when
   unused; the trade-off is that a host with under ~8 GB free would now be killed
   by the OS rather than by a legible V8 heap error. A regression test pins the
   flag, since it is invisible from the script itself.

**Not taken: shrinking what the collector writes.** `apps/ui/e2e/coverage.ts`
could apply the same filter at `stopJSCoverage` time and cut the 2.2 GB on disk
roughly in half. It is the right follow-up, but it belongs to a separate issue:
verifying it requires regenerating the dumps (a full e2e run), which would have
destroyed the reproduction input this issue is measured against.

### Gates
```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/
 ✓ 9 files, 298 tests passed
 ✓ scripts/coverage-gate.test.ts (48 tests)     [40 before, +8]
$ ./node_modules/.bin/tsc --noEmit -p scripts/tsconfig.json          -> clean
$ npx eslint scripts/{coverage-gate.ts,coverage-gate.test.ts,merge-coverage.ts} --max-warnings 0
ESLint: No issues found
$ npx prettier --check <the same three files + package.json>
All matched files use Prettier code style!
```

### Noted, not fixed (separate issue)
`apps/ui/e2e/smoke.spec.ts:223 › theme › focus rings match the prototype` fires
three blind `page.keyboard.press("Tab")` immediately after `page.goto("/")`, with
no wait for the app to be interactive first — every other assertion in the spec
waits, this one races React's first render. Under load the tab stops are not all
mounted yet, so the third Tab lands somewhere other than `.btn-compose`. One
`await expect(compose).toBeVisible()` before the presses is the likely fix.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
