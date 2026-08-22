# [SHARED-018] Anything collapses, anywhere — on demand and by rule

## Domain

shared (orchestrator-owned)

## Status

done — signed by the user 2026-08-05; amendments applied to SPEC.md.
**UI-077** already exists and is the by-rule half — it is explicitly held
("do not ship this alone") until this text is signed. The implementing chain does
not start before the text is in place — the same rule SHARED-012, SHARED-013,
SHARED-014, SHARED-016 and SHARED-017 are held to.

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Related: **SHARED-019** (the agent resolves settled threads) — the other half of
  "let me focus on what's important". They are **separable and must stay so**:
  018 changes what a reader sees, 019 changes what the agent may write. Sign
  either alone. If **both** are signed, one interlock binds them and it lives in
  **this** file (the unread override, below), because this is where the collapse
  rules are.
- Blocks: **UI-077** (the by-rule half, already filed, already widened, already
  pointing here); the on-demand half needs its own UI issue, not yet filed.
- Consistency constraint with: **SHARED-010** (signed, applied — the comments
  list) and **SHARED-014** (drafted, unsigned — snippet collapse). Both are
  addressed below.

## Spec References

- §6 Threads and anchors — the thread frontmatter table (`status`), recursion
  (child threads), standalone threads
- §7 Event queue and agent loop — **Read state** ("what counts as read: displayed
  content only… opening the thread, expanding its collapsed chip")
- §10 UI — Document view (adaptive thread placement, the comments list), Thread
  view (the fence clipping vocabulary this reuses; child threads per-turn),
  Keyboard scheme

---

## The user, verbatim (2026-08-05), two messages

> "I also want resolve threads to be collapsed by default, so I can focus on open
> threads instead"

> "Right now, only the full screen allows to collapse comments / threads, but I
> want to be able to collapse any comment / thread, wherever they are (within
> other threads, documents in full screen, or document in columns). Just make it
> cohesive. Remember that the goal is for me to be able to focus on what's
> important. So anything should be able to collapse both on-demand, and also
> following certain rules (e.g. resolved threads / comments are collapsed by
> default)."

---

## What already exists — verified 2026-08-05, not assumed

### The by-rule half is already promised, and this rider does not re-promise it

`SPEC.md` §6's thread frontmatter table reads, verbatim:

```
status: open              # open | resolved; resolved threads collapse in the doc view
```

Nothing implements it. `corpus thread resolve`'s own help text repeats the
promise ("The thread collapses in the document view"), so the claim is made in
two places and kept in none. It is filed as **UI-077**, correctly, as a **bug**.

**This rider covers the on-demand half, which SPEC does not describe at all**,
plus the composition rules the two halves need in order to agree. It amends the
§6 comment only to retarget it — the promise itself is UI-077's to keep.

_(Note for the orchestrator: UI-077's Spec References cite "§5, the thread
frontmatter table". The table is in **§6**. Worth correcting when UI-077 is next
touched — it is a citation error, not a substantive one.)_

### Exactly one reversible collapse of a thread exists today

There is one, and only one: the **chip ⇄ card** in the below-body / at-anchor
placement. The chip reads `💬 {turns} · {last author}[ · resolved]` with an
`unread` badge; the expanded card carries a `–` control labelled "Collapse
thread". The card is **unmounted** while collapsed rather than hidden, which is
how §7's read-state rule stays true — a collapsed chip has displayed nothing and
so never counts as read.

**Every other placement has no collapse at all:**

| Placement                                    | Collapse today                                                  |
| -------------------------------------------- | --------------------------------------------------------------- |
| Margin card (focus mode; wide reader ≥1100px) | **None.** The margin never even receives the expansion state.     |
| Chip at the anchor (narrow column)            | Yes — the one that exists.                                        |
| Below the body (whole-document / detached)    | Yes — same chip.                                                  |
| A `type: thread` document open in a reader    | **None.**                                                         |
| A child thread nested under a turn            | **None**, at any depth.                                           |
| An individual turn                            | **None**, anywhere.                                               |

**One correction to the report, which strengthens rather than weakens it.** The
user wrote "only the full screen allows to collapse". Verified, it is the
opposite way round: focus mode and wide readers place threads as margin cards,
which have **no** collapse; the collapse that exists is the narrow-column /
below-body chip. Either way the finding is the same and it is the actual defect —
**whether a conversation can be folded away depends on how wide the window
happens to be**, which is exactly the incoherence the user is reporting. The
implementing agent should confirm the direction against the running app before
writing tests, and should not assume the report's wording.

### There is one collapse today that cannot be undone in place

A child thread nested deeper than four levels is not rendered as a card at all:
it becomes a chip that **navigates away** to open the thread. That is a collapse
with no expander — the only way back is losing your place. Turns that deep also
lose their "comment on this turn" affordance. This rider's "collapsed means
reachable" clause is what forces that to become an in-place expander.

### The product already has a collapse vocabulary, and this reuses it

§10's fence clipping — "a block taller than a threshold renders **clipped** behind
a control that expands it and says how much is hidden" — is implemented with a
control reading **"Show all 60 lines"** / **"Show less"**, and its own code
comments state why it names the **whole** size rather than a remainder: "the
difference between a collapse and a truncation". That is the right instinct and
this rider adopts it: **a collapsed thing states its whole size, not what is
left over.** For a thread that size is its turn count — which the existing chip
label already carries.

The console drawer is the other precedent: collapsed to a one-line strip that
still reports what is inside (queue depth, job counts), body unmounted while
collapsed, and its state persisted in browser-local storage. Same shape.

### Nothing else in the app collapses

Backlinks and related panels are always fully rendered; there is no
section-level fold anywhere; console job entries do not collapse individually.
Named so the chain does not read "anything" as "every panel in the app" — see
Non-goals.

---

## What this rider is for

The user gave the reason and it is the whole design constraint: **"the goal is
for me to be able to focus on what's important."**

That makes this a signal-to-noise feature, not a density feature. A document
worked over for a month carries mostly *settled* conversation, so the margin is
at its least useful exactly when it is at its fullest, and the one open thread —
the only one that needs anything — is the hardest thing on the page to find. The
by-rule half fixes the common case without anyone doing anything. The on-demand
half is what makes the rule survivable: a reader who disagrees with the rule, or
who wants a long live conversation out of the way while they read the paragraph
under it, must not be stuck.

**Cohesion is a stated requirement**, and it is the reason this is one rider and
not three. Today's collapse is one behaviour in one placement; adding a second,
differently-worded one per surface is the failure UI-063 and UI-067 were
sequenced to avoid. There is one collapse concept in this product, it says the
same thing everywhere, and it reads the same as the fence's.

---

## The decisions this draft makes, and why

**Collapsed means small, never gone — and this is the load-bearing clause.** A
resolved conversation is part of the document's record; a rule that removed it
would be a worse bug than the one being fixed, and it would break the anchor
under it. So the draft fixes what a collapsed thread must still say: that it
exists, what it is about, who last spoke, how much is inside, and whether it
holds anything unread. That is not an invention — it is the current chip label
(`💬 3 · agent · resolved` + `unread`) promoted to a rule. And the anchored
highlight stays in the body: the passage keeps saying it has been discussed,
which is the only route back to a conversation whose card is folded.

**Nothing about collapse is ever written to disk.** Every write in this product
goes through the server and auto-commits (§4, §7). A collapse is a reading
posture, so persisting it in the thread or the document would mean **reading a
document produces git commits** — plainly wrong, and it would make one person's
focus another browser's surprise. §10 already draws this line: "Only browser-local
state stays local: scroll positions, open readers, and per-reader navigation
stacks", and the console's expanded state and the reader's chosen width are
already sticky-but-local. A collapse belongs in exactly that set.

**Sticky, not transient.** Today the expansion state is in-memory and is reset to
empty on **every** document change — navigate away and back and everything you
opened is closed again. That is the wrong half of the tradeoff for a feature
whose purpose is focus: a reader who folds four settled threads to read a
paragraph should not have to fold them again after following one `[[ref]]`. So
the draft makes a manual collapse survive reload and navigation, the way §10
already says the reader's width and the console's height do. Per reader: two
columns showing the same document are two readers with their own navigation
stacks, and they may disagree.

**Precedence is "the last thing that happened wins", stated as two rules.** The
rule sets the state a thread is *placed* in. A reader's own act overrides the
rule and sticks. A change to the thread's **status** re-asserts the rule and
clears the override — because the status changing is newer information than a
gesture made before it, and because UI-077 already requires exactly this
("resolving a thread while it is open on screen collapses it… the state follows
the document, not a local toggle"). **Reading never collapses anything**: the
rule is re-evaluated when the thread is placed and when its status changes, never
when it is read, so nothing folds itself away under the eyes of the person
reading it.

**Unread outranks the rule, and this is the safety interlock.** A thread carrying
a turn nobody has seen is **never collapsed by rule**. This is not a courtesy: §7
already says a collapsed chip "has displayed nothing" and therefore never counts
as read, so a resolved-and-collapsed unread thread would stay unread forever with
nothing ever prompting anyone to open it. The rule would be a mechanism for
losing messages. It is also, and only incidentally, what makes **SHARED-019**
safe — an agent that resolves a thread always leaves its closing reply unread, so
the conversation stays expanded until the person has actually seen it. Note the
asymmetry, which is deliberate: unread beats the **rule**, not the reader. A
person may always fold an unread thread by hand; being told what they may not
hide is not focus.

**One rule, and the set is closed.** The user wrote "certain rules (e.g.
resolved…)", which invites a rules engine, and a rules engine is the wrong answer
to a focus problem — every additional rule is another thing that makes a
conversation vanish for a reason the reader has to reconstruct. So the spec names
**exactly one** rule, says the set is closed, and says a new one takes a spec
change. Depth was the obvious second candidate and it is handled better as a
consequence of "collapsed means reachable" (the depth-4 chip becomes an in-place
expander) than as a rule of its own. See Q3.

**Threads collapse; turns do not.** §6's own vocabulary settles this: "A
**comment** on a document creates a thread" — a comment *is* a thread, so
"any comment / thread" is one category, not two. Collapsing individual turns
would turn a conversation into a nest of accordions, and the bulk inside a long
turn is already handled by the fence clipping and (if signed) SHARED-014's
snippets. See Q2.

**The comments list keeps its own job.** SHARED-010's Document/Comments switch is
a **directory** of every thread on the document with explicit open/resolved and
anchored/unanchored filters. It already answers "hide the settled ones" by
filtering, which is a better answer than a rule in a list. So the by-rule default
does **not** apply there; the on-demand collapse does, like everywhere. Neither
surface becomes redundant: the list answers "what conversations exist on this
document", the margin answers "what is being said about *this passage*".

**No new key.** §10's keyboard scheme is a fixed published list with a
cheat-sheet, and this adds nothing to it. The affordance is an ordinary focusable
control, and it joins each item's right-click menu for free — §10 already binds
that menu to "exactly that item's existing actions". The existing `r` binding
(focus the reply composer), which today works by expanding the first collapsed
chip, must keep working.

---

## The interlock with SHARED-019

**Read this section in both files.** SHARED-019 lets the agent resolve
conversations it asked for and got. This rider makes resolved threads collapse.
Composed naively, the agent would gain the ability to make a conversation fold
itself away — the one outcome neither rider wants.

The interlock is the **unread override** above, and it lives here because this is
where the collapse rules are. It is load-bearing for this rider on its own (see
the §7 read-state argument) and merely *also* what makes 019 safe.

- **This signed, 019 not** — the override still belongs here, unchanged.
- **019 signed, this not** — nothing collapses, the override is inert, and the
  agent's reply still surfaces in Attention as an unread agent reply. Same
  guarantee by another route.

---

## Proposed SPEC.md amendments — verbatim, for sign-off

### Amendment 1 — §6, REPLACE the `status` comment in the thread frontmatter block

REPLACE, in **§6 Threads and anchors**, inside the thread frontmatter example,
exactly this existing line (the only line in SPEC.md containing "resolved threads
collapse"):

```
status: open              # open | resolved; resolved threads collapse in the doc view
```

with:

```
status: open              # open | resolved; a resolved thread is collapsed by default wherever it is shown (§10)
```

_(This is a retarget, not a new promise: the behaviour was already promised here
and is unimplemented — filed as UI-077. The change is that it no longer reads as
a property of one surface.)_

### Amendment 2 — §10 Document view, REPLACE the adaptive-placement sentence

REPLACE, in §10's **Document view — always editable, Google-Docs-like** bullet,
exactly this existing sentence:

> **Adaptive thread placement**: in focus mode and wide layouts, threads sit Docs-style in the right margin, aligned to their anchors with connectors; in narrow columns they collapse to chips at the anchor that expand inline.

with:

> **Adaptive thread placement**: in focus mode and wide layouts, threads sit Docs-style in the right margin, aligned to their anchors with connectors; in narrow columns they sit as chips at the anchor that expand inline. **Which placement a thread gets depends on the width; whether it can be collapsed does not** — every placement obeys the one collapse behaviour defined in Thread view below.

### Amendment 3 — §10 Thread view, APPEND at the end of the bullet

APPEND at the **end of §10's Thread view bullet**. At the time of writing that
bullet ends with exactly this text:

> **Newlines in a turn written by a person render as line breaks** — a textarea offers no other way to write one — while a turn written by the agent renders as ordinary markdown, where a single newline is a space and a break is written as markdown spells it. _(Rider signed 2026-08-03.)_

**Collision note for the orchestrator:** SHARED-016's Amendment 1 also appends
after that same sentence. Both are appends at the end of the same bullet, so the
order between them is cosmetic — apply whichever is signed first, then append the
other after it. Do **not** treat a mismatch of the quoted tail as a reason to
skip this amendment; the instruction is "append at the end of the Thread view
bullet".

Append the following:

> **Anything that can be shown can be collapsed, and it means the same thing everywhere.** A conversation is **collapsed** when it is folded down to a single line that still reports what it is: that it exists, what it is about (its anchor quote, or that it is a whole-document or standalone conversation), who spoke last, **how many turns are inside** — its whole size, the way a clipped block names its whole length rather than a remainder — and whether it holds anything you have not seen. Collapsed is never hidden: the conversation stays in the document's record, in search, in the comments list, in Attention and on disk, and its anchored highlight stays in the body, so the passage still says it has been discussed and the conversation is still reachable from it. **Every collapse expands again in place**, where it stands, without navigating anywhere — a fold whose only way back is losing your place is not a collapse.
>
> **This holds wherever a conversation is shown**: a card in the margin, a chip at its anchor, a thread listed below the body, a whole-document or detached thread, a `type: thread` document open in a reader in a column or in full screen, a thread in the comments list, and a **child thread nested under a turn at any depth**. A conversation nested deeper than a surface can usefully draw is collapsed rather than dropped, and opening it in its own reader stays available as a **choice**, never as the only way to read it. The unit is the conversation: individual turns do not collapse — the bulk inside a long turn is what the fence clipping above is for.
>
> **On demand, and by one rule.** Anyone can collapse or expand any conversation at any time. Independently, **a `resolved` thread is collapsed by default** (§6) — that is the single rule, the set of rules is closed, and adding one takes a change to this document. **A conversation carrying a turn you have not seen is never collapsed by the rule**, whoever wrote it and whatever its status: a collapsed conversation has displayed nothing and so never counts as read (§7), and a rule that folded away unread turns would be a way to lose them. The reader is not bound by this — anyone may still fold an unread conversation by hand; it is the rule that may not.
>
> **Precedence: the last thing that happened wins.** The rule decides the state a conversation is placed in; collapsing or expanding it yourself overrides the rule and **sticks** — through navigating away and back, and through a reload — the way the reader's chosen width and the console's height are sticky. A change to the thread's **status** re-asserts the rule and clears that override, so resolving a conversation collapses it even while it is open on screen, and reopening one expands it. **Reading never collapses anything**: the rule is applied when a conversation is placed and when its status changes, never because you have just read it. Collapse state is browser-local like scroll position and open readers — never written to the thread or the document, so reading a document commits nothing, and two columns showing the same document keep their own. Collapsing and expanding are operable from the keyboard like every other affordance (§10 adds no exclusive-pointer capability) and claim **no new key**: each conversation's collapse control sits in its own right-click menu alongside its other actions. _(Rider signed 2026-08-05.)_

---

## Open questions for sign-off

**Q1 — Should a manual collapse really persist across reload?** As drafted it
does, on the argument that a focus gesture the reader has to repeat after every
navigation is not focus. The cost is a reader who folded something months ago and
has forgotten, and finds a conversation quietly small with no memory of why.

_Recommendation: persist, as drafted._ The mitigation is already in the text —
a collapsed conversation still names itself, its size and its unread state, so
"quietly small" is still visibly present rather than absent. The narrower variant
worth having if the user disagrees: **persist across navigation within a session
but not across reload** (a reload is the natural "start fresh"). That is coherent
and cheap; it is simply the weaker version of the same idea.

**Q2 — Do individual turns collapse?** The user wrote "any comment / thread". As
drafted, no: threads collapse, turns do not, on §6's grounds that a comment *is*
a thread.

_Recommendation: threads only, as drafted._ If the user did mean turns, note that
the real complaint is probably **a long turn**, not many turns — and that is
already what the fence clipping handles and what SHARED-014's snippet collapse
would extend. Collapsing turns individually should be a separate rider with its
own reason, not folded into this one, because it changes what reading a
conversation feels like.

**Q3 — One rule, or a small closed set?** As drafted, exactly one (`resolved`),
declared closed. The two candidates considered and left out:

- **Deep nesting.** Left out as a rule because the draft gets the same outcome
  from "collapsed means reachable, expands in place" — and as a consequence it
  also **fixes** today's deep-nesting behaviour, which collapses a thread into a
  link that navigates away and cannot be expanded where it stands.
- **Read-and-unchanged** (a conversation you have seen and nothing has happened
  in since). Left out deliberately: it would fold **open** conversations, which
  are precisely the ones the user says they want to see, and "nothing happened
  since you read it" is the state of most open threads most of the time.

_Recommendation: one rule, as drafted._ A rules engine is the wrong answer to a
focus problem — every extra rule is another conversation that vanished for a
reason the reader has to reconstruct.

**Q4 — Should there be a "collapse all" / "expand all"?** Not in the draft. It is
the obvious next ask for a focus feature and the user did not make it.

_Recommendation: leave it out of this rider._ It is a **view-level** preference,
not a per-item one, and where it would live is a real design question (per
reader? per column? part of the view document, and therefore committed and
synced?) that deserves its own answer rather than a clause bolted onto this text.
Easy to add later; hard to un-guess if we get it wrong now.

**Q5 — Does the by-rule default apply in the comments list?** As drafted, no —
the list has explicit open/resolved filters (SHARED-010), so a collapse rule
there would be a filter with extra steps and the two would disagree about what
"showing resolved" means.

_Recommendation: as drafted._ On-demand collapse still applies in the list, so
nothing there is a special case except the default.

---

## Non-goals (state them so the chain does not drift)

- **Nothing is hidden, filtered, or removed.** This rider adds no way to make a
  conversation stop existing on a surface. Filtering is the comments list's job
  and the search overlay's.
- **No new document or thread state.** `status` stays `open | resolved`; no
  `collapsed` field, no frontmatter change, nothing written to disk.
- **Not a settings feature.** No preferences panel, no per-column configuration,
  no "always collapse X" option. One rule, named in the spec.
- **Not "everything in the app folds".** The scope is conversations. Backlinks,
  the related panel, the frontmatter form, document sections and console job
  entries are explicitly untouched.
- **No change to read state.** §7 owns what counts as read, unchanged — including
  that a collapsed conversation displays nothing and therefore reads nothing.
- **No change to anchoring or reconciliation.** A collapsed thread's anchor
  behaves exactly as an expanded one's (§6).
- **No new keyboard binding.** The §10 keyboard scheme and its cheat-sheet are
  unchanged.
- **Not a change to who may resolve.** That is SHARED-019, and it is separable.

## Acceptance Criteria

- [ ] User signs off, or answers Q1–Q5 and the text is adjusted
- [ ] Amendment 1 applied to SPEC.md §6 verbatim (one-line replace inside the
      frontmatter example)
- [ ] Amendment 2 applied to SPEC.md §10 Document view verbatim (one-sentence
      replace)
- [ ] Amendment 3 appended at the **end** of §10's Thread view bullet — nothing
      in §10 is deleted by it; if SHARED-016 is signed too, the two appends
      coexist in whichever order they are applied
- [ ] **UI-077 is re-pointed** at the amended §6 line and at the new §10 text,
      and its `§5` citation corrected to `§6`
- [ ] A second UI issue is filed for the on-demand half, and the two are
      sequenced so they ship together (UI-077 already says "do not ship this
      alone")
- [ ] The implementing chain does not start before the text is in place
- [ ] The implementing agent confirms the placement/collapse matrix above against
      the running app before writing tests — the user's report reads inverted
      relative to the code and the direction must be established E2E, not
      assumed

## Technical Design

### Files to Create/Modify

- `SPEC.md` §6 (one replace), §10 Document view (one replace), §10 Thread view
  (one append)
- `issues/ui/077-resolved-threads-collapse.md` (re-point, fix citation) — after
  sign-off

## Testing Strategy

None here — spec text. The notches worth fixturing when the domain issues are
filed:

- a document carrying one resolved and one open thread, in **each** placement
  (margin card, chip at anchor, below-body list) — open at full size, resolved
  collapsed, and the collapsed one still naming its turn count
- resolving a thread while its card is open on screen → it collapses; reopening →
  it expands
- a resolved thread **with an unread turn** → **not** collapsed by the rule; the
  same thread after it has been seen and re-placed → collapsed
- collapsing a thread by hand, following a `[[ref]]` and coming back → still
  collapsed; and after a reload → still collapsed
- the same document open in two columns, collapsed in one → unaffected in the
  other
- a child thread nested five deep → collapsed **and expandable in place**, not a
  link that navigates away
- a `type: thread` document open in full screen → collapsible
- collapsing an unread thread **by hand** → allowed (the override binds the rule,
  not the reader)
- a collapsed thread is still found by search, still listed in the comments list,
  still counted in Attention, and its anchor is still highlighted in the body
- a collapsed thread is **not** marked seen (§7 — the existing guarantee must not
  regress)
- `r` (focus the reply composer) still works when the target thread is collapsed
- no git commit results from collapsing or expanding anything

## E2E Verification Log

_N/A — spec draft. The placement/collapse matrix above was established by reading
the reader, anchor and thread-card code on 2026-08-05; the implementing agent
reproduces it against the running app before changing anything._

## Completion Checklist (orchestrator)

- [ ] Sign-off recorded
- [ ] SPEC.md updated
- [ ] UI-077 re-pointed
- [ ] Committed with `[SHARED-018]` prefix
