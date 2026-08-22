# [SHARED-051] A persona is addressable by where it lives, and §10 says otherwise

## Domain

shared

## Status

done — **SIGNED 2026-08-19** and applied verbatim (revision 3)

## Priority

P0

## Model

fable

## Dependencies

- Depends on: SERVER-125 (the behaviour), UI-123 (the client half)
- Blocks: merging PR #50 without a recorded waiver
- Related: SHARED-049, SHARED-050 (two other unsigned riders — **read one at a
  time**, see below)

## Spec References

- SPEC.md **§10** line 541 — *"Creating a new skill or subagent document
  instantly makes it autocompletable — there is no separate registry."*
- SPEC.md **§8** line 409 — *"`@<subagent-name>` (a `type: agent-def` document's
  name) routes the work to that subagent"*
- SPEC.md **§7** line 399 — `.claude/agents/*.md` as the agent-def root
- SPEC.md **§7** line 323 — the residency rider's *"the same **invocable name**
  `@<subagent>` resolves (§8)"*

## Summary

PR #50's review found this, and it is the one finding in that review that no
amount of code can close.

SERVER-125 and UI-123 together establish a rule: **a `type: agent-def` or
`type: skill` document outside its discovery root is addressable by nothing.** No
mention resolves it, neither menu offers it, a designation naming it is a 404.
That is user-observable behaviour, and SPEC.md does not carry it.

Worse than not carrying it, **§10 line 541 now reads against it**:

> Creating a new skill or subagent document instantly makes it autocompletable —
> there is no separate registry.

`corpus doc create --type agent-def --title Legacy --folder inbox` creates a
subagent document that is autocompletable by nothing. The sentence is false after
this PR.

§8 line 409 is not false, but it is unqualified where it now needs a qualifier:
*"`@<subagent-name>` (a `type: agent-def` document's name) routes the work to
that subagent"*, with no mention of a root.

## How bad, precisely

**The default path is unaffected**, and that matters for judging this. Since
SERVER-122 and CLI-050 shipped in v0.11.0, `corpus doc create --type agent-def`
with **no** `--folder` lands in `.claude/agents/`, and such a document is
autocompletable exactly as §10 promises. The sentence is false only for the
explicit `--folder` opt-out.

So this is a spec sentence that is unqualified rather than one that is
wholesale wrong. It is still a MAJOR: the review's failure scenario is a user
reading the reference, following it, and getting silence.

**The reviewer did not dispute the decision.** Quoted:

> I do **not** dispute route 2 on the merits — the name-theft argument (an inert
> `data/docs/` note winning `@researcher` on id order) is decisive, and route 1's
> exit-6-forever objection is correct. The finding is that the decision outran
> the spec, not that it was wrong.

## The drafted text — read this back verbatim before applying

**Revision 3, 2026-08-18. Two earlier revisions were wrong, each caught by a
review, and the pattern in both is the same: the text was drafted from the
finding rather than from the code.** Revision 3 was written after reading
`invocableName` (`apps/server/src/threads/mentions.ts:137-149`) line by line.

- **Revision 1** said a document *"in its own root"* is autocompletable. A
  hand-authored `.claude/skills/SKILL.md` **is** in its own root, and is
  autocompletable by nothing. SERVER-127 had landed after the draft and nobody
  revisited it.
- **Revision 2** said a skill is named by *"the directory that holds it"*. The
  code returns `segments[0]` — **the first directory under the root, at any
  depth**. So `.claude/skills/foo/bar/SKILL.md` answers to `foo`, not `bar`, and
  this PR's own fixture asserts exactly that shape.

Both would have put a newly false sentence into SPEC while claiming to remove
one.

Two edits.

**Edit 1 — §10, line 541.** Replace the sentence:

> Creating a new skill or subagent document **in a shape its root names** (§7)
> instantly makes it autocompletable — there is no separate registry. A skill is
> named by the **first directory under `.claude/skills/`**, whatever depth its
> `SKILL.md` sits at; a persona by its own filename, written directly under
> `.claude/agents/`. A `type: skill` or `type: agent-def` document written
> outside those shapes — a `SKILL.md` no directory names, or a document filed
> elsewhere in the corpus — is a document **about** one, and is offered by
> nothing.

