# [SERVER-095] Resizing a board column wakes the agent to reflect on it

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: SERVER-052 (built the acknowledgment), CONTRACT-028 (its payload),
  UI-096-adjacent view-state writes

## Spec References

- SPEC.md **§4** "Edit acknowledgment" — "Every *user* edit session on a document
  ends one of two ways… the server emits one `doc.edited` queue event carrying
  the document id and the session's commit range with change stats… The
  orchestrate skill **reflects on the change**: it checks, through retrieval,
  whether the change ripples into other documents; updates those documents, or
  records what it noticed in **their** changelogs"
- SPEC.md **§8** — what wakes the agent
- SPEC.md **§10** — the board, and the autosave

## Summary

**Reported by the user, 2026-08-10: the system is unusable and burns tokens on
nothing.** Every UI write to a document — not just a content edit — emits a
`doc.edited`, so the agent wakes and reflects on things like a column resize.

Reproduced from the user's own live workspace. This is the **entire** diff of a
commit that woke the agent to reflect on it:

```
commit 4e8fc3f  Author: user  doc edit: Open threads (doc_seedopenthreads) by user

 data/docs/views/open-threads.md | 4 ++--

-updated: 2026-08-08T22:24:13Z
+updated: 2026-08-08T22:41:49Z
-width: 444
+width: 725
```

Somebody dragged a board column wider. `apps/ui/src/board/useColumnWidth.tsx`
persists that as `PUT /api/docs/:id` with `{ extra: { width } }` and nothing
else — a legitimate write of view state to a `type: view` document. The agent was
then asked whether it "ripples into other documents".

The user's framing, which is the acceptance test: **only content edits from a
human should be considered for reflection, not any UI event.**

## Root cause

`apps/server/src/docs/update.ts:388` sets `editSession: loaded.path`
**unconditionally** on every `PUT`, so `observeCommit` opens a session for any
user save whatever it changed. §4 scopes the acknowledgment by *actor* — which
works, agent saves are correctly ignored — but nothing scopes it by **what
changed**.

The comment at that line gives a reason for carrying the path unconditionally:

> Only a `user` save opens one — the tracker scopes that — but the path is
> carried unconditionally, because an agent save through the same verb still has
> to seal a session the user has open on this document.

**That reason does not hold.** Sealing runs through `touches(commit, session)`
(`edit/sessions.ts:262`), which compares `commit.docId` and `commit.paths` — it
never reads `editPath`. So making `editSession` conditional costs sealing
nothing. Verify that before relying on it; it is the linchpin of the fix being
one line rather than a redesign.

## Acceptance Criteria

- [x] Reproduce first, per the SDLC: a `PUT` changing only `extra`, only `tags`,
      or only `status` currently emits a `doc.edited`. Show it before fixing
- [x] A user save that changes neither the body **nor the title** opens no edit
      session and emits no `doc.edited`. Column width, tags, status, folder,
      `reviewed`, `query` — none of them wake the agent.

      **Amended by user sign-off 2026-08-11**, after PR #42's re-review found the
      case: the first cut scoped a session to the **body** alone, so someone who
      opened the reader and renamed a document was silently never acknowledged.
      §4 now draws the line at what the document **says** — its body, or the
      title it goes by — against how it is *held*. `title` moved out of the
      negative table into two cases of its own: a rename wakes the agent, a
      re-sent identical title does not.
- [x] A user save that **does** change the body opens a session exactly as today.
      No regression in the acknowledgment's range, stats or idle behaviour
- [x] A save carrying a body change **and** frontmatter changes is a content
      edit — the body is what decides, and the rest riding along does not
      disqualify it
- [x] A `PUT` that names a body identical to what is stored is **not** a content
      edit. `changedFields` already drops a `reviewed` equal to the file's; the
      body deserves the same treatment, or the UI's periodic autosave of
      unchanged text reintroduces this bug in a quieter form
- [x] **Sealing is unaffected.** An agent save still seals a user's open session
      on that document, whatever the agent changed. Prove it with a test where
      the agent's save changes only frontmatter
