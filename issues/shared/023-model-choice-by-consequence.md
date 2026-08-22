# [SHARED-023] Model choice by consequence, and splitting work across weights

## Domain

shared (orchestrator-owned)

## Status

done — signed by the user 2026-08-06; amendments applied to SPEC.md.

## Priority

P2

## Model

fable

## Dependencies

- Depends on: **SHARED-022** (signed and applied 2026-08-06). Two of the four
  amendments below touch sentences that rider added **today**; one of them is a
  **replacement** of a sentence signed hours ago. This rider is unreadable
  without 022 and must not be applied before it.
- Blocks: the agent-runtime chain (the orchestrate skill's weight table and its
  "judge weight by three things" rule are what actually change behaviour) — not
  filed.
- **Ordering hazard**: all four amendments target §7, and two of them target the
  **Orchestrator skill paragraph**, which has now taken amendments on two
  consecutive days. Any rider touching that paragraph must **re-read it** before
  applying rather than pattern-matching an anchor. `_(Rider signed 2026-08-06.)_`
  already appears **four times** in SPEC.md and is not an anchor.

## Scope

**This is the product's orchestrator agent** — the one `corpus init` installs
into a user's workspace. It is **not** this repo's development harness. Nothing
here touches root `CLAUDE.md` or root `.claude/`; those are the dev harness and
are explicitly out of scope (user, 2026-08-06).

## Spec References

- **§7 Event queue and agent loop** — the **Orchestrator skill** paragraph (the
  weight rule, and SHARED-022's directive text), the **console** bullet, and the
  **Retrieval discipline** bullet "Subagents receive anchors, not documents"
- §13 Publish plugin — "the agent never touches the destination"; publishing is
  user-only. This is the specced form of the user's own "document that is
  shared" example, and it shapes the formulation (below)
- §8 Agent participation semantics — "a directive, not a hint". Borrowed by
  reference through SHARED-022; **not edited**
- §10 UI — the composer's weight control (SHARED-022 Amendment 3). **Not edited**

---

## The user, verbatim (2026-08-06)

> "I want to reinforce the importance of thinking about what is the impact of a
> bad outcome when picking a model for a task. There needs to be some kind of
> risk modeling overriding the technicality of the task. If the task isn't
> resolved with high accuracy, what is the side effect of that? For example, if
> the output of the task is used for writing a document that is shared, doing a
> bad job means the document won't be shared, so we should consider using a
> powerful model. If the output influences a hiring decision, same thing, it can
> have a real negative effect. Let's pick a powerful model. I also want to add
> that it's ok to split tasks into smaller ones. For example, one small model to
> collect the data, or come up with a simple script, a powerful one to analyze
> that data and draw conclusions. The context used to collect data is not shared
> with the more powerful model that don't need that context, it only needs the
> actual data. That's an example of how we can manage cost and efficiency, while
> keeping or even increasing accuracy."

**Two ideas, and the draft carries both separately.**

1. **Consequence overrides weight.** "Risk modeling overriding the technicality
   of the task" is the operative phrase — not a factor added to the mix, an
   **override**. The question stops being "how hard is this" and becomes "if this
   is done badly, what happens next".
2. **Splitting is legitimate, and context isolation is the reason it works.**
   Small model collects; strong model concludes; **the gathering context does not
   travel**. The user's claim is not that this is cheaper — it is that it
   **keeps or increases accuracy** while being cheaper, because the concluding
   model receives clean relevant input instead of a long polluted one. Flattening
   that into "it saves money" loses the argument.

---

## Verified facts

- **SPEC §7's weight rule reads, right now** (verified unique in SPEC.md):

  > The **subagent's model scales with the task's weight**: small, mechanical
  > work goes to a smaller, faster model; larger or judgment-heavy work to a
  > stronger one. The skill states the concrete model-tier guidance (model names
  > live in the skill, not here).

  followed immediately by SHARED-022's applied text (the request-may-state-a-
  weight directive), and then by "Delegation changes who does the work, never the
  contract around it:" and the bullet list. Amendment 1 replaces only the two
  sentences above; Amendment 2 replaces one sentence inside SHARED-022's text.

- **Consequence is already in the skill — but as one factor of three, averaged
  in.** `assets/workspace/claude/skills/orchestrate/SKILL.md:238-240`:

  > Judge weight by three things: how many documents the work touches, whether
  > the request prescribes the change or asks for a decision, and the cost of
  > getting it wrong. In doubt between two tiers, take the stronger — a wasted
  > token is cheaper than a wrong edit.

  So the user is not introducing a new consideration. They are **promoting an
  existing third-of-three into a veto**. That is the precise change, and it is
  why this rider is small: the vocabulary exists, the ranking is wrong. The
  Opus row of the same table already says "anything where a wrong answer is
  expensive to unwind" — a *symptom* of consequence, listed beside
  "cross-document restructuring", i.e. beside difficulty.

- **The skill already escalates on consequence once, ad hoc.** SKILL.md:300 —
  the `doc.edited` procedure runs "at the **Sonnet** tier by default and **Opus
  5** when step 4 is going to write another document." That is a
  consequence-triggered escalation written as a one-off. The rider generalises
  what is already there in one place.

- **"Expensive to unwind" is already SPEC vocabulary, and already has teeth.**
  SHARED-022's applied §7 text ends: "where proceeding at that weight would be
  **expensive to unwind**, it asks first, with a form, as it does for any other
  decision it needs from the person." **This is the whole collision resolution**
  — see below. The phrase occurs once in SPEC.md.

- **Context isolation is a sharpening, not a new rule.** §7 Retrieval
  discipline: "**Subagents receive anchors, not documents.** A delegated dispatch
  … hands the subagent the task plus the top-k retrieval results … it is never
  handed, and never asks for, a corpus dump." And SKILL.md:220-227: "never paste
  a document body into a prompt, never hand over a file, and never ask a
  subagent to report the corpus's contents back to you." Both govern
  **orchestrator → subagent**. Neither governs **stage → stage**, which is what
  the user described, and neither carries the accuracy claim — they are written
  purely as frugality rules. Amendment 3 extends the existing rule rather than
  opening a new subject.

- **Splitting already half-exists, in the wrong half.** SKILL.md:204 — every
  claimed event goes to a subagent, "no exception for small work" — so one
  request already becomes at least two contexts. What does not exist is a
  *second* subagent for the same request at a *different* weight, or any rule
  about what passes between them.

- **§13 makes the user's own example specced, and inverts the naive harm
  model.** "The agent never touches the destination … there is deliberately **no
  CLI verb**, so the agent has no path to Google. The agent's reach ends at
  editing the Corpus document and optionally setting `publish.ready: true` …
  (Publishing is user-only in the same way deletion is.)" So a badly-written
  publish-ready document does **not** escape — a person is the gate. The harm is
  exactly what the user said it was: *"doing a bad job means the document won't
  be shared."* The work is wasted and the thing does not happen. This is why the
  formulation below is not "damage escapes containment".

- **The console already answers "at what weight, and who chose it".**
  SHARED-022 Amendment 2, applied: "**A dispatch says what weight it went out
  at, and where that weight came from**". And every progress line for an event
  converges on one file (§7 job logs: `.corpus/jobs/<eventId>.jsonl`), with the
  skill binding subagents to log against **the dispatching event's** id
  (SKILL.md:256). So a split job is already one log. The only gap is that SPEC
  says "its dispatch" and "a dispatch", singular — Amendment 4 closes exactly
  that and adds no surface.

---

## The decisions this draft makes, and why

### Decision 1 — The formulation: what a bad result does that revising the document afterwards would not undo

The brief's hardest constraint, and it is real: *every* task has a downstream
effect, so "consider the consequences" applies to everything and therefore
guides nothing. A test that fires on all work is a test that changes no
dispatch.

**What makes this discriminate is the negative case, and the negative case is
specific to Corpus.** This system is built out of undo: git history behind every
write, threads on any passage, revision of a turn in place, archive-never-delete,
anchor reconciliation that survives edits. The ordinary failure mode here is *a
wrong document sitting in the corpus* — and noticing it, commenting on it, and
revising it is **the system working as designed**, not a harm. So the thing worth
naming is the part the corpus's own repair loop does not reach.

Two conditions, both from the user's examples, and most work meets neither:

1. **The output exists to be used outside the corpus** — published, sent, handed
   to someone. §13's gate means the failure is usually not "a bad document went
   out" but "the document did not go out and the work was wasted", which is the
   user's own sentence.
2. **Someone will decide something real on it** — about a person, about money,
   about a commitment. The hiring case. Here **the decision, not the document,
   carries the harm**, and amending the document afterwards does not unmake the
   decision.

Stated as one question: **not "how hard is this?" but "what would a bad result do
that revising the document afterwards would not undo?"**

**And the consequence of the test firing is stated in the terms the user used**:
the work gets the stronger model **however mechanical it looks**. A one-line
edit to a document about to be published, or a three-row table someone will hire
from, is not small work. This is the sentence that does the work — it is the one
that overturns a dispatch that today's rule would send to the cheapest tier.

### Decision 2 — The collision with SHARED-022 resolves through a sentence SHARED-022 already wrote

**The collision.** SHARED-022 made a stated weight "**honoured, not weighed
again**", and forbade silent substitution "**in either direction**". This rider
says the agent must weigh consequence. If the person asked for something cheap
on work whose failure would be costly, two signed rules appear to collide.

**The resolution, and it requires no new rule.** SHARED-022's own text already
ends with the escape valve: "where proceeding at that weight would be **expensive
to unwind**, it **asks first, with a form**, as it does for any other decision it
needs from the person."

So the two amendments compose exactly:

- **Consequence governs the orchestrator's own judgment** — what it picks when
  the request said nothing. That is the whole of Amendment 1's force, and it
  collides with nothing.
- **Where the request stated a weight, the stated weight is still honoured.** No
  override, no silent upgrade, in either direction. Unchanged.
- **The consequence test simply defines when the existing trigger fires.** The
  two conditions above are *what makes proceeding expensive to unwind*. So a
  request stating a weight lighter than the consequence calls for is not
  overridden — it is **asked about first, with a form**, which the standing
  sentence already requires. Asking is not substituting.

That is the whole answer, and it is better than anything a fresh rule would have
produced: consequence gets real teeth against a stated weight (the work does not
just quietly proceed), the person keeps final say (they answer the form), and
"honoured, not weighed again" survives intact because nothing is re-decided
behind their back. **Amendment 1 says this explicitly** rather than leaving two
rules that a reader must reconcile.

### Decision 3 — Splitting: a stage that *decides* carries the weight; a stage that produces *material* need not

**The second collision, which the brief did not name and is the sharper one.**
SHARED-022's applied text says the stated weight "travels to whatever actually
does the work, and onward **through any further delegation that work requires**."
Read literally, that means a request stating a strong weight forces the data
collection to run strong too — which forbids precisely the split the user asked
for, in the sentence signed this morning.

**This is why Amendment 2 is a replacement, not an append.** A qualifier three
sentences later would leave the contradiction on the page. The two rules become
one sentence-run, and the reader never has to reconcile them.

**The line drawn**: a stage whose output is **material** — retrieved text, a
listing, a mechanical transformation, a script and what it printed — may run
lighter. A stage that **decides** — a conclusion, a recommendation, the wording
of a reply, an edit to a document — may not. Those *are* the work the request
asked for; they carry the consequence; they run at the governing weight.

**Why the line has to be drawn there and not left to judgment.** "Split when
useful" is a loophole with a shape: anything can be described as preparation, and
an agent optimising cost will describe more and more of the work that way until
the conclusion itself is "just summarising what the collector found". Tying the
weight to *what a stage outputs* is checkable — by the agent, and by an evaluator
reading the job log.

**And the mirror guard, which matters as much.** Splitting must not become the
route around silent substitution in the *other* direction: if the person stated a
low weight, the deciding stage runs low too. The agent's recourse is unchanged —
speech, and the form. Without this clause the whole of SHARED-022's
either-direction rule could be evaded by relabelling.

### Decision 4 — Permission, not obligation. But what a stage *receives* is obligatory.

The user said "**it's ok** to split" — permission. The brief asks whether the
spec should go further for high-consequence work.

**Recommendation: do not mandate splitting, and the reason is not timidity.** A
split introduces a handoff, and handoffs lose things; for genuinely entangled
work a single strong pass beats two stages with a summary between them. A spec
that requires splitting above a consequence threshold would force the worse shape
in exactly the cases that matter most. "When to split" is judgment, and judgment
does not belong in a testable spec.

**What does belong, and is drafted as obligation, is everything around the
split** — all of it testable:

- which stage carries the weight (Decision 3);
- what a stage receives (Amendment 3);
- that the split is visible (Amendment 4);
- that one request is still one reply, whatever it took internally.

So: splitting is always allowed, never required, and **fully governed once
chosen**. That is the strongest position available without legislating judgment.

### Decision 5 — Context isolation carries the accuracy claim, not just the saving

Amendment 3 states the user's claim as the user made it: isolating the stages is
expected to **hold or improve** the answer's quality while costing less, because
a judging stage works better on a short relevant input than on a long one
carrying everything the collecting stage happened to look at. Written as a pure
frugality rule — which is how both existing context rules are written — it would
read as a cost tradeoff to be waived whenever quality is on the line, i.e.
waived in exactly the high-consequence cases this rider exists for. Stating it as
a quality argument inverts that: the split is *why the answer is good*, not the
price of it being cheap.

**With one honest bound**, because the claim is a claim and not a law: where
isolation and quality pull apart, quality decides. Material a later stage
genuinely needs is passed on, and a stage that would have to guess is briefed
further rather than left short. Without that clause the rule would eventually
starve a stage in the name of a principle about not starving stages.

### Decision 6 — Legibility: the existing surface suffices, and gets one sentence

The brief says: do not invent a new surface. Verified — none is needed. Every
progress line for an event already converges on one job log, and SHARED-022
already put weight-and-provenance on the dispatch line. A three-stage job is
three dispatch lines in one log.

The only real gap is grammatical: SPEC says "**its** dispatch" and "**a**
dispatch", singular, so an evaluator reading SPEC alone could not fail a build
that logged one line for a job that ran three stages. Amendment 4 is one
sentence making plurality explicit. It adds no surface, no file, no UI.

**What a person sees, concretely**: one job, one status, one reply — and inside
it, a line per stage saying what weight it ran at and where that weight came
from. "Collected at the light level (judged); analysed at the strong level
(judged — the result is going out)". That is legible, and it is legible in the
place they already look.

### Decision 7 — §7 only. Nothing in §8, nothing in §10.

The brief asks whether any of this belongs in §8 (participation). **It does
not.** §8 owns what *wakes* the agent and *where* it replies; this rider is
entirely about *how work is done once it has been asked for*. SHARED-022 set the
precedent cleanly: it put the weight rules in §7 and touched §10 only because it
introduced a **person-facing control**. This rider introduces none — no new
composer control, no new toggle, no new flag. So §10 is untouched too, and both
are listed as non-goals so the chain does not drift.

---

## Proposed SPEC.md amendments — verbatim, held for sign-off

> **Not applied.** Four amendments, all in §7. **Two are replacements** (1 and
> 2); 3 and 4 append and delete nothing. Amendment 2 replaces a sentence
> **SHARED-022 added today** — that is deliberate (Decision 3) and is the single
> thing most worth checking at sign-off. Replace `<DATE>` with the sign-off date.

### Amendment 1 — §7 Orchestrator skill paragraph, REPLACE two sentences

In §7's **Orchestrator skill** paragraph, REPLACE exactly this existing text
(verified unique in SPEC.md):

> The **subagent's model scales with the task's weight**: small, mechanical work
> goes to a smaller, faster model; larger or judgment-heavy work to a stronger
> one. The skill states the concrete model-tier guidance (model names live in the
> skill, not here).

with the following:

> The **subagent's model scales with the task's weight**: small, mechanical work
> goes to a smaller, faster model; larger or judgment-heavy work to a stronger
> one. **But weight is judged by consequence first and difficulty second.** The
> question that decides a model is not how hard the work looks; it is **what a
> bad result would do that revising the document afterwards would not undo**. Two
> things make a failure that kind: the output exists **to be used outside the
> corpus** — published, sent, handed to someone — where a bad one is not quietly
> corrected but rejected, so the work is wasted and the thing does not happen; or
> **someone will decide something real on it**, about a person, about money,
> about a commitment, where it is the decision and not the document that carries
> the harm, and amending the document later does not unmake it. Neither is the
> ordinary case, and that is the point: the ordinary failure is a wrong document
> sitting in the corpus, where noticing it, commenting on it and revising it is
> this system working as designed — not a reason to reach for a stronger model.
> Where one of the two **does** hold, the work gets the stronger model **however
> mechanical it looks**: a one-line edit to a document about to go out, or a
> three-row table someone will hire from, is not small work, and a saving that is
> only visible on the invoice is not a saving. The skill states the concrete
> model-tier guidance (model names live in the skill, not here), and is where
> this test is applied. **This governs what the orchestrator picks, never a
> weight the request stated**: a stated weight is honoured exactly as below, and
> the two conditions here are precisely what make proceeding **expensive to
> unwind** — so a request stating a weight lighter than the consequence calls for
> is not overridden, it is **asked about first, with a form**, as the rule below
> already requires. Asking is not substituting. _(Rider signed <DATE>.)_

### Amendment 2 — §7 Orchestrator skill paragraph, REPLACE one sentence (added by SHARED-022 the same day)

In the same paragraph, REPLACE exactly this existing text (verified unique in
SPEC.md — **re-read it before applying**):

> The choice governs **the work the request asks for**, not merely the turn that
> receives it: since every event is delegated, it travels to whatever actually
> does the work, and onward through any further delegation that work requires.

with the following:

> The choice governs **the work the request asks for**, not merely the turn that
> receives it: since every event is delegated, it travels to whatever actually
> does the work, and onward through any further delegation that work requires.
> **Work may be split, and its parts need not run at the same weight.** One
> request may be done in stages — collecting the material, or writing a small
> script to produce it, and then judging that material and drawing the conclusion
> — and a stage whose output is **material** (retrieved text, a listing, a
> mechanical transformation, a script and what it printed) may run lighter than
> the request calls for. What may not is a stage that **decides**: a conclusion, a
> recommendation, the wording of a reply, an edit to a document. Those are the
> work the request asked for, they are what carries the consequence above, and
> they run at the governing weight — the stated one where a weight was stated,
> the judged one otherwise. So splitting is never a route around either rule: it
> cannot quietly run the deciding part lighter than was asked, and it cannot
> quietly run it stronger, because the prohibition on substituting **in either
> direction** binds the stages exactly as it binds the whole. Splitting is always
> permitted and never required — whether work divides cleanly is a judgment — but
> once split it is governed: what each stage is given is stated below (§7
> Retrieval discipline), and one request remains **one piece of work with one
> reply**, whatever it took internally. _(Rider signed <DATE>.)_

### Amendment 3 — §7 Retrieval discipline, APPEND to the "anchors, not documents" bullet

APPEND immediately after, in §7's **Subagents receive anchors, not documents**
bullet, exactly this existing text — currently the bullet's last sentence
(verified unique):

> The subagent retrieves and reads what it needs through the same verbs; it is
> never handed, and never asks for, a corpus dump.

the following:

> **The same holds between the stages of one piece of work.** Where work is split
> (§7 above), a stage receives **what the previous stage produced** — the
> gathered material, the numbers, the script's output, the answer — and not the
> account of how it was produced: not the transcript, not the false starts, not
> the searches that returned nothing, not the reasoning that got there. Each
> stage is briefed as though it were the first. This is **not only a saving**: a
> stage that has to judge does so better on a short, relevant input than on a
> long one carrying everything an earlier stage happened to look at, so isolating
> the stages is expected to **hold or improve** the quality of the answer while
> costing less — which is why the split is worth making and not merely tolerable.
> Where the two ever pull apart, quality decides: material a later stage
> genuinely needs is passed on, and a stage that would otherwise have to guess is
> briefed further rather than left short. _(Rider signed <DATE>.)_

