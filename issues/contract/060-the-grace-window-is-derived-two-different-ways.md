# [CONTRACT-060] The grace window is derived two different ways, and both tests pass by coincidence

## Domain

contract (and server)

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Related: SERVER-112, CONTRACT-045

## Summary

The presence grace window is computed twice, from **different multiplicands**:

- `packages/contract/src/schemas/queue.ts:343` —
  `AGENT_PRESENCE_WINDOW_SECONDS = DEFAULT_IDLE_TIMEOUT_SECONDS * 2`, pinned by
  `queue.test.ts:501`
- `apps/server/src/queue/liveness.ts:65-71` — documented as deriving from the
  **max**, and `liveness.test.ts:47` pins
  `LANE_GRACE_MS === MAX_IDLE_TIMEOUT_SECONDS * 1000 * 2`

**Both tests pass only because `DEFAULT === MAX === 480`.** Change either
constant alone and exactly one test fails — and the surviving one will certify a
window that no longer follows the rearm gap it was supposed to.

The argument at `queue.ts:335` is that the window is written as a multiple *so
that it follows the rearm*. A second copy following a different multiplicand
defeats exactly that argument, silently, at the moment somebody tunes a timeout.

Found by PR #48's third review. It is the same shape as the CRITICAL that review
round opened with — one rule written twice — arriving through a constant rather
than a walk.

## Acceptance Criteria

- [x] One derivation. The server reads the contract's constant rather than
      re-deriving it, or the contract publishes the multiplicand it means and
      both cite it
- [x] A test fails if `DEFAULT_IDLE_TIMEOUT_SECONDS` and
      `MAX_IDLE_TIMEOUT_SECONDS` stop being equal **and** the window still
      derives from the wrong one — the current tests both pass in that world,
      which is the defect
- [x] `liveness.ts`'s docblock says which multiplicand is correct and why. §7
      guarantees the window is longer than a rearm gap, and a rearm gap is
      bounded by the **max**, so the reasoning should be stated once and cited
- [x] Checked red by making the two constants differ

## Testing Strategy

Unit. The counterfactual — set the constants apart and confirm the suite goes
red in the right place — is the test that matters.

## E2E Verification Log

Model: **opus** (contract-dev).

### The multiplicand is the max, and the contract had the default

§7's one bound is *"the window is longer than a rearm gap"*, so the question is
what bounds a rearm gap. `DEFAULT_IDLE_TIMEOUT_SECONDS` is what a client gets
when it asks for **nothing**; `MAX_IDLE_TIMEOUT_SECONDS` is what *every* park is
admitted under — `IdleQuerySchema` is `.max(MAX).default(DEFAULT)`, so a request
for more is a `400` — and `apps/cli/src/commands/queue/poll.ts` segments its
long wait at `min(remaining, MAX_IDLE_TIMEOUT_SECONDS)` precisely so it never
asks for more. So the longest interval between two contacts from a *healthy*
listener is one max-length park, and a window on the default is a window that
can be shorter than a permitted rearm the moment somebody raises the cap.

The contract's own docblock already argued this (`queue.ts:330` cited
`MAX_IDLE_TIMEOUT_SECONDS`), the server's docblock argued it, and SERVER-112's
report argued it — only the expression said `DEFAULT_IDLE_TIMEOUT_SECONDS * 2`.
So the fix is to the code, not to the reasoning: `AGENT_PRESENCE_WINDOW_SECONDS
= MAX_IDLE_TIMEOUT_SECONDS * 2`. Value unchanged at **960 s** (both constants
are 480), so no behaviour moved and no consumer changed.

### One derivation

- `packages/contract/src/schemas/queue.ts` — the constant, on the max, with the
  reason for the multiplicand written at the definition.
- `apps/server/src/queue/liveness.ts` — `LANE_GRACE_MS` already read the
  contract's constant and still does; its docblock now says the multiplicand is
  the max, why, and that the multiple is deliberately not restated here.
- `apps/server/src/queue/liveness.test.ts` — **the second derivation deleted.**
  It pinned `LANE_GRACE_MS === MAX_IDLE_TIMEOUT_SECONDS * 1000 * 2`, which is a
  copy of the rule; it now pins only what this module actually derives
  (`=== AGENT_PRESENCE_WINDOW_SECONDS * 1000`) plus the §7 bound it relies on.
