# [SERVER-052] Edit-session end detection → actor-scoped doc.edited emission

## Domain
server

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-028
- Blocks: UI-044, AGENT-011

## Spec References
- SHARED-008 rider; SPEC §4 (auto-commit squash)

## Summary
Detect the end of a USER edit session on a document and enqueue one
`doc.edited` event per session. Session end = (a) an explicit flush from the
UI (reader closed — the endpoint/mechanism UI-044 calls; check whether the §4
squash machinery already exposes a flush and extend it rather than adding a
parallel one), or (b) inactivity: no user write to that document for the
acknowledgment window (default 3 minutes — config-surfaced, distinct from and
longer than the squash idle). The event carries the session's commit range
(the pre-session commit → the squashed session commit) + stats per
CONTRACT-028. Strictly actor-scoped: agent-authored writes neither start nor
extend a session nor emit; a user session interleaved with agent writes to the
SAME document must not fold agent commits into the reported range (decide and
test the interleaving rule explicitly). Also implement the diff route
(CONTRACT-028) over the existing git show machinery with the bounded body.

## Acceptance Criteria
- [x] One event per session, both end paths; window configurable, default 3m
- [x] Actor scoping: agent writes never emit; interleaving rule tested
- [x] Commit range is exactly the session's edits; squash interplay correct
- [x] Diff route: bounded unified diff + truncated flag; 404/400 per envelope
- [x] No write-path latency added (timer/flush side only)

## Technical Design
### Files to Create/Modify
- apps/server: edit-session tracker (colocate with the squash machinery),
  queue enqueue, diff route; config surface for the window

## Testing Strategy
Session tracker unit tests (fake timers, vi.waitFor on real observables — no
setImmediate flush loops); route tests; interleaving matrix.

## E2E Verification Plan
Real server: edit via PUT as user, wait the window, observe the queue event;
close-flush path once UI-044 lands (or via the flush endpoint directly).

## Design Decisions (server-dev, 2026-08-04)

**Status: todo → done.**

### 1. A session is opened by the editor's save, and by nothing else
`MutationPlan.editSession` carries the document's workspace-relative path, and
`docs/update.ts` is the only verb that sets it — `PUT /api/docs/{id}`, which is
where the reader's autosave and the plugin read-modify-write both land. A create,
a move, an archive, a delete, a thread turn and a lock audit entry are things
that *happen to* a document rather than sessions of somebody editing it; folding
them in would acknowledge a document the user only filed, and would double up
with the `comment.created` a thread reply already enqueues.

`runMutation` reports **every** mutation to the tracker regardless, because a
commit by the other party is what seals an open session. `observeCommit` is
synchronous, allocation-light and issues **no git command at all** (pinned by a
test): every read an event needs happens on the timer or flush side.

### 2. Interleaving: sealing, not ending
CONTRACT-028 requires that a range never span another author's commit on the
document. A commit that touches an open session's file — matched **by path as
well as by docId**, because anchored thread creation stages the parent
document's frontmatter under the *thread's* id — marks that session `sealed`.
A sealed session accepts no further saves, so its range freezes; the user's next
save opens a second session with its own range and its own `sessionId`.

Sealing deliberately does **not** end the session. §4 gives a session exactly two
ends and "somebody else wrote here" is neither, so a sealed session still waits
for its own `close` or `idle` and reports that honestly as `endedBy`. This is
what let the interleaving rule ship without adding a third value to
`EditSessionEndReasonSchema` — i.e. without a contract change.

### 3. The window is its own constant, and its own config key
`EDIT_ACK_IDLE_MS = 180_000`, six times `SQUASH_IDLE_MS` and derived from
nothing. Surfaced as `.corpus/config.json`'s `editAcknowledgment.idleMs`
(floor 1 s — a window of zero is not a shorter acknowledgment, it is one event
per autosave, which is what §4's window exists to prevent). One timer for all
sessions, re-armed to the earliest deadline and `unref`'d.

### 4. Restart: flush on shutdown, no persistence, no resume
`createServer`'s `close()` awaits `editSessions.close()` **first** — before
`queue.close()` releases the parked long-polls — so every session still open ends
as `close` and its event reaches the queue while there is still a parked `corpus
queue idle` to wake. A reader's session cannot outlive the process, so the choice
was between announcing work the user has already done and discarding an
acknowledgment they are owed.

Resuming across a restart was considered and rejected on two grounds: the state
would have to be persisted from the **write path**, which §4's autosave cadence
makes exactly the wrong place to add a write (and the issue's own acceptance
criterion forbids); and a session reconstructed from history could not know
whether its event had already been enqueued — which is the duplicate the
`sessionId` invariant exists to make impossible. A process killed outright still
loses its open sessions, and that is the stated cost.

### 5. Two suppressions beyond "no commit"
`commits === 0` is the contract's own rule. A range whose *path-scoped* diff is
empty (`insertions + deletions === 0`) is also suppressed: that is the same
"nothing to acknowledge" state reached differently — an edit and its undo inside
one session — and waking the agent to reflect on a change of zero lines is
exactly the cost a frugal event exists to avoid.

### 6. A create folded into its session is acknowledged whole — deliberate
§4's squash folds a `POST /api/docs` and the saves that follow it within the idle
window into **one** commit, so a session whose only commit is that create reports
the whole document, frontmatter included. Git has no sha between the two halves
of one commit to draw a smaller range at, and "the person wrote this document" is
a true thing to wake the agent for. Pinned by its own test rather than left as a
surprise.

### 7. Truncation keeps at least one whole hunk (found by the E2E, not by a test)
The first hunk header is *arithmetically* a hunk boundary but carries none of the
change. A brand-new file arrives from git as one 64 000-character hunk behind a
166-character preamble, so cutting at that boundary answered **166 of an allowed
16 000 characters** — measured on the real server below. The rule is now: the
largest hunk boundary *after the first*, else the contract's stated exception (a
line-boundary cut). Re-measured at 15 899 characters.

### 8. §7's edit-lock release is NOT the close signal — UI-044 needs a contract change
CONTRACT-028 §7 proposed `DELETE /api/locks/{docId}` as the flush and declared no
new route. That does not hold, and the evidence is in the shipped UI:
`apps/ui/src/editor/useUserLock.ts` releases the user's lease **on blur** and
after `LOCK_IDLE_RELEASE_MS = 10_000` — ten seconds of not typing, with the
reader still open and the person still reading. Binding the close path to it
would:

- **make §4's window unreachable.** The lock's own idle release always fires
  first (10 s vs 180 s), so the three-minute acknowledgment window — which §4
  calls out as "a distinct and longer window" *on purpose* — would be dead code
  in every session.
- **fragment one sitting into an event per typing burst.** Every alt-tab would
  end a session and enqueue an event with a partial range, which is precisely
  what "one `doc.edited` per session" exists to prevent.

So the close path ships as `EditSessionTracker.flush(docId)` — implemented,
tested, and exposed on `CorpusServer.editSessions` — reached today only by
shutdown. **UI-044 needs an explicit flush call, and that is a new contract issue
(SPEC.md §9.3), not a server-local route.** Suggested shape: a body-less
`POST /api/docs/{id}/edit-session/flush` (or a `reason` on an existing call),
answering `204`, callable on reader close and idempotent — a flush of a document
with no open session is a no-op, not a `404`.

## E2E Verification Log

**Model: Opus 5 (1M context)** (`claude-opus-5[1m]`), 2026-08-04, branch
`phase-11-edit-ack`. Real server started with `corpus server start` from source
over a real `corpus init` workspace at `/tmp/corpus-s052-e2e`, **port 9471**
(never 8765, never 5173), `editAcknowledgment.idleMs` set to `5000` so the idle
path is watchable. Nothing outside `apps/server/` was touched except this issue
file (`apps/ui/` was read, never written — two other agents are live there).

**1. The idle path.** `POST /api/docs` as `user`, 31 s wait to step past the 30 s
squash idle, then `PUT` as `user`. Zero `doc.edited` immediately after the save;
one after the 5 s window:

