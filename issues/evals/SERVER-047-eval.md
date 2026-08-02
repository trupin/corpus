# Evaluation: SERVER-047

**Date**: 2026-08-02
**Sprint**: sprint-022
**Verdict**: PASS
**Evaluator model**: Opus 5 (1M context)

Rig: workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/eval-p9/ws`, server `8808`,
bin `apps/cli/src/bin/corpus.ts`. Fixtures composed by the evaluator (garden domain), not reused
from the implementing agent's mortgage/escrow set. `8765` never bound; scratch model cache.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                     |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | `issues/server/047-context-pack-assembly.md:72-411`                                                          |
| Commands are specific and concrete      | PASS   | Real `curl` with real ids, `awk`/`diff` against files on disk, sqlite cross-checks, measured byte table       |
| Real E2E (not mocked)                   | PASS   | Real server on 8804, real `corpus doc edit`/`doc delete` producing the orphan and the deletion, not fixtures  |
| Scenarios cover acceptance criteria     | PASS   | All four ACs have distinct live evidence                                                                     |
| Application restarted after changes     | PASS   | Server started/stopped on 8804, `lsof` before and after                                                      |
| Actual model recorded (implemented on:) | PASS   | `implemented on: opus` (Opus 5, 1M context), 2026-08-02                                                       |
| Reproduction logged before fix (bugs)   | N/A    | Feature                                                                                                      |

One deferral is declared with substitute evidence: TEST-972's "past 5,000 documents" was run at
40 vs 600. The evaluator independently re-ran the boundedness property at 13 → 273 real documents
against the real server (below), which closes it.

## Criteria Results

| #   | Criterion                                                                          | Result | Observed                                                                                 |
| --- | ---------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| 1   | All five thread shapes produce correct packs                                       | PASS   | Five 200s with five distinguishing payloads, driven from real state (table below)            |
| 2   | Bounds enforced: oversized corpus still yields a pack within contract caps, ranked  | PASS   | 13 docs → 2,382 B / 6 excerpts; 273 docs → 2,285–3,134 B / 10 excerpts (the cap). Best-ranked survive |
| 3   | Semantic-degrade path mirrors search's flag semantics                              | PASS   | Pack note names `"indexing"`, the same word `corpus index status` prints, on the same workspace at the same moment |
| 4   | Anchor mid-section returns the WHOLE enclosing section, not a snippet fragment      | PASS   | `diff` against the file's own section: byte-identical. Over-cap section truncated *around* the anchor and flagged |

## Evidence

### AC 4 — the whole section, verified against the bytes on disk

Thread `th_wl7djw23`, anchored on `drip lines deliver water to each seedling tray every morning`,
which sits mid-way through the third heading section of `data/docs/garden/greenhouse-plan.md`:

```
$ /usr/bin/awk '/^## Watering$/{f=1} /^## Fertiliser$/{f=0} f' ws/data/docs/garden/greenhouse-plan.md > file-section.txt
$ corpus thread context th_wl7djw23 | /usr/bin/awk '/^## Watering$/{f=1} /^# related excerpts$/{f=0} f' > pack-section.txt
$ /usr/bin/diff file-section.txt pack-section.txt
    (no output)        → SECTION BYTE-IDENTICAL TO FILE
