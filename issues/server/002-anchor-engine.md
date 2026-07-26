# [SERVER-002] Anchor engine: text-quote resolution + reconciliation

## Domain

server

## Status

todo

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

_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-002]` prefix
