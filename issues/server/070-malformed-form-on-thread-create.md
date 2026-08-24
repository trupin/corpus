# [SERVER-070] A malformed form can still reach disk through thread creation

## Domain

server

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SERVER-068, CONTRACT-038
- Blocks: —

## Spec References

- SPEC.md §6 — forms are written only through the server's thread endpoints
- SPEC.md §10 — a malformed form renders as a broken block

## Summary

Scoped out of SERVER-068 deliberately, and reported rather than quietly widened.

CONTRACT-038 declared the write-time refusal for a malformed form fence on
`POST /api/threads/{id}/turns` only, and SERVER-068 enforced it there
(`assertWritableForm`, agent turns only — a person quoting a fence is quoting).

**`POST /api/threads` is the other door.** When the agent authors a thread's
first turn, that turn can carry a form fence, and nothing checks it — so a
malformed form still reaches disk by that route.

The half that catches it afterwards does exist: §10's raw-render rule means the
board shows a broken block rather than half-working controls, and
`unterminated-fence` (SERVER-066) catches the fence-shaped subset. So this is a
narrowing of a hole rather than an open wound. But the asymmetry is arbitrary —
the same bytes are refused on one route and accepted on another — and an
arbitrary rule is one a later reader will "simplify" in whichever direction they
meet first.

## Acceptance Criteria

- [x] A malformed form fence in a thread-creating agent turn is refused with the
      same status and the same message shape as the turn-append route
- [x] A **person** creating a thread that quotes a form fence is **not** refused —
      quoting is not authoring, which is the distinction `assertWritableForm`
      already draws
- [x] The **three** routes share one implementation, not two that agree today —
      capture was the third door and is now guarded too
- [x] Whether the contract needs a declared `400` on `POST /api/threads` is
      answered explicitly: **no.** `POST /api/threads` already declares
      `400: VALIDATION_RESPONSE` (`packages/contract/src/routes/threads.ts:45`),
      and so does `POST /api/capture` (`routes/capture.ts:37`). The refusal is a
      new *reason* for a status both routes already publish, in the envelope they
      already publish it in, so nothing is added silently and no §9.2 line moves.
      No CONTRACT issue is needed.

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/create.ts`, reusing SERVER-068's
  `assertWritableForm` from `apps/server/src/core/form.ts`.

### Notes

- Check the **capture** path too (`apps/server/src/capture/capture.ts`) — it
  creates a filing thread and may be a third door. SERVER-068 did not survey it.
- Do not widen the refusal to person-authored turns. §6 makes forms an agent
  affordance; a person pasting a broken fence into a comment is ordinary content,
  and refusing their message to protect a form they were not writing would be the
  same class of error as blocking a save for a pre-existing condition
  (SERVER-066's non-blocking decision).

## Testing Strategy

The same fixtures the turn-append refusal uses, driven through thread creation
and through capture; plus the person-quoting case asserted as accepted on every
route.

## E2E Verification Log

**Model: Opus 5 (1M context).** 2026-08-24, branch `phase-45-not-so`.

### The change

`assertWritableForm(actor, text)` — SERVER-068's function, unmoved and unedited —
is now called from all three doors onto an agent turn:

| door | file | placed |
| --- | --- | --- |
| `POST /api/threads/{id}/turns` | `threads/turns.ts:379` | unchanged |
| `POST /api/threads` | `threads/create.ts` | beside `assertAppendableTurnText`, before the lanes and before a byte is written |
| `POST /api/capture` | `capture/capture.ts` | beside `assertAppendableTurnText`, same reasoning |

The capture door is the one SERVER-068 never surveyed, and the issue's Notes
asked for it to be checked. It is a real third door: a capture's text becomes the
filing thread's **first turn** as well as the document's body. The document
written beside it is unaffected either way — §6 makes a form something a *turn*
carries and no reader looks for one in a document body — so the refusal is worded
about the turn, as `assertAppendableTurnText`'s already is at that site.

The refusal is not widened to people on any door. §6 makes forms an agent
affordance, and a person pasting a broken fence is writing ordinary content.

### Reproduction and verification — real server, real workspace, port 8791

The bytes throughout: a `form` fence naming a fourth kind.

````
```form
fields:
  - question: "Rate?"
    kind: "pick a date"
```
````

```
$ corpus thread create --from agent --title "Ask" -m "<bad>"
  "message": "fields.0.kind: Invalid discriminator value. Expected 'choose one' | 'choose any' | 'write'"
  (400)

$ corpus thread create --from user --title "Quoting" -m "<bad>"
created th_577m3kzn — standalone                     # quoting is not authoring

$ corpus thread reply th_pfn2yl7i --from agent -m "<bad>"
  "message": "fields.0.kind: Invalid discriminator value…"    # the turn route, unchanged

$ corpus thread create --from agent --title "Good ask" -m "<well-formed form>"
created th_5no2xt3e — standalone
```

And the third door, over HTTP because capture has no CLI verb:

```
$ curl -X POST /api/capture -H 'x-corpus-author: agent' -F "text=<bad>"
{"code":"bad_request","message":"the `form` block in this turn is not a valid form:
 fields.0.kind: Invalid discriminator value. Expected 'choose one' | 'choose any' | 'write'",
 "issues":[{"path":"body","message":"fields.0.kind: Invalid discriminator value…"}]}
HTTP 400

$ curl -X POST /api/capture -H 'x-corpus-author: user' -F "text=<bad>"
{"docId":"doc_yhidaeqi","threadId":"th_oq3je2te","eventId":"evt_tqd6swv7z2cp","warnings":[]}
HTTP 201
```

**Same status, same envelope, same message text as the turn-append route** — the
message is one function's, so it cannot drift.

### Falsification

Both new call sites removed (the pre-fix state):

```
vitest run apps/server/src/threads/forms.test.ts apps/server/src/capture/capture.test.ts
  × 8 failed  — six on `POST /api/threads` (five malformed shapes plus
    "refuses before a byte is written"), two on capture
  Tests  8 failed | 94 passed (102)     exit 1
```

Restored, green. Thirteen new tests: nine in `forms.test.ts` (the five malformed
shapes the turn route already pins, driven through creation, plus no-thread-left-
behind, both well-formed spellings, a fence-free turn, and the person case) and
four in `capture.test.ts` (refusal, nothing written, the person case, and a
well-formed form accepted).

### Checks

```
npm run typecheck -w apps/server                exit 0
eslint apps/server/src                          exit 0   (no rule disabled)
VITEST_MAX_THREADS=4 vitest run apps/server
  Test Files 204 passed (204)   Tests 4662 passed (4662)   exit 0
```

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