```
created 201 doc_plwqohvo data/docs/inbox/mortgage-options-2.md
user save 200
doc.edited immediately after the save: 0
doc.edited after the window: 1
{ "id": "evt_msny54f5muhy", "type": "doc.edited", "source": "edit",
  "payload": { "docId": "doc_plwqohvo", "sessionId": "es_9802d7bfd0d593c4",
    "actor": "user", "endedBy": "idle",
    "from": "2d0d0d52f62549a7bc10d3ec1426dc1a20054630",
    "to": "9decfeb3c9ba3c18cf025d6fc3c97f556527679a",
    "stats": { "commits": 1, "insertions": 3, "deletions": 1 } } }
```

**2. The range is passable verbatim**, to git and to the route:

```
$ git diff --shortstat <from>..<to> -- data/docs/inbox/mortgage-options-2.md
 1 file changed, 3 insertions(+), 1 deletion(-)
$ git log --format='%h %an %s' <from>..<to>
 9decfeb user doc edit: Mortgage options (doc_plwqohvo) by user

GET /api/docs/doc_plwqohvo/diff?from=<from>&to=<to>
 -> 200, resolved from/to identical to the event's, stats identical
    {"commits":1,"insertions":3,"deletions":1}, truncated false, totalChars 552
    diff shows `-updated:`/`+updated:` and the two added body lines
GET /api/docs/doc_plwqohvo/diff          (bare, as `corpus doc diff <id>`)
 -> 200 from 2d0d0d52… to 9decfeb3…
```

**3. Refusals, on the real socket.**

```
?from=HEAD~1        -> 400 [{"path":"query.from","message":"Invalid string: must match pattern /^[0-9a-f]{7,64}$/"}]
?to=v1.0.0          -> 400 [{"path":"query.to", …}]
?from=--output=/tmp/x -> 400 [{"path":"query.from", …}]   (before any git argv exists)
?from=0123456789abcdef0123456789abcdef01234567
                    -> 400 [{"path":"query.from","message":"0123…4567 is not a commit in this workspace"}]
GET /api/docs/doc_zzzzzzzz/diff -> 404 not_found
```

**4. Actor scoping.** A `PUT` as `agent` against the same document: `200`,
`git log -1 --format=%an` → `agent`, and after 8 s the `doc.edited` count was
**unchanged at 1**. The write happened; only the acknowledgment did not.

**5. Interleaving.** Fresh document, then user save → agent save → user save,
then the window:

```
user commit     e532400a
agent commit    8dbc1081 agent
user commit     0c7caccd

doc.edited for this document: 2
  es_7c0f97e2 idle c8bf9b14..e532400a {"commits":1,"insertions":2,"deletions":1}
    range: e532400a(user)
  es_e63326d4 idle 8dbc1081..0c7caccd {"commits":1,"insertions":1,"deletions":0}
    range: 0c7caccd(user)
```

Two sessions, two ids, and `git rev-list <from>..<to>` for each contains exactly
one commit — the user's own. The agent's `8dbc1081` is in neither range; it is
the second session's *exclusive base*.

**6. The close path.** Save as `user` and `corpus server stop` with **no wait at
all**, so the 5 s window cannot have elapsed:

```
saved as user; 0 events so far
stopped (pid 80057)
doc.edited after the stop: 1
{ "docId": "doc_2r2pt47n", "sessionId": "es_710a5a014ab73f71", "actor": "user",
  "endedBy": "close", "from": "fee91e85…", "to": "c2cb361f…",
  "stats": { "commits": 1, "insertions": 15, "deletions": 0 } }
```

(A separate run where the two steps were seconds apart produced `endedBy:
"idle"` for the same shape — the first trigger to fire wins, and exactly one
event either way.)

**7. Truncation — the bug this E2E found.** A 500-paragraph rewrite,
`GET /api/docs/{id}/diff`, before and after the fix in decision 7:

```
before: truncated true  diff.length 166    totalChars 64281  stats {"commits":1,"insertions":1012,"deletions":0}
        last 60 chars: "…--- /dev/null\n+++ b/data/docs/inbox/very-long.md\n"
after:  truncated true  diff.length 15899  totalChars 64281  stats identical
        last 60 chars: "…filler words that make this line long enough to matter \n+\n"
        starts with a diff header: true    ends on a line boundary: true
```

**8. Server log** (§11's third surface) carried one line per acknowledgment:
`{"level":"info","msg":"user edit session acknowledged","docId":…,"sessionId":…,"endedBy":…,"eventId":…}`
— seven of them across the run, matching the seven events on disk.
`GET /api/queue/status` reported them as ordinary `pending` work.

**9. Gates.**
- `VITEST_MAX_THREADS=4 vitest run apps/server` → **168 files, 3250 tests, all
  passing** (57 new: 25 in `edit/sessions.test.ts`, 12 in `edit/diff.test.ts`,
  11 in `edit/routes.test.ts`, 8 in `edit/acknowledgment.test.ts`, 1 in
  `config.test.ts`).
- `tsc --noEmit -p apps/server/tsconfig.json` → clean; `apps/cli` too.
- `eslint apps/server/src --max-warnings 0` → no issues, no rule disabled.
- `prettier --check` → clean.

One pre-existing test needed a one-line change: `docs/write.test.ts`'s
"broadcasts keys only" advances the fixture clock 60 s between six verbs, which
is enough for a user edit session to idle out mid-sequence and put a *queue*
frame among the document frames. The subscription now ignores frames carrying
`["queue"]`, with a comment; the assertion itself is untouched.

**10. Cleanup.** Server stopped, port 9471 verified free (`lsof` empty), scratch
workspace removed, no vitest workers alive.

## Round 2 — PR #22 review findings (server-dev, 2026-08-05)

**Model: Opus 5 (1M context)** (`claude-opus-5[1m]`), branch `phase-11-edit-ack`.
Real server from source (`tsx apps/server/src/main.ts`) over a real `corpus init`
workspace at `/tmp/corpus-s052-fix`, **port 9481** (never 8765, never 5173),
`editAcknowledgment.idleMs` = 5000. Only `apps/server/` and these issue files were
touched; `apps/server/src/anchors/` was left alone (another agent holds it).

### MAJOR 1 — the squash-amend after a flush: **reproduced, then fixed**

The reviewer derived this from two code paths without executing it. It executes.
Sitting: save → reader closes (flush) → reopen inside §4's 30 s squash window →
fix a typo.

**Before the fix** (real server, real git, real queue files):

```
save 1 200  HEAD(A) = 2d668c489f7e45432fd95aee10a0834d1177bcc7
flush 204   → 1 doc.edited
save 2 200  HEAD(A') = a94ff9de0b3c41bfad9d82949866ae89503cfab7   (an amend)
A still reachable from any branch: false

doc.edited for this document: 2
  es_b66bbdb24378dc14 close 6b610e9a..2d668c48 {"commits":1,"insertions":2,"deletions":1}
  es_522f67f6d9fbda12 idle  6b610e9a..a94ff9de {"commits":1,"insertions":3,"deletions":1}
```

Exactly as filed: the **same `from`**, the second range strictly containing the
first, two `sessionId`s so the skill's "drop a repeat by `sessionId`" cannot
suppress it, and the first event's `to` left dangling (`rev-list --all` no longer
lists it, though `rev-parse --verify` still resolves the object).

**The fix — an acknowledged commit leaves the squash session.** `AutoCommitter`
gains `endSquashSession(sha)`: it forgets the squash record when the record sits
on that sha, so the next save makes a *fresh* commit. `EditSessionTracker.end()`
calls it with the session's `lastSha`, synchronously, *before* the emitter's first
git read.

Why this rather than teaching the tracker to recognise the amend: the tracker
cannot. `ObservedCommit` carries no pre-amend sha, and once the amend has landed
there is **no sha between** the acknowledged change and the new one to draw a
range at — any second event must re-cover the first. Prevention is the only place
the problem is soluble, and it also fixes the dangling `to`, which no
tracker-side rule could. It is the rule `isPublished()` already applies to a
commit a remote has seen, applied to the other way a sha gets out.

Three deliberate details: the seal is **by sha**, not by document, so a stale
acknowledgment cannot break an unrelated live session (tested); it is
**unconditional**, not conditional on an event actually following, because a
session that ended is a boundary in the history either way and the cost of being
wrong is one commit that did not fold; and it is **synchronous**, which is what
gets it in front of a save landing while the emitter's git reads are in flight.

