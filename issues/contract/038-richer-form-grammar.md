# [CONTRACT-038] Form grammar: choose-any and write fields, and the richer answer

## Domain

contract

## Status

todo

## Priority

P1 (important)

## Model

opus — the rider settled every question of substance; what is left is naming
keys inside a closed design space. Escalate rather than guess on the two points
named under "Decisions this issue must make", both of which change behaviour
three consumers see.

## Dependencies

- Depends on: SHARED-021 (signed 2026-08-05; amendments applied to SPEC.md)
- Blocks: SERVER-068, UI-084 — and, through SERVER-068, AGENT-017
- Related: SERVER-068 owns the answer turn's **prose**; this issue owns the
  **structure** that travels beside it in the event

## Spec References

- SPEC.md **§6**, "Forms in turns" — the field grammar, the three kinds, required
  by default, identity by question text, answered-once, the answer turn's
  contract, and the "only the person answers" rule
- SPEC.md **§7**, Core event types — the `form.respond` payload, rewritten by
  SHARED-021 Amendment 3 to "**one entry per field of that form**"
- SPEC.md **§9.2** — `POST /api/threads/:id/turns/:ts/form`; `needs=form`
- SPEC.md **§14** — mutations validate before writing; a mutation may succeed and
  still carry warnings

## Summary

§6 now describes a **multi-field** form. The contract still describes the
single-question one it replaced.

`packages/contract/src/schemas/form.ts` pins exactly two fields — `prompt`
(non-empty) and `options` (≥1, each non-empty, all distinct) — with the answer
being one option string, and its own docblock records the omission as
deliberate: _"required/optional markers, field types, validation rules and
multi-select are all absent from §6, and every one of them is a rendering
decision that belongs to the UI issue that needs it."_ **This is that issue**,
and §6 has since answered every one of those questions, so all three copies of
that claim — the schema docblock (`form.ts:52-56`), the route description
(`routes/forms.ts:48-49`), and the server's restatement
(`apps/server/src/threads/forms.ts:127-128`) — are now false and must go with the
change rather than after it.

The grammar is a **short list of fields**, each identified by its own non-empty
question text, distinct within the form. A field is one of exactly **three**
kinds and there are no others: **choose one** (a non-empty list of distinct
non-empty options; the answer names exactly one, verbatim), **choose any** (the
same list; the answer names none, one, or several, each verbatim), and **write**
(no options; free text). A field is **required** unless explicitly marked
optional.

Two constraints shape the payload more than anything else, and both are the point
of the rider rather than decoration:

**The answer must stay readable as prose.** The thread body is the record and it
lands in git. Today the server writes `**Answered:** Yes` — naming the choice and
never the question — which is tolerable for one question and worthless for four.
§6 now requires the answer turn to name, for **every** field the form asked, the
question and what was given for it, blanks included and marked as blank. That
prose is SERVER-068's to write, but it is why **this** payload carries the
question text per entry: the structure the agent consumes travels in the event,
the prose travels in the turn, and neither is derived from the other at read
time. It is also what closes most of the pairing ambiguity this schema's own
docblock records — an answer that names its questions pairs with its form by
content instead of by order.

**Nothing on disk is rewritten.** A bare `prompt` + `options` **is** a form with
one required choose-one field. Every form already committed keeps parsing and
every `**Answered:** …` turn already written keeps meaning what it meant. A rider
that needed a migration of committed conversation text would have been the wrong
rider, and a contract that needs one is the wrong contract.

## Acceptance Criteria

- [ ] `FormSchema` accepts a **list of fields**, each with non-empty question
      text, **distinct within the form** — two fields asking the same thing is a
      validation error, for the same reason duplicate options already are
- [ ] Exactly **three** field kinds are representable: choose one, choose any,
      write. A fourth kind, however spelled, fails to parse
- [ ] A field is **required unless explicitly marked optional**; the default is
      required with no marker present
