# Evaluation: CLI-021

**Date**: 2026-08-02
**Sprint**: sprint-022
**Verdict**: PASS
**Evaluator model**: Opus 5 (1M context)

Rig: workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/eval-p9/ws`, server `8808`,
verb driven through `node --import tsx apps/cli/src/bin/corpus.ts`. Evaluator-composed fixtures.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                    |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | `issues/cli/021-thread-context-verb.md:49-237`                                              |
| Commands are specific and concrete      | PASS   | Every shape pasted as real rendered output with real ids; `awk`/`diff` against disk         |
| Real E2E (not mocked)                   | PASS   | Built bin against a real server on 8806, real `doc edit`/`doc delete` producing the states  |
| Scenarios cover acceptance criteria     | PASS   | Five shapes, `--json`, truncation, 404/exit codes                                           |
| Application restarted after changes     | PASS   | `corpus init … --port 8806`, `index rebuild` to `state current`, server stopped, `lsof` clean |
| Actual model recorded (implemented on:) | PASS   | `implemented on: opus` (Opus 5, 1M context), 2026-08-02                                     |
| Reproduction logged before fix (bugs)   | N/A    | Feature                                                                                     |

Deferrals are declared with reasons (`no assets/workspace/ edit`, `npm run e2e` not run, no SPEC
edit). All three are correct scope calls.

## Criteria Results

| #   | Criterion                                                          | Result | Observed                                                                     |
| --- | ------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------ |
| 1   | All five pack shapes render legibly                                | PASS   | Five distinct renderings, exit 0 each; standalone opens directly at the excerpt marker with no empty parent block |
| 2   | Related lines built from the existing formatters; `search`/`doc related` byte-identical | PASS | Four aligned columns `id · headingPath · relation · excerpt`; `corpus search` and `corpus doc related` output shape unchanged in live use |
| 3   | 404 and error paths per existing verb conventions                  | PASS   | Exit 2 usage, exit 5 server response, exit 4 unreachable — all observed        |

## Evidence

### AC 1 — the five shapes, through the real bin

```
$ corpus thread context th_wl7djw23                                  [exit 0]  (anchored)
parent doc_gt2cvtta · Greenhouse plan · Greenhouse plan › Watering

> drip lines deliver water to each seedling tray every morning

## Watering

The drip lines deliver water to each seedling tray every morning. Compost choice matters here too — see [[doc_7svpaawn]].

A second paragraph inside the watering section, so the anchor is not the whole of it.

# related excerpts
doc_7svpaawn   Potting compost mix            linked   # Potting compost mix Two parts loam, …
doc_tubbza3k   Dawn misting for nursery beds  similar  # Dawn misting for nursery beds Automated sprinkler timers…
…
```

```
$ corpus thread context th_mso6oy65                                  [exit 0]  (whole-document)
parent doc_gt2cvtta · Greenhouse plan

# Greenhouse plan

Opening preamble that sits above the first heading of the greenhouse plan.

# related excerpts
…
```

```
$ corpus thread context th_w26ri26o                                  [exit 0]  (standalone)
# related excerpts
doc_calc3teb  Cold frame notes  similar  # Cold frame notes That phrase has been rewritten…
…                                        ← no parent block, no leading blank, no empty heading
```

```
$ corpus thread context th_g5xm7da6                                  [exit 0]  (orphaned-anchor)
parent doc_calc3teb · Cold frame notes
the anchor no longer resolves in the parent (SPEC.md §6); the quote the thread was opened on is preserved below, and where that text went is not guessed at:

> THE ANCHOR PHRASE LIVES HERE
…
```

```
$ corpus thread context th_sgtlpn3t                                  [exit 0]  (parent-deleted)
parent doc_dnrhd6n6 was deleted; this conversation outlived it, so there is no parent content to show (SPEC.md §9.2).

# related excerpts
…
```

Neither the orphan nor the deletion was staged: `corpus doc edit doc_calc3teb` reported
`1 orphaned (th_g5xm7da6) — warning: orphaned_anchor` and `corpus doc delete doc_dnrhd6n6` reported
`orphaned 1 thread (th_sgtlpn3t)` before these packs were read.

### The truncation indicator names the escalation, and the escalation works

An 12,044-byte document whose single `## Long` section runs far past the section cap, anchored deep
inside it:

```
$ corpus thread context th_3iwyjeyu                                  [exit 0]
parent doc_ievftcgl · Long section doc · Long section doc › Long

> THE DEEP ANCHOR PHRASE SITS HERE
…
# the parent text above was cut to fit the pack's bounds — read all of it with: corpus doc show doc_ievftcgl

# related excerpts
…
$ --json: section chars: 4000 | truncated: true | quote offset in section: 1984
$ corpus doc show doc_ievftcgl | wc -c
   12303                                    ← the named escalation is a real command that delivers
```

On the packs where the section fits, no such line is printed — so its absence is a usable signal,
exactly as the comment skill instructs.

### AC 2 — `--json` mirrors the wire

```
$ corpus thread context th_wl7djw23 --json | wc -l
       1
$ corpus thread context th_wl7djw23 --json | grep -c "^# related excerpts"
0                                            → every human line suppressed
```

### AC 3 — error and exit-code paths

```
$ corpus thread context
corpus: missing required argument <id> for "context".
  Usage: context <id> [flags]                                        [exit 2]

$ corpus thread context doc_gt2cvtta
corpus: 400 bad_request: request failed validation
  [ { "path": "param.id", "message": "Invalid string: must match pattern /^th_[A-Za-z0-9]+$/" } ]   [exit 5]

$ corpus thread context not-an-id                                    [exit 5]  (same 400)

$ corpus thread context th_wl7djw23 --limit 3
corpus: unknown flag "--limit" for "context".                        [exit 2]

$ corpus server stop && corpus thread context th_wl7djw23
corpus: server not running for this workspace — run `corpus server start`
  Nothing answered at http://127.0.0.1:8808.                         [exit 4]
```

`--json` and `--workspace` resolve as globals; the verb declares no local flags, as designed.

### The generated reference is in step

`node --import tsx scripts/check-generated-artifacts.ts` → `✓ CLI reference is up to date
(docs/cli.md)`, and `### \`corpus thread context\`` sits at `docs/cli.md:1684` with its ToC entry at
`:67` — the AGENT-009 gate (sprint-022 C7) is genuinely open.

## Failures

None.

## Summary

3 of 3 criteria passed. Every shape, the truncation indicator and all four exit-code paths were
driven through the real bin against a real server on evaluator-composed fixtures.
