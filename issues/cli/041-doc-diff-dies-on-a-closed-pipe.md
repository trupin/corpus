# [CLI-041] `corpus doc diff` dies with `EPIPE` when piped into `head`

## Domain

cli

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Related: CLI-024 (added the SIGPIPE guard that does not cover this verb)

## Spec References

- Not spec behaviour. This is about the CLI being usable in a shell.

## Summary

Found incidentally by AGENT-023 while walking the revert loop against a real
server: `corpus doc diff <id> | head` dies with an unhandled `EPIPE`.

CLI-024 added a SIGPIPE guard for exactly this. It does not cover `doc diff`.

It matters more than a cosmetic crash because of where the verb now sits: after
SHARED-042 the revert loop **begins** with `corpus doc diff`, and reading a large
diff through `head` or `less` is the obvious first thing anyone does with it — an
agent piping it into `head` gets a stack trace instead of the first lines.

## Acceptance Criteria

- [x] Reproduce: `corpus doc diff <id> | head -5` against a document with a diff
      longer than the pipe buffer
- [x] The verb exits cleanly on a closed pipe, like the verbs CLI-024 fixed
- [x] **Find out why CLI-024's guard missed it** — there was no guard. CLI-024
      was never implemented (status `todo`, and `grep EPIPE apps/cli/src` matched
      one unrelated line in `client.ts`'s retry classifier). The premise of this
      issue's title is wrong in the CLI's favour: `doc diff` was not missed by a
      per-verb guard, every verb was unprotected
- [x] Whatever the cause, the fix covers the verbs that share it — **all of
      them**. The guard wraps the two real streams in `bin/corpus.ts`, which is
      the only place a stream is touched, so it covers every verb including the
      ones added after it

## Technical Design

### Files to Create/Modify

- Wherever CLI-024 put the guard, and `apps/cli/src/commands/doc/diff.ts`

## Testing Strategy

A test that closes the pipe early. If the existing guard has one, extend it to
cover the verb rather than writing a second.

## E2E Verification Log

_Filled by the implementing agent (cli-dev, **Opus 5 (1M context)**), 2026-08-24._

**Closed as one fix with CLI-024.** That is the call this issue asked for, and
the reason is not a preference: CLI-024's guard did not exist, so there was
nothing to sit beside. See CLI-024's log for the shared design and its tests;
this log carries the `doc diff` reproduction and the `doc diff` verification.

### Pre-fix reproduction (mandatory, and it reproduces on the first try)

Real server on port 8891, throwaway workspace, a 133 KB note whose first commit
diffs as wholly added. **stderr redirected to a file** — the earlier attempts in
this session piped `2>&1` into `head`, which swallowed the stack trace and made
the bug look absent.

```
$ corpus doc diff doc_44xd6a7r | wc -c
   16495
$ corpus doc diff doc_44xd6a7r 2>/tmp/diff.err | head -2
doc_44xd6a7r · data/docs/inbox/big-note.md
4b825dc642cb6eb9a060e54bf8d69288fbee4904..c79b1022f3d8ec05fa1e7ba83688e501e270c707
$ head -12 /tmp/diff.err
node:events:486
      throw er; // Unhandled 'error' event
      ^

Error: write EPIPE
    at afterWriteDispatched (node:internal/stream_base_commons:159:15)
    at writeGeneric (node:internal/stream_base_commons:150:3)
    at Socket._writeGeneric (node:net:966:11)
    at Socket._write (node:net:978:8)
    at writeOrBuffer (node:internal/streams/writable:570:12)
    at _write (node:internal/streams/writable:499:10)
    at Writable.write (node:internal/streams/writable:508:10)
```

`corpus doc show` on the same document produced the same unhandled `EPIPE` in the
same run, which is CLI-024's own case and is why the two closed together.

**Note for the next person reproducing an EPIPE here.** The 16 000-character diff
cap does *not* put `doc diff` under the pipe buffer: the rendered output is
~16.5 KB and macOS starts a pipe at 16 384 bytes. So the verb is reachable, but
only just — which is why `doc show` on a large document is the more reliable
probe, and why the tests close the stream directly rather than racing `head`.

### After the fix

```
$ corpus doc diff doc_44xd6a7r 2>/tmp/g2.err | head -2
doc_44xd6a7r · data/docs/inbox/big-note.md
4b825dc642cb6eb9a060e54bf8d69288fbee4904..c79b1022f3d8ec05fa1e7ba83688e501e270c707
[stderr bytes: 0]

$ corpus doc diff doc_44xd6a7r 2>/dev/null | head -2 >/dev/null
doc diff writer exit=0
```

Silent, exit 0, and the whole diff still arrives unpiped (`| wc -c` unchanged).
Errors are untouched: `corpus doc show doc_nosuch` still prints
`corpus: 404 not_found: no document with id doc_nosuch` and exits 5.

### Checks

`npm run typecheck -w apps/cli` clean, eslint clean, prettier clean,
`vitest run apps/cli scripts/missing-profile-parity.test.ts
scripts/retrieval-exclusion-parity.test.ts` — 109 files, 2148 tests, exit 0.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
