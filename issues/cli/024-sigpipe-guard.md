# [CLI-024] SIGPIPE guard: piped output must not die with an EPIPE stack trace

## Domain
cli

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: CLI-001
- Blocks: —

## Spec References
- None product-behavioral — CLI robustness (Phase 7 eval finding, 2026-07-31)

## Summary
Evaluator observed `corpus doc show <104KB doc> | head -6` emit an unhandled Node
EPIPE stack trace (once; not reproduced in 15 trials — the race depends on flush
timing vs. head's exit). A CLI whose skills teach piping (`search | …`, `doc show`)
must exit quietly when its reader goes away: handle EPIPE on stdout/stderr globally
(exit 0 silently, the POSIX convention), in the bin entry so every verb is covered.

## Acceptance Criteria
- [x] Deterministic test: writer with a closed-early pipe exits 0, no stack trace (simulate by closing the stream, not by racing `head`)
- [x] Normal error output paths unaffected

## Technical Design
### Files to Create/Modify
- `apps/cli/src/bin/corpus.ts` (or the shared output layer) + test

## Testing Strategy
apps/cli scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
`corpus doc show <big doc> | head -1` in a loop; zero stack traces.

## E2E Verification Log

_Filled by the implementing agent (cli-dev, **Opus 5 (1M context)**), 2026-08-24._

### Decision: CLI-024 and CLI-041 are **one fix**, and the reason is not taste

CLI-041 was filed as "the SIGPIPE guard CLI-024 added does not cover `doc diff`".
The first act here was to look for that guard. There was none — this issue was
still `todo`, and `grep -rn EPIPE apps/cli/src` matched exactly one line, in
`client.ts`'s retry classifier, which is about a request and not about stdout.
So there was no per-verb guard to extend and no second guard to avoid: every verb
was unprotected, and one guard in the one place a stream is touched closes both.

### Pre-fix reproduction

Real server on 8891, throwaway workspace, a 133 KB note. **stderr to a file** —
`2>&1 | head` swallows the trace and hides the bug.

```
$ corpus doc show doc_44xd6a7r 2>/tmp/show.err | head -2
Big note
doc_44xd6a7r · note · open
$ head -8 /tmp/show.err
node:events:486
      throw er; // Unhandled 'error' event
      ^

Error: write EPIPE
    at WriteWrap.onWriteComplete [as oncomplete] (node:internal/stream_base_commons:87:19)
```

`corpus doc diff` produced the same thing in the same run (CLI-041's log has it).
Node ignores `SIGPIPE` at startup, so the kernel signal never arrives and the
failed write surfaces as an unhandled stream `error` instead.

### The fix

`apps/cli/src/pipe.ts` (new) + six lines in `apps/cli/src/bin/corpus.ts`.

`run.ts` is handed `Writer`s and never touches a stream — deliberate, and kept —
so the bin shim is where the two real streams are wrapped. That placement is also
what makes the guard cover **every verb**, including ones added later.

Two failure modes are handled because Node has two: `write` may throw
synchronously, or the stream may emit `error` a tick later, after `run` has
returned.

**stdout and stderr are treated differently, on purpose.** A broken stdout is the
whole event — the reader has what it asked for — so the run exits **0 and
silently**, the convention the ignored `SIGPIPE` would have produced. A broken
stderr is a lost diagnostic, not the event: writes are dropped, the run continues,
and the exit code stays whatever the command earned. Exiting 0 there would turn a
failure into a success because nobody was reading the complaint. Anything that is
not a broken pipe is re-thrown, so a real `ENOSPC` is never absorbed.

### Deterministic tests — by closing the stream, never by racing `head`

`apps/cli/src/pipe.test.ts`, 19 cases. The issue's own reason is the design: the
evaluator saw the crash once and could not reproduce it in fifteen tries, so a
test built on that race would be a flake that passes while the bug is present.
Both Node failure modes are produced directly, on both streams, plus the
non-pipe-error paths and the "a dead stdout does not silence stderr" case.

### E2E after the fix — 20 trials, zero stack traces

```
$ corpus doc show doc_44xd6a7r 2>/tmp/g1.err | head -2
Big note
doc_44xd6a7r · note · open
[stderr bytes: 0]

$ for i in $(seq 1 20); do corpus doc show doc_44xd6a7r 2>>/tmp/loop.err | head -1 >/dev/null; done
stderr bytes over 20 runs: 0

$ corpus doc show doc_44xd6a7r 2>/dev/null | head -2 >/dev/null
doc show writer exit=0

$ corpus doc show doc_44xd6a7r --json 2>/dev/null | head -c 20
{"frontmatter":{"id"          [stderr bytes: 0]
```

Normal paths unaffected — the whole document still arrives unpiped
(`| wc -c` → 132251), and `corpus doc show doc_nosuch` still prints
`corpus: 404 not_found: no document with id doc_nosuch` and exits **5**.

### Checks

`npm run typecheck -w apps/cli` clean, eslint clean (no rule disabled), prettier
clean, `vitest run apps/cli scripts/missing-profile-parity.test.ts
scripts/retrieval-exclusion-parity.test.ts` — 109 files, 2148 tests, exit 0.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
