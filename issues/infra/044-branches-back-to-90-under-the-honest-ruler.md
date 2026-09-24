# [INFRA-044] Branches back to 90, under the honest ruler

## Domain

infra

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: INFRA-043 (the instrument change that re-baselined it)

## Spec References

- None. Gate policy.

## Summary

Vitest 4's AST-aware remapping enumerates branches in never-entered code,
which Vitest 3 scored as fully covered — the same tree reads 93.07% on the
old instrument and 89.64% on the new. INFRA-043 re-baselined the branches
threshold to 89.5 rather than write tests mid-security-fix. This issue is
the climb back: close ~72 branches and restore the 90.

The measured biggest chunk: `packages/contract/src/release.ts` — 11
functions, no test, 0 of 66 branches (Vitest 3 called that 100%). Covering
it alone reaches 89.97%.

## Acceptance Criteria

- [x] `packages/contract/src/release.ts` gains real tests
- [x] The merged gate passes at branches >= 90 and the threshold in
      `scripts/coverage-config.ts` returns to 90 in the same commit
- [x] Any remaining sub-90 gap is closed by tests, never by globs

## E2E Verification Log

**Model: opus.** Two sessions, both contract-dev on opus. The first
(`claude-opus-5[1m]`, worktree `agent-ab4b1652334e51e42`) wrote the tests and
was stopped before any merged run. The second (`claude-opus-5-5[1m]`, worktree
`agent-a017af6d981c42666`, base `242fae48`) applied that work as a patch,
reviewed it, corrected two things (below), and ran the full gate.

### Review of the first session's work

- **Kept:** every test. Each one asserts a behaviour the source documents —
  a refusal, an accepted shape, or an edge — and the controls
  (`reads the same body as an answer when every block fits`) prove the
  refusals are about the thing named.
- **Corrected:** the `code.test.ts` quoted-fence test claimed its divergence
  "errs toward keeping the fence open". The module docblock names that exact
  input as a **miss** (CommonMark opens a fresh fence; this scanner reports
  nothing). The comment now says so, and the test also pins the half of the
  claim that makes the miss honest: `fencedCodeRanges` agrees with
  `unterminatedFence` (one closed range over all three lines).
- **Corrected:** `scripts/coverage-gate.test.ts`'s shortfall fixture went back
  to the pre-INFRA-043 numbers (`branches: 89.99`, threshold `90`) instead of
  keeping the re-baseline's `89.4` with a new comment. `89.99` is the sharper
  fixture: it fails by the smallest margin the gate can see.
- **Shortened:** the `coverage-config.ts` comment is a five-line history note,
  not the ruling's full argument (which stays in INFRA-043).

### What was measured, and how

Per-file istanbul JSON, the method INFRA-043 used: run vitest with
`--coverage.include` narrowed to the file under test, read
`coverage-final.json`'s `branchMap` + `b` counters, and print the source
line of every branch location whose counter is `0`. That distinguishes the
two things a percentage cannot — a branch no test reaches from a branch
**no input can reach** — and only the first is worth writing a test for.

### `packages/contract/src/release.ts`: 0/66 → 64/66

`src/release.test.ts` is new: 49 tests, no network. The two branches left
are unreachable by construction, not unwritten tests:

- L260 `leftPre === rightPre ? 0 : …` — the equal case returns three lines
  earlier, so the `0` arm is dead.
- L328 `selection.kind === "missing" ? selection.detail : ""` — the detail
  is only computed when `verifiable` is false, which is exactly
  `kind === "missing"`, so the `""` arm is dead.

What the tests pin is the release procedure's two judgments, from the
source side rather than through the CLI's re-export:

- **What it refuses.** A version pair it cannot order (`undefined`, never a
  silent `0` — the caller must claim neither an upgrade nor currency); a
  tarball with no `.sha256` beside it (INFRA-016's asset, SPEC.md §2.4's
  "published checksum"); two tarballs, refused rather than guessed at
  because the package name is still provisional; a payload that is not a
  release; a body that is not JSON; a 403 that is the rate limit and a 403
  that is not; a 502 with no status text, which must not leave a trailing
  space in the detail.
- **What it accepts.** One tarball with its checksum, a strictly newer
  version, `upgradeAvailable` and `verifiable` reported **separately** —
  including the pair §2.4 turns on, a real newer release that
  `corpus upgrade` will still decline, where `assets` comes back `null` so
  no caller can offer an action the upgrade refuses.
