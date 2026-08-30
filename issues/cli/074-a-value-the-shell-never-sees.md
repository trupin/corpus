# [CLI-074] A value the shell never sees

## Domain

cli

## Status

todo

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
- A file with a trailing newline keeps it. Trimming would be an interpretation,
  and `doc create --title` with a trailing newline is the caller's business —
  the server's title normalisation is where that belongs, not here.
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

### Reproduction (bugs only)

_[filled by the implementer]_

### Post-Implementation Verification

_[filled by the implementer]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified
