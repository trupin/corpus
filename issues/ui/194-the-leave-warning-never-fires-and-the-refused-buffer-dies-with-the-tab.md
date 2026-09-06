# [UI-194] The leave-warning never fires, and the refused buffer dies with the tab

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

## Origin

Re-filed 2026-09-06 from **SHARED-003** (the PR #11 / PR #12 review ledger),
MINOR finding 10 of the 2026-07-29 PR #11 review:

> (10, ui) `apps/ui/src/editor/useAutosave.ts:346-349` — `beforeunload` guard
> calls `preventDefault()` but never sets `event.returnValue`; pre-119
> Chromium/WebViews show no dialog and the parked buffer (only copy of user text)
> is destroyed unprompted.

The 2026-09-06 audit re-checked the code (the handler has moved to lines 536-539)
and singled this out as **the one data-loss finding in the whole ledger**. Every
other live item is wording, a nit, or a design decision. This one loses text a
person typed.

## Spec References

- SPEC.md §4 — edit sessions and the workspace's guarantee that a person's text
  reaches the file
- SPEC.md §10 — the editor and its saved/unsaved reporting

## Summary

`useAutosave` registers a `beforeunload` handler for exactly one state: a save the
server **refused**, which has not landed since. In that state the tab holds the
only copy of the user's text — resending is precisely what already failed — so
closing or reloading destroys it silently. The handler calls
`event.preventDefault()` and stops there. `preventDefault()` alone triggers the
browser's confirmation dialog only in Chromium 119 and later and in current
Firefox and Safari. In older Chromium and in embedded WebViews, a handler that
does not also set `event.returnValue` produces **no dialog at all**, so the tab
closes and the text is gone with no prompt.

The module's own comment states the intent plainly. The implementation does not
carry it out everywhere it runs.

## Acceptance Criteria

- [ ] The `beforeunload` handler sets `event.returnValue` (to a non-empty string)
      in addition to calling `event.preventDefault()`, so the dialog fires on
      every engine the product can run in.
- [ ] The order is the documented one: `preventDefault()` first, then
      `returnValue`, then `return` the string where the engine wants a return
      value. Cover all three conventions in one handler — they do not conflict.
- [ ] The handler's existing precondition is unchanged: it fires **only** when
      there is a pending buffer **and** the last save was refused. An ordinary
      pending save must still produce no dialog, for the reason the comment gives
      ("a dialog people learn to dismiss without reading").
- [ ] A test asserts that with `pending` set and `refused` true, the handler both
      calls `preventDefault` and assigns `returnValue`; and that with `refused`
      false it does neither.
- [ ] The comment above the handler is updated to say why `returnValue` is set,
      so nobody removes it again as a deprecated property.
- [ ] `pagehide`-driven flush behaviour is untouched.

## Technical Design

### Files to Create/Modify

- `apps/ui/src/editor/useAutosave.ts` — the `onLeave` handler, lines 536-539.
- `apps/ui/src/editor/useAutosave.test.ts` — the two cases.

### Key Implementation Details

`apps/ui/src/editor/useAutosave.ts:522-541`:

```ts
    /**
     * The one buffer that closing the tab would destroy.
     *
     * A save the server **refused** and that has not landed since is text the
     * flush below cannot rescue: sending it again is exactly what already
     * failed. The only thing keeping it alive is the tab, so closing or
     * reloading destroys the only copy silently, and the chip that was saying so
     * goes with it. This is the browser's own "leave without saving?", fired for
     * precisely that state.
     *
     * An ordinary pending save needs nothing here: `pagehide` flushes it, and a
     * prompt on every unloaded page with an unsettled debounce would be the kind
     * of dialog people learn to dismiss without reading.
     */
    const onLeave = (event: BeforeUnloadEvent): void => {
      if (pending.current === null || !refused.current) return;
      event.preventDefault();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onLeave);
```

The fix is small. What it must not do is widen the condition on line 537 — the
guard is deliberate and the comment above it explains why. `returnValue` is
formally deprecated in the HTML standard and TypeScript's `BeforeUnloadEvent`
still declares it, so no cast should be needed. If lint objects to assigning a
deprecated property, fix it with a targeted, justified comment rather than by
broadening a rule — and never by dropping the assignment.

Browsers ignore the string's content and show their own wording. Set it anyway:
it is the signal, not the message.

### Edge Cases

- The user's browser may suppress the dialog entirely when the page has had no
  user interaction. That is the browser's rule and nothing here can change it —
  do not try to work around it, and note it in the log rather than treating a
  suppressed dialog as a failed verification.
- The handler is removed on cleanup (line 552). Keep that.
- Playwright cannot assert on the native dialog's appearance reliably across
  engines. The E2E leg proves the handler is registered and fires; the unit leg
  proves what it does.

## Testing Strategy

Unit tests over the handler with a synthetic `BeforeUnloadEvent` (a plain object
with a `preventDefault` spy and a writable `returnValue`), for the four
combinations of `pending` and `refused`. Assert `returnValue` is assigned exactly
in the one state that warrants the dialog.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start the real app and open a document in the editor.
2. Force the server to refuse a save (stop the server, or induce a validation
   refusal the editor surfaces as refused — say which was used).
3. Type text so a buffer is pending and the refused chip is showing.
4. Close the tab.
5. Expected: the browser asks whether to leave.
6. Actual on a pre-119 Chromium or a WebView: the tab closes with no prompt and
   the typed text is gone. On a current browser the dialog does appear — which is
   why this has not been noticed, and is not evidence the code is right.

### Verification Steps

1. Rebuild the UI and reload.
2. Repeat steps 2-4; confirm the dialog fires and cancelling it leaves the buffer
   and the chip intact.
3. Confirm an ordinary pending save (server healthy) still closes with **no**
   dialog — the regression this issue must not introduce.

## E2E Verification Log

_[Agent fills. State which model the implementing agent ran on, and state which
browser/engine each leg was run in — this finding is engine-dependent and a log
that does not name the engine proves nothing.]_

### Reproduction (bugs only)

_[Agent fills]_

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence, naming the engine
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (data loss — qualifying)
- [ ] `/evaluate` passes
- [ ] Committed with `[UI-194]` prefix
