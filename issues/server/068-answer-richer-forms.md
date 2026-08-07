# [SERVER-068] Parse and answer the richer form grammar

## Domain

server

## Status

done

## Priority

P1 (important)

## Model

opus

## Dependencies

- Depends on: CONTRACT-038 (the grammar, the answer request, the `form.respond`
  payload)
- Blocks: AGENT-017 (the skill must not document a grammar the server cannot
  parse)
- Related: UI-084 renders the same grammar; both consume CONTRACT-038 and neither
  consumes the other

## Spec References

- SPEC.md **§6**, "Forms in turns" — the three field kinds, required-by-default,
  identity by question text, "**A form is answered once, as a whole**", "**Only
  the person answers a form**: the agent never answers a form, including its
  own", and the answer turn's contract
- SPEC.md **§7**, Core event types — the `form.respond` payload, one entry per
  field
- SPEC.md **§9.2** — `POST /api/threads/:id/turns/:ts/form`; user-only endpoints
  reject agent actors
- SPEC.md **§8** — a form answer re-triggers the agent like any engaged-thread
  reply. **Not changed by this issue**
- SPEC.md **§4** — every mutation auto-commits with the acting party as author
- SPEC.md **§14** — validation before writing

## Summary

The server is the only writer of the turn format, so it owns both halves of a
form: reading the fence a turn carries, and writing the turn that answers it.
Both halves are still the single-question model.

`apps/server/src/core/form.ts` reads a form by handing the fence's source to
`FormSchema`, and `apps/server/src/threads/forms.ts` writes the answer as
`formAnswerBody` — literally ``**Answered:** ${answer.option}`` plus the optional
note. **That names the choice and never the question.** For one question it is
merely thin; for a four-field form it is worthless, and it is the exact failure
SHARED-021 spent the most text on.

**The answer turn is the record, and the record lands in git.** §6 now requires
it to name, for **every** field the form asked, the question and what was given
for it — the chosen option, the chosen options, or the text written — and to say
explicitly when an optional field was left blank. Three things follow, all
deliberate: a reader months later can reconstruct the exchange from the answer
turn alone; "did they decline, or was that never asked?" is answerable from a
`git log` diff without scrolling up to the fence; and an answer read back off
disk pairs with its form by **content** rather than by order, which closes most
of the pairing gap `core/form.ts`'s own docblock records today. The prose stays
prose — no machine markup, no invented identifiers. The structure the agent
consumes travels in the event, not in the turn.

Two rules §6 now states are not enforced anywhere today, and this issue is where
they land:

- **Only the person answers.** `answerThreadForm` accepts any actor; §8's author
  rule only suppresses the re-trigger. §6 is now explicit that the agent never
  answers a form, including its own — a signal the agent can clear for you is not
  a signal — so this becomes an actor refusal in the same family as user-only
  deletion.
- **A form is answered once.** Answering again is legal today, and the pairing
  re-runs afterwards. §6's "answered once, as a whole" and §11's "changing your
  mind is an ordinary reply, not a second answer to the same question" close it.

## Acceptance Criteria

> Ticked 2026-08-07 by the PR #28 fix pass, walking each criterion against the
> code and the tests rather than against the implementing agent's report. The
> evidence is named per line; anything that could not be pointed at was left
> unticked.

- [x] `readForm` parses the multi-field grammar through CONTRACT-038's schema —
      the fence scanner is still the contract's, still asked once, and is not
      re-implemented here
      — `core/form.ts` calls the contract's `extractFormSource` then
      `FormSchema.safeParse`, and holds no fence logic of its own;
      `core/form.test.ts` parses multi-field fences through it
- [x] A **legacy** `prompt` + `options` form on disk still parses, still renders
      the same one required choose-one field, and its already-committed
      `**Answered:** …` turn is **still recognised as an answer** — nothing on
      disk is rewritten and no historical thread changes meaning
      — `core/form.test.ts` "reads a mixed thread: a legacy form and answer beside
      a multi-field pair"; the contract's `readShortAnswer` and its five
      "the short spelling, still on disk in every older workspace" cases
- [x] The answer turn names **every** field the form asked, with the question and
      what was given for it, and says explicitly when an optional field was left
      blank
      — `threads/forms.test.ts` "names every field the form asked, in order, with
      the blank one said out loud", asserted as **bytes**; confirmed on disk in
      the E2E below (a three-field form with the blank one marked `_(left blank)_`)
