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

- [x] A form renders **one control per field**, matched to what the field asks:
      choose one, choose any, write
- [x] **Required fields are marked**; submit is unavailable until every required
      field has an answer, and the form **names the question still missing**
- [x] A **choose-any** field accepts none, one, or several options; a **write**
      field accepts free text and grows to fit
- [x] One submit for the **whole form**, naming its key like every other composer
      control, and one place for the optional **note about the ask as a whole**
- [x] **Everything is keyboard-reachable**, submit included — asserted, not
      assumed
- [x] **Once submitted the form stops being a question**: the controls become the
      recorded answer, shown in place, each question beside what was given for it,
      so the turn afterwards reads as the exchange it was. There is no way to
      submit a second answer
- [x] A **legacy** `prompt` + `options` form renders as one required choose-one
      control and answers exactly as it does today
- [x] A form the app cannot read — YAML that does not parse, or a field outside
      §6's three kinds — renders as the **visibly broken code block** it is,
      **never as a partial set of controls**, and is not answerable

### The attention asymmetry

- [x] A thread with an unanswered form shows an Attention row reading "awaiting
      your answer"
- [x] **Opening the thread and closing it again leaves the row in place** — the
      test that distinguishes this feature from every other Attention reason
- [ ] Answering clears the row **live** over SSE; resolving the thread also clears
      it
- [ ] A thread holding **more than one** unanswered form says how many are still
      open
- [x] A control case in the same test: a thread whose only signal is an unread
      agent reply **does** clear on open — otherwise the assertion above proves
      nothing
- [ ] A thread with an unanswered form **and** an outstanding agent reply shows
      **both** signals at once; neither suppresses the other

#### The three left unticked, and exactly why

- **"Answering clears the row live over SSE."** The *behaviour* is verified —
  `forms.spec.ts` answers the form and the Attention row is gone on the way back
  to the column, with no reload — and resolving clears it in the same file. What
  is **not** verified is the transport: the browser stub pushes no `invalidate`
  events at all (`stubCorpus.ts` says so in its own docblock), so what drives the
  refetch in that test is the mutation's own query invalidation, not SSE. The two
  paths land on the same `DOCS_KEY`, but I can point at one and not the other, so
  this stays unticked.
- **"A thread holding more than one unanswered form says how many are still
  open."** Not implemented. `DocRow.attention` is a list of reason *codes* and
  carries no number, and a row carries no turns, so counting in the UI would mean
  one `GET /api/threads/{id}` per row per render. Filed as
  `issues/contract/040-open-form-count-on-the-row.md` rather than approximated,
  which is what this issue's own Technical Design asks for.
- **"An unanswered form and an outstanding agent reply show both signals at
  once."** Half done. Both *Attention reasons* coexisting is tested end to end
  (`unread-reply` + `form` on one row, and reading the thread takes the first and
  leaves the second) and was also observed on the real server
  (`['unread-reply', 'form']`). What is untested is §8's **pending-agent
  indicator** beside the form's "awaiting your answer": the stub answers
  `GET /api/jobs` with a flat `{jobs: []}`, so `useOutstandingAgentJob` can never
  find one there. §8 was not touched — the indicator is rendered by `ThreadCard`
  off the queue and knows nothing about forms, so nothing can suppress it — but
  "not touched" is an argument, not evidence, so this stays unticked.


## Orchestrator decision 2026-08-07 — the answer prose is a contract artefact

CONTRACT-038 surfaced this and did not decide it, correctly, since the issue
assigns the prose to SERVER-068. Deciding it here so both sides build to one
answer rather than each inventing it.

**The answer turn's text is the only durable record of what was answered.** The
`form.respond` payload lives in `.corpus/` — runtime state, reaped with its event
— while §11 requires an answered form to render "each question beside what was
given for it" after a reload. So the prose in the turn *is* the data.

**Therefore the format and its parser are a pair, and the pair lives in
`packages/contract`.** Not in the server with the UI re-parsing loosely: those two
workspaces cannot import each other, so a second spelling is a guaranteed drift,
and the current `parseFormBlock.ts` — which reads the option by slicing the label
line — is exactly what that drift looks like when the shape grows.

This is the reasoning that already put `FORM_ANSWER_LABEL` in the contract. The
pair extends it rather than departing from it.

- **SERVER-068** writes the answer turn using the contract's formatter, and owns
  the round-trip test: format → parse → the same answers back, including blanks.
- **UI-084** reads with the contract's parser and must not hand-roll a second
  reader. `parseFormBlock.ts`'s label-slicing is to be replaced, not extended.
