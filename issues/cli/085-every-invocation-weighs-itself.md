# [CLI-085] Every invocation weighs itself

## Domain

cli

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: CONTRACT-097, SERVER-166; the SHARED-079 rider signed
- Blocks: UI-190 (nothing to plot until something reports)

## Spec References

- SPEC.md §2, §9 — the drafted telemetry rider (SHARED-079)

## Summary

The dispatcher measures every invocation and reports it fire-and-forget:

- **Wrote**: argv bytes (joined, as received) + stdin body bytes where a verb
  consumed stdin. **Read**: bytes written to stdout + stderr, counted at the
  output layer (`out.ts` is one funnel — verify and use it; if any verb
  writes past it, that is a finding to fix, not to work around).
- **Subjects**: the doc/thread ids the invocation resolved — from parsed
  args, not regex over argv. `batch` reports per entry, under the entry's own
  command path.
- **Fire-and-forget, after the work**: the report POSTs after the command's
  own output is flushed and the exit code decided. A failed/slow report
  never changes the outcome, never prints, never retries (SHARED-079's
  invariant: no verb's outcome may depend on the telemetry channel). Decide
  and record the mechanics honestly — a detached POST races process exit;
  options: await with a short cap (~50ms), or piggyback the next invocation
  (buffer under .corpus/). Measure the chosen shape's cost against CLI-058's
  bench and record it; the budget is ~5ms added latency.
- **Exclusions, recorded**: `--help` (no server), `corpus init`/`server`
  lifecycle (no workspace yet or server down), the telemetry POST itself
  (never self-reporting), `--json` and human mode both count.

## Acceptance Criteria

- [x] A `thread show` on a seeded thread produces one report whose readBytes
      matches `wc -c` of its output, subject = the thread id — E2E, real
      server, verified in the server's table
- [x] A dead server: every verb's behaviour and exit code byte-identical to
      today (assert the absence of any telemetry error surface)
- [x] `bench:startup` delta recorded, ≤ ~5ms
- [x] `batch` attributes per entry
- [x] `docs/cli.md` regenerated; a short help note under `corpus` names the
      measurement and its unit

## Decisions Recorded

**The report is awaited under a hard cap of 50 ms** (`REPORT_TIMEOUT_MS`,
`src/telemetry/report.ts`), not detached. Sprint-025 P5 inverted this issue's
filed premise: `bin/corpus.ts` sets `process.exitCode` and never calls
`process.exit()` on the normal path, so an un-awaited `fetch` holds the process
open until it settles. Detaching would not make the report free — it would make
its cost unbounded and unmeasurable. 50 ms is a third of one `corpus health`
(~143 ms), it bounds only the pathological case (a server that accepts and then
stalls), and the two ordinary outcomes cost far less: a refused loopback
connection is immediate, and a live server answers `204` without reading
anything.

**Measured latency: +4.0 ms**, against a ~5 ms budget. See the benchmark below.

**Attribution surface.** Subjects come from a declared `subject` marker on
`ArgSpec` and `FlagSpec`, checked by `validateRegistry` and pinned exhaustively
in `telemetry/subjects.test.ts`: 21 positional arguments and 8 flags across 26
verbs. A comma-separated marked value contributes each of its ids
(`--columns doc_a,doc_b`); a value that is not `doc_*`/`th_*` is dropped rather
than allowed to 400 the whole report; duplicates collapse; the list is capped at
the wire's `MAX_REPORT_SUBJECTS`.

**Exclusions** are a declared `measured: false` on the command — `corpus init`,
`corpus upgrade`, and the four `corpus server` lifecycle verbs.
`validateRegistry` refuses a `requiresWorkspace: false` command that does not
carry it, and `docs/cli.md` renders the exclusion from the same declaration.
`--help` and `--version` return before a report is composed, at every level.

**Two things measured but not attributed, stated rather than discovered.** A
`corpus batch` entry's `readBytes` is what it would have printed alone, so the
entries sum to **less** than the process's stdout — the batch's framing belongs
to no document. And `corpus doc delete`'s interactive confirmation prompt is the
one write past the output funnel (sprint-025 R3): `readline` owns the stream it
is given, the prompt is user-only, and `--from agent` is refused before any
request, so it is never on the agent's loop. `commands/hygiene.test.ts` names it
as the single exception and fails on any other.

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`).** Real `corpus` binary
(`apps/cli/dist/bin/corpus.js`, and the packaged bundle for the benchmark),
against a real server in a real workspace at `/tmp/corpus-e2e-085/ws`
(port 8768), 2026-09-06.

### 1. `thread show` — readBytes is `wc -c`, to the byte

```
$ corpus thread show th_v7z4qeny --json > out.json
$ wc -c < out.json
     334

$ curl -s -H "Authorization: Bearer …" \
    http://127.0.0.1:8768/api/docs/th_v7z4qeny/cost
{
  "granularity": "day",
  "sizeBytes": 255,
  "measuringSince": "2026-09-07T04:10:38.787Z",
  "buckets": [
    { "from": "2026-09-07T00:00:00.000Z", "to": "2026-09-08T00:00:00.000Z",
      "wroteTokens": 8, "readTokens": 84, "invocations": 1,
      "byCommand": { "thread show": 92 } }
  ],
  "total": 1, "truncated": false
}
```

`readTokens` 84 = `ceil(334 / 4)`. `wroteTokens` 8 = `ceil(30 / 4)`, and 30 is
`"thread show th_v7z4qeny --json"`. Command path is `thread show`, not the argv.
The ledger row confirms the bytes directly:

```
$ sqlite3 .corpus/cache.db "select command, subject, wrote_bytes, read_bytes from telemetry;"
thread show    th_v7z4qeny   30           334
```

### 2. wroteBytes counts the stdin body, in bytes

```
$ corpus thread reply th_v7z4qeny --from user --json <<'CORPUS_EOF' > reply.json
A reply body that is exactly measured, with a multi-byte character: é
CORPUS_EOF
$ wc -c < reply.json
     449

thread reply  th_v7z4qeny  114  449
```

114 = 43 (`"thread reply th_v7z4qeny --from user --json"`) + 71 (the body, 70
characters and 71 bytes — `é` counts as two).

### 3. Attribution, and the zero-subject cases

```
command        subject       wrote_bytes  read_bytes
doc list                     15           11492
doc create                   73           95        ← refused (--type required)
doc create                   85           534
thread create  doc_76niaygc  78           390       ← named in --parent
thread show    th_v7z4qeny   30           334
doc list                     15           12413
search                       19           360
doc show       doc_missing   20           55        ← an id naming nothing is kept
doc show                     8            84        ← usage error, no id bound
```

`corpus doc list` and `corpus search` report a **null** subject: neither names a
document, and neither lifted an id out of its own response. Re-reading
`doc_76niaygc`'s series after both ran showed it unchanged — one bucket, one
invocation, `byCommand: {"thread create": 118}`.

### 4. `batch` attributes per entry

```
$ corpus batch --json <<'CORPUS_EOF' > batch.json
[["doc","show","doc_76niaygc"],["thread","show","th_v7z4qeny"],["doc","related","doc_76niaygc"]]
CORPUS_EOF
$ wc -c < batch.json
    1480

doc show     doc_76niaygc  21  512
thread show  th_v7z4qeny   23  473
doc related  doc_76niaygc  24  275
```

Three reports, each under its own resolved command path with its own subject,
and no fourth row for `batch` itself. The entries' readBytes sum to 1260 against
the process's 1480: the 220-byte difference is the rules, the blank lines, the
closing summary and the JSON array framing, and it belongs to no document.
`wroteBytes` is each entry's own joined argv — the 95-byte JSON array on stdin
is charged to nobody.

### 5. A dead server changes nothing, and says nothing

`corpus server stop`, then every verb again:

```
--- corpus health (exit 4)
corpus: server not running for this workspace — run `corpus server start`
  Nothing answered at http://127.0.0.1:8768.
--- corpus doc show doc_76niaygc (exit 4)      identical text
--- corpus doc show doc_missing (exit 4)       identical text
--- corpus doc show (exit 2)                   missing required argument <id…>
--- corpus --help (exit 0)                     4234 bytes
--- corpus --version (exit 0)                  0.34.0

mentions of the telemetry channel: 0
```

`corpus doc show`, `--help` and `--version` are **byte-identical** to the same
runs against the live server (sha of stdout+stderr: `3c95c3985286`,
`268ccae35e1b`, `7e61ca21ccc3` in both arms). The four reachability failures are
the ordinary exit-4 message, unchanged. The grep for
`telemetr|/api/telemetry|invocation|report .*fail|cost report` matched exactly
one line in the whole sweep, and it was `corpus batch`'s pre-existing summary
("Run several commands in one invocation, with a per-command report."), not a
diagnostic. `corpus health` with nothing listening: 0.19 s, 0.20 s, 0.19 s
(`/usr/bin/time -p`) — a refused loopback connection costs nothing measurable.

### 6. The exclusions hold

```
rows before four lifecycle calls: 44
rows after:                       44
rows for server */init/upgrade/batch: 0
rows naming the channel itself:       0
```

`corpus init` and `corpus server start` ran before any of the above and left no
row either.

### 7. Broken pipe

```
$ corpus doc show doc_76niaygc | head -1
Cost probe
pipeline exit: 0

$ corpus doc show doc_76niaygc --json | head -c 40
{"frontmatter":{"id":"doc_76niaygc","typ
exit: 0
```

Exit 0 and silent, unchanged. The reported figure is **delivered** bytes: the
kernel accepted the whole write before `head` exited, so the report says 512
rather than the 40 the reader consumed. Whether a report survives the guard's
`process.exit(0)` is deliberately not asserted — that loss is intended.

### 8. `bench:startup` — the A/B, run once each, alone

The shipping bundle (`npm run package:build`) against a copy of the same bundle
with `sendInvocationReports` patched to return before it builds a request. Same
module graph, same seam, same subject extraction, same report composed and
dropped — so the difference is the POST and nothing else. 25 runs each, minimum
reported, warm server, no other load.

```
                                        baseline   with telemetry   delta
Node boot                                41.5 ms       42.4 ms      +0.9
module graph (bundle parse + imports)    68.0 ms       67.6 ms      −0.4
workspace, client, one round trip        29.9 ms       33.3 ms      +3.4
TOTAL, one `corpus health`              139.3 ms      143.3 ms      +4.0
```

**+4.0 ms, inside the ~5 ms budget.** The module-graph phase did not move, which
is the second thing worth recording: no new package reached the startup path
(`startup-cost.test.ts` still pins exactly three, unchanged). The whole delta is
in the last phase, where the report is.

### 9. Checks

- `npm run typecheck -w apps/cli` — clean.
- `npx eslint apps/cli` — no issues, no suppressions added.
- `npx prettier --check apps/cli docs/cli.md` — clean.
- `npm test -w apps/cli` — **120 files, 2529 tests, all passing** (2465 before,
  64 added).
- `npm run docs:cli -w apps/cli` — regenerated; `docs/generate.test.ts`'s
  committed-file comparison passes.

### 10. Not verified here

The server-side half is SERVER-166's: retention, `db rebuild` emptying the
series, and survival across a restart were not re-exercised. The UI panel does
not exist yet (UI-190).
