# [UI-132] The toast stack collapses toward its anchor when the oldest expires

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-057 (signed 2026-08-20), UI-128 (the audit that measured it)
- Blocks: —
- Related: UI-127 (the same shape, with a hover in place of the timer)

## Spec References

- SPEC.md **§11** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)

## Summary

`.toast-wrap` is `position: fixed; bottom: 18px` — anchored by its **bottom**
edge — and `Toasts.tsx:79` puts the newest toast **first**, which makes the
**oldest** the bottom child. The oldest is also the first to expire, on a 6-second
timer nobody controls. So when a toast goes, every toast above it **drops** toward
the anchor.

Each toast carries a `✕` close button. Aiming at one and hitting the next one
down is the ordinary outcome. This is UI-127's exact geometry — a bottom-anchored
container growing back toward what anchors it — with a timer where UI-127 had a
hover.

## The measurement (UI-128, real Chromium, 2026-08-20)

Three toasts in the real `.toast-wrap`, then the oldest removed:

```
before: 0@y=568 1@y=615 2@y=663
after : 0@y=615 1@y=663
```

**47px, per expiry.** Toast `0` — the newest, the one a person is most likely
reading — moves from 568 to 615.

The second, smaller instance of the same rule: `.toast { max-width: 360px }` with
no height, so a toast's own text height decides where the toasts above it sit. A
two-line notice displaces the stack more than a one-line one.

## Acceptance Criteria

- [x] **Measure the box, change the content, measure again, assert unchanged**: a
      Playwright spec raises three toasts, records each one's bounding box, lets
      the oldest expire (or dismisses it), and asserts **the surviving toasts did
      not move**
- [x] The same assertion when a toast is dismissed by its `✕` rather than by the
      timer — the person's own click must not move the toast beside the one they
      clicked
- [x] The same assertion when a **taller** toast is raised beside a short one: one
      toast's text height does not decide another toast's position
- [x] The newest toast still appears where a person is already looking. Whatever
      anchoring is chosen, arriving and departing must both leave the existing
      stack still
- [x] `.toast-wrap:empty { display: none }` (`Toasts.css:15-17`) survives — an
      empty wrapper must still not sit over the console strip swallowing clicks
- [x] `MAX_TOASTS` trimming (`Toasts.tsx:79`) still holds
- [x] **Falsification**: restore the bottom anchor with the newest-first order and
      watch the spec fail

Added by the orchestrator's brief, and met:

- [x] A toast the pointer is on does not move **and does not vanish under the
      pointer**; the click a person was committed to still reaches it
- [x] The hold is not immortality, and cannot grow a wall of toasts
- [x] A focused toast is not dismissed out from under the focus ring, and focus
      never jumps to another toast because one below it left

## Technical Design

### Files to Create/Modify

- `apps/ui/src/shell/Toasts.css` — `.toast-wrap`, `.toast`
- `apps/ui/src/shell/Toasts.tsx` — the ordering, if that is what changes
- `apps/ui/e2e/` — the geometry spec

### Key Implementation Details

The defect has two independent halves and both need answering.

**Half one: the anchor fights the order.** The container is bottom-anchored and
the expiring toast is the bottom child. Three ways out:

1. **Reverse the order.** Put the oldest at the top (`[...current, notice]` with
   `column-reverse`, or keep the array and let CSS order it) so the expiring
   toast is the one nearest the anchor and its removal moves nothing. This is the
   smallest change and it makes the anchor and the lifecycle agree.
2. **Anchor the top.** Give the wrapper a `top` computed from a reserved stack
   height rather than a `bottom`. Costs a reserved height and changes where a
   single toast sits.
3. **Reserve the slot.** Leave the expired toast's box in place, empty, until the
   whole stack drains. Correct, and it makes an empty rectangle hang over the
   console strip — check it against `:empty`'s reasoning before choosing it.

**Prefer 1.** Confirm against `design/index.html`, which is the authority on where
toasts sit and in which direction they stack — `Toasts.css:1` says the whole
component was ported from `.toast-wrap` there. **If the mockup shows newest at the
bottom, that is a look-and-feel constraint and the answer is 2 or 3, not 1.**

