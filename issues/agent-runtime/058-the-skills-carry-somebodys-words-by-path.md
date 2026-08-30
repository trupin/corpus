# [AGENT-058] The skills carry somebody's words by path, not through the shell

## Domain

agent-runtime

## Status

todo

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

_[filled by the implementer]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified
