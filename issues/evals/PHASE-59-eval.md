# Evaluation: PHASE-59 (CONTRACT-097 · SERVER-166 · CLI-085 · UI-190)

**Date**: 2026-09-07
**Sprint**: sprint-025 — "A document shows what it costs"
**Spec**: SPEC.md §9.4 (rider signed 2026-09-06)
**Verdict**: PASS (first pass PARTIAL; re-tested after the FAIL-1 fix,
commit `8011c066`)

Everything the batch claims about measurement, the channel, the ledger's
lifecycle, the panel and the published unit reproduces against the real
product.

The first pass found one statement in §9.4 that did not: what the caller wrote
was counted only when it arrived through argv or stdin, so the same body was
measured 12× smaller when passed with `--file` or `--flag-file`. The ruling was
reversed and the fix re-tested on a rebuilt product against a fresh workspace.
**A body now weighs the same however it arrives** — see "Claim 1, re-test".

## How this was tested

Real product only. No source file was read.

- `npm run build` (exit 0), then the built CLI at
  `apps/cli/dist/bin/corpus.js` (`corpus 0.34.0`).
- A real workspace made by `corpus init` at
  `…/scratchpad/ws`, port moved to **8791** (8765 untouched), server started
  and stopped with `corpus server start` / `stop`.
- Every API read over HTTP with the workspace token, against the running
  server.
- The browser half in **real Chromium (Playwright, headless)** against the
  **server-served production UI** at `http://127.0.0.1:8791` — not the Vite
  stub the e2e suite uses. Documents were opened the way a user opens them,
  through ⌘K search.
- A second throwaway workspace (`ws3`, port 8793) for the never-measured
  state, and a stalling TCP listener (8792) for the hang probe. Both gone.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                                             |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | All four issues carry a filled log, none placeholder.                                                                                                                             |
| Commands are specific and concrete      | PASS   | Exact argv, `wc -c` figures, curl responses, sqlite rows, benchmark tables.                                                                                                       |
| Real E2E (not mocked)                   | PASS   | Real `corpus init` workspaces, real servers (8767/8768), real curl, real Chromium. UI-190 states plainly that Playwright covers rendering only and that the numbers were hand-checked. |
| Scenarios cover acceptance criteria     | PASS   | Each criterion has matching evidence.                                                                                                                                             |
| Application restarted after changes     | PASS   | SERVER-166 exercises stop/start and rebuild; CLI-085 ran the packaged bundle.                                                                                                     |
| Actual model recorded (implemented on:) | PASS   | All four state Opus 5 (`claude-opus-5[1m]`).                                                                                                                                      |
| Reproduction logged before fix (bugs)   | N/A    | Feature work, no bugs.                                                                                                                                                            |

Two log statements I could not reproduce on the first pass: SERVER-166's
`measuringSince: null` after `corpus db rebuild` (§3, OBS-1, still stands), and
CLI-085's `wroteBytes` claim as it met `--file` / `--flag-file` (FAIL-1, now
fixed and re-verified).

## Criteria Results

