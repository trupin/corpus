# [SHARED-040] Commit windows close on acts, not on saves

## Domain

shared (orchestrator-handled — SPEC.md rider, needs user sign-off)

## Status

done — **SIGNED 2026-08-10 and applied to SPEC.md §4**

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Blocks: SERVER-091 (the window itself), SERVER-092 (acts close it),
  SERVER-093 (nothing reads a history it holds), SERVER-094 (clean stop and boot
  recovery) — filed 2026-08-10 against the signed text

## Spec References

- SPEC.md §4 line 137 — "Autosave and commit granularity" (**the paragraph this
  rider replaces**)
- SPEC.md §4 line 135 — "Every mutation the server performs auto-commits the
  affected files … with the acting party as git author"
- SPEC.md §4 line 139 — "One action, one commit" (rider signed 2026-08-05,
  SHARED-032 — **survives, restated, not replaced**)
- SPEC.md §4 line 141 — "Edit acknowledgment" (rider signed 2026-08-02) — the
  `doc.edited` event carries a **commit range**
- SPEC.md §5 line 145 — files on disk are the source of truth
- SPEC.md §6 — anchor drift is recovered from git history
- SPEC.md §7 lines 292–297 — document locks, force unlock, deferred events
- SPEC.md §7 line 308 — "Every change leaves a visible trace"; deletion is
  user-only
- SPEC.md §7 line 330 — `corpus skill rollback` (a targeted git revert)
- SPEC.md §9.2 line 383 — `GET /api/docs/:id/diff`, the read behind
  `corpus doc diff`
- SPEC.md §9.1 line 362 — chokidar, out-of-band edits
- SPEC.md §11 line 457 — staged bulk Save
- SPEC.md §14 — a mutation stands even when the commit does not

## Summary

The user asked why Corpus commits on every change, and whether the agent should
decide when to commit. Handing commit timing to the agent breaks three things —
the user is also a writer and the agent cannot author their work; the agent is
not always running; and §7 makes git the only recovery for a deletion. The
user's decision instead: **commit on specific events rather than on literally
each change.**

Today §4 coalesces only along one axis: repeated saves of *one* document by
*one* author fold into the previous commit, and one bulk action is one commit.
The gap that motivates this rider is the **agent's stewardship**: working a
single queue event, the agent updates three documents, appends a changelog to a
fourth and posts a turn — and because the squash key is document-plus-actor,
that is five commits for one act. This rider replaces the document-scoped squash
with a **party-scoped commit window** that closes when a discrete act completes.

Four decisions were settled by the user before drafting (recorded here so the
implementer does not reopen them):

1. **Trigger — acts, not saves.** A window closes when a discrete act completes:
   an agent turn posted, a thread resolved, a document archived / moved /
   deleted, a bulk Save. Editing keeps the idle-squash behaviour.
2. **Authorship — flush on party change.** A window belongs to one party; when
   the other party writes, the open window commits first. §4's author stays
   exact. Accepted cost: more commits when both parties work at once.
3. **Deletion — never waits.** A delete closes the open window and commits
   immediately, so a document created and deleted inside one window still leaves
   a git object to recover from.
4. **Durability — commit on shutdown, recover on boot.** A clean stop flushes
   the open window; an unclean stop leaves changed files on disk, which the
   server commits on next boot as an honestly-labelled recovery commit.

---

## SIGNED 2026-08-10 and applied — §4 replacement text

**Was read aloud verbatim, on its own, and signed.** Several other riders are already held for
signature (SHARED-024 … SHARED-038); this one is independent of all of them and
must not be batched with them.

This text **replaces** §4's "Autosave and commit granularity" paragraph (line
137) in full. §4's "One action, one commit" paragraph (line 139, signed
2026-08-05) **stays as it is** — nothing below weakens it, and the "Three acts
commit alone" paragraph restates its guarantee under the new mechanism.

