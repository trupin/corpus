# [UI-078] The resolve confirmation promises replying reopens the thread; it does not

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: SHARED-019 (whose Amendment 1 is the better fix, if signed)

## Spec References

- SPEC.md §8 — a resolved thread does not re-trigger the agent
- SPEC.md §14 — a mutation's outcome is reported honestly

## Summary

Found while drafting SHARED-019, and **it is true today, independent of that
rider**. The resolve confirmation the UI shows reads, verbatim:

> `Thread resolved — committed. Replying reopens it.`

**Replying does not reopen it.** Verified end to end while drafting:

- `apps/server/src/threads/participation.ts` returns false for the implicit
  re-trigger when `status === "resolved"`.
- `buildTurnAppend` writes only `updated` and `agent` on a reply. **`status` is
  untouched on every reply path** — nothing anywhere sets a resolved thread back
  to open.

So a person who resolves a thread, reads that sentence, and later replies gets
silence: the reply lands in the file, the thread stays resolved, and the agent
is never woken. There is no error, no badge, and no way to tell from the screen
that the message went nowhere.

There **is** an escape hatch and it is invisible: an explicit `@agent` mention or
the composer's ask-agent toggle short-circuits *before* the resolved check, so
those do still enqueue. A person who happens to type `@agent` is fine; a person
who just replies is not — and nothing distinguishes the two cases on screen.

This is the same class of defect as UI-058 and UI-069: **a surface asserting
something the write path does not do.** It is worse than those two because the
false promise is in a confirmation dialog, which is exactly where a person forms
their mental model of what resolving costs them.

## Two possible fixes — pick deliberately

1. **Make the promise true.** A person's reply reopens the thread, then §8's
   ordinary rules apply. This is **SHARED-019's Amendment 1**, drafted and held
   for sign-off, and it is the better fix: it makes *every* resolution
   recoverable, including one the person made themselves by mistake, and it is a
   precondition for letting the agent resolve anything.
2. **Make the copy true.** If Amendment 1 is not signed, the sentence has to go
   or change — something like "Replying will not reach the agent; mention
   `@agent` to ask for more." Less good, but honest, and it can ship today.

**Do not do nothing.** Either the behaviour or the sentence is wrong; leaving
both is the only unacceptable outcome.

## Resolution — fix 1, and the copy stands (2026-08-07)

**Fix 1 was taken, by SERVER-062**, which shipped SHARED-019 Amendment 1 into
`participation.ts` under §8's signed bullet ("Resolved is a closed door, not a
locked one"). The behaviour half of this issue was therefore already done when
this issue was picked up; what remained was the question SERVER-062's agent
raised — whether the confirmation, now *true*, is **incomplete**, since it does
not distinguish a reply that reaches the agent, a "note only" reply that wakes
nobody, and a reply on a thread the agent was never in.

**Decision: the sentence stays exactly as it is.** Reasoning:

1. **Those three cases are not consequences of resolving.** They are §8's
   ordinary rules, and they read identically before a resolve and after one. A
   reply on an engaged thread reached the agent yesterday, reaches it today, and
   would reach it if the thread had never been resolved. Naming them in *this*
   notice would describe the baseline rather than the change the notice
   confirms — and would imply, falsely, that resolving is what created the
   distinction.
2. **The distinction is already on screen, in the right place, at the right
   time.** The composer's toggle is `◉ ask agent` / `○ note only` — the choice
   between "reaches the agent" and "wakes nobody", spelled in those words, sat
   beside the field at the moment the choice is made, with the matching
   `reopens on reply` hint (`ThreadComposer.tsx`) already showing on a resolved
   thread. A person resolving a thread is not replying yet; a matrix they cannot
   act on for another minute is not information, it is noise on a toast.
3. **The third case is not reachable from this UI at all.** The composer's
   toggle defaults to `◉ ask agent`, so every reply it sends carries an explicit
   `requestsAgent` — `true` or `false`, never omitted. "Reopens, enqueues
   nothing" is the *omitted* cell, reachable over HTTP and from
   `corpus thread reply`, not from the board.
4. **A confirmation is read once, at a glance.** Its job is to say what the act
   cost and whether it is recoverable: committed, and not a locked door. That is
   two clauses and it is all true. Padding it is its own failure mode.

What did change is the thing that let the sentence be false for weeks: the
literal was duplicated across three files with **nothing** asserting it against
the write path. It is now one constant with two tests behind it (below).

## Acceptance Criteria

- [x] The confirmation's claim and the system's behaviour agree
- [x] Fix 1 (via SERVER-062, verified here end to end): a person's reply to a
      resolved thread reopens it and wakes the agent per §8; an **agent** turn
      does not reopen; a note-only reply reopens without waking
- [n/a] Fix 2 — not taken; fix 1 shipped, so the copy needed no correction
- [x] A test that pins the choice: `scripts/resolve-notice-promise.test.ts` runs
      the notice's claim through the server's own `decideParticipation` across
      the whole reply matrix, and `apps/ui/src/thread/resolveNotice.test.ts`
      pins the wording it checks

## Technical Design

### Files to Create/Modify

- The resolve confirmation copy (UI), and — for fix 1 —
  `apps/server/src/threads/participation.ts` plus the reply path that writes
  `status`.

**As built:**

- `apps/ui/src/thread/resolveNotice.ts` — **new**. The two confirmations as one
  dependency-free module (`THREAD_RESOLVED_NOTICE`, `THREAD_REOPENED_NOTICE`,
  `threadStatusNotice`), carrying the decision above in its header. Wording
  unchanged.
- `apps/ui/src/thread/ThreadCard.tsx`, `apps/ui/src/thread/ThreadPanel.tsx`,
  `apps/ui/src/menu/docActions.ts` — the three duplicated literals now call
  `threadStatusNotice(variables.resolved)`.
