# [AGENT-024] The skills reach for a patch when the change is bounded

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-046 (`PatchDocRequest`, the `409` shape), SERVER-079 (the
  route), CLI-035 (`corpus doc patch`) — all landed on this branch
- Extends: AGENT-022 (the key loop), AGENT-023 (the revert loop) — this issue
  grows the same two sections rather than adding a heading

## Spec References

- SPEC.md **§9.2** — `POST /api/docs/:id/patch`, rider signed 2026-08-12:
  "the CLI exposes it as `corpus doc patch`, and **the agent's skills prefer it
  over a whole-body edit for bounded changes**"
- SPEC.md **§7** — "What needs a key": _"An anchored patch (§9.2) needs no key
  either: it names the text it expects to find, which is the same check by
  another route"_
- SPEC.md **§6** (anchor reconciliation), **§14** (validation), **§4** (one
  attributed commit) — a patch is an ordinary write once applied

## Summary

§9.2's patch bullet is signed, and the sentence that says the agent's skills
prefer a patch over a whole-body edit for bounded changes is currently **false**:
`corpus doc patch` shipped in this PR and neither installed skill knows the verb
exists. Every write example in `assets/workspace/` still reads the document,
sends the whole body back, and pays the length of the document for a one-line
correction — which is exactly the pricing §9.2 exists to fix.

This is not a mention to add. The verb changes _which write an agent reaches
for_, and that choice has to be legible without a lookup table: **a change you
can quote is a patch; a change you cannot quote is a whole-body edit.** Both
mistakes cost something real. An agent that rewrites for a line pays the whole
document for it and puts every other line at risk of a bad paste; an agent that
patches what should have been a rewrite turns one change into a pile of tiny
commits and a document left half-migrated.

Three things the text has to get right beyond "the verb exists":

1. **When to reach for it**, as a rule an agent can apply without a table.
2. **The revert loop grows a patch step.** A bounded revert — one paragraph, not
   a whole file — is precisely this verb's case, and it side-steps AGENT-023's
   frontmatter trap: `git show <sha>:<path>` piped into `corpus doc edit` writes
   the YAML block into the body a second time at exit 0, and a patch cannot make
   that mistake because both halves of it are body text.
3. **The two refusals must not blur.** They share exit `10` and have opposite
   recoveries. An agent that cannot tell "look again" from "quote more" guesses,
   and both guesses cost a round trip that teaches it nothing.

## Acceptance Criteria

- [ ] Both installed skills teach `corpus doc patch` as the verb for a bounded
      change, with the literal `--old` / `--new` flags as the example — not
      `--old-file`, `--new-file` or `--stdin`, which are escape hatches
- [ ] The choice between patch and whole-body edit is stated as one legible
      rule (quotable → patch; not quotable → edit), with the cost of getting it
      wrong in **both** directions
- [ ] Matching is stated as **byte-exact against the body as stored** — no
      trimming, no normalisation — and the body is named as excluding the
      frontmatter block
- [ ] **No `--key` on a patch**, said as a consequence rather than an omission:
      the excerpt _is_ the staleness check (§7), and it is the better one because
      it says _which_ text is gone
- [ ] The two refusals are distinguished in the agent's own decision terms, each
      with its own next move: **0 matches → re-read the document and quote what
      it says now**; **more than one → quote more context, or `--all` if every
      occurrence is what you meant**. Both are exit `10`, nothing written
- [ ] A `stale_key` from this route (exit `9`) is named as a **different** fact:
      something outside Corpus wrote the file
- [ ] `--new ''` is stated as how a deletion is spelled, and an omitted `--new`
      as a usage error rather than a deletion
- [ ] The revert loop in **both** skills gains a patch step for the bounded case,
      saying why it is safer than pasting a file: a patch quotes body text, so
      the frontmatter cannot be written in twice
- [ ] `scripts/workspace-template.test.ts` pins the above the way it pins the key
      loop, and additionally checks **every flag the template names against
      `docs/cli.md`** — a flag that does not exist must fail the suite
- [ ] Section counts unchanged: orchestrate **16**, comment **13**. No new
      heading; the teaching belongs inside `## Writing a document` and
      `## Doing the work`
- [ ] No fence in either skill is left open (a closing run alone on its line,
      AGENT-016), verified with a real CommonMark parser

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — `## Writing a document`
  gains the choice rule, the patch loop, the two refusals, and a patch step in
  the revert loop
- `assets/workspace/claude/skills/comment/SKILL.md` — `## Doing the work` gains
  the same, proportionally: it is the skill that edits a parent document in
  service of a thread, so it needs the whole rule, told shorter
