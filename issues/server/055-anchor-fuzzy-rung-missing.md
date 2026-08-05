# [SERVER-055] The read path implements two of SPEC §6's three resolution rungs

## Domain
server

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §6 Anchoring — the resolution ladder

## Summary
Escalated by UI-062 (2026-08-04) while tracing why a comment landed at the top of
a document.

`apps/server/src/docs/read.ts:252` resolves anchors with `resolveAnchorExact` —
rungs 1 and 2 (literal match, then unique `exact`). SPEC §6 specifies a **third,
fuzzy rung** for when a document has been edited under an anchor. It is not
implemented on this path, so an anchor that the spec says should survive a small
edit is reported `orphaned` instead.

The user-visible consequence: edit a paragraph you have commented on, and the
comment detaches when the spec says it should follow. That is the whole point of
text-quote anchoring over line numbers — it is supposed to survive editing — so
this is a gap in the central promise of §6, not a nicety.

Worth checking before assuming it is simply missing: the anchor **engine** has
had substantial work (SERVER-002, -012, -013, -014 covered truncated selectors,
the substitution class, and duplicate-survivor policy). It is possible the fuzzy
rung exists in the engine and the read path does not call it, which would make
this a wiring fix rather than an implementation. Establish which first — the two
have very different risk.

## Acceptance Criteria
- [x] The read path resolves through the full §6 ladder, fuzzy rung included
- [x] An anchor whose surrounding text was edited but whose quote survives is
      resolved, not orphaned — with a test per edit shape (insertion before,
      insertion inside, deletion after, whitespace change)
- [x] A quote that genuinely no longer exists still orphans — the fuzzy rung must
      not become a "match something nearby" that re-introduces the
      confidently-wrong anchoring the client-side guards exist to prevent
- [x] Duplicate-survivor policy (SERVER-014) is respected by whatever the fuzzy
      rung does; the two must not disagree about which of two candidates wins
- [x] If the engine already implements it, say so and make this a wiring change
      with the reasoning recorded rather than a second implementation
- [x] Reconciliation on write (§6) and resolution on read agree about what
      resolves — a divergence here would show as an anchor that reconciles
      cleanly and then reads as orphaned

## Technical Design
### Files to Create/Modify
- `apps/server/src/docs/read.ts`, the anchor engine, tests

## Testing Strategy
Fixture-driven per edit shape, plus a round-trip test: write an edit through the
real mutation path and assert the anchor reads back resolved.

## E2E Verification Log

**Model: Opus 5 (1M context)**, server-dev agent. Real `corpus init` workspaces,
real server started with `corpus server start` on port **8791** (8765 and 5173
never touched), real HTTP, real files on disk, real watcher. Three builds were
run against the same scenario script: the shipped exact-only build (red), and the
fixed build (green).

### Was the rung missing, or unwired? — **unwired, and deliberately so**

`findFuzzyRange` (`apps/server/src/anchors/fuzzy.ts`) is a complete rung 3 and
has been since SERVER-002, and `resolveAnchor` composes the whole ladder.
`reconcileAnchors` already calls it — `reconcile.ts:134` locates every selector
in `oldBody` with the **full** ladder. What stopped at rungs 1–2 was every
*reader*: `docs/read.ts`, `projection/project-document.ts` and §14's `checkSeams`.

That was not an oversight. **Sprint-003 Adjudication 1** chose exact-only
explicitly, on a premise stated in the contract itself: "reconciliation runs on
every write path… so a live anchor's selector is always fresh by the time the
projector sees it". The premise is false in three named states, one of them
permanent:

