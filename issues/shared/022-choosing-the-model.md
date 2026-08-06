# [SHARED-022] Choosing the model for a request

## Domain

shared (orchestrator-owned)

## Status

draft — awaiting user sign-off. **Nothing in SPEC.md has been edited.**

## Priority

P2

## Model

fable

## Dependencies

- Depends on: SHARED-012 ("every composer" as the unit of statement), SHARED-016
  (signed and applied — its Amendment 2 is the sentence Amendment 3 appends
  after, and the composer statement this rider extends)
- Blocks: the agent-runtime chain (the orchestrate skill's routing table becomes
  the thing the picker reads), the contract/server chain (a choice must travel
  from a composer to the dispatch), and the UI chain — none filed
- **Ordering hazard**: Amendment 3 appends at the end of §11's **Smart input
  everywhere** bullet. Any other unsigned rider targeting that bullet must
  **re-read** it before applying rather than pattern-matching the anchor

## Spec References

- **§7 Event queue and agent loop** — the Orchestrator skill paragraph **already
  contains the rule this rider overrides**; the console bullet; job logs
- §8 Agent participation semantics — "a directive, not a hint", and the
  deviation-with-disclosure rule this rider borrows wholesale
- §11 UI — "Smart input everywhere" (composer statements), the global Ask /
  Capture composer, Thread view
- §2.4 Upgrading — workspaces take template changes on their own schedule
- §6 — turn format on disk; forms

---

## The user, verbatim (2026-08-06)

> "The orchestrator is supposed to use the right model for the tool, but I want
> to be able to pick the model I want when sending a message, doing an
> ask/capture request, etc..."

**Read the shape carefully.** The first clause is not preamble — it is a
constraint. The user is not replacing the orchestrator's judgment, they are
asking for an **override on top of it**. So the null state is load-bearing:
**making no choice must keep meaning "the orchestrator decides", never "some
default model"**. A design that turns the absence of a choice into a fixed
default would silently delete the behaviour the user opened the sentence by
endorsing. Every amendment below is written to keep the unset case exactly as it
is today.

---

## Correction to the brief — SPEC.md already specifies this

The task brief states, as a fact to verify: _"SPEC.md says nothing about model
selection. Grep it: there is no rule about which model runs an event, anywhere."_

**That is not correct, and the difference changes the rider's shape.** §7's
**Orchestrator skill** paragraph says, in the shipped spec:

> The **subagent's model scales with the task's weight**: small, mechanical work
> goes to a smaller, faster model; larger or judgment-heavy work to a stronger
> one. The skill states the concrete model-tier guidance (model names live in the
> skill, not here).

Three consequences, and they do most of the work below:

1. **This rider amends an existing rule rather than introducing a new subject.**
   The right form is an override bolted onto that sentence, in the same place,
   which is why Amendment 1 replaces it rather than appending a new paragraph
   elsewhere.
2. **The tier-vs-id question is already answered by a standing sentence.**
   "Model names live in the skill, not here" is current, signed spec text. A
   rider that named Opus/Sonnet/Haiku in SPEC.md would contradict a rule it did
   not set out to touch. That is the strongest argument in Decision 1 — stronger
   than any durability argument I would have made on my own.
3. **The vocabulary already exists**: SPEC speaks in **weight**, the skill maps
   weight → model. A request-time choice expressed in weight plugs into a rule
   already written; a choice expressed in model ids forks a second vocabulary.

The other three facts in the brief check out and are recorded below.

---

## Verified facts

- **The skill already decides, in a table.**
  `assets/workspace/claude/skills/orchestrate/SKILL.md:177` — "**Pick the
  subagent's model by the task's weight** — small, mechanical work goes to a
  smaller, faster model; judgment goes to the strongest", followed by a
  three-row table (Small and mechanical → Haiku; Standard → Sonnet; Heavy or
  judgment-laden → Opus 5) and the tie-break "In doubt between two tiers, take
  the stronger — a wasted token is cheaper than a wrong edit." **This table is
  the behaviour the user is asking to override**, and it is a document (§7,
  "Skills and agent definitions are documents") — editable in the app,
  commentable, agent-stewardable.