- `apps/ui/src/thread/resolveNotice.test.ts` — **new**. Pins the strings.
- `scripts/resolve-notice-promise.test.ts` — **new**. The anti-drift test.
- `apps/server/src/threads/participation.ts` — **unchanged**; SERVER-062 already
  did fix 1 there.

### Notes

- The invisible `@agent` escape hatch is worth surfacing to the user whichever
  fix is chosen; today it silently divides replies into two classes.
- **The escape hatch is no longer invisible, because it no longer divides
  replies into "heard" and "not heard".** `decideParticipation` answers the
  status question *first*, off the **author** alone (`nextStatus`), and asks the
  enqueue question afterwards against the status the turn leaves. So
  `requestsAgent: true` — the `@agent` mention, the ask-agent toggle — still
  short-circuits, but only over the **enqueue**; it buys nothing on the reopen,
  which every person's reply gets unconditionally. The remaining difference is
  "wakes the agent" vs "wakes nobody", which is exactly what the composer's own
  `◉ ask agent` / `○ note only` toggle says out loud, beside the field. Verified
  in the drill below: an `@agent`/ask reply and a bare reply with the flag
  omitted both reopened; only the first enqueued.

## Testing Strategy

Server-side: resolve, reply, assert whether an event is enqueued and what
`status` becomes. UI: assert the confirmation's text against that behaviour so
the two cannot drift again.

**As built** — the two halves are joined by one test rather than left facing each
other across a workspace boundary. `apps/ui` may not import `apps/server`, so
`scripts/resolve-notice-promise.test.ts` (the second cross-workspace invariant
after `stub-server-parity.test.ts`) imports `THREAD_RESOLVED_NOTICE` from the UI
and `decideParticipation` from the server and asserts:

- the notice still makes the claim (`toContain("Replying reopens it")`) — the
  guard that stops a reworded notice from passing vacuously;
- every reply shape × every agent state (`◉ ask agent`, `○ note only`, `@agent`
  in the body, `@agent` overruled by note-only, omitted flag) × (`none`,
  `requested`, `engaged`) leaves a **resolved** thread `open` — 15 cases, plus a
  length assertion so an empty matrix cannot pass by checking nothing;
- the enqueue split beside it: ask/`@agent` on a never-engaged thread enqueues,
  the plain reply reopens and enqueues nothing, note-only reopens and enqueues
  nothing, and a plain reply on an engaged thread enqueues;
- the same 15 shapes written by the **agent** leave the thread `resolved`.

## E2E Verification Log

**Model: opus** (claude-opus-5, 1M context). Date 2026-08-07.

### 1. Real server, real write path

Fresh workspace at `/tmp/ui078ws` (`corpus init --port 8791`, deliberately not
8765), `corpus server start`, and a script driving the **real HTTP surface** the
UI uses. Ports used: 8791 (server), 5273 (Vite). Observed:

```
  A created (asks agent)             status=open     agent=requested eventId=evt_4srddmgiltqh
  A after the agent replies          status=open     agent=engaged   eventId=null
  A resolved                         status=resolved agent=engaged
  A after a person's ◉ ask reply     status=open     agent=engaged   eventId=evt_ehibt2jcnbod
  B created (plain)                  status=open     agent=none      eventId=null
  B resolved                         status=resolved agent=none
  B after a plain reply (omitted)    status=open     agent=none      eventId=null
  C resolved (engaged)               status=resolved agent=engaged
  C after ○ note only reply          status=open     agent=engaged   eventId=null
  D resolved                         status=resolved agent=engaged
  D after an AGENT turn              status=resolved agent=engaged   eventId=null
```

All four §8 cases, live: reaches the agent (A), reopens and enqueues nothing
(B), reopens without waking (C), and the agent's own turn leaving the door shut
(D). On disk, `data/threads/th_et5izvhr.md` reads `status: open` after the reply
and `data/threads/th_ly23rnc2.md` still reads `status: resolved` after the agent
turn. The reopen is an ordinary committed change — `git log` in the workspace:
`comment: turn on th_gzw4h3mp by user (reopened)`.

### 2. Real browser, real board, real server

Vite on `:5273` with `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8791`, Chromium
driving the actual board (not the e2e stub). Right-clicked a whole-document
thread → `Resolve status flip, committed` → the toast rendered, verbatim:

```
TOAST: ["✓Thread resolved — committed. Replying reopens it.✕"]
```

The card then folded to `💬 3 turns · user · resolved · whole document` (§11's
collapse rule). Expanded it: header `resolved`, composer toggle `◉ ask agent`,
and on a resolved thread the composer hint reads `reopens on reply` (observed on
the resolved case-D thread in the same session). Typed a reply and sent it.
Header flipped to `open`, hint back to `thread stays open`. Confirmed server-side
straight after: `th_4ash36jf: status=open agent=engaged turns=4`, last turn
`"Actually, one more thing — reopening by replying."` by `user`, and
`/api/queue/status` `pending: 5` — the four enqueues from the drill plus the one
this reply made. **The sentence the UI shows is the thing the server does.**

### 3. Checks

- `VITEST_MAX_THREADS=4 npx vitest run apps/ui packages/kit` — 2890 passed, 0
  failed.
- `VITEST_MAX_THREADS=4 npx vitest run scripts/resolve-notice-promise.test.ts` —
  37 passed, 0 failed.
- `npx tsc --noEmit -p scripts/tsconfig.json` and `npm run typecheck -w apps/ui`
  — clean.
- `npx eslint` and `npx prettier --check` on all six touched files — clean.
- Server and Vite stopped; ports 5273 and 8791 verified free; no stray vitest
  workers.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier + tsc on the touched files)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
