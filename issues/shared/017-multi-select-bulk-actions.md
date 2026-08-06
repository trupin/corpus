# [SHARED-017] Selecting several documents and acting on them

## Domain

shared (orchestrator-owned)

## Status

done — signed by the user 2026-08-05; amendments applied to SPEC.md.

## Priority

P1

## Model

fable

## Dependencies

- Depends on: nothing new. Every action this rider batches already exists
  individually (§11 ⋯ menu, staleness quick actions, §9.2 write routes).
- Blocks: the UI chain this rider implies (not yet filed), plus one server-side
  question it raises — whether "one action, one commit" (Amendment 1) needs a way
  to ask for several document mutations as one act. That is a contract/server
  issue, filed on its own, not something the board should approximate by firing
  twenty requests and hoping the commits land the way the spec says.

## Spec References

- §4 The workspace — auto-commit per mutation, acting party as git author,
  "Autosave and commit granularity"
- §2.4 Upgrading — "a single attributed commit" for one act spanning files, and
  the three-part report vocabulary this rider reuses
- §5 The document model — `reviewed` ("still current"), tags, staleness
- §7 Event queue and agent loop — document locks; a locked document renders
  read-only and write paths refuse the other party
- §9 Server — `DELETE /api/docs/:id` is **user-only** with an explicit confirm;
  user-only endpoints reject agent actors; deleted documents' threads become
  orphaned records
- §11 UI — the board: columns, per-column reader, type-aware rows, ⋯ menu,
  right-click context menu, keyboard scheme, "browser-local state stays local"
- §14 Validation — every mutation validates before writing; a mutation can
  succeed and still surface warnings

---

## The user, verbatim (2026-08-05)

> "I want to be able to select multiple document and take action on them"

That is the whole request. Everything below is proposed, not reported: the shape
is the draft's, and the choices worth overturning are named in **Open questions**
rather than buried in the amendment text.

---

## What already exists — this rider does not re-specify any of it

- **Every action it batches is already specified, one document at a time.** §11's
  reader ⋯ menu offers Archive, Unarchive, Delete (user-only, explicit confirm
  per §9) and Resolve/Reopen; the staleness ramp already puts archive /
  still-current / @agent-triage quick actions on a stale **row**; §9.2 has the
  move and archive/unarchive routes and the frontmatter form covers title, tags,
  status, due. **This rider invents no action.** It lets you aim an existing one
  at more than one document.
- **Rows and columns already exist as the unit.** A column is a pinned `type:
  view` document whose frontmatter holds the query; rows are type-aware; the
  active column is already the unit of keyboard navigation (`↑`/`↓` move rows in
  the active column, `←`/`→` switch columns).
- **Browser-local state is already a named category**: "Only browser-local state
  stays local: scroll positions, open readers, and per-reader navigation stacks."
  A selection joins that list — it is not a property of the view document, so
  selecting rows must never write a file or make a commit.
- **Locks already have an answer for a refused write.** §7: the UI renders a
  locked document read-only with a banner naming the holder, and "Document write
  paths refuse edits to a document locked by the other party, identifying the
  holder." A bulk action does not need a new lock rule; it needs to **report** the
  one that already applies, per document.
- **Partial outcomes already have a vocabulary.** §2.4's upgrade report states
  "what it updated, what it left alone, and, listed apart from both, the
  conflicts that are unresolved work". §14 already has mutations that succeed and
  still carry warnings. Amendment 2 reuses that three-part shape verbatim in
  spirit rather than inventing a second one.
- **"One act, one attributed commit" already exists as a pattern**: the workspace
  upgrade lands everything it wrote in a single attributed commit, and `corpus
  skill rollback` is one commit for one restore.
- **The right-click menu already has a governing rule**: "listing exactly that
  item's existing actions, nothing invented" — which the selection menu must obey
  rather than sidestep.

So the gap is narrow and entirely in §11 (how a selection is made, shown, and
reported on) plus one sentence of §4 (what it does to git history).

---

## The two decisions the brief demands, made explicitly

### Decision 1 — Partial failure: apply to the seventeen, name the three

**A bulk action applies to every selected document it can, and never refuses the
whole set because of one.** Reasons, in order of weight:

1. **Refusal makes the feature useless exactly where it is wanted.** A locked
   document is the routine case, not the exception — the agent takes locks while
   it works, and a selection of twenty rows in a busy workspace will often
   contain one. An all-or-nothing rule means the user's action fails for a reason
   that has nothing to do with the nineteen documents they were looking at, and
   the workaround is to hunt the locked row and deselect it, which is worse than
   doing the whole thing by hand.
2. **All-or-nothing would be a lie of a different kind.** Files are the source of
   truth and every mutation commits (§4). "Refuse the whole set" over twenty
   files means either checking every document first and racing anyone who edits
   one in between, or writing some and rolling them back — a rollback that itself
   commits. A guarantee the write path cannot actually give is worse than a
   truthful partial result.
3. **The consequence of a partial archive is recoverable**; the consequence of a
   feature nobody can use is that people archive twenty documents one at a time
   and stop reading the confirmations.

**The honesty half is not optional, and it is the part worth testing.** Three
things bind:

- **Three lists, never one word.** The result states what **changed**, what was
  **already in that state** (already archived is a no-op, not a failure), and —
  listed apart from both — what **did not change and why**, each named
  individually with its reason (the lock's holder, the validation error, the
  rule that refused it). This is §2.4's shape, deliberately.
- **It persists until dismissed.** Not a message that disappears on its own; the
  count of things that did not happen is the thing most worth re-reading.
- **The selection survives as the retry.** After the action, the selection is
  reduced to exactly the documents that did not change — so "unlock and try
  again" is one gesture — and clears entirely only when everything changed.

A bulk action that reports "done" while three of twenty did not happen is the
same class of defect this codebase has already filed three times (a pending row
that lies, an anchor that silently misattaches, a diff that returns 401
characters and calls itself a diff). The draft states the anti-behaviour in the
spec text so an evaluator can fail it.

### Decision 2 — Commit granularity: one commit per action

**Archiving twenty documents produces one commit, not twenty**, authored by the
acting party like every other mutation, containing exactly the documents that
actually changed.

Why:

- **It matches the pattern the codebase already chose for this exact shape.** The
  workspace upgrade and `corpus skill rollback` both land one act spanning files
  as one attributed commit. A bulk archive is that shape and nothing else.
- **It makes the action revertible as a unit.** `git revert` on one commit undoes
  "I archived the wrong twenty". Twenty commits means twenty reverts, and the
  set is only recoverable if you can still tell which twenty they were.
- **It agrees with Decision 1.** The commit contains the seventeen that changed
  and not the three that did not — so `git log` and the on-screen report say the
  same thing, which is the whole point of having the audit trail be git.
- **§4 already accepts commit-count shaping for legibility.** "One commit per
  editing session, not one per keystroke" is the same trade already made once.

**The cost, stated plainly:** a single document's history now contains commits
that also touched nineteen neighbours, so `git log` scoped to one file shows an
entry whose message is about a set. The draft pays for that by requiring the
message to name the action and the documents it changed, so the record stays
legible when read from either direction. The second cost: a bulk commit must not
fold into a preceding squash window, or a bulk archive could be swallowed into
someone's autosave commit and vanish from the audit trail as an act — the
amendment says so explicitly.

---

## Proposed SPEC.md amendments — verbatim, for sign-off

### Amendment 1 — §4, APPEND a paragraph after "Autosave and commit granularity"

APPEND immediately after, in §4, exactly this existing text:

> A save by the other author, to a different document, or after the idle window
> always starts a fresh commit; squashing only ever folds into the immediately
> preceding, matching auto-commit and never rewrites anything already published
> or interleaved.

the following paragraph:

> **One action, one commit.** An action a person takes on **several documents at
> once** — the board's bulk actions on a selection (§11) — lands as a **single**
> auto-commit, authored by the acting party like any other: archiving twenty
> documents is one commit, not twenty, the same shape an upgrade's template sync
> (§2.4) and `corpus skill rollback` (§7) already have when one act spans several
> files. The commit contains exactly the documents the action **changed** — a
> document the action could not change (§11) leaves nothing in it — so `git log`
> never records an effect the user was told did not happen, and reverting that
> one commit undoes the action as a unit. A bulk commit is its own entry in the
> history: it never folds into a preceding editing session's squashed commit, and
> no later save folds into it — the squashing above is about repeated saves of
> **one** document, never about one act across many. Its message names the action
> and the documents it changed, because the accepted cost of this choice is that
> a single document's history now shows commits that also touched its neighbours,
> and the message is what keeps that legible from both directions. _(Rider signed
> 2026-08-05.)_

### Amendment 2 — §11, APPEND a new bullet after "Type-aware rows"

APPEND, as a new bullet immediately after the bullet ending with exactly this
existing text:

> The **staleness ramp** (§5) renders per row: age rail → dimming → age chip →
> archive / still-current / @agent-triage quick actions at the stale tier.

the following:

> - **Selecting rows, and acting on the selection.** A column's list carries a
>   **selection** of rows, and an action aimed at the selection applies to every
>   row in it. Selection is **additive, never a mode**: clicking a row still opens
>   it in the reader exactly as before, and a row joins the selection only through
>   an explicit act — its own selection control (revealed on hover or keyboard
>   focus, and shown on every row once the selection is non-empty) or the keyboard
>   bindings below, which reach everything the pointer reaches (§11 adds no
>   exclusive-pointer capability). **A selection lives in one column at a time** —
>   the active column — and starting one in another column clears it: the same
>   document legitimately appears in two columns, and a selection spanning both
>   would show that document selected in one place and unselected in another. A
>   selection is **browser-local state**, like scroll positions and open readers:
>   selecting rows writes no file, makes no commit, changes no view document, and
>   does not appear in another browser. The column **states how many rows are
>   selected**, offers the actions, and offers a way to clear — the number a bulk
>   action will act on is always on screen and never something to infer.
>   **The actions offered are the ones the selected items already have**, and
>   nothing else: Archive, Unarchive, Resolve/Reopen, Move to a folder, add or
>   remove tags, mark **still current** (§5), Delete, and **Ask the agent about
>   these**. An action is offered only when it applies to **every** selected item,
>   so a selection holding a note and a thread offers no Resolve — nothing is
>   half-applied because of a type mismatch. Tagging **adds or removes the named
>   tags** and never replaces a document's tag set. **Ask the agent about these**
>   creates one agent-requested standalone thread (§11's Ask) whose first turn
>   references every selected document, and appears on the board like any Ask; it
>   changes none of the selected documents, so it stays available when some of
>   them are locked.
>   **A bulk action applies to what it can and reports what it could not.** It
>   never refuses the whole set because of one document: a document locked by the
>   other party is refused exactly as a single edit to it would be, naming the
>   holder (§7); one that fails validation is refused with its reason (§14); the
>   rest go through. **The result is stated in three parts** — what **changed**,
>   what was **already in that state** (a document already archived is a no-op,
>   not a failure), and, listed apart from both, what **did not change and why**,
>   each named individually with its reason — the same shape an upgrade reports
>   its work in (§2.4). The result **stays until it is dismissed**; it is never a
>   message that disappears on its own, because the part worth re-reading is the
>   part that did not happen. **A bulk action never reports success for work that
>   did not happen**: if seventeen of twenty changed, the result says seventeen,
>   names the three, and the history agrees with it (§4). After the action the
>   selection is reduced to exactly the documents that did not change — so
>   retrying after clearing a lock is one gesture — and clears entirely when
>   everything changed.
>   **Selecting a whole result set is two distinct acts.** Select-all selects the
>   rows **currently listed**, saying how many. When the column's query matches
>   more than is listed, a second, separately labelled act extends the selection
>   to **everything the query matches**, naming that number before it is taken.
>   The count is re-evaluated when the action runs, and the result reports the
>   documents actually changed — saying so when that differs from the number
>   shown, because the corpus can change between selecting and acting.
>   **Delete stays what §9 made it.** It is user-only with an explicit confirm,
>   and in bulk the confirm names how many documents will be deleted, lists them,
>   and says how many threads will be left as orphaned records; unlike archiving
>   it cannot be undone from the app, and git is its only recovery. Bulk delete is
>   offered **only on a selection whose documents are enumerated** — a
>   whole-result-set selection cannot be deleted, because "all 412 matching" is
>   not a set anyone read before confirming.
>   **What clears a selection**: `esc`, the clear control, changing the column's
>   query, removing the column, starting a selection in another column, and a
>   reload (it is browser-local). It **survives** scrolling, opening and closing a
>   reader, and live updates arriving over SSE. A row that leaves the list because
>   it no longer matches the query — including because the action just archived it
>   — leaves the selection with it. **Right-clicking a row that is part of the
>   selection** opens the selection's actions and names the count, under §11's
>   existing context-menu rule (exactly the actions already offered, nothing
>   invented); right-clicking a row outside the selection opens that row's own
>   menu and leaves the selection alone. _(Rider signed 2026-08-05.)_

### Amendment 3 — §11 keyboard scheme, REPLACE the tail of the bullet

REPLACE, in §11's **Keyboard scheme (v1)** bullet, exactly this text:

> `f` focus mode on the open document · `e` archive the open (or highlighted)
> document · `r` focus the reply composer of the open document's visible thread ·
> `?` toggles a **keyboard cheat-sheet overlay** listing all bindings. The active
> column follows focus/hover with a visible cue.

with:

> `f` focus mode on the open document · `e` archive the open (or highlighted)
> document · `r` focus the reply composer of the open document's visible thread ·
> `x` **toggle selection** on the highlighted row · `⇧↑`/`⇧↓` extend the selection
> while moving · `⌘A` select every row **currently listed** in the active column,
> only while the list itself has focus — inside a composer or the editor it stays
> the browser's select-all (extending to the column's whole result set is the
> separate act named in the selection bullet, never a key) · `esc` clears a
> non-empty selection **last**: after any overlay, focus mode and the column
> reader in front of it have had their turn · `?` toggles a **keyboard
> cheat-sheet overlay** listing all bindings. The active column follows
> focus/hover with a visible cue. _(Selection bindings: rider signed 2026-08-05.)_

