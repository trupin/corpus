# [SERVER-145] A settled event can be settled again, in either direction

## Domain
server

## Status
done

## Priority
P0 (blocker) — raised from P1 by the orchestrator: the first defect rewrites history

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 7 — the queue's states; complete and fail "reach a terminal state"
- SHARED-070 audit report — `issues/evals/SHARED-070-token-audit.md`

## Summary

Found while auditing the error surface (2026-08-23, v0.19.0, real workspace).
Against an event already in `processed/`:

```
$ corpus queue fail evt_mclfojov3lqm
event evt_mclfojov3lqm is failed.        # exit 0 — processed → failed
$ corpus queue complete evt_mclfojov3lqm
event evt_mclfojov3lqm is complete.      # exit 0 — failed → processed
```

Two defects in one verb pair:

1. **Terminal states are not terminal.** A processed event was re-settled to
   `failed` and back, exit 0 both times, no warning. The orchestrate skill's
   invariant 4 calls these states terminal, and the console's story of a job
   flips with each call. A stray or duplicated settling call (the exact hazard
   the reconciliation section exists for) silently rewrites history.
2. **`corpus queue fail` accepted no `--reason`.** The skill treats the reason
   as what the operator reads in the failed row, and its examples always pass
   one — the CLI let the flag be omitted entirely, so a failed row can exist
   with nothing to say why.

`corpus thread resolve` on a resolved thread already shows the right pattern:
"already resolved", nothing changes.

## Acceptance Criteria
- [x] `queue complete`, `queue fail` and `queue defer` against an event in a
      terminal state (`processed`, `failed`, `abandoned`) are refused with a
      message naming the state it is already in, and a nonzero exit — or, if
      the spec is read to permit re-settling (e.g. `job retry` semantics), the
      allowed transitions are written into SPEC §7 and enforced; everything
      else refused. Pick one, with the spec updated to match.
      **Refused, and by a rule already in SPEC §7 — no spec change needed.**
      See Decision 1 below.
- [ ] `queue fail` without `--reason` is a usage error (exit 2), matching how
      `queue defer` treats `--blocked-on`.
      **Not done here — CLI domain, split out as the issue's Technical Design
      instructs.** See "What this issue did not do" below.
- [x] `job retry` / `job abandon` — the deliberate verbs for moving a failed
      event — keep working unchanged. Verified E2E below, and
      `ABANDONABLE` exists precisely to keep `job abandon` admitted from
      `failed`.
