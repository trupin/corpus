# [SERVER-103] A rollback replaces a whole file and presents nothing

## Domain

server (blocked on a contract decision — see Dependencies)

## Status

closed — obsoleted: the route this issue reproduces against was deleted by the rider signed 2026-08-12.

**Closed 2026-08-26 (Phase 50): the verb this issue is about no longer exists.**

This issue reproduces unrecoverable data loss through
`POST /api/skills/{name}/rollback`. The rider signed 2026-08-12 deleted that
route — §7's loop safety became "a write whose content came from history", which
reconciles anchors, validates, commits under the acting party and is protected
by §7's key exactly as every other write is. `packages/contract/src/routes/skills.ts`
says so at its head, `inventory.ts` records the removal, and `skills.test.ts`
exercises the absence.

So the defect is gone with the code that held it, and the design question this
issue could not answer alone — where a key comes from when the canonical case is
a document that cannot be read — was answered by removing the caller rather than
by sourcing the key.

Closed rather than done: nothing landed for it. A `P0` row describing
unrecoverable data loss in a deleted route is the tracker telling a reader
something untrue, which is the only reason this was worth a commit at all.

## Priority

P0 — data loss, reachable by an operator following the documented recovery path.

## Model

fable — the implementation is small; deciding **where a rollback's key comes
from** is not, and the obvious answer is refuted below by measurement.

## Dependencies

- Depends on: an unfiled CONTRACT issue (`POST /api/skills/{name}/rollback` has
  no field to carry a key and no `409` to refuse with). **Not invented here by
  instruction** — the user asked to be told rather than handed a shape.
- Then: `apps/cli` (`corpus skill rollback` does not read the document today, so
  it has nothing to present).
- Related: SERVER-098 (`assertDocumentKey`), SERVER-099 (the lock removal that
  left this hole), CONTRACT-049 (which settled "no key here", wrongly).

## Spec References

- SPEC.md §7 — "A key, not a lock", all seven paragraphs. In particular **"What
  needs a key"**: _"A write that replaces a block without naming what it changes:
  the body, or a whole-frontmatter rewrite."_ And **"What a key does not do"**:
  _"What is guaranteed is that no change is lost without someone being told."_
- SPEC.md §7 — "Loop safety (validate + rollback)", the verb this is about.
- SHARED-041 — the rider, decision 4 ("blind overwrites need a key").

## Summary