---

## Open questions for sign-off

**Q1 — Does a selection span columns, or live in one?** As drafted it lives in
one column, and starting a selection elsewhere clears it. The reason is not
simplicity for its own sake: the same document legitimately appears in two
columns (an Inbox column and a folder column can both match it), so a board-wide
selection has to decide whether selecting it in one marks it in the other, and
either answer is confusing on screen. The cost is real — archiving three rows
from Attention and two from Inbox is two actions, not one.

_Recommendation: one column (as drafted)._ If the user wants board-wide
selection, the mechanical change is to strike the "lives in one column at a time"
sentence and add that a document selected anywhere shows as selected everywhere
it appears — but note that "one action, one commit" (Amendment 1) then spans
columns too, which is fine, and that select-all must stay per-column or it means
nothing.

**Q2 — Is bulk delete offered at all?** As drafted, yes, with a confirm that
names the count, lists the documents, and states the thread-orphan count, and
only on an enumerated selection. The alternative — deletion stays strictly one
document at a time — is defensible and is a one-clause deletion from Amendment 2.

_Recommendation: offer it as drafted._ Withholding it does not prevent anyone
from deleting twenty documents; it makes them do it as twenty confirms, which
trains the habit of clicking through the confirm that §9 relies on being read.
One heavy, count-naming confirm is a stronger gate than twenty light ones.

**Q3 — One commit or twenty?** The draft takes one (Decision 2 above). Both are
defensible and the user may hold a view. Twenty keeps a document's own history
pristine and matches how every existing mutation commits; one makes the *action*
legible and revertible as a unit and matches the upgrade / rollback precedent.

_Recommendation: one (as drafted)._ If the user prefers twenty, Amendment 1 is
dropped entirely and §4 is left untouched — the rest of the rider stands
unchanged, except that Amendment 2's "and the history agrees with it (§4)"
becomes a reference to twenty individual commits rather than one.

**Q4 — Should a selection be able to exceed what is listed?** As drafted, yes,
behind a second explicitly labelled act that names the number. The alternative is
to restrict v1 to the rows currently listed, which is simpler and removes the
"the set changed between selecting and acting" wrinkle entirely — at the cost of
making "archive these 300 stale documents" impossible, which is one of the more
plausible reasons to want this feature at all.

_Recommendation: as drafted._ The safety is in the two acts and the named number,
not in withholding the capability — and bulk delete is already excluded from it.

**Q5 — Does "Ask the agent about these" belong in v1's action set?** It is the
draft's own addition; the user asked for actions on documents, and this one acts
on a *thread* about them. It costs no new machinery (an Ask with several
`[[refs]]` in its first turn) and it is the natural bulk form of the staleness
ramp's existing @agent-triage quick action.