- **The job log already records what ran.** Same file, line 484: the
  **dispatched** line names "which skill's subagent took it, **on which model
  tier, and why that tier**", with the worked example `"dispatched to a
  comment-skill subagent (Sonnet — one document, prescribed change)"`. So the
  verification surface exists and this rider leans on it rather than inventing a
  second one.
- **But SPEC does not currently guarantee it.** §7's console bullet says only
  that "a delegated job's log shows its **dispatch**, the subagent's progress
  lines, and the recorded outcome" — the tier is in the skill's instructions,
  not in the spec. An evaluator reading SPEC alone could not fail a build whose
  log omitted it. Amendment 2 closes that gap, and it is the amendment that makes
  the whole feature testable.
- **The job log is runtime state.** §7: `.corpus/jobs/<eventId>.jsonl` is
  "runtime state, gitignored, **reaped with its event**". So it is a live
  verification surface, **not a permanent record** — which is the honest cost of
  leaning on it, and is stated as such in Decision 3.
- **`requestsAgent` is the cautionary precedent.** §8 makes it an instruction
  carried by the request ("an explicit toggle in the composer, which the UI
  translates to the same flag on the POST"), and
  `apps/ui/src/thread/outstandingAgentRequest.ts` records the consequence: "a
  turn on disk is `## <author> · <ts>` and its body (SPEC.md §6) … **That a given
  turn enqueued is recorded nowhere a later reader — a reload, a second tab,
  another column showing the same thread — can find it.**" The module's fix was
  to stop inferring and read the queue, which is exactly the move Decision 3
  makes for the model choice.
- **§8 already owns the deviation grammar this rider needs.** "Targeted
  invocation is a **directive, not a hint**" — the orchestrator "dispatches
  accordingly, **deviating only when the target is missing or archived (and then
  says so in its reply)**." Decisions 4 and 6 borrow this verbatim in shape
  rather than inventing a second escalation rule.
- **Every event is delegated.** SKILL.md:152 — "You never work a job inline — not
  a one-line answer, not a 'quick' edit, **no exception for small work**." So a
  choice that did not reach the subagent would govern nothing (Decision 5).
- **The composer already makes pre-send statements.** §11's Smart input bullet,
  as signed 2026-08-05: "**A composer says who it will reach, before you send**
  … whether sending will ask the agent and which targets it named." The model
  choice belongs beside that sentence, not in a new bullet — and it is only
  meaningful when that statement says the agent will be reached at all.
- **"Every composer, stated once" is the established form** (§11 Thread view):
  "**Every composer takes attachments.** … A comment is a comment wherever it
  starts; which surface it was written in decides nothing about what it can
  carry," and the same construction for snippets. Amendment 3 follows it.
- **§2.4** — workspaces take template updates on their own schedule, and an
  edited skill is **never** overwritten. So a workspace's routing table can
  legitimately differ from the shipped one, indefinitely and on purpose.

---

## The decisions this draft makes, and why

### Decision 1 — Weight, not model ids. And the picker is generated from the skill.

**As drafted, the request-time choice is expressed in the same currency §7
already uses — the work's weight — and the choices offered are the ones the
workspace's orchestrator skill actually defines.** SPEC names no model, exactly
as it names none today.

Three reasons, in descending strength:

1. **SPEC already ruled it.** "Model names live in the skill, not here" is
   standing text in the very paragraph this rider amends. Naming models in SPEC
   would contradict it, and a rider that quietly reverses a signed sentence while
   claiming to add a feature is the worst kind of spec change.
2. **Ids rot, and asymmetrically.** The product ships to workspaces that upgrade
   on their own schedule (§2.4) and runs against whatever Claude Code the person
   installed. A spec naming today's models is wrong within a year in a document
   nobody re-reads, and wrong **per workspace** in a way no single edit fixes.
3. **The skill is a document, so the user still gets literal control** — just
   durably rather than per-message. The weight → model table lives in an editable,
   commentable document (§7). A person who wants "deep means Opus 5" opens the
   skill and says so, once; a person who wants it for one message picks the weight.
   Two controls, each at the granularity it belongs at.

**The honest cost, stated plainly.** The user said "pick **the model** I want",
and this gives them "pick the **weight** I want" plus "edit the table once". If
the workspace's table maps _deep_ to something they did not want, the per-message
picker cannot reach past it — they must edit the skill. That is a real gap
between what was asked and what is drafted, and it is why this is **Q1** rather
than a settled call.

**What makes it more than a rename.** The offered choices are **read from the
skill's own table**, not hardcoded into the UI. So editing the table changes both
the routing *and* the picker, and the two can never disagree — which a
UI-side enum would guarantee they eventually do. It also means a workspace that
renames its levels sees its own names in the composer, and one that adds a fourth
level gets a fourth option with no code change.

### Decision 2 — Every composer, stated once. With one asymmetry named.

Following §11's attachments and snippets precedent, and for the reason SHARED-012
established: per-surface phrasing is how three of five composers ended up without
attachments. The user's "sending a message, doing an ask/capture request, etc..."
plainly means *at least* Ask, Capture and thread replies, and the "etc..." is the
tell that they are not enumerating.

**The asymmetry worth naming, because attachments do not have it.** An attachment
is *content* — it is carried whether or not the agent is asked. A model choice is
an *instruction about work*, so it is inert on a turn that enqueues nothing: a
note-only comment reaches no one, and a model choice on it governs nothing. The
draft handles this by binding the choice to the statement §11 already makes: the
composer that says "sending will ask the agent" is the composer where the choice
is live, and the same composer saying it will not reach the agent shows the choice
as having nothing to act on. This is a presentation rule, not a second trigger
rule — §8 keeps sole ownership of what wakes the agent, and Amendment 3 says so.

**Out of scope, deliberately: the CLI.** `corpus thread reply` and the other
agent-facing verbs are how the *agent* writes, not how the person picks a model
for the agent's own work, and the user was plainly describing the app. Named as a
non-goal so the chain does not quietly add a flag (Q5).

### Decision 3 — Per message, with the composer remembering your last choice. The log is the record.

**Per message, not sticky on the thread.** A sticky per-thread choice is durable
state that outlives its reason — pick _deep_ for one hard question and every
subsequent "thanks, that's right" runs deep, invisibly, forever. That is worse
than the friction it removes, and it is the failure mode the brief names.

**But re-picking every reply is real friction**, so the composer **starts from
the last choice made in that conversation** — browser-local, like collapse state,
reader width and selection (§11's established class of state), and **visible in
the composer before you send**, which is what makes it safe: a starting point you
can see and change in one gesture is a convenience; one you cannot see is sticky
state wearing a disguise. It does not travel to another browser, does not touch
the thread document, and writes no file.

**How a reader tells which model an exchange ran on: the job log, and only the
job log.** This is the `requestsAgent` decision, made deliberately. The choice is
**request-time, not a property of the turn** — the same class — because the
alternative is writing it into the turn on disk, and a turn is `## <author> ·
<ts>` plus body (§6). Putting a model choice there would change the turn format
for every consumer, and would write a runtime routing detail into the corpus's
permanent record — the thing "model names live in the skill" exists to prevent.

**What the user loses, stated rather than glossed.** The job log is gitignored and
**reaped with its event** (§7). So: while the work is live and for as long as the
job survives, the console answers "which model ran this?" precisely. After
reaping, it does not, and **the reply is the only durable trace** — which is why
Decision 4 puts the disclosure in the reply rather than only in the log. If the
user wants a permanent per-turn record, that is a turn-format change and it is
**Q2**, escalated rather than assumed.

### Decision 4 — A choice that cannot be honoured is never silently substituted.

The installed Claude Code may not have the model the workspace's table names; the
setup may refuse it; the level may have been renamed out of the table since the
composer read it. **In every such case the work does not silently run on
something else.**

What happens instead: the agent **does the work** on what it judges best, and
**says so** — in the job log while it runs, and in **its reply**, naming what was
asked for, that it could not be honoured, and what actually ran. Not a footnote in
a surface that gets reaped: the reply is the durable half.

**Why not fail the event.** The person asked a question. The model preference is
about *how* it gets answered, not a precondition of answering, and an app that
returns "I did nothing because your preference was unavailable" has converted a
preference into a blocker. Refusing is defensible only if an explicit choice is
read as binding — **Q3**.

**Why not silently downgrade** — the obvious shortcut: it is precisely the
failure this codebase keeps ruling out, a surface asserting something the system
did not do. The composer said the work would run one way; it ran another; nothing
on screen ever said so. That is the same defect class as the pending indicator
that counted up a wait for a finished job, and as a mention marked live that
summons nobody.

Note the symmetry, which is the part worth defending: **silently running
*stronger* than asked is the same defect as silently running weaker.** It spends
the person's budget against an explicit instruction. The rule is stated as
substitution-in-either-direction, not as downgrade-protection.

### Decision 5 — The choice binds the subagent, because otherwise it binds nothing.

The skill dispatches **every** event to a subagent, with no exception for small
work (SKILL.md:152). An override that governed only the orchestrator's own turn
would govern the claim-dispatch-settle bookkeeping and nothing the person asked
for. So the spec text says the choice governs **the work the request asks for**,
not the turn that receives it — and where that work fans out further, it carries
down with it, since the whole point is that the requested work runs at the chosen
weight.

Stated behaviourally, without naming a payload field: the choice **travels with
the request to whatever actually does the work**. An evaluator tests it by
picking a level and reading the dispatch line in the console (Amendment 2), which
is exactly the surface Amendment 2 exists to guarantee.

### Decision 6 — The agent complies, and may say it disagreed. It never silently upgrades.

This is the real tension, and §8 already resolved its twin. A targeted
`@<subagent>` is "**a directive, not a hint**"; the orchestrator dispatches
accordingly and deviates "only when the target is missing or archived (**and then
says so in its reply**)". A model choice is the same kind of thing — an explicit
routing instruction from the person — so it gets the same grammar rather than a
second, differently-shaped one.

So: **the agent complies.** It does not silently take a stronger model because it
judged the work heavier, and the skill's standing tie-break ("in doubt between two
tiers, take the stronger") governs only what the orchestrator chooses **for
itself**, never what it does with an explicit instruction.

**And it stays honest.** If the work turns out to need more than was asked, the
agent says so in its reply — that it worked at the requested level, and what it
would want in order to do better. The person then decides. For work where getting
it wrong is expensive to unwind, §7's existing rule already gives the right move
without inventing anything: the agent **asks with a form** before proceeding
rather than either burning the budget or quietly disobeying.

This keeps both goods. The user's control is real (compliance is the default and
deviation is never silent), and the agent's honesty is real (it is never required
to pretend a small model was sufficient). What it must not do is act on its
disagreement without saying so — which is the only behaviour that was ever
genuinely in conflict.