**Half two: a toast's height is its text.** `.toast { max-width: 360px }` and no
height, so a long notice wraps. Give the toast a height sized to the notices the
product actually raises — grep every `useToast()` call site for the real copy —
and truncate-with-reveal anything longer, per clause 2. A toast is a transient
notice, so the reveal may legitimately be "it is also on the surface that raised
it" rather than a tooltip.

### Edge Cases

- One toast only — nothing to move, but the spec should cover it
- `MAX_TOASTS` reached, so a new toast displaces an old one in the same frame
- Two toasts expiring in the same frame
- A toast dismissed by `✕` while another is mid-timer
- A notice long enough to wrap to two or three lines
- The console drawer open, which is what `:empty` exists for

## Testing Strategy

Unit tests for the ordering change in `Toasts.tsx`. The defect is layout and a
timer, so the acceptance test is a real-browser geometry spec. Drive the timer
with Playwright's clock control rather than waiting 6 real seconds per assertion.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Real Vite dev server on a port that is not 5173
2. Raise three toasts through a real path that raises them
3. Record each toast's bounding box
4. Let the oldest expire
5. Expected: the survivors do not move. Actual: each drops 47px

### Verification Steps

1. Restart the dev server after the change
2. Repeat the reproduction, and repeat it again dismissing by `✕`
3. Expected: the survivors' boxes are identical before and after
4. Compare the resulting stack against `design/index.html`

## E2E Verification Log