- Whoever lands first adds the pair to `packages/contract`; the other consumes it.

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

Run on **opus** (`claude-opus-5[1m]`), 2026-08-07.

#### Half 1 — the real application, real server, real workspace, real disk

A scratch workspace on a non-default port, so nothing collided with the server a
sibling agent was holding on 8765:

```
npm run dev -w apps/cli -- init /tmp/ui084-ws          # port rewritten to 8899
npm run dev -w apps/cli -- server start --workspace /tmp/ui084-ws
  → corpus 0.4.0 listening on http://127.0.0.1:8899 (pid 8427)
```

Through the real API: a note, a thread on it, then an **agent** turn
(`x-corpus-author: agent`) carrying a three-field form — one `choose one`, one
`choose any`, one optional `write`.

**The attention asymmetry, on the real projection.** Before any read:

```
GET /api/docs?needs=form → [('th_jx4bav2z', ['unread-reply', 'form'])]
```

Both signals at once, neither suppressing the other. Then the read — `POST
/api/threads/th_jx4bav2z/seen` — and the same query again:

```
GET /api/docs?needs=me   → [('th_jx4bav2z', ['form'])]
```

**The unread reason cleared by being read; the form reason did not.** That is the
asymmetry, from the server's own projection.

**The answer, with exactly the body the UI's client builds** — one entry per
field *answered*, the optional `write` field carrying **no entry at all**, note
trimmed:

```json
{"answers":[{"question":"Which quote should I file?","option":"Lemonade — $1,840/yr"},
            {"question":"Which riders do you want?","options":["Water backup"]}],
 "note":"cheapest one"}
```

`201`. The answer turn the server wrote, verbatim, and the same bytes now in
`data/threads/th_jx4bav2z.md` under `## user · 2026-08-07T15:32:28Z`:

```markdown
**Answered:**

**Which quote should I file?**

Lemonade — $1,840/yr

**Which riders do you want?**

- Water backup

**Anything I should know?**

_(left blank)_

**Note:**

cheapest one
```

Every field the form asked is named, the blank one said out loud. `git log`:
`fe5e07a form: answer on th_jx4bav2z by user`. Attention afterwards:
`GET /api/docs?needs=me → []` — answering, and only answering, cleared it.
Submitting the identical body a second time: **`409 conflict`**, not a validation
error.

**The loop closed.** The thread file from disk was fed through `parseThreadTurns`
and this issue's own `mapFormAnswers`, and the reader recovered the record
exactly: `option: "Lemonade — $1,840/yr"`, `options: ["Water backup"]`,
`text: null` for the blank field, `note: "cheapest one"` — keyed by the form
turn's `ts`. The server writes with the contract's `formatFormAnswerBody`; the UI
reads with the same module's `parseFormAnswerBody`; the bytes on disk are the
only thing between them.

Server stopped (`stopped (pid 8427)`); 8899 and 5273 confirmed free.

#### Half 2 — the real browser

`CORPUS_UI_PORT=5273 npx playwright test --config apps/ui/playwright.config.ts` —
**310 passed**, plus the new `apps/ui/e2e/forms.spec.ts` (6/6). The stub now
*derives* `attention` from each thread's own turns rather than taking a seeded
flag, so no spec can clear a row by fiat, and it answers `POST
…/turns/{ts}/form` by writing the real answer turn into the thread's body.

- **"survives being read, while an unread reply's row does not"** — the assertion
  this feature exists for. Two rows in Attention; opening the reply-only thread
  and going back removes its row; opening the form thread and going back leaves
  its row in place, still reading "awaiting your answer".
- **"clears when the form is answered, from the keyboard alone"** — submit
  disabled with `.form-missing` naming both required questions; radio focused and
  `Space`; one question drops off the message; checkbox focused and `Space`; the
  message goes and submit enables; `ControlOrMeta+Enter` submits. The request
  body carried two entries and no entry for the blank optional field. The
  controls became the record in place (three rows: the option, the rider,
  "left blank"), no `.form-submit` left, and the Attention row cleared.
- **"survives a reload as the record it is"**, **"shows both signals at once"**,
  **"clears when the thread is resolved"**, **"renders a form it cannot read as
  the broken block it is"** — all pass.

**Two pre-existing failures, environmental and not mine**: `console.spec.ts`'s
two health-notice specs assert the strip reads "server unreachable", which
requires `127.0.0.1:8765` to be **unbound**. A sibling agent's real `corpus`
server (pid 29851) was listening there for the duration
(`curl …:8765/api/health → 200`). They pass once that port is free.

#### Unit