- **What it reports rather than throws.** Offline, a timeout (said as
  "timed out", not as the abort's own wording), a rejection that is not an
  `Error` at all, and 404 read as "this distribution has published no
  releases yet" — reachable, with no latest.

### The other 28 branches, in eight files

`release.ts` alone reaches 89.97% and is 6 short (INFRA-043's own
arithmetic), so the next-biggest honest gaps in `packages/contract` were
closed the same way. Package total: **732/780 → 760/780 branches**, and
668/780 before any of this issue's tests. Every one is a refusal path or an
edge the module documents:

| file | + | what the test pins |
| --- | --- | --- |
| `schemas/form-answer.ts` | 10 | a block that does not fit its field is `undefined`, the same answer as "not this form's answer"; a `choose any` selection compared option by option on the round trip; the offending line named even when the fields before it hold no text |
| `client/upload.ts` | 4 | a stated weight rides on turn, thread and capture bodies, and only when stated (§7: absence means the orchestrator decides); the host's own `fetch` when the caller names none |
| `styled.ts` | 4 | an alignment outside the set; an unterminated `==` or `]{` left as the characters it is; a closing `:::` that opened nothing |
| `schemas/query.ts` | 3 | `splitExtraParams` keeps the flat parameters, lifts the dotted ones, drops a valueless one, and says `undefined` rather than `{}` |
| `code.ts` | 2 | CommonMark's five-space rule (a fence five spaces past a list marker is indented code); a quoted fence not closed by a line that dropped the quote marker |
| `schemas/agents.ts` | 2 | `lane.waiting` carries the lane and nothing answerable, and its parser declines a malformed payload without throwing |
| `schemas/extra.ts` | 1 | an object counts toward the same depth bound as an array |
| `schemas/form.ts` | 1 | an unparsed answer entry giving nothing, or two things, gets the message rather than a crash |

The 20 that remain in the package are `?? ""` / `?? 0` arms that exist for
`noUncheckedIndexedAccess` and cannot be reached with any input (a regex
group that always matches, a `sections` array that is never empty), plus
the two in `release.ts` above. Writing a test for one would mean changing
the source to make it reachable, which is not what this issue asked for.

### The arithmetic

INFRA-043 measured the merged gate at **17523/19549 = 89.64%**, needing
**17595** for 90% — a shortfall of 72 branches — and measured that covering
`release.ts` outright yields 17589. So `release.ts`'s share of the merged
baseline is 0 of 66: the browser half executes its module scope and none of
its branch locations.

- release.ts: +64 → 17587/19549 = **89.96%**, 8 short.
- The other eight files: +28 unit-side. The merged number gains one for
  each of those the browser half did not already credit. Eight is the bar.

Those 28 are refusal paths: a nine-deep `extra` object, a malformed
`lane.waiting` payload, an unparsed form entry, a list fence five spaces
past its marker. No e2e fixture produces any of them, and four of the eight
files have no browser caller at all (`splitExtraParams`,
`parseLaneWaitingPayload`, `validateFormAnswer` and the three `build*
FormData` helpers are unreferenced under `apps/ui` and `packages/kit`,
which reach the same behaviour only through `uploadTurn`).

### Runs

All in worktree `agent-a017af6d981c42666` after `npm install` + `npm run build`
(both exit 0).

- `vitest run packages/contract scripts/coverage-gate.test.ts`
  (`VITEST_MAX_WORKERS=4`): 77 files, 3370 tests, exit 0.
- `vitest run packages/contract/src/code.test.ts` after the correction:
  78 tests, exit 0.
- `CORPUS_UI_PORT=5273 VITEST_MAX_WORKERS=4 npm run coverage` (the full gate —
  the worktree had no raw e2e dumps, so `coverage:merge` alone could not
  measure): **exit 0**.
  - unit: 704 files, 17376 tests passed.
  - e2e: 781 passed (9.4 min).
  - merged: `ALL | 97.09% lines | 95.77% statements | 95.33% functions |
    90.13% 17629/19560 branches` —
    `coverage: merged gate passed — all four metrics at or above 90%.`
  - `packages/contract`: 761/780 branches (97.56%).

Arithmetic at the measured denominator: 90% of 19560 is 17604, so the gate
clears by **25 branches**. The denominator grew by 11 since INFRA-043's 19549
(commits landed since), which is why the numbers do not add exactly onto
INFRA-043's baseline.

### Not done here, and why

- **`apps/cli/src/commands/upgrade/release.test.ts` was left alone.** It
  now overlaps the new file, and that is deliberate twice over: it is
  another domain's file, and CONTRACT-090 kept it unedited on purpose as
  the evidence that moving the lookup changed no behaviour. It still proves
  the re-export resolves.
- **No glob moved.** `COVERAGE_INCLUDE` and `COVERAGE_EXCLUDE` are
  byte-identical to INFRA-043's.