- [x] The answer turn carries **no machine markup and no identifiers** — it is
      prose, readable with the form fence out of view
      — `form-answer.test.ts` "carries no fence, no id and no key/value markup"
      (no ```` ``` ````, no `th_…`, no `key:` lines), plus the byte assertion above
- [x] The optional note stays what it is: one remark about the ask **as a whole**,
      beside the answers, not re-modelled as a field
      — `FormAnswerRequestSchema.note` is a sibling of `answers`, not a field;
      `form-answer.test.ts` "omits the note block entirely when no note was given";
      the E2E payload carries `note` beside a three-entry `answers`
- [x] Server-side rejection of: an option a field does not offer; an answer to a
      field the form does not ask; a **required field with no answer**. The UI
      blocking submit is not enforcement
      — `threads/forms.test.ts`, three tests at ~L398/L419/L436, each driving the
      real route and asserting `400` plus the turn count on disk unchanged
- [x] **An agent actor is refused**, on its own form or any other
      — `threads/forms.test.ts` "refuses an agent actor with 403, on its own form"
      and "…on a form it did not write either"
- [x] **A second answer to an already-answered form is refused**, with the status
      code CONTRACT-038 pins
      — `threads/forms.test.ts` "refuses a second answer to the same form with
      409, changing nothing"; reproduced live in the E2E below (`409`)
- [x] The `form.respond` payload carries one entry per field, with blanks present
      and marked unanswered
      — `threads/forms.test.ts` "writes one entry per field of the form, in the
      form's order, blanks marked"; the E2E's event file on disk shows three
      entries with the blank one's `option`/`options`/`text` all `null`
- [x] `needs=form` keeps meaning exactly what it means today — an **open** thread
      holding an agent turn with an unanswered form — and the projection's
      `has_form` / `form_answered` flags are computed correctly for multi-field
      forms **and** for legacy ones
      — `docs/query.test.ts` "needs=form — what counts as an unanswered form";
      `projection/db.test.ts` pins both columns. Live: the thread was listed
      before the answer, gone after it, and **still gone after `corpus db
      rebuild`**, which re-derives the flags from the file alone
- [x] The answer still enqueues `form.respond` and re-triggers per §8, unchanged
      — `threads/forms.test.ts` "enqueues exactly one event, of the pinned type,
      with no `comment.created` beside it", plus the §8 matrix cases
      (reopen-on-resolved, `eventId: null` on a detached thread)
- [x] The answer still auto-commits with the acting party as author (§4)
      — `threads/forms.test.ts` asserts `git log %an <%ae>` is
      `user <user@corpus.local>` and the subject is `formCommitSubject(...)`
- [x] A malformed form is **refused when the agent posts the turn** — two fields
      asking the same question, or a choose-one listing a duplicate option — so
      the agent learns at write time rather than the person discovering it when
      they try to answer. This does **not** contradict §6's broken-block
      rendering: §6 says forms are "written only through the server's thread
      endpoints", so after this the only way a malformed form reaches disk is an
      out-of-band edit, which is exactly the case the broken-block rendering
      (UI-084) covers
      — the refusal itself is real: `threads/forms.test.ts` "a malformed form is
      refused at `POST /api/threads/{id}/turns`" (five cases), and the E2E below
      gets `400` for a multi-line option and for two delimiter-imitating ones.
      **The criterion's closing clause is not true and is not ticked with it**:
      an out-of-band edit is _not_ the only remaining way, because
      `POST /api/threads` writes a thread's first turn without this check
      (SERVER-070, filed) and a non-agent actor's turn is deliberately not
      checked. That gap is why PR #28's fix pass moved the load-bearing guarantee
      into the **grammar** — a form that could not be answered no longer parses,
      so it is inert whichever door it came through — and corrected the three
      places that stated the write-time check as absolute (PR #28 finding 3)


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

- `apps/server/src/core/form.ts` — `readForm`, `answeredOption`,
  `readThreadForms` / `TurnFormState`. This is the one place that knows how a
  form and an answer read off disk, and it stays the one place
- `apps/server/src/core/form.test.ts`
- `apps/server/src/threads/forms.ts` — `formAnswerBody` (the prose),
  `requireForm` (the 404 gate), the `validateFormAnswer` call, the payload
  builder, `answerThreadForm` (the actor refusal and the answered-once refusal)
- `apps/server/src/threads/forms.test.ts`
- `apps/server/src/projection/project-document.ts` — the `has_form` /
  `form_answered` write (~L325-345), which reads whatever `readThreadForms`
  returns
- `apps/server/src/projection/project-document.test.ts`,
  `apps/server/src/projection/db.test.ts` — the pinned per-turn flags
- `apps/server/src/docs/query.test.ts` — the `needs=form` cases, including the
  multi-form thread

**Not** touched: `apps/server/src/docs/needs.ts`'s `UNANSWERED_FORM_SQL` and the
`turns_unanswered_form` partial index. The predicate asks whether an unanswered
form exists, not what is inside it, and it was deliberately made **form-scoped
rather than thread-scoped** (asking "is the last turn a form?" hid the other
forms the moment one was answered). Both conjuncts on the flags are load-bearing
for the partial index, and `apps/server/src/docs/performance.test.ts` asserts the
query plan — so changing the shape of that SQL is a regression, not a cleanup.

### Key Implementation Details

**The hard question is how an answer is recognised off disk, and it must be
answered deliberately.** Today `answeredOption` tests whether the turn's first
line starts with `**Answered:**`, and `readThreadForms` attributes it to the
earliest still-open form offering that option — an order rule whose known-wrong
case is documented in the file. The richer answer changes what is available:
because the prose now names its questions, an answer can be paired with its form
**by content**. Two consequences:

1. **The recogniser must accept both shapes.** A legacy `**Answered:** Yes` turn
   is still an answer, and must still flip `form_answered` for the form it
   answers, or every thread already on disk silently returns to Attention.
2. **The residual ambiguity is accepted, not closed.** With answers naming their
   questions, the failure narrows to two open forms in one thread asking a
   *literally identical* question — and multi-field forms make multiple open
   forms rarer, because the reason to open a second one is now a field. §6
   deliberately has no form id in the prose, so closing it completely is not
   available. Record the residual in the docblock as the current one is recorded;
   do not invent an identifier to remove it.

**The prose format is the deliverable, not an implementation detail.** It is
what a person reads in the app and in a diff. Write it so that the answer stands
alone: the question, then what was given, per field, in the order the form asked.
Marking a blank must be unmistakable in a diff — "they declined" and "it was
never asked" being the same bytes is the exact ambiguity the rider exists to
remove. Resist adding a machine-readable prefix "just in case": the structure has
a channel already (the event), and a token in the prose that means nothing to a
human reader is what §6 forbids.

**One turn, one form, unchanged.** A form is identified by its turn's timestamp;
`requireForm`'s three gates (the turn exists, its author is `agent`, and it
carries a readable form) stay. The route path does not change.

**The actor refusal is a refusal, not a silent no-op.** §9.2's precedent is
deletion: a user-only endpoint *rejects* an agent actor. Follow it exactly rather
than inventing a third posture, and make the reason legible in the response — an
agent that gets an opaque error will retry.

**Mind the write path's other half.** The answer is a turn append like any other,
so it validates before writing (§14) and auto-commits with the acting party as
author (§4). If the answer prose can carry user-supplied text — a `write` field's
answer, or the note — then it can carry a backtick run or a line that looks like a
turn heading. §6's `## <author> · <ts>` delimiters and SERVER-066's
`unterminated-fence` rule are both live here: **an answer turn must not be able
to fabricate a turn heading or leave a fence open.** This is the single most
likely way this issue introduces a data-loss bug, and it deserves a test rather
than a review comment.

### Edge Cases

- A **choose-any** answered with nothing selected — legal only when the field is
  optional; the prose says so in words rather than omitting the field
- A form whose fields are **all optional**, submitted empty — a legal answer; the
  turn names every field, all blank, and `form_answered` flips
- A `write` answer containing newlines, a fenced block, or a `## user · …` line —
  see the write-path note above
- A `write` answer that is only whitespace — is that blank or an answer? Decide,
  and pin it; the required-field check depends on the answer
- Two forms open in one thread, answered out of order — each pairs to its own
  form by content
- A turn that both answers a form **and** carries a new one — already a tested
  case in `core/form.test.ts`; it must keep working
- A thread **resolved** while a form is unanswered — the row clears because the
  predicate guards on `status = 'open'`; nothing here changes that, and the agent
  still never resolves a thread that owes an answer (SPEC §11)
- A form fence whose YAML does not parse, or naming a fourth kind — `readForm`
  returns its `NoFormReason`; the turn is not answerable and does not surface as
  a form. Never a partial read

## Testing Strategy

Unit tests, colocated:

- `core/form.test.ts` — the multi-field read; the legacy read; both answer shapes
  recognised; `readThreadForms` over a thread mixing legacy and new forms;
  content pairing preferred over order; the residual identical-question case
  producing the documented behaviour rather than a crash
- `threads/forms.test.ts` — the answer prose asserted **verbatim** for a
  three-field form with one blank optional field (this is the record; assert the
  bytes, not a substring); the note beside it; each rejection (unoffered option,
  unknown field, missing required); the agent-actor refusal; the second-answer
  refusal; the `form.respond` payload's entries; the §8 re-trigger matrix
  unchanged; auto-commit author
- `threads/forms.test.ts` — the injection cases: a `write` answer containing a
  turn heading and one containing an unterminated fence, asserting the thread
  still reads back with the expected number of turns
- `projection/project-document.test.ts` — `has_form` / `form_answered` per turn
  for multi-field and legacy forms
- `docs/query.test.ts` — `needs=form` before and after answering a multi-field
  form; a multi-form thread; a resolved thread

## E2E Verification Plan

### Verification Steps

1. `corpus init` a scratch workspace on a non-default port (never 8765); start
   the real server with `corpus server start`.
2. Create a document, comment on it to open a thread, and append an **agent** turn
   carrying a three-field form (choose one, choose any, write; the write field
   optional).
3. `GET /api/docs?needs=form` — the thread is listed.
4. `GET /api/threads/:id` — the turn reads back with its fence intact.
5. Answer through `POST /api/threads/:id/turns/:ts/form` with the optional field
   blank. Confirm `201`, then **read the raw markdown off disk** and confirm the
   answer turn names all three questions with the blank one marked — this is the
   acceptance criterion and it is only true on disk.
6. `git log -p` the workspace and confirm the answer commit's diff reads as the
   exchange, authored by `user`.
7. `GET /api/docs?needs=form` — the row is gone. Resolve nothing; the clearing
   must come from the answer.
8. Re-submit the same answer — refused. Submit as `x-corpus-author: agent` —
   refused.
9. Write a **legacy** `prompt`+`options` form into a turn, answer it, and confirm
   the old-shape thread still behaves; then confirm a pre-existing
   `**Answered:** …` turn (written before the change) still reads as answered
   after `corpus db rebuild`.
10. `corpus doc check` and `corpus db doctor` clean; stop the server and confirm
    the port is free.

## E2E Verification Log

### Post-Implementation Verification

**Model: opus.** Real workspace at `/tmp/s068ws`, `corpus init` on port **8766**
(never 8765), real server started with `corpus server start` (pid 77513), all
traffic over `curl` against `127.0.0.1:8766`.

1. **Init + start.** `corpus init /tmp/s068ws` → "port 8766, token in
   .corpus/config.json"; `corpus server start` → "corpus 0.4.0 listening on
   http://127.0.0.1:8766 (pid 77513)".
2. **Document + thread.** `POST /api/docs` → `doc_akwrj4m4`;
   `POST /api/threads` (`requestsAgent: true`) → `th_av2kpatc`.
3. **Three-field form.** `POST /api/threads/th_av2kpatc/turns` as
   `x-corpus-author: agent`, body carrying a `fields:` fence with `choose one`
   (rate), `choose any` (risks) and an **optional** `write` (flag) → `201`, turn
   `2026-08-07T15:26:23Z`.
4. **`GET /api/docs?needs=form`** → `[('th_av2kpatc', ['unread-reply', 'form'])]`.
5. **`GET /api/threads/th_av2kpatc`** → the fence reads back byte-for-byte,
   `fields:` list intact.
6. **Answer with the optional field blank.** `POST …/turns/2026-08-07T15%3A26%3A23Z/form`
   with `answers` for two fields and a note → `201`,
   `eventId evt_2vudplrw4es6`, `warnings []`. **Raw markdown on disk**
   (`data/threads/th_av2kpatc.md`), which is the acceptance criterion:

   ```
   ## user · 2026-08-07T15:26:53Z
   **Answered:**

   **Which rate should the model assume?**

   6.1% fixed

   **Which risks apply?**

   - Currency
   - Rate rise

   **Anything else to flag?**

   _(left blank)_

   **Note:**

   the currency leg is the one I worry about
   ```

   All three questions named, in the form's order, the blank one said out loud,
   the note beside the answers rather than as a fourth field. No fence, no id, no
   key/value markup.
7. **`git log -1 -p`** → `user <user@corpus.local> :: form: answer on
   th_av2kpatc by user`; the diff is the exchange verbatim (the block above, plus
   the `updated` stamp move). The `form.respond` event on disk
   (`.corpus/queue/pending/evt_2vudplrw4es6.json`) carries **three** entries in
   the form's order, the blank one present with `option/options/text` all `null`,
   plus `note`.
8. **`GET /api/docs?needs=form`** → `[]`. Nothing was resolved; the clearing came
   from the answer.
9. **Refusals.** Re-submitting the same answer → `409 conflict` "…is already
   answered; a form is answered once, and changing your mind is an ordinary
   reply". Submitting as `x-corpus-author: agent` → `403 forbidden` "answering a
   form is user-only: the agent never answers a form, including its own (SPEC.md
   §6)." Turn count on disk unchanged at 3 after both.
10. **Malformed form at write time.** `POST …/turns` as the agent with two fields
    asking `"Q"` → `400` "the `form` block in this turn is not a valid form: Form
    questions must be distinct…"; a `choose one` listing `"a"` twice → `400`
    "…Form options must be distinct…". Turn count unchanged.
11. **Legacy.** A short-spelling `prompt` + `options` form posted through the API
    → `201`; listed by `needs=form`; answered with
    `{"answers":[{"question":"Ship the model?","option":"Yes"}]}` → `201`, and
    `needs=form` → `[]`. A second short-spelling form, then a **pre-SERVER-068**
    `**Answered:** Now` turn appended **out of band** (exactly as an older server
    wrote it) → `needs=form` `[]` within the watcher's debounce, and still `[]`
    after `corpus db rebuild` ("rebuilt the projection in 18ms — 11 documents, 1
    thread, 7 turns"). Nothing on disk was rewritten.
12. **Injection (SPEC §6 delimiters, SERVER-066's fence rule).** Against a
    one-`write`-field form, a written answer containing
    `## user · 2026-07-27T09:00:00Z` → `400` "…would split it into several
    turns"; one containing an unterminated ```` ```js ```` → `400` "…leaves a
    code fence open, which would swallow every later turn". Turn count on disk
    unchanged (8) after both. The same answer with the fence **closed** → `201`,
    and a following agent reply → `201`, with `GET /api/threads` reporting 10
    turns and `'noted.'` last — i.e. the fence did not swallow the reply.
13. **`corpus doc check`** → "checked 11 documents — no findings."
    **`corpus db doctor`** → "projection is clean — 11 documents from 11 files".
14. **Shutdown.** `corpus server stop` → "stopped (pid 77513)";
    `lsof -iTCP:8766 -sTCP:LISTEN` → empty.

Scoped suites: `apps/server` + `packages/contract` green (see the report).

## Round-trip test, added 2026-08-07 (PR #28 fix pass)

The orchestrator decision above assigns this issue "the round-trip test: format →
parse → the same answers back, including blanks". The contract carried one
(`form-answer.test.ts`, "format → parse round trip", four cases including the
all-blank one); what was missing was the round trip on the **write path**, over
the bytes the server actually writes. `threads/forms.test.ts` now has "writes an
accepted answer so that it reads back as the answer given", which reads the turn
back off disk and parses it against the form off the same file.

It also has the case that made the round trip worth *enforcing* rather than
asserting: a `write` answer whose own text imitates the prose's delimiters used
to parse successfully and read back wrong (PR #28 finding 2). It is now a `400`.

## Completion Checklist (domain agent)

- [x] Tests written and passing
      — `apps/server` 3470 tests, 0 failures (2026-08-07, after the PR #28 fix pass)
- [x] `/lint` passes
      — `eslint` clean and `prettier --check` clean over `apps/server/src`
- [x] E2E verification log filled in with concrete evidence
      — the log below, plus the PR #28 fix pass's own run on port 8791
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified
      — re-walked line by line 2026-08-07 by a fresh agent; evidence named above

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-068]` prefix
