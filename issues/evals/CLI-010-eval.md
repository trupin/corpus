# Evaluation: CLI-010

**Date**: 2026-07-28
**Sprint**: sprint-013 (commit `01c997d`, branch `phase-4-agent-loop`)
**Verdict**: **PASS** (20 of 20 numbered criteria)

Driven against a real `corpus init` workspace on `9122` with a real server, using the from-source
binary `node --import tsx apps/cli/src/bin/corpus.ts` (never `npx`), compared against real `curl` on
the same ids. Fixtures were built through real interfaces (`corpus doc create`, `POST /api/threads`,
`corpus doc edit`, `corpus thread reply`).

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                  |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Per-test, with stdout blocks, `$?` values and `diff`/`jq` comparisons.                                 |
| Commands are specific and concrete      | PASS   | Real ids (`doc_wohrs5py`, `th_uwn3qix2`, …), real paths, real exit codes.                              |
| Real E2E (not mocked)                   | PASS   | Real workspace `/tmp/corpus-s013-cli010-uBLVKN`, real server `9097`, real binary from source.           |
| Scenarios cover acceptance criteria     | PASS   | TEST-31…50 all addressed, including the two Open-Conflict-10 negatives (47/48).                        |
| Application restarted after changes     | PASS   | Server started/stopped within the session (`stopped (pid 65891)`), ports re-verified free.             |
| Actual model recorded (implemented on:) | PASS   | "**Implemented on: opus** (cli-dev, 2026-07-28), worktree `agent-a946ccecf09f5df81`".                   |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue.                                                                                          |

Notable honesty: the log records that `--json` is emitted through `out.emit` exactly once, quotes the
**red** `check-generated-artifacts.ts` output verbatim with the reason (uncommitted artifact), and
discloses the Prettier-emphasis gotcha it had to work around.

## Criteria Results

| #   | Criterion                                     | Result                   | Notes                                                                                                                                                   |
| --- | --------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 31  | `corpus doc show <id>` exists, returns the doc | PASS                    | Exit 0; title, `id · type · status`, path, timestamps, tags, anchors block, body — all present.                                                          |
| 32  | `--json` is one JSON value, unreshaped         | PASS                    | Single line, `JSON.parse` ok; identical to `curl /api/docs/{id}` after key-order normalisation (deep compare `true`).                                     |
| 33  | Nullable timestamps render as `—`              | PASS                    | Skill doc with no `created`: `created — · updated 2026-07-29T05:06:28Z`; under `--json`, `created: null`. No invented date.                              |
| 34  | Anchors rendered with resolution state         | PASS                    | Resolved: `anc_d255a55e → th_aypnh46n (open) · chars 12–33 · "30-year fixed at 6.1%"`. After a real orphaning edit: `… · orphaned, its quote is no longer in the body · "…"`. Both states observed on the same document. |
| 35  | `corpus thread show <id>` with its turns       | PASS                    | Three turns, oldest first, each `author · ts`; `status`, `agent`, `parent`, `anchor` all shown.                                                          |
| 36  | `thread show --json` matches the endpoint      | PASS                    | Deep-equal to `curl /api/threads/{id}`; one JSON value.                                                                                                  |
| 37  | All three thread shapes render correctly       | PASS                    | `anchored to a selection` / `whole document` / `standalone`, with `parent —` and `anchor —` rendered honestly.                                           |
| 38  | A 404 exits **5**, not 4                       | PASS                    | `corpus doc show doc_zzzzzz` → `corpus: 404 not_found: no document with id doc_zzzzzz`, `$? = 5`; same for `thread show`.                                |
| 39  | Server down exits 4 with an actionable message | PASS                    | With the server stopped: `corpus: server not running for this workspace — run \`corpus server start\`` / `Nothing answered at http://127.0.0.1:9129.`, `$? = 4`. |
| 40  | Malformed id is a server 400 → exit 5          | PASS                    | `corpus doc show not-an-id` → `400 bad_request` with `param.id … pattern /^(doc|th)_[A-Za-z0-9]+$/`, `$? = 5`.                                            |
| 41  | Both verbs at all three help levels            | PASS                    | `corpus --help` lists both topics; `corpus doc --help` / `thread --help` list `show` first; `corpus doc show --help` renders summary, description, `Usage`, the `<id>` table, global flags and both examples — all registry-generated. |
| 42  | `docs/cli.md` regenerates with both entries    | PASS                    | ``### `corpus doc show` `` (line 498), ``### `corpus thread show` `` (line 1321), both in the TOC; two consecutive regenerations left sha `1eac5be6…` unchanged and `git status docs/cli.md` empty. |
| 43  | ≥1 example each; the `--json` one inlines shape | PASS                   | `doc show` carries a plain example and a `--json` example whose description contains the literal `{"frontmatter":{…},"body":…,"anchors":[…]}` skeleton. `validateRegistry` passes at module load (the CLI runs). |
| 44  | The verbs are thin clients                     | PASS                    | Zero `fetch(` and zero literal URLs in `commands/doc/show.ts` / `commands/thread/show.ts`; one `client.request` each; `hygiene.test.ts` green (12 tests) with only its pinned inventories extended. |
| 45  | `emit` is called exactly once                  | PASS                    | Success path: one JSON value, exit 0. Failure path under `--json`: one `{"error":{…}}` on stderr, exit 5 — never two values, never exit 1.               |
| 46  | No write path introduced                       | PASS                    | `git show --stat 01c997d`: doc/thread topic arrays, the two new modules + tests, `hygiene.test.ts`, `docs/cli.md`, the issue file, and `.claude/agents/cli-dev.md` (dev-harness note). No server, contract or UI file. Neither spec declares `--from`. |
| 47  | Read state is **not** invented                 | PASS                    | `thread show --json` has no `unread`, no `lastSeenTs` (verified programmatically on the live payload); no second call is made; the mutating `POST /api/threads/{id}/seen` is never hit. |
| 48  | `events` is not invented either                | PASS                    | No `events` key in the payload or the rendering; the issue file's stale "(turns, events, …)" text is corrected in place per Adjudication 14.             |
| 49  | Unit tests follow registry conventions         | PASS                    | Re-ran the log's exact selection: 141 tests green today (122 at the issue's commit; the delta is CLI-006's later additions to the same paths).           |
| 50  | E2E against the real binary, from source       | PASS                    | Reproduced independently on `9122`/`9129` with exact commands, stdout, `$?` and `curl` comparisons; servers stopped by the lifecycle verb; ports confirmed free. |

