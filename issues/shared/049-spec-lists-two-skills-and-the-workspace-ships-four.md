# [SHARED-049] SPEC enumerates two product skills and the workspace ships four

## Domain

shared

## Status

todo — **NEEDS USER SIGN-OFF.** Drafted 2026-08-17, not applied. SPEC.md changes
are the user's.

## Priority

P2

## Model

fable

## Dependencies

- Depends on: —
- Blocks: —
- Related: AGENT-034 (`profile`, the newest skill), AGENT-025 (`converse`, the
  one before it)

## Spec References

- SPEC.md **§7** line 129 — the shipped skill set, given as *"orchestrate,
  comment (+ plugin skills)"*
- SPEC.md **§7** line 339 — the orchestrator skill, named explicitly

## Summary

§7 enumerates the product skills `corpus init` installs, and the enumeration is
**two skills stale**.

| skill | ships | in §7's list |
| --- | --- | --- |
| `orchestrate` | yes | yes |
| `comment` | yes | yes |
| `converse` | yes (Phase 32, AGENT-025) | **no** |
| `profile` | yes (Phase 34, AGENT-034) | **no** |

`corpus init` reports *"installed 10 template files"* and `.claude/skills/` holds
four directories plus any plugin's.

Found by PR #49's review. **The mechanism each skill uses is spec'd** — §7 line
399 declares the document roots, §11 line 539 says creating a subagent document
makes it addressable with no separate registry — so this is not a capability
shipping unspecified. It is an enumeration that has stopped enumerating.

Filed rather than fixed because **SPEC.md changes require the user's sign-off**,
and this one was found after the release scope was agreed. The rider signed for
this phase (SHARED-048) authorised one specific insertion into §7 and nothing
else.

## Why it is worth an amendment rather than a shrug

A list that is wrong is worse than no list. §7's is the only place a reader
learns what a workspace comes with, and `profile` is the thing the user asked for
by name in this release. Someone reading §7 to find out what their agent can do
will not learn that it can write a persona for them.

There is a second question underneath, and it is the one worth the user's
attention: **should §7 enumerate skills at all?** Every enumeration in this
document has gone stale at least once, and the alternative — describing what a
skill *is* and letting the installed set answer for itself — is what §11 already
does for plugin skills. Naming them has value (a reader wants to know what they
get) and cost (this issue). The amendment should decide that, not just append two
names.

## What the amendment must decide

1. Whether §7 enumerates product skills, or describes the category and points at
   the workspace
2. If it enumerates: the four current names, and whose job it is to update the
   list when a fifth ships — a rule with no owner is how this one aged
3. Whether `converse` and `profile` need a sentence each beyond their names, as
   `orchestrate` has at line 339

## Acceptance Criteria

- [ ] The user has signed the drafted text
- [ ] SPEC.md §7 no longer states a skill set that disagrees with what
      `corpus init` installs
- [ ] If the enumeration is kept, something checks it — a stale list that nothing
      verifies will age again, and `scripts/workspace-template.test.ts` already
      knows the installed set
- [ ] No other §7 sentence is edited to agree with it

## Technical Design

### Files to Create/Modify

- `SPEC.md` — §7
- `scripts/workspace-template.test.ts` — the check, if the enumeration is kept

### Key Implementation Details

Draft the text, read it back to the user verbatim, and apply only what is signed.
Quote rather than paraphrase — paraphrase is how §9.2 and §4 came to disagree
(SHARED-045).

## Testing Strategy

If the enumeration is kept: a pin asserting §7's list equals the skill
directories under `assets/workspace/claude/skills/`. That is the whole value of
keeping it.

## E2E Verification Plan

### Verification Steps

1. `git diff SPEC.md` shows exactly the signed text
2. The pin, if added, fails against the pre-amendment list

## E2E Verification Log

_[Filled after sign-off]_

## Completion Checklist (domain agent)

- [ ] N/A — orchestrator-applied after sign-off

## Completion Checklist (orchestrator)

- [ ] Committed with `[SHARED-049]` prefix
