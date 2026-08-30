# [CLI-074] A value the shell never sees

## Domain

cli

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Blocks: AGENT-058
- Related: CLI-051 (the finding and its measurement), AGENT-035 (the rule this
  supplements rather than replaces)

## Spec References

- SPEC.md **§7** — the agent works through the CLI and nothing else
  (architecture decision 2)
- SPEC.md **§2.3** — one registry, self-documenting

## Summary

CLI-051 measured a case where **a person's own pasted words execute as shell
commands and a command's output is written into their document as though they
had written it**. The agent follows AGENT-035's rule exactly — build the value in
a quoted heredoc, pass it by name — and the value's own content decides the
outcome: a line reading the terminator closes the heredoc early, the lines after
it run, and their stdout is captured into the value.

Guidance cannot close this. The agent builds the value correctly. So this issue
gives every value-carrying flag a source that **never passes through a shell**.

## The shape, decided

**A global `--flag-file <name>=<path>`, repeatable.** The named flag takes its
value from the file, byte for byte.

```bash
corpus doc create --type note --flag-file title=/tmp/t.txt --file /tmp/body.txt
```

**Why this shape and not the two alternatives CLI-051 named.**

- **A flag per field (`--title-file`, `--reason-file`, …)** — the convention
  `doc patch` already uses for `--old-file`/`--new-file`. Rejected as the general
  answer: the set is not three. `--title`, `--description`, `--reason`, `--extra`
  and `--add-tag` all carry words somebody wrote, the list grows every time a
  verb gains a string flag, and CLI-051's own criterion refuses a flag per field.
  The existing twins stay where they are — they are a body and a patch side, not
  a general mechanism.
- **One `--fields <json>`** — one flag, and it satisfies the criterion's letter.
  Rejected because it **reintroduces the class**: the agent must JSON-escape the
  person's words. A malformed escape is loud, which is fine; a *well-formed wrong*
  one is not. Text containing the two characters `\` and `n` escaped as a newline
  produces valid JSON and a corrupted document, silently — the same shape as the
  defect being fixed.

`--flag-file` has no escaping step anywhere, and nothing about the value's
content decides how it is read. The path is a path because of where it sits, not
because of what it looks like.

**The body already has one.** `--file <path>` reads a body from a file and
predates this issue. Nothing changes there; the skills simply have to use it
(AGENT-058).

## Acceptance Criteria

- [ ] `--flag-file <name>=<path>` is a global flag, available on every command,
      repeatable
- [ ] The value is the file's bytes, verbatim — no trimming, no decoding, no
      interpretation
- [ ] It resolves any **string** flag the command declares, including a
      repeatable one, which it appends to
- [ ] Naming a flag the command does not declare is a usage error that names it
      and suggests the near ones — the same treatment an unknown flag gets
- [ ] Naming a flag that is not a string (a boolean, a number) is a usage error
- [ ] Giving both `--title` and `--flag-file title=…` is a usage error, never a
      silent precedence: a caller who does both does not know which one wins, and
      guessing for them is how a wrong value ships
- [ ] An unreadable path is a usage error naming the path and the reason
- [ ] A relative path resolves against the caller's cwd, as `--file` does
- [ ] `--flag-file` itself cannot be set through `--flag-file`
- [ ] `docs/cli.md` regenerated; the help text says what the flag is *for*, not
      only what it does
- [ ] The CLI-051 reproduction, run against this mechanism, writes the document
      the person actually sent and executes nothing

## Technical Design

### Files to Create/Modify

- `apps/cli/src/registry/globals.ts` — the flag
- `apps/cli/src/parse-args.ts` — collect the pairs; it cannot resolve them,
  because reading a file is async and parsing is not
- `apps/cli/src/input.ts` — resolution, beside `readFlagFile` which already
  reads a flag's file and reports the failure in the right words
- `apps/cli/src/run.ts` — where resolution happens, once, before the handler
- `apps/cli/src/docs/` — regenerated reference

### Key Implementation Details

**Where it resolves.** `parseFlags` is synchronous and must stay so. So the
parser records the pairs, and one `await` before the handler replaces the flag
values. That keeps every handler unchanged: a handler reads
`flags.string("title")` and cannot tell how it got there, which is the property
that makes this work for verbs nobody has written yet.

**Splitting.** On the **first** `=`. A flag name never contains one; a path may.

**Ordering.** Two `--flag-file` for one non-repeatable flag is the same conflict
as giving the flag twice, and is refused by the same rule.

### Edge Cases

- An empty file is an empty value, not an absent one. A caller who wants a flag
  absent omits it.
- **One trailing newline is removed, and only one** — a decision changed during
  implementation, after the first E2E showed why. Every ordinary way of writing a
  file ends it with a newline, so keeping it gave every title a trailing blank,
  which YAML serialised as a block scalar and the board would show as a title
  with a line break. It is also what the idiom being replaced already did:
  `$(cat <<'EOF' … EOF)` strips trailing newlines. The **body** keeps its bytes
  exactly, because a document's final newline is content — the two rules differ
  because a title and a document are different things, and the help says so.
- A path that is a directory fails as unreadable, with the OS's own reason.
- `--flag-file` before or after the flag it names is the same; resolution is not
  positional.

## Testing Strategy

`apps/cli` scoped (`VITEST_MAX_THREADS=4`). Unit over the parse and the resolve:
each refusal above, the repeatable-append case, the relative path, the verbatim
bytes including a trailing newline and a `$`.

**Falsification, required.** Remove the both-given refusal and watch a test go
red — a silent precedence is the failure this is here to prevent, and a test that
passes without it is testing nothing.

## E2E Verification Plan

1. Real server, real workspace, never port 8765
2. Run **CLI-051's recorded reproduction verbatim** — the pasted transcript whose
   line reads `CORPUS_EOF`, followed by `touch` and `echo`
3. Expected today: the file is touched, output is spliced into the document
4. Then the same content through `--flag-file` and `--file`: the document holds
   the person's words including the `CORPUS_EOF` line, and nothing executes

## E2E Verification Log

### Reproduction, 2026-08-30, against v0.28.0

Implemented on: **opus**.

CLI-051's measurement was taken at v0.13.0. It reproduces unchanged. Real
`corpus` 0.28.0, throwaway workspace, server on **8766** (never 8765).

The agent follows the skill's rule exactly — somebody else's words, built in a
`<<'CORPUS_EOF'` heredoc, passed by name — and the words are a pasted vendor
transcript containing a line that reads `CORPUS_EOF`:

```
$ ls -l /tmp/corpus-cli051-pwned.txt
-rw-r--r--  1 theophanerupin  wheel  0 Aug 30 11:48 /tmp/corpus-cli051-pwned.txt
created doc_znxvmo5f — data/docs/inbox/vendor-transcript-18-400-quote.md   (exit 0)
```

The document that landed:

```
The vendor pasted their terminal session below.

