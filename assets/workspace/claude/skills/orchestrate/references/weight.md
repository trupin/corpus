# Weighing a dispatch — the litigation

The orchestrate skill's body carries the instruction and the tier table: judge the weight
in two passes, consequence first, difficulty second, and pass the picked row's **Model** as
the launch call's `model` argument. This file carries the cases that fire rarely and the
reasoning that earned the rules. Read it where a dispatch is not the ordinary shape: a
stated weight lighter than the first pass calls for, a weight that cannot be honoured, a
request worth splitting into stages, or an edit to the table itself. An ordinary judged
dispatch needs only the body.

## The first pass, in full

**First pass — ask that question, and expect it to answer no.** Exactly two things make a
failure that kind:

- The output exists **to be used outside the corpus** — published, sent, handed to someone.
  A bad one there is not quietly corrected, it is rejected: the work is wasted and the thing
  the person wanted does not happen.
- **Someone will decide something real on it** — about a person, about money, about a
  commitment. The harm is carried by the decision rather than by the document, and amending
  the document afterwards does not unmake it.

Neither is the ordinary case, and that is the point. An ordinary reply, an inbox capture
retitled and filed, a reflection on a user's edit, a figure corrected in a note nobody is
waiting on — every one of those answers **no**, and answering no is what makes this pass
worth running. A wrong document that stays in the corpus is noticed, commented on and
revised, which is this system working as designed rather than a reason to reach for a
stronger model. A first pass that fired on everything would change no dispatch at all.

**Where one of the two holds, dispatch the strongest tier however mechanical the work
looks, and stop there — the second pass does not run.** A one-line edit spelled out word
for word, on a document that goes to the lender tomorrow, is not small work: the edit is
trivial and the failure is not, and it is the failure that picks the model. The dispatch
line names `consequence` in so many words, so the console says why a trivial-looking job
went out strong.


## A resident is outside the never-inline rule's subject

**That rule is about this lane, and a resident is outside its subject rather than an exception
to it.** The reason you delegate is that you are the queue's general path: a session buried in
one job is closed to every other conversation in the workspace. A resident is not that path.
It holds one lane, and every other lane — yours included — keeps moving while it works, so it
answers its conversation in the session that has been sitting in that conversation, which is
the entire point of designating one. Do not read its inline work as a shortcut you are also
allowed, and do not "correct" it into a dispatch: on your lane the rule has no exceptions, and
on its lane it never applied.

## What the table's columns reach

**That table is the set a request may choose from, so it is read by more than you.** A
composer in the app reads this document and offers these rows as the weights a person can
state, in the order they are written — lightest first — labelled with the **Weight** cell.
Editing the table therefore changes what is offered and what you dispatch at together, and
there is no second list anywhere that could disagree with it. The table is found by its
header cells — `Weight`, `Key`, `Model`, `What falls here`, in that order and spelled that
way, whatever the column padding — and each row below the divider is one level:

- **Weight** is the name a person sees and picks by. Reword it and the composer's wording
  follows on its own; no other file names these levels.
- **Key** is the short token that travels with the request. It is what a stated weight
  arrives as, and rewording a **Weight** leaves it untouched, so a choice made yesterday
  still resolves today. Keep it one lowercase word.
- **Model** is what you launch the subagent at — the value the launch call's `model`
  argument carries, as the skill body's Delegation spells it — and it is the whole vocabulary a
  turn's `--model` may record: the turn-writing verbs refuse a spelling this column does not
  hold, so what a turn attributes and what this table launches cannot drift apart. **What
  falls here** is guidance for you. Neither reaches a composer.

Nothing outside this table declares a level. A reader that cannot find those header cells,
or a row whose **Weight** or **Key** cell is empty, finds **no levels** — and a composer that
finds no levels offers no control at all rather than a list of its own. That is the correct
outcome rather than a fault: a workspace whose guidance declares nothing has a person who
states nothing, which is the ordinary case below.

## A stated weight, litigated

**A stated weight is a directive; the two passes govern only what you pick when the request
stated nothing.** A stated weight reaches you as the `weight` field of the claimed event's
payload, carrying one of the tier table's **Key** tokens, and it is **honoured, not weighed again**:
dispatch at that weight rather than at the one you would have picked, and never
quietly substitute another **in either direction** — never quietly weaker, never quietly
stronger, because running stronger than asked spends
against an explicit instruction exactly as running weaker falls short of one.

**The choice travels with the work, not with the turn that received it.** Every event is
delegated, so a stated weight goes into the dispatch prompt in words and governs whatever
actually does the work — and onward through every further delegation that work requires,
including the stages below, whose deciding stage runs at it. Where the payload also names an
`@<subagent>`, both are directives and they compose: that persona runs, at that weight.

