# [UI-085] The e2e stub answers unhandled routes with `{}` instead of failing

## Domain

ui

## Status

done

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

- [x] An unhandled route **fails loudly** — the test that provoked it names the
      method and path rather than proceeding on an empty success
- [x] Every route currently relying on the catch-all is identified before it is
      removed, and each is either given a real handler or an explicit,
      commented, deliberately-empty one. A blanket removal that breaks twenty
      specs at once teaches nothing about which of them were real
- [x] `POST /api/threads/{id}/turns` gets a handler faithful to the server: it
      appends a turn, and — per SPEC §8 and SERVER-062 — a **person's** turn on a
      `resolved` thread sets it back to `open`, while an **agent's** does not
- [x] With that handler, the reopen-on-reply behaviour is coverable from the
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

**Model: Opus 5 (1M context).** Verified in a real browser through Playwright
against the stub, which is the surface under test here.

### How the catch-all's dependants were identified

Statically, before anything was removed, by enumerating the route table the
board can actually issue — `packages/kit/src/client/createCorpusClient.ts`, the
one place every `/api` call is declared — and diffing it against the branches in
`stubCorpus.ts`. Six core routes were living on the fallback:

| route | what the fallback did | now |
| --- | --- | --- |
| `GET /api/jobs/{id}/log` | `200 {}` → `lines: undefined` | real handler off the seeded `lastLine`, cursor honoured |
| `POST /api/jobs/{id}/retry` | `200 {}` | moves the seeded job to `pending`, answers the moved `Job` |
| `POST /api/jobs/{id}/abandon` | `200 {}` | moves it to `abandoned` |
| `POST /api/queue/halt` | `200 {}` | flips `halted`, answers the status **after** the flip |
| `POST /api/queue/resume` | `200 {}` | flips it back |
| `DELETE /api/threads/{id}/turns/{ts}` | `200 {}` | rewrites the body from the turns that remain, models the thread and anchor cascade |

And one that was not even reaching the fallback:
`POST /api/docs/{id}/edit-session/flush` was swallowed by the
`startsWith("/api/docs/")` block, which read `"<id>/edit-session/flush"` as a
document id and answered `404` — so every closing reader's flush was refused on
every stubbed page, and `edit-session-close.spec.ts` counted requests rather than
answers. It now answers `204`, which is what the route returns and what
`flushEditSession` reads.

`/api/x/**` — the plugin namespace — keeps an **explicit, commented** empty
answer. The core stub cannot know a plugin's shapes, every plugin spec registers
its own handler ahead of it, and the plugin client validates its responses with
Zod, so the empty body is refused at that boundary rather than passing unnoticed.

### The refusal, in a real browser

`apps/ui/e2e/stub-fidelity.spec.ts`, run with `CORPUS_UI_PORT=5473 npm run e2e`:

```
✓ an unhandled route › is refused with the method and the path, not answered with an empty success
✓ an unhandled route › does not fire for the routes the board actually issues on a first paint
✓ replying to a resolved conversation › reopens it, from the board, exactly as the server does
```

The refusal is loud in three places at once. On the wire it is a `501` carrying
the contract's own error shape, and the page reads it back:

```
status 501
body   "stubCorpus has no handler for POST /api/nothing-here — refused rather than
        answered, because a stub that invents an empty success lets a spec assert
        behaviour nobody implemented (UI-085). Add a handler in apps/ui/e2e/stubCorpus.ts."
```

On the runner's stderr, printed for the request nothing was awaiting:

```
[stubCorpus] stubCorpus has no handler for POST /api/nothing-here — refused rather
than answered, because a stub that invents an empty success lets a spec assert
behaviour nobody implemented (UI-085). Add a handler in apps/ui/e2e/stubCorpus.ts.
```

And in `StubCorpus.unhandled()`, for a spec that wants to assert over it. The
second test is the regression guard for the removal itself: opening a document
exercises docs, threads, tree, queue, agents, health, index and jobs, and
`unhandled()` is `[]` afterwards.

### Falsification

Both halves were broken and watched to fail.

1. Fallback back to `json(route, {} as unknown as InternalError)`:
   `✘ is refused with the method and the path` — `expect(answer.status).toBe(501)`
   received `200`.
2. The reopen deleted from the turn handler
   (`if (doc.status === "resolved" && status === "open")` removed):
   `✘ reopens it, from the board, exactly as the server does` — the card's status
   chip stayed `resolved`.
3. `nextThreadStatus` made unconditional (`status === "resolved" ? "open"`):
   `scripts/stub-server-parity.test.ts` → **10 failed | 66 passed**, including
   every `agent turn on a resolved/... thread` cell.

Restored in each case and re-run green.

### Fidelity has a home

§8's reopen is ported into `apps/ui/e2e/serverParity.ts` as `nextThreadStatus`
and pinned by `scripts/stub-server-parity.test.ts`, which runs a 36-cell matrix
(author × status × agent state × the `requestsAgent` tri-state) through **both**
that copy and the server's own `decideParticipation`. 76 tests pass.

### Affected specs, re-run

`changelog`, `console`, `console-index`, `abandon`, `edit-session-close`,
`digit-geometry`, `reader-head-geometry`, `todos`, `todos-menu`,
`plugin-late-arrival`, `context-menu`, `reveal`, `soft-wrap`, `collapse`,
`anchor-layer`, `reader`, `thread`, `turn-comment`, `comment-move`, `reattach`,
`related`, `images`, `render-fixes`, `fences`, `editor`, `forms`, `attachments`,
`key-conflict`, `composer-sticky`, `autocomplete-keys`, `compose-keyboard` — all
green.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