- `packages/contract/src/schemas/queue.test.ts` — the pin moved to
  `MAX_IDLE_TIMEOUT_SECONDS * 2`, plus one new assertion stated so it cannot
  pass by coincidence (below).

### The counterfactual — before

Baseline green: `queue.test.ts` + `liveness.test.ts`, 114 tests, exit 0.

Then `MAX_IDLE_TIMEOUT_SECONDS = 600` alone (a raised cap — the realistic tuning;
`DEFAULT > MAX` is not a reachable world, `IdleQuerySchema` would reject its own
default):

```
contract (`-t "presence window"`) = 0   ← 2 passed, both green
server   (`-t "grace window"`)    = 1
  AssertionError: expected 960000 to be 1200000
  ❯ apps/server/src/queue/liveness.test.ts:47:27
```

**Red in the wrong place.** The contract — where the constant is chosen, and
where the docblock claims the window "tolerates one wholly missed rearm" —
certified a 960 s window against a 600 s cap, i.e. a window that no longer
tolerates a missed rearm at all. The only complaint came from a consumer that
happened to have transcribed the other multiplicand.

### The counterfactual — after

Same divergence (`MAX = 600`), window now on the max ⇒ 1200 s: the grace-window
assertions are green on both sides and the window followed the rearm, which is
the whole point of writing it as a multiple. (One unrelated server test,
`restores a lapsed lane on the next park`, fails on a hand-written instant
literal computed from the old window length — a fixture string, not a rule.)

Then the defect re-introduced on top — `MAX = 600` **and** the window back on
`DEFAULT * 2`:

```
B(wrong multiplicand, constants diverged) = 1
  FAIL packages/contract/src/schemas/queue.test.ts > the agent presence window
    > tolerates one wholly missed rearm and calls two a departure
      AssertionError: expected 960 to be 1200
    > survives a missed rearm even at the longest park the contract permits
      AssertionError: expected 960 to be greater than or equal to 1200
  server "the grace window" — green
```

**Red in the right place**, at the definition, twice: once at the pinned multiple
and once at the property that multiple exists to deliver. The server stays green
because it no longer holds an opinion about the multiplicand — which is correct:
it has none.

Both constants restored (`diff` against a pre-counterfactual copy: identical) and
the suite re-run green.

### Checks

- `queue.test.ts` + `liveness.test.ts` — 115 passed (one new assertion).
- `packages/contract` — 65 files, **2578 passed**, exit 0.
- `apps/server/src/queue` + `apps/server/src/agents` — 12 files, **325 passed**,
  exit 0 (`roster.test.ts` and `service.test.ts` both advance clocks by
  `LANE_GRACE_MS`).
- `npm run typecheck` (all workspaces + `scripts/`) — exit 0.
- `eslint` + `prettier --check` on every touched file — exit 0.

### Generated artifacts

`npm run generate -w packages/contract` then
`scripts/check-generated-artifacts.ts` — "✓ API contract is up to date". The
document is **byte-identical**, not merely shape-identical: `sha256(openapi.json)`
is `b60b492906739ce77508c9d461ba529e585203ecf345fbb08eaa42c6a9813aac` before and
after. Prose-stripped shape fingerprint (CONTRACT-052's script) unchanged from
CONTRACT-058's baseline:

| | sha256 | bytes |
|---|---|---|
| before | `daceaa073d18e442b92a00c10f9a13d25339aaa4bd523a15434653870fc80381` | 80 932 |
| after | `daceaa073d18e442b92a00c10f9a13d25339aaa4bd523a15434653870fc80381` | 80 932 |

Expected: the window is a TypeScript constant, published nowhere on the wire and
interpolated into no description.

### Crossing a domain boundary

`apps/server/src/queue/liveness.ts` and its test are outside `packages/contract`.
Edited here deliberately, and flagged: the defect *is* the pair, and fixing one
half leaves the other certifying the wrong rule. The server changes are a
docblock and the deletion of a duplicated assertion — no behaviour.

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-060]` prefix
