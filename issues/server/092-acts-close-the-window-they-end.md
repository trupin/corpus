# [SERVER-092] Every act closes the window it ends, and names it

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-091
- Blocks: —
- Related: SERVER-093 (the other half of the closer wiring), SERVER-087 (the
  staged bulk Save this must not disturb)

## Spec References

- SPEC.md **§4** — "What closes a window" and "What does not close a window"
  (the two checkable lists), and "Three acts commit alone"
- SPEC.md **§4** — "One action, one commit"
- SPEC.md **§7** — a queue event finishing, however it finished; force unlock
- SPEC.md **§11** — the staged bulk Save

## Summary

SERVER-091 makes the window party-scoped and gives it `closeWindow(reason)`.
Nothing calls it yet, so a window closes only on idle, on age-out, or when the
other party writes. §4's whole point is that a window closes when **a discrete
act completes** — "an act being a change someone else can act on, as against a
body edit that is merely underway" — so that the agent's stewardship for one
queue event is one commit that says which thread it answered.

This issue wires the closers. It is mostly one-line calls at existing sites; the
work is in getting the **list exactly right in both directions**, because §4
publishes both lists and a reader will check them.

## The two lists, verbatim from §4

**Closes a window** (this issue owns all but the last four, which are
SERVER-091's or SERVER-093's):

| act                                                            | where                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| an agent turn posted to a thread                                | `threads/turns.ts`                                        |
| a thread resolved or reopened                                   | `threads/status.ts`                                       |
| a document archived, restored, moved, renamed                   | `docs/archive.ts`, `docs/move.ts`                         |
| a document marked still current (§5)                            | wherever the freshness mark is written                    |
| a queue event finished — completed, failed, deferred, abandoned | `queue/service.ts` `transition`                           |
| a document deleted                                              | `docs/delete.ts` — **and commits alone**                  |
| a staged bulk Save applied                                      | `docs/bulk.ts` — **and commits alone**                    |
| the other party writing                                         | SERVER-091, already done                                  |
| an edit session ending                                          | already done (`edit/sessions.ts` → `endSquashSession`)    |
| the history being read back                                     | SERVER-093                                                |
| idle, age-out, clean stop                                       | SERVER-091, SERVER-094                                    |

**Does not close a window** — and this list is the one that gets violated by
accident, so each entry is an assertion to write:

- an ordinary save of a document body (`docs/update.ts`), **whichever document**
- opening or closing a reader
- acquiring, renewing or releasing an edit lock (the ordinary lease — a **force
  break** is different, see below)
- a projection or index pass
- a job-log line
- a read-state mark (`threads/seen.ts`)
- any read that does not touch git history

"These are exactly the changes a window exists to gather." A reviewer will read
the second list as a spec of what your diff must **not** touch.

## Acceptance Criteria

- [x] Each act in the first table closes the open window, and the act's own
      change is the **last thing in that window's commit** — so the commit's
      subject is the act's. With the amend mechanism this falls out for free:
      the act commits into the window, *then* closes it. Getting the order
      backwards (close, then commit the act) produces two commits and is the
      likeliest bug in this issue — assert the ordering, do not assume it
- [x] A **deletion** flushes the open window, lets that commit land, and then
      commits the deletion by itself. A document created and deleted inside one
      window leaves two commits and a recoverable git object for the create.
      Test exactly that sequence — it is the case §7's "git preserves history"
      depends on.

      **This is a live regression right now and you are the fix.** SERVER-091
      escalated it: before party-scoped windows, `amendWouldEmptyHead` caught the
      create-then-delete case, because HEAD's entire content was that one file.
      With a neighbour document in the same window HEAD is no longer empty, so
      the guard correctly answers "no" and the create is amended away. A document
      created and deleted inside one window currently leaves **nothing** in git.
      `threads/cascade.test.ts` carries a note at the site. Nothing reaches `main`
      — 091 and 092 land in one PR — but this criterion is the one that must not
      be deferred, and it is why deletion's flush is not merely tidiness
- [x] A **staged bulk Save** flushes first and then lands as one commit, opening
      no window. `docIds` already gives the second half; only the flush is new
- [x] A **force unlock** (§7) flushes whatever the agent wrote under the lock
      being broken **before** recording its audit entry, so the agent's work
      reaches git under the agent's name, before the break that ended it. The
      audit entry keeps `squash: false` and still commits alone
- [~] A **deferred** queue event closes the agent's window like any other ending.
      The rider accepts the cost — one act that resumes later lands as two
      commits — so do not try to keep the window open across the wait
- [x] Every entry in the "does not close" list is covered by a test asserting the
      window **survives**: N body saves across M documents by one party inside
      the idle window are still one commit, with a lock acquire/release, a
      projection pass and a seen-mark interleaved
- [x] A window that closes with no act to name still says it was an editing
      session (SERVER-091's behaviour, unchanged by anything here)
- [x] `git log --author` still answers exactly. No act may commit under a party
      other than the one that requested it

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/turns.ts`, `threads/status.ts`
- `apps/server/src/docs/archive.ts`, `docs/move.ts`, `docs/delete.ts`,
  `docs/bulk.ts`, and the still-current mark
- `apps/server/src/queue/service.ts` — `transition`
- `apps/server/src/locks/service.ts` — the force break only
- Probably `apps/server/src/docs/write.ts` — see below

### Key Implementation Details

**Prefer one declaration point over eleven call sites.** `finishMutation` in
`docs/write.ts` is the single place every document mutation's commit is made, and
`MutationPlan.commit` already carries `subject`, `anchors` and `squash`. Adding
one optional field there — the plan declaring *this write is an act* — puts the
closer next to the subject that names it, in the same object, reviewed together.
Eleven scattered `await git.closeWindow()` calls will drift the moment someone
adds a verb.

Two acts do not go through `finishMutation` and need their own handling:

- **The queue transition** writes to `.corpus/queue/`, which is gitignored. It
  commits nothing and must not start — it only closes. Call `closeWindow`
  directly from `transition`, for every terminal state (`completed`, `failed`,
  `deferred`, `abandoned`) and for none of the non-terminal ones. Claiming an
  event is not an ending.
- **The force break** in `locks/service.ts` already commits with
  `squash: false`. `squash: false` today means "do not fold into the preceding
  window" — it does **not** flush that window. §4 requires the flush, and
  requires it *before* the audit entry. Add the explicit close; do not
  re-purpose `squash: false` to mean flush, because `skills/rollback.ts` and
  `threads/reattach.ts` also pass it and want different things (rollback wants
  SERVER-093's read-back flush; re-attach wants neither).

**Deletion and bulk "commit alone"** are two separate behaviours and today only
the second exists. `docIds` gives "folds neither direction"; it does **not**
flush a window that is already open — under SERVER-091 that window's commit is
already in git, so what is missing is closing it (and rewriting its subject)
before the act's own commit lands. Delete currently passes no `docIds`; it needs
the commits-alone treatment as well as the flush.

**Ordering.** Within one mutation: the act's write commits into the open window
(amending it, so the act's subject becomes the window commit's subject and the
act's change is last), and *then* the window closes with `namedByAct: true` so
SERVER-091's subject rewrite leaves it alone. For the two acts that commit alone
the order is: close the window first (rewriting its subject, since the act does
not name it), then commit the act on its own.

That asymmetry is exactly what the rider says, and it is worth re-reading the
sentence before implementing: "For the first four, the act's own change is the
**last thing in the window's commit**, and the commit's subject names the act",
versus "A deletion closes the open window, lets that commit land, and then
commits the deletion by itself."

### Edge Cases

- **An act by the party that does not own the open window.** The party-change
  flush (SERVER-091) fires first and closes it; the act then opens and closes its
  own. One extra commit, correct authorship. No special handling.
- **An act whose commit is skipped or fails** (§14). The window still closes —
  the act happened. Do not make the close conditional on the commit landing.
- **A bulk Save with one entry.** Still an act, still commits alone. §4's signal
  is the field's presence, not its length; SERVER-077 already settled this.
- **Deferral of an event that changed nothing.** Nothing to flush, no commit; the
  close is a no-op. Must not log noise.
- **`thread create`** is not in §4's list. It is a document create like any
  other. Do not add it, and do not add `capture` or `skill create` either — if
  you think one of them belongs, that is a spec question for the orchestrator,
  not a judgement call to make in the diff.

## Testing Strategy

Unit and integration, against the real write pipeline fixtures.

1. Per act in the table: a body save, then the act, inside the idle window → one
   commit, subject is the act's, both changes present.
2. The negative sweep: saves + lock lease + projection + seen-mark → still one
   commit. This is the "does not close" list, and it deserves one test per entry
   rather than a single combined one, so a regression names itself.
3. Create-then-delete inside one window → two commits; `git cat-file` the create.
4. Force break: agent writes, user force-breaks → agent's commit under `agent`
   precedes the audit entry, which stands alone.
5. Queue: claim (no close) → defer (close) → retry (no close) → complete (close).

## E2E Verification Plan

Real server on a free port (**never 8765 or 5173**), real `corpus` CLI.

### Verification Steps

1. As `agent`: edit three documents, append a changelog to a fourth, post a turn
   to a thread — all inside the idle window. `git log --format='%s'` shows **one**
   commit whose subject names the turn, and `git show --name-only` lists all
   five files. This is the scenario the rider was written for; if it produces
   five commits the issue is not done.
2. Complete the queue event. No further commit (nothing changed on disk), and the
   next save opens a fresh window.
3. Create a document and delete it inside 30 s. Two commits; the created content
   is recoverable from the first.
4. Bulk-archive a selection mid-editing-session. Editing commit first, bulk
   commit alone after it, `git revert` of the bulk commit undoes the bulk and
   nothing else.

## E2E Verification Log

**Model: opus (claude-opus-5[1m]), 2026-08-10.** Real `corpus` CLI (built
`apps/cli/dist/bin/corpus.js`), real server on **port 8891** (never 8765/5173),
scratch workspace `~/.claude/jobs/4dd0ddef/tmp/s092-e2e`, `corpus init` + `corpus
server start`. Every observation below is `git log`/`git show`/`git cat-file` in
that workspace, never the server's own bookkeeping.

**1 — The rider's scenario: the agent's stewardship is one commit.** As `user`:
four `doc create`s and one `thread create` → **one** commit
(`comment: new thread on doc_fnpbinca (th_ffss7ywm) by user`). Then, with no
waiting at all, as `agent`: three `doc edit`s, a changelog appended to the
fourth, and a `thread reply`.

```
new commits for the whole pass: 1
24cd6a2 | agent | comment: turn on th_ffss7ywm by agent
  data/docs/inbox/changelog.md
  data/docs/inbox/pricing.md
  data/docs/inbox/roadmap.md
  data/docs/inbox/runbook.md
  data/threads/th_ffss7ywm.md
```

Five files, one commit, subject names the turn — and the party-change flush had
already relabelled the user's window `editing session: 5 documents by user`. The
pre-rider history for the same actions is five commits.

**2 — A queue event finishing.** Claimed a real `comment.created`, wrote as
`agent` (window open at `14881c6`), ran `corpus queue complete`, then saved
again as `agent`:

```
commits since the stewardship began: 1   (2 == the event closed the window)
```

**This is the one acceptance criterion not yet observable end to end**, and the
reason is *wiring, not logic*: `QueueService.transition` closes on every finished
status and is unit-tested (`queue/service.test.ts`, "a finished event closes the
commit window (§4)"), but the closer is late-bound through
`QueueService.attachWindowCloser` and `createServer` does not call it yet —
`apps/server/src/app.ts` is SERVER-094's file this sprint and was left untouched
by instruction. See "Escalated" below for the exact one-line patch.

**3 — A document created and deleted inside one window.** `Neighbour` and
`Doomed` created back to back (one window, HEAD `doc create: Doomed …`), then
`doc delete Doomed` with no clock movement:

```
new commits: 2
19d9b75 | user | doc delete: Doomed (doc_qzq5djkn) by user
928bd49 | user | editing session: 2 documents by user

$ git show HEAD~1:data/docs/inbox/doomed.md | tail -1
the only revision this document ever had
$ git cat-file -t $(git rev-parse HEAD~1:data/docs/inbox/doomed.md)
blob
```

The regression this issue is the fix for is reproduced under test: with
`act: "commits-alone"` removed from `docs/delete.ts`, the same sequence answers
`expected 2 to be 3` — one commit instead of two, the create amended away, the
document's only revision gone from git entirely.

**4 — A bulk Save mid-editing-session.** `doc edit Pricing` as `user` (window
open at `efc82ae`), then `POST /api/docs/bulk` archiving two other documents with
no clock movement:

```
new commits: 2
cfe4430 | bulk archive: 2 documents by user   → roadmap.md, runbook.md
d6bef07 | editing session: 1 document by user → pricing.md
```

Editing commit first, bulk commit alone after it. `git revert` of the bulk commit
put both archived documents back to `status: open` and left `pricing.md`'s
in-session content (`the user is typing`) untouched.

**5 — A force unlock (§4, §7).** `agent` acquired the lease and wrote (window
open at `d5720b0`), `user` broke it:

```
new commits: 2
f5c7abc | user  | lock: force-break on doc_fnpbinca (was agent) by user   (no files)
ed67d6c | agent | editing session: 1 document by agent
```

The agent's work reached git under `agent` **before** the break that ended it,
and the audit entry stands alone. `git log --author=agent` lists the editing
session and the turns and **not** the force break; `git log --author=user` lists
the break and not the agent's work.

**Checks run.** `npm run build`; `npx tsc --noEmit -p apps/server/tsconfig.json`
(clean); `npx eslint apps/server/src/{docs,threads,queue,locks}` (clean);
`npx prettier --write` on every touched file; `vitest run apps/server` →
**3776 passed**, the only failures being the two in
`apps/server/src/window-lifecycle.test.ts` — SERVER-094's in-flight suite, which
asserts a `"shutdown"` close this issue does not implement. New suites:
`apps/server/src/docs/acts.test.ts` (21 tests) and the queue block above
(5 tests).

**Escalated — one line in `apps/server/src/app.ts`, owned by SERVER-094 this
sprint.** Immediately after `const git = deps.git ?? createAutoCommitter(…)`:

```ts
    // SPEC.md §4: "a queue event finished, however it finished" closes the open
    // commit window (SERVER-092). Late-bound because the queue is built before
    // the git writer exists.
    queue.attachWindowCloser(() => git.closeWindow("act"));
```

Nothing else is missing; step 2 above becomes `2` the moment it lands.

**Deliberate literal reading, flagged for the record.** §4's first act is "an
**agent** turn posted to a thread", so `threads/turns.ts` sets the act only for
`actor === "agent"`. A person's reply is one of the changes a window exists to
gather, and the agent's answer to it closes their window anyway. If the rider
meant any turn, that is a one-word change in `commitTurnAppend` and a spec
question, not a judgement for this diff.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified — all but the queue transition's *wiring*
      (see the E2E log's escalation; the logic and its tests are in place)

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