**Edit 2 — §8.** Insert as a new bullet after line 409:

> - **A persona is addressable by where it lives, not only by what it declares.**
>   `@<subagent-name>` resolves a `type: agent-def` document written **directly
>   under `.claude/agents/`** (§7), by that filename's stem or by the document's
>   title alike. A document declaring `type: agent-def` anywhere else is a
>   document *about* an agent, and resolves to nothing: no composer offers it, no
>   designation names it, and a mention of its title is reported unresolved
>   exactly as any other name that names nobody is. The same holds for
>   `type: skill` and `/<skill-name>`, where the name is the **first directory
>   under `.claude/skills/`** — a `SKILL.md` at any depth beneath that directory
>   answers to it, so a directory holding more than one gives them a single name
>   between them, and a `SKILL.md` no directory names answers to nothing. Writing
>   a document *about* a persona or a skill elsewhere stays legal and is the
>   point: it is an ordinary document, listed, readable and editable like any
>   other. **The alternative was shipped and withdrawn**: honouring the title
>   wherever the document sat meant two documents could carry one title, ties
>   broke by internal id order, and an inert note in `data/docs/` could take a
>   working persona's name away from it. _(Rider signed 2026-08-\_\_.)_

## What the sign-off decides

1. **Whether to sign at all, or to revert SERVER-125.** Reverting restores §10's
   sentence and restores the name theft with it. The draft assumes signing.
2. Whether Edit 2 belongs in §8 or in §7 beside the root declaration. The draft
   puts it in §8 because §8 is where resolution is specified, and §7 line 399
   already declares the root without claiming it gates addressing.
3. Whether the withdrawn-alternative sentence stays. It is unusual for this spec
   to record a reversal in normative text. It is kept deliberately, because the
   next reader who finds the title alias missing will otherwise reinstate it.

## Read one rider at a time

Three riders are now drafted and unsigned: this one, SHARED-049 (§4 and §7's
skill enumeration) and SHARED-050 (§8, the agent's register). **They must be read
and signed separately**, even though two of them touch §8.

Batching riders is how a live §4/§7 contradiction survived a sign-off before
(SHARED-045). Quote each draft, read it aloud, sign or refuse it on its own.

## Acceptance Criteria

- [x] The user has signed the drafted text, verbatim, on its own — 2026-08-19
- [x] SPEC.md §10 no longer states that creating a subagent document anywhere
      makes it autocompletable
- [x] SPEC.md §8 states the root gate, and says a document about a persona stays
      an ordinary document
- [x] `npm run spec:check` passes — 5,862 citations
- [x] No other §8 or §10 sentence is reworded to agree with it
- [x] n/a — signed after v0.12.0 shipped. The release notes already stated the gap honestly, which is what made this signable later without a re-release
      that §10's sentence is stale, and the waiver is recorded as the
      orchestrator's rather than described as unnecessary

## Technical Design

### Files to Create/Modify

- `SPEC.md` — §10 line 541 and §8 after line 409

### Key Implementation Details

Quote rather than paraphrase when reading it back. Paraphrase is how §9.2 and §4
came to disagree (SHARED-045).

Apply only what is signed. A partial signature applies the signed part.

## Testing Strategy

`npm run spec:check` covers the cross-references. The behaviour itself is already
covered by `scripts/mention-offer-parity.test.ts`, which asks the server and the
client the same question about the same fixture.

## E2E Verification Plan

### Verification Steps

1. `git diff SPEC.md` shows exactly the signed text and nothing else
2. `npm run spec:check` passes

## E2E Verification Log

_[Filled after sign-off]_

## Completion Checklist (domain agent)

- [ ] N/A — orchestrator-applied after sign-off

## Completion Checklist (orchestrator)

- [ ] Committed with `[SHARED-051]` prefix
