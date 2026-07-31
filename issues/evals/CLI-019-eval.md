# Evaluation: CLI-019

**Date**: 2026-07-31
**Sprint**: sprint-019 (Phase 7, Retrieval A)
**Evaluator model**: Opus 5 (1M context)
**Verdict**: PASS

Rig: from-source bin `apps/cli/src/bin/corpus.ts` (tsx loader addressed by absolute path — `tsx`
does not resolve from a cwd outside the repo), workspace
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/eval-p7/ws` on port **8810**, plus a second
workspace on **8811** pointed at a Python stub for the states a Phase A server cannot produce.
`8765` never touched. All ports free at exit; no `.corpus` in the dev repo.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                       |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | `issues/cli/019-search-related-verbs.md:88+` — checks table, extraction proof, real-bin drill, byte table, stub drill, negative greps, cleanup               |
| Commands are specific and concrete      | PASS   | Real ids, real timestamps, real byte counts, `diff` hunk lists, two `shasum` values, exact error strings with exit codes                                     |
| Real E2E (not mocked)                   | PASS   | Real `corpus init --port 8807`, real server pid 9410, real bin. The stub is used **only** for the degraded-note states and is labelled as such, not passed off as the real server |
| Scenarios cover acceptance criteria     | PASS   | All four ACs plus TEST-699…711. Two items are explicitly **struck with substitute evidence** rather than quietly skipped                                     |
| Application restarted after changes     | PASS   | `npm run build -w apps/cli` before the drill; server started and stopped by recorded pid                                                                     |
| Actual model recorded (implemented on:) | PASS   | "**Implemented on: opus** (Opus 5, 2026-07-31…)"                                                                                                             |
| Reproduction logged before fix (bugs)   | N/A    | Feature, not a bug                                                                                                                                          |

The log volunteers two things a less honest one would have hidden: that it used port 8807 rather
than the sprint table's 8808 (and why), and that `check-generated-artifacts.ts` reported the CLI
reference **stale** because the agent commits nothing — with the invariant it *can* prove
(byte-identical regeneration) supplied instead. Both were true and both are now resolved: I ran
`node --import tsx scripts/check-generated-artifacts.ts` on the committed tree and it is
**green for both groups**.

## Criteria Results

### Acceptance criteria

| #   | Criterion                                                                | Result | Observed                                                                                                          |
| --- | ------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------- |
| 1   | One line per hit, padded columns, no bodies, no wrapping, stable order   | PASS   | See TEST-699/700 below                                                                                            |
| 2   | Filter flags shared with `doc list`; `--json` mirrors the wire           | PASS   | See TEST-701/702                                                                                                  |
| 3   | Empty result and unknown id per existing conventions                     | PASS   | See TEST-703/704                                                                                                  |
| 4   | Semantic-state note ONLY when the server flags degraded (silent Phase A) | PASS   | See TEST-705 — six states driven independently                                                                    |

### Sprint tests

| #   | Criterion                                        | Result | Observed                                                                                                                                                                          |
| --- | ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 699 | Ruled format (padded columns) implemented        | PASS   | `doc_h7atwbtz␠␠Mortgage options › Rates › Rate lock␠␠…snippet…` — house style, last column ragged. Identical shape in `doc related` (id, relation, excerpt)                       |
| 700 | One line per hit, fixed order, nothing else      | PASS   | 5 hits → 5 lines. No header, no blank lines, no tally. **And the CLI defends itself**: I drove it against a stub returning `"line one\nline two\ttabbed\nline three"` and it still printed **1** line, whitespace collapsed (`od -c` confirmed) |
| 701 | Filter flags one definition site, search subset  | PASS   | `search --help` declares all 15 shared filters with `doc list`'s wording verbatim. `--sort`, `--pinned`, `--offset` and `--q` **all rejected**: `unknown flag "--sort" for "search"` |
| 702 | `--json` is the global flag and mirrors the wire | PASS   | `search --json` and `doc related --json` are **byte-identical** to the corresponding `curl` responses. `--json` declared once globally, not per command                            |
| 703 | Empty results honest, exit 0                     | PASS   | `no documents match.` / `no related documents.`, both exit 0; `{"hits":[]}` / `{"related":[]}` under `--json`                                                                      |
| 704 | Unknown id → exit 5 on the shipped error path    | PASS   | `corpus: 404 not_found: no document with id doc_nope000`, **exit 5**; `{"error":{"code":"not_found",…}}` on stderr under `--json`, also exit 5                                     |
| 705 | Degraded note silent in Phase A                  | PASS   | Independently reproduced against my own stub across **six** states: absent → silent · `current` → silent · `indexing`/`stale`/`disabled` → `#`-prefixed note · `reticulating` (undefined) → note. Suppressed under `--json` in every case, where the state is a field |
| 706 | Registration clean                               | PASS   | `corpus search` top-level, `corpus doc related` under the `doc` topic; both in `--help`, both dispatch                                                                             |
| 707 | `docs/cli.md` regenerated, drift check green     | PASS   | `check-generated-artifacts.ts` → `✓ API contract is up to date` **and** `✓ CLI reference is up to date`, exit 0                                                                    |
| 708 | Thin client, no local logic                      | PASS   | Behaviourally: `--json` is a byte-for-byte passthrough, so nothing is filtered, re-ranked or truncated client-side. The only transformation is whitespace collapse for the one-line guarantee, which TEST-700 requires |
| 709 | The frugal claim, measured                       | PASS   | Byte table below                                                                                                                                                                  |
| 710 | Retrieval and reading as two separate acts       | PASS   | Full transcript below                                                                                                                                                             |
| 711 | Real server, real bin                            | PASS   | This evaluation                                                                                                                                                                   |
| —   | Limits                                           | PASS   | Default **10** (proved with 14 candidates), `--limit 50` → 14 rows, `--limit 51` → 400/exit 5, `--limit 0` → 400/exit 5. Same for `doc related`                                    |
| —   | Enum refusal is client-side                      | PASS   | `--status closed` → `--status must be one of: open, resolved, archived — got "closed".`, **exit 2**, no request sent                                                               |

