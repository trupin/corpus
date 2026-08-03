# [UI-058] A "note only" turn still shows "agent is working"

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §8 (the honest pending indicator)
- SPEC.md §11 Thread view (composer's "ask agent" toggle)

## Summary
Live report 2026-08-03: _"Answering with 'note only' still shows the 'agent is
working' status once sent."_

The composer's tri-state toggle exists so a user can add a turn **without**
summoning the agent (`requestsAgent: false`). Sending one still paints the
`.working` row, so the UI claims a job is outstanding when nothing was asked.
That is precisely the dishonesty SPEC §8's indicator was written to avoid —
`PendingIndicator`'s own docblock says the row reports "while an agent response
is outstanding … and **nothing else**".

**Diagnosed to the line.** `apps/ui/src/thread/ThreadCard.tsx`:

```ts
const awaiting =
  !resolved && agentState !== "none" && lastTurn !== undefined && lastTurn.author !== "agent";
```

`agentState` is the **thread-level** `agent` field (`data?.agent ?? row?.agent`),
not a property of the last turn. So after the agent has answered an earlier ask,
adding a note-only turn makes `lastTurn.author !== "agent"` true while the
thread's `agent` is still non-`none` — and the row appears. Nothing in this
expression can distinguish "the newest turn asked for the agent" from "this
thread asked for the agent at some point in its history".

## Investigation owed first (do not guess the fix)
The right signal is **whether the most recent agent-requesting turn is newer than
the most recent agent turn**. Establish where that can be known:
- Does a turn record, on the wire or on disk, that it requested the agent? Check
  `packages/contract/src/schemas/thread.ts` and the server's turn write path.
- If it does not, the UI genuinely cannot compute this and the fix needs contract
  and server support (a per-turn flag, or a server-maintained "outstanding"
  state) — that is **two more issues and a dependency**, not a CSS change.
  Escalate to the orchestrator with what you found rather than approximating it
  in the UI.
- Also check what the server does to a thread's `agent` field when the agent
  replies, and when a `requestsAgent: false` turn arrives. If `agent` is meant to
  be reset and is not, the bug may be server-side and this issue becomes its
  consumer.

Do not "fix" this by hiding the row more aggressively (e.g. suppressing it for
some seconds after a send). A row that is wrong less often is still wrong.

## Acceptance Criteria
- [ ] A `note only` turn shows no pending indicator — asserted end to end, from
      the toggle through to the rendered row
- [ ] An `ask agent` turn still shows it, with elapsed measured from the
      requesting turn (the existing reload-does-not-reset property must survive)
- [ ] A note-only turn added to a thread that has an *outstanding* agent request
      still shows the indicator — the request is genuinely still outstanding, and
      suppressing it there would be the opposite error
- [ ] The elapsed clock counts from the requesting turn, not from the note
- [ ] Whatever signal is used is named in the code, with why the thread-level
      `agent` field is insufficient

## Technical Design
### Files to Create/Modify
- `apps/ui/src/thread/ThreadCard.tsx` (the `awaiting` expression)
- possibly `packages/contract` + `apps/server` — see the investigation above

## Testing Strategy
Component tests over the four combinations (note/ask × outstanding/settled).
E2E: send a note-only reply in the real app and assert no `.working` row.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
