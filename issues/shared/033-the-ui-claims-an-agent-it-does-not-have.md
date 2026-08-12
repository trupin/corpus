# [SHARED-033] The UI claims an agent that is not working, and one that is not there

## Domain

shared (orchestrator-handled — SPEC.md rider, needs user sign-off)

## Status

done — **SIGNED 2026-08-12 and applied**

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Blocks: UI-097, CONTRACT-045, SERVER-086, UI-098

## Spec References

- SPEC.md §8 line 340 — "The UI shows an **honest**, time-aware pending indicator
  while an agent response is outstanding … **No fake progress**"
- SPEC.md §11 line 469 — "a one-line strip (agent-status pill with
  **working/idle/halted** dot · queue depth · …)"
- SPEC.md §7 — the queue's long-poll idle endpoint

## Summary

Two live reports (2026-08-08), both the same complaint in different words: **the
UI asserts things about the agent that it has not checked.**

1. **"Working" is shown for work nobody has picked up.**
   `packages/kit/src/row/useRowSignals.ts:25` defines
   `ACTIVE_JOB_STATUSES = ["pending", "in-progress"]` under the comment *"Queue
   states that mean the agent is working on this row right now."* But `pending`
   is precisely the state of an event **no agent has claimed** — it may have been
   sitting there since before any agent existed. `PendingIndicator` then opens at
   `"agent is working…"` and escalates on a clock that started when the turn was
   written. §8 asks this indicator to be *honest*, and on this path it is not.

2. **"Idle" is shown when no agent is connected at all.**
   `apps/ui/src/console/consoleModel.ts:133` — `agentState` returns `halted`,
   then `working` if `inProgress > 0`, else **`idle`**. Nothing consults whether
   an agent is running. With no `claude` session anywhere, the strip reads
   `agent: idle · queue 3`, which says "the agent is here and has nothing to do"
   about a machine where three requests are waiting and nobody is listening.

Both are the app claiming work it cannot see, which §8's "no fake progress" rules
out. The user's proposed shape (2026-08-08): pending until picked up, then
working; and a `disconnected` state when the agent has not contacted the server
recently.

**The threshold has a principled value.** `DEFAULT_IDLE_TIMEOUT_SECONDS` is
`480` — and `MAX_IDLE_TIMEOUT_SECONDS` is also `480`
(`packages/contract/src/schemas/queue.ts:332`) — so a parked agent re-contacts
the server at least every **8 minutes**. Ten minutes is that interval plus
slack, which is why it is the right number and why it must be **derived from the
timeout constant rather than hardcoded**: if the rearm changes, the threshold
follows it.

## Drafted rider text — part 1 of 2

Amending §8's pending-indicator sentence (line 340):

> The UI shows an honest, time-aware pending indicator while an agent response is
> outstanding ("working…" → "still working…" with escalating thresholds like
> 45 s / 3 m / 15 m). **No fake progress, no token streaming — and no claim that
> the agent is working before one has taken the work.** A request that is queued
> and unclaimed says so: it reads as **waiting to be picked up**, distinct in
> wording from a request being worked, because the difference is the difference
> between a busy agent and no agent at all, and it is the first thing anyone
> wondering "is this stuck?" needs to know. The elapsed clock still runs from
> when the request was written — the wait is the wait, whoever is or is not
> holding it — but what the row *claims* changes only when the work is actually
> claimed.

## Drafted rider text — part 2 of 2

Amending §11's console strip (line 469), replacing "agent-status pill with
working/idle/halted dot":

> agent-status pill with a **working / idle / disconnected / halted** dot. The
> pill reports what the server can actually observe about the agent, and
> **`idle` is a claim that requires evidence**: it means an agent is connected
> and has nothing to do, which the server knows because the agent's parked
> long-poll (§7) keeps arriving. An agent that has not made contact within a
> window derived from that long-poll's own timeout — comfortably longer than the
> interval at which a parked agent re-contacts the server, so an ordinary rearm
> is never mistaken for a departure — reads **`disconnected`**, not `idle`.
> Disconnected is not an error state and is not styled as a failure: with no
> agent running, it is simply the truth, and it is what tells someone whose
> queue is filling up that the thing to do is start the agent. Queue depth is
> shown beside it exactly as before, and matters most in precisely this state.

## Acceptance Criteria

- [ ] Both parts read aloud to the user, as two quoted blocks, on their own
- [ ] User signs off, or amends
- [ ] Applied to SPEC.md §8 and §11 with `_(Rider signed YYYY-MM-DD.)_` markers
- [ ] Contradiction sweep recorded here:
      - §7 — does anything else promise `idle` means "nothing to do"?
      - §11 Attention — an outstanding-agent-reply reason that assumes "working"
      - §15 M5's check — "the pending indicator shows meanwhile" — confirm the
        milestone check still describes the behaviour after the change
- [ ] The four implementing issues reference the signed date

## Technical Design

None — spec text. Implementation is UI-097 (pending vs working), then
CONTRACT-045 → SERVER-086 → UI-098 (disconnected).

### Edge Cases the text must survive

- **`deferred`** — work parked on someone else's edit lock. Already deliberately
  excluded from `ACTIVE_JOB_STATUSES` and reported by `awaitingAgent` instead.
  Neither part of this rider should disturb that; confirm the wording does not.
- **An agent that claimed work and died.** `inProgress > 0` forever, so the pill
  says `working` about a corpse. `reap-stale` is the existing recovery (§7), but
  the pill has the same evidence problem in this direction — a claim held by an
  agent that has stopped contacting the server. **Decide whether this rider
  covers it**, or whether it is a follow-up. It is the mirror image of the bug
  being fixed and will be asked about.
- **A second agent** connecting while one is parked — contact is contact; the
  pill reports the corpus's agent liveness, not a session count.
- **Clock skew / a suspended laptop** — the window is measured server-side from
  the last contact it observed, so a sleeping client cannot make itself look
  live. Confirm the text does not imply otherwise.

## Testing Strategy

N/A — spec text.

## E2E Verification Plan

N/A.

## E2E Verification Log

_N/A — spec rider._

## Completion Checklist (orchestrator)

- [ ] Both parts read aloud verbatim, separately from the other held riders
- [ ] The "agent claimed it then died" edge case decided, not deferred silently
- [ ] Signed by user
- [ ] Applied to SPEC.md §8 and §11 with signature markers
- [ ] Contradiction sweep recorded here
- [ ] Committed with `[SHARED-033]` prefix