- [x] Nothing else that emits `doc.edited` is left unscoped. Sweep every caller
      of `observeCommit` for the same gap rather than fixing the one verb

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/update.ts` — the conditional, and the corrected comment
- `apps/server/src/docs/update.test.ts`, `apps/server/src/edit/acknowledgment.test.ts`

### Key Implementation Details

The change should be to `editSession`, not to the tracker: the tracker's actor
scoping is correct and its sealing rule is correct, and widening the fix into
`edit/sessions.ts` risks both. Decide the body change where the other field
comparisons already happen, beside `changedFields`.

**Do not edit `apps/server/src/edit/sessions.ts` or `apps/server/src/git/commit.ts`**
— another agent is fixing PR #42's review finding in both files right now. If you
believe the fix belongs there, stop and tell the orchestrator.

### Edge Cases

- **A body change that normalizes to the same bytes** (trailing whitespace, a
  serializer round-trip). It reaches disk as no change at all; treat it as no
  content edit rather than as one, and say which you chose in the log.
- **A `PUT` with no body field at all** — §9.2 says an omitted body is a save
  that names no change. Plainly not a content edit.
- **A user's *first* save being frontmatter-only, then a body save.** The session
  opens on the body save, and its range starts there. Correct: the frontmatter
  save is not part of the sitting the agent is asked to reflect on.

## Testing Strategy

Unit, against the real write pipeline. One test per field class that must **not**
open a session (`extra`, `tags`, `status`, `title`, `folder`, `reviewed`, empty
body), one that must (a real body change), one mixed, and one sealing test where
the agent's save is frontmatter-only.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start a server on a free port (**never 8765 or 5173**) against a scratch
   workspace with a `type: view` document.
2. `PUT /api/docs/<view-id>` with `{"extra":{"width":725}}` as `user`.
3. Wait past the acknowledgment idle window.
4. Expected: nothing in `.corpus/queue/pending/`.
5. Actual: a `doc.edited` event naming that document.

### Verification Steps

1. Repeat after the fix: no event for the width write; an event for a real body
   edit; both in the same session.

## E2E Verification Log

**Model: opus** (server-dev), 2026-08-10.

Real `corpus` binary, real `corpus init` workspace at
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/ws095{,b}`, real server on port
**8791** (never 8765 or 5173), real git repository, real file-backed queue.
`editAcknowledgment.idleMs` lowered to 2000 in `.corpus/config.json` so the
three-minute window is watchable; nothing else about the workspace is special.

### Reproduction (pre-fix, mandatory)

`POST /api/docs` created a `type: view` document (`doc_wo5uxg2l`), then a `PUT`
carrying only view state, exactly as `useColumnWidth.tsx` sends it:

```
$ curl -X PUT .../api/docs/doc_wo5uxg2l -d '{"extra":{"width":725}}'   # actor: user
$ sleep 5   # past the 2 s window
$ cat .corpus/queue/pending/evt_sx3sfadfhkir.json
{ "type": "doc.edited", "source": "edit",
  "payload": { "docId": "doc_wo5uxg2l", "sessionId": "es_2848c7e356ff2422",
               "actor": "user", "endedBy": "idle",
               "from": "8008ee2…", "to": "3465a6e…",
               "stats": { "commits": 1, "insertions": 15, "deletions": 0 } } }
```

The reported bug, on a real server: a dragged column width woke the agent to
reflect on it. The other field classes behave the same way — pending-file count
before → after each `PUT`:

| `PUT` body                      | pending events |
| ------------------------------- | -------------- |
| `{"extra":{"width":725}}`       | 0 → 1          |
| `{"tags":["alpha"]}`            | 1 → 2          |
| `{"title":"Open threads renamed"}` | 2 → 3       |
| `{"status":"resolved"}`         | 3 → 4          |

(`{"status":"draft"}` was a `400` — `draft` is not a `DocStatus`; re-run with
`resolved`, above.) Four `doc.edited` events, zero words of prose written.

### The linchpin — confirmed, the reason is bogus

`edit/sessions.ts:263` reads

```ts
const touches = (commit: ObservedCommit, session: OpenSession): boolean =>
  commit.docId === session.docId ||
  commit.paths.some((path) => session.path === path || session.path.startsWith(`${path}/`));
```

— `docId` and `paths`, never `editPath`. And `observeCommit:400` computes
`const editPath = commit.actor === SESSION_ACTOR ? commit.editPath : null;`, so
an agent save's path is discarded *before* anything looks at it; the sealing loop
at `:424` runs on `commit.actor !== SESSION_ACTOR` and is reached whatever the
path was. Carrying the path on an agent save has never done anything at all.
Confirmed behaviorally as well, below — no edit to `edit/sessions.ts` or
`git/commit.ts` was needed or made.