- [ ] **A bare `prompt` + `options` parses as a form with one required choose-one
      field** — asserted directly, on the exact shape found in the repo's existing
      fixtures, not on a reconstruction of it
- [ ] **No field ids.** A field is named by its question, in the form, in the
      answer request, and in the event payload. Nothing inside a form can drift
      from anything else in it
- [ ] The answer request carries **one entry per field**, each naming the
      question and what was given: the one chosen option, the chosen options, or
      the text written
- [ ] `FormRespondPayloadSchema` carries **one entry per field of that form**,
      with an optional field left blank **present and marked unanswered rather
      than omitted** — "they declined" and "it was never asked" must not be the
      same bytes
- [ ] `validateFormAnswer` rejects: an option a field does not offer; an answer
      to a field the form does not ask; a required field with no answer; and a
      choose-any answer naming an option twice
- [ ] The **fence grammar is untouched** — `FORM_FENCE_INFO_STRING`,
      `findFormFence`, the whole-info-string match (```` ```formula ```` and
      ```` ```form-builder ```` stay ordinary code blocks), the required closing
      fence, first-form-fence-wins
- [ ] A turn still carries **at most one form**; the form is still identified by
      its turn's timestamp; the route path is unchanged
- [ ] The three stale claims about the grammar (schema docblock, route
      description, and the server's restatement) are corrected in the same change
      that makes them stale
- [ ] `openapi.json` and the generated client regenerate cleanly; the pinned
      counts and the `describe("the forms surface")` assertions in
      `openapi.test.ts` are updated to the new shape rather than deleted

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/form.ts` — the whole grammar lives here and
  stays here: `FormSchema`, `FormAnswerRequestSchema`,
  `FormRespondPayloadSchema`, `validateFormAnswer`, `FORM_ANSWER_LABEL`. The
  fence scanner (`FENCE_LINE`, `readFenceLine`, `closesFence`, `findFormFence`,
  `extractFormSource`, `containsFormFence`) is **not** touched
- `packages/contract/src/schemas/form.test.ts` — the grammar's tests, including
  the legacy-shape case
- `packages/contract/src/routes/forms.ts` — `respondToForm`'s body schema and its
  description prose (which currently states the old grammar as a promise)
- `packages/contract/src/openapi.test.ts` — the forms-surface assertions
  (~L2362-2390) and any pinned component counts
- `packages/contract/openapi.json`, `packages/contract/src/client/schema.generated.ts`
  — regenerated, committed, drift-checked in pre-push per §14

Deliberately **not** in this issue: `packages/kit/src/client/createCorpusClient.ts`'s
`FormAnswerInput` and `useRespondToForm` follow the generated types and belong
with UI-084; `apps/server/src/core/form.ts` and `apps/server/src/threads/forms.ts`
belong to SERVER-068.

### Key Implementation Details

**Legacy is a parse, not a branch.** The bare `prompt` + `options` shape should
normalise into the field list at the schema boundary, so that exactly one shape
exists downstream and no consumer ever asks "is this an old form?". A union that
survives into `Form` would put that question into the server, the UI and every
test; a union that collapses at parse time puts it in one place. This is also
what makes the acceptance criterion above testable as a *behaviour* rather than
as a tolerated input.

**The question text is the identity, and that is a deliberate cost.** A long
question travels in the form, in the answer request, and in the event payload.
That repetition is not waste: it is exactly what makes the answer turn readable
on its own, so the frugal alternative — a short per-field key — would buy nothing
and would introduce a second name for the same thing, drifting from the question
the moment either is edited, and putting a token into the answer prose that means
nothing to a human reader. §6 forbids field ids; this schema must not
reintroduce them under another name.

**Distinctness is load-bearing twice.** Options within a choose-one or choose-any
field must be distinct because the answer names an option by its text; questions
within a form must be distinct because the answer names a field by its question.
It is the same rule applied one level up, and the existing `options` refinement
is the model to follow.

**The payload is not the request.** They are close enough to be tempting to
merge and must not be: the request is what a client submits (and may legitimately
omit an optional field), while the payload is the record handed to the agent
(where an omitted optional field must be **present and marked unanswered**). §7
states that asymmetry explicitly — "the agent never has to guess whether a
question went unanswered or unasked" — so the transformation between them has to
live somewhere, and the payload builder is where.

**`FORM_RESPOND_EVENT_TYPE` and the route path do not change.** This is a payload
widening, not a new event and not a new endpoint. Queue events are runtime state
under `.corpus/`, not corpus content, so nothing historical needs re-reading —
which is what makes widening the payload cheap where widening the *turn format*
would not have been.

### Decisions this issue must make (escalate if genuinely ambiguous)

1. **Answering an already-answered form.** Today it is legal, and the server's
   order-based pairing re-pairs afterwards. §6 now says a form is answered once
   and §11 says "changing your mind is an ordinary reply, not a second answer to
   the same question" — so the route should refuse a second answer. That is a
   **behaviour change** to something currently permitted, and it needs a status
   code chosen deliberately (a `409` reads as "already answered"; a `400` reads
   as a malformed request, which it is not).
2. **How a kind is spelled in the YAML.** The agent writes this by hand, in a
   turn, without a schema in front of it, and a person reads it in a diff. Favour
   the spelling that is hardest to get subtly wrong over the one that is shortest.

### Edge Cases

- A choose-any field answered with **nothing selected** — legal only when the
  field is optional; a required choose-any needs at least one option
- A **write** field carrying an `options` list, or a choose-one carrying none —
  both are malformed, not leniently coerced
- A form whose fields are **all optional**: still unanswered until submitted, so
  an empty submit is a legal answer and must serialise as every field marked
  blank
- Whitespace-only question text or option text — non-empty means non-empty after
  trimming, or "  " and "" become two distinct questions
- A form with **one** field that is not choose-one — it is a normal form; only
  the `prompt`+`options` spelling is the legacy shorthand
- Unicode: two questions differing only by normalisation form. Distinctness is
  compared on the string as written; this is worth a test asserting the chosen
  behaviour rather than discovering it later
- A `needs=form` query is untouched by any of this — the projection asks whether
  an unanswered form exists, not what is in it

## Testing Strategy

Unit tests, colocated in `packages/contract/src/schemas/form.test.ts`:

- the legacy shape (`prompt` + `options`, nothing else) parses to one required
  choose-one field, and the resulting `Form` is indistinguishable from the same
  form written the long way
- each of the three kinds parses; a fourth kind fails
- duplicate questions rejected; duplicate options within a field rejected
- required-by-default: a field with no marker is required
- `validateFormAnswer` over each rejection: unoffered option, unknown field,
  missing required field, duplicated selection in a choose-any
- the payload builder: every field present, blanks marked unanswered, the note
  null when absent
- `openapi.test.ts` — the forms surface still pins the path, the whole-info-string
  rule, and the event type, updated to the new body schemas

## E2E Verification Plan

### Verification Steps

1. `corpus init` a scratch workspace on a non-default port; start the real
   server; confirm `openapi.json` regenerates clean (`npm run build` then the
   §14 drift check).
2. Through the real API, append an agent turn carrying a three-field form (choose
   one, choose any, write, one of them optional) and read the thread back —
   `GET /api/threads/:id` returns the turn with the fence intact.
3. Append a turn carrying a **legacy** `prompt` + `options` form and confirm it
   reads back as a one-field form through the same client types.
4. Answer both through `POST /api/threads/:id/turns/:ts/form` with the new body
   and confirm `201`; inspect `.corpus/queue/` for the enqueued `form.respond`
   payload and confirm one entry per field, with the blank optional field present
   and marked.
5. Submit each rejection case and confirm the `400` names the offending field.

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
- [ ] Committed with `[CONTRACT-038]` prefix