1. **A selector that never byte-matched** (UI-068's canonical-mismatch class): an
   anchor born orphaned. No later save repairs it, because reconciliation leaves
   an anchor that does not resolve in `oldBody` exactly as it found it.
2. An **out-of-band edit** inside the watcher's debounce and its 100 ms flush
   budget (SERVER-022).
3. A **thread document whose turns were appended or deleted** — `turns.ts` never
   mentions anchors, so no reconciliation pass ever sees that body change.

So this is a wiring change, with one engine change that the wiring required (see
below) and no second implementation of the rung.

### The engine change the wiring required

Wiring rung 3 in unchanged would have been unsafe, and the sprint-003 objection
was concrete: a deleted bullet's parallel sibling. Measured, not assumed —
`"- milk from the corner bakery"` is **5** edits from `"- bread from the corner
bakery"` against a budget of `floor(30 × 0.25) = 7`, so the quote-similarity test
accepts it outright. Reverting only the new gate turns the *pre-existing* test
`never lands the orphaned bread bullet on the milk bullet` red.

The fix is a **corroboration gate**, not a new threshold: a fuzzy candidate is
accepted only when the passage **with its declared context** —
`prefix + exact + suffix`, the very string rung 1 matches literally — is within
the same `FUZZY_THRESHOLD` of the body at that offset. An in-place edit leaves
its neighbours; a sibling has its own. Rung 3 becomes the fuzzy analogue of rung
1 instead of "match something nearby". **No constant was added**, ranking and
tie-breaks are untouched, and a selector with no context at all is unaffected
(nothing to corroborate — rung 1 is skipped for it too).

### Pre-fix red on a real server (exact-only build, `/tmp/s055red`)

```
[1] at creation:              {"orphaned":false,"range":{"start":76,"end":106}}
    ← file edited on disk: "a 30-year fixed at 6.1%" → "a 30-year fixed-rate at 6.4%"
[1] read immediately:         {"orphaned":true,"range":null}        ← the comment detached
[4] fuzzy-resolved on read:   {"orphaned":true,"range":null}
[4] reconcile report:         {"remapped":["anc_58905b0e"],"orphaned":[]}
```

`[4]` is the divergence the issue names, in two consecutive lines from one
server: the reader calls the thread detached, and the very next save's
reconciliation resolves the same selector and reports it **remapped**.

The permanent class, same build, with **no edit at all** — a selector quoting the
editor's re-print (`5 * 3`) of a file that carries `5 \* 3`:

```
[6] right after the comment was posted:  {"orphaned":true,"quote":null}
[6] 3 s later (watcher has had its go):  {"orphaned":true,"quote":null}
```

### Post-fix, same scenarios, same script (fixed build, `/tmp/s055green`)

```
[1] read immediately:         {"orphaned":false,"quote":"assume a 30-year fixed-rate at"}
[1] after watcher reconciled: {"orphaned":false,"quote":"assume a 30-year fixed-rate at 6.4%"}
[2] quote genuinely gone:     {"orphaned":true,"range":null}   ← unchanged, before and after
[2] after watcher reconciled: {"orphaned":true,"range":null}
[3] deleted line, lookalike sibling one line below: {"orphaned":true,"range":null}
[3] landed on the Q4 sibling? no
[4] fuzzy-resolved on read:   {"orphaned":false,"quote":"assume a 30-year fixed at 6.4%"}
[4] reconcile report:         {"remapped":["anc_bbe67be5"],"orphaned":[]}
[4] read after the save:      {"orphaned":false,"quote":"assume a 30-year fixed at 6.4%"}
[6] right after the comment was posted:  {"orphaned":false,"quote":"fixed and 5 \* 3 is fiftee"}
```

`[1]` also shows the rung being honest about its own precision: the fuzzy window
is `exact.length` long, so the range is approximate (`…fixed-rate at`) until
reconciliation snaps it to the real bytes ~1 s later. `[2]` and `[3]` are
byte-identical before and after — the safety cases were never traded for the
feature.

The agent's context pack for `[1]`, read through `GET /api/threads/{id}/context`,
returns the **anchored** shape, not `orphaned-anchor`:

```json
{"id":"doc_wdgerxg7","headingPath":"Mortgage model",
 "quote":"assume a 30-year fixed-rate at 6.4%","section":"# Mortgage model…"}
```

`corpus doc check` on the same workspace warns `anchor-unresolved` for exactly
the two genuinely-gone anchors and for none of the 400 fuzzy-resolved ones — §14
now means by "orphaned" what the reader means.

### The perf objection sprint-003 raised, measured

Fuzzy runs only for an anchor that failed both exact rungs, so a healthy
workspace pays nothing. The pathological workspace — 400 documents, every anchor
falling all the way to rung 3 — was built and `POST /api/db/rebuild` timed three
times each way on the same server:

| every anchor resolves exactly (fuzzy never runs) | every anchor falls to rung 3 |
| --- | --- |
| 175 / 218 / 220 ms | 372 / 248 / 246 ms |

≈ 0.1 ms per unresolved anchor, matching a direct microbenchmark of
`findFuzzyRange` (0.052 ms present / 0.078 ms absent on a 6 KB body). SERVER-004's
2 s target for 2000 documents is not in play. Afterwards: `db doctor` →
`projection is clean — 419 documents from 419 files (11ms)`; `schema_version` →
`10`; 403 anchors with a `resolved_offset`, 2 NULL (the two deliberately-gone).

### Gates

- `apps/server` suite: **3193 passed / 164 files**, 0 failed
  (`VITEST_MAX_THREADS=4 vitest run apps/server`).
- Pre-fix red, by reverting each half in place and re-running: reverting the
  **wiring** → 4 red (3 in `docs/read.test.ts`, 1 in
  `projection/project-document.test.ts`); reverting the **context gate** alone →
  4 red, including the pre-existing `never lands the orphaned bread bullet on the
  milk bullet`.
- `npx eslint … --max-warnings 0`, `npx prettier --check`, `npx tsc --noEmit -p
  apps/server/tsconfig.json`: all clean.

### Processes

The workspace server on 8791 was started and stopped for each build; 8791
verified free at the end, no vitest workers left. Ports **8765** and **5173** were
never touched. Scratch workspaces removed.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes (scoped: eslint, prettier, tsc over the touched files)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