### Verification (post-fix, fresh workspace `ws095b`)

Same server, same doc, one `PUT` each, 5 s wait after each:

| `PUT` body                                            | pending |
| ----------------------------------------------------- | ------- |
| `{"extra":{"width":725}}` — the reported case          | 0 → 0   |
| `{"tags":["alpha"]}`                                   | 0 → 0   |
| `{"status":"resolved"}`                                | 0 → 0   |
| `{"title":"Renamed"}`                                  | 0 → 0   |
| `{"reviewed":"2026-08-10T12:00:00Z"}`                  | 0 → 0   |
| `{"query":{"type":"thread"}}`                          | 0 → 0   |
| `{"body":"<stored bytes>","tags":["beta"]}`            | 0 → 0   |
| `{"body":"…A new paragraph the person wrote.\n"}`      | 0 → **1** |
| `{"body":"…And another.\n","tags":["gamma"]}`          | 1 → **2** |

Every one of those writes **landed** — the document on disk afterwards carries
`title: Renamed`, `status: resolved`, `reviewed: 2026-08-10T12:00:00Z`,
`width: 725`, `query: {type: thread}`, `tags: [gamma]` — so this is saves that
committed and simply did not open a session, not saves that were dropped. The
two body edits produced one `doc.edited` each (`commits: 1`).

### Sealing, on the real server

`user` body edit → **agent** `PUT {"tags":["filed"]}` (frontmatter only) → `user`
body edit, then shutdown:

```
7620b39 user  doc edit: Shared (doc_rm7rxdbh) by user
fa5f20a agent editing session: 1 document by agent
d1195e2 user  editing session: 1 document by user

user idle from=013bf29 to=d1195e2 {"commits":1,…} es_bec29d024371c46a
user idle from=fa5f20a to=7620b39 {"commits":1,…} es_92665010a6afce05
```

Two sessions, two `sessionId`s: the first ends at the commit **before** the
agent's, the second starts **from** the agent's commit. Neither range spans it,
and the agent's own write is acknowledged by neither. Sealing is unaffected by a
frontmatter-only agent save.

### Edge case chosen, as the issue asks

**A body change that normalizes to the same bytes** cannot arise: `setBody`
stores the body verbatim and `serializeDocument` concatenates it verbatim, so a
body string that differs from the one read off disk always differs on disk. The
only way to reach "no change at all" through a body is to send the stored bytes,
which `bodyChanged` already reports as **not** a content edit — the choice the
issue asked for, reached by construction rather than by a second rule.

### Sweep of every `observeCommit` caller

