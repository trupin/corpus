# [SERVER-106] §4 says archiving closes a window; archiving through `PUT` does not

## Domain

server

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Related: SHARED-040 (§4's act list), SHARED-030 (§10's frontmatter form),
  SERVER-092 (wired the act closers)

## Spec References

- SPEC.md **§4** — "a document archived, restored, moved, renamed, or marked
  still current (§5)" closes a commit window
- SPEC.md **§10** — the frontmatter form carries `title`, `tags`, `status`, `due`

## Summary

Found while correcting a wrong repair of my own during PR #44's review, which is
the only reason it surfaced: I had asserted in §10 that retitling closes a
window. It does not — and checking *why* turned up a real divergence next door.

§4 lists **"a document archived"** among the acts that close a commit window.
`apps/server/src/docs/archive.ts` honours that: `POST /api/docs/{id}/archive`
declares `act: "names-the-window"`.

But a document can also be archived through **`PUT /api/docs/{id}` with
`{status: "archived"}`**, which is what §10's frontmatter form does — and
`apps/server/src/docs/update.ts:377` sets the act **only** for `reviewed`:

```ts
act: Object.hasOwn(fields, "reviewed") ? "names-the-window" : undefined,
```

So the same act closes a window through one door and folds silently through the
other. §4's list is written in terms of what happened to the document, not which
route was used, and a reader checking it against `git log` will find it false
half the time.

## The question to answer first

**Which is right?** Both readings are defensible and the issue should not assume:

- **The act is the act.** §4 describes changes, not routes, so a status flip to
  `archived` through any door should close the window and name its commit. This
  is the reading §4's plain text supports.
- **The form's writes are saves.** §10 (SHARED-030, signed 2026-08-12) puts the
  frontmatter form "under the body's rule", and the applied text now says every
  field it carries is an ordinary save that joins the open window. Making one of
  those four fields an act reintroduces exactly the surprise that rider removed.

They cannot both hold. If the first wins, §10's frontmatter paragraph needs a
carve-out and the form's status control becomes a window-closing act. If the
second wins, §4's list needs to say that archiving **through the archive verb**
is the act — which is a spec change either way, and therefore needs the user.

**Do not settle this in a diff.** Escalate with a recommendation.

---

# The audit (2026-09-06)

**No behaviour changed in this pass.** Sprint-024 Ruling 3: both readings change
SPEC.md, a spec change needs the user's signature, and this run does not have one
for it. `apps/server/src/docs/update.ts` is untouched, `acts.test.ts` gains no
behaviour case, and SPEC.md is unchanged. What follows is the audit, a drafted
rider with a recommendation, and a test file that pins today's behaviour so the
signature's diff is visible rather than silent.

## Every §4 list entry, against every door that reaches it

Line numbers are from the tree at audit time, which includes SERVER-165 and
SERVER-101. (Sprint-024's P9 cites `update.ts:796` for the `act:` expression;
this tree has it at **777**. `archive.ts:639` and `move.ts:133` match.)

