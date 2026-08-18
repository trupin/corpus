# [AGENT-037] The workspace ships the skill, and the agent writes by it

## Domain

agent-runtime

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: INFRA-030 (the harness half — same skill, same pinned commit)
- Depends on: SHARED-050 (the SPEC sentence; **do not block on it** — see below)
- Related: SHARED-049 (§7's skill enumeration, which this issue makes worse)

## Spec References

- SPEC.md **§7** line 129 — the shipped skill set, given as *"orchestrate,
  comment (+ plugin skills)"*
- SPEC.md **§8** lines 405-413 — agent participation semantics. SHARED-050 adds
  the register bullet here
- SPEC.md **§10** — plugin skills reach `.claude/skills/` the same way

## Summary

`corpus init` installs four skills into a workspace. This issue adds a fifth, and
wires the rule that makes it apply to **everything the product agent writes**.

The user directed this on 2026-08-18 and answered both scoping questions before
any work started:

| Question | Answer |
| --- | --- |
| Harness, product, or both? | **Both.** INFRA-030 is the harness half |
| How far into the agent's writing? | **Everything it writes**, thread replies included |

Do not reopen either. In particular, do not narrow the second one to "machine
text only" because a thread reply reads better without the rule — that option was
offered explicitly and was not chosen.

## A skill file alone is inert

A skill fires when something invokes it. This one's triggers are on-demand:
*"disambiguate"*, *"STE100 rewrite"*, *"apply Simplified Technical English"*.
Nothing in the ordinary act of answering a comment invokes it.

So copying the directory into the template does **half** the work and produces
none of the behaviour. The other half is a standing rule the agent reads every
session. **The template has no CLAUDE.md today** — only skills — so this issue
has to choose where the rule lives.

## The choice this issue must make and record

**Option A — add a `CLAUDE.md` to the workspace template.** One home for the
rule, matching how the harness half works, and a natural place for later
workspace-wide rules. Cost: a new template file, so `corpus init`'s file count
and `scripts/workspace-template.test.ts` both change, and a user who edits it
gets a merge question on every upgrade.

**Option B — state the rule in each of the four existing skills.** No new file.
Cost: the same paragraph four times, and four places to forget when a fifth skill
ships. That is precisely the failure SHARED-049 documents.

**Recommendation: A.** Record the rejected option and why it lost, in the issue
and in the commit.

## Acceptance Criteria

- [ ] `assets/workspace/claude/skills/asd-ste100/` holds `SKILL.md`,
      `references/writing-rules.md`, `examples/before-after.md` and `LICENSE`,
      byte-identical to INFRA-030's copy and to the same pinned upstream commit
- [ ] A `PROVENANCE.md` states the source, commit, author and licence, exactly as
      the harness copy does
- [ ] The standing rule reaches the agent, in one recorded place, and names
      **STE-flavored** mode
- [ ] The rule states what it does **not** cover: quoted document text, server
      error text, command output, and a person's own words all reach the reader
      unchanged
- [ ] The rule states that a hedge keeps its strength, with the `may have failed`
      example — this is the failure mode the skill calls most common
- [ ] `scripts/workspace-template.test.ts` knows the new skill, and its installed
      set assertion fails without it
- [ ] `corpus init` on a throwaway workspace installs it, and the reported file
      count matches the new total
- [ ] `npm run pack:check` passes — the skill is in the tarball, since
      `assets/workspace/` is staged into the published package
- [ ] The E2E log records **how the comment skill reads afterwards**, in the
      author's own words. This is the surface where the accepted cost lands, and
      the user asked to be told

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/asd-ste100/**` — vendored, five files
- `assets/workspace/CLAUDE.md` — new, if Option A
- `scripts/workspace-template.test.ts` — the installed set, and the pins
- `assets/workspace/README.md` — mention it if the README enumerates skills

### Key Implementation Details

**Do not edit the vendored files.** Copy them from `.claude/skills/asd-ste100/`,
which INFRA-030 pinned. Two copies of one upstream file that disagree is worse
than either.

**Both trees keep their own copy on purpose.** `.claude/` is the development
harness and reaches no user. `assets/workspace/` is the product. A symlink or a
build step that shares one copy would couple the harness to the tarball, which is
the confusion `CLAUDE.md`'s "Product vs. dev harness" paragraph exists to stop.

**Ship it even if SHARED-050 is unsigned.** The user directed the behaviour
directly. The rider records it in the spec and does not authorise it. If the
signature has not arrived, ship and say so in the release notes.

### Edge Cases

- **A quotation inside a reply.** The agent quotes document text constantly —
  anchored passages, frontmatter, diffs. None of it may be rewritten. Getting
  this wrong corrupts what a person wrote, which is worse than dense prose.
- **A refusal or an error relayed from the server.** The agent's framing follows
  the rule. The server's own string is quoted, not rewritten.
- **The `profile` skill's worked examples** contain shell transcripts. A
  transcript is output, not prose.
- **Plugin skills** are outside this issue. A plugin author is not bound by it,
  and nothing here should imply that they are.

## Testing Strategy

`scripts/workspace-template.test.ts` gains: the installed-set row, a presence pin
for the vendored files, and pins for the two sentences most likely to be dropped
in a later edit — the quotation exemption and the hedge rule.

Falsify each pin by deleting the sentence it covers and watching that pin alone
go red. A pin that passes against a file with the sentence removed is testing
nothing.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port **not 8765** and **not 5173**
2. `corpus init` — the skill directory is present, the file count matches
3. Read the installed `CLAUDE.md` (or the four skills, if Option B) and confirm
   the rule is discoverable without knowing it exists
4. Confirm the vendored files match `.claude/skills/asd-ste100/` byte for byte
5. `npm run pack:check` — the skill is in the tarball
6. Read the `comment` skill end to end and write down how it reads under the new
   rule, for the report
7. Stop the server; confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-037]` prefix
