# [SHARED-044] §7 claims an artifact belongs to at most one scope, and its own four clauses do not guarantee it

## Domain

shared (SPEC amendment — requires user sign-off)

## Status

todo

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Related: SHARED-043 (the resident-agent rider this text came in with),
  SERVER-111 (the implementation that had to decide the case), SERVER-110
  (provenance and the origin stamp), **SERVER-117** (which overturned this
  issue's adjudication and shipped parent-first — see below)

## Spec References

- SPEC.md **§7** — *"**A resident owns a scope, not a thread.** The **scope** of
  a designated thread is: the thread itself; every thread whose parent chain
  reaches it; every document whose **origin** (§9.2) reaches it; and every
  thread on such a document."*
- SPEC.md **§7** — *"**An artifact belongs to at most one scope**: origin is
  single-valued and written once, by the first write that names a job, so a
  second scope cannot claim what a first already holds."*
- SPEC.md **§7** — *"Routing follows the recipient; filing follows the
  conversation."*

## Summary

The second sentence above is stated as a guarantee, and it is offered with a
reason: origin is single-valued, so no second scope can claim what a first
holds. **The reason does not cover the case the first sentence creates.**

Scope membership has **two** independent routes in §7's own definition: an
artifact's `origin`, and its `parent` chain. Origin being single-valued
constrains only the first. Nothing constrains the two from pointing at
different designated threads — and when they do, the artifact is in two scopes
by §7's literal clauses, which is exactly what the guarantee says cannot happen.

**This is structurally reachable, not a thought experiment.** Threads carry an
origin: `apps/server/src/threads/create.ts` stamps `origin: stampedOrigin(...)`
on creation, and the projection stores it (`documents.origin`) alongside
`threads.parent_id`. So a thread created *by a job in scope A* onto a document
*belonging to scope B* has `origin → A` and `parent → B` at once.

**Why it has not bitten yet, and why that is not reassuring.** The common paths
all leave one of the two edges null, so both readings agree:

| How the artifact was made | `origin` | `parent` | Agree? |
| --- | --- | --- | --- |
| Document created by a job | scope A | — | yes |
| Thread on a document, by a person | — | scope B | yes |
| Thread on a document, by a **summoned** agent | scope B | scope B | yes |

The third row is the interesting one: §7 already engineered the summons case so
the two agree, by reading lane and origin off different things — *"the lane is
stamped to route the work, while the origin is the thread the event's own
payload names."* That is the mechanism working. But it means the guarantee
holds **because of a rule written for a different purpose**, not because the
scope definition guarantees it, and a future path that stamps an origin from
the acting job rather than from the payload's thread would break it silently.

> **Superseded in part, 2026-08-17.** The adjudication recorded below —
> origin-first — **was overturned on review and is no longer what the code does**.
> Read the next section as a record of how the question was decided, not as the
> current behaviour. What remains open for this issue is only the **spec text**:
> §7 still asserts a guarantee its own clauses do not deliver, and still states no
> precedence. See "Overturned on review" below.

## The decision that was taken, and by whom

`SERVER-111` had to pick a precedence and picked **origin over parent**
(`current = node.origin ?? node.parentId`). Its agent flagged the choice as
"the one place I read the spec rather than followed it" and asked for a second
opinion.

**The independent review did not run** — the agent spawned to do it died to an
account session limit before reading anything. What is recorded here is the
orchestrator's own adjudication, which is a weaker thing, and it is written
down as such rather than presented as a confirmed verdict.

**The adjudication: keep origin-first, and treat the ambiguity as the defect.**
Origin-first has a coherent rationale — `core/provenance.ts` states that the
origin stamped on an artifact and the lane its follow-up work queues on must
agree, or you get a resident that owns the artifact and never hears about it —
and it is implemented, tested and shipping. But the argument for **parent**-first
is not weak, and it should be recorded rather than dismissed: §7 says a thread
on a document is *about* that document, and *"filing follows the conversation"*;
a thread hanging on scope B's document is a conversation about scope B's
artifact, whoever happened to open it. Under origin-first, an agent that reaches
outside its own scope to start a thread on another scope's document
**annexes that conversation** — every later comment on it routes to the writer's
resident rather than the document's. §7 says elsewhere, of the summons, that
*"answering a question does not annex the thread it was asked in."* The same
instinct points the other way here.

So: the code is not changed by this issue. What is wrong is that the spec
asserts a guarantee it does not deliver, which is how the two readings both
came to look correct.

## Overturned on review — the precedence is **parent-first** (2026-08-17)

The second opinion this issue said it lacked was given by **PR #48's
pr-reviewer**, which reached the case independently and disagreed. The
orchestrator put both arguments to the **user, who chose parent-first**;
`SERVER-117` implemented it (`apps/server/src/queue/scope.ts`). **No spec
amendment was needed for that half**: parent-first is what §7 already says, so
the change was code conforming to signed text.

The argument that carried, in three parts:

1. **§7 lists `origin` as a scope edge only for documents.** Its enumeration is
   *"the thread itself; every thread whose parent chain reaches it; every
   **document** whose origin reaches it; and every thread on such a document."*
   For a **thread**, the spec-sanctioned routes are the parent chain and being a
   thread on a document in scope — not the thread's own origin. Origin-first
   invented a third membership route and ranked it above both.
2. **Origin-first has no beneficial case.** Working through the divergences (the
   table above): a standalone thread a job opened has no parent, so nothing is
   ranked; a thread whose parent is already in the writer's scope agrees either
   way; a summons agrees because §7 reads lane and origin off different things.
   The *only* input where the two answers differ is a thread an agent opened on
   another scope's document — and there origin-first **annexes that
   conversation**, which is the opposite of what §7 says about the one crossing
   it does sanction: *"answering a question does not annex the thread it was
   asked in."*
3. **An annexed thread has no remedy.** §7 offers `corpus doc detach` for a
   mis-filed *document*. A thread has no equivalent, and the annexation is
   permanent — whereas the override §7 does sanction *"never persists past the
   message it was set on."*

**Why the invariant cited for origin-first does not support it.** The
adjudication above leaned on `core/provenance.ts` — the origin stamped on an
artifact and the lane its follow-up work queues on must agree. The reviewer's
counter, which the user accepted: that invariant is about **the document a job
creates**, binding one artifact's filing to its routing. For a thread hanging on
*someone else's* document, the artifact whose ownership is at stake is the
**host**, and the host's scope is the answer. `core/provenance.ts`'s header
comment has been corrected accordingly (SERVER-117) so it no longer reads as an
argument for the behaviour that was removed.

**A second, separate defect was found with it**, and is also fixed by
SERVER-117: the walk was a single chain (`origin ?? parentId`), so it never fell
back to the parent edge when the origin chain dead-ended. Since
`apps/cli/src/input.ts` exports `CORPUS_JOB` once per claimed event, every
agent-created thread carries an origin — which made §7's *"every thread on such
a document"* unreachable for anything an agent made. The walk is now a search
over both edges, parent branch first.

**What is left for this issue** is the spec text only: §7 still asserts *"an
artifact belongs to at most one scope"* with a reason that covers only the origin
route, and still states no precedence for the origin/parent case. The amendment
below should now be drafted to **record parent-first**, not to decide it.

## What the amendment must decide

- [ ] Either **narrow the guarantee to what is true** — origin is single-valued,
      so no two scopes claim an artifact *by origin* — and then state the
      precedence explicitly for the origin/parent case, or **make the guarantee
      true** by constraining the scope clauses so the two routes cannot diverge
- [ ] State the precedence **in §7** — **parent-first**, as decided by the user
      on 2026-08-17 and already implemented (SERVER-117); the amendment records
      it rather than choosing it — so it is followed rather than read. The rule
      and its arbitration belong in the same
      paragraph — §7 already learned this lesson once, and says so: *"The
      carve-outs live beside the rule because a routing rule and its exceptions
      stated in two places is how they come to disagree — which happened to this
      paragraph twice while it was being written."*
- [ ] Say whether an agent writing into another scope's artifact is legitimate
      at all. If it is not, the divergence is a symptom and the constraint
      belongs on the write, not on the walk
- [ ] Decide whether *"answering a question does not annex the thread it was
      asked in"* generalises — the summons carve-out may be one instance of a
      rule that should cover every cross-scope write

## Acceptance Criteria

- [ ] Drafted amendment text quoted to the user **verbatim**, one rider, and
      signed before anything is applied
- [ ] `apps/server/src/queue/scope.ts`'s precedence matches the signed text —
      **parent-first today**, so the amendment must either say so or be a
      deliberate change of behaviour with its own server issue
- [x] The test asserting the precedence states the rule and fails if it flips —
      done in SERVER-117: `keeps a thread with the scope of the document it hangs
      on, not the job that opened it`, in a `scope.test.ts` describe block that
      enumerates every way the two edges can disagree

## Testing Strategy

Unit, in `apps/server/src/queue/scope.test.ts` — the divergent node is
constructible directly in the projection. If the amendment forbids the state
rather than arbitrating it, the test belongs on the write path instead.

## E2E Verification Log

_Not applicable until the amendment is signed._

## Completion Checklist (orchestrator)

- [ ] User sign-off on the amendment text
- [ ] Committed with `[SHARED-044]` prefix