### Amendment 4 — §7, APPEND to the console bullet

APPEND immediately after, in §7's console bullet, exactly this existing text —
currently the bullet's last sentence, added by SHARED-022 (verified unique):

> It is a **live** record and not a permanent one: a job's log is runtime state
> that is reaped with its event (below), so the durable account of a weight that
> could not be honoured is the one the reply carries (§7 above). _(Rider signed
> 2026-08-06.)_

the following:

> **A job that ran in stages shows every one of them.** Where one request was
> split (§7 above), the job's log carries a dispatch line **per stage**, in
> order, each naming its weight and where that weight came from — so a reader
> sees that the collecting ran light and the judging ran strong, rather than one
> line that accounts for only part of what happened. There is no second surface
> for this: it is the one job's log the request already has, and the request is
> still one job with one status and one reply. _(Rider signed <DATE>.)_

---

## Open questions for sign-off

**Q1 — Is the consequence test drawn tightly enough to actually change
dispatches?** As drafted it fires on two conditions — the output is *used outside
the corpus*, or *someone decides something real on it* — and the load-bearing
half is the **negative** case: a wrong document that stays in the corpus is
ordinary work, because revision is what this system is for.

_Recommendation: as drafted._ It is the only version I found that answers "does
this apply to the task in front of me?" with **no** for most tasks, which is what
makes it a rule rather than a mood. **If it is overturned**, the direction to
avoid is adding a third condition — every addition widens it back toward
"everything matters". The direction to take instead is naming a concrete
in-corpus signal the agent can read (a document already marked ready to publish,
a document type the workspace has said is externally used), which narrows it
further and is more testable, at the cost of missing cases nobody flagged.

**Q2 — Should splitting be an expectation for high-consequence work, rather than
a permission?** The user said "it's ok to split". As drafted, splitting is always
allowed, never required, and fully governed once chosen.

_Recommendation: keep it a permission._ Mandating a split above a consequence
threshold would force a handoff — and handoffs lose information — in precisely
the cases where losing information is most expensive. "When to split" is judgment
and is not testable; what *is* testable (which stage carries the weight, what a
stage receives, that the split is visible, one request one reply) is drafted as
obligation. **If overturned**, the honest form is not "must split" but "must
consider splitting and say in the log why it did not", which is a disclosure
requirement rather than a shape requirement, and stays testable.

**Q3 — Is a multi-stage job legible enough, without a new surface?** Yes, as
drafted: one job, one status, one reply, and a dispatch line per stage in the log
the request already has. Amendment 4 exists only because SPEC currently says
"its dispatch" and "a dispatch" in the singular, which would let a build log one
line for a three-stage job and still pass a reading of SPEC.

_Recommendation: keep Amendment 4, invent nothing else._ The cost is one
sentence. The alternative — dropping it as implied — leaves the one thing this
rider claims about visibility untestable. Note the inherited limit, unchanged
from SHARED-022: **the job log is reaped with its event**, so this is a live
record, not a permanent one; months later, "did that answer get split?" is
unanswerable. That is SHARED-022's Q2 and is not reopened here.

**Q4 — Does any of this belong in §8 (participation) rather than §7?** No, as
drafted. §8 owns what wakes the agent and where it replies; every amendment here
is about how work is done once it has been asked for. §10 is untouched too,
because this rider adds no person-facing control.

_Recommendation: §7 only, as drafted._ **If any part were to move**, the only
candidate is Amendment 3, and it would move *within* §7 — see Q6.

**Q5 — Should a person be able to state the *consequence* rather than the
weight?** Not drafted. SHARED-022 gave the composer a **weight** picker. But the
user's own framing is about consequence, and a person is far better placed than
the agent to know that a document is going into a hiring pack — while being
poorly placed to know which weight that implies. A "this is going out / someone
decides on this" statement would be the more honest control, and the agent would
derive the weight from it.