$ cat >/tmp/notes <<'CORPUS_EOF'
SPLICED BY A COMMAND

and this line is the rest of their message
```

`touch` ran. `echo`'s stdout is in the body, presented as the person's words. The
tail is intact, so nothing reads as truncated.

### Post-Implementation Verification

**The same payload, through the mechanism.** Same workspace, same bytes, passed
as `--flag-file title=… --file …`:

```
created doc_kuwkr3zk — data/docs/inbox/vendor-transcript-18-400-quote-the-whoami-job-2.md
$ ls /tmp/corpus-cli051-pwned.txt
ls: /tmp/corpus-cli051-pwned.txt: No such file or directory
```

Nothing executed. The body is **byte-identical** to what was sent, asserted by
comparison rather than by eye — the `CORPUS_EOF` line, the `touch`, the `echo`
are all in the document, as text, which is what they were. The title kept
`$18,400` and its backticks.

**Every refusal, against the real binary**, each exiting **2** and each carrying
its repair:

```
--title Typed --flag-file title=…   --title was given twice: once directly, once from a file.
--flag-file titel=…                 --flag-file names no flag --titel.   (hint: Did you mean --flag-file title=…?)
--flag-file json=…                  --json takes no text, so it cannot come from a file.
--flag-file title=/nope.txt         cannot read --flag-file /nope.txt.
--flag-file title                   --flag-file title is not <flag>=<path>.
```

and under `--json` the same words reach the envelope:

```json
{"error":{"code":"usage_error","message":"--flag-file names no flag --titel.","hint":"Did you mean --flag-file title=…?"}}
```

**Unit.** `flag-file.test.ts` — 21 passed. Whole `apps/cli` suite: **2,217
passed**, 109 files.

**Falsification, three breaks.**

| Break | Result |
| --- | --- |
| Remove the both-given refusal | 1 failed |
| Strip *all* trailing newlines instead of one | 2 failed |
| Split the pair on the last `=` instead of the first | 1 failed |

### Two things the implementation changed about the design

**A module cycle, found by a test rather than by reading.** `resolveFlagFiles`
was written into `input.ts`, where every other value source lives. That closed a
ring — `registry/globals.ts` imports `input.ts` for `FROM_FLAG`, and
`parse-args.ts` imports `registry/globals.ts` — so the first module loaded built
`GLOBAL_FLAGS` out of an uninitialised `FROM_FLAG`. It has its own module now,
and the docblock says why so nobody moves it back.

**The trailing newline rule was reversed.** The issue said the bytes are kept
verbatim and trimming would be an interpretation. The first E2E showed the cost:
every title acquired the newline an editor leaves at the end of a file, YAML
serialised it as a block scalar, and the board would show a title with a line
break in it. One trailing newline is now removed — which is also what
`$(cat …)` already did, so a rewritten skill gets the value it got before. The
**body** still keeps its bytes, because a document's final newline is content.

### And the CLI's own hygiene rule caught the docblock

`hygiene.test.ts` refuses any heredoc in the CLI's source that terminates with
`EOF`, because an agent reading the source copies what it sees. The first draft
of the trailing-newline docblock illustrated the old idiom with a literal
`<<'EOF' … EOF`. The rule is right and the prose was wrong.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified
