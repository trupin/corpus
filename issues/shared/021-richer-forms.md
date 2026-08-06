# [SHARED-021] The agent surveys the person with richer forms

## Domain

shared (orchestrator-owned)

## Status

done — signed by the user 2026-08-05; amendments applied to SPEC.md.

## Priority

P1

## Model

fable

## Dependencies

- Depends on: nothing signed.
- Blocks: a contract issue (the field grammar + the answer payload + the answer
  prose), a server issue (validation, the answer turn's body, the `needs=form`
  projection which is already form-scoped), a UI issue (the controls and the
  answered record), and an agent-runtime issue (the ask-with-a-form rule). None
  filed.
- **Ordering hazard — three unsigned riders now append after the same §11 Thread
  view sentence.** SHARED-016 Amendment 1, SHARED-020, and this rider's
  Amendment 7 all anchor on the newlines sentence at the end of §11's **Thread
  view** bullet. Whoever applies last must **re-read the bullet** and append after
  whatever is then last; pattern-matching on the quoted anchor will interleave
  three riders' text.
- **Cross-rider interaction with SHARED-020 and SHARED-019** — see "Cross-rider
  hazards", below. Neither is signed; neither's text is restated here.

## Spec References

- §6 Threads and anchors — **owns** the form fence, the form's identity, the
  answer turn, and the Attention promise; the paragraph this rider mostly edits
- §7 Event queue and agent loop — the `form.respond` payload; the **Comment
  skill**; **Agent stewardship**; **Read state** ("a thread is **unread** when its
  last turn is newer than your last-seen mark")
- §8 Agent participation semantics — engaged threads re-trigger on every later
  turn; the time-aware pending indicator. **Not edited by this rider**
- §9.2 HTTP API — `needs=form`, and `needs=me` as the union of the Attention
  reasons
- §11 UI — **Attention**, **Thread view**, the composer key contract, "§11 adds no
  exclusive-pointer capability"

---

## The user, verbatim (2026-08-05)

> "The agent needs to have tools at its disposal to survey information from me.
> Similarly to how it does in Claude Code itself, it should be able to do so
> similarly in threads, using forms, check boxes, inputs etc... I think that
> ultimately, that would reduce the amount of friction in conversations and avoid
> so much noise where the agent has to figure out from context what I'm answering
> to, etc... It would also make it easy to detect whenever a thread needs my
> attention."

**Three motivations, named, because the draft has to serve all three and they pull
in different directions.**

1. **Less friction.** Answering should be a click, not a paragraph. That argues
   for controls, and for asking everything at once instead of one question per
   turn.
2. **The agent should not have to infer what an answer refers to.** That argues
   for the answer being *structured* and for it *naming what it answers* — which
   is the motivation today's forms serve least, because today's answer names the
   chosen option and never names the question.
3. **A reliable "this thread needs you" signal.** That argues for something that
   survives being read. It is the motivation most likely to be under-served by a
   rider that only grows the grammar, and the one this draft spends the most text
   on — see "The third motivation is the one with a real gap", below.

---

## What already exists — this rider does not re-specify any of it

**Forms already exist, and they were left deliberately minimal.** §6 already
defines a form as a fenced ```` ```form ```` block in an agent turn, rendered as
live controls, answered into a structured turn, enqueued as an event, and surfaced
in Attention. This rider extends a mechanism whose authors wrote down that they
were leaving the door open — it does not invent one. Verified 2026-08-05:

- **The fence grammar is settled and is not touched here.** Column-0 backtick
  fences only, closing fence required, info string matched whole (```` ```formula ````
  and ```` ```form-builder ```` are ordinary code blocks), outer fences shadow
  inner ones, and **the first form fence in the body wins**. Nothing in this rider
  changes a single one of those rules.
- **Exactly two fields are pinned today**: `prompt` (required, non-empty) and
  `options` (required, at least one, each non-empty, all distinct). The contract's
  own docblock states the omission as deliberate: _"required/optional markers,
  field types, validation rules and multi-select are all absent from §6, and every
  one of them is a rendering decision that belongs to the UI issue that needs
  it."_ **This is that issue.**
- **Cardinality today is single-select**, and the answer **names one option
  verbatim** — which is exactly why options must be distinct. A choice the form
  does not offer is rejected as a validation error naming the offending field.
- **Identity is the carrying turn's timestamp.** A form has no id of its own, so a
  turn carries **at most one form** and the answer route addresses the form
  through its turn. The contract's rationale for this is explicit: "no second
  identifier exists to drift from the first."
- **Only agent turns carry forms.** Both the answer route and the projection's
  `needs=form` detector require `author = 'agent'`, so a user turn quoting a form
  fence is not answerable and does not surface.
- **The answer is a turn, and its prose is deliberately plain.** The server writes
  `**Answered:** <option>`, optionally followed by the note; the structure travels
  in the `form.respond` event, whose payload is `{threadId, formTs, option,
  note|null}` (§7). **`option` is singular** — any richer answer changes that
  payload.
- **The answer does not name the form it answers** — a gap the contract records on
  purpose. A thread read back off disk pairs answers to forms by an order rule
  (earliest still-open form offering that option), so a thread holding two open
  forms that share an option string can in principle mis-attribute one. The
  contract says to revisit it "via a SPEC.md §6 revision, not a silent format
  change".
- **`needs=form` is already form-scoped, not thread-scoped.** The projection asks
  "does this open thread hold an agent turn with an unanswered form?", per form —
  it was deliberately changed away from "is the last turn a form?" because
  answering one form moved `last_author` and silently hid the others. So a thread
  holding several independently answerable forms is already a supported shape, and
  **resolving the thread already clears the row** (the predicate guards on
  `status = 'open'`).
- **The attention promise is already written.** §6: "Threads with an unanswered
  form surface in Attention as 'awaiting your answer'." §11: Attention is
  `needs=me` — "unread agent replies, unanswered forms, due/overdue documents,
  stale-for-review, failed jobs — each row carrying a reason chip", and "handling
  the reason (reading the reply, answering the form, …) clears the row live via
  SSE". §9.2: `needs=me` is the union of the individually addressable reasons.

---

## What this rider is for

### Motivations 1 and 2 — the grammar is too thin to be the natural way to ask

A form that can ask exactly one question, offering a closed list, with the answer
being one word from that list, is weaker than just writing the question in prose.
So the agent writes prose. The person answers in prose. And then motivation 2's
problem is real every single time: the agent reads a paragraph and has to work out
which sentence answered which question — and when it asked three things, whether
the two sentences it got covered all three.

Widening the grammar to what a real ask looks like — a handful of questions, some
of them multiple-choice, some of them free text, some of them optional, answered
in one act — makes the form the *easier* thing for the agent to reach for, which
is what actually fixes both motivations. The friction fix is that answering is a
click. The inference fix is that the answer arrives keyed to the questions.

### The third motivation is the one with a real gap

**Partly already promised, and the promise is worded correctly** — §6 and §11 both
say an unanswered form surfaces in Attention, and §9.2 makes it individually
addressable as `needs=form`. So this rider does not need to invent an attention
signal. **But the gap is elsewhere, and it is bigger than the grammar**, in two
places:

**(a) The agent has no reason to use forms, so the signal is rarely produced.**
Nothing in SPEC tells the agent to ask with a form. Richer forms make it
attractive; a stated rule makes it reliable. That rule is Amendment 5, and it is
the single most load-bearing piece of this rider for motivation 3 — without it,
everything else is a nicer control set on a mechanism nobody reaches for.

**(b) The competing signal expires on being read, and the form's does not.** §7's
Read state: a thread is unread when its last turn is newer than your last-seen
mark, and opening the thread marks it seen. So a question the agent asks **in
prose** produces an Attention row that vanishes the instant you look at it,
whether or not you answered — the most common way to lose a question in this
system is to read it. An unanswered form's row is the only Attention reason that
does not clear by attending to it; it clears by *acting* on it (or by resolving the
thread, which the projection already enforces). **That asymmetry is the whole
answer to motivation 3**, it is currently implicit in a SQL predicate rather than
stated as behaviour, and Amendments 2 and 6 write it down so an evaluator can test
it.

**The counter-signal already points the other way and stays untouched.** §8's
time-aware pending indicator and §11's per-row pending-agent indicator say the
thread is waiting on the *agent*. The two facts are independent and can both be
true: answer nothing, reply in prose to ask something else, and the thread now owes
you an answer *and* owes the agent a reply. The draft says both are shown rather
than inventing a precedence rule — a row that hid one of them would be lying about
the other, and the point of this rider is a signal you can trust.

---

## The decisions this draft makes, and why

**Three kinds of field, and no more.** Choose one (today's form), choose any
(the user's checkboxes), and write (the user's inputs). That is the closed set.
Each has a distinct job that the other two cannot do: *choose one* is a decision,
*choose any* is a selection, *write* is a fact the agent could not have enumerated.
Nothing else clears that bar. Deliberately excluded, and named so the chain does
not drift back to them: dates, numbers, ranges, sliders, file pickers, defaults,
placeholders, per-field validation rules, regexes, min/max, conditional or
branching fields, sections, and any distinction between a radio group and a
dropdown (that is a rendering choice, not a grammar one). **This is not a
validation engine and not a form builder.** The grammar is YAML inside a markdown
fence, in a conversation that lands in git, and every field kind is something a
person has to read in a diff and an agent has to write correctly on the first try
without a schema in front of it.

**One form with several fields, not several forms per turn.** The user's reference
point — Claude Code asking a handful of questions in one ask — maps onto one form
with several fields, and that is also what motivation 1 wants: one submit, one
answer, one round trip. Several forms in one turn would buy nothing and would cost
the identity rule.

**The identity consequence, stated: a field is named by its question text.** A form
is identified by its turn's timestamp; a field inside it needs something of its own
so the answer can say which question it answers. The draft does **not** invent
field ids. It makes the question text the identity — required, non-empty, and
**distinct within the form** — which is precisely the rule `options` already
follows, for precisely the same reason ("an answer names an option by its text").
The payoff is that the contract's own principle holds unchanged: no second
identifier exists to drift from the first, and a person reading the YAML sees no
keys that mean nothing to them. The cost is that a long question travels in the
answer and in the payload — accepted, and it is the same cost that makes the answer
readable (below). See Q4.

**Required by default; optional is explicit; submit is all-or-nothing.** A
half-answered form is exactly the ambiguity this feature exists to remove — it
would put the agent right back to inferring what a partial answer covered. So:
a field is required unless marked optional, submit is available only when every
required field has an answer, there is no partial save and no per-field submit, and
the form is **unanswered until submitted**. That also gives "unanswered" one
meaning across the projection, Attention, and both cross-riders. See Q3.

**The optional note stays what it is.** §6's free-text note sits beside the answer
as a whole, not inside it. It is not re-modelled as an optional write field: it
means something different (a remark about the ask), it is already in the payload,
and collapsing the two would break every answer already recorded.

**Old forms are the one-field case of the new grammar.** A `prompt` plus `options`
**is** a form with a single required choose-one field. Nothing on disk is
rewritten, no existing form stops parsing, and every answer already recorded stays
a valid answer — a rider that needed a migration of committed conversation text
would be the wrong rider. The `form.respond` payload does grow (below); processed
queue events are runtime state under `.corpus/`, not corpus content, so nothing
historical needs re-reading.

**The answer turn must read as prose, and must stand on its own.** This is a
constraint on the **answer** format, not only on the question format, and it is the
one the draft is strictest about. The thread body is the record and it lands in
git. Today the answer is `**Answered:** Yes` — which names the choice and not the
question, so a `git log` reader (and anyone scrolling past the fence) sees an
answer with nothing attached to it. That is tolerable for one question and
worthless for four. So the draft requires the answer turn to name, **for every
field the form asked**, the question and what was given for it — including the
optional ones left blank, marked as blank. Three consequences, all deliberate:

- A reader months later can reconstruct the exchange from the answer turn alone.
- "Did they decline, or was that never asked?" is answerable from the diff without
  scrolling up to the fence.
- **It closes most of the contract's pairing gap for free.** The answer now names
  its questions, so an answer read back off disk pairs with its form by content
  rather than by order in every case except two open forms in one thread asking a
  literally identical question. And multi-field forms make multiple open forms
  rarer in the first place, because the reason to open a second one — a second
  question — is now a field. The residual is narrow, visible and self-limiting;
  the draft accepts it rather than putting a form id into the prose, which §6
  deliberately does not have. See Q7.

**No machine markup in the answer.** The prose stays prose; the structure travels
in the event. That is the contract's existing rationale and this rider strengthens
the case for it rather than weakening it.

**A turn carrying a form is never rewritten.** Its body is the question; the answer
beside it is the record of what was asked. See the cross-rider hazard below — this
sentence is written so it holds whether or not SHARED-020 is ever signed.

**Only the person answers.** The agent never answers a form, including its own.
Single-user system, but the agent writes turns through the CLI and could compose an
answer turn; a signal that the agent can clear for you is not a signal.

**A form the app cannot read renders raw, never partially.** Unparseable YAML, or a
field kind outside the three, renders as the visibly broken code block it is —
never as a subset of working controls. Half a question shown as if it were the
whole one is the failure mode worth spending a sentence on, and it matches the
posture the fence grammar already takes on an unterminated fence.

---

## Cross-rider hazards — both drafted, unsigned, in `issues/shared/`

Neither rider's text is restated here; both are cross-referenced so whichever is
applied second is read against this one.

**SHARED-020 (the agent revising its own latest turn) — must not reach a form
turn.** Two reasons, and the draft handles both without depending on 020:

- **An answered form is already out of reach under 020's own rule**, because
  answering appends a turn: the form's turn is no longer the last turn of the
  thread, and 020 freezes a turn "the moment any turn lands after it". So the
  dangerous case — the question changing under a recorded answer — is already
  excluded by 020 as drafted. **The draft states the prohibition anyway**, in §6,
  because the guarantee currently rests on an incidental fact about ordering
  rather than on anything about forms: if 020's freeze rule is ever narrowed, or
  if an answer is ever recorded some way other than as a following turn, the
  guarantee evaporates silently. A rule that only holds by coincidence is not a
  rule.
- **An *unanswered* form turn is still the last turn, and 020 would allow revising
  it.** The draft forbids that too. The person may have the controls filled in on
  screen; revising replaces the question under a half-made answer, and the submit
  that follows is then an answer to a question that was never asked. There is also
  no need for the licence: an agent whose question has changed asks again in a new
  turn, which costs one turn and loses nothing. See Q8 — this is the one place the
  draft is stricter than 020 needs it to be, and the user may prefer the looser
  rule.

If SHARED-020 signs, its §6 amendment and this one both land in §6 and must be
read together; nothing in either has to be re-worded, but the reviewer should
confirm the two rules are adjacent and not contradictory.

**SHARED-019 (the agent resolving settled subthreads) — its exclusion still holds,
unchanged.** 019 already excludes a thread "holding an unanswered form" from
agent-resolution. That exclusion needs **no re-wording** for richer forms, because
this rider keeps **"unanswered" meaning exactly one thing: not submitted.** A
multi-field form with every required field answered but not submitted is
unanswered. A form whose fields are all optional is unanswered until submitted. So
019's test — "nothing in the thread is still waiting on anyone" — keeps returning
the right answer with no change to its text, and the agent still never resolves a
thread that owes the person a question. Confirmed against 019's drafted text,
2026-08-05.

The corollary is worth naming for the user: **resolving a thread is the only way to
retire a question that has become moot**, and the agent will not do it. The
projection already behaves this way (`needs=form` guards on `status = 'open'`), so
this is a statement of existing behaviour, not a new one — but it is the escape
hatch a reliable signal needs, and Amendment 6 says so out loud.

---

## Proposed SPEC.md amendments — verbatim, for sign-off

> **Ordering hazard.** Amendment 7 appends after the **same** §11 Thread view
> sentence that SHARED-016 Amendment 1 and SHARED-020 append after. Whoever
> applies last must **re-read the bullet** and append after whatever is last at
> that moment.

### Amendment 1 — §6 "Forms in turns", REPLACE the grammar and answer sentences

REPLACE, in §6's **Forms in turns** paragraph, exactly this existing text:

> The block's YAML carries a `prompt` (non-empty) and `options` (at least one,
> each non-empty, all distinct — an answer names an option by its text). A form
> has no identity of its own: it is identified by the timestamp of the turn
> carrying it, so a turn carries **at most one form**, and answering a form
> addresses the turn that carries it. The UI renders it as live controls; forms
> are **single-select** — submitting an answer records exactly one chosen option,
> verbatim from the form's `options` (a choice the form does not offer is
> rejected), plus an optional free-text note from the answerer. Submitting appends
> a structured answer turn (the chosen option + any note) and enqueues a
> `form.respond` event — re-triggering the agent like any engaged-thread reply.

with the following:

> The block's YAML carries the questions the agent is asking: a form is a short
> list of **fields**, each with its own non-empty question text, **distinct within
> the form** — an answer names a field by its question, so two fields may not ask
> the same thing. A field is one of exactly **three kinds**, and there are no
> others: **choose one** (a non-empty list of options, each non-empty and all
> distinct; the answer names exactly one of them, verbatim), **choose any** (the
> same kind of list; the answer names none, one, or several of them, each
> verbatim), and **write** (no options; the answer is free text). A field is
> **required** unless it is explicitly marked optional. The single-question form
> stays spelled the short way: a `prompt` plus `options` **is** a form with one
> required choose-one field, so every form and every answer already written
> remains valid and nothing on disk is rewritten.
>
> A form has no identity of its own: it is identified by the timestamp of the turn
> carrying it, so a turn carries **at most one form** — several questions are
> several **fields of one form**, never several forms in one turn — and answering
> a form addresses the turn that carries it. Fields have no ids either: a field is
> named by its question, so nothing inside a form can drift from anything else in
> it. **A turn carrying a form is never rewritten**: its body is the question and
> the answer beside it is the record of what was asked, so a question is never
> changed under the person answering it or under the answer already given — an
> agent that needs to ask something else asks it in a new turn.
>
> The UI renders the form as live controls. **A form is answered once, as a
> whole**: there is no partial save and no per-field submit — submitting is
> possible only when every required field has an answer, and it records every
> field's answer in one act, so a form is **unanswered until it is submitted**. An
> answer the form does not offer — an option not in a field's list, or an answer
> to a field it does not ask — is rejected. Beside the answers, the answerer may
> add one optional free-text **note** about the ask as a whole. **Only the person
> answers a form**: the agent never answers a form, including its own.
>
> Submitting appends a structured answer turn and enqueues a `form.respond` event
> — re-triggering the agent like any engaged-thread reply. **The answer turn is
> prose, and it stands on its own**: it names, for **every** field the form asked,
> the question and what was given for it — the chosen option, the chosen options,
> or the text written — and says explicitly when an optional field was left blank,
> so someone reading the thread's markdown months later, in the app or in
> `git log`, sees what was asked and what was answered without the form fence in
> view. It carries no machine markup and invents no identifiers; the structure the
> agent consumes travels in the event, not in the prose.

### Amendment 2 — §6 "Forms in turns", REPLACE the Attention sentence

REPLACE, at the end of §6's **Forms in turns** paragraph, exactly this existing
text:

> Threads with an unanswered form surface in Attention as "awaiting your answer".

with the following:

> **An unanswered form is the corpus's one durable "this needs you" marker.**
> Threads with an unanswered form surface in Attention as "awaiting your answer",
> and stay there until the form is answered or the thread is resolved — **reading
> the thread does not clear it**, because having read a question is not having
> answered it. That is what a form buys over asking in prose: an unread reply is a
> signal that expires the moment you look at it (§7, Read state), and an unanswered
> form is a signal that expires only when you act on it. A thread can owe an answer
> to the person and a reply from the agent at the same time, and when it does it
> says both: a form's "awaiting your answer" is never suppressed by work the agent
> still owes, and the agent's pending indicator (§8) is never suppressed by a
> question the person still owes.

### Amendment 3 — §7, REPLACE the `form.respond` payload clause

REPLACE, in §7's **Core event types** sentence, exactly this existing text:

> `form.respond` (a form answer, §6 — payload `{threadId, formTs, option,
> note|null}`, where `formTs` is the timestamp of the turn carrying the answered
> form and `note` is null when none was given)

with the following:

> `form.respond` (a form answer, §6 — a payload naming the thread, the timestamp
> of the turn carrying the answered form, and **one entry per field of that
> form**: the field's question and what was given for it, whether that is the one
> chosen option, the chosen options, or the text written, with an optional field
> left blank present and marked as unanswered rather than omitted, plus the
> answerer's optional note, null when none was given. The agent never has to work
> out which answer belongs to which question, and never has to guess whether a
> question went unanswered or unasked)

### Amendment 4 — §11 Attention, APPEND to the bullet

APPEND immediately after, in §11, exactly this existing bullet:

> - **Attention** is a built-in seed view (`needs=me`): unread agent replies,
>   unanswered forms, due/overdue documents, stale-for-review, failed jobs — each
>   row carrying a reason chip. Handling the reason (reading the reply, answering
>   the form, reviewing/archiving, retrying) clears the row live via SSE.

the following, as the continuation of that same bullet:

> **An unanswered form's row is the one that survives being read.** Every other
> reason here clears by attending to it, and "unread agent reply" clears by
> opening the thread — so a question the agent asked in prose leaves Attention the
> moment you look at it, answered or not. An unanswered form does not: its row
> stays until the form is answered or the thread is resolved (§6), and a thread
> holding more than one unanswered form says how many are still open. Resolving
> the thread stays the person's way of saying a question no longer matters — and
> stays the person's alone, since the agent does not resolve a thread that is
> waiting on an answer.

### Amendment 5 — §7 Comment skill, APPEND a paragraph after it

APPEND immediately after, in §7, exactly this existing text (the end of the
**Comment skill** paragraph):

> Close the loop by setting `agent: engaged` on first reply.

the following, as a new paragraph:

> **Asking with a form.** When a turn's purpose is to get something from the
> person — a decision, a preference, a missing fact, a go/no-go before doing work
> — the agent asks with a **form** (§6) rather than with a question in prose. This
> is a stewardship rule, not a mechanism, and it is what makes the "this needs
> you" signal worth trusting: a question asked in prose leaves no trace that
> anyone is waiting once the thread has been read. The agent asks the **whole
> batch at once** — every question it needs answered to proceed, as fields of one
> form, in one turn — rather than one question per turn, so the person answers
> once and the agent gets the answers together instead of reconstructing which
> reply meant what. It marks a field optional when it can proceed without it,
> keeps questions short enough to read as controls, and says in the same turn what
> it will do with the answers. It does **not** put open-ended conversation into a
> form: a form is for questions that have answers, and everything else is ordinary
> prose.

### Amendment 6 — §11 Thread view, APPEND after the newlines sentence

APPEND immediately after, in §11's **Thread view** bullet, exactly this existing
text:

> **Newlines in a turn written by a person render as line breaks** — a textarea
> offers no other way to write one — while a turn written by the agent renders as
> ordinary markdown, where a single newline is a space and a break is written as
> markdown spells it. _(Rider signed 2026-08-03.)_

the following:

> **A form is a set of controls, and once answered it is a record.** A turn
> carrying a form (§6) renders its questions as live controls — one per field,
> matched to what the field asks: choose one, choose any, or write — with the
> required ones marked, a single submit for the whole form that names its key like
> every other composer control, and a place for the optional note. Submit becomes
> available only once every required field has an answer, and the form says which
> question is still missing rather than letting the attempt fail silently.
> Everything is reachable from the keyboard: no answer is available only to a
> pointer. **Once submitted, the form stops being a question** — its controls
> become the recorded answer, shown in place, each question beside what was given
> for it, so the turn afterwards reads as the exchange it was; changing your mind
> is an ordinary reply, not a second answer to the same question. A form the app
> cannot read — YAML that does not parse, or a field outside §6's three kinds —
> renders as the visibly broken code block it is, **never as a partial set of
> controls**: a question shown wrong is worse than a question shown raw. _(Rider
> signed 2026-08-05.)_

---

## Open questions for sign-off

**Q1 — Is the control set right: choose one, choose any, write, and nothing
else?** The user named checkboxes and inputs; the draft adds nothing beyond them
and today's single-select. The tempting fourth is a **date** (and behind it, a
number) — the agent asking "when is this due?" is a plausible ask, and §5 already
has due dates.

_Recommendation: three kinds, as drafted._ A date is a `write` field whose answer
the agent parses, and if it parses it wrong the person sees the wrong date written
back in the reply and says so — the failure is visible and cheap. A date *field*
is a picker, a format, a timezone question and a validation message, which is the
first brick of the validation engine this rider refuses to build. If dates prove to
be the constant ask, add them later as a fourth kind in one sentence; adding is
easy, and un-shipping a control set is not.

**Q2 — Should a `write` field distinguish one line from a paragraph?** The draft
omits it: a `write` field is free text and the control grows to fit.

_Recommendation: omit, as drafted._ It is the smallest possible field-type
attribute and it is exactly the kind of attribute that arrives with five friends.

**Q3 — Required by default, or optional by default?** The draft makes fields
required unless marked optional, and blocks submit until every required field is
answered.

_Recommendation: required by default, as drafted_, with Amendment 5 telling the
agent to mark generously. The alternative — optional by default — makes the common
case (a decision the agent genuinely cannot proceed without) the one that needs
extra markup, and makes an empty submit legal, which puts the agent straight back
to inferring. If the user finds forms feel like gates, the fix is the agent marking
more fields optional, not the default flipping.

**Q4 — Is naming a field by its question text right, or should a field carry a
short key?** The draft has no field ids: the question is the identity, distinct
within the form. That keeps the contract's "no second identifier to drift"
principle intact and keeps the YAML readable in a diff. The cost is that a long
question is repeated in the answer turn and in the event payload.

_Recommendation: no field ids, as drafted._ The repetition is not waste — it is
precisely what makes the answer turn readable on its own (the third design
decision above), so the two goals are the same goal. A short key would be a second
name for the same thing, drifting from the question the moment either is edited,
and it would put a token in the answer prose that means nothing to a human reader.

**Q5 — Should the answer turn list every field, including optional ones left
blank?** The draft says yes, marked as blank. The alternative is to omit blanks
and keep the answer shorter.

_Recommendation: list every field, as drafted._ The answer turn is the record and
the record should stand alone: omitting blanks makes "they declined" and "it was
never asked" the same bytes in a diff, which is the exact class of ambiguity
motivation 2 is about. A three-question form with one skip is still four short
lines.

**Q6 — May an answered form be answered again?** §6 today does not say, and the
contract notes that answering again is legal and re-pairs the order rule. The draft
**closes it**: submitted once, the form becomes a record, and changing your mind is
an ordinary reply.

_Recommendation: close it, as drafted_, and note that this is a **behaviour change**
to something currently permitted, not just new text. A re-answerable form makes
"what did they choose?" a question with more than one answer in the same thread,
fires a second `form.respond` for the same ask, and re-opens the pairing ambiguity
the answer-naming rule otherwise closes. A person who changes their mind wants to
say why, which a reply carries and a re-submit does not.

**Q7 — Accept the residual pairing ambiguity?** With the answer naming its
questions, an answer read back off disk pairs by content, so the failure narrows to
two open forms in one thread asking a literally identical question. Closing it
completely would mean putting the form's identity into the answer prose, which §6
deliberately does not have.

_Recommendation: accept, as drafted._ Multi-field forms make multiple open forms
rare (the reason for a second form is now a field), the failure is visible, and
answering again re-pairs it. Revisit only if multi-form threads become a real
pattern — and then via §6, not a silent format change.

**Q8 — May the agent revise a turn carrying an *unanswered* form?** The draft
forbids revising a form-carrying turn at all. Under SHARED-020's own rule an
*answered* form's turn is already frozen (the answer turn follows it), so the strict
part is only the unanswered case.

_Recommendation: forbid it, as drafted._ The person may have the controls
half-filled when the question changes under them, and the submit that follows
answers a question nobody asked. The looser rule buys one turn. If the user prefers
it, the honest looser version is: revising a turn carrying an unanswered form
**discards any answer in progress and says so**, rather than silently rebinding it
— which is more machinery than asking again.

**Q9 — Should Amendment 3 spell the payload's keys, the way §7 spells
`doc.edited`'s?** The draft describes the payload's content in prose instead,
because naming keys is a contract decision and this rider's rule is WHAT, not HOW.
The inconsistency is that its two neighbours in that sentence do spell keys.

_Recommendation: prose, as drafted_, and let the contract issue pin the keys after
sign-off. The old key list is now wrong and cannot stay; inventing a new one here
would freeze a shape three consumers have to live with, decided by the agent least
qualified to decide it.

**Q10 — Is Amendment 5 (the ask-with-a-form rule) wanted at all?** It is the only
amendment that constrains how the agent *writes*, and it is the one that actually
delivers the user's third motivation — the others make forms better, this one makes
them happen. It is also the least mechanically testable: an evaluator can verify
that a form-shaped ask renders and signals, but "should this have been a form?" is
a judgment.

_Recommendation: sign it._ Without it, the attention signal stays as rare as it is
today and the rider mostly serves motivations 1 and 2. It is testable at the shape
the user cares about: give the agent a task that needs three decisions from the
person, and it must come back with one form of three fields, not three prose
questions across three turns.

---

## Non-goals (state them so the chain does not drift)

- **No validation engine.** No regexes, no min/max, no lengths, no formats, no
  per-field error rules. The only rejections are the ones §6 already implies:
  a required field with no answer, an option a field does not offer, an answer to
  a field the form does not ask.
- **No form builder** — no UI for composing forms, no template forms, no reusable
  form documents. The agent writes YAML in a turn.
- **No field kinds beyond the three** (Q1): no dates, numbers, ranges, sliders,
  file pickers, defaults, placeholders, or help text.
- **No conditional or branching fields**, no sections, no ordering rules beyond
  "the order they are written".
- **No forms outside agent turns.** A person does not write a form; a form in a
  document body is an ordinary code block. Unchanged from today.
- **No second form in a turn** and no change to the fence grammar: column-0
  backtick fences, closing fence required, info string matched whole, first form
  fence wins.
- **No partial saves, no per-field submit, no draft state on the server.**
- **No new Attention reason.** `needs=form` already exists and is already
  form-scoped; this rider makes it worth producing and writes down what it
  promises, and adds no fifth reason to `needs=me`.
- **No change to what triggers the agent.** §8 is not edited. A form answer
  re-triggers exactly as it does today.
- **No migration and no retroactive rewriting.** Existing forms are the one-field
  case; existing answer turns keep their meaning; nothing on disk changes.
- **Not a survey tool.** No anonymous responses, no aggregation across threads, no
  reporting view. One person answers one agent in one conversation.

## Acceptance Criteria

- [ ] User signs off, or answers Q1–Q10 and the text is adjusted
- [ ] All six amendments applied to SPEC.md verbatim at phase kickoff, by the
      orchestrator
- [ ] **Amendment 6's anchor is re-read, not pattern-matched**: SHARED-016
      Amendment 1 and SHARED-020 append after the same §11 Thread view sentence,
      so whichever applies last appends after whatever is last at that moment
- [ ] §8 is **not** edited
- [ ] §6's fence-grammar sentences (the ```` ```form ```` fence, the whole-info-string
      match, ```` ```formula ````/```` ```form-builder ````) are **not** touched by
      Amendment 1
- [ ] SHARED-019's "unanswered form" exclusion is confirmed to need no re-wording
      before either rider is applied
- [ ] If SHARED-020 signs, its §6 amendment and Amendment 1 are read together and
      confirmed non-contradictory
- [ ] The implementing chain does not start before the text is in place
- [ ] The contract issue that follows pins the field grammar and the
      `form.respond` keys (Q9), and states explicitly that a bare
      `prompt`+`options` form parses as one required choose-one field

## Technical Design

### Files to Create/Modify

- `SPEC.md` §6 (two replacements), §7 (one replacement, one append), §11 (two
  appends)

## Testing Strategy

None — spec text. The domain issues carry the tests. The notches worth fixturing
when they are filed:

- a legacy form (`prompt` + `options`, nothing else) written before this existed →
  renders as one required choose-one control, answers as before, and its already
  recorded `**Answered:** …` turn still reads as an answer
- a three-field form (choose one, choose any, write) with one field optional →
  submit is unavailable until both required fields are answered, and the form
  names the missing one
- the same form submitted with the optional field blank → the answer turn names
  **all three** questions, the blank one marked as blank, and the event payload
  carries the same three entries
- a choose-any field answered with none selected → legal only if optional;
  the answer turn says so in words
- the answer turn read back with the form fence out of view → a reader can state
  what was asked and what was chosen from the answer alone
- a form submitted, then the thread reloaded → the controls render as a record,
  and there is no way to submit a second answer to it (Q6)
- an unanswered form in an open thread → Attention row present; **open the
  thread, then close it** → row still present; answer it → row clears live; a
  second thread whose only signal is an unread agent reply → row clears on open
- a thread with an unanswered form that also has an outstanding agent reply →
  both signals visible at once
- a thread with an unanswered form → resolve it → row clears; and the agent does
  not resolve it on its own (SHARED-019)
- a turn carrying a form, answered or not → no revision path reaches it
  (SHARED-020)
- a form fence whose YAML does not parse, and one naming a fourth kind of field →
  both render as visibly broken code blocks, neither as partial controls, and
  neither is answerable
- a form whose two fields ask the same question, and one whose choose-one field
  lists a duplicate option → both rejected at write time
- every control answerable with the keyboard alone, submit included

## E2E Verification Log

_N/A — spec draft._

## Completion Checklist (orchestrator)

- [ ] Sign-off recorded
- [ ] SPEC.md updated
- [ ] Committed with `[SHARED-021]` prefix
