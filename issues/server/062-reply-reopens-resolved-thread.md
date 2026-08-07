# [SERVER-062] A person's reply reopens a resolved thread

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-019 (Amendment 1, signed 2026-08-05)
- Blocks: —
- Related: UI-078 (the resolve confirmation whose promise this makes true)

## Spec References

- SPEC.md §8 — "Resolved is a closed door, not a locked one: a person's reply
  reopens it." _(Rider signed 2026-08-05.)_
- SPEC.md §4 — every mutation auto-commits with the acting party as git author
- SPEC.md §6 — thread `status`, the reopen the UI already offers by hand

## Summary

SPEC §8 gained a signed bullet today: a turn written by a **person** on a
`resolved` thread sets the thread back to `open`, and from there §8's ordinary
rules apply unchanged. A turn written by the **agent** never reopens.

Today no reply path writes `status` at all — `buildTurnAppend` writes only
`updated` and `agent` — and `participation.ts` suppresses the implicit
re-trigger while `status === "resolved"`. So a person who resolves a thread and
later replies gets silence: the turn lands, the thread stays resolved, nothing
is enqueued, and the UI's confirmation ("Thread resolved — committed. Replying
reopens it.") is false. That is UI-078.

This issue makes the promise true, in the write path, as **one** rule: the
reopen is computed inside `decideParticipation` and applied *before* the enqueue
question is asked, so the engaged/note-only/agent-authored matrix keeps deciding
what it always decided — against the thread's status **after** the reopen.

## Acceptance Criteria

- [x] A person's turn on a `resolved` thread writes `status: open` as part of the
      **same** mutation that appends the turn — one file write, one commit, one
      re-projection, one invalidation
- [x] That commit carries the acting party as git author, like any other status
      change (§4)
- [x] §8's ordinary rules then apply unchanged: an `engaged` thread enqueues
      `comment.created`; a `requestsAgent: false` ("note only") turn reopens and
      enqueues nothing; a thread the agent is not engaged in reopens and enqueues
      nothing
- [x] A turn written by the **agent** never reopens — enforced on the author, not
      on incidental ordering
- [x] The reopened thread is indistinguishable from one reopened by hand:
      `status: open` in the frontmatter, `status: "open"` in the projection and
      on the wire, the same invalidation keys as `POST /api/threads/{id}/reopen`
- [x] The existing `@agent` / `requestsAgent: true` short-circuit composes rather
      than double-handling: it still wins the enqueue question outright, and the
      reopen happens beside it because the author is a person
- [x] Tests pin all of it; every test that asserted the old silent behaviour is
      corrected

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/participation.ts` — `ParticipationDecision` gains
  `status`: the thread's status **after** this turn. `shouldEnqueue` reads that
  post-reopen status instead of the thread's stored one.
- `apps/server/src/threads/turns.ts` — `buildTurnAppend` takes the post-turn
  `status` and writes it **only when it moves**; the commit subject says
  `(reopened)` when it did.
- `apps/server/src/threads/forms.ts` — passes the same decision through; a form
  answer is a turn, so a person answering a form on a resolved thread reopens it
  too. `formCommitSubject` gains the same suffix.
- `apps/server/src/threads/participation.test.ts`,
  `apps/server/src/threads/turns.test.ts`,
  `apps/server/src/threads/forms.test.ts` — the matrix, the E2E-shaped route
  tests, and the corrections.

### Key Implementation Details

**One rule, not two.** `decideParticipation` computes `status` first:

```
thread === null                                   → "open"   (creation)
thread.status === "resolved" && author === "user" → "open"   (§8's reopen)
otherwise                                         → thread.status
```

and `shouldEnqueue` then asks its existing question against *that* status. The
resolved guard in `shouldEnqueue` is therefore untouched in form — it simply can
no longer fire for a person's turn, because by the time it is asked the thread is
open. Nothing in the enqueue matrix is special-cased on reopening.

**Written only when it moves.** `read.ts` reports an **archived** thread's status
as `open` (an archived thread is still an unresolved conversation), so restating
`status` on every reply would silently unarchive it. `buildTurnAppend` compares
the decided status against the loaded one and patches the field only on a real
change — `setFrontmatterFields` would already no-op an equal value, but the
archived case is not an equal value, it is a lossy one.

**The commit subject.** The reopen rides in the turn's own commit rather than a
second one, so without a marker `git log` would record a status change with no
word about it — while every explicit status change names itself
(`thread reopen: …`). The turn subject becomes
`comment: turn on <id> by <actor> (reopened)` (and `form: answer on … (reopened)`).
§4's session folding takes the *newer* save's subject, so the marker survives a
fold into the preceding resolve commit.

### Edge Cases

- **Agent turn on a resolved thread** — no reopen (author check), no enqueue;
  a conversation the agent closes stays closed.
- **`@agent` / ask-agent toggle on a resolved thread** — already short-circuited
  to `enqueue: true` before any status question, and that is unchanged. When the
  author is a person the thread *also* reopens now, so the previously invisible
  escape hatch stops being a special case: every person's turn reopens, and this
  one additionally enqueues even where §8's automatic clause would not have.
- **"Note only" on a resolved thread** — reopens, enqueues nothing (§8, verbatim).
- **Archived thread** — untouched; the decided status equals the read status and
  no `status` field is written.
- **Form answer by a person on a resolved thread** — reopens and re-triggers if
  engaged; this makes `FormAnswerResponse.eventId`'s contract *description*
  stale (it still says a resolved thread stops re-triggering). Flagged to the
  orchestrator: prose in `packages/contract`, not this domain's to edit.

## Testing Strategy

`participation.test.ts` — the matrix gains the reopen column: person-on-resolved
reopens (engaged → enqueue, note-only → no enqueue, `@agent` → enqueue),
agent-on-resolved does not. The existing "a resolved thread stops the automatic
re-trigger" case is **corrected**: it asserted the defect.

`turns.test.ts` / `forms.test.ts` — through the real app, real files, real git,
real queue: resolve → reply → frontmatter says `status: open`, the projection
row says `open`, the response summary says `open`, an event was enqueued, `HEAD`
moved and its author is `user`. Then note-only, then agent-authored.

## E2E Verification Plan

Real server against a real workspace directory, driven with curl.

### Reproduction Steps (bugs only)

1. `corpus init` a scratch workspace, start the server on a free port.
2. Create a doc, a thread on it, get the agent `engaged` (`@agent` + agent reply).
3. `POST /api/threads/<id>/resolve`.
4. `POST /api/threads/<id>/turns` as `user` with a plain body.
5. Expected (post-fix): thread reopens, an event is enqueued.
6. Actual (pre-fix): `status: resolved` on disk, `eventId: null`, queue unchanged.

### Verification Steps

1. Restart the server on the fixed code.
2. Repeat 2–4 → frontmatter `status: open`, `eventId: evt_*`, queue +1,
   `git log -1 --format='%an|%s'` = `user|comment: turn on … (reopened)`.
3. Note-only reply on a re-resolved thread → reopened, queue unchanged.
4. Agent reply on a re-resolved thread → still `resolved`, queue unchanged.
5. `@agent` on a re-resolved thread → reopened **and** enqueued.
6. Form answer by a person on a re-resolved thread → reopened, `form.respond`.
7. `POST …/reopen` on the reopened thread → `200` that writes nothing.
8. `GET /api/db/doctor` clean.

## E2E Verification Log

_implemented on: opus_

### Reproduction (bugs only)

Real server — `node_modules/.bin/tsx apps/server/src/main.ts` run from a real
`corpus init` workspace at `/tmp/corpus-s062`, port **8931** (never 8765) — on
the **pre-fix** code, driven with curl. Doc + thread seeded over HTTP, agent
brought to `engaged` by an `@agent` create and an `x-corpus-author: agent` turn.

```
$ curl -s -XPOST $B/api/threads/$TH/resolve …          -> "resolved"
$ ls .corpus/queue/pending/ | grep -c evt_             -> 1   (the create's event)

$ curl -s -XPOST $B/api/threads/$TH/turns \
    -H 'x-corpus-author: user' -d '{"body":"actually, one more thing"}'
{"thread":{"id":"th_qa5u3bur",…,"status":"resolved","agent":"engaged",
 "turnCount":3,"lastAuthor":"user",…},
 "turn":{"author":"user","ts":"2026-08-06T05:26:02Z","body":"actually, one more thing"},
 "eventId":null,"warnings":[]}

$ grep '^status:' data/threads/$TH.md                  -> status: resolved
$ ls .corpus/queue/pending/ | grep -c evt_             -> 1   (unchanged)
$ git log -1 --format='%an <%ae>|%s'
user <user@corpus.local>|comment: turn on th_qa5u3bur by user
```

Confirmed: the turn lands, the thread stays `resolved`, `eventId` is `null` and
the queue does not move. The UI's "Thread resolved — committed. Replying reopens
it." is false. Bug reproduced; server stopped, port confirmed free.

### Post-Implementation Verification

Server stopped and restarted on the fixed code against a **fresh** workspace
`/tmp/corpus-s062b`, same port 8931. `doc_qapdr4s6` / `th_fa6ttpqg`, agent
`engaged`, thread resolved, 1 event already pending.

**1. Person's plain reply on a resolved, engaged thread** — the reproduction, now:

```
$ curl -s -XPOST $B/api/threads/$TH/turns \
    -H 'x-corpus-author: user' -d '{"body":"actually, one more thing"}'
{"thread":{…,"status":"open","agent":"engaged","turnCount":3,"lastAuthor":"user",…},
 "turn":{"author":"user","ts":"2026-08-06T05:34:34Z","body":"actually, one more thing"},
 "eventId":"evt_xvihnvzkumrf","warnings":[]}

$ grep '^status:' data/threads/$TH.md      -> status: open
$ ls .corpus/queue/pending/                -> evt_izxl3ghg5etz.json  evt_xvihnvzkumrf.json
   evt_xvihnvzkumrf comment.created {"threadId":"th_fa6ttpqg","parentId":"doc_qapdr4s6",
     "turnTs":"2026-08-06T05:34:34Z","mentions":[],"skills":[],"unresolved":[]}
$ curl -s $B/api/threads/$TH | …["status"]                    -> open
$ sqlite3-equivalent select status,agent,turn_count from threads -> ('open','engaged',3)
$ git log -1 --format='%an <%ae>|%s'
user <user@corpus.local>|comment: turn on th_fa6ttpqg by user (reopened)
```

The reply's commit here **folded** into the preceding resolve (§4: same actor,
same document, inside the 30 s window), which is why its diff shows no status
line — `HEAD`'s tree carries the result:

```
$ git log --format='%h %an %s' | head -3
537c097 user  comment: turn on th_fa6ttpqg by user (reopened)
02769d3 agent comment: turn on th_fa6ttpqg by agent
ef24096 user  comment: new thread on doc_qapdr4s6 (th_fa6ttpqg) by user
$ git show HEAD:data/threads/$TH.md | grep '^status:'   -> status: open
```

The **unfolded** shape (step 4 below) shows the single commit carrying both.

**2. "Note only" reply**, thread re-resolved first:

```
$ curl … -d '{"body":"just for the record","requestsAgent":false}'
status: open   eventId: None
pending before=2 after=2
$ grep '^status:' data/threads/$TH.md   -> status: open
```

Reopened without waking anybody — §8's sentence verbatim.

**3. Agent's turns**, thread re-resolved first:

```
$ curl … -H 'x-corpus-author: agent' -d '{"body":"nothing further from me"}'
status: resolved   eventId: None      pending before=2 after=2
$ git log -1 --format='%an|%s'  -> agent|comment: turn on th_fa6ttpqg by agent

$ curl … -H 'x-corpus-author: agent' -d '{"body":"over to you","requestsAgent":true}'
status: resolved   eventId: evt_b4g2mq57ejz3
$ grep '^status:' data/threads/$TH.md   -> status: resolved
```

Stays closed both ways, including the one where the agent enqueues — the reopen
is refused on the **author**, not on whether anything was enqueued. No
`(reopened)` marker on either commit.

**4. One commit carries the turn *and* the flip.** A user reply immediately after
the agent's write (different actor ⇒ no fold), on the still-resolved thread:

```
$ curl … -d '{"body":"one more question"}'      -> status: open, eventId: evt_brkeo6h55vtu
$ git log -1 --format='%an <%ae>|%s'
user <user@corpus.local>|comment: turn on th_fa6ttpqg by user (reopened)
$ git show HEAD --format= -- data/threads/$TH.md | grep -E '^[+-](status|one more)'
-status: resolved
+status: open
+one more question
```

**5. `@agent` on a resolved thread** (the pre-existing escape hatch), re-resolved
first: `status: open`, `eventId: evt_b7hkhlcvtdiu`, pending 4 → 5. It reopens
like every other person's turn *and* still enqueues on its own terms.

**6. Indistinguishable from a hand reopen.** `POST /api/threads/$TH/reopen` on
the reply-reopened thread: `200`, `"status":"open"`, and `git rev-parse HEAD`
unchanged — `status.ts`'s idempotent path wrote nothing, which is only reachable
if the thread is genuinely open. The SSE frame the reply broadcast is also
key-for-key the one `resolve` broadcasts:

```
event: invalidate
data: {"keys":[["docs"],["docs","th_fa6ttpqg"],["threads","th_fa6ttpqg"],["docs","doc_qapdr4s6"]]}
```

**7. Form answer by a person on a resolved, engaged thread** (agent posts a
```form fence, thread resolved, user answers):

```
status: open   eventId: evt_k4bexgz5qu4v      pending 5 -> 6
newest event: form.respond
$ grep '^status:' data/threads/$TH.md   -> status: open
$ git log -1 --format='%an <%ae>|%s'
user <user@corpus.local>|form: answer on th_fa6ttpqg by user (reopened)
```

**8. An archived thread is never unarchived by a reply.** `status: archived`
written into a thread out of band, `POST /api/db/rebuild`, then a user reply:
the response reports `status: open` (read.ts maps archived → open for threads,
unchanged behaviour) and the file still reads `status: archived`. The lossy
write the naive "always restate status" version would have made does not happen.

**9. Workspace consistent afterwards.** `GET /api/db/doctor` →
`{"ok":true,"drift":[],"warnings":[],"stats":{"files":12,"documents":12,…}}`.

Final `git log` for the thread, showing the reopen is an ordinary, visible,
attributed status change:

```
user |form: answer on th_fa6ttpqg by user (reopened)
agent|comment: turn on th_fa6ttpqg by agent
user |comment: turn on th_fa6ttpqg by user (reopened)
agent|comment: turn on th_fa6ttpqg by agent
user |thread resolve: Re: Mortgage model (th_fa6ttpqg) by user
agent|comment: turn on th_fa6ttpqg by agent
user |comment: new thread on doc_qapdr4s6 (th_fa6ttpqg) by user
```

Server stopped; port 8931 free; no stray `tsx main.ts` processes.

### Checks

- `VITEST_MAX_THREADS=4 vitest run apps/server` — **3316 passed, 2 failed**
  (168 files, 1 failed). Both failures are `apps/server/src/queue/routes.test.ts`
  (`ClaimBatchSchema` / `IdleResultSchema` no longer parse the handler's
  response) and come from CONTRACT-033's newly required `inProgress` field,
  which **SERVER-061 owns**. Unrelated to thread reopening; not adjusted here.
- `tsc --noEmit -p apps/server` — one error, `queue/routes.ts:29`, the same
  CONTRACT-033 surface and nothing wider.
- `eslint` and `prettier --check` clean on every touched file.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier on touched files; scoped)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
