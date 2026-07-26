# [SERVER-002] Anchor engine: text-quote resolution + reconciliation

## Domain

server

## Status

in_progress

## Priority

P0

## Model

fable — subtle diff-range mapping algorithm; correctness judgment beyond a rubric.

## Dependencies

- Depends on: SHARED-001
- Blocks: SERVER-005

## Spec References

- SPEC.md §6 — "Threads and anchors" (text-quote selectors, resolution ladder, automatic reconciliation)
- SPEC.md §15 — M1 check (the anchor reconciliation test matrix)
- CLAUDE.md — Architecture Decision 2 (reconciliation is a guarantee of the server's write path, not of `cli/lib/anchors.mjs`)

## Summary

Implement the anchor engine as pure functions in `apps/server/src/anchors/` — no filesystem, no git, no database, no HTTP. Two capabilities: **resolution** (given a body and a W3C-style text-quote selector `{exact, prefix, suffix}`, find its character range or declare it orphaned, via the four-step ladder in §6) and **reconciliation** (given `oldBody`, `newBody`, and a document's anchors map, map every anchor's range through a character diff and produce refreshed selectors plus a report of what was remapped and what was orphaned). This is the mechanism that makes "threads stay attached through edits" a property of the system rather than a discipline. SERVER-005 calls `reconcileAnchors` on every document save; SERVER-004 calls `resolveAnchor` to compute `anchors.resolved_offset`.

## Acceptance Criteria

- [ ] `resolveAnchor(body, selector)` implements §6's ladder in order: (1) exact match of `prefix + exact + suffix`; (2) `exact` alone when it occurs exactly once; (3) fuzzy highest-similarity window above a threshold; (4) otherwise unresolved → orphaned.
- [ ] `resolveAnchors(body, anchorsMap)` resolves a whole document's anchors in one pass and returns a map of `anchorId → { start, end } | null`.
- [ ] `reconcileAnchors(oldBody, newBody, anchors)` returns `{ anchors, report }` where `report` is `{ unchanged: string[], remapped: string[], orphaned: string[] }`.
- [ ] Range untouched by the edit → `exact` preserved, `prefix`/`suffix` recomputed from the new surroundings.
- [ ] Range partially edited → the new text spanned by the mapped range becomes the new `exact`, context recomputed.
- [ ] Range entirely deleted → the selector is left exactly as it was (history value, §6) and the anchor is reported orphaned.
- [ ] Context windows are ~32 characters on each side, clipped at body boundaries and never splitting a surrogate pair.
- [ ] The module is pure: no imports of `node:fs`, `node:child_process`, `better-sqlite3`, or anything in `apps/server/src/{core,projection,docs}` beyond types.
- [ ] Unit tests cover the full §15 M1 matrix — edits **before** and **after** an anchored range keep it resolved with the same `exact`; edits **inside** the range update `exact`; **deleting** the range orphans the thread; changes to surrounding context **refresh** `prefix`/`suffix` — plus unicode, repeated identical text, and adjacent/overlapping anchors.

## Technical Design

### Files to Create/Modify

- `apps/server/src/anchors/types.ts` — `TextQuoteSelector`, `AnchorsMap`, `Range`, `ReconcileReport`
- `apps/server/src/anchors/resolve.ts` — `resolveAnchor`, `resolveAnchors`, the ladder and its thresholds
- `apps/server/src/anchors/fuzzy.ts` — bounded fuzzy search (bitap seed + full-window similarity verification)
- `apps/server/src/anchors/diff.ts` — diff computation and the old→new offset mapping
- `apps/server/src/anchors/context.ts` — `computeContext(body, start, end)` → `{ prefix, suffix }`
- `apps/server/src/anchors/reconcile.ts` — `reconcileAnchors`
- `apps/server/src/anchors/index.ts` — public surface
- `apps/server/src/anchors/*.test.ts` — colocated Vitest suites (including the M1 matrix as a table-driven suite)
- `apps/server/package.json` — add `diff-match-patch` and `@types/diff-match-patch`

### Key Implementation Details

**Types.**

```ts
type TextQuoteSelector = { exact: string; prefix?: string; suffix?: string };
type AnchorsMap = Record<string, TextQuoteSelector>; // keyed by anc_* id
type Range = { start: number; end: number }; // UTF-16 code-unit offsets, [start, end)
```

All offsets are UTF-16 code-unit offsets into the body string (what `String.prototype.slice` uses). Every offset a function returns must fall on a code-point boundary.

**Resolution ladder (`resolveAnchor`).**

1. **Contextual exact.** Build `needle = (prefix ?? "") + exact + (suffix ?? "")`, search with `indexOf`. If found, the range is `[idx + prefix.length, idx + prefix.length + exact.length)`. If the needle occurs more than once, take the **first** occurrence (deterministic; ambiguity at this level is already vanishingly rare because the context is included).
2. **Bare exact, unique.** If `exact` occurs exactly once in the body, that is the range. If it occurs more than once, do not guess here — fall through to step 3, which uses context to disambiguate.
3. **Fuzzy.** Produce candidate offsets and score them:
   - Seed with `diff-match-patch`'s bitap `match_main(body, exact.slice(0, 32), hint)` where `hint` is the caller-supplied previous offset when available (reconciliation supplies it), else 0. Bitap is capped at a 32-bit pattern, hence the seed slice.
   - Around each seed (and, when the seed fails, around every occurrence of the longest common shingle of `exact`), evaluate the window `body.slice(o, o + exact.length)` with a normalized similarity score `1 - levenshtein(window, exact) / max(len)`.
   - Accept the highest-scoring window with score ≥ `FUZZY_THRESHOLD = 0.75`. Break ties by (a) better `prefix`/`suffix` agreement with the window's actual surroundings, then (b) proximity to `hint`, then (c) earliest offset — in that order, so the result is deterministic.
   - Cap the work: at most `MAX_FUZZY_CANDIDATES = 64` windows scored, and skip fuzzy entirely when `exact.length > 4096` (fall through to orphaned) so a pathological document can't stall a request.
4. **Orphaned.** Return `null`.

Thresholds and window sizes are exported constants so tests reference them rather than duplicating magic numbers.

**Diff and offset mapping (`diff.ts`).** Use `diff-match-patch`'s `diff_main(oldBody, newBody)` followed by `diff_cleanupSemantic` (it merges character-level noise into human-meaningful edits, which is what "was this range touched?" should mean). Walk the diff list once and build a mapper:

```ts
type OffsetMapper = {
  map(oldOffset: number): number; // old → new; offsets inside a deleted run map to the deletion's start in new
  classify(range: Range): "equal" | "partial" | "deleted";
};
```

The walk maintains `(oldPos, newPos)`: `EQUAL` advances both, `DELETE` advances `oldPos` only, `INSERT` advances `newPos` only. `classify` inspects every diff op overlapping `[start, end)`: entirely inside `EQUAL` runs ⇒ `equal`; no surviving `EQUAL` character within the range ⇒ `deleted`; otherwise ⇒ `partial`.

**`reconcileAnchors(oldBody, newBody, anchors)`.** For each anchor id, in a stable iteration order (sorted by id, so the report and the emitted map are deterministic):

1. Resolve the selector against `oldBody` (its ranges are known-good there, §6). If it does **not** resolve in `oldBody`, the anchor was already orphaned before this edit: leave the selector untouched, report it under `orphaned`, and move on — never "re-attach" an already-detached anchor by fuzzy-matching the new body.
2. Map the resolved range through the diff and classify it.
3. `equal` ⇒ keep `exact`; recompute `prefix`/`suffix` from `newBody` around the mapped range. Report under `unchanged` if the recomputed context is identical to the old one, otherwise under `remapped` (a context refresh is a real selector change and callers surface it).
4. `partial` ⇒ `exact = newBody.slice(newStart, newEnd)`; recompute context; report `remapped`. If the resulting `exact` is empty or whitespace-only, treat it as `deleted` instead (a range edited down to nothing is not a usable selector).
5. `deleted` ⇒ keep the last selector verbatim; report `orphaned`.

Return a **new** anchors map — never mutate the input — plus the report. The function performs no I/O and knows nothing about threads, files, or git; SERVER-005 owns writing the map into the parent's frontmatter in the same save and the same auto-commit.

**Context computation.** `CONTEXT_WINDOW = 32` code units before `start` and after `end`, clipped at body bounds, expanded by one unit when the cut would land between a surrogate pair. Context is taken verbatim from the body (no whitespace normalization) so that the step-1 contextual-exact lookup is a plain `indexOf` of concatenated substrings.

**Determinism.** Given identical inputs the engine must produce identical output — no `Date`, no randomness, no `Map` iteration over insertion order that depends on caller behavior. This matters because reconciliation output is committed to git.

### Edge Cases

- Empty `oldBody` or `newBody` (document emptied or created from empty) — every anchor orphans cleanly, no throw.
- Whole body replaced with unrelated text — all anchors orphan; fuzzy must not "find" spurious matches (the threshold plus the deleted-classification guard is what prevents this; test it explicitly).
- Repeated identical text (the same sentence twice) — context must disambiguate; a selector with no context that matches twice falls to fuzzy with a `hint`.
- Adjacent anchors sharing a boundary, and nested/overlapping anchors — each is reconciled independently; overlapping ranges must not corrupt each other's contexts.
- Anchor at the very start or very end of the body — `prefix`/`suffix` come back short or empty, and empty context must not be confused with absent context.
- Unicode: astral-plane characters, combining marks, and RTL text inside `exact`/context; ranges must never split a surrogate pair.
- Very large bodies (a 1 MB document) — one `diff_main` pass plus bounded fuzzy work; add a smoke test asserting reconciliation of 50 anchors over a 1 MB body completes in well under a second.
- CRLF vs. LF bodies: offsets are computed on the string as given; reconciliation must be correct when an edit only changes line endings (that shows up as a large diff — anchors should remap, not orphan).
- A selector whose `exact` is a single common word — resolution will be ambiguous by nature; the ladder's determinism rules must still yield a stable answer.
- `diff-match-patch` deadline: set `Diff_Timeout` explicitly (e.g. 1 s) rather than relying on the library default, and document that a timed-out diff degrades to a coarser mapping (anchors may orphan) instead of being wrong.

## Testing Strategy

Vitest, colocated `*.test.ts`.

- **§15 M1 matrix (table-driven, the acceptance suite)**: for one fixture body with a known anchored sentence — edit before the range, edit after the range, edit inside the range, delete the range, change only the surrounding context — each asserting the resulting selector fields and the report bucket.
- **Resolution ladder**: one test per rung, plus a test proving each rung is only reached when the previous one fails (e.g. a body where bare `exact` is ambiguous but contextual match succeeds).
- **Fuzzy**: a typo'd body (a few characters changed) resolves; an unrelated body does not; the threshold is respected at both sides of the boundary.
- **Determinism**: run `reconcileAnchors` 100× on the same inputs, assert byte-identical JSON output.
- **Property-ish sweep**: for a fixture body and a set of randomly generated but seeded edits, assert the invariant "an anchor reported `unchanged` or `remapped` resolves in `newBody`" and "an anchor reported `orphaned` keeps its original selector".
- **Purity**: a test asserting the module's transitive imports contain no `node:fs`/`node:child_process` (read `import` statements from the source files, or assert via a module-graph check).

## E2E Verification Plan

Pure library — "real application" means real markdown files being really edited on disk and real reconciliation output written back, no mocked `fs`, per CONTRACT-001's pragmatic style.

### Reproduction Steps (bugs only)

N/A — this is a feature, not a bug.

### Verification Steps

1. Create a real scratch workspace (`mktemp -d`, `git init`), write a real document with a real `anchors:` frontmatter block whose selectors quote sentences actually present in the body (use a realistic multi-paragraph document — e.g. a copy of a section of this repo's `SPEC.md`).
2. Run a real script (`npx tsx`) that: reads the file, applies a concrete edit to the body (insert a paragraph above the anchored sentence), calls `reconcileAnchors`, writes the updated frontmatter + body back to disk, and prints the report. Expected: report `unchanged` or `remapped` (context refresh only), the anchor still resolves in the new body, `git diff` shows the body change and — when context changed — the `prefix`/`suffix` lines.
3. Repeat with an edit **inside** the anchored sentence. Expected: `remapped`, and the on-disk `exact` now quotes the edited sentence verbatim.
4. Repeat by **deleting** the anchored paragraph. Expected: `orphaned`, and the on-disk selector is byte-identical to what it was before (verify with `git diff` showing no change to that anchor's block).
5. Repeat with an edit **after** the anchored range. Expected: the anchor's `exact` and `prefix` are untouched; only the body changed.
6. Run the engine over a large real file (concatenate `SPEC.md` several times to ~1 MB) with 50 anchors and time it. Expected: completes in under a second; print the elapsed time in the log.
7. Sanity-check resolution against the real projection use case: for each anchor in the scratch workspace, print `resolveAnchor(body, selector)` and confirm the offsets `slice` back to the expected quoted text.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E testing — no mocks, no test clients. Include specific commands run, actual outputs observed, and pass/fail conclusions. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

N/A — feature, not a bug.

### Post-Implementation Verification

**implemented on: fable** (claude-fable-5), 2026-07-26.

All verification ran against **real files in a real `git init` scratch workspace** (per sprint-001 Verification Environment for SERVER-002): a throwaway `tsx` script (`scratchpad/e2e-anchors.ts`, not committed) wrote a real markdown document with a real `anchors:` frontmatter block, applied concrete edits, called `reconcileAnchors`, wrote frontmatter + body back to disk, and used `git diff` as the observation instrument.

Command: `./node_modules/.bin/tsx <scratchpad>/e2e-anchors.ts`
Workspace: `/var/folders/.../T/corpus-e2e-anchors-2aZhnr` (mkdtemp + `git init`), doc `data/docs/mortgage.md` with anchor `anc_k4f7` on `exact: "assume a 30-year fixed at 6.1%"` (context captured via `computeContext`, as the server's write path will).

1. **Insert paragraph above the anchor (TEST-22)** — observed:
   `report: {"unchanged":["anc_k4f7"],"remapped":[],"orphaned":[]}`; anchor re-resolves at `{"start":181,"end":211}` slicing back to `"assume a 30-year fixed at 6.1%"`; `git diff -U0` shows **only** the two inserted body lines (`+A brand-new paragraph...`), zero changes to the anchor block. PASS.
2. **Edit inside the anchored sentence (TEST-24)** — observed:
   `report: {"unchanged":[],"remapped":["anc_k4f7"],"orphaned":[]}`; on-disk `git diff` shows exactly `-    exact: assume a 30-year fixed at 6.1%` / `+    exact: assume a 30-year fixed at 6.4%` plus the body line change; the refreshed selector resolves in the new body via exact match, slice `"assume a 30-year fixed at 6.4%"`. PASS.
3. **Delete the anchored paragraph (TEST-25)** — observed:
   `report: {"unchanged":[],"remapped":[],"orphaned":["anc_k4f7"]}`; `resolveAnchor` on the new body returns `null`; `git diff` shows **only** the two deleted body lines — the anchor's frontmatter block is byte-identical (no `exact`/`prefix`/`suffix` lines in the diff). Nothing threw. PASS.
4. **Edit after the anchored range (TEST-23)** — observed:
   `report: {"unchanged":["anc_k4f7"],...}`; anchor still resolves at `{"start":126,"end":156}` (same offsets as baseline); `git diff` shows only the appended body lines. PASS.
5. **Context-only change** — covered in the unit M1 matrix (`reconcile.test.ts`): `remapped`, `exact` kept, `prefix`/`suffix` refreshed to the new surroundings and equal to `computeContext` of the new body (TEST-26). PASS.
6. **1 MB / 50 anchors (TEST-29)** — real SPEC.md content (19 KB unit repeated past 1 MB, so all 50 markers genuinely exist), one paragraph inserted mid-body:
   `body=1008050 chars, elapsed=5.2ms, buckets: unchanged=49 remapped=1 orphaned=0` (the one `remapped` is the anchor whose 32-unit prefix window contains the insertion — a true context refresh). The colocated Vitest benchmark (independent 1 MB fixture) also asserts `< 1000 ms`. PASS, well under a second.
7. **Resolution sanity (projection use case)** — `resolveAnchors` over the scratch workspace prints `anc_k4f7 {"start":126,"end":156} slice="assume a 30-year fixed at 6.1%"` — offsets slice back to the quoted text. PASS.
   `git log --oneline` in the workspace shows the baseline + one commit per scenario (9 commits), confirming every state was really written to disk and committed.

**Fixture bug found during E2E (not an engine bug):** the first run of the 1 MB scenario built anchors for markers `copy 15..49` that did not exist in the body (`indexOf === -1` fed to `computeContext`), yielding garbage whole-body prefixes that the engine then legitimately fuzzy-matched (`"<!-- copy 20 -->"` ≈ `"<!-- copy 2 -->\n"` at 0.875 similarity ≥ 0.75 threshold). Fixed by capping the repeated unit so all 50 markers exist and guarding `capture` — the unit-test fixture always had this guard.

**Gate results (from this worktree, clean run):**
- `npm run build` — PASS (contract → kit → cli, dependency order)
- `npm run lint` — PASS (0 problems)
- `npm run format:check` — PASS
- `npm run typecheck` — PASS (all workspaces, strict + `exactOptionalPropertyTypes`)
- `npm run test:coverage` — **343 tests passed**, coverage all files **99.77 % lines / 94.44 % branches / 100 % functions** (≥ 90 % gate)

**Sprint-001 acceptance tests:** TEST-18…TEST-32 all covered by colocated unit suites (`resolve.test.ts`, `fuzzy.test.ts`, `reconcile.test.ts`, `diff.test.ts`, `index.test.ts` purity scan) and the real-file scenarios above. TEST-62 (checker ∘ resolver composition) and TEST-64's SERVER-001-side half: ~~**DEFERRED → sprint-001 cross-issue integration**~~ **TEST-62 VERIFIED 2026-07-26** (addendum below) — SERVER-001 was implemented in a parallel worktree and its checker was not present here; SERVER-002's side of the contract (`resolveAnchor(body, selector) → Range | null`, selectors emitted satisfying `TextQuoteSelectorSchema` — verified by `TextQuoteSelectorSchema.parse` in `reconcile.test.ts`) is in place.

### Addendum — TEST-62 verified after SERVER-001 merged (2026-07-26)

**implemented on: opus** (claude-opus-5, 1M context).

With both worktrees merged into `phase-1-foundations`, the deferred composition check
ran for real against SERVER-001's `checkCorpus`.

**The two published signatures did not meet.** SERVER-001's `AnchorResolver` declared
a third positional `hint?: number`; this engine publishes
`resolveAnchor(body, selector, options?: ResolveOptions)`. Neither issue's Technical
Design fixed the third parameter's shape — the Resolution-ladder section here only
says "`hint` is the caller-supplied previous offset when available" — so the two
worktrees picked different encodings and assignment failed:

```
error TS2322: Types of parameters 'options' and 'hint' are incompatible.
  Type 'number | undefined' is not assignable to type 'ResolveOptions | undefined'.
```

**The engine was not changed.** Widening `ResolveOptions` to `number | ResolveOptions`
purely to satisfy a caller that never supplies a hint would be an adapter in
disguise. The fix landed on the checker instead: `AnchorResolver` now names only the
two arguments `checkCorpus` actually passes, so any resolver with extra _optional_
parameters — this one included — composes as published. `resolveAnchor`'s signature,
its ladder, its thresholds and its purity are untouched by this addendum.

**TEST-62 — PASS.** Colocated suite `apps/server/src/check-with-anchors.test.ts`
(5 tests) injects `resolveAnchor` directly (`checkCorpus(docs, { resolveAnchor })`,
property shorthand — no adapter, cast or wrapper). Real-file E2E over a scratch
corpus on disk (throwaway `tsx` script, **not committed**), one resolvable and one
well-formed-but-unresolvable anchor, each claimed by a thread so `anchor-unused`
never fires:

```
documents: 3  resolver: real resolveAnchor
errors: 0
warnings: 1
  WARNING anchor-unresolved data/docs/finance/mortgage.md — anchor `anc_m2n5` no longer resolves in the body; its thread is orphaned

documents: 3  resolver: none      # --no-resolver
errors: 0
warnings: 0
```

One test drives the composition through **rung 3**: the anchored sentence is edited
(`6.1%` → `6.4%`) so `indexOf` cannot match, and the corpus still reports zero
warnings — the checker is exercising this engine's bounded fuzzy search, not a
substring stand-in that would have orphaned the anchor.

**Repo gates after the change**: `npm run build`, `lint`, `format:check`,
`typecheck`, `test:coverage` all PASS — **778 tests across 54 files**, combined
coverage **99.75% lines / 95.6% branches / 100% functions**, `apps/server/src` at
100/100/100.

### Fix loop round 1 — FAIL-1 (evaluator verdict `issues/evals/SERVER-002-eval.md`, TEST-26)

**implemented on: fable** (claude-fable-5).

#### Reproduction (before any code change, 2026-07-26)

Evaluator's escalating-context-edits sequence, pure-library repro
(`node_modules/.e2e/repro26.ts`, run with `./node_modules/.bin/tsx` against the
worktree sources — anchored sentence `SENT = "We assume a 30-year fixed at 6.1%
for the base case."`, selector built with `computeContext` on `oldBody`):

```
--- one word before changed
exact still present: true | classify: equal | report: unchanged
--- one word before + one after changed
exact still present: true | classify: equal | report: remapped
--- preceding sentence fully rewritten
exact still present: true | classify: equal | report: remapped
--- both neighbouring sentences rewritten
exact still present: true | classify: deleted | report: orphaned
emitted exact unchanged: true
resolves in newBody anyway: {"start":83,"end":135}
stale prefix: "three inputs that matter most.\n\n"
```

Bug confirmed exactly as reported: the fourth edit leaves the anchored sentence
byte-identical, yet `computeOffsetMapper(...).classify` calls its range
`"deleted"` (`diff_cleanupSemantic` merged the two neighbouring rewrites into
one delete/insert swallowing the untouched sentence), the report says
`orphaned`, the selector is left stale — and `resolveAnchor(newBody, selector)`
finds it at 83–135.

On-disk reproduction with the contract's Given (`node_modules/.e2e/m1-disk-test26.ts`:
real `mkdtemp` + `git init` workspace, doc with `anchors:` frontmatter, both
neighbouring sentences rewritten, reconciled, written back, committed):

```
workspace: /var/folders/vt/.../corpus-t26-WsbY1Z
report: {"unchanged":[],"remapped":[],"orphaned":["anc_k4f7"]}
on-disk exact unchanged: true
on-disk prefix: "three inputs that matter most.\n\n"   # stale — this text is gone
prefix quotes new surroundings: false
re-resolves: {"start":83,"end":135}   slices back to SENT: true
```

`git show` for the reconcile commit touches only the two rewritten body lines;
the anchor block is untouched (stale). TEST-26 expectation (`remapped`, `exact`
unchanged, context refreshed) violated. Reproduction complete — proceeding to fix.

#### Root cause and fix

`computeOffsetMapper` classifies a range `"deleted"` when no `EQUAL` character
of the semantic-cleaned diff survives inside it. `diff_cleanupSemantic` merges
the two neighbouring rewrites into a single delete/insert pair that swallows
the byte-identical sentence between them, so the classification lies.
`reconcileAnchors` trusted it and orphaned with a stale selector.

Fix (in `apps/server/src/anchors/reconcile.ts` only — the mapper, resolver,
fuzzy search and context modules are untouched): a `deleted` classification —
and the degenerate case of a mapped slice that is empty/whitespace-only — is
treated as a *claim* by the diff, verified before orphaning by re-resolving the
original selector against `newBody` through the full §6 ladder
(`resolveAnchor(newBody, selector, { hint: mapper.mapStart(oldRange.start) })`).
§6 defines an orphan as a selector that *no longer resolves*; the diff is only
the mechanism. If the ladder resolves, the anchor re-attaches there (`exact` =
resolved slice, context recomputed, reported `remapped`/`unchanged` by the
usual rule); only when the ladder also fails is the selector kept verbatim and
the anchor orphaned. The already-orphaned-in-`oldBody` path still short-circuits
first — an anchor dead before the edit is never re-attached (TEST-31 invariant
re-verified). `partial` ranges with a real mapped slice keep trusting the
mapper: the diff's in-place-edit evidence outranks a verbatim survivor
elsewhere (prevents wrongly re-attaching to a duplicate when the user edited
the anchored occurrence in place). Deliberate semantic consequence, tested: a
sentence cut here and pasted verbatim elsewhere now re-attaches (rung 2)
instead of orphaning — consistent with §6's definition.

#### Post-fix verification (2026-07-26)

Pure-library repro re-run (`node_modules/.e2e/repro26.ts`) — fourth row fixed,
first three unchanged:

```
--- both neighbouring sentences rewritten
exact still present: true | classify: deleted | report: remapped
emitted exact unchanged: true
resolves in newBody anyway: {"start":83,"end":135}
```

On-disk TEST-26 with the contract's Given (`node_modules/.e2e/m1-disk-test26.ts`,
real `mkdtemp` + `git init` workspace, reconcile + write-back + commit):

```
report: {"unchanged":[],"remapped":["anc_k4f7"],"orphaned":[]}
on-disk exact unchanged: true
on-disk prefix: " precede the quoted line here.\n\n"    (≤ 32 units, new surroundings)
on-disk suffix: "\n\nUtterly different words now fo"    (≤ 32 units, new surroundings)
prefix quotes new surroundings: true
re-resolves: {"start":83,"end":135}   slices back to SENT: true
```

`git show` for the reconcile commit now shows both rewritten body lines **and**
the refreshed `prefix`/`suffix` lines in the `anchors:` frontmatter block
(`doc.md | 10 +++++-----`), i.e. the selector was really rewritten on disk.

**Regression tests added** (all colocated, run in the suite):

- `reconcile.test.ts` — new describe block "deleted classification is verified
  before orphaning (SERVER-002 FAIL-1)": the evaluator's exact both-neighbours
  scenario; the escalating four-edit table as a never-orphans-while-present
  invariant; genuine deletion alongside both rewritten neighbours still orphans
  with the selector verbatim (the net does not over-trigger); cut-and-paste
  re-attachment; whitespace-degenerate mapped slice re-attaching via rung 2.
- `reconcile.disk.test.ts` — **new on-disk M1 suite** (addresses the eval's
  discrepancy note that M1 rows were unit-only): real markdown files with
  `anchors:` frontmatter in a real `mkdtemp` directory, read → edit →
  reconcile → write back → re-read, for the before/after/inside/deleted rows
  and TEST-26 with the contract's Given. The engine stays pure; the test plays
  the server's save path.

Coverage of `reconcile.ts` after the fix: 67/67 statements, 25/25 branch legs.

**Performance before/after** (median of 5, same machine, 1 MB body, 50 anchors;
"old" = pre-fix implementation benchmarked side by side,
`node_modules/.e2e/bench.ts`):

| scenario                                | old       | new       |
| --------------------------------------- | --------- | --------- |
| one mid-body insertion (TEST-29 shape)  | 7.0 ms    | 7.0 ms    |
| 200 scattered edits, all 50 kept        | 14.7 ms   | 14.0 ms   |
| whole body replaced, all 50 orphan      | 1017.5 ms | 1079.6 ms |

Kept-anchor paths are byte-identical code (re-resolution only runs on
`deleted`/blank claims). The worst case — every anchor takes the verification
path over 1 MB of unrelated text — costs +6%, dominated by the pre-existing 1 s
`Diff_Timeout`, not the net. No order-of-magnitude regression; the unit
benchmark (`< 1 s` for 1 MB/50 anchors/one edit) still passes.

**Gate results (this worktree, clean run):**

- `npm run build` — PASS
- `npm run lint` — PASS (0 problems)
- `npm run format:check` — PASS
- `npm run typecheck` — PASS (all workspaces)
- `npm run test:coverage` — **624 tests passed** (42 files; worktree contains
  the server + contract/kit/cli trees), combined coverage **99.72% lines /
  95.21% branches / 100% functions** (≥ 90% gate); `anchors/reconcile.ts` at
  100/100/100.

### Fix loop round 2 — FAIL-2 (evaluator verdict round 2, deleted text re-attached to look-alikes)

**implemented on: fable** (claude-fable-5).

#### Reproduction (before any code change, 2026-07-26)

All four evaluator scenarios reproduced pure-library
(`scratchpad/repro-fail2.ts`, run with `tsx` against the current sources —
selector built with `computeContext` on `oldBody`, anchored text then genuinely
deleted):

```
--- deleted middle paragraph (similar siblings)
report: {"unchanged":[],"remapped":["anc_bravox"],"orphaned":[]}
selector preserved: false
now quotes: "The alpha paragraph discusses alpha matters and nothing else whatsoever."
--- deleted middle bullet (near-identical bullets)
report: {"unchanged":[],"remapped":["anc_bread1"],"orphaned":[]}
selector preserved: false
now quotes: "\n- Buy milk from the corner store on Tuesday."
--- deleted table row (similar rows)
report: {"unchanged":[],"remapped":["anc_q2row"],"orphaned":[]}
selector preserved: false
now quotes: "| Q3 | 120 | 4% |"
--- deleted sentence with a verbatim copy elsewhere
report: {"unchanged":[],"remapped":["anc_dupli1"],"orphaned":[]}
selector preserved: false
now quotes: "The retention clause survives termination of this agreement."
```

Expected in every row: `orphaned`, selector byte-identical (SPEC §6 step 5,
TEST-25). Observed: `remapped` onto a sibling/copy, historical selector
destroyed.

On-disk reproduction, bullet scenario (`scratchpad/repro-fail2-disk.ts`: real
`mkdtemp` + `git init` workspace `corpus-s2r2-iEqWpe`, doc with `anchors:`
frontmatter, bread bullet deleted, reconciled, written back, committed):

```
report: {"unchanged":[],"remapped":["anc_bread1"],"orphaned":[]}
selector now on disk: {"exact":"\n- Buy milk from the corner store on Tuesday.", …}
frontmatter rewritten: true
--- git diff HEAD~1 -U0 ---
-    exact: "- Buy bread from the corner store on Tuesday."
+    exact: |-
+
+      - Buy milk from the corner store on Tuesday.
```

`git diff` shows the anchor block rewritten onto the *milk* bullet — TEST-25's
"no change whatsoever to that anchor's frontmatter block" violated. Bug
confirmed exactly as the evaluator reported. Proceeding to fix.

#### Root cause and fix

Round 1 verified a `deleted` classification by re-resolving through the **full**
§6 ladder, so rung 3 (fuzzy, threshold 0.75) could "verify" a genuinely deleted
paragraph/bullet/row via a look-alike sibling and silently re-attach the thread,
destroying the historical selector. The verification step exists to catch one
thing only: **verbatim survival** that `diff_cleanupSemantic` swallowed (merged
neighbour rewrites, cut-and-paste). Similarity is not survival.

Shipped design (the adjudicated primary shape, EQUAL/INSERT distinction
included — not the conservative fallback):

- `resolve.ts`: the exactness tier (rungs 1–2) is extracted as
  `resolveAnchorExact`; `resolveAnchor` is unchanged behaviourally (exact tier,
  then fuzzy).
- `diff.ts`: `OffsetMapper` gains `touchesInsertion(range)` — does a new-body
  range contain at least one character this edit inserted (reuses the segment
  table already built for mapping; no second diff).
- `reconcile.ts`: a `deleted` claim (or whitespace-degenerate mapped slice)
  re-attaches **only if** `resolveAnchorExact(newBody, selector)` finds the
  text (rung-1 context-exact or rung-2 unique-exact — never fuzzy) **and** the
  match overlaps inserted text. An exact match lying wholly in unedited
  (EQUAL) text existed before the edit — a pre-existing doppelgänger of the
  deleted range, not the range surviving — so the anchor orphans with its
  selector preserved byte-for-byte (SPEC §6 step 5). `partial` ranges still
  trust the mapper; already-orphaned-in-`oldBody` anchors still short-circuit.

Why the primary shape and not the fallback: the fallback (exact rungs only, no
region check) still re-attaches the evaluator's fourth scenario — a deleted
sentence whose verbatim copy pre-existed elsewhere becomes rung-2-unique after
the deletion. The insertion-overlap test is what separates "the edit carried
this text here" (TEST-26's merged rewrite, cut-and-paste — re-attach) from
"this text was already there" (doppelgänger — orphan), and it satisfies all
five must-hold criteria simultaneously.

#### Post-fix verification (2026-07-26)

Four-scenario repro re-run (`scratchpad/repro-fail2.ts`) — all four now orphan
with the selector byte-identical:

```
--- deleted middle paragraph (similar siblings)
report: {"unchanged":[],"remapped":[],"orphaned":["anc_bravox"]}   selector preserved: true
--- deleted middle bullet (near-identical bullets)
report: {"unchanged":[],"remapped":[],"orphaned":["anc_bread1"]}   selector preserved: true
--- deleted table row (similar rows)
report: {"unchanged":[],"remapped":[],"orphaned":["anc_q2row"]}    selector preserved: true
--- deleted sentence with a verbatim copy elsewhere
report: {"unchanged":[],"remapped":[],"orphaned":["anc_dupli1"]}   selector preserved: true
```

On-disk bullet scenario (`scratchpad/repro-fail2-disk.ts`, real `mkdtemp` +
`git init` workspace `corpus-s2r2-ffeMs7`, reconcile + write-back + commit):

```
report: {"unchanged":[],"remapped":[],"orphaned":["anc_bread1"]}
frontmatter rewritten: false
--- git diff HEAD~1 -U0 ---
@@ -17 +16,0 @@ anchors:
-- Buy bread from the corner store on Tuesday.
```

`git diff` shows **only** the deleted body line; the anchor's frontmatter block
is untouched byte-for-byte — TEST-25's letter.

Must-hold criteria re-verified (`scratchpad/postfix-verify.ts`):

```
=== escalating-context sequence ===
one word before changed:                      unchanged | exact kept | context refreshed
one word each side:                           remapped  | exact kept | context refreshed
preceding sentence fully rewritten:           remapped  | exact kept | context refreshed
both neighbouring sentences rewritten (T-26): remapped  | exact kept | context refreshed  → resolves {"start":83,"end":135}
=== cut-and-paste corollary ===
report: {"remapped":["anc_k4f7"]} | exact kept: true
=== determinism x100 (mixed doc incl. a doppelgänger orphan) ===
distinct serializations: 1 | report: {"unchanged":[],"remapped":["anc_s","anc_t"],"orphaned":["anc_b"]}
```

TEST-26 (round-1's fix) stays green; no row of the escalating sequence orphans;
cut-and-paste still re-attaches (the pasted text overlaps the insertion).

**Regression tests added:**

- `reconcile.test.ts` — new describe "genuine deletions never re-attach to
  look-alikes (SERVER-002 FAIL-2)": the evaluator's four scenarios (sibling
  paragraphs, near-identical bullets, table rows, pre-existing verbatim copy),
  each asserting `orphaned` + selector byte-identical, plus the cut-and-paste
  counterpart as a separate test. The round-1 whitespace-degenerate test — which
  had enshrined a doppelgänger re-attach — is split in two: re-appears-in-
  inserted-text → remap; pre-existing copy elsewhere → orphan.
- `reconcile.disk.test.ts` — TEST-25 extended with the similar-sibling bullet
  fixture on disk: asserts the persisted file differs from the seeded one only
  by the deleted body line (anchor block byte-identical).
- `resolve.test.ts` — `resolveAnchorExact`: rung 1, rung 2, null-where-fuzzy-
  would-match, null-for-non-unique, empty inputs.
- `diff.test.ts` — `touchesInsertion`: inserted vs unedited vs empty ranges,
  partial overlap with an inserted run, identical bodies.

**Performance** (median of 5, 1 MB body, 50 anchors,
`scratchpad/postfix-verify.ts`; round-1 figures from the previous log):

| scenario                               | round 1   | round 2  |
| -------------------------------------- | --------- | -------- |
| one mid-body insertion (TEST-29 shape) | 7.0 ms    | 7.2 ms   |
| 200 scattered edits, all 50 kept       | 14.0 ms   | 16.5 ms  |
| whole body replaced, all 50 orphan     | 1079.6 ms | 133.5 ms |

Kept-anchor paths are unchanged code; the orphan-verification worst case got
~8× faster because verification no longer runs fuzzy (`match_main` bitap +
candidate scoring) per anchor. Same order of magnitude everywhere.

**Gate results (main tree, clean run):**

- `npm run build` — PASS
- `npm run lint` — PASS (0 problems)
- `npm run format:check` — PASS
- `npm run typecheck` — PASS (all workspaces)
- `npm run test:coverage` — **822 tests passed** (55 files), combined coverage
  **99.76% lines / 95.59% branches / 100% functions** (≥ 90% gate);
  `anchors/reconcile.ts` at 100/100/100.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-002]` prefix