| #   | Claim                                                               | Result  | Evidence                                                                                                                        |
| --- | ------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Measurement happens and is right                                    | PASS    | Four enumerated checks pass to the byte. FAIL-1 (payload file flags uncounted) fixed in `8011c066` and re-verified.              |
| 1e  | a body weighs the same however it arrives                           | PASS    | Same 2160 B body: 2340 B via `--flag-file`, 2203 B via stdin — the 137 B gap is exactly the argv path's width.                   |
| 1a  | read-bytes equal `wc -c` on what was seen                           | PASS    | `doc show --json` 549 B → 138 tokens; `thread show` 331 B → 83; `doc list` 13551 B → 3388; `search` 432 B → 108.                 |
| 1b  | tokens are `ceil(bytes/4)`                                          | PASS    | Every figure checked by hand reproduces `Math.ceil`; 549/4 = 137.25 → 138.                                                       |
| 1c  | attribution is only the ids the invocation named                    | PASS    | `search` and bare `doc list` change no document's series; ids from responses are never lifted; flags attribute.                  |
| 1d  | a batch reports per entry                                           | PASS    | 3 entries → 3 reports, own command path and own subject, no `batch` row.                                                         |
| 2   | The channel is free                                                 | PASS    | Server-independent verbs byte-identical dead vs live, same exit codes, zero telemetry mentions, no invocation over 0.22 s.       |
| 3   | The ledger's lifecycle                                              | PASS    | Survives stop/start; `db rebuild` empties it; `db doctor` clean in both states; 90-day retention prunes at boot. OBS-1 attached. |
| 4   | The panel                                                           | PASS    | Real browser, real server-served UI: series, size line, breakdown sums, honest empty state, thread's own series, no roll-up.     |
| 5   | The unit is reproducible                                            | PASS    | `corpus --help` and the panel state the same rule: 4 bytes to a token, rounded up.                                               |

## Claim 1 — measurement happens and is right

Verified against the real ledger, read back over `GET /api/docs/{id}/cost`.

**Read bytes are `wc -c`, exactly.** `corpus doc show doc_l4skpyyr --json >
show1.json` printed **549** bytes and the series answered `readTokens: 138` =
`ceil(549/4)`. `corpus thread show th_c4ink4br --json` printed **331** bytes →
83. Human mode counts the same way: a 268-byte human `doc show` and a 549-byte
JSON one sum to `byCommand["doc show"] = 218` = 138+7+67+6, argv included.

**Written bytes count argv and stdin, in bytes not characters.** A heredoc body
of 54 bytes / 46 characters through stdin:
`wroteTokens = ceil(43 + 54)/4) = 25`, matching the ledger row exactly.

**`byCommand` sums to the bucket total in every bucket.** Across a seven-bucket
series, every bucket satisfied `Σ byCommand == wroteTokens + readTokens`.

**Attribution names only what the invocation named.**

| invocation                            | series it entered                              |
| ------------------------------------- | ---------------------------------------------- |
| `doc show doc_l4skpyyr`               | alpha                                          |
| `thread create --parent doc_l4skpyyr` | alpha (flag), **not** the thread it created    |
| `thread show th_c4ink4br`             | the thread only                                |
| `doc list --parent doc_l4skpyyr`      | alpha (flag)                                   |
| `search "alpha"`                      | none — null subject row                        |
| `doc list` (bare)                     | none — null subject row                        |
| `health`                              | none — null subject row                        |

Before and after `search` and bare `doc list`, the invocation count of all 17
documents was unchanged, though both returned matching ids in their output.

**Batch.** `[["doc","show",beta],["thread","show",th],["doc","show",alpha]]`
produced exactly three reports, one per entry under its own command path and
subject, and no row for `batch`. Entry read-bytes summed to less than the
process's 1730-byte stdout, as P8 predicts.

**Repeats do not double count.** Five identical `doc show` runs → exactly five
invocations.

## Claim 2 — the channel is free

`corpus server stop`, then the same six invocations:

| verb                     | live       | dead                 | identical?             |
| ------------------------ | ---------- | -------------------- | ---------------------- |
| `--help`                 | exit 0     | exit 0, 0.191 s      | stdout+stderr IDENTICAL |
| `--version`              | exit 0     | exit 0, 0.183 s      | IDENTICAL              |
| `doc show` (missing arg) | exit 2     | exit 2, 0.209 s      | IDENTICAL              |
| `--from nobody`          | exit 2     | exit 2, 0.217 s      | IDENTICAL              |
| `doc show <id>`          | exit 0     | exit 4, 0.212 s      | ordinary exit-4 text   |
| `doc show <missing id>`  | exit 5     | exit 4, 0.219 s      | ordinary exit-4 text   |

A grep for `telemetr|invocation report|cost report|failed to report|
/api/telemetry` over every dead-server stdout and stderr: **zero matches**.