One caller: `docs/write.ts:1144` (`runMutation`), which passes
`plan.editSession ?? null`. `plan.editSession` is set at exactly one site in the
codebase — `docs/update.ts` — verified by grep across `apps/server/src`,
`packages/contract/src` and `plugins/`. Every other verb (create, move, archive,
unarchive, delete, thread turn, form answer, bulk act, lock audit, skill
rollback) leaves it unset and so already opened no session. The plugin surface
(`plugins/context.ts`'s `updateDoc`/`mutateDoc`) reaches the same
`updateDocumentLocked` and is therefore fixed by the same line: a plugin writing
`extra` no longer wakes the agent either. `doc.edited` itself is enqueued from
exactly one place, `edit/sessions.ts`'s `emit`, reachable only from a session,
openable only via `editPath`. No second unscoped path exists.

### Checks run

- `npm run build` — clean.
- `./node_modules/.bin/vitest run apps/server` (VITEST_MAX_THREADS=4) — **182
  files, 3796 tests, all passing**, no regressions.
- **Non-vacuity**: with the one-line fix temporarily reverted, 9 of the 13 new
  cases fail. The 4 that pass either way are the empty-patch case (a save that
  names no change never committed anyway), the two body-edit cases, and the
  sealing case — the last passing both ways being precisely the point.
- `npm run typecheck -w apps/server` — clean. `eslint` and `prettier --check` on
  all three touched files — clean.
- Servers stopped, port 8791 verified free.

### Follow-up: the regression this fix introduced, and its fix (PR #42 re-review)

**Model: opus** (server-dev), 2026-08-11. Found by PR #42's re-review; fixed in
`apps/server/src/edit/sessions.ts` — **`docs/update.ts:413` is unchanged**, the
conditional above stands.

**What broke.** The tracker held one boolean meaning "an amend will rewrite this
session's base", and maintained it from *its own saves*: a session was `single`
until a second save it followed made a commit. That was only ever right because
every user `PUT` was a save it followed. SERVER-095 made a frontmatter-only `PUT`
land a commit the tracker opens no session for — the commit still lands, and it
still opens a window the next body save folds into. The session then read that
fold's `amended` as §4's squash rewriting *its* commit and moved `firstSha` onto
the interloper. So the tracker inferred a fact about **git** from a fact about
**observation**; the two coincided by accident and SERVER-095 separated them.

**Reproduction, pre-fix, on a real server** (real `corpus init` workspace at
`…/tmp/ws096`, `npm start -w apps/server` on port **8793** — never 8765 or 5173,
real git, real file-backed queue, real 30 s/180 s windows waited out in real
time). Body edit → 32 s pause → `PUT {"extra":{"width":725}}` → body edit →
`POST …/edit-session/flush`:

```
1f812b4 user doc edit: Mortgage options (doc_vm7cdmv7) by user
95375cf user editing session: 1 document by user      <- the first body edit
ed291f2 user editing session: 1 document by user

doc.edited close from=95375cf to=1f812b4 {"commits": 1, "insertions": 3, ...}
$ git diff 95375cf..1f812b4 -- data/docs/inbox/mortgage-options-2.md
 +width: 725
 +three                       <- `+two` is missing: it is a context line
```

The range starts **after** the first edit, and one sitting is reported as one
commit. The same sequence with a **thread creation** in place of the frontmatter
save reproduces identically (`commits: 1`, `+two` absent) — that door was open
before this PR, since a thread creation never carried an `editPath` either.

**The fix.** `OpenSession.single` becomes `OpenSession.baseIsHead`, answered from
the commits the tracker is told about rather than from the saves it follows:
`observeCommit` hears about **every** mutation (that is how sealing works), so a
commit that is not an amend now clears `baseIsHead` on *every* open session
before the session for this write is opened or extended. A new commit is the new
`HEAD`; nothing under it can have its base amended, whoever wrote it and whatever
verb they used. `if (!result.amended) own.single = false` in the editor-save
branch is subsumed by that loop and gone.

**Verification, post-fix, same server and sequence:**

```
09a29df user doc edit: Mortgage options (doc_cspg4wvv) by user
16b7708 user editing session: 1 document by user
497e2ab user editing session: 1 document by user

doc.edited close from=497e2ab to=09a29df {"commits": 2, "insertions": 4, ...}
$ git diff 497e2ab..09a29df -- data/docs/inbox/mortgage-options-3.md
 +width: 725
 +two
 +three
```

And with the thread creation as the interloper: `commits: 2`, both `+two` and
`+three` in the range, the anchor frontmatter alongside them.

**Tests** (4 new; 2 integration against real git, 2 unit):

- `edit/acknowledgment.test.ts` → "a commit that opened no session does not move
  the base (PR #42 re-review finding 1)": the reviewer's exact sequence, once with the
  frontmatter-only save and once with a thread creation. Both assert `from` is
  `HEAD~2`, `commits: 2`, and that the range's diff contains **both** edits.
- `edit/sessions.test.ts`: the interloper as an observed commit with no
  `editPath`, and as a *neighbour document's* save — §4's party-scoped window
  reaches the same hazard through that door.
- **Non-vacuity**: with the loop removed and `if (!result.amended) own.baseIsHead
  = false` put back in the editor-save branch — i.e. exactly the pre-fix rule —
  all **4** new cases fail and the other 96 in `src/edit` pass. SERVER-095's 13
  cases pass unchanged either way; none was touched.

**Checks:** `npm run build` clean · `./node_modules/.bin/vitest run
apps/server/src` (VITEST_MAX_THREADS=4) — **182 files, 3800 tests, all passing**
(3796 + 4) · `tsc --noEmit -w apps/server` clean · `eslint apps/server/src/edit/`
and `prettier --check` on the three touched files clean · server stopped, port
8793 free, the user's 8765 untouched.

**SERVER-097 is not fixed here** and is made *easier*: it is about `from` naming
a commit that never touched this document, and it lands on `parentOf(firstSha)`.
This fix is the reason `firstSha` is now the session's real first commit, so 097
starts from an honest base — before it, "walk back to the previous commit
touching this path" would have walked back from the wrong commit.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
