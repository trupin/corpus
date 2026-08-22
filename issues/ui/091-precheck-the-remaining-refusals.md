# [UI-091] Pre-check the two refusals the composer still cannot see

## Domain

ui

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: CONTRACT-044
- Blocks: —

## Spec References

- SPEC.md §10 — the form says what is wrong before it is sent

## Summary

Completes PR #28's pre-check. `formPreflight.ts` covers the marker collisions;
the unterminated fence and the fabricated turn heading arrive as a write refusal
instead, because the scanners were unreachable (CONTRACT-044 fixes that).

§10 was deliberately scoped on review to promise only what ships, so this issue
is what lets that sentence widen — and widening it is a **SPEC edit needing user
sign-off**, drafted here and held, not applied.

## Acceptance Criteria

- [x] An answer leaving a fence open is caught before submitting, naming the
      field and the line the fence opened on
- [x] An answer containing a fabricated turn heading is caught the same way, if
      CONTRACT-044 moved `parseTurns`; if it did not, this criterion is dropped
      explicitly rather than quietly
- [x] It **calls** the shared scanner, never a copy
- [x] The server refusal stays as the backstop and keeps working — this is a
      second line of defence, not a replacement
- [x] The e2e stub exercises the same rule the server does
- [x] A §10 amendment is drafted for user sign-off and held

**On the second criterion's escape clause.** It does not apply. CONTRACT-044
moved the heading *grammar* (`turnHeadings`, `TURN_SEPARATOR`,
`CANONICAL_INSTANT`) into `@corpus/contract` while leaving `parseTurns` with the
sole writer — which is the shape a composer wants, since it asks whether a text
contains a line that would *become* a delimiter and where, not what the turns
are. The criterion is built, not dropped.

## Technical Design

### Files to Create/Modify

- `apps/ui/src/thread/formPreflight.ts`, whose docblock already records why
  these two are absent — update it rather than leaving a stale explanation.

## Testing Strategy

Fixtures for both shapes asserted as caught before any request is made, with the
zero-requests assertion the existing pre-check tests already use.

## Drafted SPEC.md §10 amendment — **held for user sign-off, not applied**

The sentence was deliberately scoped on review to promise only what shipped.
With all three checks now in the form, it can widen. Current text (SPEC.md line
464, inside the "**A form is a set of controls…**" paragraph):

> **The form says what is wrong before it is sent** — a required question still
> unanswered, and a line that would collide with the answer's own markers (§6) —
> naming the field at fault and the line, so a refusal is something to fix in
> place rather than a message that arrives after the attempt and takes the
> wording with it. The remaining refusals §6 names are caught on the write
> instead, and what they say is a person's sentence rather than a route's; **an
> answer is never lost to one** — the wording stays in the composer to be fixed.
> _(Rider signed 2026-08-07; scoped to what is checked before sending, the same
> day, on review.)_

Proposed text:

> **The form says what is wrong before it is sent** — a required question still
> unanswered, a line that would collide with the answer's own markers, a code
> fence left open, and a line that would read as a turn heading (§6) — naming
> the field at fault and the line, counted in the answer's own text, so a
> refusal is something to fix in place rather than a message that arrives after
> the attempt and takes the wording with it. What the form says before sending
> and what the write path says are **the same rules**, asked twice: the write
> refusal stays as the backstop, and a form that let something through would be
> refused there rather than written. **An answer is never lost to one** — the
> wording stays in the composer to be fixed. _(Rider signed 2026-08-07; scoped
> to what is checked before sending, the same day, on review; widened to every
> §6 refusal on ⟨date⟩ once UI-091 shipped them.)_

What changes behaviourally: nothing that is not already implemented and tested.
The amendment records the widening; it does not request it.

## E2E Verification Log

**Model: Opus 5 (1M context)** (recommended: opus — correctly calibrated; the
work was mechanical once CONTRACT-044's surface was read).

**Unit** — `npx vitest run apps/ui/src/thread/formPreflight.test.ts`: 51 passed.
`npx vitest run apps/ui packages/kit`: 3008 passed, 2 failed — both in
`packages/kit/src/client/turnWrites.test.ts` and both a `turn.model` ZodError
from another agent's concurrent CONTRACT-043 work, untouched by this issue.

**Turn-split parity, checked by hand** — the port retirement in
`serverParity.ts` was verified against `apps/server`'s `parseThreadBody` over
every `TURN_PARITY_BODIES` fixture with the new `model` field projected away:
all 8 agree. `scripts/stub-server-parity.test.ts` currently reports 6 failures,
every one of them the `model: null` field the server's parser has grown and the
stub's `StubTurn` has not — pre-existing and cross-domain, flagged rather than
patched.

**Playwright, real browser, real Vite dev server on port 5473** (5173 and 8765
deliberately avoided — an ssh tunnel and the user's live server hold them):

- `e2e/forms.spec.ts` — 11 passed, including three new ones:
  - _catches an unterminated fence in the form, before the wire_: typed
    `` the build printed:\n\n```sh\nnpm run build `` into the first `write`
    field. `.form-unreadable` under that field reads "this answer leaves a code
    fence open: the ``` on line 3 is never closed…"; the neighbouring field has
    no message; the textarea carries `aria-invalid="true"`; `.form-submit` is
    disabled and `⌘↵` produces **zero** `POST …/form` calls. Closing the fence
    clears the message, enables submit, and the answer is written with the code
    sample verbatim.
  - _catches a fabricated turn heading, and leaves a quoted one alone_: a bare
    `## user · 2026-07-19T10:20:00Z` on line 3 is marked ("line 3 of this
    answer is `## user · …`… separate turn signed by user"), submit disabled,
    zero requests. The **same words** inside a ```` ```md ```` fence, and again
    behind a `> ` block-quote marker, produce no message at all and submit
    enables — the SERVER-076 agreement, asserted in the browser.
  - _the write path still refuses both, with the form out of the way_: posting
    straight to `POST /api/threads/th_write/turns/{ts}/form` from the page,
    bypassing the composer, returns `400` "leaves a code fence open … line 7"
    (the turn body's coordinates, which is why the composer counts its own) and
    `400` "reads as a turn heading"; the same text with the fence closed returns
    `201`. The backstop is intact.
- `e2e/thread.spec.ts`, `e2e/turn-comment.spec.ts`, `e2e/turn-breaks.spec.ts`,
  `e2e/anchors.spec.ts` — 28 passed, exercising the stub's turn split through
  the retired port.

**Lint/format** — `eslint` and `prettier --check` clean on every touched file.
`tsc --noEmit` in `apps/ui` reports errors **only** for the concurrent
`turn.model` field, none in any file this issue touches.

**Parity decision (the second follow-up).** `scripts/stub-server-parity.test.ts`
keeps its `TURN_PARITY_BODIES` fixtures, and the reasoning is worth recording:
what they pinned was the heading regex *and* the fence masking *and* the
slicing. The first two are now imported, so they cannot disagree by
construction; the third — `trimTurnText` and the span each heading owns — is
still transcribed from `apps/server/src/core/turns.ts`, which `apps/ui` may not
import. So the fixtures still guard something real, just much less of it, and
`"an empty turn, and one with trailing blank lines"` is the case that fails if
the trimming drifts. The fence scanner and the heading grammar now need **no**
fixture at all, which is the right direction: a rule that becomes shared code
should lose its pin.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
