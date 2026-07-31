# Evaluation: SERVER-041

**Date**: 2026-07-31
**Sprint**: sprint-019 (Phase 7, Retrieval A)
**Evaluator model**: Opus 5 (1M context)
**Verdict**: PASS

Rig as SERVER-040: my own seeded workspace under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/eval-p7/ws`, server on **8810**, from-source CLI,
cwd outside the repository. `8765` untouched. All ports free at exit.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                          |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | `issues/server/041-related-links-graph.md:99+`, nine numbered sections                                                                          |
| Commands are specific and concrete      | PASS   | The seeded `links` rows pasted as a graph, verbatim JSON responses, byte count, status-code table                                               |
| Real E2E (not mocked)                   | PASS   | Real workspace via `corpus init --port 8806` outside the repo, real server pid 75163, real HTTP. The 17 unit tests are cited separately         |
| Scenarios cover acceptance criteria     | PASS   | Every one of TEST-687…698 has a named section; the log states "**Deferred / struck**: none"                                                     |
| Application restarted after changes     | PASS   | Single recorded pid started for the drill and stopped at the end, with the `lsof` check pasted                                                  |
| Actual model recorded (implemented on:) | PASS   | "**Implemented on: opus** (Opus 5, 1M context)"                                                                                                 |
| Reproduction logged before fix (bugs)   | N/A    | Feature, not a bug                                                                                                                             |

One claim in the log is unusually good evidence and I want to record why: it notes `doc_mutual1` is
the **oldest** of the three neighbours yet ranks first, so reciprocity provably outranks recency
rather than coincidentally agreeing with it. My own graph reproduced the same property from the
opposite direction (see below).

## Criteria Results

Seeded graph (all ids real, all links written through the CLI, never by hand):

```
A = doc_h7atwbtz   Mortgage options
A → B (doc_7aq3opse)   one-way outgoing
C (doc_35d7cxp5) → A   one-way incoming
A ↔ D (doc_ipjv6ink)   mutual
A → doc_nope000        dangling (no such document)
A → A                  self-reference
F (doc_6gnkxaj4) → A   archived neighbour
T (th_ulugyvit) turn   → B      ref typed inside a thread reply
E = doc_k2lyc3ck       orphan, connected to nothing
```

| #   | Criterion (sprint test)                             | Result | Observed                                                                                                                                             |
| --- | --------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 687 | Outgoing, incoming and mutual all surface           | PASS   | `related A` → `D` (mutual), `C` (incoming), `B` (outgoing). Orphan `E` absent                                                                        |
| 688 | Mutual ranks first; order deterministic             | PASS   | `D` first in every run. Remaining rows fell in **recency** order (F newest → C → B), matching the stated tiebreak exactly. Two identical calls: byte-identical |
| 689 | Dangling ref never handed to the agent              | PASS   | `doc_nope000` absent from `A`'s set even though the ref is in `A`'s body — and `corpus doc related doc_nope000` correctly 404s, which is why omitting it is right |
| 690 | A document is never related to itself               | PASS   | `A` contains `[[doc_h7atwbtz]]` (its own id); `A` is absent from its own set                                                                          |
| 691 | Thread neighbours are a decision, and it holds      | PASS   | The turn-written `[[B]]` makes `T` a neighbour of `B` — `related B` → `th_ulugyvit` first. Symmetric: `related T` → `B`. Behaviour is decided, documented in `docs/cli.md`, and observable |
| 692 | Excerpt is one line, bounded, not `body_excerpt`    | PASS   | Row excerpts 109–158 chars, **zero** LF/CR. The list's `excerpt` for the same document is the 280-char multi-line slice **with** newlines — visibly a different value |
| 693 | Archived neighbours excluded by default, lifted     | PASS   | `F` absent by default; present with `--include-archived`, ranked in place by the same rule rather than appended                                       |
| 694 | Unknown id → the shipped 404                        | PASS   | `{"code":"not_found","message":"no document with id doc_nope000"}` — the same shape `GET /api/docs/:id` produces                                      |
| 695 | `relation` is `linked`, and only `linked`           | PASS   | Every row across every query: `linked`. No `similar`, no `both`                                                                                      |
| 696 | `limit` capped and decided                          | PASS   | `limit=1` → 1 row; `limit=51` → 400; `limit=0` → 400; default 10, recorded in the OpenAPI description with its reason                                 |
| 698 | Real server, real graph                             | PASS   | This evaluation                                                                                                                                      |
| —   | Empty set is honest, exit 0                         | PASS   | `related E` (orphan) → `no related documents.`, exit 0; wire `{"related":[]}`                                                                         |
| —   | Row shape frozen                                    | PASS   | Exactly `{id, title, excerpt, relation}` on every row; envelope keys `['related']` only, `semanticIndex` absent                                       |
| —   | Route not swallowed by `/api/docs/{id}`             | PASS   | `GET /api/docs/<id>/related` reaches the related handler; `GET /api/docs/<id>` still reaches the document read (CONTRACT-022 TEST-670, over HTTP)     |
| —   | Frugality                                           | PASS   | Full 4-row `includeArchived&limit=50` response = **868 bytes**. Longest field across all rows: 160 chars                                              |

## Failures

None.

## Summary

15 of 15 criteria passed. The two properties that would most plausibly have been got wrong silently
— a dangling id handed to an agent that cannot then read it, and the 280-char multi-line
`body_excerpt` shipped as "a one-line excerpt" — are both correct, and I confirmed the second by
fetching the list's `excerpt` for the same document and watching it differ.
