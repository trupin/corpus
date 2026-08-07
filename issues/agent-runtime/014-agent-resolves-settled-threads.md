# [AGENT-014] Agent resolves a settled subthread in the same turn as its reply

## Domain

agent-runtime

## Status

todo

## Priority

P1 (important)

## Model

opus

## Dependencies

- Depends on: **SHARED-019** (signed by the user 2026-08-05; both amendments
  applied to SPEC.md — verified in place, §7 line 285 and §8's re-trigger bullet)
- Blocks: —
- Related: **SERVER-062** (done) — Amendment 1's half. It is what makes this
  issue safe rather than reckless: until a person's reply reopened a resolved
  thread, an agent-resolved thread was a one-way door and the skill's standing
  prohibition was correct. **SHARED-018 / UI-077** (done) — the interlock: a
  thread carrying an unseen turn is never collapsed *by rule*, so the closing
  reply this issue requires is always read before the conversation folds away.

## Spec References

- SPEC.md **§7**, the **Comment skill** paragraph — the signed permission this
  issue implements, verbatim from "**The agent closes conversations it asked for
  and got.**" to "_(Rider signed 2026-08-05.)_"
- SPEC.md **§8** — the re-trigger bullet and the reopen rule it now carries
  ("Resolved is a closed door, not a locked one: a person's reply reopens it.")
- SPEC.md **§6** — thread `status: open | resolved`; the trace line; forms in
  turns
- SPEC.md **§7**, Agent stewardship — "every change leaves a visible trace";
  archive and resolve, never delete

## Summary

SHARED-019 is signed and its SPEC text is applied, but the skill the product
agent actually reads still says the opposite. `assets/workspace/claude/skills/comment/SKILL.md:396`
states, verbatim and today:

> - **Do not resolve on the person's behalf.** Run `corpus thread resolve <id> --from agent`
>   only when they asked for the matter to be closed. A thread you resolved unilaterally stops
>   waking you, which is exactly the failure they cannot see.

So a workspace running the shipped skill has a spec that permits the behaviour
and an agent that refuses it — and, worse, refuses it *for a reason that is no
longer true*. The stated hazard was "a thread you resolved unilaterally stops
waking you". SERVER-062 removed exactly that: a person's turn on a resolved
thread reopens it and then re-triggers on §8's ordinary terms. The skill is
carrying a warning about a door that now has a handle on the far side.

The behaviour this issue installs is the narrow one the user settled: **the agent
resolves only where the person already answered.** The agent asked for feedback
or information, the person provided it, the agent used it, nothing is pending —
and the resolution rides on the reply turn that reports the work, never as a bare
silent act.

The reason the narrowness is load-bearing rather than caution: a thread stays
open because someone has to do something about it, and the open state is what an
unanswered ask *is*. A rule that let the agent close a thread nobody replied to
would let it retire its own unanswered questions, which is the one failure the
person cannot see — they would have to already know the thread existed to notice
it had gone quiet.

## The trigger, and the four exclusions

Straight from the signed §7 text; the skill must state both halves, because a
permission whose limits live only in SPEC will drift the first time the skill is
edited.

**May resolve** — all four at once:

1. The agent asked the person for feedback or information,
2. the person **provided it** (their own turn in the thread is the evidence),
3. the agent has **used** it, and
4. nothing in the thread is still waiting on anyone.

**Never resolves** — each named explicitly in §7, so each is a rule and not a
judgment call:

- **A thread the person never replied to.** "An unanswered ask is exactly what
  the open state is for." Silence is not an answer, and no amount of elapsed time
  converts it into one.
- **A thread holding an unanswered form** (§6). §6 makes these surface in
  Attention as "awaiting your answer" — an outstanding ask by definition.
- **An unfinished piece of the agent's own work.** The thread is open because the
  agent owes something, and closing it would be the agent marking its own
  homework done.
- **A question the person put to the agent that the agent has not yet answered.**

**Authorship is irrelevant.** §7: "Who opened the thread does not matter." The
commonest real shape is a thread the *person* started — they ask, the agent needs
one clarification, they clarify, the agent finishes — and keying the permission
to authorship would forbid precisely that while permitting almost nothing else.

**Nothing cascades.** A child thread is its own document with its own status.
Resolving a subthread does not resolve its parent, and resolving a parent does
not resolve its children. This is the case the user described in the first place:
a settled sub-question inside a live conversation, resolvable without touching
the conversation around it.

## Acceptance Criteria

- [ ] `assets/workspace/claude/skills/comment/SKILL.md`'s "Do not resolve on the
      person's behalf" bullet is **replaced** — it does not survive this issue
      in any form, including a softened one
- [ ] The replacement states the **trigger** (all four conditions) and **all four
      exclusions** by name, so the skill is readable without SPEC beside it
- [ ] The skill states that resolution **rides on the reply turn** — one
      `corpus thread reply` and one `corpus thread resolve` for the same act,
      never a resolve with no readable turn attached
- [ ] The skill states that the closing turn **says in words** that the matter is
      being closed, per §7 ("always stating in that turn that it is closing the
      matter")
- [ ] The skill's stale hazard sentence ("A thread you resolved unilaterally
      stops waking you") is removed or corrected — SERVER-062 made it false
- [ ] The skill's **Engagement and closure** section states the reopen rule: a
      person's reply to a resolved thread reopens it and reaches the agent again;
      an agent turn never reopens. Today it states neither, so the agent has no
      account of what resolving costs
- [ ] The skill states that resolving **never cascades** to parent or children
- [ ] The exact CLI invocation is named and correct: `corpus thread resolve <id> --from agent`
- [ ] `assets/workspace/claude/skills/orchestrate/SKILL.md` is checked for a
      contradicting statement and corrected if one exists
- [ ] No new state, no timers, no sweeps — see Non-goals

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/comment/SKILL.md` — the **Engagement and
  closure** section (currently lines 384–398). Two edits, not one: the bullet
  list's prohibition is replaced, and the section's opening paragraph gains the
  reopen rule.
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — read-and-check only;
  edit only if it contradicts.
- Any test that pins the skill's text or its shipped bytes — locate it before
  editing (the workspace template is copied by `corpus init` and there are
  packaging assertions over `assets/workspace/`).

### Key Implementation Details

**Where the text goes, and why there rather than in a new section.** The
prohibition being reversed sits in **Engagement and closure**, immediately after
the paragraph explaining that an engaged thread re-triggers on every later user
turn. That paragraph is the agent's whole model of what resolving *does*, and it
is now incomplete: it says a resolved thread stops re-triggering and stops there,
which was the entire basis of the prohibition. Putting the permission anywhere
else would leave the two halves of one rule in two places, and the next editor
would find the old reasoning intact and reinstate the prohibition from it.

**"In the same turn as the reply" is an ordering constraint, not a wording
preference.** §7 requires the resolution to ride on the reply "never as a
separate silent act". Mechanically that means: write the reply with
`corpus thread reply <id> --from agent`, then `corpus thread resolve <id> --from agent`.
Resolve-then-reply also produces a readable turn, but SERVER-062's author rule
means the agent's own reply does not reopen what it just closed, so either order
lands in the same state — the rule the skill must state is that **there is always
a turn**, not which of the two commands runs first. Say it that way rather than
prescribing an order the agent might reasonably deviate from.

**Why the closing turn must say so in words.** SHARED-019's Q5 declined a
schema-level distinction between an agent-resolved and a person-resolved thread:
`status` stays `open | resolved`, and git already records the acting party as the
commit author. The agent's own sentence is therefore the *only* thing on screen
that tells the reader who closed the conversation and why. §7's trace-line
convention already exists for reporting what a turn did to the corpus, and
resolving is a state change to a document — so the natural home is the trace
line. The skill's trace-line grammar (line 361: arrow, one line, past tense,
final line only) already accommodates it; state the resolution as part of that
line rather than inventing a second convention.

**The interlock with collapse, stated so the skill's author knows why the turn is
non-negotiable.** SHARED-018 (shipped as UI-077) collapses resolved threads by
default. Without the closing reply, an agent-resolved thread would fold itself
away with nothing new in it for the person to have seen. The rule that saves it
lives in SHARED-018's text — a thread carrying an unseen turn is never collapsed
by rule — and it only bites if there *is* an unseen turn. A bare
`corpus thread resolve` produces none. So "never a silent act" is what stops the
two signed riders from composing into a conversation that disappears.

**The judgment stays in the skill; the permission is in SPEC.** SHARED-019's Q4
settled this: §7 and §8 carry the observable behaviour, and "has this actually
run its course" is skill material. So the replacement text should read as
guidance to an agent making a call, not as a specification restated — the house
style of the rest of this file.

### Edge Cases

- **The person answered, and asked something new in the same turn.** Condition 4
  fails: something is still waiting on the agent. Answer it; do not resolve.
- **The person's answer was itself a form answer.** It is a turn a person wrote,
  so it satisfies condition 2 — and per SERVER-062 it also reopens a resolved
  thread (`apps/server/src/threads/forms.ts:145`). A thread whose only pending
  item was the form the person just answered is resolvable.
- **A thread with several forms, one answered and one not.** Excluded — "a thread
  holding an unanswered form" is not qualified by how many.
- **The agent resolves, then the person replies.** The thread reopens and the
  agent is re-triggered (§8). This is the designed recovery path and the skill
  should say so, because an agent that believes resolving is final will resolve
  too timidly.
- **A thread already resolved.** `corpus thread resolve` is idempotent and reports
  "already resolved"; do not treat that as an error.
- **A locked parent document.** Resolving a thread writes the thread document,
  not the parent — but if the write is refused, report it rather than retrying
  blind (the skill's standing lock rule).
- **A thread the agent is not engaged in.** The permission is about closing a
  conversation the agent participated in; a thread it never replied to cannot
  satisfy conditions 1 and 3.

## Testing Strategy

This is skill text, so the tests that exist are the ones over the shipped
workspace template — confirm what they are before writing:

- Whatever assertion pins `assets/workspace/` into the packed tarball still
  passes (`scripts/pack-audit.ts` territory).
- If the repo has a test asserting the skill's headings or required sections,
  update it to require the replacement rather than tolerate its absence.
- **Add a guard for the reversal itself**: a test asserting the string "Do not
  resolve on the person's behalf" does **not** appear in the shipped skill. A
  reverted prohibition that silently reappears in a later edit is the exact
  failure this issue exists to fix, and it is cheap to pin.

## E2E Verification Plan

The real test is behavioural and runs through the product agent, not through a
unit test. Verify against a real workspace.

### Verification Steps

1. `corpus init` a scratch workspace on a non-default port; confirm the installed
   `.claude/skills/comment/SKILL.md` carries the new text (the template is
   copied at init, so this also proves the packaging path).
2. Start the real server. Create a document; comment on it as the person with a
   request that requires information the agent does not have.
3. Run the agent loop. The agent replies asking for the information.
4. **Do not answer.** Confirm the thread is still `open` — `corpus thread show <id>`
   — and that no resolve was attempted. This is the exclusion that matters most.
5. Answer, as the person. The agent is re-triggered, does the work, and replies.
6. Expected: the thread is `resolved`, the resolution arrived **with** a turn,
   and that turn says in words that the matter is closed. Confirm with
   `corpus thread show <id>` (status + last turn body) and with `git log` (the
   resolve commit's author is `agent`).
7. Reply again as the person. Expected: the thread is `open` again and an event
   was enqueued (`corpus queue claim-all` or the console) — the recovery path.
8. **Form exclusion**: repeat with an agent turn carrying an unanswered form;
   confirm the agent does not resolve while it is unanswered.
9. **No cascade**: open a child thread under a turn, let the agent settle and
   resolve the child, and confirm the parent's `status` is unchanged.
10. In the UI, confirm the agent-resolved thread shows its closing reply
    **expanded** until read (the SHARED-018 interlock), and collapses only after.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the
implementing agent ran on ("implemented on: opus | fable")._

### Post-Implementation Verification

_[Agent fills: workspace path, port, exact commands, observed output, thread
status transitions, git authors, confirmation of each exclusion.]_

## Non-goals

Carried from SHARED-019 so the implementation cannot drift into them:

- **No new state.** `status` stays `open | resolved`. No "auto-resolved", no
  "pending close", no expiry.
- **Nothing time-based.** The agent never resolves a thread because it went
  quiet.
- **No bulk or retroactive resolution.** Per-thread, in the course of working one
  event. A sweep would violate §7's "never enumerate the corpus" anyway.
- **The agent still never deletes.** Archive and resolve, never delete.
- **No change to what triggers the agent** beyond the reopen SERVER-062 already
  shipped.
- **No change to Attention.** Resolving does not clear an unread mark.
- **Not a collapse feature.** What a resolved thread looks like is UI-077's
  question.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[AGENT-014]` prefix