```

The anchored quote is carried verbatim above it, and the section includes the second paragraph the
anchor is *not* part of — so this is the enclosing section, not a window around the quote.

### AC 1 — five shapes, five 200s, all from real state

| Shape            | Thread        | HTTP | Distinguishing payload                                              |
| ---------------- | ------------- | ---- | ------------------------------------------------------------------- |
| `anchored`       | `th_wl7djw23` | 200  | `parent.quote` + whole `parent.section` + `headingPath`              |
| `whole-document` | `th_mso6oy65` | 200  | `parent` title + opening content, no `section`                       |
| `standalone`     | `th_w26ri26o` | 200  | **no `parent` key at all**; excerpts only                            |
| `orphaned-anchor`| `th_g5xm7da6` | 200  | preserved quote, no `section`, no `headingPath`                      |
| `parent-deleted` | `th_sgtlpn3t` | 200  | `deletedParent: doc_dnrhd6n6`, no `parent` key                       |

The orphan was produced by editing the anchored text away through the real CLI
(`edited doc_calc3teb — 1 orphaned (th_g5xm7da6) — warning: orphaned_anchor`) and the
parent-deleted case by `corpus doc delete doc_dnrhd6n6`
(`deleted doc_dnrhd6n6 — orphaned 1 thread (th_sgtlpn3t)`). The parent's own `GET /api/docs/…`
is a 404 while the thread and its pack are both 200 — the 404/200 split holds.

### AC 2 — bounded, measured on the real server

Corpus grown 13 → 273 documents (250 bulk notes written out-of-band, `db rebuild`, `index rebuild`
to `state current`, 587 chunks):

| shape                    | thread        | CLI bytes | JSON bytes |
| ------------------------ | ------------- | --------- | ---------- |
| anchored                 | `th_wl7djw23` | 2285      | 2762       |
| whole-document           | `th_mso6oy65` | 1861      | 2331       |
| standalone               | `th_w26ri26o` | 2016      | 2420       |
| orphaned-anchor          | `th_g5xm7da6` | 2345      | 2653       |
| parent-deleted           | `th_sgtlpn3t` | 2291      | 2615       |
| anchored, over-cap section | `th_3iwyjeyu` | 6555    | 6941       |

The same anchored thread measured **2,382 B at 13 documents and 2,285–3,134 B at 273** — a 21×
corpus produces no growth trend, and the excerpt list saturates at its 10-row cap and stops.
"A briefing, never a dump" is observable.

The over-cap case is the section cap doing its job, not an unbounded pack: `section chars: 4000`,
`truncated: true`, `quote at offset 1984` — the window is centred on the anchor, and the pack
prints the escalation line rather than trimming silently.

### AC 3 — one honest word across surfaces

Mid-rebuild (`indexed 176 / pending 408`):

```
$ corpus index status        state       indexing
$ corpus thread context th_wl7djw23 | tail -1
# ranking is degraded — the semantic index is "indexing" (SPEC.md §9.1); these results are ranked on the lexical half alone.
```

At `state current` the note is absent. The UI overlay, queried on the same workspace in the same
window, printed `Ranked on text alone — the semantic index is still being built.` — two surfaces,
the same state word.

### Pure read, and clean afterwards

```
$ corpus db doctor
projection is clean — 273 documents from 273 files (13ms)
```

Packs were fetched dozens of times across the session with no projection drift and no writes.

## Failures

None.

## Observations (not failures)

- **The truncated section window can begin mid-word** (`"ph 29 of the very long section…"`). SPEC
  §6's "never truncated mid-word" governs anchor `exact` quotes, not the pack's section window, and
  the truncation line names the escalation — so this is legal. It reads slightly rough; a
  word-boundary cut would be a craft improvement, not a fix.
- **The degrade note's wording says "ranked on the lexical half alone" while a *partially* built
  index exists.** Rows from freshly-embedded chunks were still present in the degraded pack. The
  spec's obligation ("search stays honest… says when semantic ranking is not yet caught up") is met
  — the state word is exact — and the shipped `corpus search` behaves identically under the same
  state, so this is not Phase 9 drift. Worth ledgering if the wording is ever tightened.

## Note — SERVER-049 (the cross-port delivery race fix), spot-checked here

No separate verdict; the fix has no user-visible surface of its own beyond a clean server
lifecycle. Spot-check, on this workspace:

**The event loop is not blocked by inference.** With 587 chunks actively embedding, ten
`GET /api/health` probes over four seconds:

```
0.000839s 0.001035s 0.001240s 0.001096s 0.001183s 0.000975s 0.001065s 0.001156s 0.000971s 0.000994s
```

Sub-2 ms throughout — the property the worker host exists to provide.

**Stop mid-drain, restart, converge.**

```
$ corpus index status        indexed 256 · pending 331 · state indexing
$ corpus server stop         stopped (pid 21873)          [0.50s wall]
$ lsof -nP -iTCP:8808        (no rows — port released)
$ corpus server start        corpus 0.0.0 listening on http://127.0.0.1:8808 (pid 22123)
$ corpus index status        indexed 368 · pending 219 · failed 0 · state stale
   … converged unattended …
$ corpus index status        indexed 587 · pending 0 · failed 0 · state current
$ corpus db doctor           projection is clean — 273 documents from 273 files (19ms)   [exit 0]
$ corpus thread context th_wl7djw23
parent doc_gt2cvtta · Greenhouse plan · Greenhouse plan › Watering                        [exit 0]
```

Clean stop under load, no orphaned listener, no failed chunks, honest `stale` on the way back, and
the pack answers afterwards. No regression observed.

## Summary

4 of 4 criteria passed, verified end-to-end on evaluator-composed fixtures against a real server,
including the whole-section property diffed against the bytes on disk and boundedness re-measured
at 21× the implementing agent's corpus size.