_Recommendation: not now, and file it if it appeals._ It is a second composer
control for something the agent is meant to judge, and it would arrive one day
after the first one shipped. **The signal to watch**: if people start using the
weight picker mainly as a proxy for "this one matters", the picker is the wrong
control and this becomes the right one.

**Q6 — Is Amendment 3 in the right bullet?** It appends to §7's **Subagents
receive anchors, not documents** bullet, which sits under **Retrieval
discipline** — a section headed _(Retrieval Phase A; context packs are Phase C)_.
The amendment's own wording is phase-free, but a reader could take the phase
marker as gating it.

_Recommendation: as drafted._ Stage-to-stage context is the same subject as
orchestrator-to-subagent context, and placing it there is what makes it visibly a
sharpening of an existing rule rather than a new one — which is the honest
description of it. **The alternative if that reads wrong**: fold the paragraph
into Amendment 2 in the orchestrator paragraph and leave the retrieval bullet
untouched. That costs nothing but coherence, and it is a clean swap at sign-off
time.

**Q7 — Does the skill's standing tie-break survive?** SKILL.md:240 — "In doubt
between two tiers, take the stronger — a wasted token is cheaper than a wrong
edit." As drafted it survives untouched and now has an explicit scope:
SHARED-022 already confined it to what the orchestrator picks **for itself**, and
Amendment 1 keeps it there. Under the consequence rule it will fire less often,
because consequence resolves most of the doubt it was compensating for.

_Recommendation: keep it, and let the skill say why it is second._ No spec
change; it is named here so the agent-runtime chain does not delete it as
redundant.

---

## Non-goals (state them so the chain does not drift)

- **Not a change to the dev harness.** Root `CLAUDE.md` and root `.claude/` are
  out of scope by explicit user instruction. This rider governs the product's
  orchestrator, installed by `corpus init`.
- **No model names in SPEC.md.** §7's "model names live in the skill, not here"
  is untouched and is the rule this rider follows. The consequence test names no
  tier.
- **No override of a stated weight.** SHARED-022's "honoured, not weighed again"
  and its either-direction prohibition survive intact. Consequence governs the
  orchestrator's own choice, and against a stated weight its only effect is the
  form that §7 already requires.
- **No mandatory splitting.** Permission, never obligation (Q2).
- **Splitting is not a route around substitution.** Not lighter than asked on a
  deciding stage, and not stronger.
- **No new surface.** No new log file, no new UI, no new composer control, no new
  flag. Amendment 4 makes an existing surface plural and nothing more.
- **No new person-facing control**, so §10 is untouched (Q5).
- **§8 is not edited**, and §6's turn format is not edited.
- **Not a budget, quota, or cost feature.** Nothing counts, caps, reports or
  bills tokens. The saving is a consequence of the rule, never its subject.
- **No retroactive anything.** Work already dispatched is unaffected; nothing
  re-runs at a new weight.
- **Not a risk register.** There is no stored classification of documents by
  consequence, no field, no tag, no score. The test is applied per dispatch and
  its only record is the dispatch line's stated reason.

## Acceptance Criteria

- [ ] User signs off, or answers Q1–Q7 and the text is adjusted
- [ ] All four amendments applied to SPEC.md verbatim at phase kickoff, by the
      orchestrator, with `<DATE>` replaced by the sign-off date
- [ ] **Amendments 1 and 2 are replacements**; the surrounding text — including
      the rest of SHARED-022's applied paragraph, "Delegation changes who does
      the work, never the contract around it:" and its bullet list — is untouched
- [ ] Amendments 3 and 4 **append** and delete nothing
- [ ] **Every anchor is re-read before applying, not pattern-matched.** §7's
      orchestrator paragraph has taken amendments on two consecutive days;
      `_(Rider signed 2026-08-06.)_` occurs four times in SPEC.md and is not an
      anchor
- [ ] **§8, §10 and §6 are not edited**; root `CLAUDE.md` and root `.claude/` are
      not touched
- [ ] The implementing chain does not start before the text is in place

## Technical Design

### Files to Create/Modify

- `SPEC.md` §7 — two replacements (Orchestrator skill paragraph), two appends
  (Retrieval discipline bullet, console bullet)