## Honesty Audit (claims re-derived by the evaluator)

| #   | Claim in the log                                                | Re-derived? | Finding                                                                                                       |
| --- | --------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| C1  | `doc show` header/anchors/body layout                           | Yes         | Byte-for-byte the same rendering shape on my own fixture.                                                      |
| C2  | Orphaned anchors render "orphaned, its quote is no longer in the body" | Yes  | Exact string reproduced after a real orphaning edit.                                                           |
| C3  | `--json` deep-equals `curl`                                     | Yes         | Deep compare `true` for both `doc show` and `thread show`.                                                     |
| C4  | `--json` is exactly one line / one value                        | Yes         | `wc -l` = 1, `JSON.parse` ok.                                                                                  |
| C5  | Null timestamps render `—` and stay `null` in JSON              | Yes         | Exact.                                                                                                          |
| C6  | The three thread shapes are named in the output                 | Yes         | Exact strings reproduced.                                                                                       |
| C7  | 404 → exit 5, 400 → exit 5, transport → exit 4                  | Yes         | All three reproduced from `$?`.                                                                                 |
| C8  | Help renders from the registry at all three levels              | Yes         | Reproduced, including the examples block.                                                                       |
| C9  | `docs/cli.md` regeneration is byte-identical                    | Yes         | sha `1eac5be6917343c1…` before and after two regenerations.                                                     |
| C10 | No `seen` call is ever made                                     | Yes         | Confirmed structurally (no `unread`/`lastSeenTs` in payload) and by the absence of any read-state in output.    |
| C11 | `hygiene.test.ts` passes with rules unamended                   | Yes         | 12 tests green; the guard was also shown to fire (see CLI-006 eval, TEST-111).                                  |
| C12 | Scope: no server/contract/UI file touched                       | Yes         | `git show --stat` confirms.                                                                                     |

One presentational note, not a defect: the log writes `curl -sS :9097/api/docs/…` (host-less URL).
With the curl on this machine that exact form is rejected (`URL rejected: No host part in the URL`);
the equivalent `http://127.0.0.1:<port>/…` form reproduces every quoted result. The outputs are real;
the command lines are abbreviated. Worth tightening in future logs so they are copy-pasteable.

## Failures

None.

## Summary

20 of 20. Both verbs are genuinely thin — the payload the server returned is what `--json` emits, and
the human rendering adds nothing that is not on the wire. The two Open-Conflict-10 traps (inventing
`events`, inventing read-state by calling the *mutating* `seen` endpoint) were avoided deliberately
and the issue text was corrected rather than implemented. Exit mapping matches the shipped table
(404/400 → 5, transport → 4), and the anchor rendering is exactly the context AGENT-003's comment
skill needs, including the orphaned case. **PASS.**