**No hang.** Against a listener that accepts and never answers (port 8792),
`doc show --timeout 500` returned in **0.794 s** and `--timeout 1500` in
**1.809 s** — the 1.015 s delta is the verb's own timeout, so the report adds
well under 100 ms and is bounded. Live-server `corpus health` is 0.20 s over
five runs, the same as the dead-server runs.

**Broken pipe.** `corpus doc show <id> | head -1` exits 0 and silently, in
human and `--json` mode.

## Claim 3 — the ledger's lifecycle

| step                                   | alpha's series                | `measuringSince`           | `db doctor`                        |
| -------------------------------------- | ----------------------------- | -------------------------- | ---------------------------------- |
| after real usage                       | 5 invocations                 | `2026-09-07T07:42:16.353Z` | `projection is clean — 17 documents` |
| after `server stop` + `server start`   | **unchanged**, 7 buckets      | unchanged                  | clean                              |
| after `corpus db rebuild`              | **empty** — 0 buckets, total 0 | see OBS-1                  | clean                              |
| 100-day-old row + restart              | pruned, 7 recent buckets kept | unchanged                  | clean                              |

`db doctor --json` in both states: `{"ok":true,"drift":[],"warnings":[]}`, and
the word "telemetry" appears nowhere in its output.

Error paths on both routes: 400 on a neither-form body (naming the field), 400
on malformed JSON, 400 on a negative byte count, 400 on a malformed id, 400 on
`limit=0`, 404 on an unknown id, 401 unauthenticated on both routes, 204 with an
empty body on success. `?limit=2` on a seven-bucket series returned the two
**newest** buckets with `total: 7, truncated: true`.

## Claim 4 — the panel

Real Chromium against the server-served UI. Zero page errors and zero console
errors across every drive.

**The figures match the server and the disk.** Alpha, opened through search:

| panel                                        | server / disk                                        |
| -------------------------------------------- | ---------------------------------------------------- |
| `read 3,404` · `wrote 209`                   | series totals 3404 / 209                             |
| `3,613 tokens over 7 daily buckets`          | 3404 + 209 = 3613, `total: 7`, `granularity: "day"`   |
| `current size 1,329`                         | `sizeBytes: 5316` = `wc -c` on the file; ceil/4 = 1329 |
| bars `data-tokens` 303/14 … 1720/77          | identical per-bucket figures, in order                |
| `Measuring since 2026-09-07`                 | `measuringSince: 2026-09-07T08:03:00.943Z`           |

**The breakdown sums.** `corpus doc edit 1,865` · `corpus doc show 1,484` ·
`corpus thread show 169` · `corpus doc related 95` · `total 3,613` — equal to
the window total and to the server's own `byCommand`.

**The empty state is honest.** A document never named by a verb renders
`.cost` with **no chart at all** (`.cost-chart` count 0) and the text: "No
measurements for this document. This workspace has been measuring since
2026-09-07 — nothing in that time has named this document." No zero series, no
flat line at zero.

**A thread answers its own series.** `th_c4ink4br` showed `thread reply 1,820` ·
`thread show 122` · `total 1,942`, against its own `sizeBytes` 4603 (= `wc -c`
on `data/threads/th_c4ink4br.md`) shown as `current size 1,151`. Its parent's
panel carries none of those figures — **no roll-up**.

**Placement.** With the console expanded and its tabs walked, `.cost` inside
`.console-body` / `.console` counted **0**, while the reader's panel stayed
present. Full screen renders the panel from the same call site.

**Subjective grading** (threshold: average ≥ 3, no score of 1):

| rubric        | score | note                                                                                                    |
| ------------- | ----- | ------------------------------------------------------------------------------------------------------- |
| Design        | 4     | Hand-rolled SVG that reads as part of the product: monospace labels, restrained two-colour stacked bars. |
| Originality   | 4     | No chart library, no template look; the dashed present-tense size line is a deliberate, unusual choice.  |
| Craft         | 4     | Axis, legend, caption and table align; the caption states what the dashed line is and is not.            |
| Functionality | 4     | The question it answers is legible at a glance, and the breakdown is one disclosure away.                |