**Implemented on: opus.** Real Chromium through Playwright, real Vite dev server
on `127.0.0.1:5288` (proxy target `127.0.0.1:8898`, deliberately unbound — the
board's zero-column case, and the two notices this log uses touch no network).
The six-second dwell is driven by `page.clock.install()` + `clock.runFor`, so no
assertion here races a real timer.

### Reproduction, before any change

Harness: a temporary spec (since deleted) that raises three toasts two seconds
apart — `e` with nothing open, `r` with no thread, `e` again — reads every
`.toast`'s top edge and height, runs the clock 2.2 s past the first toast's
dwell, and reads them again.

```
BEFORE: 0@y=533 h=57 "Nothing to archive…" | 1@y=598 h=39 "No thread to reply…" | 2@y=645 h=57 "Nothing to archive…"
AFTER : 0@y=598 h=57 "Nothing to archive…" | 1@y=663 h=39 "No thread to reply…"
```

Both halves of the defect, in one reading:

1. **The stack collapsed toward its anchor.** Every survivor dropped **65px** on
   one expiry (533→598, 598→663). UI-128 measured 47px on a stack of one-line
   toasts; 65px is the same 47px plus the second line two of these three notices
   wrap to. The `✕` a person aimed at moved a whole toast's height, downward,
   with no input from them.
2. **A toast's height was its text.** `h=57` beside `h=39` in the same stack.

### Verification, after the change

Same harness, same three notices, same clock:

```
BEFORE: 0@y=519 h=56 | 1@y=583 h=56 | 2@y=646 h=56
AFTER : 0@y=519 h=56 | 1@y=583 h=56
```

**0px.** The expiring toast's slot empties and nothing else moves. Every toast is
the same 56px box whatever is in it.

### The suite — `apps/ui/e2e/toast-stack.spec.ts`, 8 specs, all green

1. **does not move when the oldest expires under the pointer** — three toasts,
   the pointer parked on the middle one's `✕` at coordinates captured before
   anything moves, the oldest's dwell run out. Both survivors' boxes are equal
   to the recorded ones, and the click at those same coordinates dismisses the
   toast that was aimed at, leaving the one above it alone.
2. **does not move when a toast is dismissed by its `✕`.**
3. **does not move when a toast arrives** — the anchored toast's box is
   identical after the second and third arrive.
4. **does not vanish from under the pointer, and goes when it leaves** — three
   whole dwells (18 s of driven clock) with the pointer resting on it and it is
   still there; the pointer moves to (4,4) and it goes at once.
5. **holds a toast the keyboard is on, and never moves the focus** — focus on
   the middle toast's `✕`; the toast below it expires and
   `document.activeElement` is still inside slot 1, at the same box; 12 s more
   and the focused toast is still up while the unfocused one above it has gone
   on time (the control); `⇧Tab` moves focus and the overdue toast goes with it.
6. **keeps a toast's height off its text, and its neighbour's place off both** —
   a short notice, then a refused pin through the real ghost-column path whose
   409 carries a refusal too long to fit. Same height as the short one, the
   short one's box unchanged, `scrollHeight > clientHeight` on the message
   (cut, not accommodated), and the whole refusal still in the text an
   assistive reader gets.
7. **reserves its slots without laying a lid over the console strip** — empty,
   `.toast-wrap` computes `display: none`; occupied, it computes
   `pointer-events: none` while `.toast` computes `auto`, and
   `elementFromPoint` over an unfilled part of the reserve hits something that
   is not the wrapper.
8. **still keeps at most three, and never two toasts in one slot** — five
   notices, three toasts, slots `0,1,2` each occupied exactly once.

### Falsification

`Toasts.tsx` and `Toasts.css` were restored to the pre-fix versions (bottom
anchor, newest-first, no reserved height) and the suites re-run:

- The measurement harness came back with the **65px** drop above.
- `toast-stack.spec.ts`: **PASS (0) FAIL (8)** — every spec red.

Restoring the fix: measurement back to **0px**, `toast-stack.spec.ts` **PASS (8)
FAIL (0)**.

### Regression sweep

- `apps/ui/src` + `packages/kit` unit suites: **4095 passed, 208 files.**
- Every e2e spec that reads a toast — `board`, `console`, `attachments`,
  `forms`, `recipient`, `resident`, plus `smoke`: **74 passed, 0 failed.**
- `eslint` and `prettier --check` clean on all four touched files.
- `tsc --noEmit` in `apps/ui` reports two errors, both in
  `e2e/stubCorpus.ts:1222,1230` (a `Health`/`StubPayload` mismatch), neither in
  a file this issue touches and both present before it. Reported to the
  orchestrator rather than fixed here.

### Look and feel, against `design/index.html`

Screenshots of one toast and of three. A lone toast sits exactly where the
prototype puts it, at the bottom-right anchor. Two deviations, both deliberate
and both consequences of the rider:

- A toast is a fixed two-line box rather than one sized by its sentence. The
  prototype's own copy is the measurement: "Nothing to archive — open a document
  or highlight a row." already wraps to two lines at 360px.
- Inside a stack of more than one, the newest is now at the top rather than the
  bottom. Nothing else preserves both "the lone toast is at the corner" and
  "an arrival moves nothing" — see the Self-review note below.

## Self-review

**Why slots rather than the issue's option 1.** Reversing the order alone does
not hold. `design/index.html` appends (`wrap.appendChild`), so the prototype's
newest sits at the bottom, against the anchor — and the issue is explicit that
this makes option 1 wrong. But the deeper reason is that no ordering of a
bottom-anchored flow satisfies the criterion "arriving and departing must both
leave the existing stack still": whichever end the newest joins, one of the two
events pushes the others. Only fixed slots make both events free, which is the
issue's option 2 (a reserved stack height) with the slot bookkeeping of option
3 — and without option 3's empty rectangle over the console, because the
wrapper takes no pointer events.

**What it costs.** A fixed toast height, so a one-word error message sits in the
same box as a two-line one; a 360×184 reserve that is invisible and inert but
always in the layer; and the newest-at-the-top reading order inside a stack of
more than one. The alternative to the last one — filling the slots downward so
the newest is at the bottom — puts a lone toast 128px above the corner with
nothing under it, which is worse for the overwhelmingly common case of exactly
one toast.

**The hover behaviour, precisely.** The dwell is never paused. It elapses on
time, and a toast the pointer is on or the focus is in is marked *overdue*
instead of dropped; it goes the instant the person leaves it. So it is not
immortal — it needs continuous pointing to stay — and it cannot become a wall,
because the cap is still three and a notice arriving at a full stack takes the
slot of the oldest toast **nobody is touching**. At most one toast is under the
pointer and at most one holds focus, so with three slots there is always one to
take. Nothing about what a toast says, how long it lasts, or which acts raise
one has changed.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in, reproduction first
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-132]` prefix