---

## Proposed SPEC.md amendments — verbatim, held for sign-off

> **Nothing below has been applied.** All three land at phase kickoff, by the
> orchestrator, after sign-off. Amendment 1 is the only **replacement** in this
> rider; 2 and 3 append and delete nothing.

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
> one. The skill states the concrete model-tier guidance (model names live in the
> skill, not here). **A request may choose the weight, and that choice is a
> directive.** Whoever writes the request may state the weight the work should be
> done at, choosing among the levels the skill itself defines — so the levels
> offered, and what they are called, always match the skill a given workspace is
> actually running, and a workspace that edits its guidance changes both what it
> offers and what it does, together. A stated weight is **honoured, not weighed
> again**: the orchestrator dispatches the work at that weight rather than at the
> one it would have picked, and it never quietly substitutes another — **in
> either direction**, because running stronger than asked spends against an
> explicit instruction exactly as running weaker falls short of one. The choice
> governs **the work the request asks for**, not merely the turn that receives it:
> since every event is delegated, it travels to whatever actually does the work,
> and onward through any further delegation that work requires. **Stating no
> weight means the orchestrator decides**, exactly as it decides today — absence
> of a choice is the judgment above, never a fixed default. When a stated weight
> **cannot be honoured** — the installed agent does not offer that model, the
> setup refuses it, the level no longer exists in the guidance — the work is
> still done, at what the orchestrator judges best, and **the deviation is
> stated**: in the job's log while it runs, and in the reply the request receives,
> naming what was asked for, that it could not be met, and what was done instead.
> Silence there would be the app claiming work it did not do. And the agent's own
> judgment survives as **speech, never as substitution**: where the work proves to
> need more than was asked, it does the work at the stated weight and says so in
> its reply — and where proceeding at that weight would be expensive to unwind, it
> asks first, with a form, as it does for any other decision it needs from the
> person. _(Rider signed <DATE>.)_