Average **4.0** — pass.

## Claim 1, re-test — a body weighs the same however it arrives

**FAIL-1 is fixed and closed.** Re-tested 2026-09-07 against commit `8011c066`
after `npm run build` (exit 0), in a **fresh** `corpus init` workspace on port
8794, with the built CLI. Only this half was re-run — the other four verdicts
stand on the first pass.

**The identical 2160-byte body, three ways into the same thread:**

```
command       subject       wrote_bytes  read_bytes
thread reply  th_xnwfoshg   2340         2538    ← --flag-file message=<file>
thread reply  th_xnwfoshg   313          648     ← stdin heredoc (270 B body)
thread reply  th_xnwfoshg   2203         2538    ← stdin, same 2160 B file
```

`2340 = 180 + 2160` and `2203 = 43 + 2160`: both arms count the body in full and
identically. The whole 137-byte gap between them is the argv width of
`--flag-file message=<path>` against a bare `--json`, computed independently:

```
arm1 argv bytes: 180   arm2 argv bytes: 43   difference: 137
```

**A document body handed over in a file is counted.** A 4885-byte body:

```
command    subject        wrote_bytes  read_bytes
doc edit   doc_ulgntomc   5107         5531    ← --file  (222 argv + 4885)
doc edit   doc_ulgntomc   4988         5531    ← -m literal (103 argv + 4885)
```

The same body priced within an argv path's width whether it arrives by `--file`
or inline on argv.

**The fix generalises past the two verbs in the report.** `doc create --file`
recorded `5057 = 172 + 4885`, and `--flag-file` on a non-body flag counts too —
`doc create --flag-file title=<24 B file>` recorded `203 = 179 + 24`. A body
passed inline (`-m "Seed body."`) still records argv only, at 65 B, which is
correct — the body is already in argv.

**Confirmed through the public API, not only the ledger.** Every bucket still
satisfies `Σ byCommand == wroteTokens + readTokens`, and the published figures
equal the conversion applied by hand to the raw rows:

```
document 2026-09-07: wrote=2558 read=4356 inv=5
  byCommand {'doc edit': 5290, 'doc show': 1508, 'thread create': 116}  sum_ok=True
thread   2026-09-07: wrote=1214 read=1431 inv=3
  byCommand {'thread reply': 2645}                                      sum_ok=True

doc edit     raw: wrote 10095 read 11062 -> ceil/4 + ceil/4 = 5290  ✓
thread reply raw: wrote 4856  read 5724  -> ceil/4 + ceil/4 = 2645  ✓
```

Read-side accounting is unchanged: `read_bytes` 2538 equals `wc -c` on the
reply's own stdout.

**Verdict on claim 1: PASS.**

## Failures

_None outstanding. FAIL-1 below is kept for the record and is **RESOLVED**._

### FAIL-1 (RESOLVED in `8011c066`): a body passed with `--file` or `--flag-file` was not counted as written

**Criterion**: SPEC.md §9.4 — "Every `corpus` invocation reports … the size of
what the caller wrote and what the command printed."
**Severity**: MAJOR.

**Expected**: the bytes the caller wrote into the document or turn are counted,
however the caller handed them over.

**Observed**: only argv and stdin are counted. The identical 2100-byte reply
body is measured as **182 bytes** through `--flag-file` and **2143 bytes**
through stdin — the same write, 12× apart. A 5107-byte document body written
with `--file` was measured as its 224-byte argv.

Ledger rows, read back from the running workspace:

```
command       subject       wrote_bytes  read_bytes
doc edit      doc_l4skpyyr  224          5712    ← --file body of 5107 B uncounted
thread reply  th_c4ink4br   182          2475    ← --flag-file body of 2100 B uncounted
thread reply  th_c4ink4br   2143         2475    ← same 2100 B body, via stdin, counted
```

