# [UI-119] The client's scope walk still follows the rule SERVER-117 deleted

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Related: SERVER-117 (which changed the server's walk), UI-118 (which turned
  the label into a routing decision), SHARED-044

## Spec References

- SPEC.md **§7** — the scope of a designated thread; *"answering a question does
  not annex the thread it was asked in"*

## Summary

`SERVER-117` rewrote the server's walk as a parent-first DFS over both edges.
**`packages/kit/src/recipient/scopeWalk.ts` was not moved with it** and still
runs the code that was deleted:

```ts
current = node.origin ?? node.parent;   // single chain, no fallback
```

This is an orchestration failure, not a domain one: `SERVER-117` and `UI-118`
ran in parallel and neither was told the other existed.

**It was a label bug until `UI-118`, and is now a routing bug.** Before, an
explicit pick equal to the computed lane was dropped, so the server always
recomputed. `UI-118` made a pick reach the wire — correctly — and
`apps/server/src/queue/lanes.ts:147` returns `input.recipient` verbatim. So:

> `th_c` has `parent → doc_draft` (whose origin reaches Ana's designated
> `th_root`) and `origin → th_q` (undesignated). The client walks
> `th_c → th_q → null → orchestrator` and the composer says **"Orchestrator will
> answer"**. The person reads that, presses the Orchestrator row to confirm it —
> which is now a real pick — and `{recipient: "orchestrator"}` goes on the wire.
> Ana never hears about the conversation on the draft she wrote.

The annexation half is worse, because it names a wrong agent rather than a wrong
fallback: `th_opened` with `parent → doc_theirs` (Bo) and `origin → th_mine`
(Ana) — the client says Ana, the server would have routed Bo.

## The part that should change how this is tested

**The suite certifies the drift, green, in both directions:**

- `packages/kit/src/recipient/scopeWalk.test.ts:73` — *"follows origin before
  parent, **as the enqueue walk does**"* → expects `th_origin`
- `apps/server/src/queue/scope.test.ts` — *"keeps a thread with the scope of the
  document it hangs on, not the job that opened it"* → expects the parent

Each file asserts it encodes the other's rule, and they disagree. Two green
suites is exactly why nobody noticed.

## Acceptance Criteria

- [ ] The client's walk matches the server's: parent first, both edges, dead
      branch is not an abort. Match `apps/server/src/queue/scope.ts` edge for
      edge and say where you checked it
- [ ] `scopeWalk.test.ts:73` and every sibling asserting the old order are
      **rewritten, not deleted** — the cases are right, the expectations are not
- [ ] `scopeWalk.ts:34-37` still states the old rule in prose (*"The two edges,
      and the order, are the server's: `origin ?? parent`"*). `UI-118` corrected
      two false docblocks in this file and left the one that states the rule.
      Fix it, and consider what else in the file is now describing a dead design
- [ ] **Something must fail when these two walks diverge again.** A comment
      asking the next person to remember is what produced this. Options worth
      weighing: publish the walk from one place both consume; or a test that
      runs the same case table through both and asserts they agree. Say which
      you chose and why the other was not possible
- [ ] The client's `MAX_SCOPE_WALK` bound is re-examined: the server's walk is
      unbounded and now covers a reachable closure rather than a chain, so a
      bound of 8 is a second way to disagree

## Testing Strategy

Port the server's enumeration table wholesale — `scope.test.ts` has ten cases
covering both-agree, parent-wins, each dead-end, missing rows, cycles on each
branch, diamond convergence and distant-parent-over-near-origin. Every case
checked red against the current client walk before trusting it.

## E2E Verification Log

_Filled by the implementing agent. This is a bug — reproduce first, in a
browser: the composer naming one agent while the server would route to another._

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-119]` prefix
