# Evaluation: SERVER-042

**Date**: 2026-08-01
**Sprint**: sprint-021
**Evaluator model**: Opus 5 (1M context)
**Verdict**: PASS

Rig: workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/eval-p8/ws`, created by
`corpus init` through `apps/cli/src/bin/corpus.ts` from a fresh `npm run build`. Port 8808.
Model cache `…/eval-p8/cache` (cold at start). 8765 never bound. No git command run.
All greps `/usr/bin/grep`; note that this harness proxies bare `find`/`ls`, so `/usr/bin/find`
and `/bin/ls` were used for every filesystem claim below.

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Long, specific, with pasted sqlite3 diffs |
| Commands are specific and concrete | PASS | Named ports, doc ids, chunk ids, exact diffs |
| Real E2E (not mocked) | PASS | Real server on 8804, real `PUT /api/docs/{id}`, real `sqlite3` dumps |
| Scenarios cover acceptance criteria | PASS | Every criterion has a pasted artefact |
| Application restarted after changes | PASS | Explicit restarts for the 8→9 stamp test |
| Actual model recorded (implemented on:) | PASS | "implemented on: opus (Opus 5, 1M context)" |
| Reproduction logged before fix (bugs) | N/A | Feature issue; the PR #15 note is addressed and its residue disclosed |

The log is unusually honest in two places I independently confirmed matter: it discloses that
TEST-836's *snippet* still comes from the document-granular `search` row (only `headingPath` is
chunk-addressed), and it discloses a self-review finding (`embeddingsCarriedOver` leaking onto the
`POST /api/db/rebuild` wire) that it removed. Neither was hidden.

## Criteria Results

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| 1 | Deterministic chunking, same body → same chunk ids | PASS | Repeated `db rebuild` + full restarts produced a stable 581-row `chunks` table; `db doctor` clean each time |
| 2 | One-section edit changes only that section's embedding work | PASS | **Measured independently**: 20-section document, one section edited via `PUT /api/docs/doc_evallarge1` → peak `pending` = **1**, not 20 |
| 3 | Move/rename: zero chunk changes | PASS | **Measured independently**: `corpus doc move … --folder finance` + `corpus doc edit --title …` → distinct `pending` values observed across the whole window = `[0]`, peak **0** |
| 4 | Fenced heading not a boundary; oversized split; turns chunk per turn | PASS (partial scope) | Not re-derived by me (chunk internals are not observable through the public interface beyond counts); the observable consequence — a 20-section doc produces exactly 20 chunks, a 4-section doc exactly 4 (120 docs × 4 = 480 of the 561) — held exactly |
| 5 | `db rebuild` reconstructs chunks identically; SCHEMA_VERSION 8→9, wipe-and-rebuild | PASS | `corpus db rebuild` on an unchanged corpus → `pending` stayed 0 (embeddings re-attached by content address, OC5), `db doctor` clean, exit 0 |
| 6 | `/api/search` heading paths come from chunks | PASS | Every hit carries a `headingPath` naming a real section (`Consultation`, `Visit`, `Section 1 of note 010`); chunk drift is now *detectable*, which is only possible if the address is stored — see below |

### Independent measurements

```
$ node /tmp/eval-prop.mjs          # 20-section document, edit section 7 only
baseline: {"indexed":581,"pending":0,...,"state":"current"}
PUT -> 200
pending observations: 1 -> 0
PEAK PENDING after a ONE-SECTION edit of a 20-section doc: 1 (expected 1)

$ corpus doc move doc_evallarge1 --folder finance --from user
moved doc_evallarge1 — data/docs/finance/large.md
$ corpus doc edit doc_evallarge1 --title "Large multi section document RENAMED" --from user
  distinct pending values across move+rename: [0]
  PEAK = 0
```

Chunk addressing is genuinely stored and genuinely checked — tampering one `chunks` row is caught
by name:

```
$ /usr/bin/sqlite3 .corpus/cache.db "UPDATE chunks SET heading_path='Fabricated Heading' WHERE doc_id='doc_evalphys01' AND ord=0;"
$ corpus db doctor
content_mismatch data/docs/inbox/phys.md: chunk doc_evalphys01#0 is recorded under
  "Fabricated Heading" but its chunk_search row says "Consultation"
corpus: the projection has drifted from the files — 1 finding.
exit=6
$ corpus db rebuild && corpus db doctor
projection is clean — 140 documents from 140 files (7ms)          exit=0
```

## Failures

None.

## Observations (not failures)

- **O-1.** The chunk count for a document is exactly its ATX section count in every case I seeded
  (20-section doc → 20 chunks; 4-section docs → 4 each). No oversized-section split was triggered by
  my fixtures, so the sub-chunk addressing path (TEST-829) is covered only by the implementer's unit
  tests, not by my E2E.

## Summary

6 of 6 criteria pass. §9.1's observable promise — "re-indexing is proportional to the edit" — is
true through the public interface: a one-section edit of a twenty-section document queues exactly one
chunk, and a move plus a rename queue nothing at all. The stored chunk address is real enough that
corrupting it is caught by `db doctor` by name.