**Residual, stated rather than hidden.** A flush arriving *after* an in-flight
save's `amendTarget` has already read the squash record still amends. That window
is one `git commit --amend` wide, and closing it means ordering `flush` behind the
git lock — making a route that publishes a synchronous `204` wait on the write
path's contention. Not done.

**After the fix**, same script, same workspace:

```
save 1 200  HEAD(A) = 62ae5b88679d91ece3e669524884845035b6f035
flush 204   → 1 doc.edited
save 2 200  HEAD = 029c4ed84edc099728b5126d350a2d19af6c606c   (a fresh commit)
A still reachable from any branch: true

doc.edited for this document: 2
  es_0c98c2778bfe221b close 7a1e6bf4..62ae5b88 commits=[62ae5b88] {"commits":1,...}
  es_5aff19c4cd91b488 idle  62ae5b88..029c4ed8 commits=[029c4ed8] {"commits":1,...}
```

Adjacent, not overlapping: the second range **starts** where the first ended, each
holds exactly its own session's commit, and both `to`s are on the branch.

### MINOR 1 — `touches` was actor-blind: **fixed**

The reviewer is right, and `edit/diff.ts:88-95` was the contradicted party:
`commits` comes from `rev-list` precisely because "a user session interleaved with
the user's *own* non-editor writes to the same file has those commits in its
range". Sealing on them made that false. Now only a commit by **the other party**
seals; the seal loop is skipped entirely for `commit.actor === SESSION_ACTOR`.
An agent write still seals exactly as before (its own test is unchanged).

Live, the reported case — commenting on the document you are editing, which
stages that document's frontmatter under the *thread's* id:

```
[MINOR 1] doc_kzxaic73
  save 1 200 · thread create 201 · save 2 200
  result: 1 doc.edited
    es_fc9873a4 idle f0203614..cea3d153 commits=[cea3d153,f17b5ac1,3c10303e]
      stats={"commits":3,"insertions":13,"deletions":2}
```

One acknowledgment for one sitting, and its range holds all three of the user's
own commits — the comment among them — which is what `readRangeStats` always
claimed to count.

### MINOR 2 — the rename branch: **made reachable, not deleted**

The reviewer's reachability argument was correct *under the old sealing rule*: a
move sealed the session on the docId arm, so `own.path` could never be refreshed.
Fixing MINOR 1 removes exactly that seal — `docs/move.ts` commits as the user —
so the branch is now the mechanism that makes a session survive a move. Kept,
with the comment rewritten to say why, and covered both by a unit case (three
fresh commits, asserting the emitter diffs at the *new* path) and live:

```
[MINOR 2] doc_5ukwofe3  data/docs/inbox/moved-mid-session.md
  save 1 200 · move 200 → data/docs/projects/moved-mid-session.md · save 2 200
  result: 1 doc.edited  es_6294f540 idle d5cd4f4f..1694c537 {"commits":1,"insertions":17}
  git diff --shortstat <from>..<to> -- data/docs/projects/moved-mid-session.md
    1 file changed, 17 insertions(+)
```

One acknowledgment, and the stats agree with git *at the path the document now
holds* — which is the only path `git diff` reports it under, and the rule
`readDocDiff` already documents. Had the path not been refreshed the range would
have been read at the old path and reported the document as deleted.

### Tests and gates (round 2)

- `apps/server/src/edit/sessions.test.ts` +6: four for "a named commit leaves the
  squash session" (flush, idle, shutdown; only the newest sha; nothing for a
  session that never landed a commit) and two for the MINORs.
- `apps/server/src/git/commit.test.ts` +2: a real repository proving the next save
  inside the window is a **fresh** commit with the named one still on the branch,
  and that sealing an unknown sha leaves the live session foldable.
- `apps/server/src/edit/acknowledgment.test.ts` +1: the whole sitting over the real
  write path. Verified to **fail before the fix** (the acknowledged sha is absent
  from `git log` once the amend lands) and pass after.
- `VITEST_MAX_THREADS=4 vitest run apps/server` → **168 files, 3286 tests, all
  passing**.
- `tsc --noEmit -p apps/server/tsconfig.json` → clean.
- `eslint … --max-warnings 0` → clean, no rule disabled. `prettier --check` → clean.
- Server stopped, port 9481 verified free, scratch workspace removed.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
