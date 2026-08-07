# [UI-085] The e2e stub answers unhandled routes with `{}` instead of failing

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: any e2e coverage of replying to a thread
- Sibling of: UI-056 (the same class, in the same file)

## Spec References

- —

## Summary

Found while implementing UI-078. `apps/ui/e2e/stubCorpus.ts` has **no handler for
`POST /api/threads/{id}/turns`**, and the request falls through to
`json(route, {})` at line 726 — a `200` with an empty body.

So a Playwright test that posts a turn gets a success it did not earn. UI-078
needed to assert that replying to a resolved thread reopens it; through the stub
that assertion would have been an assertion **about the stub**, so the real pin
went to `scripts/resolve-notice-promise.test.ts` and the behavioural drill ran
against a real server in a real browser instead.

**This is the same defect UI-056 was filed for**, one route over. That issue's
own summary states the principle: *a stub that resolves anchors differently from
the server makes every e2e assertion about anchoring meaningless — it tests the
stub.* The catch-all makes that failure **silent and general** rather than
specific: any route nobody thought to add is a route that quietly succeeds.

The catch-all is the root cause, not the missing handler. Adding a `turns`
handler fixes one route and leaves the mechanism that hid it.

## Acceptance Criteria

- [ ] An unhandled route **fails loudly** — the test that provoked it names the
      method and path rather than proceeding on an empty success
- [ ] Every route currently relying on the catch-all is identified before it is
      removed, and each is either given a real handler or an explicit,
      commented, deliberately-empty one. A blanket removal that breaks twenty
      specs at once teaches nothing about which of them were real
- [ ] `POST /api/threads/{id}/turns` gets a handler faithful to the server: it
      appends a turn, and — per SPEC §8 and SERVER-062 — a **person's** turn on a
      `resolved` thread sets it back to `open`, while an **agent's** does not
- [ ] With that handler, the reopen-on-reply behaviour is coverable from the
      board, which it is not today

## Technical Design

### Files to Create/Modify

- `apps/ui/e2e/stubCorpus.ts`, and whichever specs the change surfaces.

### Notes

- **Fidelity has a home already.** UI-056 added `apps/ui/e2e/serverParity.ts` —
  the server's rules restated for the stub — and `scripts/stub-server-parity.test.ts`,
  which runs fixtures through **both** implementations so drift is loud. A turn
  handler's behaviour belongs there rather than hand-rolled in the stub, for the
  same reason the anchor resolver does.
- Check whether the catch-all is load-bearing for routes that genuinely should be
  no-ops in a stub (UI-056 noted `/seen`, `/resolve`, `/reopen` answer `{}` and
  nothing reads them). Those want explicit empty handlers saying so, not silence.

## Testing Strategy

Provoke an unhandled route and assert the failure names it. Then a board-level
spec for reply-reopens-a-resolved-thread, which is currently impossible.

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