All six questions the first draft raised have been answered (see "Decisions
Folded In" below) and are already folded into the text; it is final as written.

> **Commit windows — a commit per act, not per save.** Every mutation still
> auto-commits, but no longer each one on its own. Changes accumulate in an
> **open commit window** and land together when it closes. At most one window is
> open at a time and it belongs to **one party**: the moment the other party
> writes, the open window commits before their change is taken. `git log`
> therefore still names exactly one of `user` or `agent` on every commit, and
> `git log --author` still answers "who changed this" exactly — the accepted
> cost is that a stretch where both parties work at once produces more commits,
> not fewer.
>
> **What closes a window.** A window closes when a discrete act completes — an
> act being a change someone else can act on, as against a body edit that is
> merely underway:
>
> - an agent turn posted to a thread;
> - a thread resolved or reopened;
> - a document archived, restored, moved, renamed, or marked still current (§5);
> - a queue event finished, however it finished — completed, failed, deferred
>   (§7) or abandoned;
> - a document deleted, or a staged bulk Save applied (§11) — these two close the
>   window and then commit **separately**, below;
> - the other party writing;
> - an edit session ending (the edit acknowledgment above) — its event names a
>   commit range, so the range has to be in git before the event exists;
> - the history being read back — a diff, a revert, anything naming a commit,
>   below;
> - things going quiet: the same short idle window that folds repeated saves
>   today;
> - the window growing old, below;
> - the server stopping cleanly.
>
> For the first four, the act's own change is the **last thing in
> the window's commit**, and the commit's subject names the act. The agent's
> stewardship for one queue event is then one commit holding every document it
> touched and saying which thread it answered — rather than one commit per
> document touched, which is the fragmentation this replaces. A window that
> closes with no act to name says so: that it is an editing session, and how many
> documents it holds.
>
> **What does not close a window.** An ordinary save of a document body — the
> autosave §11 describes — never closes one, whichever document it is to. Nor
> does opening or closing a reader, acquiring, renewing or releasing an edit
> lock, a projection or index pass, a job-log line, a read-state mark, or any
> read that does not touch git history. These are exactly the changes a window
> exists to gather.
>
> **No window stays open indefinitely.** Activity keeps a window open, but only
> so far: once a window has been open long enough it commits anyway, however busy
> it has stayed, and a fresh one takes over. So an unbroken hour of writing is
> several commits rather than one — each saying in its subject that it is an
> editing session, since no act closed it — and an unclean stop costs a boundary
> rather than a session's work. How long is deliberately not fixed here, for the
> same reason the idle window's length is not: what is being guaranteed is that
> a window ages out, not the number it ages out at.
>
> **Three acts commit alone.** A **deletion** closes the open window, lets that
> commit land, and then commits the deletion by itself: a document created and
> deleted inside one window would otherwise leave nothing in git to recover
> from, and §7's "deletion is user-only, git preserves history" would be false
> rather than merely coarse. A **bulk Save** likewise flushes first and then
> lands as the single commit "One action, one commit" requires, so reverting it
> still undoes that action and nothing else. A **force unlock** (§7) records its
> audit entry alone, after flushing whatever the agent wrote under the lock
> being broken — the agent's work reaches git under the agent's name, before the
> break that ended it.
>
> **Nothing reads a history the window is still holding.** Any operation that
> names, reads or reverts a commit closes the open window before it runs. So
> `corpus doc diff` always shows the change it was asked about, `corpus skill
> rollback` always reverts the version the person just saw, and an edit
> acknowledgment's commit range is always already in git when the agent receives
> it. Where several documents share one window commit, each document's
> acknowledgment names that same commit and each diff is path-scoped, so every
> event still answers about its own document. The one reader that cannot be
> flushed is `git log` run by hand in a terminal outside Corpus: it lags by at
> most one open window.
>
> **An out-of-band edit belongs to the person at the machine.** A change the
> watcher picks up from outside the server (§9.1) is a `user` edit: it closes the
> agent's window if one is open, then joins — or opens — the user's, exactly like
> editing in the board. Nothing about it is an act and nothing announces it, so
> the idle window is what commits it. An external editor that saves as you type
> therefore produces a commit per editing session, as the board does, and not one
> per save.
>
> **A window never outlives the server silently.** A clean stop commits the open
> window. An unclean stop leaves those changes on disk — where §5 says the truth
> lives, so what is lost is the boundary and not the work — and the **next server
> start commits them as a recovery commit**: one whose subject says it is
> recovering changes left uncommitted by a previous run, and how many documents
> it holds, so no reader mistakes it for an ordinary one. It is scoped to the
> workspace's own document roots and never sweeps up unrelated files an operator
> left dirty. It claims **no party** as its author — which party's window was
> open is precisely what the unclean stop destroyed, and `git log --author=user`
> must not gain a commit no person made. It is the **one** commit in a workspace
> that carries no acting party: §7's rule that every change does holds everywhere
> else, and this single exception is deliberate, because the alternative is a
> commit that names a party the server is guessing at. A start with nothing to recover commits
> nothing and says nothing. A window commit git itself refuses (§14) discards no
> work either: the changes stay on disk and are gathered into the next window
> that closes.
>
> **The costs, plainly.** History is coarser on purpose, and five things follow
> from that.
>
> A window belongs to a party rather than to a document, so its commit gathers
> everything that party changed while it was open: **a document's history now
> shows commits that also touched its neighbours** — for ordinary editing as much
> as for an act, and reverting one such commit takes the neighbours with it. That
> is the same trade "One action, one commit" already accepts for a bulk Save,
> extended to the window rather than invented here, and it has the same answer:
> the message names what the commit was, so the history stays legible from both
> directions.
>
> Anchor drift (§6) is recovered from git, and one window's commit may hold
> several rounds of remapping, so recovery lands at the window rather than at the
> save — fewer points to recover from than today.
>
> A window holds work outside git for as long as it stays open: longer than
> today, bounded by the idle window, by the ageing-out above, and by the server's
> own stop.
>
> An event deferred on a lock (§7) ends the agent's window like any other ending,
> so **one act that resumes later lands as two commits** — accepted, rather than
> hold a window open across a wait of unknown length during which the other party
> may write.
>
> And both parties working at once flushes on every handover, which produces more
> commits than a scheme that ignored authorship — accepted, because an exact
> `git log --author` is worth more than a short log.

---

## Acceptance Criteria

- [x] Read aloud to the user on its own, verbatim, separately from SHARED-024 …
      SHARED-038
- [x] The six questions the draft raised answered and folded into the text
      (2026-08-09) — see "Decisions Folded In"
- [x] User signs off, or amends — **signed 2026-08-10, as drafted**
- [x] Applied to §4 with the `_(Rider signed YYYY-MM-DD.)_` marker, replacing the
      "Autosave and commit granularity" paragraph and leaving "One action, one
      commit" intact
- [x] Contradiction sweep recorded (below)
- [x] Follow-on SERVER issues filed against the signed text — SERVER-091 … 094

## Decisions Folded In (do not reopen)

All six questions this draft raised were answered on 2026-08-09 — four by the
user, two adjudicated by the orchestrator — and the held text above is final on
each. Recorded so the implementer and the reviewer read the same rulings.

1. **The editing window spans documents** (user). Party-scoped, as drafted. The
   consequence is stated plainly in the rider's costs: a document's history now
   shows commits that also touched its neighbours — the same trade "One action,
   one commit" already accepts for a bulk Save, not a new one.
2. **The recovery commit claims no party** (user). Stated in the rider as §7's
   sole and deliberate exception to "every change carries the acting party", not
   as a contradiction left for later; the sweep below records it that way.
3. **A window ages out** (user, new text). Added as the "No window stays open
   indefinitely" paragraph: a window commits once it has been open long enough
   regardless of continuing activity, so a crash costs a boundary rather than a
   session. The interval is deliberately **not pinned in the spec**, following
   the idle window's precedent — what a reader observes is that a long unbroken
   writing session produces several commits whose subjects say they are editing
   sessions.
4. **A deferral closes the agent's window** (user), consistent with "a queue
   event finished, however it finished". Its cost — one act that resumes later
   lands as two commits — is stated in the rider's costs.
5. **"Marked still current" closes a window** (orchestrator adjudication). A
   status change is something others act on.
6. **The idle interval stays unpinned** (orchestrator adjudication). The draft's
   "the same short idle window" is right; no number reaches SPEC.md.

## Technical Design

Spec text only — no code in this issue. Recorded so the follow-on SERVER issue
starts from the right shape.

### Files to Create/Modify

- `SPEC.md` §4 — **only after sign-off**, and by the orchestrator.

### Key Implementation Details

The drafted behaviour is a generalization of what
`apps/server/src/git/commit.ts` already does, not a rebuild:

- `SessionRecord` (`docId`, `actor`, `sha`, `at`, anchor sets) becomes the open
  window: **drop `docId` from the fold key**, keep `actor`, and accumulate the
  set of document ids seen so the commit can carry one `Corpus-Doc` trailer per
  document (`buildTrailers` already emits a trailer per id).
- `amendTarget`'s existing refusals are all still correct and still needed —
  detached HEAD, mid-operation, published, HEAD moved under us, trailer mismatch.
  The `record.docId !== request.docId` check is the one that goes; the
  `record.actor !== request.actor` check becomes the party-change flush.
- `docIds` (the "act over a named set" signal) already means "this commit neither
  folds into a preceding session nor opens one" — that is exactly the "commits
  alone" behaviour the deletion, bulk Save and force-unlock paragraph needs.
- `endSquashSession(sha)` is already the flush primitive and is already called
  where a sha escapes the repository (edit acknowledgment). The read-back rule
  extends its call sites to the diff route, `skill rollback`, and the lock break.
  It currently only *forgets*; the rider needs it to also **commit** what the
  window holds, which is the one genuinely new capability.
- `squash: false` already exists as the per-request opt-out.
- Clean-stop flush hangs off the server's existing disposer chain
  (`apps/server/src/app.ts` `onDispose`).
- Boot recovery is new.

**Today's out-of-band behaviour — verified 2026-08-09, since the rider's
out-of-band paragraph has to be a change *from* something.** The watcher
reconciles anchors and rewrites the file with `writeAtomically`
(`apps/server/src/watcher/reconcile-out-of-band.ts:138`), bypassing the commit
path entirely; its log line records `commit: "deferred"` beside the comment
"The `reconcile:` commit is SERVER-005's". That comment does not hold: SERVER-007
step 5 specified an auto-commit `reconcile: anchors on <docId> after external
edit`, no such subject exists anywhere in `apps/` (only test names and that log
line match), and SERVER-005's write paths commit their own mutations, not the
watcher's. So **no commit is made for an out-of-band edit**. It reaches git only
incidentally: the commit path stages with `git add -A -- <paths>`, so the *next*
server mutation to that same document sweeps the earlier out-of-band content
into its own commit, under that mutation's actor and subject. Absent a later
mutation, the edit stays uncommitted indefinitely.

That is a defect on its own terms — an edit attributed to whoever happened to
touch the document next — and is being reported to the orchestrator separately
for its own issue. **It is not a justification for this rider**, and the rider's
text makes no claim about it: the out-of-band paragraph simply states the
behaviour windows give it (a `user` edit that joins the user's window and is
committed when the window closes). Whether that follow-on issue lands before or
after this rider, the rider's paragraph is the target state either way.

### Edge Cases

- A window open when the party changes, where the second party's write then
  fails validation (§14): the flush already happened; the failed write adds
  nothing. Acceptable — one extra commit, never a wrong one.
- A deletion with no window open: no flush commit, just the deletion.
- A recovery commit racing an operator's own `git commit` at boot: recovery is
  path-scoped to the document roots, so it stages only what it names.
- Repository states where no commit is possible at all (detached HEAD,
  mid-rebase): unchanged from today — the mutation stands, uncommitted, and the
  next window or the next boot recovery picks it up.

## Testing Strategy

N/A for this issue — spec text. The follow-on SERVER issue carries it.

## E2E Verification Plan

N/A.

## E2E Verification Log

_N/A — spec rider, no code._

## Contradiction Sweep — run 2026-08-10, after applying

Line numbers are post-application. **One live contradiction found** (item 2);
everything else confirmed clear, with the reasoning recorded so it is not re-run
from scratch.

1. **§4 line 135 — "Every mutation the server performs auto-commits the affected
   files … with the acting party as git author."** _Clear._ Still true in both
   halves: every mutation still reaches git, and still under its party. What
   changed is only what "auto-commits" does next — the mutation enters the open
   window rather than standing alone. The sentence never said "each on its own",
   so nothing needs striking, and line 137 opens by saying exactly that ("Every
   mutation still auto-commits, but no longer each one on its own"), which is the
   bridge between the two.

2. **§4 line 179 — "One action, one commit."** ❌ **Live contradiction.** The rule
   survives, as the rider says. But its justification clause does not:

   > "A bulk commit is its own entry in the history: it never folds into a
   > preceding editing session's squashed commit, and no later save folds into it
   > — **the squashing above is about repeated saves of one document, never about
   > one act across many.**"

   "The squashing above" is now line 137's commit window, which is scoped to a
   **party** and spans documents by design. So the clause states as fact the very
   mechanism this rider replaced. The *rule* is untouched and "Three acts commit
   alone" restates it; only the em-dash clause is stale. **Held for sign-off as a
   one-clause corrective amendment** — see below. Not applied unilaterally: it is
   SPEC.md text and the rider explicitly promised line 179 would stay as it is.

3. **§4 line 181 — edit acknowledgment.** _Clear._ "A distinct and longer window
   than the commit-squash idle above" still reads correctly against the window's
   idle. `endedBy: "close" | "idle"` is code, not spec, and edit sessions remain a
   separate concept from commit windows — a window closing does not end an edit
   session. Several documents sharing one commit is handled in the rider's own
   text ("each document's acknowledgment names that same commit and each diff is
   path-scoped"); SERVER-093 carries it as an acceptance criterion, including the
   `stats` computation, which was correct only by accident while one commit meant
   one document.

4. **§7 line 348 — "auto-commits with the acting party as git author, so `git log`
   is a complete audit trail."** _Recorded as a deliberate exception_, decided by
   the user 2026-08-09, and declared in §4's own text rather than resolved here.
   §7 is **not** reworded. The residual cost, stated plainly: a reader of §7 alone
   meets an absolute that has one exception three sections earlier. A one-clause
   cross-reference would fix that and is offered alongside item 2 — it changes no
   behaviour and is purely a reader's-path repair.

5. **§7 line 370 — `corpus skill rollback` ("a targeted git revert").** _Clear._
   The spec sentence is about what rollback does, not about when the history it
   reads is settled. The flush is an implementation obligation, and it is
   SERVER-093's first-class acceptance criterion.

6. **§9.2 line 423 — the diff route, "Read-only; no acting party."** _Clear, and
   this is the one a reviewer may push back on, so the reasoning is recorded._
   Under the read-back rule this `GET` can cause a commit — it closes the open
   window before reading. "Read-only" is a claim about the **document surface**:
   the route changes no document, creates none, and takes no `x-corpus-author`.
   Closing a window amends the message of a commit the server itself just made
   and has not published. §4 declares the effect explicitly at line 161 ("Any
   operation that names, reads or reverts a commit closes the open window before
   it runs"), so it is stated where it is caused. No §9.2 change.

7. **§14 — "the file mutation stands" when a commit fails.** _Clear._ The rider's
   "A window commit git itself refuses discards no work either: the changes stay
   on disk and are gathered into the next window that closes" is §14's rule
   applied to windows, not an exception to it.

8. **§2.2 rule 4 — bootstrap-class operations write with the server stopped.**
   _Clear, and better than expected._ The concern was that boot recovery would
   sweep up `corpus workspace upgrade`'s deliberate writes under no author. It
   will not: §2.4 line 35 and §2.4 line 86 **both** require that everything the
   upgrade wrote "lands as a single attributed git commit", so the tree is clean
   before the server boots. `corpus init` likewise ends on its own bootstrap
   commit (CLI-002). SERVER-094 carries this as a verify-against-the-code item
   rather than a spec question — if the upgrade does not in fact commit, recovery
   would paper over it under no author, which is worse than the gap.

## SIGNED — corrections (a), (b) and (c) applied 2026-08-10; (d) signed and applied 2026-08-13

The user signed (a) and (b) as drafted, and on (c) chose **any turn** — the word
`agent` struck from §4's first closer, and `threads/turns.ts` now sets the act
for either party. (d) was raised after the others, read aloud on its own on 2026-08-13 and
signed as drafted, then **corrected the same day** after PR #46's review found
two absolutes in it that the code does not honour (user authorized the fix):

- *"this closer **alone** closes the window without renaming its commit"* —
  `closeWindowLocked` also leaves the last subject whenever the relabel amend
  cannot be made: a detached head, a repository mid-operation, a commit already
  published, or a workspace hook that refuses it. The design claim is right, the
  absolute was not. §4 now says it is the only closer that declines the rename
  *by design*, and that from `git log` the two cases are indistinguishable.
- *"the subject of **the save that ended it**"* — no save ends it; the edit
  session does. It keeps the subject of the window's **last save**, which may
  name a different document than the session that ended. This issue's own
  artefact is exactly that case (`ea3c60b doc edit: Beta doc … by user` on a
  commit holding two documents, closed by the *other* document's
  acknowledgment), so the drafted sentence contradicted the evidence beneath it.

The signed clause is otherwise unchanged; the clause is in §4's "What closes a window" list, on the
edit-session entry. The disclosability caveat was read aloud with it and
accepted: a commit closed this way looks like an ordinary single-document edit
in `git log`.

### The corrections, as read aloud

Neither changes behaviour. Both are consequences of this rider that live in
*other* paragraphs, which is exactly what a sweep is for.

**(a) §4 line 179 — strike the stale justification.** Replace:

> — the squashing above is about repeated saves of **one** document, never about
> one act across many.

with:

> — the window above gathers a party's ordinary saves, and an act is not a save.

**(b) §7 line 348 — one cross-reference, so the absolute is not read alone.**
After "so `git log` is a complete audit trail", add:

> (with one deliberate exception, named in §4: the recovery commit a server makes
> after an unclean stop claims no party, because which party was writing is what
> the unclean stop destroyed)

**(c) §4's first closer — does "an agent turn" mean the agent's turns, or any
turn?** Raised by SERVER-092 during implementation, 2026-08-10. §4's list of what
closes a window opens with:

> - an agent turn posted to a thread;

Every other entry names an act without a party: "a thread resolved or reopened",
"a document archived, restored, moved, renamed". Only this one carries a
qualifier, and it is load-bearing either way.

**Settled and shipped as "any turn".** This paragraph previously recorded the
pre-signature state — `threads/turns.ts` setting the act only for
`actor === "agent"` — and was left stale when the user struck the word `agent`
on 2026-08-10. Verified against the code 2026-08-12: `turns.ts` sets the act for
either party, and says so in a comment citing the sign-off. Nothing is waiting.

But the qualifier sits badly against §4's own definition two lines above it — "an
act being a change someone else can act on, as against a body edit that is merely
underway". A person's comment is unambiguously the former: it is addressed to the
agent, and under §8 it is what wakes the agent. Under the current reading, a
person who comments and then keeps editing gets that comment folded into
`editing session: 3 documents by user` rather than a commit that says a comment
was posted.

The practical difference is narrower than it looks — when the agent answers, the
party-change flush closes the user's window anyway — so this only bites where the
agent never picks the comment up. Two ways to settle it, both one word:

> - a turn posted to a thread;

or leave it as it stands, in which case the asymmetry deserves a clause saying
why a person's turn is deliberately not an act.

**(d) A window closed by an edit session ending keeps the last save's subject.**
Raised by PR #42's review as a MINOR and confirmed by the implementer, 2026-08-10.
§4 lists "an edit session ending" among what closes a window, and says a window
that closes with no act to name "says so: that it is an editing session, and how
many documents it holds". That one closer does **not** relabel — `endSquashSession`
only forgets. So a three-document window closed by a reader flush ships as
`doc edit: <third title> by user`, naming one document while holding three. A live
artefact from the implementer's E2E: `ea3c60b doc edit: Beta doc (doc_nu4iwmez) by
user` on a commit holding two documents, where the *other* document's
acknowledgment is what closed it.

**The recommendation is to amend the spec, not the code**, and the reasoning is
worth reading before deciding, because the obvious objection has already been
answered. It is *not* simply "you cannot amend a sha you have just published" —
that order can be inverted (close, settle, then publish). The binding constraint
is that `end()` is **synchronous and lock-free by design**: it must get in front
of a save landing while the emitter's git reads are in flight. Relabelling needs
the git lock, so `end()` becomes async, and in the gap an autosave folds into the
very window the acknowledgment is about to publish — the hazard the forget exists
to prevent. Making it correct needs a new two-part primitive (synchronous seal,
then an asynchronous relabel of the sealed sha, with the emitter reading after
it), which reopens the ordering question the SERVER-093 ruling settled once
already.

Proposed clause, appended to §4's "What closes a window" list where the edit
session entry sits:

> — an edit session ending closes the window **without** renaming its commit,
> because the range naming that commit is about to leave the repository and may
> not move under it; so such a commit keeps the subject of the save that ended
> it, and its `Corpus-Doc` trailers are what name the rest.

Not disclosable as-is: §4's sentence is a property of *the history*, and a person
running `git log` cannot tell which closes were exempt.

## Completion Checklist (orchestrator)

- [x] Read aloud verbatim, on its own, separately from the other held riders — (a)(b)(c) on 2026-08-10, (d) on 2026-08-13
- [x] The draft's six questions answered and folded in (2026-08-09)
- [ ] Separate defect issue filed for uncommitted out-of-band edits (see Key
      Implementation Details) — independent of this rider
- [ ] Signed by user
- [ ] Applied to SPEC.md §4 with signature marker
- [ ] Contradiction sweep recorded here
- [ ] Follow-on SERVER issue filed
- [ ] Committed with `[SHARED-040]` prefix
