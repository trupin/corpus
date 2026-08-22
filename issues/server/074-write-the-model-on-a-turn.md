# [SERVER-074] Write the deciding model onto the agent's turn

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-043
- Blocks: UI-090

## Spec References

- SPEC.md §10 Thread view — "An agent turn says which model wrote it" (rider signed 2026-08-07)
- SPEC.md §7 — the amended console line

## Summary

The persistence half of SHARED-027. CONTRACT-043 decides *where* the model is
recorded; this writes it, projects it, and keeps it honest.

## Acceptance Criteria

- [x] An agent turn written through the server carries the model that produced it
- [x] **The server records and never invents.** If the writer did not say which
      model it was, the turn says nothing — the server must not substitute a
      default, a "current model", or the weight it dispatched at. §10 requires an
      unknown to say so rather than show a plausible attribution nobody can check
- [x] A **person's** turn never carries one, on any path
- [~] Where a request ran in stages, what lands is the **deciding** stage's model
      (§7). Whatever AGENT-018 records for a staged job and this must agree —
      check that before choosing, not after — **checked, and there is nothing yet
      to agree with**: see "Where the model comes from at write time" below. The
      server chooses nothing; it records the one model the writer states and
      interprets nothing about it, which is compatible with any rule AGENT-018
      lands. The field holds **one** model, never a list, so a staged job cannot
      accumulate stages into it even by accident
- [x] It reaches the projection so the board can show it without reparsing files
- [x] Existing threads are untouched: no backfill, no guessing. A `SCHEMA_VERSION`
      bump follows the note convention in `projection/schema.ts`, which records
      why a bump changes verdicts for bytes already on disk
- [x] `corpus doc check` and `db doctor` stay clean on a thread mixing turns with
      and without the field

### Where the model comes from at write time

**Nothing in the system states one yet, and this issue deliberately did not
invent a source.** Checked before choosing, as the issue asks:

- The queue event carries no model and no weight — CONTRACT-039 and SERVER-069
  (weight into dispatch) are both still `todo`, and `apps/server` has no
  reference to a request weight at all.
- The job log carries the tier only as **free prose** inside a dispatch line
  (`assets/workspace/claude/skills/orchestrate/SKILL.md:634`), which §7 reaps
  with the event — precisely the thing this record exists to outlive.
- AGENT-018 (the staged-dispatch rule) is `todo`, so there is no staged-job
  record for this to agree with yet.
- The CLI sends nothing: `apps/cli/src/commands/thread/reply.ts:49` posts
  `{ body }` only.

So the only source is the request field CONTRACT-043 added, supplied by the
caller that ran the model — which is the contract's own design ("it travels with
the turn because the caller who ran the model is the only party that knows which
one it was"). The server side is complete and inert until a client fills it: an
`agent` turn with `model` records it, a turn without records nothing. Making the
CLI able to state it (a `--model` flag on `corpus thread reply` / `comment reply`)
and making the orchestrate skill pass the **deciding** stage's model are CLI and
AGENT work, not filed here.

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/` (the turn write path), `apps/server/src/core/turns.ts`
  if the chosen shape touches parsing, and `apps/server/src/projection/`.

### Notes

- **The queue event is where the model becomes knowable.** Check what the
  dispatch actually has in hand at write time; if nothing carries it, this issue
  is blocked on that rather than on invention, and saying so is the right answer.
- Do not reuse the weight field. A weight is what was asked for; a model is what
  ran. Conflating them makes §7's "honoured, not weighed again" unverifiable.

## Testing Strategy

Turns written with and without the model; a person's turn asserted to carry none;
a staged job recording the deciding stage; round-trip through parse and
projection; doctor clean on a mixed thread.

## E2E Verification Log

Ran on **Opus 5 (1M context)**. Real `corpus init` workspace at `/tmp/s074-ws`,
real server started with `corpus server start` on port **8791** (8765 and 5173
deliberately avoided), driven with `curl` and the real `corpus` CLI. Everything
below is observed output.

**1. An agent turn records the model, in the same bytes and the same commit.**

```
$ curl -X POST -H 'x-corpus-author: agent' …/api/threads/th_24ratbo3/turns \
    -d '{"body":"Checked; 6.4% is more representative.","model":"claude-opus-4-1"}'
{ "author": "agent", "ts": "2026-08-08T15:03:15Z",
  "body": "Checked; 6.4% is more representative.", "model": "claude-opus-4-1" }

