# [AGENT-058] The skills carry somebody's words by path, not through the shell

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: CLI-074
- Blocks: —
- Related: AGENT-035 (the rule this demotes to its proper scope), CLI-051

## Spec References

- SPEC.md **§7** — the agent works through the CLI and nothing else

## Summary

CLI-074 gives the agent a way to pass a value that never touches a shell. A
mechanism nobody reaches for is worse than no mechanism, because it looks like
the problem is solved — CLI-051 says exactly that, and it is the reason this
issue is not optional.

The four product skills contain **64 heredocs** between them: `orchestrate` 28,
`profile` 14, `comment` 12, `converse` 10. Every one that carries words the agent
did not author is an instance of the defect CLI-051 measured.

## The rule, after this

**Words somebody else wrote go in by path.** The agent writes the value to a file
with its own file-writing tool — which never invokes a shell — and passes
`--flag-file name=<path>` or `--file <path>`. Nothing about the content can
change what the command does.

**AGENT-035's rule keeps its scope and loses its job as the general answer.** It
is still right for a short value the *agent itself* composed, where a file is
ceremony: a status word, an id, a timestamp. It stops being the rule for carried
text, because for carried text it cannot be made safe.

The distinction the skills must draw is **who wrote the words**, and it is the
same distinction AGENT-035 already draws — that rule exists "precisely for values
carried over from somebody". This issue changes what to *do* with that class, not
how to recognise it.

## Acceptance Criteria

- [ ] Every heredoc in the four skills that carries words the agent did not
      author is replaced by a file the agent writes and a path it passes
- [ ] The rule is stated **once**, in the skill that owns it, and the others
      point at it — AGENT-032 is the precedent: a rule written in two skills
      drifts in one of them
- [ ] AGENT-035's rule survives, scoped to values the agent composed itself, and
      says why it is not the answer for carried text
- [ ] No behavioural rule is weakened. Every worked example still shows a
      complete, runnable sequence
- [ ] The `CORPUS_EOF`-never-`EOF` guidance stays wherever a heredoc legitimately
      remains, because those heredocs are still heredocs
- [ ] A drill: an agent following the rewritten skill, given a message containing
      a line reading `CORPUS_EOF`, files a document holding that line

## Technical Design

### Files to Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — 28 heredocs, and the
  skill that states the shell rule for all of them
- `assets/workspace/claude/skills/comment/SKILL.md` — 12
- `assets/workspace/claude/skills/profile/SKILL.md` — 14
- `assets/workspace/claude/skills/converse/SKILL.md` — 10

### Key Implementation Details

**Not every heredoc goes.** A body the agent wrote itself — a reply it composed,
a summary — is not carried text, and rewriting those would cost the skills their
readability for no safety. The test for each one is the question AGENT-035
already asks: *did somebody else write these words?*

**Token cost is a real constraint here** (AGENT-047 measured the comment skill at
15,228 tokens read whole on every event). A rewrite that adds a paragraph per
call site would be paid on every event for the life of the workspace. State the
rule once, show it once, and let the remaining call sites be short.

### Edge Cases

- A value that is **partly** carried — the agent's sentence quoting a person's
  phrase — is carried. The whole value goes by path.
- The `profile` skill's `--description` and title are both somebody's words and
  are named as such in its own prose already.
- A form answer is the person's words by definition.

## Testing Strategy

Prose has no unit test. What stands in:

- The workspace template test that every skill file still parses and installs
- A **drill**: a real agent session against a real workspace, given a message
  whose text contains a `CORPUS_EOF` line, following only the rewritten skill

## E2E Verification Plan

1. `corpus init` a throwaway workspace so the rewritten skills are what installs
2. Follow the rewritten skill by hand, as an agent would, for a carried value
   containing a heredoc terminator, a `$`, a backtick and an apostrophe
3. Read the document back: it holds exactly what was carried, nothing executed

## E2E Verification Log

### Post-Implementation Verification

Implemented on: **opus**.

**What changed.** The rule is rewritten once, in `orchestrate/SKILL.md`, where it
was already stated alone. Carried words go to a file written with the agent's own
file-writing tool and are named with `--flag-file` or `--file`. Heredocs stay for
words the agent wrote itself, and keep `CORPUS_EOF` there. Every cross-reference
in the other three skills now points at the new rule.

Heredocs, before and after: `orchestrate` 28 → 25, `comment` 12 → 10,
`profile` 14 → 6, `converse` 10 → 10. **64 → 51.** What is left is bodies the
agent composed — replies, drafted documents, batch arrays — which is what the
rule now says a heredoc is for. `converse` is unchanged in count because it
demonstrates no carried flag value of its own; its one sentence about the rule is
a cross-reference, and it was updated.

The rule also got **shorter**: 935 words → 841, and simpler, because a path has
no terminator to choose, no `IFS= read` repair and no single-line boundary. That
matters beyond tidiness — AGENT-047 measured the comment skill at 15,228 tokens
read whole on every event.

**The drill.** `corpus init` a fresh workspace so the rewritten skills are what
installed, server on **8766**. A person's message carrying every hostile thing at
once: a line reading exactly `CORPUS_EOF`, `$18,400`, `` `whoami` ``, and
apostrophes in `O'Brien's` and `it's`.

```
created doc_u7o2qp55 — data/docs/inbox/o-brien-s-quote-18-400-for-the-whoami-job.md
$ ls /tmp/corpus-drill-pwned.txt
ls: /tmp/corpus-drill-pwned.txt: No such file or directory
```

Compared byte for byte rather than by eye:

```
body byte-exact: True
title stored : O'Brien's quote — $18,400 for the `whoami` job
title sent   : O'Brien's quote — $18,400 for the `whoami` job
title exact  : True
```

### The control taught something the reproduction had not

Running the **old** construction on this same payload did not execute anything.
It failed loudly instead:

```
control3.sh: line 13: unexpected EOF while looking for matching `''
exit 2
```

**The old construction fails two ways and the person's words choose which.** If
what follows the terminator line parses as shell, it *runs* — silently, which is
CLI-074's recorded reproduction. If it contains an unbalanced quote, the shell
refuses and nothing happens — loud, which is this payload, because it says
`O'Brien's` after the terminator. Both are failures. Only one is visible. Nothing
about the value tells you in advance which you are getting, which is the argument
for the mechanism stated better than either case alone.

**And two earlier attempts at that control were not faithful**, which is worth
recording because of what it shows. The first put an apostrophe in the *title*
capture and so failed on the loud path before reaching the payload at all. The
second read the body from a file with `cat` — which is already most of the new
shape, so of course nothing ran. It took three tries to demonstrate the old way
on purpose. That is how narrow the safe path was, and it was never marked on the
map.

**Also corrected: a safety claim the batch grammar did not have.** The orchestrate
skill said an entry's `-m` value means "no shell reads those tokens at all, so
somebody's words arrive intact without the construction *Writing a document*
requires of a flag." That is true of expansion and false of termination: the
array itself usually arrives on a heredoc, which a carried value containing that
terminator ends early — and a JSON string needs escaping besides. The bullet now
says an entry carries somebody's words the same way any other command does, and
points at redirecting the array from a file where it is long.

**Suite.** `apps/cli` 2,217 passed, 109 files — including the workspace template
tests, which are what prove the rewritten skills still install.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified
