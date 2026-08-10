# [SERVER-093] Nothing reads a history the open window is still holding

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
- Related: SERVER-092 (the act closers), SERVER-052 (the edit acknowledgment,
  which already flushes and is the precedent for all of this)

## Spec References

- SPEC.md **§4** — "Nothing reads a history the window is still holding"
- SPEC.md **§4** — "Edit acknowledgment": the `doc.edited` event carries a commit
  range, which must be in git before the event exists
- SPEC.md **§7** line 330 — `corpus skill rollback`
- SPEC.md **§9.2** — `GET /api/docs/:id/diff`

## Summary

A window that is still open is a commit the server intends to keep amending. Any
operation that **names, reads or reverts a commit** must close it first, or it
reads a history that is about to change under it: `corpus doc diff` would show a
change that is not the one it was asked about, `corpus skill rollback` would
revert a version other than the one the person just saw, and an acknowledgment's
commit range would dangle the moment the next save amends its endpoint.

The last of those is already solved — `edit/sessions.ts` calls
`endSquashSession(session.lastSha)` before emitting, and its comment is the best
statement of the hazard in the codebase. This issue generalises that one call
into the rule §4 now states, and applies it to the readers that never had it.

## Orchestrator ruling, 2026-08-10 — the close's amend moves the sha

SERVER-091 escalated this rather than deciding it, correctly. The facts:
`closeWindow` relabels the window's commit, which **moves its sha**.
`edit/sessions.ts` observes commits but not closes, so when the agent writes
mid-session the user's window closes and is relabelled — and the `doc.edited`
event's `to` then names a commit no longer reachable from the branch. The content
is identical (only the message changed) and the object still resolves, but "never
publish a sha no branch holds" is PR #22's rule reached by a different door.

Three options were offered. **The ruling is (a): the tracker follows the
rewrite.** This issue owns it.

Why not **(b), write the editing-session subject eagerly** so nothing is ever
relabelled — the tempting option, because it deletes the hazard class outright
and would make `closeWindow` forget-only and synchronous, collapsing it and
`endSquashSession` into one primitive. It was rejected on a cost that is
permanent rather than transitional: under (b) an ordinary user editing commit
**never** carries a verb subject. `doc edit:`, `doc create:` and the rest vanish
from a user's history, and `git log --oneline` becomes a wall of
`editing session: 1 document by user`. The document ids survive only in trailers,
which `--oneline` does not show. §4 requires the editing-session subject for a
window **that closes with no act to name** — it says nothing about an open one —
so (b) is spec-legal, and still the wrong trade: it pays in every day's history
legibility to avoid one observer callback.

Why not **(c), accept it**: the object resolves for git's two-week unreachable
grace (CLI-037 confirmed `gc` does not prune recent unreachable objects), so the
harm is bounded. But an event that names a sha `git log` cannot find is exactly
the kind of thing that gets diagnosed twice, years apart, by people who did not
read this paragraph.

Why (a) is cheap here and not fragile: `observeCommit` **already exists** on the
tracker and the commit path already calls it. `observeRewrite(from, to)` is its
symmetric twin, one call at one site. This is not new machinery threaded through
a stack — it is a second message on a seam the codebase already has.

## Acceptance Criteria

- [x] `GET /api/docs/:id/diff` closes the open window **before** it reads. A diff
      requested mid-editing-session shows the change it was asked about, not a
      truncated one. Test by saving and immediately diffing inside the idle
      window — today that read misses the still-foldable content's boundary
- [x] `corpus skill rollback` closes the window before it resolves the revision
      it is reverting to, and before it writes. It already passes `squash: false`;
      that is not the same thing and does not flush
- [x] The edit acknowledgment keeps its guarantee. `endSquashSession` may become
      a wrapper over SERVER-091's `closeWindow`, but the published-sha rule must
      not regress and the tracker's timer must not start queueing behind the
      autosave path — see SERVER-091's note on the sync/async split
- [x] A **read endpoint causing a commit** is accepted and deliberate. Say so at
      the call site in a comment: it is the crux of the rule, and the next
      reviewer will read a `GET` that mutates git as a defect unless it is
      explained
- [x] Sweep for other readers. Anything in the tree that runs `git log`,
      `git show`, `git diff`, `git rev-parse` against a range or names a sha in a
      response or an event is a candidate. Name in the log every one you found and
      the ruling for each — flush, or why not
- [x] Reads that do **not** touch git history are untouched, per §4's second
      list. A projection query, a document read, a tree read, a search — none of
      these may acquire the git lock, and a test should prove at least one of
      them does not
- [x] Where several documents share one window commit, each document's
      acknowledgment names that same commit and each diff stays **path-scoped**,
      so every event still answers about its own document. This is new under
      party-scoped windows and is the acceptance criterion most likely to be
      missed: verify the diff route scopes by path and the acknowledgment's
      `stats` describe the document, not the whole commit
- [x] `git log` run by hand in a terminal outside Corpus is the one reader that
      cannot be flushed. It lags by at most one open window. Nothing to
      implement; do not try
- [x] **The escalated sha-rewrite is closed** (see the ruling above): the commit
      path tells `edit/sessions.ts` when a close moves a sha, and the tracker
      follows it, so a `doc.edited` event never names a commit outside the branch.
      Add the observer as the symmetric twin of `observeCommit`, at the one site
      that does the relabel. `edit/acknowledgment.test.ts` currently **documents
      the defect at the assertion** — SERVER-091 put it there deliberately rather
      than hiding it; turn that assertion around, do not delete it

## Technical Design

### Files to Create/Modify

- `apps/server/src/edit/diff.ts` and/or `edit/routes.ts` — the diff read
- `apps/server/src/skills/rollback.ts`
- `apps/server/src/edit/sessions.ts` — the existing flush, if the primitive
  changes shape under it
- Whatever the sweep turns up

### Key Implementation Details

The primitive is SERVER-091's `closeWindow(reason)`. It runs inside the git lock;
the diff route and rollback already do their git work through `withGitLock`, so
the close belongs in the same critical section as the read — closing outside the
lock leaves a window for an autosave to open a new one between the flush and the
read, which is the whole bug in miniature.

`skills/rollback.ts` is subtle: it both **reads** history (to resolve the target
revision) and **writes** (the restored content, through `runMutation`). The flush
belongs before the read. Its existing `squash: false` stays and keeps meaning what
it means — the restoration commit does not fold into a preceding window.

**Path-scoping under multi-document commits** is the one genuinely new correctness
question here, and it is worth stating why. Before this rider, one window commit
touched one document, so "the diff of this commit" and "the diff of this document"
were the same set of bytes. They no longer are. Every reader that answers *about a
document* must scope its `git diff`/`git show` by path, and any that answered by
commit-wide diff was correct only by accident. Check the diff route and the
acknowledgment's `stats` computation specifically.

### Edge Cases

- **A diff requested when no window is open.** No-op close, no commit, no log
  line. The common case; it must not cost a git invocation.
- **A diff requested by the party that does not own the open window.** Close it
  anyway. The read is not a write, so no party-change flush semantics apply —
  the window simply ends because its content is about to be named.
- **A close whose subject rewrite is refused** (HEAD moved, published,
  mid-operation). The read proceeds against the history as it stands; the window
  is still closed. A refused rewrite must never fail the read.
- **Rollback of a document whose change is in the still-open window.** Flush,
  then resolve — otherwise the candidate list is computed against a commit that
  is about to be amended, and the sha the user picks moves under them.

## Testing Strategy

1. Save, then diff, inside the idle window → the diff names the save. Assert the
   commit count as well: the flush closes the window, it does not add a commit
   beyond the one the save already made.
2. Save two documents into one window, then diff each → each diff shows only its
   own document's change, and both name the same commit.
3. Rollback mid-session → the reverted content is the version that was on screen.
4. A projection read and a search under an open window → no git invocation
   (assert against the fake git's call log), window still open afterwards.
5. The acknowledgment's existing tests must still pass unchanged. If one needs
   changing, that is a signal the published-sha guarantee moved — stop and say so.

## E2E Verification Plan

Real server, free port (**never 8765 or 5173**).

### Verification Steps

1. `corpus doc edit` a document, then immediately `corpus doc diff` it inside the
   idle window. The diff shows the edit. `git log` shows the window's commit
   closed by the read.
2. Edit two documents inside one window, `corpus doc diff` each. Each shows its
   own change only.
3. `corpus skill rollback` a skill mid-editing-session; confirm the restored
   content matches the revision listed, and that the editing work committed
   before the rollback commit rather than being swept into it.

## E2E Verification Log

**Model: opus.** Real `corpus` CLI + real server (pid 46508, port **8837** — 8791 was
already held by another agent's scratch workspace), real git repository at
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s093`, created by `corpus init`.
Server stopped and port confirmed free afterwards.

### 1. `corpus doc diff` inside the open idle window

```
PUT /api/docs/doc_he4houjt                                    200
git log (window OPEN)  920db73 user doc edit: Mortgage options (doc_he4houjt) by user
HEAD before diff       920db735b8b2a1ce0088967a99f28c0c2fb7ffcf

$ corpus doc diff doc_he4houjt
doc_he4houjt · data/docs/inbox/mortgage-options.md
dc824d49…..f84c126a49a833c00a7bb7e63c984949e12f640f
1 commit · +15 -0 · 488 characters
  … +First line.
    +Second line added by the person.

git log (after)        f84c126 user editing session: 1 document by user
HEAD after diff        f84c126a49a833c00a7bb7e63c984949e12f640f
commit count           2 → 2
```

The read closed the window: the subject became the editing-session one and the sha
moved. The diff shows the still-foldable content (`Second line added by the person.`),
and its `to` **is** the new HEAD — never the provisional `920db73`. The close added no
commit.

### 2. Two documents in one window commit, diffed separately

```
$ corpus doc create --title "Alpha doc" …   →  doc_deqqe7av
$ corpus doc create --title "Beta doc"  …   →  doc_xhtbobax

git show --name-only HEAD
  0f63cb9 doc create: Beta doc (doc_xhtbobax) by user
  Corpus-Doc: doc_deqqe7av
  Corpus-Doc: doc_xhtbobax
  Corpus-Actor: user
  data/docs/inbox/alpha-doc.md
  data/docs/inbox/beta-doc.md

$ corpus doc diff doc_deqqe7av   f84c126..4fb43d5   1 commit · +14 -0   diff --git a/…/alpha-doc.md
$ corpus doc diff doc_xhtbobax   f84c126..4fb43d5   1 commit · +14 -0   diff --git a/…/beta-doc.md

git log  4fb43d5 editing session: 2 documents by user      total commits 3 → 3
```

One commit, two documents. Both diffs name **the same** commit; each body holds only
its own file; each reports **+14**, not +28 — the stats describe the document, not the
commit. This is the criterion the issue flagged as most likely to be missed.

### 3. `corpus skill rollback` mid-editing-session

```
PUT …/doc_skillcomment (agent)  "THE GOOD VERSION…"   200
PUT …/doc_skillcomment (user)   "THE BAD EDIT…"       200

git log (user window OPEN)
  81ef1b6 user  doc edit: Comment (doc_skillcomment) by user
  bedc383 agent editing session: 1 document by agent

$ corpus skill rollback comment --json
  {"name":"comment","docId":"doc_skillcomment",
   "commit":"cee2b2a77be7149fe0541c5de4a6fea94f32a44d", "warnings":[]}

git log (after)
  cee2b2a user  skill rollback: comment (doc_skillcomment) to bedc383 by user
  7b5c468 user  editing session: 1 document by user
  bedc383 agent editing session: 1 document by agent

.claude/skills/comment/SKILL.md → "THE GOOD VERSION of the comment skill."
```

`81ef1b6` is gone; the user's editing work landed as **its own** commit `7b5c468`
beneath the restoration rather than being swept into it. The restored content is
exactly what `bedc383` — the revision the subject names — holds, and that sha is on the
branch.

### 4. Reads that do not touch git history

With a window open at `a396143` (`doc edit: …`), five reads —
`GET /api/docs/{id}`, `/api/docs`, `/api/tree`, `/api/search?q=third`,
`/api/docs/{id}/related` — all `200`. Afterwards HEAD, subject and commit count were
**byte-identical**, and the next save *amended* (count 7 → 7, HEAD `a396143` → `021693a`):
the window was never touched. §4's second list holds.

### 5. The escalated sha-rewrite, closed

```
user session's commit while its window is open   021693a0bccc113928040039f02b16ae5c53d3b0
agent writes → closes and relabels that window   9fcc5a07332f46e5bcbdd1941a1a69fed46bba9c

POST /api/docs/doc_he4houjt/edit-session/flush   204
queue/pending → doc.edited {
  "endedBy": "close",
  "from": "dc824d49…",
  "to":   "9fcc5a07332f46e5bcbdd1941a1a69fed46bba9c",
  "stats": { "commits": 2, "insertions": 17, "deletions": 0 } }

git log | grep 9fcc5a0…  → found        (the published sha is on the branch)
git log | grep 021693a…  → 0 matches    (the pre-rewrite sha is not)
git cat-file -t 021693a… → commit       (it still resolves — git's unreachable grace,
                                         which is exactly why option (c) was rejected)

$ corpus doc diff doc_he4houjt --from-rev dc824d49… --to-rev 9fcc5a07…
  2 commits · +17 -0 · 514 characters
```

The tracker followed the rewrite: the event names the commit the branch holds, and the
published range replays verbatim through `corpus doc diff`.

### Checks run

- `npm run build` — clean.
- Full server suite (`vitest run apps/server/src`): **3776 passed / 3778**, the two
  failures both in `window-lifecycle.test.ts` — SERVER-094's file, mid-edit during the
  run (mtime landed inside my run window); re-run afterwards: **6/6 pass**.
- Scoped: `edit/` 77 ✓, `git/commit.test.ts` 45 ✓, `skills/rollback.test.ts` 36 ✓.
- **Anti-vacuity**: with the fix reverted in place, 5 of the new/changed assertions fail
  (`diff closes the open commit window`, `splits the session at an agent commit`,
  `chooses against a settled history`, `closes the window even when the revision does
  not resolve`, `announces the sha a relabel moved`). Restored and re-verified green.
- `eslint` and `prettier --check` clean on every touched file; `tsc --noEmit` on
  `apps/server` clean.

### Sweep — every git-history reader found, and its ruling

| Reader | Ruling |
| --- | --- |
| `edit/diff.ts` / `edit/routes.ts` — `GET /api/docs/{id}/diff` | **FLUSH.** `withClosedWindow("read-back")` wraps the whole read. |
| `skills/rollback.ts` — `git log`/`git show` walk + explicit `--to` | **FLUSH.** Same primitive, around the search; `squash: false` unchanged. |
| `edit/sessions.ts` — the `doc.edited` range | **Already flushed, and must not close.** `end()` calls `endSquashSession(lastSha)` before the first git read; closing there would amend a commit the event has published (PR #22). Now also **follows** a close elsewhere via `observeRewrite`. |
| `docs/bulk.ts:859` — response `commit` | **No flush.** Names the commit this act just made; a `docIds` commit opens no window, so it can never be amended. |
| `skills/rollback.ts:332` — response `commit` | **No flush.** Same: `squash: false` opens no window. |
| `projection/unindexable.ts` — `git log --diff-filter=A -n1 --format='%h %s'` into `GET /api/db/doctor`'s `warnings[].commit` and `detail` | **No flush** — reasoned at the call site. The window only ever holds paths the server wrote, and this answers about paths `classifyPath` *refuses*, which the server can never write; its creating commit is always the operator's. (`doctor` is synchronous end to end, which would forbid the close anyway, but that is not the reason.) |
| `watcher/git-head.ts` + `watcher/reconcile-out-of-band.ts` — `git show HEAD:./<path>` | **No flush** — reasoned at the call site. Reads a *blob*, names no commit; a relabel rewrites a subject, never a tree, so the answer could not change. §4's own out-of-band paragraph says such an edit *joins* the user's window, so closing would defeat it. Structurally impossible besides (synchronous flush, 100 ms budget). |
| `git/recovery.ts` (SERVER-094) | **No flush.** Runs before the socket exists; no window can be open. Not touched. |
| `git/commit.ts` internals (`rev-parse`, `log -1`, `diff --cached`, `merge-base`…) | **N/A.** The committer's own reads, already inside the lock. |
| `apps/cli/src/staged.ts` — `git diff --cached`, `git show :<path>` | **No flush.** Reads the *index*, not history — and a separate process cannot reach the server's window. |
| `apps/cli/src/commands/init/git.ts:183` — `git rev-parse HEAD` → `UpgradeReport.commit` | **No flush.** Names the CLI's own upgrade commit; the server never amends it (a foreign commit supersedes the window). Cross-domain — reported, not edited. |
| `apps/cli/.../maintenance.ts` — `git gc`, `git count-objects` | **No flush.** Names no sha; runs when the sole writer is provably absent. |
| `plugins/**` | **None found.** No git call sites, no shas. |
| SSE frames (`events/**`, `queue/**`) | **None.** Query keys only — no sha anywhere. |
| `git log` in a terminal outside Corpus | **Unflushable, by §4.** Lags by at most one open window. Nothing implemented. |

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
