# Evaluation: CLI-020

**Date**: 2026-08-01
**Sprint**: sprint-021
**Evaluator model**: Opus 5 (1M context)
**Verdict**: PASS

Everything below was run through `apps/cli/src/bin/corpus.ts` against the real server on port 8808.

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Every state rendered, error paths, help at three levels |
| Commands are specific and concrete | PASS | `/usr/bin/time -p` on the rebuild verb, exact block renders, exit codes |
| Real E2E (not mocked) | PASS | Real bin, real server, a real slow fixture endpoint on 8816 to force `indexing`/`stale` |
| Scenarios cover acceptance criteria | PASS | All three, with the voided one corrected in the log rather than implemented |
| Application restarted after changes | PASS | Restarts per state |
| Actual model recorded (implemented on:) | PASS | "implemented on: opus (Opus 5, 1M context)" |
| Reproduction logged before fix (bugs) | N/A | Feature issue |

Nice touch that is also a proof of provenance: the log records that the globally installed `corpus`
answered `unknown command "index"`, which is how you know the verbs under test came from the working
tree. I hit the same thing.

## Criteria Results

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| 1 | Status output compact and stable-ordered; `--json` passthrough | PASS | Six rows, fixed order, in all four states; `--json` emits exactly one line and no human line |
| 2 | Rebuild returns immediately with an acknowledgment; no watch loop | PASS | 0.45 s wall (≈0.25 s of it `tsx` startup) against a 16 s drain |
| 3 | ~~Exact wording per state~~ **VOID (C15)** → note fires for the three non-`current` values, silent on `current` and absent | PASS | Verified for `indexing`, `stale`, `disabled` on both `search` and `doc related` |

### Criterion 1 — all four states through the human render

```
current                          indexing                          stale
identity   local/all-MiniLM…@384 identity   local/all-MiniLM…@384  identity   local/all-MiniLM…@384
indexed    80                    indexed    177                    indexed    580
pending    0                     pending    384                    pending    1
failed     0                     failed     0                      failed     0
rebuilding no                    rebuilding yes                    rebuilding no
state      current               state      indexing               state      stale

disabled (dead configured provider — note the counts are NOT zeroed)
identity   local/all-MiniLM-L6-v2@384
indexed    561
pending    0
failed     0
rebuilding no
state      disabled
```

Six fields, same order, every time. A null identity renders as `none recorded yet`, never `null` or
`undefined` (observed on the wire as `"identity":null` in the same instant).

`--json` is raw passthrough:

```
$ corpus index status --json | wc -l          → 1
$ corpus index status --json | grep -c "^#"   → 0
{"indexed":581,"pending":0,"failed":0,"identity":"local/all-MiniLM-L6-v2@384","rebuilding":false,"state":"current"}
```

Exit code is **0** in all four states — `disabled` is an answer, not a failure.

### Criterion 2 — rebuild acknowledges and returns

```
$ corpus index rebuild
queued a full rebuild of the semantic index — 561 chunks to embed, identity not yet recorded, state indexing.
it runs in the background — watch it with `corpus index status`.
rebuild verb wall time: 0.45s
```

The drain that call started took **16.3 s**. No progress output, no spinner, no second request. The
acknowledgment reports only what was true at the call (561 queued, identity not yet re-picked,
`indexing`) — which matched the `202` body byte for byte.

Fired twice back-to-back: both acknowledged, no error, converged to one rebuild in flight.

### Criterion 3 — the degraded note

```
$ corpus search "physician prescribed antibiotics"            # state: disabled
# ranking is degraded — the semantic index is "disabled" (SPEC.md §9.1); these results are ranked on the lexical half alone.
doc_evalphys01  Consultation  ## Consultation A physician evaluated the patient and prescribed…

$ corpus doc related doc_evalphys01                            # same moment — both rankings degrade together
# ranking is degraded — the semantic index is "disabled" (SPEC.md §9.1); these results are ranked on the lexical half alone.
doc_evaldoct01  linked  ## Visit The doctor examined a sick man, …
```

Same single generic line for `indexing` and `stale` (observed against those real wire values), **no
note at all** for `current`, and the note is absent under `--json` (0 lines starting with `#`,
exactly 1 line of output). It is one line, starts with `# `, and contains no embedded newline.

Note that `related` degraded from `both` to `linked` in the same run — the note is not cosmetic; the
semantic half genuinely stopped contributing.

### Error paths and help

```
$ corpus search ""                    → 400 bad_request, "Too small: expected string to have >=1 characters", exit=5
$ corpus index status  (server down)  → "server not running for this workspace — run `corpus server start`", exit=4
$ corpus index status  (bad token)    → 401 unauthorized, exit=5
$ corpus --help                       → lists `index   Inspect and rebuild the semantic index.`
$ corpus index --help                 → topic description + both verbs
$ corpus index rebuild --help         → description, usage, examples, all from the registry
```

## Failures

None.

## Observations (not failures)

- **O-1.** `corpus index status` shows nothing while the model is downloading — six fields and
  `state: disabled`. That is faithful to the payload the server sends, so it is not this issue's
  defect; it is recorded as SERVER-048 FAIL-1. If a progress field is ever added, this verb is where
  it must render.
- **O-2.** `corpus index rebuild` discards a complete, valid index with no confirmation, including
  when the configured provider is unreachable and it therefore cannot be rebuilt. Per §9.1 that is
  what the verb does, and it is an explicit act — recorded because a `--yes`-style guard is the sort
  of thing that gets asked for after the first accident.

## Summary

3 of 3 criteria pass. Two thin typed-client verbs, a stable six-row block in all four states, `--json`
that is genuinely one raw line with no human output, a rebuild that returns in 0.45 s against a 16 s
drain, and CLI-019's generic degraded note left deliberately untouched per C15.