Confirmed independently through the public API: the panel's `byCommand` for
`thread reply` moved by 665 tokens for the `--flag-file` arm and by 1155 for the
identical stdin arm.

This matters beyond bookkeeping. The panel exists to answer "is working with
this document getting more expensive?", and an agent that switches from stdin
to `--flag-file` halves its recorded cost while doing identical work. `corpus
--help` actively steers callers to that flag for the largest payloads: "**Use
it for words somebody else wrote.**" `--flag-file` is also the CLI's own
injection-safe path, so the safest way to write is the least measured one.

**Steps to reproduce**:

1. `corpus init` a workspace and `corpus server start`.
2. Create a document and a thread on it.
3. `python3 -c "open('/tmp/body.txt','w').write('A reply. ' * 240)"` (2100 B).
4. `corpus thread reply <th_id> --from user --flag-file message=/tmp/body.txt --json`
5. `corpus thread reply <th_id> --from user --json < /tmp/body.txt`
6. `GET /api/docs/<th_id>/cost` — the two invocations differ by ~490 tokens in
   `wroteTokens`, although the caller wrote the same 2100 bytes twice.

**Note on scope**: sprint-025's TEST-1198 pinned `wroteBytes` to "argv plus the
stdin body" and said nothing about `--file`/`--flag-file`, so the batch met its
own contract. The spec sentence is broader than the contract, and the spec is
what this evaluation compares against. The ruling was reversed rather than the
finding waived.

**Fix verified**: see "Claim 1, re-test" above. Re-running the reproduction
steps against `8011c066` now yields `2340` and `2203` wrote-bytes for the two
arms — a 137-byte difference that is exactly the argv path's width, not a
12-fold one.

## Observations (not failures)

**OBS-1 — `measuringSince` is not `null` after `corpus db rebuild`.**
SERVER-166's log tabulates `measuringSince: null` after a rebuild. In the real
product it is not, because `db rebuild` is itself a measured verb: it wipes the
ledger, then its own fire-and-forget report lands and re-stamps the meta row.
Read one second after `corpus db rebuild`, with no other command in between:
`measuringSince: '2026-09-07T08:03:00.943Z'`, `buckets: 0`, `total: 0`. The
document series **is** empty, which is what §9.4 requires, and the stamp is
truthful — one row was ingested at that instant. The never-measured state is
real and reachable: a fresh workspace where only `corpus init` and
`corpus server start` had run answered `measuringSince: None`. Only the issue
log's table is wrong, and only for a reader who does not beat the rebuild's own
report.

**OBS-2 — the panel's truncation notice cannot be reached with defaults.**
Retention keeps 90 days and the series cap is 180 buckets, so `truncated` is
structurally false in normal use. The flag itself works (`?limit=2` → newest 2
of 7, `truncated: true`), but the panel's truncation copy is unreachable
end-to-end through the shipped product. Not a defect against any criterion —
recorded so nobody counts it as verified.

## Summary

**5 of 5 claims PASS.** The chain works end to end in the real product: the CLI
measures every invocation to the byte, the server keeps the ledger as runtime
state that survives a restart and dies with a rebuild, the doctor stays quiet
about it, a dead or stalling server changes no verb's output or exit code by a
single byte, and the panel draws real numbers that reconcile with `wc -c` and
with the server's own `byCommand`.

The first pass found one real gap — §9.4's "what the caller wrote" counted only
through argv and stdin, so the two flags the CLI recommends for large, quoted or
untrusted text wrote into documents for free. `8011c066` reversed that ruling.
Re-tested on a rebuilt product in a fresh workspace, **a body weighs the same
however it arrives**: identical bodies now differ only by the argv width of the
path that named them.

Two observations stand and neither blocks the release: `measuringSince` is not
`null` after a CLI-driven `db rebuild` (OBS-1 — the rebuild's own report
re-stamps it, truthfully), and the panel's truncation copy is unreachable with
default settings (OBS-2).
