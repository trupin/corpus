# [SERVER-164] The digest write path, and staleness on delete and revise

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-096
- Blocks: CLI-077, AGENT-069

## Spec References

- SPEC.md **§6** — the digest rider (signed 2026-09-05), and §6's turn deletion
  and last-turn revision, which are the two staleness triggers
- SPEC.md **§9** — sole writer; §4 — auto-commit

## Summary

Implement CONTRACT-096's routes and the rider's invariants:

- **PUT** writes `{body, watermark: newest turn ts, stale: false}` into the
  thread file's frontmatter, auto-committed like any mutation. Refused 422 when
  the thread has no resident designation, 422 on empty body, 404 unknown id.
  A thread with no turns: refuse 422 — the rider's watermark points at a turn.
- **DELETE** removes the digest. Same designation gate.
- **Staleness**: `DELETE /threads/:id/turns/:ts` and turn revision, when the
  affected turn's ts ≤ watermark, set `stale: true` in the same write. Turns
  after the watermark change nothing. The server never touches `body`.
- **Projection + doctor**: the digest projects with the thread; `db rebuild`
  reconstructs it from the file; doctor treats file/projection digest drift as
  drift.
- The watcher path (out-of-band edits) reconciles digests like anchors: an
  edit that removes turns at or under the watermark marks stale on projection.

## Acceptance Criteria

- [x] The rider's every sentence has a test: resident gate, watermark stamped
      server-side, staleness on delete-at-or-before, staleness on revise,
      no-op after watermark, DELETE, empty-PUT refusal, no-turn refusal
- [x] `rebuild && doctor` clean with digests present
- [x] Auto-commit carries the digest write with the agent author
- [x] `npm test -w apps/server` green (run as `vitest run apps/server` — the
      workspace declares no `test` script; 213 files, 4869 tests, 0 failures)

## E2E Verification Plan

Real server: designate a resident, write a digest via curl or the CLI once
CLI-077 lands, delete a covered turn, read the thread — `stale: true`, body
untouched. Log the exact requests.

## E2E Verification Log

**Model: opus** (server-dev, 2026-09-05).

### What was built

- `apps/server/src/core/digest.ts` — the frontmatter shape, the sibling of
  `core/resident.ts`: `storedDigest` (tolerant read, `stale` defaults false, the
  watermark normalized), `digestToStored`, `digestCovers`, `markedStale`,
  `coveredTurnsChanged`, `stalenessPatch`, `bodyEditStalenessPatch`.
- `apps/server/src/threads/digest.ts` — `writeDigest` and `clearDigest`, mounted
  in `threads/routes.ts` on the contract's `writeThreadDigest` /
  `clearThreadDigest`.
- `threads/read.ts` — `LoadedThread.digest` and `toWireThread`'s `digest`;
  `threads/context.ts` — `digest` on the pack base. (These two are
  CONTRACT-096's deliberate breakage.)
- `threads/cascade.ts` — turn deletion spreads `stalenessPatch` into its own
  `setFrontmatterFields`, so the flag and the deletion are one write.
- `docs/update.ts` — the same, via `bodyEditStalenessPatch`, for a whole-body
  save of a thread. See **Deviations**.
- `watcher/reconcile-out-of-band.ts` — the digest half of the §6 catch-all.
- `projection/schema.ts` (`SCHEMA_VERSION` 23 → 24) + `project-document.ts` —
  `threads.digest_body`, `digest_watermark`, `digest_stale`.

### E2E — a real server, a real workspace, curl

`corpus init` into a scratch workspace, config port set to **8974**, and the
server started **from this worktree's source** (`tsx apps/server/src/main.ts`)
so the code under test is the code that ran. The user's own server on 8765 was
never touched.

**The CLI verb does not exist yet** — `corpus thread digest` is CLI-077, which
depends on this issue. So the digest calls below are curl, which is the honest
interface for a server issue: it is exactly the request the CLI will send. The
CLI *was* used for everything it already covers — `init`, `thread create`,
`thread reply`, `thread designate`, `thread release`, `thread context`,
`db rebuild`, `db doctor`.

```
$ corpus thread create --title "The rate" -m "What is the rate on the new mortgage?"
created th_gr5obdnf — standalone
$ corpus thread reply th_gr5obdnf --from agent -m "It is 6.1% fixed for five years."
replied to th_gr5obdnf — turn 2026-09-05T21:42:33Z
$ corpus thread designate th_gr5obdnf
designated a general resident on th_gr5obdnf
```

**The write.** The body carries prose and nothing else, and the response carries
the watermark the server stamped:

```
$ curl -X PUT .../api/threads/th_gr5obdnf/digest -H 'x-corpus-author: agent' \
    -d '{"body":"They asked about the new mortgage rate. It is 6.1% fixed for five years."}'
HTTP 200
{"threadId":"th_gr5obdnf","digest":{"body":"They asked about the new mortgage rate. It is
 6.1% fixed for five years.","watermark":"2026-09-05T21:42:33Z","stale":false},"warnings":[]}
```

`2026-09-05T21:42:33Z` is the agent turn's `ts` — the newest turn, stamped
server-side. On disk:

```yaml
digest:
  body: They asked about the new mortgage rate. It is 6.1% fixed for five years.
  watermark: 2026-09-05T21:42:33Z
  stale: false
```

**Every refusal, on the real server.**

```
# a thread whose resident was released — both verbs, same code, same field
$ curl -X PUT  .../api/threads/th_tqp5zrv7/digest -d '{"body":"Should never land."}'   → HTTP 422
$ curl -X DELETE .../api/threads/th_tqp5zrv7/digest                                     → HTTP 422
{"code":"unknown_recipient","message":"`th_tqp5zrv7` holds no resident, and a digest is the
 resident's (SPEC.md §6). Nothing was written — designate a resident on that thread first
 with `POST /api/threads/th_tqp5zrv7/resident`. …","recipient":"th_tqp5zrv7"}

# blank body — the other 422, told apart at `code`
$ curl -X PUT .../api/threads/th_gr5obdnf/digest -d '{"body":"   "}'                     → HTTP 422
{"code":"bad_request","message":"a digest may not be blank: an empty write is not a clear,
 and clearing a digest is `DELETE /api/threads/{id}/digest`. Nothing was written.",
 "issues":[{"path":"body", …}]}

# unknown thread
$ curl -X PUT .../api/threads/th_notreal9999/digest -d '{"body":"prose"}'                → HTTP 404

# a watermark the writer tried to state — refused by name, before any handler
$ curl -X PUT .../api/threads/th_gr5obdnf/digest -d '{"body":"prose","watermark":"2020-01-01T00:00:00Z"}'
HTTP 400  {"code":"bad_request","issues":[{"path":"json","message":"Unrecognized key: \"watermark\""}]}
```

The **no-turns** `422` is unit-tested rather than exercised here: only a
hand-written file reaches it (`thread create` always writes a first turn, and
deleting a thread's last turn deletes the thread), so a real-server run would
have to hand-write the file and re-project, which is what the test does.

**Staleness on a covered turn's deletion — flag set, body untouched, one commit.**

```
$ curl -X DELETE .../api/threads/th_gr5obdnf/turns/2026-09-05T21:42:28Z -H 'x-corpus-author: user'
HTTP 200 {"deletedTurn":true,"deletedThread":false, …}

$ curl .../api/threads/th_gr5obdnf
… "digest":{"body":"They asked about the new mortgage rate. It is 6.1% fixed for five years.",
   "watermark":"2026-09-05T21:42:33Z","stale":true} …
```

The prose and the watermark are byte-identical to what was written. `git show`
proves the flag and the deletion are the same commit:

```
$ git log --format='%h %an %s' -n 2
ad54b43 user  comment: delete turn 2026-09-05T21:42:28Z on th_gr5obdnf by user
4e6c22e agent digest write: The rate (th_gr5obdnf) by agent

$ git show ad54b43 -- data/threads/th_gr5obdnf.md
  -  stale: false
  +  stale: true
   ---
  -## user · 2026-09-05T21:42:28Z
  -What is the rate on the new mortgage?
```

**A turn after the watermark changes nothing.** Digest rewritten (clearing
stale), a user turn appended at `21:44:04Z`, that turn deleted:

```
$ curl .../api/threads/th_gr5obdnf   →  "stale": false   (watermark still 2026-09-05T21:42:33Z)
```

**The watcher path.** The thread file was edited with `python3` outside the
server, removing the covered `21:42:33Z` turn. The watcher rewrote the digest's
flag and committed it with the person's own edit as one change:

```
$ git show HEAD -- data/threads/th_gr5obdnf.md
52af4dc doc edit: The rate (th_gr5obdnf) by user
  -  stale: false
  +  stale: true
   ---
  -## agent · 2026-09-05T21:42:33Z
  -It is 6.1% fixed for five years.
```

**The pack carries it** (`corpus thread context --json`):

```
{"shape":"standalone","threadId":"th_gr5obdnf","digest":{"body":"Rate 6.1% fixed five years,
 arrangement fee 999.","watermark":"2026-09-05T21:44:18Z","stale":true},"excerpts":[],
 "semanticIndex":"current"}
```

**The clear**, and its idempotence:

```
$ curl -X DELETE .../api/threads/th_gr5obdnf/digest  → HTTP 200 {"threadId":…,"digest":null,"warnings":[]}
# the `digest:` key is gone from the file — not written as null
$ curl -X DELETE .../api/threads/th_gr5obdnf/digest  → HTTP 200, same body, no new commit
```

**Rebuild and doctor.**

```
$ corpus db rebuild
rebuilt the projection in 257ms — 14 documents, 2 threads, 2 turns, …
$ corpus db doctor
projection is clean — 14 documents from 14 files (6ms)      # exit 0
```

The rebuilt projection carries the digest, reconstructed from the file, at
`schema_version 24`:

```
schema_version { value: '24' }
[ { id: 'th_gr5obdnf', digest_body: 'Rate 6.1% fixed five years, arrangement fee 999.',
    digest_watermark: '2026-09-05T21:44:18Z', digest_stale: 1 },
  { id: 'th_tqp5zrv7', digest_body: null, digest_watermark: null, digest_stale: null } ]
```

The server was stopped afterwards, port 8974 verified free, and the scratch
workspace removed.

### A defect the E2E found, and the fix

The first run's `git log` read:

```
d87afaf agent comment: turn on th_3cvxfqvc by agent
c750599 agent editing session: 1 document by agent      ← was "digest write: The rate (…)"
```

Left to fold, a digest write opens a §4 session window, and the next thing to
close that window **relabels the commit an editing session** — the subject
naming the act disappears from `git log` altogether. A digest is authored work
with a named author, and *"when was this digest written"* has to stay answerable
from the history. Fixed with `squash: false`, exactly as `resident.ts` writes its
own field. The regression test is *"keeps its subject when a later act closes the
window"*, and it was confirmed to fail without the flag (`expected false to be
true`) before it was put back. The final run shows `digest write:` and
`digest clear:` standing in `git log`.

### Tests

```
$ VITEST_MAX_THREADS=4 npx vitest run apps/server
Test Files  213 passed (213)
     Tests  4869 passed (4869)
```

New: `core/digest.test.ts` (35 cases — the stored shape's tolerances and
refusals, coverage as instants rather than strings, and each staleness
predicate), `threads/digest.test.ts` (34 — both verbs against the real app, every
refusal, the three staleness triggers, the stranded-digest consequence, the
projection columns and doctor), `watcher/reconcile-digest.test.ts` (9 — the
out-of-band half). Fixtures updated for the new required field:
`threads/read.test.ts`, `threads/context.test.ts`, `projection/db.test.ts`,
`projection/project-document.test.ts`.

`npx tsc --noEmit -p apps/server` clean — this closes CONTRACT-096's window.
`eslint apps/server/src` and `prettier --check apps/server/src` clean.

### Deviations from the issue, stated

1. **"Staleness on revise" has no in-band route to hook, because turn revision
   is not built.** §6's revision rider (signed 2026-08-05) is spec text with no
   endpoint: `packages/contract` publishes `DELETE /api/threads/{id}/turns/{ts}`
   and nothing that replaces a turn body. So the revise trigger is implemented as
   a **body comparison** (`coveredTurnsChanged`) rather than as a hook on a verb,
   and it is wired at the two places a covered turn's text can actually change
   today: the watcher's out-of-band path, and `PUT /api/docs/{id}`. When the
   revise route lands it needs one line — the same helper — and the tests for it
   already exist at the `core/digest.ts` level.

2. **`PUT /api/docs/{id}` was wired too, which the issue does not name.** A
   thread is a document, so that route can rewrite a thread's body and delete or
   revise covered turns. Leaving it out would have left a digest silently
   covering text that is gone, through an in-band verb. It costs one property
   read on every other save — `bodyEditStalenessPatch` returns before parsing a
   body for any document with no `digest:` key.

3. **The staleness flag is written into the *file*, not only "on projection".**
   The Summary's last bullet says the watcher marks stale on projection; the
   watcher rewrites the file, exactly as it does for anchors, so every reader
   agrees and `db doctor` stays clean. A projection-only flag would have made
   `GET /api/threads/{id}` — which reads the file — disagree with the board.

4. **`squash: false` on both digest verbs**, which the issue does not mention.
   Reasoned above, from a real-server observation.

### Escalated, not fixed: a digest can be forged past the resident gate

`digest` is **missing from `RESERVED_FRONTMATTER_KEYS`**
(`packages/contract/src/schemas/extra.ts`). `extra` is a client-supplied merge
patch onto frontmatter, so an unreserved key means an agent can write a whole
digest — prose, watermark, and `stale: false` — through an ordinary
`PUT /api/docs/{id}`, with no resident and no refusal. It can also clear a
`stale` flag the server set, which the rider says only a fresh digest may clear.

Reproduced on the running server above, against `th_tqp5zrv7` — the thread whose
digest verbs answer `422` because it holds no resident:

```
$ curl -X PUT .../api/docs/th_tqp5zrv7 -H 'x-corpus-author: agent' \
    -d '{"extra":{"digest":{"body":"FORGED: nobody wrote this.",
         "watermark":"2026-09-05T21:42:45Z","stale":false}}}'
HTTP 200

$ curl .../api/threads/th_tqp5zrv7
… "resident":null,"digest":{"body":"FORGED: nobody wrote this.",
   "watermark":"2026-09-05T21:42:45Z","stale":false} …
```

This is SERVER-109's hazard reproduced: `resident` is on that list for exactly
this reason, and its docblock says so. **The fix is in `packages/contract`, not
here** — add `"digest"` to `RESERVED_FRONTMATTER_KEYS` with a comment beside
`resident`'s, and add it to `extra.test.ts`'s *"covers the §6 thread keys"* drift
pin, which is hand-written and is why CONTRACT-096 did not catch it. The server
needs no change once that lands: the reservation is the mechanism, and a second
copy of the rule here is a rule that drifts.