| §4 entry | door | site | declares an act? | what happens today |
| --- | --- | --- | --- | --- |
| a turn posted to a thread | `POST /api/threads/{id}/turns` | `threads/turns.ts:345` | **yes** — `names-the-window` | folds into the window, closes it, keeps its subject |
| a turn posted to a thread | `POST /api/threads/{id}/turns/{ts}/form` | `threads/forms.ts:156` → the same `commitTurnAppend` | **yes** | identical by construction |
| a turn posted to a thread — the **first** one | `POST /api/threads` | `threads/create.ts:577` | **yes, as of SERVER-101** | was a gap until this sprint; see that issue |
| a thread resolved or reopened | `POST /api/threads/{id}/resolve\|reopen` | `threads/status.ts:108` | **yes** | |
| a document **archived** | `POST /api/docs/{id}/archive` | `docs/archive.ts:639` | **yes** | subject `doc archive: … by …` survives |
| a document **archived** | `PUT /api/docs/{id}` `{"status":"archived"}` | `docs/update.ts:777` | **no** | folds like any save, subject relabelled `editing session: N documents` on close — **GAP 1** |
| a document **archived** | `PUT /api/docs/{id}` `{"stage":"…"}` where §5's map sends that stage to `archived` | `docs/update.ts:704`, `:714`, then the same `:777` | **no** | same fold — **GAP 1, second door** |
| a document **archived** | `POST /api/docs/bulk` | `docs/bulk.ts:742` | **yes** — `commits-alone` | §4's "a staged bulk Save"; closes first, commits alone |
| a document **archived** | a folder act (§9.2) | `folders/acts.ts:239` | **yes** — `commits-alone` | built as a bulk act, deliberately |
| a document **restored** | `POST /api/docs/{id}/unarchive` | `docs/archive.ts:639` (same handler, `verb` differs) | **yes** | |
| a document **restored** | `PUT /api/docs/{id}` `{"status":"open"}` | refused at `docs/update.ts:539` (`assertNotUnarchivingByPut`) | **n/a — there is no door** | `400` for every document: unarchiving a §7 skill is a folder move a field edit cannot undo (SERVER-039) |
| a document **restored** | `PUT /api/docs/{id}` `{"stage":"…"}` where §5's map sends that stage to `open` | `docs/update.ts:704`, deliberately bypassing the guard above (`:707`), then `:777` | **no** | folds — **GAP 2**, and it is the *only* restore-through-`PUT` there is |
| a document **restored** | `POST /api/docs/bulk`, a folder act | `docs/bulk.ts:742`, `folders/acts.ts:322` | **yes** — `commits-alone` | |
| a document **moved** | `POST /api/docs/{id}/move` | `docs/move.ts:133` | **yes** | |
| a document **renamed** (its *file*) | `POST /api/folders/{path}/rename` | `folders/acts.ts:144` | **yes** — `commits-alone` | a §9.2 folder act |
| a document **renamed** (its *title*) | `PUT /api/docs/{id}` `{"title":"…"}` | `docs/update.ts:777` | **no** | folds — **GAP 3**, and it is the one the issue's own summary reports as a wrong repair of §10 |
| a document **marked still current** | `PUT /api/docs/{id}` `{"reviewed":"…"}` | `docs/update.ts:777` | **yes** | the single `PUT` case that declares |
| a queue event finished | any terminal transition | `queue/service.ts:404` ← `app.ts:591` | **yes** | closes on `processed \| failed \| deferred \| abandoned` |
| a document **deleted** | `DELETE /api/docs/{id}` | `docs/delete.ts:173` | **yes** — `commits-alone` | |
| a **staged bulk Save** | `POST /api/docs/bulk` | `docs/bulk.ts:742` | **yes** — `commits-alone` | |

Not a §4 list entry, recorded so the enumeration is complete: reordering boards
(`docs/board-order.ts:116`) declares `commits-alone` under §10's "reordering
boards writes `order` on every board, in one commit" and §4's "One action, one
commit", not under the closer list.

### What the table says, in three sentences

- **One route answers §4 two different ways.** `docs/update.ts:777` reads
  `Object.hasOwn(fields, "reviewed") ? "names-the-window" : undefined`, so the
  same `PUT` is an act when it marks a document still current and an ordinary
  save when it archives one. Both are on §4's list, one line apart.
- **The gaps are three, not one, and one line decides all three.** Archiving
  (GAP 1, two doors), restoring (GAP 2), and retitling (GAP 3) all reach that one
  expression. A rider that settles archiving alone re-files this issue next
  release, exactly as sprint-024's P9 warns.
- **P9's second row needs correcting.** It lists `PUT` with `{"status":"open"}`
  as the restore gap. That door is shut a step earlier by SERVER-039's `400`, for
  every document and not only skills. The restore gap that exists is **§5's
  kanban stage coupling**, which deliberately routes around that guard so a board
  mapping a stage to `archived` is not a one-way trip — and it lands on the same
  `act:` expression. The rider has to name the coupling, or it settles nothing on
  the restore side.