**A designation's weight reaches the resident's own turns and stops there.** Somebody chose it
for one conversation, and it is stated on no event, so nothing carries it into work that
resident hands off. **A hand-off no message stated a weight for is judged from this table, in
the two passes above, exactly as you judge one** — by the resident, on its own lane, under the
rules this section binds you with.

**Stating no weight means you decide, exactly as you decide today.** The absence of a
`weight` field is the two passes and never a fixed default: there is no level you fall back
to, and a request that stated nothing is dispatched exactly as every request was before this
table declared a key at all. Absence is the ordinary case, and it is the only spelling of it.
All of that is about a job. A **designation** that stated no weight is also you deciding,
and the two passes are never how: a listener is judged on the conversation it will hold, by
the judgment `references/launching.md` states where it owns the launch.

That directive binds even where the first pass above disagrees with it. Where a request states a
weight lighter than the first pass calls for, do not override it: the two
conditions above are precisely what makes proceeding expensive to unwind, so **ask first,
with a form**. Post that ask on the waiting thread yourself — asking is not the work, the
same way the one-line reply before a deferral is not — say what the output is going out to
do and what you would otherwise have run it at, log it, and complete the event; the answer
comes back as its own `form.respond` event and the work is dispatched then. An answer of
*proceed anyway* runs it at the stated weight, with no substitution anywhere. **Asking is
not substituting.**

```bash
corpus job log evt_7c1d9a "asked before dispatching — the request states the lightest tier and the revised paragraph goes to the lender tomorrow"
```

**When a stated weight cannot be honoured, the work is still done and the deviation is stated
twice.** Three things cause that: the installed agent offers no such model, the setup refuses
it, or the key names a level this table no longer declares. The first two now have one shape —
the launch call's `model` argument comes back refused — so *launch anyway* means make the
call again with the value your own judgment picks, not proceed without one.
None of the three is a reason to drop the work or to fail the event. Dispatch at what the
two passes judge best, and state the
deviation **in the job's log while it runs** and **in the reply the request receives** — both
naming the same three things: what was asked for, that it could not be met, and what ran
instead. **The third statement names the level the work actually ran at, as a level this
workspace's table declares — in the log and in the reply alike.** It is the statement that
gets dropped, because the first two are already in hand when the refusal happens — the ask
is in the payload and the refusal just occurred — while the third exists only if you write
it, and a deviation without it states what was refused and never what was done. The model
name alone does not carry it either: levels are what a request chooses from, so the level is
the word a reader can hold against the tier table.
The log is reaped with its event, so the reply is the durable half: the dispatch prompt
carries the deviation in words, and the subagent states it in the reply it posts, as
plainly as "you asked for the lightest tier,
this workspace no longer declares it, so I ran this at Standard" — the substitute named
there as **Standard**, a level the table declares. Silence there would be this workspace
claiming work it did not do. The skill body's *Progress and job
logs* gives the dispatch line for this case.

**Your own judgment survives as speech, never as substitution.** Where the work proves to
need more than was asked for, do it at the stated weight and say so in the reply — name what
you would have run it at and what you think that cost, and leave the decision with the
person. The one case that is not speech is the one above: where proceeding at the stated
weight would be expensive to unwind, ask before dispatching rather than explain afterwards.
Disagreeing in a reply is honest; disagreeing by dispatching something else is not, because
nothing in the console and nothing on the turn would show that it happened.

## Stages

**One request may be worked in stages, and the stages need not run at the same weight.**
Collecting the material is one stage — retrieved text, a listing, a mechanical
transformation, a small script and what it printed — and judging that material and drawing
the conclusion is another. A stage whose output is **material** may run lighter than the
request calls for. A stage that **decides** may not: a conclusion, a recommendation, the
wording of a reply, an edit to a document. Those are the work the request asked for, they
carry the consequence the first pass measured, and they run at the **governing weight** —
the stated one where a weight was stated, the judged one otherwise.

The line is drawn at what a stage **outputs**, and it is drawn there deliberately: anything
can be described as preparation, and a dispatcher optimising for cost will describe more
and more of the work that way until the conclusion itself is "just summarising what the
collector found". Where a stage's output is what the person will read, act on, or find in a
document, that stage decides.

**Splitting is always permitted and never required.** There is no threshold above which you
split: a split introduces a handoff, handoffs lose things, and for entangled work one
strong pass beats two stages with a summary between them. What is obligatory is everything
around a split once you make one — which stage carries the weight, what each stage is
handed, a dispatch line per stage in the job log, and that one request stays **one piece of
work with one status and one reply**, whatever it took internally. Splitting is never a
route around a stated weight either: the deciding stage runs neither lighter nor stronger
than the request asked for.

