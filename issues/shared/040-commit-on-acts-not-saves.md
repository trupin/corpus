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
- Blocks: (a SERVER-\* issue to be filed once the text is signed — the change is
  entirely in `apps/server/src/git/commit.ts` and its callers)

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

- [ ] Read aloud to the user on its own, verbatim, separately from SHARED-024 …
      SHARED-038
- [x] The six questions the draft raised answered and folded into the text
      (2026-08-09) — see "Decisions Folded In"
- [ ] User signs off, or amends
- [ ] Applied to §4 with the `_(Rider signed YYYY-MM-DD.)_` marker, replacing the
      "Autosave and commit granularity" paragraph and leaving "One action, one
      commit" intact
- [ ] Contradiction sweep recorded (below)
- [ ] Follow-on SERVER issue filed against the signed text

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

## Contradiction Sweep (to record at sign-off)

- §4 line 135 — "**Every mutation** the server performs auto-commits the affected
  files": still true (every mutation reaches git), but "auto-commits" now means
  "enters the open window". Confirm the sentence does not need "each on its own"
  struck out explicitly.
- §4 line 139 — "One action, one commit": unaffected; "Three acts commit alone"
  restates its guarantee. Confirm the older sentence "A bulk commit … never folds
  into a preceding editing session's squashed commit, and no later save folds
  into it" reads correctly against windows (it does: the bulk act flushes the
  window and opens none).
- §4 line 141 — edit acknowledgment: the `doc.edited` range is now always
  flushed-then-named; confirm `endedBy: "close" | "idle"` still describes the two
  paths, and that several documents sharing one commit is acceptable in the
  event payload's `stats`.
- §7 line 308 — "Every change leaves a visible trace … auto-commits with the
  acting party as git author": the recovery commit is the one commit with no
  acting party. **Recorded as a deliberate exception, decided by the user
  2026-08-09** — not a contradiction to resolve later. The rider names it as
  §7's sole exception in its own text; the sweep's only job here is to confirm
  §7's sentence is not additionally reworded, since the exception is already
  declared where it is made.
- §7 line 330 — `corpus skill rollback`: now flushes before reverting. Confirm.
- §9.2 line 383 — the diff route: now flushes before reading. Confirm a read
  endpoint being allowed to cause a commit is acceptable (it is the crux of the
  read-back rule).
- §14 — "the file mutation stands" when a commit fails: confirm the drafted
  "gathered into the next window that closes" does not contradict it.
- §2.2 rule 1 (files are the source of truth) and rule 4 (bootstrap-class
  operations write directly with the server stopped — `corpus init`,
  `corpus workspace upgrade`): confirm boot recovery does not surprise an
  upgrade that deliberately wrote files with the server down.

## Completion Checklist (orchestrator)

- [ ] Read aloud verbatim, on its own, separately from the other held riders
- [x] The draft's six questions answered and folded in (2026-08-09)
- [ ] Separate defect issue filed for uncommitted out-of-band edits (see Key
      Implementation Details) — independent of this rider
- [ ] Signed by user
- [ ] Applied to SPEC.md §4 with signature marker
- [ ] Contradiction sweep recorded here
- [ ] Follow-on SERVER issue filed
- [ ] Committed with `[SHARED-040]` prefix