### Amendment 2 — §7, APPEND to the console bullet

APPEND immediately after, in §7's console bullet, exactly this existing text
(verified unique):

> **The console stays honest**: a delegated job's log shows its dispatch, the
> subagent's progress lines, and the recorded outcome — the operator watches
> delegated work exactly as inline work.

the following:

> **A dispatch says what weight it went out at, and where that weight came
> from** — whether the request stated it or the orchestrator judged it, and, when
> a stated one could not be honoured, that it was not, and what was used instead.
> This is where "which model answered this?" is answered, and it is answered for
> delegated work of every kind, however the request arrived. It is a **live**
> record and not a permanent one: a job's log is runtime state that is reaped with
> its event (below), so the durable account of a weight that could not be honoured
> is the one the reply carries (§7 above). _(Rider signed <DATE>.)_

### Amendment 3 — §11 "Smart input everywhere", APPEND at the end of the bullet

APPEND immediately after, in §11's **Smart input everywhere** bullet, exactly this
existing text — currently the bullet's last sentence (verified unique):

> The statement never blocks sending, never rewrites what was typed, and claims no
> key of its own: the composer key contract is untouched. _(Rider signed
> 2026-08-05.)_

the following:

> **Every composer can choose how much thought the work gets.** Wherever a request
> to the agent can be written — the global composer's Ask and its Capture, a
> thread's reply box, a comment on a document selection, a comment on a turn or on
> a selection within one, and any composer a plugin contributes — the weight the
> work should be done at can be chosen before sending, from the levels the
> workspace's own agent guidance defines (§7), named as that guidance names them.
> A request is a request wherever it starts; which surface it was written in
> decides nothing about whether it can say this. **Choosing nothing is the
> ordinary case and means the agent decides** — the control has no preselected
> level, and a composer that has never been touched behaves exactly as it does
> today. A choice applies to **the one request being sent**; the composer then
> **starts from that choice the next time you write in the same conversation**, as
> a visible starting point that can be changed in one gesture, never as a setting
> that acts on you unseen — it is browser-local like the reader's width and a
> conversation's collapse state, is written to no document, and does not follow
> you to another browser. The choice **rides with the request to whatever does the
> work** (§7), so what is picked here is what runs, and **the console's dispatch
> line is where a reader afterwards sees what actually ran** (§7). Because a
> choice about how work is done governs nothing when no work is asked for, it is
> live exactly when this composer says sending **will** reach the agent, and shows
> as having nothing to act on when it says it will not — a presentation rule only:
> §8 alone decides what reaches the agent, and choosing a weight neither asks the
> agent nor stops it being asked. The control never blocks sending, never rewrites
> what was typed, and claims **no key of its own**: the composer key contract is
> untouched. _(Rider signed <DATE>.)_

