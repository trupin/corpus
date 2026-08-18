# [INFRA-030] The orchestrator writes in controlled language

## Domain

infra

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: AGENT-037 (the product half — same skill, different tree)
- Related: SHARED-049 (§7's skill enumeration, which AGENT-037 enlarges)

## Spec References

- None. `.claude/` is the **development harness**, not the product. No SPEC
  section governs how the orchestrator writes to the user, and none should —
  SPEC.md describes Corpus, not the process that builds it.

## Summary

The user asked for the ASD-STE100 skill to be installed by default, and to be
applied consistently to all communication with them (2026-08-18).

ASD-STE100 is a controlled-language standard from the aerospace and defence
industry. It removes the two largest sources of misreading: words with more than
one meaning, and sentences with more than one possible structure. The vendored
skill borrows the discipline for a different reader — one who has to parse the
text without asking a question.

**A skill file alone will not do this.** A skill fires when something invokes it,
and this one's triggers are on-demand: *"disambiguate"*, *"STE100 rewrite"*,
*"apply Simplified Technical English"*. Nothing in a normal reply invokes it. The
behaviour the user asked for needs a standing rule in `CLAUDE.md`, which loads
every session. **The file and the rule are one change. Either alone is inert.**

## What has already been decided

Settled with the user before the work started. Do not reopen these:

| Question | Answer |
| --- | --- |
| Where does it go? | Both the harness (this issue) **and** the product (AGENT-037) |
| Which mode? | **STE-flavored**, not Strict — see below |
| Does the tarball change? | **No.** `.claude/` ships nothing. AGENT-037 is the half a user receives |

**The mode is STE-flavored.** The skill assigns Strict to error messages, tool
descriptions and inter-agent instructions, and STE-flavored to *"READMEs, PR
descriptions, changelogs, explanatory prose"*. What the orchestrator writes to
the user is explanatory prose. Strict mode would also lock word choice, and the
skill's own warning is that a strict rewrite of prose *"reads as a personality
transplant rather than a clarification"*.

STE-flavored keeps every structural rule and drops the one-word-one-meaning
lockdown.

## Acceptance Criteria

- [x] The skill is vendored at `.claude/skills/asd-ste100/`: `SKILL.md`,
      `references/writing-rules.md`, `examples/before-after.md`, `LICENSE`
- [x] The three content files are byte-identical to the upstream commit
- [x] `PROVENANCE.md` names the source, the pinned commit, the author, the
      licence, and the refresh procedure
- [x] `CLAUDE.md` carries a standing rule that applies the skill to every reply,
      names the mode, and states the exceptions
- [x] The rule names what it does **not** cover, so a reader does not have to
      guess whether it reaches code comments and commit messages
- [x] Nothing in `dist-package/` changes — verified against
      `scripts/pack-audit.ts:172`, which forbids `.claude/**` in the tarball.
      `npm run pack:check` itself needs a full build and runs on the release
      gate, not here

## Technical Design

### Files to Create/Modify

- `.claude/skills/asd-ste100/**` — vendored, four files plus `PROVENANCE.md`
- `CLAUDE.md` — the standing rule

### Key Implementation Details

**Do not edit the vendored files.** An edit is lost on the next refresh and makes
the copy disagree with its source silently. Anything this repository needs to say
about the skill goes in `PROVENANCE.md` or in `CLAUDE.md`.

**The licence is MIT** (Copyright 2026 Dustin Yuchen Teng), so vendoring is
clean. Keep `LICENSE` next to the files it covers.

**ASD's own terms are a separate matter.** The standard is free to obtain and not
free to redistribute. The upstream skill leaves the ~900-word approved dictionary
out for that reason, and applies the principle instead. Neither this repository
nor anything it ships may claim ASD-STE100 compliance.

### Edge Cases

- **Quoted text.** A quotation from SPEC.md, a spec rider read back for sign-off,
  an error message, or a user's own words must reach the user unchanged. The rule
  governs the orchestrator's prose, never a quotation inside it.
- **Code, identifiers and commit messages.** Out of scope. A commit subject has
  its own format rule in the Git Workflow section, and a rule that reaches code
  comments would collide with `docs/TS_GUIDELINES.md`.
- **The em dash is not banned.** STE Rule 8.1 bans the semicolon outright and
  permits every other standard mark. The skill says an em dash often signals a
  sentence that should be split, which is advice and not a prohibition.
- **Modality survives.** *"may have failed"* does not become *"failed"*. The
  skill calls this the most common way a well-meant rewrite goes wrong, because
  a length cap is exactly what tempts an author to cut a hedge.

## Testing Strategy

None. This changes a Markdown instruction file and adds vendored documentation.
There is no code path to cover, and a test asserting the presence of a sentence
in `CLAUDE.md` would pin the wording rather than the behaviour.

The check that matters is `npm run pack:check`: it proves the tarball did not
change, which is the claim this issue makes about the harness half.

## E2E Verification Plan

### Verification Steps

1. Confirm the four vendored files match upstream, byte for byte
2. Confirm the skill is listed as available in a fresh session
3. `npm run pack:check` — the published package is unchanged
4. Read one reply written after the rule lands against the Scan Checklist's six
   habits, and record which ones the previous style was breaking

## E2E Verification Log

**Model: opus. Orchestrator-implemented, 2026-08-18.**

**1. Byte-identity against the pinned commit.** Refetched all four files from
`d5ce157870cf9c41efd1d6e836706a2be3c7b9da` into a scratch directory and ran
`cmp` against the vendored copies:

```
identical: SKILL.md
identical: LICENSE
identical: references/writing-rules.md
identical: examples/before-after.md
```

Prettier wanted to rewrite all four on the first commit attempt, and the hook
refused the commit. That is the exact failure this criterion exists to catch. The
fix was `.prettierignore`, not a reformat.

**2. The skill registers.** After the directory appeared, the session's skill
listing gained the row:

> `asd-ste100`: Use when English text must be parsed without a human to resolve
> ambiguity …

This confirms discovery works and confirms the issue's central claim: the
description's triggers are on-demand, so nothing in an ordinary reply would fire
it. The `CLAUDE.md` rule is what makes it standing.

**3. The tarball is unchanged — verified by rule, not by build.** Stating this
precisely: `npm run pack:check` was **not** run, because it needs a full build and
a pack. What was checked instead is stronger for this claim.
`scripts/pack-audit.ts:172` lists `.claude/**` as a **forbidden** pattern, with
the reason *"the dev harness is not shipped to users"*. So the vendored harness
copy cannot reach the tarball, and a future attempt to ship it fails the audit
rather than succeeding quietly. `pack:check` runs on the release branch's gate.

**4. Read against the Scan Checklist.** Compared prose written earlier in this
session against the skill's six habits. Three were being broken constantly:

- **Run-on sentences.** Em-dash chains joining three ideas were the default
  sentence shape, not the exception.
- **Soft phrasal verbs.** "pull it in", "ride along", "goes looking for".
- **Hedge stacking** in review summaries.

Two were mostly clean already: synonym rotation, and marketing adjectives. One
was mixed: nominalization appeared in issue prose more than in replies.

The rule was applied from the reply that proposed the release scope onward.

## Completion Checklist (domain agent)

- [x] N/A — orchestrator-implemented. This governs the orchestrator's own
      output, so delegating it would put the rule in a context that does not
      write to the user.

## Completion Checklist (orchestrator)

- [x] Committed with `[INFRA-030]` prefix — `a28e94a7`, pushed to `main`
