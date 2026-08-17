---
description: "Agree what goes into the next release, then build it end to end without checking in. Proposes a scope, takes the user's additions, and on their go-ahead runs to a tagged release — making every judgment call along the way and reporting them afterwards."
user_invocable: true
---

Agree a release scope with the user, then build it to a tagged release without
interrupting them for judgment calls.

**The shape this skill exists to reproduce**: the orchestrator proposes what
should go in and why, the user confirms or adds, and on "go" the orchestrator
works to a released tag — making the calls itself and reporting them at the end
rather than one at a time. Do not skip the proposal step and do not start
building before the user says go.

**There is exactly one conversation, and it happens before the work.** After the
go-ahead the user is spending their attention elsewhere; the release arriving
with a written account of the decisions is the thing they are trading for. A
skill that asks "which of these two?" every twenty minutes has delivered nothing
they could not have got by doing it themselves.

## 1. Establish what actually shipped last time

Before proposing anything, find out what the last release really contains — not
what its notes claim.

```
git log --oneline $(git describe --tags --abbrev=0)..HEAD
gh release view $(git describe --tags --abbrev=0) --json name,body
```

Then check the last release's own scope against the tracker: if it belonged to a
phase, how many of that phase's issues actually landed?

**If the previous release's notes overstate what shipped, say so plainly and
offer to correct them.** A release titled for a feature whose machinery is still
`todo` sends the user looking for something that is not there. This has happened
in this repo. Correcting the notes does not rewrite the tag.

## 2. Read the ground truth

- `issues/PLAN.md` — statuses, and which issues are _ready_ (all dependencies
  `done`) versus blocked
- `git status --short` — uncommitted work is part of the scope whether or not
  anyone planned it
- Anything the user has reported in this session that is not yet filed

Compute readiness rather than trusting a status column; a row can say `todo`
while its blocker is long done.

## What makes a release

Scope selection has rules, and they are about coherence rather than size.

**A release is a body of related work, not a commit.** One fix that happens to be
ready is not a release; it is a commit that can wait for one. What makes a set of
commits a release is that a single sentence describes them and a user can tell
what changed about their day.

**A release never ships a half-built feature.** If it starts a feature, it
finishes it — every part needed to _use_ the thing, not merely to have built
toward it. The test is blunt: **can the user do the thing the release is named
for?** If the wire carries it, the server records it, and no surface exposes it,
the feature did not ship, whatever the issue tracker says.

This is not hypothetical here. v0.9.0 shipped three of a thirteen-issue phase —
a signed spec, the wire fields and a server-side stamp — and was titled _"a
conversation can have a resident"_. A conversation could not. Designation,
lanes, presence, the CLI verbs, the skills and both UI surfaces were all still
`todo`, so a user who read the title went looking for something that did not
exist.

**Two honest ways out of that**, and both are better than the third:

1. **Finish the feature in this release.** Preferred. Pull the rest of the arc in
   and ship it whole.
2. **Ship the groundwork under its own name.** "Provenance, and the spec for
   resident agents" is a true headline for the same commits. Infrastructure is an
   honest thing to release; it just may not borrow the name of the feature it is
   for.

The third way — shipping part of a feature under the feature's name — is the one
to refuse, and it is the easy one to fall into because the work really was done.

**Prefer finishing an arc already in flight over starting a new one.** A phase
half-landed is a promise the spec has made and the code has not, and every issue
built afterwards is built against a description of machinery nobody can run.

**Bounded debt may ride along.** Correctness bugs in files the release already
touches are cheap to include and expensive to route around later. Debt that
merely _exists_ is not a reason to widen the scope.

## 3. Propose a scope

Present a table of what is in hand (done-but-uncommitted, in progress, filed),
then propose additions in groups, each with a reason:

- **Whatever finishes what is already started** — first, and not optional. If the
  release touches a feature at all, the issues that make it usable are in scope
  by default, and leaving one out needs an argument.
- **Same work** — issues that are really the same design as something already in
  scope. Doing them apart means designing one idea twice.
- **Same theme** — issues that share the release's story. A release with a single
  sentence behind it is one a user can understand.
- **Nearby debt** — correctness bugs in files the release already touches.

Say what you are **leaving out** and why. A proposal that only adds is not a
proposal.

**Name the riskiest item and what happens if it slips.** A release should not
wait on its least predictable piece; say which one you would drop.

End with a concrete recommendation and a request for confirmation or additions.

## 4. Wait

The user confirms, adds, or removes. **Do not begin implementing during this
step** — the point of the conversation is that the scope is agreed before work
starts.

