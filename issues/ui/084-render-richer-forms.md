# [UI-084] Render choose-any and write fields; the attention row that survives being read

## Domain

ui

## Status

todo

## Priority

P1 (important)

## Model

opus

## Dependencies

- Depends on: CONTRACT-038 (the grammar and the answer request)
- Blocks: —
- Related: SERVER-068 renders nothing but writes the record this issue's controls
  become; the two consume CONTRACT-038 independently and neither blocks the other

## Spec References

- SPEC.md **§11**, Thread view — "**A form is a set of controls, and once answered
  it is a record**": one control per field matched to what the field asks,
  required ones marked, a single submit naming its key, a place for the note,
  submit gated on the required fields with the missing one named, everything
  reachable from the keyboard, the answered form shown in place, and a form the
  app cannot read rendering as the visibly broken code block it is — **never as a
  partial set of controls**
- SPEC.md **§11**, Attention — "**An unanswered form's row is the one that
  survives being read**", and a thread holding more than one says how many are
  still open
- SPEC.md **§6**, "Forms in turns" — the three kinds, required by default,
  answered once as a whole, the optional note about the ask as a whole
- SPEC.md **§7**, Read state — what clears an unread signal, and why a form's
  signal does not clear that way
- SPEC.md **§8** — the pending-agent indicator, which is **not** changed here and
  must not be suppressed

## Summary

Two halves, and the second one is the half that delivers the user's actual
motivation.

**The controls.** `apps/ui/src/thread/FormBlock.tsx` renders one `.form-opt`
button per option with `picked: string | null` — single-select, one prompt, one
note. §6 now has three field kinds and a form is a list of fields, so the block
becomes a list of controls: **choose one**, **choose any**, and **write**. Required
fields are marked, submit is available only once every required field has an
answer, and when it is not the form **says which question is still missing**
rather than letting the attempt fail silently. Everything is reachable from the
keyboard — §11 adds no pointer-exclusive capability, and a form the person cannot
answer without a mouse is a question they cannot answer.

