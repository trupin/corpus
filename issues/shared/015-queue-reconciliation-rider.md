# [SHARED-015] The agent can see what the server still thinks it is doing — DRAFT, awaiting sign-off

## Domain

shared (orchestrator-owned)

## Status

**done — signed and applied.** The §7 bullet drafted below ("The agent can see
what the server still thinks it is doing") is in SPEC.md verbatim, and its whole
chain shipped: CONTRACT-033, SERVER-061, CLI-029 and AGENT-013 are all `done`.

**This file said "awaiting user sign-off" until 2026-08-09**, and the plan row
said `blocked`, with four implemented issues hanging off it. Corrected while
surveying the user on riders to sign — the same staleness as SHARED-013, 014 and
020, all four found in one pass. Applying a rider and closing its issue are two
acts; doing only the first leaves decisions that have been made looking open.

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Blocks: CONTRACT-033, SERVER-061, CLI-029, AGENT-013

## Spec References

- SPEC.md §7 — the event queue, `claim-all`, the settle verbs, `reap-stale`, and
  the "outcomes are never assumed" paragraph

## The report

**User, verbatim (2026-08-05):**

> "I think there's a bit of an issue with queued messages showing as in-progress
> even though they are already done on the agent's side. Maybe anytime 'corpus
> queue' is called by the agent, on top of returning the queued messages, it also
> provides a list of message being processed. The agent then calls the CLI to
> close the messages that are considered in process on the server side, but
> should really be closed already."

And, when the orchestrator proposed a server-side evidence check instead:

> "the reason I think my design is better is because it's not about the agent
> stopping mid course, it's about the agent forgetting to close on a message.
> regardless of what happens, the work happens on the agent side, and only the
> agent can reconcile what's stored on the server and what actually is in the
> context. Making the agent aware of what the server sees as the current state is
> supposed to make the agent check its work and adjust the state accordingly to
> the work that has been done"

**That correction is the design, and the orchestrator's counter-proposal was
answering a different failure.** Two distinct things strand an event in
`in-progress/`:

1. **The session died** between doing the work and settling it. Memory is gone;
   only evidence on disk could settle it. `reap-stale` already covers this.
2. **The agent is alive, holds the context, and simply did not call `complete`.**
   Nothing is lost and nothing is ambiguous — the agent knows. What it lacks is
   any way to notice, because **nothing in the loop ever shows the agent what the
   server currently believes.** `claim-all` returns `pending/` only.

Case 2 is what was reported, and for it the agent is not merely *a* source of
truth, it is the only one: the work happened in its context. A server-side
evidence check would be the server guessing at something the agent already knows,
and it would only ever reach event types whose completion leaves a visible trace.

## Why the current recovery makes it worse, not better

Today the only path out of a stranded `in-progress/` is `reap-stale`, and after
the staleness window it returns the event to **`pending/`**
(`apps/server/src/queue/service.ts`: `attempts > maxAttempts ? "failed" :
"pending"`). So a job that was *actually finished* is claimed again and **the
work is redone** — for a `comment.created` event, the agent replies to the thread
a second time.

The stale row in the console is the visible half. The duplicate reply is the
half that reaches the user.

## Proposed SPEC.md §7 amendment — verbatim, for sign-off

APPEND to §7, after the "**Outcomes are never assumed.**" bullet:

> - **The agent can see what the server still thinks it is doing.** Claiming work
>   also reports the events the server currently holds `in-progress`, each with
>   what it is and how long it has been held. The loop is expected to read that
>   list and reconcile it: an event whose work this agent has already done is
>   settled on the spot with the ordinary verbs, and one it is genuinely still
>   working is left alone. This exists because the common way an event gets stuck
>   is not a crash — it is a live agent that finished the work and did not settle
>   it, and which therefore holds the only account of what happened. Nothing in
>   the loop previously showed it the server's view, so the discrepancy was
>   invisible to the one party able to resolve it. Reconciliation is the agent's
>   judgement and never an inference the server draws on its behalf: the server
>   reports what it is holding and settles nothing by itself. `reap-stale`
>   remains the recovery for the other case — a session that died with its
>   context — and stays a *requeue*, so an event nobody can account for is done
>   again rather than dropped.

## Open questions for sign-off

1. **Which call carries the list?** The user wrote "anytime `corpus queue` is
   called". Recommend `claim-all` (the loop's own entry point, so the list
   arrives exactly when the agent is about to reason about work anyway) **and**
   `idle` when it returns work. Adding it to every queue verb would put it on
   `complete`, which would read as a nag mid-settle.
2. **Should the list be bounded?** An agent that has been forgetting for days
   could face a long list. Recommend a cap with an explicit "and N more" signal —
   never a silent truncation, for the reason CONTRACT-030 established.
3. **Does the skill need a rule, or is the data enough?** Recommend an explicit
   rule in `orchestrate`'s loop: read the list, settle what you did, leave what
   you are doing, and **never** settle an event you cannot account for — that
   last clause matters, because an agent that closes an unfamiliar event to tidy
   the list would silently kill a concurrent run's work.
4. **Is `age` enough context, or does the row need the origin title?** Recommend
   including type and origin, since "you are apparently still working on
   `comment.created` for thread X" is what makes the agent able to check.

## Acceptance Criteria

- [ ] User signs off (or amends)
- [ ] Applied to SPEC.md §7 verbatim at kickoff, by the orchestrator
- [ ] The chain below implements against the signed text

## Technical Design

### The chain this decomposes into

| ID | Domain | What |
| --- | --- | --- |
| CONTRACT-033 | contract | `claim-all` (and `idle`) response carries the in-progress set: id, type, origin, held-since. Bounded per Q2. |
| SERVER-061 | server | Populate it from the queue's own `in-progress/` directory. Read-only; settles nothing. |
| CLI-029 | cli | Surface it in `corpus queue claim-all` output, `--json` included, as its own field rather than mixed into the claimed batch. |
| AGENT-013 | agent-runtime | The loop rule in `orchestrate/SKILL.md`, including the never-settle-what-you-cannot-account-for clause. |

## Testing Strategy

None — spec text. The domain issues carry the tests. The notch worth pinning in
AGENT-013: an agent that did the work, skipped `complete`, and then sees the
event listed must settle it **without redoing the work**.

## E2E Verification Log

_N/A — spec draft._

## Completion Checklist (orchestrator)

- [ ] Sign-off recorded
- [ ] SPEC.md updated
- [ ] Committed with `[SHARED-015]` prefix
