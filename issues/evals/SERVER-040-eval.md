# Evaluation: SERVER-040

**Date**: 2026-07-31
**Sprint**: sprint-019 (Phase 7, Retrieval A)
**Evaluator model**: Opus 5 (1M context)
**Verdict**: PASS

Rig: workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/eval-p7/ws`, seeded by me from
scratch through the CLI only, server on port **8810**. From-source bin
`node --import <repo>/node_modules/tsx/dist/loader.mjs <repo>/apps/cli/src/bin/corpus.ts`, cwd
always outside the repository. `apps/server/dist` was absent, so `npm run build` was run once.
`8765` never bound, never killed, never proxied into. Server pid 7066, stopped; 8810/8811/8812/8765
all confirmed free at exit; `/Users/theophanerupin/code/corpus/.corpus` absent.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                                                    |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | `issues/server/040-search-endpoint-lexical.md:126+`, nine numbered sections, no placeholder text                                                                                          |
| Commands are specific and concrete      | PASS   | Exact `GET /api/search?…` URLs, verbatim JSON responses with real ids/snippets, `/usr/bin/grep -n` line numbers from the seeded files, byte counts                                        |
| Real E2E (not mocked)                   | PASS   | Real `corpus init --port 8804` workspace outside the repo, real server (pids 68837/71062/72450), real curl. Unit tests are cited *separately* and are not offered as the E2E evidence     |
| Scenarios cover acceptance criteria     | PASS   | Ranking, three kinds of heading address, disk verification, archived's three branches, filter parity, status codes, frugality measurement, TEST-724 spot check                            |
| Application restarted after changes     | PASS   | Three successive server pids, each `corpus server stop`ped before the next start                                                                                                          |
| Actual model recorded (implemented on:) | PASS   | "**Implemented on: opus** (Opus 5, 1M context)"                                                                                                                                          |
| Reproduction logged before fix (bugs)   | N/A    | Feature, not a bug; the log states so explicitly                                                                                                                                          |

I re-derived every substantive claim in a **different** workspace with **different** seed content.
Nothing in the log is unreproducible or overstated.

## Criteria Results

| #   | Criterion (sprint test)                                       | Result | Observed                                                                                                                                                                    |
| --- | ------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 673 | One hit per document, ranked by best passage                  | PASS   | A thread whose **title, preamble and four turns** all match `grumbolt` returns exactly **1** line. Same for `zorblatt` (2 matching turns → 1 hit)                            |
| 674 | Filters compose through one builder — parity with `/api/docs` | PASS   | 18 filters exercised, id-sets compared endpoint-to-endpoint; **18/18 identical** (table below)                                                                               |
| 675 | Archived rule is the list's rule, incl. the no-op             | PASS   | default excludes `doc_6gnkxaj4`; `--include-archived` unions it in; `--status archived` narrows to it alone; `--status archived --include-archived` is **byte-identical** to `--status archived` |
| 676 | Nested-section hit reports the full heading path              | PASS   | `Mortgage options › Rates › Rate lock`, verified against disk lines 20/35/39 with the match at line 45. A H1–H6 doc named all six levels in order                            |
| 677 | Hit with no heading above it reports the document title        | PASS   | A heading-free note returned `headingPath: "Unheaded jotting"` — the title                                                                                                    |
| 678 | Turn hit's path is the turn heading                           | PASS   | `agent · 2026-07-31T17:03:27Z`, exactly the file's line-16 H2, U+00B7 confirmed by `od -c`. A turn body containing its own `### Inner heading` did **not** append it         |
| 679 | Thread preamble hit is neither a turn nor a doc section        | PASS   | Standalone thread hit reported its **title** as the path and did not claim a turn's text                                                                                     |
| 680 | Headings inside fenced code are not headings                  | PASS   | The strongest form of this test: a ```` ```md ```` fence containing `# Fake heading in the rate lock section` sits **immediately above the matching line**. Path is still `… › Rates › Rate lock` |
| 682 | Snippet is one line, plain, no FTS control characters          | PASS   | Programmatic code-point scan over every hit: **0** occurrences of U+0002, U+0003, LF, CR. Longest snippet 84 chars                                                            |
| 683 | `q` required; degenerate query is empty, never 500             | PASS   | no `q` → 400 `query.q expected string, received undefined`; `q=***` → 200 `{"hits":[]}`; a 30-token query → empty, exit 0                                                     |
| 684 | Never a body, and the response size proves it                 | PASS   | Corpus contains a **104 KB** document. Whole `limit=50&includeArchived=true` response = **1053 bytes**. `doc show` of that one document = **106 649 bytes** (101×)            |
| 685 | Semantic-state field is inert                                 | PASS   | Envelope keys are `['hits']` only — `semanticIndex` **absent** on every Phase A response                                                                                      |
| 686 | Real server, real corpus, real curl                           | PASS   | This entire evaluation                                                                                                                                                       |
| —   | Limit cap enforced                                            | PASS   | 1–50 accepted; default **10** (proved with 14 candidates); 51/200/0/−1 → 400                                                                                                  |
| —   | Determinism                                                   | PASS   | Three identical `--json` calls, byte-identical                                                                                                                               |
| —   | Concurrency                                                   | PASS   | 10 simultaneous `/api/search` requests → 10× 200                                                                                                                             |

### Filter parity table (18/18 identical id sets)

`type note` · `type thread` · `type skill` · `tag finance` · `tag housing` · `folder finance` ·
`folder home` · `status open` · `status archived` · `includeArchived` · `parent <id>` ·
`references <id>` · `agent none` · `author user` · `since` · `stale` · `unread` · `needs form`
— every one produced the same id set through `GET /api/search?q=…` and `GET /api/docs?q=…`.

`--parent` and `--unread` returning non-thread documents is the **documented** thread-only no-op
(`docs/cli.md`: "the thread-only filters … no-op for other types rather than erroring"); a bogus
`parent` id correctly dropped the one thread from both endpoints. Not a defect.

### TEST-724 — `/api/docs` unchanged

`GET /api/docs?q=rate+lock+deadline&sort=relevance&limit=3` still ranks (same top-3 order as
`/api/search`) and still snippets (`snippets[].segments[]` with `match` flags intact).
`sort=relevance` without `q` still 400s. `pinned=true` → 200, `offset=2` → 200.

The list's `excerpt` is still the 280-char **multi-line** slice and the list's snippet segments still
contain `\n` — while `/api/search`'s snippet has neither. The SERVER-040 → CLI-019 seam holds: the
retrieval shape is genuinely a different, cleaner one, not a rename of the list's.

## Failures

None.

## Summary

16 of 16 criteria passed. The heading-path scanner is the part I tried hardest to break — deep
nesting, no headings at all, a separator glyph inside a heading, a turn with its own sub-headings,
and a fenced fake heading placed directly above the match — and it was correct in every case. The
frugality claim is not rhetoric: 1053 bytes of answer over a corpus holding a 104 KB document.