### TEST-709 — the frugal claim, measured

Corpus contains a **104 KB** document (`data/docs/finance/lender-research.md`, 106 696 bytes).

| What                                            | Bytes       |
| ----------------------------------------------- | ----------- |
| `corpus search "rate lock deadline"` (5 hits)   | **642**     |
| `corpus search … --json`                        | 919         |
| `corpus doc list --q "rate lock deadline"`      | 442         |
| `corpus doc list --q … --json`                  | 5 588       |
| `corpus doc show doc_ipjv6ink` (the 104 KB doc) | **106 649** |

The list line is cheap but tells the agent nothing about *where* the match is, so the
enumerate-then-read path costs 442 + 106 649. Retrieval costs 642 and names the section. Across the
whole limit=50 wire response the **longest single field is 84 characters** — there is no path by
which a body arrives.

### TEST-710 / TEST-732 — the discipline chain, walked as the agent

```
$ corpus search "rate we agreed whole term"
doc_h7atwbtz  Mortgage options › Rates › Rate lock  …zorblatt assumption we agreed is 6.1 percent for the whole term.

$ corpus doc show doc_h7atwbtz        # <- the top hit id, read deliberately
Mortgage options
doc_h7atwbtz · note · open
data/docs/finance/mortgage-options.md
created 2026-07-31T16:53:44Z · updated 2026-07-31T16:53:44Z
tags finance, housing
anchors:
  anc_95c00991 → th_ulugyvit (open) · chars 503–536 · "The rate lock deadline is 30 June"

# Mortgage options
… (the body — printed by this command and no other)

$ corpus doc related doc_h7atwbtz     # <- expand from what we just read
doc_ipjv6ink  linked  # Lender research ## Background Detailed notes on the rate lock deadline…
doc_35d7cxp5  linked  # Kitchen quotes ## Cabinets Three quotes, none of which mention…
doc_7aq3opse  linked  # Survey timeline ## Booking The surveyor is booked for the week of 12 June…

$ corpus doc show doc_ipjv6ink        # <- follow one row
Lender research
doc_ipjv6ink · note · open
…
```

No directory listing, no file read, and **no document body before the deliberate `doc show`**.
Locating cost one line; reading was a separate command on a retrieved id.

## Failures

None.

## Observation (not a failure of this issue)

During the transcript run, `corpus doc show <104 KB doc> | head -6` once died with an unhandled
Node `EPIPE` and a stack trace instead of exiting quietly on a closed pipe. It did **not** reproduce
in 15 subsequent trials across `search`, `doc related`, `doc list` and `doc show`. It is in
`corpus doc show` (CLI-010's verb), not in either verb this issue ships, and it does not affect any
acceptance criterion. Recorded for the ledger, not held against CLI-019.

## Summary

18 of 18 criteria passed. Two findings I want to highlight because they were tested adversarially
rather than accepted on the log's word: the CLI's one-line guarantee survives a **misbehaving
server** that sends embedded newlines and tabs, and the degraded-ranking note is gated on
`!== "current"` rather than an exhaustive match — so a Phase B state the shipped CLI has never heard
of still reads as degraded instead of silently reading as fine.