## The recommendation: the first reading, with §10 carved out for `status` alone

**Recommended: "the act is the act".** §4's list describes what happened to the
document, and a status flip to or from `archived` closes the window and names its
commit through whichever door wrote it. §10's frontmatter paragraph gains a
carve-out for `status`, and keeps every other field it names.

Five reasons, in order of weight:

1. **§4's list is a checkable promise, and the second reading makes it uncheckable
   from `git log`.** A reader who archives a document and greps the log for
   `doc archive:` finds it only if they happened to use the verb — and nothing in
   the history says which door was used. Under the second reading the reader has
   to know the route to interpret the log, which is precisely the property §4's
   list was written to give them.
2. **Archiving satisfies §4's own definition.** An act is "a change someone else
   can act on, as against a body edit that is merely underway". An archived
   document leaves every default list, every board's scope, Attention and the
   staleness ramp. The agent can act on that; a half-typed paragraph is what the
   contrast is about.
3. **§10's stated promise survives literally.** Its sentence is "a frontmatter
   change and a body change made together are one commit rather than a race
   between two". `"names-the-window"` keeps that true: the act's own change is
   the **last thing in the window's commit**, so the sitting and the flip are
   still one commit. What changes is the commit's *subject*, and that continued
   typing afterwards opens a fresh window. The rider therefore costs §10 nothing
   it argued for — it costs one extra commit only when someone keeps typing after
   changing a document's standing.
4. **The UI's own door is the common one.** §10's strip is how a person archives
   a document in the board. Leaving the commonest path off §4's list means the
   list is false on the path most people take.
5. **The second reading needs the same carve-out anyway, in the other
   direction.** "Archiving **through the archive verb** is the act" still has to
   say something about `POST /api/docs/bulk` and the folder acts, which close the
   window today under a different clause. The first reading needs one sentence
   about `status`, the second needs a route list inside a behavioural spec.

**Why the second reading is defensible, and why it still loses.** SHARED-030's
rider is the *later* signature (2026-08-12 against §4's 2026-08-10), it
anticipated this question, and it answered it: "§4's acts are reached through
their own verbs, not through the strip". Its purpose was to remove a surprise —
a control that looks like the body's autosave and costs something different. That
purpose is real, and the recommendation respects it for four of the five fields
the strip carries. It is overridden for `status` alone because `status` is the
one field on that strip §4 names by itself, and because the surprise the rider
removed was about **modes and save buttons**, not about commit subjects: nothing
about this rider asks a person to do anything twice.

**Retitling (GAP 3) is settled the other way, deliberately.** §4's "moved,
renamed" is recommended as a statement about where a document's *file* lives —
the folder move and the folder rename, which are the two things that already
declare it. A title is the strip's own field and stays an ordinary save. This is
the correction the issue's summary asks for: §10 was wrong to assert that
retitling closes a window, and the fix is to say in §4 which sense of "renamed"
is meant rather than to make a title change an act.

## The drafted rider — unsigned, quoted for the user to read aloud

> **Archiving and restoring are acts wherever they happen.** §4's list names what
> happened to the document and not which verb was used, so a document reaching
> `archived`, or leaving it, closes the open commit window and names its commit —
> through the archive and unarchive verbs, through a save that writes `status`,
> and through a kanban drag whose stage the board maps to a status (§5). The
> commit is still the window's: the act's change is the last thing in it, so a
> body edit and a status change made in one sitting remain **one** commit, exactly
> as §10 promises. What the act adds is that the commit says what happened, and
> that the window closes behind it. A save that would write `status: open` over an
> archived document on its own stays refused rather than becoming an act —
> unarchiving a skill is a folder move a field edit cannot undo (§7) — so
> restoring reaches this rule through the unarchive verb, through a bulk Save or
> folder act, and through the stage coupling.
>
> **§10's frontmatter strip keeps everything else.** Tags, stage, dates, and the
> title above the body stay ordinary saves that join the open window. The strip is
> still under the body's rule: no edit mode, no save button, no second act to keep
> a change, and no field on it asks to be done twice. `status` is the one
> exception, and it is an exception because §4 already named it: an archived
> document leaves every default list, every board's scope and the staleness ramp,
> which is a change someone else can act on rather than an edit that is merely
> underway.
>
> **And §4's "renamed" is about where a document lives, not what it is called.** A
> document is renamed when its file moves — §9.2's folder move and the folder
> rename beside it. Changing a document's title is the strip's own field and joins
> the open window like the tags next to it, so a sitting that retitles a document
> and rewrites its opening paragraph is one commit and not two.
>
> _(Rider signed 2026-09-09.)_

### What lands in code the day it is signed

- `apps/server/src/docs/update.ts:777` becomes an act when the save writes
  `status` — the caller's field or §5's coupled one — as well as when it writes
  `reviewed`. One expression, all three gaps, one line:
  `Object.hasOwn(fields, "reviewed") || "status" in fields || statusCoupled`.
- `apps/server/src/docs/acts.test.ts` gains the two positive cases the third
  acceptance criterion asks for — archiving through `PUT`, and restoring through
  §5's stage coupling — beside the verb cases already there.
- `apps/server/src/docs/status-flip-doors.test.ts` (added by this pass) flips
  from pinning the fold to asserting the close, and its four "TODAY" comments
  come out. That file exists so this diff is one file wide and legible.
- Nothing changes for `title` — GAP 3 is settled by the rider's third paragraph,
  in prose, with no code.

---

# The implementation (2026-09-09)

**The rider is signed and applied.** SPEC.md §4 carries it verbatim, in the
paragraph "Archiving and restoring are acts wherever they happen" that follows
the closer list. This pass implements it exactly as the section above predicted:
one expression in `docs/update.ts`, two new positive cases in `acts.test.ts`, and
`status-flip-doors.test.ts` flipped from pinning the fold to asserting the close.

## The doors, after the change

Only `PUT /api/docs/{id}` moved. Every other row of the audit table is untouched
and was re-run to prove it (`docs` 825 passed, `threads` 642, `folders`+`edit`
165).

| §4 entry | door | declares an act? | change |
| --- | --- | --- | --- |
| a document **archived** | `POST /api/docs/{id}/archive` | yes — `names-the-window` | unchanged |
| a document **archived** | `PUT /api/docs/{id}` `{"status":"archived"}` | **yes — `names-the-window`** | **GAP 1 closed** |
| a document **archived** | `PUT /api/docs/{id}` `{"stage":"…"}`, §5 maps it to `archived` | **yes — `names-the-window`** | **GAP 1's second door closed** |
| a document **archived** | `POST /api/docs/bulk`, a folder act | yes — `commits-alone` | unchanged |
| a document **restored** | `POST /api/docs/{id}/unarchive` | yes — `names-the-window` | unchanged |
| a document **restored** | `PUT /api/docs/{id}` `{"status":"open"}` | n/a — refused `400` | unchanged; the rider leaves SERVER-039 standing |
| a document **restored** | `PUT /api/docs/{id}` `{"stage":"…"}`, §5 maps it to `open` | **yes — `names-the-window`** | **GAP 2 closed** |
| a document **restored** | `POST /api/docs/bulk`, a folder act | yes — `commits-alone` | unchanged |
| a document **renamed** (its *file*) | `POST /api/folders/{path}/rename`, `POST /api/docs/{id}/move` | yes | unchanged |
| a document **renamed** (its *title*) | `PUT /api/docs/{id}` `{"title":"…"}` | **no, and now by decision** | **GAP 3 settled in prose** — the rider's third paragraph, no code |
| a document **marked still current** | `PUT /api/docs/{id}` `{"reviewed":"…"}` | yes — `names-the-window` | unchanged |
| every other §4 entry | turns, forms, thread create/resolve/reopen, queue transitions, deletion, bulk Save, board reorder | yes | unchanged |

## Two readings the diff had to settle, and how

**`"names-the-window"`, never `"commits-alone"`.** The rider's own sentence
decides it: "the act's change is the last thing in it, so a body edit and a
status change made in one sitting remain **one** commit, exactly as §10
promises." A `"commits-alone"` closer would have produced the right number of
commits in the wrong order — which is why both new `acts.test.ts` cases assert
`git show --name-only` and the subject, not only the count.

**The act is any real `status` move on this route, not an `archived`-only
comparison.** Two reasons, in order of weight. First, §4's positive list carries
"a thread resolved or reopened" as well as "a document archived", and a thread is
a document a board can hold — so a drag whose stage §5 maps to `resolved` is on
§4's list through the same expression, and an `archived`-only test would leave
that door in exactly the state this issue was filed about. Second, the rider's
own field-level sentence is "`status` is the one exception", and `changedFields`
has already dropped a `status` equal to the file's, so an autosave that re-sends
the stored value is not an act by construction. A stage move whose coupled status
the document already carries is likewise not one: `statusCoupled` is false there,
which keeps an ordinary drag between two stages a board maps the same way off
§4's list and off §11's warnings. That case is pinned.

**The commit subject stays `doc edit: <title> (<id>) by <actor>`, and that is a
judgment call worth naming.** The rider says the act means "the commit says what
happened". A `PUT` that archives now produces a commit whose subject says a save
happened to that document and whose diff carries `status: archived`, not one
reading `doc archive:`. Three reasons for leaving it: the precedent on this
route is `reviewed`, the act it has always declared, which keeps the same
subject; the subject is one derivation shared with the board row and
`changedFields` (SERVER-100), so moving it is a wider change than this issue
scoped; and "What lands in code the day it is signed" — written into this file
before the signature — specifies one expression and no subject change. **A
reader grepping for `doc archive:` still finds only the verb.** If §4's list is
meant to be checkable by that grep rather than by "the window closed and the
commit names the document", that is a follow-up issue and a second rider
sentence, not a silent widening here.

## Acceptance Criteria

- [x] The question above is answered, in writing — recommendation and reasoning
      above. **Signed 2026-09-09** and applied in SPEC.md §4
- [x] Whichever way it goes, the two doors agree — a reader checking §4's list
      against `git log` finds the same answer whichever route was used. Archiving
      and restoring now close the window and name the window's commit through the
      verbs, through a `status` save and through §5's stage coupling. Asserted in
      `acts.test.ts` (two new positive cases) and `status-flip-doors.test.ts`
      (seven cases), and verified E2E below. The one qualification is recorded
      above under "the commit subject stays `doc edit:`"
- [x] `docs/acts.test.ts` enumerates §4's lists case by case; whatever is decided
      gets a case there, on the door that currently lacks one — two cases added:
      "a document archived through a save that writes `status`" and "a document
      restored through §5's stage coupling"
- [x] The same question is asked of the rest of §4's list — the table covers every
      entry and every door, names three gaps rather than one, and corrects P9's
      restore row. The post-change table is above

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/update.ts` — the `act:` expression on `PUT`'s mutation
  plan grows the two `status` doors. One expression, three gaps.
- `apps/server/src/docs/status-flip-doors.test.ts` — added by the audit pass to
  pin the divergence, flipped here to assert the rider. Every `TODAY:` comment
  is replaced by a citation of the signed text.
- `apps/server/src/docs/acts.test.ts` — two positive cases.
- `SPEC.md` — carries the signed rider already (applied outside this issue).

Deliberately **not** modified: `docs/archive.ts`, `docs/bulk.ts`,
`folders/acts.ts`, `docs/move.ts`, `docs/patch.ts`. The first four already
declared their acts. `patch.ts` is the only other caller of
`updateDocumentLocked`, and it sends a body and a key and never a `status`, so it
reaches the same expression and stays a save.

## Testing Strategy

`apps/server/src/docs/status-flip-doors.test.ts`, **seven** cases (six flipped,
one added), all passing:

| case | asserts |
| --- | --- |
| archiving through `PUT` folds into the open window and then closes it | GAP 1 — one commit carrying both files, subject naming the document, and the next save is a commit of its own |
| the archive **verb** on the same document closes it too | the two doors side by side, now agreeing |
| restoring through `PUT` is refused outright when the caller writes `status: open` | SERVER-039's `400` — the rider leaves it standing |
| restoring reaches the file through §5's stage coupling, and closes the window there | GAP 2 — the restore door that does exist, both directions |
| a drag between two stages the board maps the same way is still a save | **new** — `statusCoupled` is false when no status moves, so the coupling does not over-declare |
| retitling does not close the window | GAP 3, now a decision rather than a status quo |
| marking a document still current closes it, on this same route | the two acts one verb can declare |

`apps/server/src/docs/acts.test.ts`, two cases added to §4's positive list:

| case | asserts |
| --- | --- |
| a document archived through a save that writes `status` | ordering, not counting — one commit whose `--name-only` is exactly the neighbour's body edit plus the archived document, subject naming the act's document, `status: archived` on disk, and the window closed behind it |
| a document restored through §5's stage coupling | the same shape through the drag door, in the restoring direction |

Both follow the file's existing `saveThenAct` shape, so a closer that committed
*before* folding would fail on `filesIn("HEAD")` rather than pass a looser count.

## E2E Verification Log

### Pass 2 — the fix (2026-09-09)

**Model: Opus 5 (`claude-opus-5[1m]`).** Real `corpus init` workspace at
`…/scratchpad/ws106`, real server (`corpus server start`, pid 87012, port 8791),
`curl` over HTTP, `git log`/`git show` in the workspace repository. Every settle
is a real 35 s wall-clock wait past §4's 30 s idle window — no clock control, so
the fold and the close are the server's own.

Pass 1 below is the audit's reproduction of the divergence, on the same route,
before any code changed. Read the two together: the same drill, opposite answers.

**Drill 1 — `PUT {"status":"archived"}` mid-edit-window.** This is the exact
shape pass 1 reproduced as a silent fold.

```
PUT A body (opens the window): 200
  commits with the window open: 3
PUT B {status: archived}: 200
  commits now: 3  (delta 0)          -- the act folded INTO the window
  HEAD subject: doc edit: Subject (doc_oovttguj) by user
  HEAD files:   data/docs/inbox/neighbour.md data/docs/inbox/subject.md
  status on disk: status: archived
PUT A body again (would fold if the window were open): 200
  commits now: 4  (delta 1)          -- the window CLOSED
  HEAD subject:   doc edit: Neighbour (doc_shinoduc) by user
  HEAD^ subject:  doc edit: Subject (doc_oovttguj) by user
```

One commit holds the body edit **and** the archive, so §10's promise stands. The
act's change is last in it, so its subject survives the close — `HEAD^` is still
the flip's own commit and was never relabelled `editing session: 2 documents`,
which is exactly what pass 1 recorded. The next save is a commit of its own.

**Drill 1b — the archive verb, on the same shape, same server.** The comparison
that used to diverge:

```
PUT A body (opens the window): 200
POST /archive on D: 200
  commits delta: 0                   -- folded in
  HEAD subject: doc archive: Verb target (doc_crgxzms2) by user
PUT A body again: 200
  commits delta: 1                   -- closed
```

Same shape, same counts. The two doors now agree. They differ only in the
subject's verb, which is the judgment call recorded above under "The commit
subject stays `doc edit:`".

**Drill 2 — the kanban stage coupling, both directions.** Board `K` maps
`done → archived` and `triage → open`.

```
PUT C {stage: done} -> archived: 200
  status on disk: status: archived
  HEAD subject: doc edit: Task (doc_xyqnionn) by user
-- settle --
PUT A body (opens the window): 200
  commits with the window open: 8
PUT C {stage: triage} -> restores: 200
  status on disk: status: open
  commits delta: 0                   -- folded in
  HEAD subject: doc edit: Task (doc_xyqnionn) by user
  HEAD files:   data/docs/inbox/neighbour.md data/docs/inbox/task.md
PUT A body again: 200
  commits delta: 1                   -- the window CLOSED
```

That is GAP 2 closed on the only restore door `PUT` has, and it is a drag the
board writes — no `status` in the request at all.

**Drill 2b — the refusal the rider leaves standing (SERVER-039).**

```
PUT C {status: archived}: 200
PUT C {status: open}: 400
{"code":"bad_request","message":"request failed validation","issues":[{"path":"body.status",
"message":"doc_xyqnionn is archived; `status: open` would set the frontmatter without bringing
the document back. Use `POST /api/docs/doc_xyqnionn/unarchive` — …"}]}
  status on disk: status: archived
```

Unchanged, byte for byte, from pass 1. Writing `status` did not become a licence
to unarchive by field edit.

**Drill 3 — a plain retitle still folds, and the window stays open.** The rider's
third paragraph, live:

```
PUT A body (opens the window): 200
  commits with the window open: 11
PUT E {title: 'Titled, renamed'}: 200
  commits delta: 0                   -- folded
PUT A body again: 200
  commits delta: 0                   -- the window is STILL OPEN
  HEAD files: data/docs/inbox/neighbour.md data/docs/inbox/titled.md
-- settle, then one more save so the window closes --
  HEAD^ subject: editing session: 2 documents by user
```

The retitle and the body edits are one commit, and the close relabels it an
editing session because no act named it. "A sitting that retitles a document and
rewrites its opening paragraph is one commit and not two."

**The whole history the drill produced**, which is the reader's own check of §4's
list against `git log`:

```
8166b1b user doc edit: Neighbour (doc_shinoduc) by user
f37f776 user editing session: 2 documents by user      <- drill 3: retitle + body, no act
dc09357 user doc edit: Task (doc_xyqnionn) by user     <- drill 2b: the second status write
b5d44c0 user editing session: 1 document by user
b5fbe67 user doc edit: Task (doc_xyqnionn) by user     <- drill 2: the restore by drag
bb34858 user doc edit: Task (doc_xyqnionn) by user     <- drill 2: the archive by drag
df2a3f1 user editing session: 1 document by user
3e1988d user doc archive: Verb target (doc_crgxzms2) by user   <- drill 1b: the verb
05343a1 user editing session: 1 document by user
7b513f4 user doc edit: Subject (doc_oovttguj) by user  <- drill 1: the archive by PUT
e62fb0e user editing session: 6 documents by user
65c5a26 user workspace: initialize corpus workspace by user
```

Every act sits at the end of a window it closed. Every `editing session:` line is
a window no act named. Server stopped, port 8791 verified free.

#### Checks run (pass 2)

- `vitest run apps/server/src/docs/status-flip-doors.test.ts` — **7 passed**
- `vitest run apps/server/src/docs/acts.test.ts` — **25 passed** (23 before)
- `vitest run apps/server/src/docs` — 37 files, **825 passed** (822 before)
- `vitest run apps/server/src/threads` — 22 files, **642 passed**
- `vitest run apps/server/src/folders apps/server/src/edit` — 7 files, **165 passed**
- `vitest run apps/server` — 219 files, **4948 passed**, 0 failed
- `tsc --noEmit -p apps/server/tsconfig.json` — clean
- `eslint` + `prettier --check` on the three touched files — clean

### Pass 1 — the audit's reproduction (2026-09-06)

**Model: Opus 5 (`claude-opus-5[1m]`).** Real `corpus init` workspace at
`…/scratchpad/ws101`, real server (`corpus server start`, pid 66225, port 8767),
`curl` over HTTP, `git log` in the workspace repository. The same run that
verified SERVER-101 — the audit needed a live divergence, not a new one.

This is an audit, so the E2E is the **reproduction of the divergence**, and there
is no post-fix half: nothing was fixed.

**A body save opens the window, then `PUT {"status":"archived"}` folds into it:**

```
window open, commits: 5
-- PUT {status: archived} --
HTTP 200
commits: 5 (delta 0)
ff2c87e user doc edit: Subject (doc_xv6do6w2) by user
-- another save by the same party: it still folds, so the window never closed --
PUT 200
commits: 5 (delta 0)
8c302bf user doc edit: Pricing (doc_wakht2p5) by user
-- let it go quiet, then save again: the flip's subject is gone --
PUT 200
128e3e2 user doc edit: Pricing (doc_wakht2p5) by user
845321c user editing session: 2 documents by user
```

The archive is in `845321c`, a commit whose subject says "editing session".
Nothing in `git log` records that a document was archived.

**The same change through the verb, on the same server:**

```
archive verb HTTP 200
commits: 7 -> 7
a2c9660 user doc archive: Third (doc_u3tf5fbv) by user
PUT 200
commits after the follow-up save: 8 (delta 1) — the window closed
```

Folded into the open window, named it, and closed it — §4's shape exactly. Two
doors, one act, two answers.

**And the restore door P9 names is not there at all:**

```
-- PUT {status: open} on an archived document: refused (SERVER-039) --
{"code":"bad_request","message":"request failed validation","issues":[{"path":"body.status",
"message":"doc_xv6do6w2 is archived; `status: open` would set the frontmatter without bringing
the document back. Use `POST /api/docs/doc_xv6do6w2/unarchive` — …"}]}
HTTP 400
```

The restore-through-`PUT` that does exist — §5's stage coupling — is exercised
against the real app, real git and the real projection by
`status-flip-doors.test.ts`'s fourth case.

#### Checks run (pass 1)

- `vitest run apps/server/src/docs/status-flip-doors.test.ts` — **6 passed**
- `vitest run apps/server/src/docs` — 37 files, **822 passed**
- `tsc --noEmit -p apps/server/tsconfig.json` — clean
- `eslint` + `prettier --check` on the new file — clean

Server stopped (`stopped (pid 66225)`), port 8767 verified free.

## Escalation

**Resolved — the rider was signed 2026-09-09 and is applied in SPEC.md §4.** The
escalation this issue carried is closed: `docs/update.ts` declares the act on
both status doors, §4's list and §10's frontmatter paragraph no longer
contradict each other, and `status-flip-doors.test.ts` asserts the decision
instead of pinning the disagreement.

**One thing is left open, deliberately, and it is a spec question rather than a
defect.** The rider says an act means "the commit says what happened". A `PUT`
that archives now names its commit `doc edit: <title> (<id>) by <actor>`, so a
reader grepping `git log` for `doc archive:` still finds only the verb. This
implementation keeps the subject as it is, for the three reasons under "The
commit subject stays `doc edit:`" above. If the intended promise is the grep
rather than "the window closed and the commit names the document", that needs a
second rider sentence and its own issue — the change would move a subject that
`documentTitle` shares with the board row and `changedFields` (SERVER-100), and
it would relabel a commit that also holds a body edit.

## Completion Checklist (domain agent)

- [x] Tests written and passing — seven in `status-flip-doors.test.ts` (six
      flipped from pinning the fold, one added), two added to `acts.test.ts`
- [x] `/lint` passes — eslint and prettier on the three touched files, `tsc` clean
- [x] E2E verification log filled — pass 2, real workspace, real server, real git
- [x] Self-review
- [x] Acceptance criteria verified — all four, with the subject question recorded
      under Escalation rather than settled silently

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