_Recommendation: include it._ If it is dropped, everything else stands and the
sentence is struck; note that dropping it also removes the only offered action
that works on a locked document, which slightly weakens the case for making
locked rows selectable at all.

**Q6 — key choices (`x`, `⇧↑`/`⇧↓`, `⌘A`).** These are conventions borrowed from
mail clients and file managers, not derived from anything in the spec. `⌘A` is
the only one that takes a key the browser also uses, and the draft narrows it to
"only while the list has focus".

_Recommendation: as drafted, and cheap to change at sign-off_ — they are three
tokens in one bullet, and the cheat-sheet overlay (`?`) already renders whatever
the scheme says.

---

## Non-goals (state them so the chain does not drift)

- **No new action.** Every action offered on a selection is one an individual row
  or the reader ⋯ menu already offers. Nothing is invented for the plural case.
- **No new agent capability.** This is a person's affordance on the board; the
  agent already edits documents one at a time and stewards autonomously (§7). No
  bulk agent verb is promised, and the user-only rules (§9) are untouched — a
  bulk delete is still refused for an agent actor exactly as a single one is.
- **No weakening of §9.** Bulk delete is *more* gated than single delete, never
  less: enumerated selection only, count named, orphaned-thread count stated.
- **No weakening of §7 locks.** A locked document is refused, not queued, not
  force-unlocked on the user's behalf, and not silently skipped — it appears by
  name in the result with its holder.
- **No selection in the search overlay** (v1). The overlay is a query surface;
  "Save as view" is the existing bridge from a query to a column, and the column
  is where selection lives. A follow-up rider can revisit it.
- **No selection of turns.** §6's per-turn deletion stays one turn at a time.
- **No selection in the console.** Retrying or abandoning several failed jobs at
  once is a plausible follow-up and is not this rider.
- **No undo stack.** Archive/unarchive are each other's inverse; delete's only
  recovery is git, as §9 already says.
- **No multi-row drag or reordering.** Selection is for acting, not arranging.
- **No persistence of a selection** across reloads or browsers — it is
  browser-local by construction, and a selection that outlived a reload would be
  a set nobody is currently looking at.

## Acceptance Criteria

- [ ] User signs off, or answers Q1–Q6 and the text is adjusted
- [ ] All three amendments applied to SPEC.md verbatim at phase kickoff, by the
      orchestrator
- [ ] Amendment 3 **replaces** the quoted keyboard text rather than duplicating
      it — the `f` / `e` / `r` / `?` bindings must survive exactly once in §11
- [ ] Amendments 1 and 2 are **appends**; nothing existing is deleted by them
- [ ] §7 and §9 are **not** edited: the lock rule and the user-only deletion rule
      are referenced, never restated or relaxed
- [ ] The implementing chain does not start before the text is in place
- [ ] Before the UI issue is filed, Amendment 1 is checked against what the write
      path can actually promise — if "one action, one commit" needs a way to ask
      for several document mutations as one act, that is a contract/server issue
      filed **first**, not something the board approximates

## Technical Design

### Files to Create/Modify

- `SPEC.md` §4 (one append), §11 (one append, one replace)

## Testing Strategy

None — spec text. The domain issues carry the tests. The notches worth fixturing
when they are filed:

- twenty rows selected, three locked by the agent → seventeen change, the result
  names the three with their holders, the selection is reduced to exactly those
  three, and `git log` shows **one** commit touching seventeen files
- a selection containing a document already archived, then Archive → it lands in
  the "already in that state" list, not in the failures, and contributes nothing
  to the commit
- select-all on a column whose query matches more rows than are listed → the two
  acts are distinguishable and the second names the number before it is taken
- a selection holding a note and a thread → Resolve is not offered
- bulk delete → confirm names the count, lists the documents and the
  orphaned-thread count; the action is absent on a whole-result-set selection;
  an agent actor is refused
- `esc` with a reader open and a non-empty selection → the reader closes first,
  the selection survives; `esc` again clears the selection
- selecting rows → no file changes, no commit, no diff in the column's view
  document
- a bulk archive immediately after an autosave on one of the same documents →
  two commits, not one folded entry

## E2E Verification Log

_N/A — spec draft._

## Completion Checklist (orchestrator)

- [ ] Sign-off recorded
- [ ] SPEC.md updated
- [ ] Committed with `[SHARED-017]` prefix