`VITEST_MAX_THREADS=4 npx vitest run apps/ui packages/kit` → **2923 passed**.
`npx eslint` and `npx prettier --check` clean; `npm run typecheck` clean.

#### One defect found and fixed during self-review

The `write` field rendered as a **borderless strip**. `GrowingTextarea` wraps its
field in `.composer-grow`, and `thread.css`'s `.composer-grow > textarea` (0-1-1)
out-specifies a bare `.form-write` class on the field (0-1-0) — so the border,
padding and background I had put on the textarea never applied. It is also the
wrong place for them regardless: the grow trick measures by stacking a hidden
copy of the value in the same grid cell, so padding on the field alone makes the
mirror measure a different string and the row grow to the wrong height. Fixed the
way the composer already does it — the box is the wrapper, the field stays
transparent — and guarded in `forms.spec.ts` with a computed-style assertion
(`.form-write` has a 1px border), which is the assertion that was missing when
the bug shipped into my own first pass.

#### `403` — reachable in the contract, unreachable from this UI

`POST …/turns/{ts}/form` does carry a `403`: it rejects a request naming itself
`x-corpus-author: agent`, because only the person answers a form (§6). The UI
**never sends that header** on any route — it is served same-origin and the
contract defaults the actor to `user` — so this surface cannot produce a `403`,
and I deliberately did not write a message for it: a branch no test can honestly
exercise is a claim about behaviour nobody has. If one ever arrived it renders
through the generic `Answer failed — <message>` path. The `409` is the refusal
§6 and §11 actually name for this UI, and it has its own wording and its own
test.

#### Left open

The last Attention criterion — "a thread holding **more than one** unanswered
form says how many are still open" — is **not** implemented. `DocRow.attention`
is a list of reason codes and carries no number, and a row carries no turns, so
counting in the UI would mean one `GET /api/threads/{id}` per row. Filed as
**`issues/contract/040-open-form-count-on-the-row.md`** rather than approximated.

### PR #28 review — findings 6 and 7

Run on **opus** (`claude-opus-5[1m]`), 2026-08-07. Neither finding closes any of
the three criteria left unticked above; both are defects in criteria already
ticked, so nothing here changes a checkbox.

**Finding 6 — every structural failure said "Invalid input".** `FormSchema` is a
union, so `issues[0].message` is the union's own message for essentially every
malformed fence, and both the board and the server's `400`/`404` were showing it.
The explanation the server had built for exactly this (`describeIssue`, in
`apps/server/src/core/form.ts`) moved to the contract as
**`describeFormFailure`**, beside the union it explains — the one place both
`apps/server` and `apps/ui` can import, since neither can import the other. The
server's private copy is gone rather than duplicated. It also now prints the
path for a failure Zod reports outside the union wrapper, which is where a blank
question used to render as a bare "must not be blank".

Real browser, `forms.spec.ts` on the real Vite dev server (port 5273 — 5173 and
8765 were held by the user), the same broken fence the spec already carried:

```
This form could not be read — fields.1.kind: Invalid discriminator value.
Expected 'choose one' | 'choose any' | 'write'
```

The same bytes through the **real running server** (`corpus init` +
`server start` on a scratch workspace, port 8766), `POST /api/threads/{id}/turns`
as `x-corpus-author: agent`:

```
400 the `form` block in this turn is not a valid form: fields.1.kind: Invalid
    discriminator value. Expected 'choose one' | 'choose any' | 'write'
```

— the same sentence on both surfaces, which is the point of moving it rather
than copying it.

**Finding 7 — an optional `choose one` could not be returned to blank.** A radio
group cannot un-click itself, so a mis-click on an optional single-select was
unrecoverable and silently changed what the agent is told (§6 answers a form once,
as a whole). The field now carries a **"Leave blank" member of its own radio
group**, dashed and quietly labelled so it does not read as an offered answer; it
is what the group shows as chosen while the field is untouched, so blank is
visibly a legitimate state rather than an absence. Verified in the real browser:
click an option, then `ArrowDown` twice from the first radio — arrow keys reach
it because it is a member of the group, not a button beside it — and the picked
row is the blank one again.

The rule that makes "unanswered" mean something is intact: picking it sets the
draft's `option` back to `null`, `formDraft`'s single spelling of blank, so the
submit carries `{"answers": []}`. On the real server that is a `201`, while the
answer a naive clear would have sent is refused:

```
POST …/form {"answers": []}                             → 201
POST …/form {"answers":[{"question":…,"option":""}]}    → 400 json.answers.0.option: must not be blank
```

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-084]` prefix
