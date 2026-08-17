# [UI-118] An explicit recipient equal to the client's computed lane is sent as absence

## Domain

ui

## Status

done

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

- [x] An explicit pick is always sent, whether or not it equals the computed lane
- [x] An untouched default still sends nothing, so UI-108's property survives
- [x] A stale explicit pick surfaces the server's 422 rather than being rerouted
      in silence; the refusal is legible to the person
- [x] The two false docblocks in `scopeWalk.ts` are corrected
- [x] Test checked red: a pick equal to the computed lane must fail against the
      current code

## Testing Strategy

Unit on the request shape for the three cases (untouched, pick ≠ computed, pick
= computed). An e2e that drives the 422 path is worth more than any of them.

## E2E Verification Log

**Model:** Opus 5 (1M context). **Date:** 2026-08-17.

### 1. Reproduction, before any fix

**Unit.** Added to `packages/kit/src/recipient/useComposerRecipient.test.tsx`:
`choose("th_root")` on a composer whose `computed` is already `th_root`, then
`expect(request).toEqual({recipient: "th_root"})`.

```
AssertionError: expected {} to deeply equal { recipient: 'th_root' }
- { "recipient": "th_root" }
+ {}
```

**Worse than the issue described.** `RecipientPicker`'s click handler was
`recipient.choose(effective ? undefined : row.lane)` — keyed on the *effective*
row. With nothing picked, the default **is** the effective row, so pressing it
called `choose(undefined)`: a no-op. The one gesture a person has for saying
"this lane, deliberately" was the one press the control could not hear, so the
pick the issue describes could not even be **made** through the UI.

**Real browser (`apps/ui/e2e/recipient.spec.ts`, Chromium, Vite on
`CORPUS_UI_PORT=5373`).** Board → open `th_res` (a designated root thread, and
therefore the lane this reply is posted into) → the picker shows
`data-recipient-default="true"` on `th_res` → `corpus.releaseLane("th_res")`
(the other tab: `GET /api/agents` stops naming it, **no** invalidate frame is
pushed, so this page's roster still names it) → press the `th_res` row → type →
send. Against the pre-fix build (`request: overridden ? {recipient} : {}`,
kit `dist/` rebuilt so the browser actually ran it):

```
2 failed
  › sends a pick that names the lane the default already named
  › a pick gone stale is refused out loud, not delivered to somebody else
      expect(sent[0]["recipient"]).toBe("th_res")
      Expected: "th_res"   Received: undefined
```

`POST /api/threads/th_res/turns` carried **no** `recipient`, the stub's
`assertRecipientResolvable` model never ran, and the turn was accepted `201`.
The person addressed `th_res` and the orchestrator took it, silently.

### 2. After the fix, same drill

`e2e/recipient.spec.ts` — 3 specs, all green:

- **untouched** → `"recipient" in body === false` (UI-108's property intact);
- **pick equal to the computed lane** → `body.recipient === "th_res"`, the row
  reads `data-recipient-chosen="true"` while staying
  `data-recipient-default="true"`, and the statement line moves from
  *"claims-review will answer — reading the policy"* to *"…will answer **this
  message**"*; pressing it again drops it and the next send states nothing;
- **stale pick** → the pick reaches the wire, the server answers `422`, and the
  browser shows: `.toast[data-tone="error"]` containing *"names no lane"* and
  *"Nothing was written"*; `data-recipient-refused="true"` on the row **after**
  the toast is gone, with the statement *"claims-review is not a lane any more —
  nothing was sent; pick again"*; the reply still in the box; `th_res`'s body
  byte-identical to before; `orchestrator` now carrying
  `data-recipient-default="true"` (the refusal refetched `["agents"]`, which
  nothing else would have — `useAgentsRoster` has no poll); and the **retry
  still addressed to `th_res`** rather than quietly handed to the corrected
  default.

### 3. What was falsified (each mutation run, each killed the intended test)

| Mutation | Test that went red |
| --- | --- |
| `request: overridden ? {recipient} : {}` | kit: *"states a pick that happens to equal the computed lane"*; ui: *"carries a pick that happens to equal the computed lane"* ×4 surfaces; e2e ×2 |
| picker click keyed on `effective` again | *"makes an explicit pick of the default's own lane"* |
| `refuse` drops the pick instead of keeping it | *"is kept and marked, and the roster is refetched"*, *"loses its mark…"* |
| `refuse` without `invalidateQueries(["agents"])` | *"is kept and marked, and the roster is refetched"* |
| mount-time refetch removed (restored refusal) | *"comes back with a composer its host re-opens"* |
| `rowsToOffer` stops guaranteeing `chosen` | *"…rows contains th_root"* |
| `ThreadComposer` back to `recipient.clear()` | both *"a pick the server refuses"* specs |
| `ComposeOverlay` / `NewChildThread` back to `clear()`, popover `restore` unwired | all three *"the other three surfaces"* specs |

### 4. Gates

`npm run build` ✓ · `npm run typecheck` ✓ · `npm run lint` ✓ (0 problems) ·
`npm run format:check` ✓ · kit + apps/ui unit: **3962 passed / 202 files** ·
plugins (against the rebuilt kit `dist/`): **512 passed** · full Playwright
suite: **395 passed, 0 failed**.

Ports: Vite on `5373`, `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8999`. Never
touched `5173` or `8765`.


## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-118]` prefix

## Orchestrator adjudication, 2026-08-17

Two calls the implementing agent raised rather than deciding.

**1. Keeping the pick across a refusal — upheld.** §7 says an override "never
persists past the message it was set on". A refused send wrote nothing, so the
message it was set on **never happened**; the pick has not outlived anything and
is still attached to the same unsent message. The alternative was measured and
is worse: drop the pick, and the retry silently addresses whoever the *same
stale roster* computes — which is verbatim the defect this issue exists to fix,
reintroduced one keystroke later.

**2. `statementFor`'s second parameter narrowing from "overridden" to "this row
is the pick" — accepted.** It is source-compatible, no plugin calls it (checked),
and the narrowed meaning is the one the function needed all along: the old
meaning is exactly the conflation that made an explicit pick indistinguishable
from an accepted default. Recorded here so a plugin author who later finds the
behaviour changed can see it was deliberate rather than drift.