---

## Open questions for sign-off

**Q1 — Weight levels, or actual model names?** _(The one the user is most likely
to overturn, because it is the gap between what was asked and what is drafted.)_
As drafted, a request picks among the **levels the workspace's agent guidance
defines**, and SPEC names no model — because §7 already says "model names live in
the skill, not here", because ids rot per-workspace under §2.4, and because the
guidance is an editable document, so literal control exists at the durable
granularity. The cost is real: the user said "pick the model", and if the
workspace's table maps a level to something they did not want, the per-message
control cannot reach past it — they must edit the guidance.

_Recommendation: levels, as drafted._ It gives the user everything they asked for
in two moves instead of one, and neither move is hidden: the composer picks the
level, the guidance document defines what a level means, and the two can never
disagree because the composer reads the guidance. **If this is overturned**, the
version to take is not "SPEC lists model names" — that contradicts a signed
sentence — but "the guidance may define a level as a specific model, and the
composer therefore shows model names when the workspace has written them that
way". That is a change to the *guidance document*, not to SPEC, which is a
one-line answer instead of an amendment.

**Q2 — Should the chosen weight be durable on the turn?** As drafted it is not:
it is request-time like `requestsAgent`, the console's dispatch line is the
record, and that record is reaped with its job. So months later, "which model
answered this?" is unanswerable unless the weight could not be honoured, in which
case the reply says so permanently.

