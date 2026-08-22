# [SHARED-058] A refusal outlives its toast

## Domain
shared (orchestrator)

## Status
done — AUTHORIZED by the user 2026-08-21, applied to SPEC.md §10 the same day

## Priority
P1

## Model
fable

## Dependencies
- Depends on: —
- Blocks: UI-139
- Related: UI-132 (which set the clamp and named the gap), SHARED-057 (the geometry rule the clamp serves)

## The authorization

UI-139 named three open questions and offered two shapes. Asked which, the user
answered: _"yes go for 2 and fold it in"_ — option 2 being *"the reason moves
somewhere durable — the console, which already holds job failures, so a refusal
is readable after the toast has gone."*

That authorizes the substance. The text below is what the answer became, and it
is quoted in full in the release report so the user reads what they signed.

## What the rider says

§10's console paragraph gains a third tab. The applied text:

> The expanded drawer holds **three tabs**, and none of them is the corpus —
> each is the running system's own account of itself, which is what puts them
> here: **Jobs**, described below, **Notices**, described after it, and
> **Residents** — §7's roster […]
>
> **Notices** is every warning and refusal this session has raised, newest
> first, each with its whole text, the tone it arrived in, and when. A toast is
> a notice arriving, and this tab is where it stays. A toast's text is clamped
> so the stack does not move, and a clamp is a cut that must be revealed rather
> than accommodated — so this tab is the reveal that does not require a pointer,
> and it is what a person reads when the toast has already gone. It is therefore
> not optional chrome: a refusal's reason is a server string of no bounded
> length that exists on no other surface, and until now a person without a mouse
> could not finish reading one. An unread notice of **error** tone marks the
> console until the tab has been opened, because a durable record nobody is told
> about helps only a person who already knew to look; a confirmation marks
> nothing. The list is **browser state and session-scoped** — nothing about a
> notice reaches disk, and it is not corpus state — so a reload clears it, which
> is the accepted cost of a record that needs no server. It is bounded, and on
> reaching its bound the oldest go and it says so rather than ending quietly.
> Error toasts are unchanged in how they end: they expire on their dwell like
> any other, because a toast that waits to be acknowledged accumulates on the
> board, and the durable copy here is what makes expiry safe. This is also the
> surface §11 already assumes when it says a failed workspace hook gets "console
> visibility". _(Rider authorized 2026-08-21.)_

## The calls this made, and what they rejected

**1. A third console tab, not a new place.** Rejected: an overlay or a log page
of its own — new navigation for something read rarely, and a person hunting for
a refusal has no reason to guess it lives somewhere new. Also rejected:
appending refusals to the **Jobs** list. A refusal of a person's own write is
not a job, it would move the job counts on the strip, and the detail pane below
Jobs is a log stream a notice has nothing to put in.

**2. The tabs' shared justification had to be rewritten, not extended.** §10
said both tabs "are the agent's own machinery rather than the corpus". A
refusal of a person's write is not agent machinery, so a third tab under that
sentence would have made it false. The claim is now that none of the three is
the corpus — each is the running system's account of itself. That is true of
all three and is why the drawer holds them.

**3. Session-scoped browser state, not a server-side notice log.** "Durable" in
UI-139 means *outlives the toast*, not *survives a restart*. The refusal is
already client-side knowledge — the client raised the toast from a failed
mutation — so persisting it would need a contract route, a server store and a
projection decision for a record with no reader after the session ends.
**The cost, stated:** a reload clears the list. Someone who refreshes before
reading a refusal has lost it, and has only the server log.

**4. Error toasts still expire on their dwell.** This is UI-139's option 1,
rejected by the user's choice of option 2. It is worth naming the reason the
issue's own author gave for preferring acknowledgement: without it, a refusal
can pass unread. The attention marker in call 5 is what answers that instead,
at a fraction of the cost — nothing accumulates on the board.

**5. An attention marker was added, and nobody asked for it.** Option 2 as
written makes the reason *reachable*, not *noticed*. A durable record helps only
a person who already knows to look, so a refusal seen by nobody is still a
refusal lost. Scoped to the **error** tone: a marker that lit for every saved
document would be noise, and noise is how a marker stops being read.

**6. The clamp stays** — UI-139's third question. SHARED-057's guarantee is that
the stack does not move, and it does not depend on how the full text is reached.

## Consequences elsewhere

- **§11 gets no edit and needs none.** Its hook-failure bullet already promises
  "a warning on the API response, a server log entry, and console visibility".
  No console surface delivered the third. This rider makes an existing sentence
  true rather than adding a claim.
- The `title` attribute on the toast message is **kept**, not replaced. It is
  the fastest path for the pointer user and costs nothing.

## Acceptance
Applied to SPEC.md §10 on 2026-08-21. UI-139 implements it.
