# [CLI-051] A flag value that never touches the shell

## Domain

cli

## Status

todo

## Priority

P1 — **raised from P2 on 2026-08-18.** See "The residual guidance cannot close",
below. What looked like an ergonomic question turned out to have a case where a
person's own words execute as shell commands.

## Model

fable

## Dependencies

- Depends on: —
- Blocks: —
- Related: AGENT-035 (the guidance that works around this today)

## Spec References

- SPEC.md **§7** — the agent works through the CLI and nothing else
  (architecture decision 2)
- SPEC.md **§2.3** — one registry, self-documenting

## Summary

AGENT-035 fixed a data-corruption bug by **guidance**: build every value carried
over from somebody in a `<<'EOF'` heredoc and pass `"$var"`. That is the right
fix for the problem as posed, and the issue's own analysis explains why every
alternative construction loses.

It surfaced a different idea, which AGENT-035 deliberately did **not** file so as
not to prejudge it: a general convention for reading a flag's value from a file
or from stdin, so an agent that wants to avoid the shell entirely can.

**These are different problems.** AGENT-035 answers *"the agent must use the
shell, so which construction is safe?"*. This one asks *"should the agent have to
use the shell at all?"*.

## Why it was not folded into AGENT-035

Quoted from that issue's rejection list, because the reasoning is the starting
point here rather than something to redo:

> **Mechanism (`--title-file`/stdin JSON)** — doesn't remove the failure, because
> the agent still has to *choose* it; same rule, plus a contract change and a flag
> per field. Stdin already belongs to the body on `doc create`.

That is a strong argument against a mechanism as a **substitute** for the rule. It
is a weaker argument against one as an **addition**, and the difference is what
this issue exists to settle.

## The residual guidance cannot close

Measured during PR #50's review response, 2026-08-18, against the real CLI.

A heredoc ends at a line holding exactly its terminator. So **a line in a
person's own words that reads `EOF` terminates the value early, and the shell
runs everything after it as commands.**

This is not the silent-corruption case. It is worse in kind:

- It **succeeded**. `created doc_x7nnyouq`, exit 0, committed
- The body was cut off at that line
- The remainder was executed
- Nothing refused anything, so the recovery clause — which triggers on the shell
  refusing a line — never fires

**Guidance cannot close this**, and that is the point of recording it here rather
than in AGENT-035. AGENT-035's rule is about how the agent *builds* a value, and
the agent builds this one correctly. The content decides the outcome. The skill
now names the residual and gives a one-word repair, which is the best prose can
do, and it depends on an agent noticing a line in text it did not write.

**The provenance framing makes it sharper.** AGENT-035's rule exists precisely
for values *carried over from somebody*. That is exactly the class where the
agent cannot vet the content, and exactly the class where a message quoting a
shell transcript is plausible.

A mechanism that never hands the value to a shell removes the whole class, and
this is the case that makes the mechanism worth its cost rather than merely
tidier.

## What has to be decided

1. ~~Is the problem real once AGENT-035's rule is in place?~~ **Answered
   2026-08-19: yes.** See the E2E log. Close-unbuilt is off the table.
2. **What is the shape?** A per-flag `--<name>-file`, a single `--fields <json>`,
   or stdin. Stdin is already taken by the body on `doc create`, so it is not
   free.
3. **How does an agent know to reach for it?** A mechanism nobody chooses is
   worse than no mechanism, because it looks like the problem is solved.
4. **Does it earn its cost?** Every new flag is surface in a CLI whose selling
   point is being self-documenting, and a flag per field multiplies fast.

## Acceptance Criteria

- [ ] The question in point 1 is answered with a measurement against a real
      session, before any code is written
- [ ] If the answer is "the rule is sufficient", this issue is closed with that
      measurement recorded, and no flag is added
- [ ] If a mechanism ships, it is one shape and not a flag per field, and
      AGENT-035's rule stays the default rather than being replaced

## Technical Design

### Files to Create/Modify

Unknown until the question above is answered. Likely `apps/cli/src/commands/**`
and `packages/contract` if the shape reaches the wire.

### Key Implementation Details

Read AGENT-035's E2E log first. It contains measured behaviour for `$`,
backticks, apostrophes and indented heredoc terminators across zsh and bash 3.2,
and it is the evidence base for whether this is worth building.

## Testing Strategy

Determined by the shape. The measurement in point 1 comes first.

## E2E Verification Plan

### Verification Steps

1. Reproduce a real agent session writing a value with `$`, an apostrophe and a
   backtick, **following AGENT-035's rule**, and record whether anything is lost
2. Only then design

## E2E Verification Log

### Acceptance criterion 1, measured 2026-08-19 — the answer is **no, the rule is not sufficient**

Real `corpus` 0.13.0, throwaway workspace, server on 8808 (never 8765, never
5173). Model: opus.

**Case 1 — the rule followed, ordinary hostile characters. Byte-exact.**

A title built in a `<<'CORPUS_EOF'` heredoc and passed as `"$title"`:

```
title: O'Brien's quote — $18,400 for the `whoami` job, 50% down
```

stored identically. Apostrophes, `$`, a backtick and `%` all survive. AGENT-035's
rule does exactly what it claims for every character.

**Case 2 — the terminator inside the carried text. Executes, and the result is
not truncation.**

Carried text (a pasted vendor transcript, which is the arrival vector the skill
names) containing a line reading exactly `CORPUS_EOF`, then a command, then more
of the person's message. Following the rule exactly:

```
$ ls /tmp/corpus-cli051-pwned.txt
-rw-r--r--@ 1 theophanerupin  wheel  0 Aug 19 07:46 /tmp/corpus-cli051-pwned.txt
```

The `touch` ran. `created doc_wvn4kxac`, exit 0. And the document that landed:

```
The vendor pasted their terminal session below.

and this line is the rest of their message
```

**Read that carefully. This is not a truncated document.** The mechanism is
worse than the earlier framing in this issue:

1. The carried text's own `CORPUS_EOF` line closed the heredoc early
2. The lines after it ran **as commands, inside the `$( )` substitution**
3. `touch` executed and, being silent, left no trace in the value
4. `echo`'s **stdout was captured into `$body`** — so a command's output was
   spliced into the document *as though it were the person's content*
5. The tail of the message is present, so nothing looks cut off

A dropped tail is noticeable. **A missing middle with an intact tail is not.**
The document reads as complete and coherent, and a reader has no signal that a
line was removed and a command's output put in its place.

### What this settles

- **Point 1 of "What has to be decided" is answered: the problem is real after
  AGENT-035's rule.** Close-unbuilt is off the table
- The class is not "characters the shell eats" but "**the value can terminate its
  own quoting**", which no choice of terminator removes — it only makes the
  collision less likely
- Guidance cannot close it, because the agent builds the value correctly and the
  content decides the outcome
- The priority raise to P1 (2026-08-18) is confirmed by measurement rather than
  by argument

### What is still open

Points 2, 3 and 4 — the shape, how an agent knows to reach for it, and whether it
earns its cost. Those are design, not measurement, and unchanged by this run.

Server stopped, port 8808 free, workspace and `/tmp/corpus-cli051-pwned.txt`
removed. Nothing written under `/Users/theophanerupin/cos`.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-051]` prefix