**The attention asymmetry, which is the point.** §7's read state clears when you
look: opening a thread marks it seen, so a question the agent asks **in prose**
produces an Attention row that vanishes the instant you read it, answered or not.
The most common way to lose a question in this system is to read it. An
unanswered form is the **one** Attention reason that does not work that way — its
row clears by **acting** on it (answering) or by resolving the thread, and by
nothing else. That asymmetry is what a form buys over asking in prose, it is why
the user asked for forms at all ("it would also make it easy to detect whenever a
thread needs my attention"), and today it exists only as a SQL predicate's
`status = 'open'` guard rather than as behaviour anyone tests. This issue makes
it visible and testable in the board: open a thread with an unanswered form,
close it, and the row is still there.

Both signals coexist. A thread can owe an answer to the person **and** a reply
from the agent at the same time, and when it does it says both — the form's
"awaiting your answer" is never suppressed by work the agent still owes, and §8's
pending indicator is never suppressed by a question the person still owes. A row
that hid one of them would be lying about the other.

## Acceptance Criteria

### The controls

- [ ] A form renders **one control per field**, matched to what the field asks:
      choose one, choose any, write
- [ ] **Required fields are marked**; submit is unavailable until every required
      field has an answer, and the form **names the question still missing**
- [ ] A **choose-any** field accepts none, one, or several options; a **write**
      field accepts free text and grows to fit
- [ ] One submit for the **whole form**, naming its key like every other composer
      control, and one place for the optional **note about the ask as a whole**
- [ ] **Everything is keyboard-reachable**, submit included — asserted, not
      assumed
- [ ] **Once submitted the form stops being a question**: the controls become the
      recorded answer, shown in place, each question beside what was given for it,
      so the turn afterwards reads as the exchange it was. There is no way to
      submit a second answer
- [ ] A **legacy** `prompt` + `options` form renders as one required choose-one
      control and answers exactly as it does today
- [ ] A form the app cannot read — YAML that does not parse, or a field outside
      §6's three kinds — renders as the **visibly broken code block** it is,
      **never as a partial set of controls**, and is not answerable

### The attention asymmetry

- [ ] A thread with an unanswered form shows an Attention row reading "awaiting
      your answer"
- [ ] **Opening the thread and closing it again leaves the row in place** — the
      test that distinguishes this feature from every other Attention reason
- [ ] Answering clears the row **live** over SSE; resolving the thread also clears
      it
- [ ] A thread holding **more than one** unanswered form says how many are still
      open
- [ ] A control case in the same test: a thread whose only signal is an unread
      agent reply **does** clear on open — otherwise the assertion above proves
      nothing
- [ ] A thread with an unanswered form **and** an outstanding agent reply shows
      **both** signals at once; neither suppresses the other

## Technical Design

### Files to Create/Modify

- `apps/ui/src/thread/FormBlock.tsx` — from one prompt and `picked: string | null`
  to a list of fields with per-field answer state, the required-gate, and the
  missing-question message
- `apps/ui/src/thread/parseFormBlock.ts` — `ParsedForm` (`none | ok | invalid`),
  `answeredOption`, and `mapFormAnswers`'s three-rung pairing all describe the
  single-answer model and follow the new grammar. `splitFormFence` is the fence
  seam and does **not** change
- `apps/ui/src/thread/Turn.tsx` — renders `before` / block / `after`; the
  `.form-broken` fallback path is where "never a partial set of controls" is
  enforced
- `apps/ui/src/thread/ThreadCard.tsx` — the session-local `submitted` list and
  the answered replay
- `apps/ui/src/thread/thread.css` — `.form-comment`, `.form-opt`, `.form-note`,
  `.form-submit`, `.form-answered`, `.form-broken`, `.form-warning`, plus the new
  per-field structure
- `packages/kit/src/client/createCorpusClient.ts` — `FormAnswerInput` currently
  reads `{ ts, option, note? }` and follows CONTRACT-038's request
- `packages/kit/src/query/useRespondToForm.ts` — the mutation and its
  invalidations (thread, doc, docs, and queue/jobs when an event was enqueued)
- `packages/kit/src/row/reasons.ts` — `REASON_TABLE`'s `form → "awaiting your
  answer"` / `.r-form`; and the "how many are still open" count, which the table
  has no shape for today
- `packages/kit/src/row/Row.tsx` — `needsYouText()` and `reasonChips()`
- Tests: `apps/ui/src/thread/FormBlock.test.tsx`,
  `apps/ui/src/thread/parseFormBlock.test.ts`,
  `apps/ui/src/thread/ThreadCard.test.tsx`,
  `apps/ui/src/thread/turnAnchors.test.tsx`,
  `packages/kit/src/row/reasons.test.ts`, `packages/kit/src/row/Row.test.tsx`,
  and `apps/ui/e2e/thread.spec.ts` (which pins `.form-opt`, `.form-opt.picked`,
  `.price` and `.form-submit` visually)

### Key Implementation Details

**Anchors must keep skipping the fence.** `apps/ui/src/thread/turnAnchors.ts`
uses `splitFormFence` so a text-anchored child thread cannot land inside a form
block. A per-field structure changes what is inside the fence but not that rule,
and breaking it would let someone anchor a comment to a control.

**"Never a partial set of controls" is a real branch, not a sentiment.** The
tempting implementation renders the fields it understood and drops the one it did
not — which shows a person three of four questions as though they were the whole
ask, and their submit then answers a form nobody asked. §11 chose the opposite
posture deliberately: the whole block falls back to the visibly broken code block
it is. That means the parse is all-or-nothing at the block level, and the
fallback path needs a test per failure mode (unparseable YAML, unknown kind),
not one shared test.

**Where the attention count comes from.** `REASON_TABLE` maps a reason code to a
label and a chip class; nothing in it carries a number. "A thread holding more
than one unanswered form says how many are still open" therefore needs a count on
the row, which is a **contract** question if the server has to supply it. Check
what `DocRowSchema.attention` carries before designing around it, and if the count
is not derivable in the UI, file the contract issue rather than approximating it
— a chip that says "2" by guessing is the class of defect this codebase has filed
repeatedly.

**The asymmetry is not implemented in the UI — it is implemented by not breaking
it.** `needs=form` is already form-scoped and already guards on `status = 'open'`,
and read state already lives on a separate mark. So the row survives being read
**by construction**, and the UI's job is (a) to render it and (b) to not
accidentally clear it — for instance by marking the thread seen and invalidating
the Attention query in a way that drops the row locally. The e2e test is the guard
that this stays true, and it is the single most valuable test in this issue.

**Do not touch §8.** The pending-agent indicator is a separate signal with a
separate source. Rendering both at once is a layout question, not a precedence
question — there is no precedence rule to write, and inventing one would suppress
a true signal.

### Edge Cases

- A form submitted in one column while the same thread is open in another — the
  answered state must arrive over SSE, not stay session-local to one card
- A form answered by someone else (or by a second browser) between render and
  submit — the refusal must read as "already answered", not as a validation error
- A very long question, and a `write` answer many lines long — the control grows;
  the answered record stays readable
- A thread with a form in a turn that is **not** the last turn
- A form in a **user** turn — not a form, not answerable, renders as an ordinary
  code block (the server already gates on `author = 'agent'`)
- A form whose only field is optional — submit is available immediately, and an
  empty submit is a real answer
- Reduced-motion and focus-visible behaviour on the new controls, like every
  other interactive surface

## Testing Strategy

Unit and component tests as listed above: per-kind rendering, the required gate
and the named missing question, the answered-record replay, the broken-block
fallback per failure mode, the legacy one-field form, and keyboard reachability
of every control including submit.

E2E, in `apps/ui/e2e/`, against the real app — the attention half is only
meaningful end-to-end:

- an unanswered form produces the Attention row; **open the thread, close it, the
  row is still there**; answer it, the row clears live
- a thread whose only signal is an unread agent reply clears on open (the control)
- a thread with both signals shows both
- a multi-field form: submit blocked until the required fields are answered, the
  missing question named, then submitted with the optional field blank
- the whole flow driven by keyboard alone

## E2E Verification Plan

### Verification Steps

1. Start the real app (`npm run watch`, or the built server serving the built UI)
   against a scratch workspace on a non-default port.
2. Through the real API, post an agent turn carrying a three-field form into a
   thread on a document that appears on the board.
3. In the browser: the Attention column shows the row with "awaiting your
   answer". Open the thread. Close it. **The row is still there.**
4. Answer the form using only the keyboard, leaving the optional field blank.
   Confirm the controls become the record in place and the Attention row clears
   without a reload.
5. Post a second thread whose only signal is an unread agent reply; open it; its
   row clears — the contrast that makes step 3 meaningful.
6. Post a malformed form (a fourth field kind) and confirm it renders as a broken
   code block with no controls at all.
7. Confirm the thread's markdown on disk carries the answer as prose naming every
   field (SERVER-068's half, verified from the UI's side of the exchange).

## E2E Verification Log

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output,
confirmation the feature works. State which model you ran on.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-084]` prefix