- [x] The orchestrate skill's text needs no change (it already assumes
      terminality); verify rather than edit. **Verified, not edited** — invariant
      4 reads "Every **claimed** event is settled", reconciliation settles only
      what the server reports `in-progress` ("Never settle an event you cannot
      account for"), and every `queue fail` example in the skill already passes
      `--reason`. The skill was already describing the behaviour the server now
      enforces.

## Technical Design

### Files to Create/Modify
- `apps/server/src/` — queue settle handlers (state check before move)
- `apps/cli/src/commands/queue/fail.ts` — require `--reason` (coordinate: if
  this half is judged a contract/CLI change, split it out rather than doing it
  from the server domain — escalate to the orchestrator for the split)

### Key Implementation Details
The server owns queue state; the check belongs there so the HTTP surface is
covered too, with the CLI mapping the refusal to its usual exit-5 rendering.
Response should name the current state: `event evt_… is already processed`.

### Edge Cases
- Settling an event id that never existed — today's behavior (404/422) stays.
- `defer` on a terminal event: refused the same way.
- Double-`complete` of the same event (the common accident): second call
  refused with "already processed" — and that message must stay cheap, one
  line, since the audit showed refusals are read in full.

## Testing Strategy
Server unit tests over the settle handlers: each terminal state × each settle
verb → refusal; pending/in-progress transitions unchanged. CLI test: `queue
fail` without `--reason` exits 2 before any request.

## E2E Verification Plan
Real workspace: claim and complete an event, then `queue fail <id>` — expect a
one-line refusal naming `processed`, nonzero exit, state unchanged in
`job list`.

### Reproduction Steps (bugs only)
1. Scratch workspace, server up; enqueue and work one event to `processed`
2. `corpus queue fail <id>` (no `--reason`)
3. Expected: refusal
4. Actual (2026-08-23): exit 0, event now `failed`; `queue complete <id>`
   returns it to `processed`

### Verification Steps
1. Restart server after the change, repeat
2. Expected: refusal naming the current state; `job retry`/`job abandon`
   unaffected

## E2E Verification Log

Model: **opus** (claude-opus-5, 1M context). Real server, real workspace at
`…/scratchpad/ws145`, port 8766 (never 8765 — that is the user's), started with
`corpus server start` and driven with the real `corpus` binary.

### Reproduction (bugs only)

Server running, one `comment.created` event enqueued by a real
`corpus thread create --requests-agent true`, then claimed.

```
### 1. complete (legitimate, in-progress -> processed)
event evt_zdo7sd2ifd6n is complete.                exit=0
### 2. fail on a PROCESSED event
event evt_zdo7sd2ifd6n is failed.                  exit=0
### 3. complete again on a FAILED event
event evt_zdo7sd2ifd6n is complete.                exit=0
### 4. abandon on a PROCESSED event
event evt_zdo7sd2ifd6n is abandoned.               exit=0
### 5. complete on an ABANDONED event
event evt_zdo7sd2ifd6n is complete.                exit=0
### files
processed/evt_zdo7sd2ifd6n.json
```

Five settles, exit 0 every time, and the file walked
`processed → failed → processed → abandoned → processed`. Worse than filed:
`abandoned` was reversible too.

**A third defect, found while reproducing and not in the filing.** A second
event, freshly enqueued and **never claimed by anyone**:

```
### complete an event NOBODY EVER CLAIMED (still pending)
event evt_76nkzdwts5tq is complete.                exit=0
queue running — pending 0, … processed 2, …
```

The work was never done, and the event left `pending/` for good. This is the
case that decided Decision 1 (below): it is not a terminal-state problem at all,
so a rule phrased in terms of terminal states would have left it open.

And defect 2, unchanged from the filing — `corpus queue fail <id>` with no
`--reason` exits 0 and produces a `failed` console row whose reason is absent
(`corpus job list --json` shows the row with nothing to say why).

### Post-Implementation Verification

Server stopped and restarted on the new code. Same shape of event, claimed, then
completed once.

```
### 1. complete (in-progress -> processed)
event evt_uoodekuksvmq is complete.                                        exit=0
### 2. fail on the PROCESSED event  [was: exit 0, flipped to failed]
corpus: 409 conflict: queue event evt_uoodekuksvmq is processed; only in-progress work can be failed
                                                                           exit=5
### 3. complete again  [was: exit 0]
corpus: 409 conflict: queue event evt_uoodekuksvmq is already processed    exit=5
### 4. abandon a PROCESSED event
corpus: 409 conflict: queue event evt_uoodekuksvmq is processed; only pending, in-progress, deferred or failed work can be abandoned
                                                                           exit=5
### 5. defer a PROCESSED event
corpus: 409 conflict: queue event evt_uoodekuksvmq is processed; only in-progress work can be deferred
                                                                           exit=5
### state
processed/evt_uoodekuksvmq.json      (unmoved)
```

The unclaimed case, and the two deliberate operator verbs:

```
### complete a PENDING event nobody claimed  [was: exit 0, work never done]
corpus: 409 conflict: queue event evt_vwyuo2rdi3le is pending; only in-progress work can be completed
                                                                           exit=5
### still pending?
queue running — pending 1, …                       (it stayed)

### claim + fail it properly
event evt_vwyuo2rdi3le is failed.                                          exit=0
### job retry on the failed event (must still work)
job evt_vwyuo2rdi3le is pending.                                           exit=0
### claim + fail again, then job abandon (must still work)
event evt_vwyuo2rdi3le is failed.
job evt_vwyuo2rdi3le is abandoned.                                         exit=0
```

The CLI needed no change to render the refusal: it already maps an `ApiError`
to exit 5, and it does so for this `409` even though the contract does not yet
declare one (see "What this issue did not do").

### Falsification

Two arms, both against the guard removed rather than against a weaker assertion.

1. **Unit.** Deleting the four-line `onlyFrom` throw from `transition` and
   re-running the two touched suites fails **9** tests, by name — including all
   four new ones and the two that already existed for `defer`:
   `refuses to re-settle a processed event in either direction`,
   `refuses to settle work nobody claimed`,
   `refuses a repeat by name, leaving the first reason in place`,
   `abandons a failed event, and refuses a second abandon by name`,
   `refuses to re-settle a settled event, in either direction` (HTTP),
   `refuses to settle an event nobody claimed, and 404s an unknown id` (HTTP),
   `409s an event that was never claimed, and a second defer` (×2),
   `closes nothing when a repeat of a terminal verb finishes nothing`.
2. **Live.** With the guard still removed, the server was restarted (it runs from
   source via `tsx`, so the removal was live) and the reproduction re-run against
   it:

   ```
   ### GUARD REMOVED — complete
   event evt_wplsuwnslhv2 is complete.              exit=0
   ### GUARD REMOVED — fail on a processed event
   event evt_wplsuwnslhv2 is failed.                exit=0
   ### GUARD REMOVED — complete again
   event evt_wplsuwnslhv2 is complete.              exit=0
   ```

   The guard was then restored and the same event re-tried on the restarted
   server: `409 conflict: … is processed; only in-progress work can be failed`,
   exit 5.

### Decision 1 — re-settling to the *same* terminal state is refused, not a no-op

**The guard is about the claim, not about the state.** SPEC §7's rider signed
2026-08-13 says it directly: "a lane's owner settles its own lane … and
**nobody settles work they did not claim**". So the question a settle verb asks
is "do you hold this event?", and the answer is `no` for every status but
`in-progress` — whether the caller asked for the state the event is already in
or a different one. That is **one** rule, and it is already the spec's, which is
why no SPEC change was needed. `defer` has enforced it since SERVER-030;
`complete` and `fail` simply never did, and that inconsistency — `queue defer`
on a pending event 409s while `queue complete` on the same event returns 200 —
is itself the evidence that the missing `onlyFrom` was an oversight.

**The rejected alternative: `thread resolve`'s no-op-with-a-message.** It is the
right shape for a thread and the wrong one here, for three reasons.

1. **Different subject.** A thread's `status` is a *property of a document*, and
   anyone may assert a property at any time — the second `resolve` is
   indistinguishable from the first in every way that matters. A settle is a
   *report on claimed work*, and the second caller is distinguishable from the
   first by the one thing that counts: the first held a claim and this one does
   not.
2. **It would not have closed the hole the reproduction found.** "Refuse a
   *different* terminal state, no-op the same one" says nothing about
   `pending → processed`, which is worse than the filed defect: the work is
   never done and the event is gone. Only the claim-shaped rule covers both.
3. **It keeps a quiet lie.** A second `fail --reason B` on an already-failed
   event deliberately does not overwrite the first reason (that part is right —
   the first account is the true one). Answering it `200` tells the caller the
   event is failed while its reason went nowhere. That is the same class of
   defect as a `failed` row with no reason at all.

The cost is accepted and named: a settle whose HTTP response is lost now costs
the retrying caller a `409` where it used to get a `200`. That is bearable
because the refusal is legible (`is already processed`) and because §7's
reconciliation rider already gives the agent the correct loop — read the
`inProgress` set the claim reports, and settle only what is genuinely still
held. An event absent from that set was already settled, and the agent does not
call the verb.

**What "already" buys.** A repeat is still a `409` and still writes nothing, but
it says `queue event <id> is already processed` rather than the generic
"only in-progress work can be…". It is one line either way — the SHARED-070
audit measured refusals being read in full — and the difference is between
"you cannot do that", which sends a reconciling caller looking for a fault, and
"the outcome you wanted is on record", which sends it on.

**Abandon is deliberately not held to the same rule.** It is the *operator's*
give-up rather than the agent's report: SPEC §7's console offers it on a failed
row beside `retry`, and `job abandon` calls straight into it. It is admitted
from `pending`, `in-progress`, `deferred` and `failed`, and refused from
`processed` — there is nothing left to give up on, and `processed/ → abandoned/`
is exactly the history rewrite this issue is about.

### Decision 2 — the refusal lives in the server

**Server.** Three reasons, in order of weight.

1. **The server is the sole writer** (Architecture Decision 2) and owns queue
   state. A CLI-only guard is one that the UI, `curl`, or any future client
   walks straight past — and this refusal exists to protect an audit trail, so a
   guard with a documented way around it is not a guard.
2. **The check has to be *inside the writer chain*.** `transition` asks
   `store.locate` and moves the file in one `serialize` step. A check outside
   that step answers a question that can be stale by the time the move happens —
   which is not hypothetical here: `SERVER-022 finding 2` was exactly this bug in
   `jobs/service.ts`, where `retry` checked the status before calling the queue
   and a `complete` landing in the interval re-ran a finished job. A CLI guard is
   the extreme form of that mistake, two HTTP round trips wide.
3. **It would cost a second request per settle.** The CLI cannot see the current
   status — `QueueEvent` carries no `status` field — so a CLI guard means a
   `GET` before every `complete`. SHARED-070 was measuring what the agent's loop
   costs; adding a round trip to the most frequent verb in it to enforce a rule
   the server can enforce for free is the wrong trade.

The CLI loses nothing by not owning it: it already renders an `ApiError` as
exit 5, verified above.

### What this issue did not do — two follow-ups for the orchestrator

1. **CONTRACT — the three routes do not declare the `409` they now return.**
   `openapi.json` today: `/api/queue/{id}/complete` → `200,400,401,404`;
   `/api/queue/{id}/fail` → `200,400,401,404`;
   `DELETE /api/queue/{id}` → `200,400,401,404`. Only `/defer` declares `409`.
   This is CONTRACT-059's class of gap exactly, and SERVER-119 — the structural
   check that would catch it — is still `todo`. Nothing breaks at runtime (the
   E2E above is the proof), but the machine-readable half of the contract is now
   wrong for three routes. `packages/contract` was deliberately not touched from
   the server domain.
2. **CLI — `queue fail` still accepts no `--reason`, and two help strings now
   lie.** The issue's own Technical Design says to split this rather than do it
   from here.
   - `apps/cli/src/commands/queue/transitions.ts`: `completeCommand`'s
     description says "Idempotent: completing an already-completed event is not
     an error, so a duplicated call after a retry exits 0 like the first" —
     false as of this change. `failCommand`'s says "A bare `fail` sends no
     request body at all" and offers `corpus queue fail evt_9f2a` as an example
     of failing without an annotation.
   - **Making `--reason` required is not a breaking change for anything
     installed**, and the server side of it should not change. The flag is the
     CLI's own surface, and the CLI is what would change. The *route's* body
     stays `required: false`: the server's own reaper writes a `failed` event
     with its own `error` string without going through the route, and tightening
     the wire schema would break an HTTP caller for no gain the CLI cannot
     deliver. So: usage error in the CLI (exit 2, before any request), route
     unchanged.

## Completion Checklist (domain agent)
- [x] Tests written and passing — `apps/server` 4564/4564, `apps/cli`
      2031/2031 (unchanged, no CLI test touched)
- [x] `/lint` passes — eslint clean on `apps/server/src/queue` and
      `apps/server/src/jobs`, prettier clean, `npm run typecheck` clean across
      all five workspaces
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified (criterion 2 split to the CLI domain)

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