$ cat data/threads/th_24ratbo3.md
---
… agent: engaged
turnModels:
  2026-08-08T15:03:15Z: claude-opus-4-1
---
## user · 2026-08-08T15:03:14Z
@agent is 6.1% still right?

## agent · 2026-08-08T15:03:15Z
Checked; 6.4% is more representative.
```

`git show HEAD` — one commit, `comment: turn on th_24ratbo3 by agent`, carrying
`+turnModels:` and the turn together. The turn's own text carries none of it.

Projection: `select idx, author, ts, model from turns` →
`0|user|…15:03:14Z|` and `1|agent|…15:03:15Z|claude-opus-4-1`.

**2. Records and never invents.** An agent turn posted without `model` answered
`"model": null` and the file grew **no `turnModels` key at all** — not an empty
map, not a default, not the tier it was dispatched at.

**3. A person's turn never carries one.**

```
$ curl -X POST …/api/threads/th_24ratbo3/turns -d '{"body":"…","model":"claude-opus-4-1"}'
400 {"code":"bad_request","message":"only an agent turn names the model that wrote it",
     "issues":[{"path":"model","message":"a turn authored by `user` names no model (SPEC.md §10)"}]}
```

`POST /api/threads` with `model` as `user` → `400` likewise. The file was
byte-identical afterwards (refused before anything is written). The multipart
door is refused too (covered in `threads/turn-model.test.ts`).

**4. Deleting a turn drops its entry — and the reuse it prevents, reproduced
live.** `DELETE …/turns/2026-08-08T15:03:15Z` left the thread with `turnModels`
**absent entirely** and the projected `model` gone with the row. Then, against a
real clock, appending → deleting → appending inside one second:

```
deleted stamp: 2026-08-08T15:04:25Z      (turn had model claude-haiku-4-5)
new turn:      2026-08-08T15:04:25Z None
turnModels:
  2026-08-08T15:03:34Z: claude-haiku-4-5
  2026-08-08T15:04:08Z: claude-opus-4-1
```

The new turn really did take the dead turn's timestamp back, and it carries no
model. Without the drop it would have been published as `claude-haiku-4-5` — an
attribution nobody made.

**5. Out-of-band spellings and stale entries.** Hand-edited the file to carry
`2099-01-01T00:00:00Z: a-model-nobody-ran` (names no turn) and
`2026-08-08T17:03:34+02:00: claude-haiku-4-5` (an offset spelling of a real
turn). The watcher re-projected; the reader reported the offset entry against
its turn and ignored the stale one, and the projection agreed. The next server
write rewrote the map to canonical keys with the stale entry dropped.

**6. Clean on a mixed thread.**

```
$ corpus doc check
checked 11 documents — no findings.            exit=0
$ corpus db doctor
projection is clean — 11 documents from 11 files (1ms)   exit=0
```

`meta.schema_version` = `13`. `POST /api/db/rebuild` re-derived every model from
the files unchanged (`[…None, 'claude-haiku-4-5', 'claude-opus-4-1', None]`).

Server stopped (`corpus server stop`, pid 68767); port 8791 free; no stray
vitest workers.

**Test run**: `VITEST_MAX_THREADS=4 npx vitest run apps/server` →
**3532 passed, 4 failed**. The four are pre-existing and unrelated:
`json-body.test.ts` sweeps every contract route that declares a JSON body and
`POST /api/threads/{id}/reattach` answers `404` because the contract route exists
(`packages/contract/src/routes/thread-reattach.ts`) with no server handler mounted
yet — `apps/server` contains no reference to `reattach`. Nothing in this issue
touches route mounting.

Non-vacuity checked by breaking the code on purpose: removing the cascade's
prune fails exactly the two deletion tests; the reuse test is additionally held
by the append path, which its own out-of-band test covers.

## Completion Checklist (domain agent)

- [x] Tests written and passing (59 new/extended: `core/turn-model.test.ts`,
      `threads/turn-model.test.ts`)
- [x] `/lint` passes (eslint + prettier + tsc on the touched files)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