### Chain this implies (not filed — for `/decompose` after sign-off)

Named so the sign-off is informed. **The behavioural change lives almost entirely
in the skill** — SPEC states the principle, the skill applies it, and this rider
introduces no contract, server or UI work at all.

- **agent-runtime**, `assets/workspace/claude/skills/orchestrate/SKILL.md`:
  - **The weight guidance is re-ordered.** Line 238's "Judge weight by three
    things: how many documents the work touches, whether the request prescribes
    the change or asks for a decision, and the cost of getting it wrong" becomes
    a **two-pass** rule: consequence first, as a test with a `no` answer for most
    work and a **veto** when it answers `yes`; difficulty second, for everything
    the first pass did not settle. Consequence stops being third-of-three.
  - **The table's rows change meaning at the edges.** The Haiku row's "the
    request prescribes the change exactly" acquires the exception that carries
    the user's point: *not when the result is going out or is going to be decided
    on*. The Opus row's "anything where a wrong answer is expensive to unwind"
    moves out of the list of difficulty symptoms and becomes the first pass.
  - **The tie-break stays, scoped** (Q7).
  - **Splitting is written into Delegation** (around SKILL.md:204-227): when to
    consider stages, which stage carries the weight, and — extending "A dispatch
    carries anchors, not documents" — that a stage is handed the previous
    stage's *product*, never its transcript, with the accuracy argument stated,
    not just the saving.
  - **The dispatch log line format covers stages** (SKILL.md:256 already binds
    subagents to the dispatching event's job id, so no new plumbing) — one line
    per stage, each naming weight and provenance.
  - **SKILL.md:300's ad-hoc escalation** ("Opus 5 when step 4 is going to write
    another document") is re-expressed as an instance of the general test, or
    deleted as subsumed.
- **contract / server / ui** — **nothing.** A split is entirely inside the
  agent's dispatch behaviour; the event, the job log and the reply are unchanged.
  If a chain issue proposes a schema or endpoint change for this, it has
  misread the rider.

## Testing Strategy

None — spec text. The agent-runtime issue carries the tests. The notches worth
fixturing when it is filed:

- **Mechanically trivial work with a costly failure** — a one-line prescribed
  edit to a document that is about to go out. Today's rule sends it to the
  lightest tier; the dispatch line must show the strong one **and** name
  consequence as the reason. This is the single test that proves the rider
  landed.
- **The mirror**: heavy-looking work whose failure is ordinary — a large
  in-corpus restructure nobody is waiting on. Difficulty still raises it; the
  point is that consequence did not, and the log's stated reason distinguishes
  the two.
- **The negative case, which must stay negative**: an ordinary reply, an inbox
  capture retitle, a doc edit reflection. Dispatch weight is unchanged from
  today. If the consequence test fires here, it was drawn too wide (Q1).
- **A stated light weight on high-consequence work** — the collision. The work is
  **not** silently upgraded; a **form** is asked first; the console shows the
  stated weight and the ask. Answer the form "proceed anyway" and it runs at the
  stated weight, with no substitution anywhere.
- **A stated strong weight on a splittable request** — the deciding stage runs at
  the stated weight; a collecting stage may run lighter; the log shows both. Then
  the abuse case: a build that ran the *deciding* stage lighter than stated must
  fail this test.
- **A stated light weight on a splittable request** — no stage runs stronger.
  Splitting is not a back door to silent upgrade.
- **Context isolation, observably**: the second stage's brief contains the first
  stage's output and none of its transcript — no search queries, no discarded
  paths, no narration. Testable by asserting on what the dispatch carries.
- **A split job's log**: one job id, one status, one reply, N dispatch lines in
  order, each with weight and provenance. Kill and re-read the console — same
  lines.
- **A split that should not have happened**: entangled work where a stage would
  have to guess. The rule is briefed further, not starved — and splitting was
  never required (Q2).

## E2E Verification Log

_N/A — spec draft._

## Completion Checklist (orchestrator)

- [ ] Sign-off recorded
- [ ] SPEC.md updated (§7 ×4: two replacements, two appends)
- [ ] Committed with `[SHARED-023]` prefix