`POST /api/skills/{name}/rollback` overwrites `.claude/skills/<name>/SKILL.md`
in full — frontmatter and body — and presents nothing. Until SERVER-099 it at
least took the edit lock (`assertWritable`, added by PR #11's review with the
comment _"rolling back under the other party's lease would discard whatever that
party is mid-way through writing"_); the lock removal deleted the call and put
nothing in its place, so the verb now has **no staleness check of any kind**.

CONTRACT-049 settled this deliberately: _"a rollback restores a named revision
rather than composing a block against a version it read, so there is nothing a
key could be evidence of."_ That inverts §7's test. §7 classifies on what a write
**replaces**, not on what composed it. A rollback replaces the whole file and
names only a revision; a key is perfectly good evidence here — _"I inspected the
current version and chose to roll back from it."_

Reproduced below: an uncommitted edit is destroyed, silently, with exit 0 — and
because the restored bytes equal `HEAD`, **no commit is made either**, so the
destroyed content exists in no git object and is unrecoverable by any means.

## The design question this issue cannot answer alone

A key is derived from the document's stored bytes and handed out by a document
**read**. A rollback's caller has a skill **name**, not a document id, and — this
is the part that refutes the obvious design — **the canonical loop-safety case is
a document that cannot be read.** Measured on a real server (log below):
`GET /api/docs/{id}` for a skill whose frontmatter no longer parses answers
**500**, not a `Doc` and not a key. A key sourced from an ordinary document read
would therefore make §7's escape hatch unusable in exactly the situation §7 wrote
it for: _"a bad edit to a core-loop skill can break the very loop that would
otherwise fix it."_

So the contract decision is not "add `key` to the request body" — it is **where a
caller gets a key for a file that may not be a document right now**. Three shapes
were considered and none is adopted here:

1. **The refusal hands it over.** A rollback with no key (or a stale one) is
   refused, and the refusal carries the file's current bytes and its key. One
   extra exchange, no separate read verb, and it works for a file that does not
   parse — but `StaleKeyError`'s payload is a `Doc` today, which an unparseable
   file has no shape for, so the refusal payload is the thing to design.
2. **A read verb that answers for the file rather than the document** — the key
   plus the current bytes for `.claude/skills/{name}/SKILL.md`, parse or no
   parse. Clean, but it is a new route.
3. **`--key` from an ordinary `corpus doc show`**, with the broken-skill case
   accepted as unprotected. Cheapest, and it leaves the hole open precisely where
   the verb is most likely to be used.

Whichever is chosen, two properties are not negotiable, both from §7: the key is
**opaque and echoed, never computed by the client** (a client that hashes the
file it is about to overwrite has manufactured its own evidence), and a refusal
is **never a lost edit** — nothing is written, and the operator can re-decide.

## Acceptance Criteria

- [ ] A rollback presenting a key that names a version the file no longer is is
      refused with `409`, and **writes nothing** — the file on disk is byte-identical
      afterwards, and no commit is made.
- [ ] The refusal carries what the caller needs to re-decide: the current content
      and a fresh key, like every other §7 refusal.
- [ ] A rollback presenting the current key lands, exactly as today.
- [ ] The check happens **inside the document lane**, against the same bytes
      `readFileSync(absPath)` reads for the candidate search — a comparison made
      outside the lane refuses nothing (SERVER-098's own note).
- [ ] The loop-safety case still works: a skill whose frontmatter does not parse
      can still be rolled back by an operator who has seen its current state.
- [ ] `corpus skill rollback` obtains and presents a key without the operator
      hand-copying one, and reports a refusal as a refusal (not as a failure).

## Technical Design

### Files to Create/Modify

- `packages/contract/src/routes/skills.ts` + `schemas/skill.ts` — the request
  field and the `409`; the module docblock currently argues the opposite and has
  to be rewritten, not amended.
- `apps/server/src/skills/rollback.ts` — the check, inside `mutex.run`, after
  `const current = readFileSync(absPath, "utf8")` and before the candidate
  search commits to anything.
- `apps/cli/src/commands/skill/rollback.ts` — where the key comes from.

### Key Implementation Details

The server half is three lines once the contract exists: `current` is already
read inside the lane at `rollback.ts:253` and is exactly the byte string
`documentKey()` takes. What must **not** happen is a second derivation — the key
is `docs/key.ts`'s and nowhere else's.

### Edge Cases

- **A rollback that restores bytes identical to the file** already produces no
  commit (`explainMissingCommit`). It must still be key-checked: the check is
  about what the write was aimed at, not about what it changed.
- **A skill with no projection row** (unparseable) has a synthetic id and no
  `Doc`; see the design question above.
- **`--to <rev>`** is the same write and needs the same key.

## Testing Strategy

Unit: a stale key refuses with `409` and the file is unchanged; a current key
lands; the refusal's payload carries a fresh key; the check sits inside the lane
(hold the lane, queue a save, assert the rollback sees the saved bytes).

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. `corpus init`, `corpus server start`, `corpus skill create demo`.
2. Append a section to `.claude/skills/demo/SKILL.md` with an outside editor
   (out-of-band edits are never committed — SERVER-090).
3. `corpus skill rollback demo`.
4. Expected: a refusal, and the file untouched.
5. Actual: the file is overwritten and the appended section is gone.

### Verification Steps

1. Repeat 1–2, then roll back with a **stale** key: `409`, file unchanged.
2. Read the current key, roll back with it: the restoration lands.

## E2E Verification Log

Implemented on: **opus** (reproduction only — the fix is blocked on the contract
decision above, by the user's instruction not to invent one).

### Reproduction (bugs only)

Real server, real workspace, real CLI. Scratch workspace
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/ws1`, port 8791 (never 8765 —
that is the user's live server).

```
$ corpus init .
Initialized Corpus workspace at .../tmp/ws1
$ corpus server start
corpus 0.5.0 listening on http://127.0.0.1:8791 (pid 33773)

$ corpus skill create demo --description "A demo skill for the rollback reproduction" --from user
created doc_xcjubfo6 — .claude/skills/demo/SKILL.md
$ git log --oneline -2
cf23215 skill create: demo (doc_xcjubfo6) by user
0806e42 workspace: initialize corpus workspace by user
```

An outside editor appends a section — the "uncommitted good edit". The watcher
projects it and, correctly, does not commit it:

```
$ printf '\n## Hard-won instructions\n\nNever delete the invoice folder. This took an hour to write.\n' \
    >> .claude/skills/demo/SKILL.md
$ git status --porcelain
 M .claude/skills/demo/SKILL.md
$ shasum -a 256 .claude/skills/demo/SKILL.md
4b745ac04e6b1d87f3afd61eefd97ba72838ea087101e4174d35fd1a77b0f129
```

The rollback, with no key presented because there is nowhere to put one:

```
$ corpus skill rollback demo --from agent
restored .claude/skills/demo/SKILL.md — uncommitted, the file write stands (doc_xcjubfo6)
warning commit_skipped: the restored content is already what git records for this path,
  so there was nothing to commit; the file on disk holds it either way
$ echo $?
0
$ tail -3 .claude/skills/demo/SKILL.md
anchors: {}
---
$ git status --porcelain
(clean)
```

**FAIL — confirmed, and worse than reported.** The section is gone; exit 0; no
`409`; nothing told anyone. And note `commit_skipped` with a clean `git status`:
the restored bytes equalled `HEAD`, so **no commit was made**, and the destroyed
text was never committed either (SERVER-090). It is in no git object, no reflog,
no stash. §7's _"no change is lost without someone being told"_ is violated in
its strongest form — the change is lost, nobody is told, and nothing can recover
it.

Second measurement, the one that constrains the design. The same skill, broken
out of band so its frontmatter no longer parses — §7's canonical loop-safety
case, the state `corpus skill rollback` exists for:

```
$ printf -- '---\nname: demo\n  description: [broken: yaml\nid doc_xcjubfo6\n---\nbroken\n' \
    > .claude/skills/demo/SKILL.md
$ GET /api/docs/doc_xcjubfo6
500 {"code":"internal_error","message":"document doc_xcjubfo6 could not be parsed:
  .claude/skills/demo/SKILL.md:2: invalid YAML frontmatter: ..."}
$ GET /api/docs?type=skill
200 — the row is still listed (the projection kept the last good row)
```

So the document read that hands out keys **cannot serve this file**, while the
rollback verb can and must still act on it. A design that sources the key from
`GET /api/docs/{id}` would lock the escape hatch from the outside.

_(Incidental, not this issue: an unparseable document answers `GET /api/docs/{id}`
with a **500 `internal_error`** rather than a 4xx naming the file and the parse
error. Worth its own ticket.)_

### Post-Implementation Verification

_Not yet — blocked._

## Completion Checklist (domain agent)

- [x] Reproduced E2E against the real running application, before any code
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Contract decision taken (the three shapes above), CONTRACT issue filed
- [ ] `/audit` run
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-103]` prefix
