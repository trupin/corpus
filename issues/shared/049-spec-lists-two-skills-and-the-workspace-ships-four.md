# [SHARED-049] SPEC enumerates two product skills and the workspace ships four

## Domain

shared

## Status

done — signed by the user 2026-08-20 (as drafted, in the v0.15.0 go-ahead). SPEC.md text applied 2026-08-20; any downstream code half is tracked by its own issue.

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

- SPEC.md **§4** line 129 — the shipped skill set, given as *"orchestrate,
  comment (+ plugin skills)"*, as a comment inside `corpus init`'s directory tree
- SPEC.md **§7** line 339 — the orchestrator skill, named explicitly

**Correction, 2026-08-18.** This issue was filed citing *§7* line 129. That is
wrong: §4 runs from line 109 to line 187, so line 129 is in **§4**, the workspace
layout. §7 begins at line 305. Only the second reference was right.

The mistake matters for the amendment, and not only for tidiness. The stale list
is **an annotation inside a directory listing**, not a normative sentence. That
weakens the case for repairing the list and strengthens the case for removing it:
a tree diagram exists to show where files live, and it is a poor place to carry a
promise about which files exist.

`npm run spec:check` did not catch this, and could not. It verifies that a cited
section **exists**, which §7 does. Nothing verifies that a citation points at the
text it claims to quote (INFRA-029 established the first check; the second is a
harder problem and is not filed).

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

1. Whether the spec enumerates product skills, or describes the category and
   points at the workspace
2. If it enumerates: the current names, and whose job it is to update the list
   when the next one ships — a rule with no owner is how this one aged
3. Whether `converse` and `profile` need a sentence each beyond their names, as
   `orchestrate` has at line 339

**A fifth skill is already coming.** AGENT-037 installs `asd-ste100` in the same
week (Phase 35, user directive 2026-08-18). Repairing the list to say four would
be wrong before the amendment shipped.

## The drafted text — read this back verbatim before applying

Two edits, and they are one decision: **describe, do not enumerate.**

**Edit 1 — §4, line 129.** Replace the comment in the directory tree:

> ```
>     skills/                 # the agent's skills, installed by `corpus init` (+ plugin skills) — indexed as documents (§7)
> ```

**Edit 2 — §7.** Insert immediately before the **Orchestrator skill** paragraph
at line 339:

> **The workspace's skills are whatever `corpus init` installs, and this document
> does not list them.** A skill declares what it is for in its own frontmatter
> description, exactly as a plugin's skills do (§10), and `corpus init` reports
> what it installed. This spec names an individual skill only where a rule
> depends on **that** skill — the orchestrator skill below is such a rule, and the
> agent's register (§8) is another. Every list of skills this document has carried
> has gone stale, and a list that is wrong teaches a reader less than no list at
> all. _(Rider signed 2026-08-\_\_.)_

### How each question is answered, and what was rejected

| Question | Answer | Rejected, and why it lost |
| --- | --- | --- |
| 1. Enumerate or describe? | **Describe** | Enumerating is what created this issue. §11 already describes rather than lists for plugin skills, so describing is the established pattern rather than a new one |
| 2. Who maintains the list? | **Nobody — there is no list** | "Name an owner" was the obvious repair. It lost because the rule that aged had an implicit owner too. A rule needing a person to remember it is the failure, not the fix |
| 3. Sentences for `converse` and `profile`? | **No** | They earn no mention, because no rule in the spec depends on either in particular. `orchestrate` and `asd-ste100` do, and both keep theirs |

**What this costs.** A reader of SPEC.md alone no longer learns which skills they
get. That is a real loss, and it is accepted: the authoritative answer is
`corpus init`'s own output and the skills' frontmatter, and those cannot go stale
because they are the thing itself.

## Acceptance Criteria

- [ ] The user has signed the drafted text
- [ ] SPEC.md no longer states a skill set that disagrees with what `corpus init`
      installs
- [ ] **A check exists either way.** Dropping the list is not enough on its own:
      nothing stops the next author writing a new one. The pin below holds
      whichever way the amendment goes
- [ ] No other §4 or §7 sentence is edited to agree with it
- [ ] `npm run spec:check` passes

## Technical Design

### Files to Create/Modify

- `SPEC.md` — §4 line 129 and §7 line 339
- `scripts/workspace-template.test.ts` — the pin

### Key Implementation Details

Draft the text, read it back to the user verbatim, and apply only what is signed.
Quote rather than paraphrase — paraphrase is how §9.2 and §4 came to disagree
(SHARED-045).

**The pin has to survive the amendment it is testing.** A pin asserting "SPEC
lists exactly these four skills" would have to be deleted by this issue and gives
nothing afterwards. Assert the invariant instead:

> Every skill directory name that appears in SPEC.md exists in
> `assets/workspace/claude/skills/`.

The pin fires on one condition only: a skill name in SPEC.md that is **not**
installed. No such name exists today, so the pin passes against both the old text
and the new one. It is not a test of this amendment.

Its value is forward-looking, and it holds under either decision:

- If the list is dropped, the pin stops a future author reintroducing a name that
  does not exist.
- If a list is ever kept, the pin makes it self-checking.
- When a skill is renamed or removed, the pin goes red in SPEC.md, which is
  exactly where a reader would otherwise never find out.

It does **not** catch the reverse case — an installed skill SPEC does not
mention — and that is deliberate, because after this amendment that is the normal
state of every skill.

## Testing Strategy

The pin above, in `scripts/workspace-template.test.ts`, which already reads the
installed set.

Falsify it by adding a fictional skill name to a copy of the SPEC text under test
and confirming the pin alone goes red. A pin that passes against a SPEC naming a
skill that does not exist is testing nothing.

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