- `scripts/workspace-template.ts` — parse per-command **flag** surfaces out of
  `docs/cli.md` (global flags table + each command's `**Flags**` table) and
  expose the flags used by each `corpus …` invocation in the template
- `scripts/workspace-template.test.ts` — a `prefer a patch for a bounded change`
  block; plus the general flag check across the whole template tree

### Key Implementation Details

The verb's real surface (`apps/cli/src/commands/doc/patch.ts`, `docs/cli.md`):

- `corpus doc patch <id> --from agent --old '<excerpt>' --new '<replacement>'`,
  plus `--all`. `--old-file` / `--new-file` read a file byte-for-byte; `--stdin`
  takes the whole request as one JSON object and therefore takes no other patch
  flag. Naming two sources for one side is a usage error, never a precedence.
- Byte-exact match against the body as stored. The trailing newline of a file or
  a heredoc is text like any other.
- No `key` field exists on the request — there is no flag to add.
- Refusals: exit **10** with `code: patch_no_match` or `patch_multiple_matches`,
  both naming the count, nothing written. Exit **9** (`stale_key`) from this
  route means an external editor moved the file between match and save.
- `--new ''` deletes; `--new` equal to `--old` is a no-op answered normally,
  writing nothing and making no commit, and the CLI says so.
- On success: `patched <id> — N occurrences replaced`, the anchor report, then
  `key <sha256>` on the next line — a patch hands back a fresh key like any
  other write.

Placement follows AGENT-022/023: no new heading, so `sections.size` stays 16/13.
In orchestrate the choice rule opens `## Writing a document` (it is the first
decision, before the key loop, which is now explicitly the whole-body path); in
comment it lands in the `Edit the parent` bullet plus the writing-loop paragraph
that follows the bullets.

The flag check is the generalisation the acceptance criterion asks for: the
invocation extractor drops flags today, so a skill could name `--replace` or
`--key` on a patch and nothing would notice. `parseCliDoc` gains a per-command
flag map (and the global flags), and a new scan reports the flags each template
invocation uses so the test can resolve them against the command they were used
with.

### Edge Cases

- The extractor is line-based: a multi-line quoted value only has its first line
  scanned, so keep each example's flags on the line that starts with `corpus`.
- `|` and `;` split an invocation into segments — never put either inside a
  quoted flag value in an example.
- A quoted value beginning with `-` must not be mistaken for a flag.
- `--all` must never be shown as the fix for an ambiguous excerpt without also
  saying "if that is what you meant" — an agent reaching for `--all` to make a
  refusal go away rewrites text it never looked at.

## Testing Strategy

`scripts/workspace-template.test.ts`, run scoped (`npx vitest run scripts`):

- Every `corpus doc patch` example in the template carries both `--old` and
  `--new` and no `--key`.
- Both skills state the quotable/not-quotable rule, byte-exactness, both
  refusals with their distinct recoveries and the shared exit `10`, the deletion
  spelling, and the no-key consequence.
- The revert loop in both skills offers the patch for the bounded case.
- Anti-vacuity: at least one worked patch example exists in each skill (a rule
  with no example is how AGENT-019's bug survived two rewrites).
- Every flag named in every template `corpus …` invocation resolves against
  `docs/cli.md` — for the command it was used with, or as a global flag.
- Section counts still 16 / 13; a CommonMark parse agrees and no code node is
  left unterminated.

## E2E Verification Plan

Real workspace, real server, real CLI — the skill text is only true if the
commands in it behave as written.

### Verification Steps

1. `corpus init` a scratch workspace under
   `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`, server on a free port
   (never 8765, never 5173).
2. Create a document, `corpus doc show` it, and walk the patch example verbatim:
   quote one line, replace it, read the printed key.
3. Force **both** refusals and record the exit codes and messages: an excerpt
   that is not there, and one that occurs twice — then fix the second by quoting
   more context, and again with `--all`.
4. Confirm `--new ''` deletes, an omitted `--new` is a usage error, and
   `--new` equal to `--old` writes nothing.
5. Confirm a patch needs no key: run one with no `--key` at all against a
   document whose key is stale in hand, and confirm it lands.
6. Confirm the anchor report and the commit: patch a passage a thread is
   anchored to and check the anchor still resolves, and that one commit was made
   authored by the agent.
7. Walk the bounded revert end to end: `git show` an old passage, patch it back,
   and confirm the frontmatter did not enter the body.

## E2E Verification Log

_Filled in by the implementing agent._

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
