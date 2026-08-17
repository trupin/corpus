# [SERVER-117] The scope walk abandons the parent edge, so a resident loses conversations on its own artifacts

## Domain

server

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Related: SERVER-111 (which wrote the walk), SHARED-044 (the precedence
  question, which this partly answers)

## Spec References

- SPEC.md **§7** — *"The **scope** of a designated thread is: the thread itself;
  every thread whose parent chain reaches it; every **document** whose origin
  reaches it; and every thread on such a document."*
- SPEC.md **§7** — *"the alternative is a resident that owns the talking and
  loses the artifacts the talking produced"*

## Summary

PR #48's review found two defects in `apps/server/src/queue/scope.ts:105`
(`current = node.origin ?? node.parentId`). They are separate and both are real.

### 1. The walk never falls back to the parent edge

The walk is a single linear chain. Once a node has an `origin`, its `parentId`
is **never consulted again** — not even when the origin chain dead-ends at no
designated thread. So §7's *"every thread on such a document"* is unreachable
for any thread that carries an origin.

**And every agent-created thread carries one.** `apps/cli/src/input.ts` exports
`CORPUS_JOB` once per claimed event, so it is always set for an agent's writes.
The parent edge therefore only ever fires for **human-created** threads.

Reviewer's scenario, which reproduces it:

> Ana's conversation `th_root` has a resident; her agent drafts `doc_draft`
> (`origin → th_root`). A person asks the orchestrator, in an ordinary
> undesignated thread `th_q`, to review the draft. The orchestrator's subagent
> runs `corpus thread create --parent doc_draft` with `CORPUS_JOB` set, so
> `th_c` gets `origin → th_q`, `parent → doc_draft`. A person replies in `th_c`
> with `@agent`. The walk goes `th_c → th_q → null → ORCHESTRATOR_LANE`.
> `doc_draft` is never visited.

Ana's resident, which wrote the draft, never hears about a conversation on it —
verbatim the failure §7 says the scope exists to prevent.

The failing test is four lines and `scope.test.ts` has no case like it: no
existing case has an origin chain that dead-ends while the parent chain does not.

### 2. The precedence itself is probably backwards for threads

`SHARED-044` recorded origin-first as adjudicated. **That adjudication was mine
and had no independent review** — the agent spawned for it died before reading
anything. PR #48's reviewer gave the second opinion and disagreed, with an
argument I find stronger than my own:

- §7 lists `origin` as a scope edge **only for documents**. For threads it gives
  two routes, neither of which is the thread's own origin. So the implementation
  either invented a third membership route and ranked it above both
  spec-sanctioned ones, or created the two-scope state §7 says cannot happen.
- **Origin-first has no beneficial case.** Enumerate the divergences: a
  standalone thread created by a job has no parent, so the precedence is moot; a
  thread whose parent is already in the writer's scope — both edges agree; a
  summons — §7 already reads lane and origin off different things so both agree.
  The *only* input where the answers differ is a thread an agent opened on
  another scope's document. That is exactly what §7's summons carve-out warns
  about: *"answering a question does not annex the thread it was asked in."*
- **Detaching is not a remedy here.** §7 offers `corpus doc detach` for a
  mis-filed document. An annexed *thread* has none, and the annexation is
  permanent — whereas the override §7 does sanction "never persists past the
  message it was set on."

## What to do

**Make the code match §7 as written**, which needs no amendment: for a thread,
follow the parent chain; `origin` is a scope edge for documents. And **the walk
must consider both edges** rather than committing to one — a dead end on one
does not mean the artifact is in no scope.

Do not amend SPEC.md here. If after implementing you believe the spec is what is
wrong, say so and it becomes a rider for the user to sign — `SHARED-044` is
already open for exactly that.

## Acceptance Criteria

- [ ] The reviewer's four-line case passes: `th_c` with `parent → doc_draft`
      (in Ana's scope) and `origin → th_q` (undesignated) resolves to `th_root`
- [ ] A dead-ending chain falls back rather than concluding "no scope"
- [ ] The cycle guard still terminates, now that the walk may branch
- [ ] Enumerate what the two edges can disagree about and **test each case**,
      rather than testing the one that prompted this
- [ ] `provenance.ts`'s invariant is re-read against the change: it is about the
      document a job creates, and the comment should not be left implying more
- [ ] `SHARED-044` updated to record that its adjudication was overturned on
      review, and by what argument

## Testing Strategy

Unit in `scope.test.ts`. Every new case checked red against the current walk.

## E2E Verification Log

_Filled by the implementing agent. This is a bug — reproduce first._

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-117]` prefix