**The anchors rule above holds between the stages of one piece of work too.** A stage
receives what the previous stage **produced** — the gathered material, the numbers, the
script's output, the answer — and never the account of how it was produced: not the
transcript, not the false starts, not the searches that came back empty, not the reasoning
that got there. Brief every stage as though it were the first. This is a **quality** rule
before it is a saving: a stage that has to judge does so better on a short relevant input
than on a long one carrying everything an earlier stage happened to look at, so isolating
the stages is expected to hold or improve the answer while costing less — which is what
makes a split worth making rather than merely tolerable. Where the two pull apart, quality
decides: material a later stage genuinely needs is passed on, and a stage that would
otherwise have to guess is briefed further rather than left short.

## The model stamp on a turn, in full

**Every turn an agent posts names the model that wrote it** — `--model <name>` on
`corpus thread reply` and on `corpus thread create`, naming what actually ran. That is why
the dispatch states the model you launched it at: the subagent has the word in hand and
quotes it back, and where its runtime says a different row ran, the row that ran goes on
the turn and the difference goes in this event's job log. The value is a **Model** cell of
the tier table and nothing else — the CLI refuses every other spelling before
anything is posted, so a stamp composed from a subagent's self-image, however plausible
its shape, never lands. It is a **record of what ran, never a
request for what should run** — a weight the request stated is a directive you honour rather
than weigh again, and this turn is the evidence that you did, which it cannot be if it merely
repeats what was asked for. Where the work ran in stages, the turn names the **deciding**
stage — the one that drew the conclusion or wrote the words — one model and never a list;
the gathering stages stay in the job log. Where nothing knows what ran, the flag is left out
and the turn shows nothing rather than a guess. A turn you post yourself had no dispatch to
hand you a word: take the row whose **Model** cell names what your own runtime tells you
that you are, and where no row does, leave the flag out — that turn honestly shows nothing.
The comment skill states the grammar, and it
governs every turn you post yourself exactly as it governs a subagent's.

## The dispatch line, in full

The skill body's *Progress and job logs* carries the four shapes and the binding
rules; this is the whole account of why the line is written that way.

**dispatched** — which skill's subagent took it, the tier it went out at, and **where that
tier came from**: `judged, difficulty` for the second pass, `judged, consequence` for the
first, `stated by the request` where the request chose, and `stated by the request … not
honoured` where it chose something you could not give it. Four shapes, one grammar:
`corpus job log evt_7c1d9a "dispatched to a comment-skill subagent (Sonnet — judged, difficulty: one document, prescribed change)"`,
`corpus job log evt_4f8a2b "dispatched to a comment-skill subagent (Opus 5 — judged, consequence: the revised paragraph goes to the lender tomorrow)"`,
`corpus job log evt_9c3b1d "dispatched to a comment-skill subagent (Haiku — stated by the request)"`,
`corpus job log evt_2e4f8b "dispatched to a comment-skill subagent (Sonnet — stated by the request as heavy, not honoured: this workspace declares no such level, so it ran at standard, judged, difficulty)"`.
The fourth names the ask, that it went unmet, and what ran instead — the three things the
reply carries too, because the log is reaped and the reply is not. **`ran at standard` is
the third of those, and the line is not written until it holds a level.** Name the level
the substitute went out at by the **Key** cell of the tier-table row your judgment picked —
a word the table declares, which is what a reader can check, since the levels are what the
request chose from. The model name opening the line does not stand in for it, and neither
does the provenance after it: a line that ends at `judged, difficulty` says where the
substitute came from and never what it was, which drops exactly the statement the person
cannot reconstruct. It is also the one shape
a reader can check rather than take on trust: the server has already written
`weight stated by the request: <key>` onto this same log, before any line of yours, so what
was asked and what you dispatched sit side by side and a claim of honouring is verifiable.
Difficulty and consequence are named apart because they answer different questions for the
operator: a large in-corpus restructure nobody is waiting on went out strong on difficulty,
while a one-line edit to a document about to go out went out strong on consequence. A line
that said only "Opus 5" would leave those two indistinguishable.
**This log is the per-stage account.** Where the work ran in stages, each stage gets **its
own dispatch line, in the order the stages ran**, each naming its tier and where that tier
came from — so the log shows the collecting running light and the judging running at the
governing weight, rather than one line accounting for part of what happened. It is still
one job, one status and one reply; the turn itself names only the
deciding stage, so the log is the only place the whole split is written down — and it lasts
only as long as the event does, which is why the turn carries the one name that matters.