_Recommendation: leave it request-time, as drafted._ Making it durable means
changing what a turn is on disk (§6: author, timestamp, body), which touches every
consumer of the format and writes a routing detail into the corpus's permanent
record. **If the user wants durability anyway**, the cheap version that avoids the
format change is to have the agent's reply state the weight it worked at whenever
one was explicitly chosen — one sentence in the comment skill, permanent because
replies are, no spec surgery. I would take that over a frontmatter field.

**Q3 — Is an unhonourable choice a reason to refuse the work?** As drafted, no:
the work is done and the deviation is stated. The alternative reads an explicit
choice as binding — if you cannot run it as I asked, do not run it — which is
coherent, and is what a person watching cost would want.

_Recommendation: do the work and say so, as drafted._ A preference converted into
a blocker turns a question into silence, and the person may well have wanted the
answer more than the level. **If overturned**, the honest form is not a silent
no-op but a **failed** event whose reason names the unavailable level — visible in
the console and in Attention like any other failure — never a request that quietly
evaporates.

**Q4 — Should the choice be visible on the sent turn, in the thread?** Not
drafted. The composer shows it before sending; afterwards only the console does.
An in-thread marker ("asked at deep") would be the most legible answer to "which
model ran this exchange" and is nearly free visually.

_Recommendation: not in v1, and note it is Q2 wearing different clothes_ — a
marker on a rendered turn needs a durable source, and there isn't one until Q2 is
answered yes. Worth revisiting immediately if Q2 is overturned; worth nothing
before.

**Q5 — Do the CLI's writing verbs get this too?** Not drafted — the CLI is how the
**agent** writes, and the user was describing the app. But a person does post from
the CLI, and a person scripting a batch of captures has an obvious reason to want
the level on the command line.

_Recommendation: leave it out of this rider, and file it separately if wanted._
It is additive, it changes nothing here, and folding it in now would widen the
sign-off surface for a use the user did not raise.

**Q6 — May a workspace's guidance define levels the composer should not offer?**
As drafted, the composer offers what the guidance defines, whole. A workspace with
an internal-only or experimental level would surface it to the person.

