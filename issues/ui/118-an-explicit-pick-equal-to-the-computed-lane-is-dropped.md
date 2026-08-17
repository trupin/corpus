# [UI-118] An explicit recipient equal to the client's computed lane is sent as absence

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Related: UI-108 (which wrote it), SERVER-111

## Spec References

- SPEC.md **§7** — *"A person may override it for one message"*

## Summary

`packages/kit/src/recipient/useComposerRecipient.ts`:

```ts
const overridden = chosen !== undefined && chosen !== computed;
request: overridden ? { recipient: chosen } : {}
```

`computed` is the **client's** walk (`scopeWalk.ts`), bounded at
`MAX_SCOPE_WALK = 8` and keyed on a cached roster. The server's walk is
unbounded and reads the live projection. **Where they disagree, an explicit pick
is silently dropped** and the server recomputes.

Reviewer's scenario: a person releases the resident on `th_X` in one tab. In
another tab the roster has not refetched, so the client still treats `th_X` as a
lane and `computed = th_X`. The person opens the picker and clicks `th_X` — the
lane they mean to address. `chosen === computed`, so **no `recipient` reaches the
wire**; the server walks past the now-undesignated `th_X` and delivers to the
orchestrator. **The person addressed one agent and another answered.**

`apps/server/src/queue/scope.ts`'s `assertRecipientResolvable` exists precisely
for this, and its docblock says so — *"a pick can go stale between the roster
read and the post, and quietly routing it elsewhere would answer the person from
an agent they did not address"* — **and it never runs**, because the value never
leaves the client.

`scopeWalk.ts` asserts the opposite twice: *"A bug here shows the wrong name in a
composer; it cannot route a message anywhere"* and *"the send is unaffected
either way."* Both are false on this path, and the comments should go with the
fix rather than be left as reassurance.

## The tension to resolve deliberately

UI-108 sent absence for the computed default **on purpose**, and the reason is
good: *"the computed default sends no `recipient` at all, so the client's walk
can never disagree with the server's."* That holds for a default nobody touched.

It stops holding for a pick a person **made**. An explicit act should be sent as
one, and the server's 422 is what makes a stale pick visible instead of silent.
Distinguish *the person accepted the default* from *the person chose this lane,
which happens to equal the default* — the current code cannot tell them apart.

## Acceptance Criteria

- [ ] An explicit pick is always sent, whether or not it equals the computed lane
- [ ] An untouched default still sends nothing, so UI-108's property survives
- [ ] A stale explicit pick surfaces the server's 422 rather than being rerouted
      in silence; the refusal is legible to the person
- [ ] The two false docblocks in `scopeWalk.ts` are corrected
- [ ] Test checked red: a pick equal to the computed lane must fail against the
      current code

## Testing Strategy

Unit on the request shape for the three cases (untouched, pick ≠ computed, pick
= computed). An e2e that drives the 422 path is worth more than any of them.

## E2E Verification Log

_Filled by the implementing agent. Reproduce first._

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-118]` prefix