## 5. On "go", set the goal and run

Once the user gives the go-ahead, restate the agreed scope in one line, then work
to the release without stopping for judgment calls:

- File any unfiled work as issues first (`issues/<domain>/NNN-*.md` plus a
  `PLAN.md` row) — issue-first, always
- Group by domain and parallelise, respecting the machine-load cap of ~3
  concurrent implementation agents
- One commit per issue, `[ISSUE-ID]`-prefixed. Never `git add -A` across issues
- Per-phase PR, babysat to green CI, reviewed by a fresh `pr-reviewer`
- Then `npm run release:prepare <x.y.z> "<headline>"`, push the commit, push the
  tag, and confirm the workflow attached the tarball

**Make the calls yourself — do not ask.** Design choices, naming, which of two
reasonable approaches, whether a test is worth writing, how to resolve a spec
ambiguity, what to do when an issue turns out bigger than it looked: decide, act,
and write the decision down. Where a call is genuinely hard, reach for a stronger
model rather than for the user.

Escalate mid-flight for two things only:

- something **unsafe or irreversible** — data loss, a force push, publishing
- a choice where **every reading leads to wasted work**, so proceeding on any
  assumption means throwing the work away

Everything else is yours. A signed SPEC amendment is the one standing exception
this repo keeps, and even then: draft it, apply what the user already authorised,
and carry the open question into the report rather than stopping the release for
it.

Record each call as you make it — what you chose, what you rejected, and why.
Written down while the reasoning is fresh, not reconstructed at the end.

## 6. Write the release description

**The release notes are the deliverable, not a changelog.** They are where the
user finds out what the work amounted to, and they are read by someone who was
not in the room while it happened. Generated notes — a list of PR titles — do not
do this and should be replaced.

High-level but **detailed**: no issue ids as the substance, no shopping list of
commits, and no sentence a reader would have to open the repo to understand.

Every release description answers two questions outright:

**1. How are users affected?** What can someone do now that they could not do
before, or what stopped getting in their way? Written in terms of the thing they
were trying to do — _"the box you are typing in no longer disappears when you
scroll up to re-read the passage"_ — not in terms of the mechanism. If the honest
answer is "nothing yet, this is groundwork", **say that plainly**; a release with
no user-visible change is a normal thing to ship and a dishonest headline is not.

**2. What changed about the product's direction?** Which decisions in here will
still be shaping the thing in six months — a doctrine revised, a mechanism
replaced, an assumption dropped. This is the part that is expensive to
reconstruct later and cheap to write down now. Where nothing did, say so; most
releases move the product along a direction rather than turning it.

Then the **calls made along the way**, each with:

- what was chosen, in one line
- what was rejected, and **why it lost** — a decision without its alternative is
  an assertion
- what it costs, where the choice has a real downside worth knowing about

Include the calls that went wrong. A correction discovered in review and fixed
before the tag is part of the story of the release, and burying it makes the next
reader trust the notes less, not more. Anything left unresolved goes in as an
open question rather than being quietly omitted.

Keep the mechanical detail last and short: the changelog link, and the tarball.
Someone who wants the commit list can follow it.

Post the same account to the user when the release is out, so it does not have to
be gone looking for.

## Rules

- **The headline must be true.** If the release does not make a feature usable,
  do not name it for that feature. Plumbing is an honest thing to ship; claiming
  a feature that is not there is not.
- **Finish what you start.** A release that begins a feature ships all of it. If
  the whole arc will not fit, ship the groundwork under a name that describes
  groundwork — never the feature's name.
- **One sentence has to cover it.** If the scope needs two unrelated sentences to
  describe, it is two releases.
- **Do not ask the user to adjudicate.** After the go-ahead, questions are a
  failure of the skill. Make the call, note it, keep going, and let them review
  the whole set afterwards — that is the point of the arrangement.
- **Never leave the generated release notes standing.** A list of PR titles is
  not a description of what shipped. Write the two answers — how users are
  affected, what changed about the direction — or the release is undocumented.
- Never skip the proposal step, even when the scope looks obvious — the user's
  additions are usually the point.
- Never start the release without the user's go-ahead.
- A green test suite is not evidence a behaviour works. Where a fix could pass
  its own test while being absent, break the fix and watch the test fail.
- If the scope turns out to be wrong mid-flight — an issue is far larger than it
  looked, or a dependency is missing — finish what is coherent, ship it, and say
  in the report what was cut and why. Do not silently widen the release.
