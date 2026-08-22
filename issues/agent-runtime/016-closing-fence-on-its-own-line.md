# [AGENT-016] A closing fence on the content line swallows the next person's turn

## Domain

agent-runtime

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: AGENT-012 (which established the fence-widening half of the same rule)
- Blocks: —

## Spec References

- SPEC.md §6 — thread turn format (`## <author> · <ISO timestamp>` delimiters)
- SPEC.md §10 — Thread view, copyable canvases (rider signed 2026-08-02)

## Summary

User-reported, with the offending snippet: the agent emitted a labeled fence whose
**closing run sat at the end of the last content line** rather than alone on its own
line — the payload's last word and the backticks together. CommonMark closes a fence
only on a line containing **nothing but** the backtick run, so that fence never
closed.

The cost is not cosmetic. `apps/server/src/core/turns.ts` deliberately excludes
fenced regions when scanning for turn delimiters, so that a snippet can quote a
`## <author> · <ts>` heading without faking a turn. An unclosed fence therefore makes
every **subsequent** turn heading in the thread invisible: the next person's reply
stops being a turn of its own and is absorbed into the body of the agent's turn. The
person sees the agent's opening sentence and nothing else, and nothing anywhere
reports an error.

This is the other half of AGENT-012's rule, from the same mechanism: a fence has to
be opened wide enough **and** closed on a line of its own. It belongs beside the
widening rule, not in a section of its own.

## Acceptance Criteria

- [x] The comment skill states the closing-on-its-own-line rule beside the widening
      rule, deriving both from one statement of the mechanism
- [x] It states what the failure **costs** — the next person's message vanishing from
      the conversation — not merely that it renders badly
- [x] `orchestrate/SKILL.md` extends its shorter pointer in proportion, since that is
      what briefs subagents
- [x] `scripts/workspace-template.test.ts` pins the new rule for both skills, as
      AGENT-012 and AGENT-013 did
- [x] `sections.size` counts unchanged (orchestrate 16, comment 13); every `## `
      section still exceeds 400 chars
- [x] Every `corpus …` invocation in the templates still resolves against `docs/cli.md`
- [x] The measurement is reproduced against the real `parseTurns`, both shapes
- [x] Recorded as domain knowledge beside the AGENT-012 entry, as the third distinct
      failure of the same rule

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/comment/SKILL.md` — the "Reply" section's fence
  bullet, restructured to state the mechanism once and draw both consequences
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the dispatch-invariants
  fence bullet, extended by two sentences with the cost named
- `scripts/workspace-template.test.ts` — a new assertion in `deliverable fences`
- `.claude/agents/agent-runtime-dev.md` — domain knowledge

### Key Implementation Details

The bullet leads with the mechanism — a fence ends at the first line that is
**nothing but** a backtick run at least as long as the opener — and then draws the two
failures from it: **too narrow** closes early (AGENT-012's split deliverable);
**not alone on its line** never closes at all (this issue's swallowed turn).

The cost paragraph is stated in product language: a thread is a sequence of turns
delimited by a level-2 heading naming the author and the timestamp, and such a heading
inside a fence is deliberately not a delimiter — which is exactly what lets a turn
quote the thread format without faking a turn, and exactly what makes an unclosed
fence swallow everything after it.

### Edge Cases

- The malformed shape is **not** shown as a literal example. The template's fence
  extractor and the section parser both toggle on any line beginning with a backtick
  run, and a nested fence whose closing run rides a content line leaves that toggle
  stuck open, mis-parsing every `## ` heading after it. The bad shape is therefore
  described in prose; the good shape is what the file demonstrates.
- No new fenced block is introduced in either skill, so the naive fence toggling in
  `scripts/workspace-template.test.ts` keeps the same parity and the sole
  `info === "prompt"` example stays sole.

## Testing Strategy

`scripts/workspace-template.test.ts` — a new `it.each(skills)` case in the
`deliverable fences` describe, pinning: the mechanism sentence, the own-line
requirement, and (comment skill) the consequence in terms of turns being swallowed.
The existing `sections.size` and 400-char assertions guard the placement.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Build a thread body in the real turn format: an agent turn containing a labeled
   fence whose closing run sits at the end of the payload's last content line, then a
   later user turn.
2. Parse it with the server's real `parseTurns`.
3. Expected: 2 turns.
4. Actual: 1 turn — the user's reply is inside the agent turn's body.

### Verification Steps

1. Parse the corrected shape (closing run alone on its line) with the same
   `parseTurns`: 2 turns, bodies intact.
2. Run the workspace-template suite; confirm section counts, CLI-invocation checks and
   the new assertions pass.

## E2E Verification Log

Implemented on: **opus**.

### Reproduction (bugs only)

Probe at `/tmp/agent-016/probe.ts`, importing the server's real
`apps/server/src/core/turns.ts` (no mocks, no reimplementation), run with
`npx tsx /tmp/agent-016/probe.ts`. Both bodies are identical except for where the
closing backtick run sits:

````
=== BAD (fence closed on the content line) -> 1 turn(s)
  [agent · 2026-08-06T09:00:00Z] body="Here is the message I prepared for them:\n\n```message\nHi Dana — the rate assumption moved to 6.4%.```\n\n## user · 2026-08-06T09:05:00Z\n\nThat is not what I asked for. Please redo it with the old figure."

=== GOOD (fence alone on its line) -> 2 turn(s)
  [agent · 2026-08-06T09:00:00Z] body="Here is the message I prepared for them:\n\n```message\nHi Dana — the rate assumption moved to 6.4%.\n```"
  [user · 2026-08-06T09:05:00Z] body="That is not what I asked for. Please redo it with the old figure."
````

Confirmed exactly as reported: **1 turn vs 2**, and the swallowed content is visible
in the bad case — the user's entire reply, heading included, is a substring of the
agent turn's body. The parser reports nothing; there is no error to notice.

### Post-Implementation Verification

- `VITEST_MAX_THREADS=4 npx vitest run scripts/workspace-template.test.ts` — **120
  passed, 0 failed** (117 before this issue; three new cases, one of which is an
  `it.each` over both skills). That run includes the unchanged `sections.size`
  expectations (orchestrate 16, comment 13), the >400-char-per-section rule, the sole
  `info === "prompt"` deliverable example, and the `corpus …`-invocation extractor
  check against `docs/cli.md` — so the new text neither shifted a section boundary nor
  introduced a fence the tooling mis-tracks.
- **The rule verified against a real CommonMark parser, not the naive toggler.** Both
  skill bodies parsed with `mdast-util-from-markdown`:

  ```
  comment/SKILL.md:     top-level h2=13, fenced blocks=11, blocks with no closing fence line=0
  orchestrate/SKILL.md: top-level h2=16, fenced blocks=14, blocks with no closing fence line=0
  ```

  The heading counts agree exactly with the section walker's pinned 13/16, which they
  could not do if any fence in either file were left open — the files demonstrate the
  rule they now state.
- `npx prettier --check` clean on `scripts/workspace-template.test.ts` (after
  `--write`) and on the issue file; `npx eslint scripts/workspace-template.test.ts` —
  no issues. `assets/workspace/` is listed in `.prettierignore`, so the skills are not
  prettier-formatted; both were kept inside the 100-column convention by hand.
- The malformed shape is deliberately **not** shown as a literal example in either
  skill — see Edge Cases. By construction the edits are prose only: no line of new text
  begins with a backtick run, so no fenced block was added or removed, and the naive
  toggling in both the extractor and the section walker keeps the parity it had.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (scoped: prettier on the touched TS)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
