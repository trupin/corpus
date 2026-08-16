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
  (provenance and the origin stamp)

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

## What the amendment must decide

- [ ] Either **narrow the guarantee to what is true** — origin is single-valued,
      so no two scopes claim an artifact *by origin* — and then state the
      precedence explicitly for the origin/parent case, or **make the guarantee
      true** by constraining the scope clauses so the two routes cannot diverge
- [ ] State the precedence **in §7**, whichever way it goes, so it is followed
      rather than read. The rule and its arbitration belong in the same
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
- [ ] `apps/server/src/queue/scope.ts`'s precedence matches the signed text, and
      its defending comment cites the amended sentence rather than reasoning
      from the invariant
- [ ] The test `prefers a thread's own origin over the scope of the document it
      hangs on` is renamed to state the rule, and fails if the precedence flips

## Testing Strategy

Unit, in `apps/server/src/queue/scope.test.ts` — the divergent node is
constructible directly in the projection. If the amendment forbids the state
rather than arbitrating it, the test belongs on the write path instead.

## E2E Verification Log

_Not applicable until the amendment is signed._

## Completion Checklist (orchestrator)

- [ ] User sign-off on the amendment text
- [ ] Committed with `[SHARED-044]` prefix