_Recommendation: offer all of them, as drafted._ A second concept ("levels, but
some are hidden") buys very little and is exactly the sort of divergence that ends
with the picker and the router disagreeing — the failure the generated-from-
guidance design exists to prevent. If a level should not be picked, the answer is
that it should not be in the guidance.

---

## Non-goals (state them so the chain does not drift)

- **Not a change to what wakes the agent.** §8 owns that entirely. Choosing a
  weight neither asks the agent nor prevents it being asked, and this rider must
  be implementable without altering one triggering behaviour.
- **No model names in SPEC.md.** §7's "model names live in the skill, not here"
  is untouched and is the rule this rider follows (Q1).
- **No default model.** Unset means the orchestrator decides, exactly as today.
  Any implementation that preselects a level for a person who has never chosen one
  has broken the feature's premise.
- **No silent substitution, in either direction.** Not a weaker model, and not a
  stronger one.
- **No new turn format.** Nothing here adds a field to a turn on disk (Q2).
- **No new key binding.** §11's composer key contract is untouched; the control
  claims no key.
- **No CLI flag** (Q5).
- **Not a budget, quota, or cost feature.** Nothing here counts, caps, reports, or
  bills tokens. A person choosing a level is expressing how much thought the work
  deserves, not managing a budget.
- **No retroactive anything.** Work already dispatched is unaffected; nothing
  re-runs at a new level, and past turns gain no marker.
- **Not a per-workspace setting panel.** There is no settings surface here — the
  durable half of the control is editing the agent guidance document, which is
  how every other agent behaviour is configured (§7).

## Acceptance Criteria

- [ ] User signs off, or answers Q1–Q6 and the text is adjusted
- [ ] All three amendments applied to SPEC.md verbatim at phase kickoff, by the
      orchestrator, with `<DATE>` replaced by the sign-off date
- [ ] **Amendment 1 is a replacement** — the two quoted sentences are replaced,
      and the paragraph's following sentence ("Delegation changes who does the
      work, never the contract around it:") and its bullet list are left untouched
- [ ] Amendments 2 and 3 **append** and delete nothing
- [ ] **Amendment 3's anchor is re-read, not pattern-matched** — any other
      unsigned rider targeting §11's Smart input bullet may have landed first
- [ ] **§8 is not edited**, and §6's turn format is not edited
- [ ] The implementing chain does not start before the text is in place
- [ ] Before the agent-runtime issue is filed, the orchestrate skill's weight
      table is confirmed to be the single source the composer's offered levels are
      read from — not a second list that happens to agree today

## Technical Design

### Files to Create/Modify

- `SPEC.md` §7 (one replacement, one append) and §11 (one append)

### Chain this implies (not filed — for `/decompose` after sign-off)

Named only so the sign-off is informed about what it commits to; none of this
belongs in the spec text.

- **agent-runtime** — the orchestrate skill's weight table becomes a declared,
  readable set rather than prose-plus-table, since the composer's offered levels
  are read from it; plus the honour/deviate/disclose rules and the "say so, never
  substitute" rule in the skill's own voice
- **contract + server** — a chosen level travels from a post to the queue event and
  into the dispatch; a way for a composer to learn what levels this workspace
  defines
- **ui** — the control in every composer, its unset default, its per-conversation
  starting point, and its coupling to the existing "who will this reach" statement

## Testing Strategy

None — spec text. The domain issues carry the tests. The notches worth fixturing
when they are filed:

- a request sent with **no** choice — the dispatch line reads exactly as it does
  today, showing an orchestrator-judged weight, and nothing in any composer was
  preselected
- a request sent at an explicitly **low** level for work the agent would have
  judged heavy — the dispatch line names the low level **and** that the request
  stated it; the work runs there; the reply may argue, and the console shows no
  upgrade
- the mirror case: an explicitly **high** level for trivial work — no downgrade,
  same disclosure
- a level the installed agent cannot provide — the work still completes, the
  dispatch line records that the stated level was not honoured and what ran, and
  **the reply says so too**; killing and re-reading the console does not change
  either statement
- a level chosen, then the workspace's guidance edited to remove it, then send —
  the unhonourable path above, not a crash and not a silent fallback
- editing the guidance to rename a level — the composer offers the new name
  without a code change, and the dispatch line uses it
- pick a level, send, then reply again in the same conversation — the composer
  starts from the previous choice, visibly; reload, and the conversation's
  starting point is gone (browser-local) while the *sent* requests' dispatch lines
  are unchanged
- pick a level in a **second browser** — the first browser's conversation
  starting point is unaffected
- a **note-only** turn with a level chosen — nothing enqueues, no job, no dispatch
  line, and the composer said so before sending
- Ask **and** Capture from the global composer, a thread reply, a comment on a
  document selection, and a comment on a turn — all five offer the control
  (SHARED-012's lesson: enumerate the composers in the test, not just in the spec)
- a fan-out: an event whose work delegates further — every level of the fan-out
  runs at the chosen weight, visible in the one job's log

## E2E Verification Log

_N/A — spec draft._

## Completion Checklist (orchestrator)

- [ ] Sign-off recorded
- [ ] SPEC.md updated (§7 ×2, §11 ×1)
- [ ] Committed with `[SHARED-022]` prefix
