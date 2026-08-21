# [UI-139] A refusal a keyboard-only or touch user cannot finish reading

## Domain

ui

## Status

done — implemented 2026-08-21 (opus); the orchestrator commits

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-058 (the console rider this builds)
- Blocks: —
- Related: UI-132 (which set the floor and named this gap), SHARED-057, UI-125
  (which built the console's tab machinery)

## Spec References

- SPEC.md **§11** — the console's **three tabs**, and the **Notices** paragraph
  (rider authorized 2026-08-21). Read it before coding; it settles every question
  this issue used to leave open.
- SPEC.md **§11** — *"Nothing resizes because of what it holds"* (SHARED-057) and
  its clause on revealing what does not fit
- SPEC.md **§14** — *"a warning on the API response, a server log entry, and
  console visibility"* for a failed workspace hook. No console surface has ever
  delivered the third.

## Summary

Raised by UI-132's implementer as the gap its own fix does not close, after PR
#53's reviewer found the clamp had no reveal at all.

A toast is clamped to two lines (`Toasts.css:93`) and carries its whole text on a
`title` (`Toasts.tsx:246`). That is the same reveal every other clamped surface in
v0.15.0 uses, and it is the right floor. **It reaches a sighted mouse user and
nobody else.**

- A `title` on a non-focusable `<span>` produces no tooltip on focus in any
  browser, so a **keyboard-only** user gets line two and then nothing.
- Touch has no hover, so a **touch** user gets the same.
- A **screen-reader** user is unaffected: the full text is in the DOM inside the
  `aria-live` region, so it is announced whole. The clamp is paint only.

Both blocked groups can dismiss the toast. Neither can read past line two of a
refusal — and a refusal's *reason* is a server string that exists on no other
surface in the product. That is not a truncation, it is a message that cannot be
finished.

## What was decided (SHARED-058, user authorization 2026-08-21)

The user was asked which of two shapes and answered **option 2**: the reason
moves somewhere durable — the console. The rider records the full reasoning and
what it rejected. What the implementer needs from it:

1. **The console gains a third tab, `Notices`.** Not an overlay, not a page of
   its own, and *not* rows appended to the Jobs list — a refusal is not a job and
   must not move the strip's job counts.
2. **The list is browser state, session-scoped.** No contract route, no server
   store, nothing on disk. A reload clears it, and that cost is accepted and
   stated in the rider.
3. **Error toasts still expire on their dwell.** UI-139's other option — an error
   toast that waits to be acknowledged — is rejected. Do not build it.
4. **An error notice marks the console until the tab is opened.** A confirmation
   marks nothing. This is what stops a refusal passing unseen now that toasts
   still expire.
5. **The two-line clamp stays**, and so does the `title`. SHARED-057's geometry
   guarantee does not depend on how the full text is reached, and the tooltip is
   still the fastest path for a pointer user.

## Acceptance Criteria

- [x] A refusal's full reason is reachable **without a pointer** — by a keyboard
      user and on touch — through the console's Notices tab
- [x] The tab lists every warning and refusal of the session, newest first, each
      with its whole text, its tone, and when it arrived
- [x] A notice is still readable after its toast has expired or been dismissed
- [x] An **error** notice marks the console until Notices has been opened; a
      confirmation does not mark it
- [x] The list is bounded, and on reaching its bound says how many it dropped
      rather than ending quietly (§11's stated-cap rule)
- [x] The tab is reachable and operable by keyboard, consistent with the two
      tabs UI-125 already built (`role="tablist"`, `Console.tsx:129`)
- [x] A toast a person is pointing at still does not move, and the stack's
      geometry is unchanged (UI-132's guarantee, unbroken)
- [x] Confirmations are not made stickier as a side effect, and error toasts are
      not made stickier either — expiry is unchanged
- [x] A browser test covers the keyboard path specifically, falsified by
      reverting the fix and watching it fail

## Technical Design

### Files to Create/Modify

- `apps/ui/src/shell/Toasts.tsx` — the toast raise is the notice's source. Every
  toast becomes a notice; nothing else may raise one, or the two lists drift.
- `apps/ui/src/console/Console.tsx`, `console.css` — the third tab, beside Jobs
  and Residents. `ConsoleTab` is already a union and the tablist is already
  keyboard-driven — extend them, do not build a second tab mechanism.
- `apps/ui/src/console/ConsoleStrip.tsx` — the attention marker.
- a new `Notices.tsx` beside `Residents.tsx`, which is the closest precedent for
  a simple list body in this drawer.

### Key Implementation Details

- Read UI-132's E2E log first. Its reserved-slot model and its
  overdue-not-paused hold are both load-bearing, and nothing here may disturb
  either.
- The notice store outlives individual toasts, so it cannot live in the toast
  array. It is a sibling of it, fed by the same raise.
- The bound: pick one, state it as a named constant, and make the "dropped N"
  line render from that constant rather than a literal — v0.15.0 lost a CI cycle
  to a reserve expressed as a magic value.

### Edge Cases

- Several refusals at once
- A refusal raised while the console is collapsed, and while it is open on
  another tab
- A refusal whose reason is very long — the tab shows it whole, so the tab's own
  row must not become a second clamp with no reveal
- The identical message raised twice: two notices, not one, with their own times

## Testing Strategy

A browser test driving the keyboard path end to end: raise a refusal, reach its
full text with the keyboard alone, and confirm the stack did not move. The
`title` gap is invisible to jsdom and to a pointer-driven spec alike, which is
why the floor was set without noticing this.

Component tests for the bound, the drop line, and the marker's clear-on-open.

## E2E Verification Plan

### Verification Steps

1. Real Vite dev server, ports not 5173 / not 8765
2. Raise a refusal with a reason longer than two lines
3. Reach its full text using only the keyboard
4. Let the toast expire, then read the reason again
5. Confirm the stack still does not move

## E2E Verification Log

**Implemented on: opus** (`claude-opus-5[1m]`). Real Chromium through Playwright,
against the real Vite dev server on `127.0.0.1:5673` (`CORPUS_UI_PORT=5673` —
never 5173, and nothing on 8765 was touched). The six-second dwell is driven with
`page.clock.install()` + `clock.runFor`, so no assertion here races a real timer.

**One fixture note, because it changed what was legitimate to assert.** A live
workspace server *is* running on `127.0.0.1:8765` on this machine, and Vite
proxies to it, so the shell reports `corpus 0.9.0` rather than `server
unreachable`. The suite therefore asserts nothing about health, and measures the
agent pill's **x** rather than the counts' box — the pill's width is its own
text's and settles a round trip later, which is a different question from
whether the marker pushed it.

### The gap, reproduced before the tab existed

`toast-stack.spec.ts` already proved the toast's `title` reveal reaches a mouse.
What it never measured is the span that carries it. In the real browser, on a
real 409 refusal:

```
.toast .msg   scrollHeight > clientHeight → true   (the box really does cut it)
.toast .msg   title contains the whole refusal      (the reveal exists)
.toast .msg   tabIndex → -1                         (and no keyboard can reach it)
```

Those three lines are the issue in one reading, and they are now the opening
assertions of `notices.spec.ts` — the reveal is real, and it is real only for a
pointer.

### The keyboard path, end to end

`apps/ui/e2e/notices.spec.ts`, 4 specs, all green. Every gesture after the raise
is `page.keyboard` — `page.mouse` is never called.

1. **is readable to the keyboard alone, before and after the toast expires** —
   a pin refused with a `409` carrying a 420-character reason; the three
   measurements above; `blur()` to put focus back at the top of the document;
   `Tab` until `document.activeElement` is `.console-strip` (reached, inside the
   60-press budget); `Enter` opens the drawer; `Tab` to `#console-tab-notices`;
   `Enter` selects it (`aria-selected="true"`); `.notice-msg` holds text equal to
   the toast's whole `title`, `scrollHeight <= clientHeight` (**not** cut), and
   no `title` of its own. Then `clock.runFor(7000)`: `.toast` count 0, and the
   notice is still on screen with the whole refusal in it.
2. **marks the console for a refusal, without re-widthing the strip** — the mark
   is in the DOM at rest with `data-unread="false"`; `e` raises a confirmation
   and it stays `false`; the refusal turns it `true` and visible; its own
   bounding box is **identical** to the box it had while unlit, and
   `.agent-pill`'s x is unchanged. Then the keyboard path again, and opening the
   tab returns it to `false`.
3. **does not move the toast stack when the drawer opens** — a toast's box
   before and after `Enter` on the strip: identical. UI-132's guarantee across
   the one seam this issue adds.
4. **lists every notice of the session, newest first** — a confirmation and the
   *same* refusal twice: three rows, tones `["error","error","info"]`, three
   separate times. Identical messages are two notices, not one.

### Falsification — three mutations, three different specs red

| mutation | result |
| --- | --- |
| **A.** `onKeyDown={onTabsKeyDown}` removed from the tablist | **3 failed, 1 passed** — every spec that presses a tab; the drawer-geometry spec stayed green, which is the control |
| **B.** `.c-notice-mark` made conditional (`display: none` → `inline`) instead of reserved | **1 failed, 3 passed** — only the geometry spec, at `boundingBox()` returning `null` for an unlit mark |
| **C.** `.notice-msg` given `max-height: 3.2em; overflow: hidden` | **1 failed, 3 passed** — only the keyboard spec, exactly at `scrollHeight <= clientHeight` |

Each mutation was reverted and the suite re-run: **4 passed** every time.

### Two things the falsification taught, both folded back in

**The first attempt at mutation C did not fail, and that was the finding.** A
`-webkit-line-clamp` on `.notice-msg` computed `display: flow-root` — a grid item
blockifies `-webkit-box`, so the clamp the toast uses cannot be reproduced inside
this list at all. A probe spec (since deleted) read the real numbers:

```
.notice-msg  scrollHeight 38  clientHeight 38  width 589.56  text 200 chars
```

38px is **two lines**. The 200-character fixture fits the drawer in two lines, so
a tab that *had* silently reintroduced a two-line clamp would have passed the
"not cut" assertion by having nothing to cut. `LONG_REFUSAL` is now 420
characters — cut twice over, in the toast's 360px and in the drawer's 590px — and
mutation C then failed as it should. A fixture that cannot fail proves nothing.

**`Enter` did not activate the console tabs, and never had.** The first e2e run
came back with the drawer open, the tab strip rendered, the unread dot lit on
`Notices` — and `Jobs` still selected. `useShortcuts` binds `Enter` globally to
`rows.open` in board scope and calls `preventDefault()`, which cancels the
browser's own activation of **any** focused button. The strip escapes it only
because it has its own React `onKeyDown`. So Jobs and Residents were not
pressable by keyboard either, since UI-125. The tablist now owns its keys —
`ArrowLeft`/`ArrowRight` with wrap, `Home`/`End`, and `Enter`/`Space` — which is
the ARIA pattern it was missing anyway and fixes all three tabs at once. **The
wider defect is reported to the orchestrator, not fixed here**: every button in
board scope still loses `Enter`, including the toast's own `✕`.

### Unit tests

- `Toasts.test.tsx` — **28 passed** (11 new): a notice survives its toast; every
  toast is recorded including ones the cap displaced from the stack; the same
  message twice is two notices; newest first; only `error` marks the console;
  the mark clears when the tab reports it was shown and not when a toast merely
  expires; empty outside a provider. Plus `appendNotice` directly, for the bound
  and the drop count.
- `Notices.test.tsx` — **18 passed** (new): the empty state, the whole reason
  with no `title`, the bound and its sentence, the three tabs in §11's order,
  the marker's four states, and the tab strip's keys key by key.
- `noticesModel.test.ts` — **7 passed** (new): the drop sentence agrees with the
  cap it was given, and the clock is eight characters at every hour.

### Regression sweep

- `apps/ui/src/console` + `apps/ui/src/shell`: **307 passed, 13 files.**
- Neighbouring e2e — `notices`, `toast-stack`, `residents-tab`, `console`,
  `console-strip-geometry`: **35 passed, 1 failed.** The one failure is
  `console.spec.ts › keeps the failed-job count off the health notice's class`,
  which asserts `server unreachable`; it fails because this machine *has* a
  server on 8765, and it touches no code this issue changed.
- `apps/ui/src` + `packages/kit/src`: **4144 passed, 1 failed** — the failure is
  `abandon/useAbandonEmpty.test.tsx` looking for a control labelled "threads on
  this document", a string that now exists **only in that test file**. Its source
  is `apps/ui/src/reader/**`, which another agent is editing on this branch right
  now. Not this issue's, and reported rather than touched.
- `eslint` clean on `apps/ui/src/console`, `apps/ui/src/shell` and the new spec;
  `prettier --check` clean on every touched file; `tsc --noEmit` in `apps/ui`
  exits 0.

### Look and feel

`design/index.html` draws no console tabs — it was written when the drawer had
one body — so the tab borrows UI-125's voice rather than inventing one: the
strip's mono face at 11px for the row's facts, and `--sans` at 12px for the
notice itself, which is the treatment `.lane-note` already gives prose one pane
over. The `!`/`✓` mark and `--signal`/`--good` are the toast's own, so a refusal
reads the same in both places.

## Self-review

**Why the log lives in `ToastProvider` and not in a store of its own.** The
rider's one structural rule is that the two lists cannot drift, and the cheapest
guarantee of that is a single write site: `notify` appends to the stack and to
the log in the same call, so "every toast becomes a notice" is true by
construction rather than by discipline. It is a *sibling* of the toast array,
never a view of it — a toast is gone in six seconds and the notice is not — and
it sits behind its own context so a component that merely raises toasts does not
re-render because one was raised.

**The tab lists confirmations too, and §11's sentence says "warning and
refusal".** Deliberate. The rider's own framing is "a toast is a notice
arriving, and this tab is where it stays", the acceptance criterion asks each row
to carry *its tone*, and a tone column is meaningless in a list of one tone. A
list that silently dropped confirmations would also be a second list that
disagrees with the stack, which is the exact failure the single write site
exists to prevent. Only the **marker** is scoped to `error`, which is what
SHARED-058 call 5 actually asks for.

**What it costs.** The strip is 7px wider at rest, spent on a marker box that is
usually invisible — the price of never moving the agent pill. A row in this tab
is as tall as its notice, which is a genuine exception to nothing: SHARED-057
governs a box that changes size after it is drawn, and a notice's text is
complete the moment the row is written. The list is bounded at 50 in a session,
and a reload clears the lot, which the rider states and the empty state says out
loud rather than leaving to be discovered.

**What was found and not fixed.** `Enter` is claimed globally by `useShortcuts`
in board scope, so it activates no focused button anywhere in the app — the
console tabs (all three), lane rows, job rows, and the toast's own `✕`. The
tablist now defends itself, which is the ARIA behaviour it owed a keyboard user
anyway. The general defect is a `keyboard/` change with the whole shortcut system
as its blast radius, and it is escalated rather than smuggled in here.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified
