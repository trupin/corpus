# [SERVER-078] A nested skill's id changes when the skill above it is archived

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: SERVER-077 (found it), §7 skills, §5 document identity

## Spec References

- SPEC.md **§5** — a document's id is its identity; `[[refs]]`, anchors and a
  thread's `parent` are all by id
- SPEC.md **§7** — what disables a skill is where its folder lives, so archiving
  a skill moves its whole folder

## Summary

Found by the pr-reviewer's nested-skill case on PR #37 and confirmed by
server-dev while fixing it. **This is pre-existing single-document-route
behaviour, not something the bulk route introduced** — the bulk path only made
it visible.

Archiving a skill folder that nests another skill moves every file under it,
including the nested `SKILL.md`. A skill document with no explicit `id` in its
frontmatter gets a **synthesized** id that hashes its path, and only the
**requested** skill gets its id stamped into the file it is written back to. So
the nested skill's id changes across the move:

```
doc_skill78aafb0e  →  doc_skill6060ce0d
```

## Why this matters

An id is identity (§5). Everything that points at a document points by id:
`[[refs]]`, the `links` graph, a thread's `parent`, an anchor entry in a parent's
frontmatter. A document whose id changes silently is a document every one of
those references now misses — and nothing reports it, because from the
projection's side an old id vanished and a new one appeared, which is
indistinguishable from a delete plus a create.

Unarchiving does not undo it either: the id is synthesized from the path again,
so the round trip yields a third value unless the path is byte-identical.

## Two consequences the id change is not the whole of

Both found by the pr-reviewer on PR #37 and driven against the real route. They
matter because whoever takes this issue will otherwise fix the id and think the
symptom list is empty.

**1. A refused document whose files are in the commit, told it does not exist.**
Archiving both skills in one act — `ids: [outer, nested]` — archives the outer
one, which moves the nested one's file, which changes the nested one's id, so
the lookup by the id the caller sent fails:

```
changed  ["doc_skillfb157be1"]
refused  [{id: "doc_skill78aafb0e", reason: "not-found",
           message: "no document with id doc_skill78aafb0e"}]
commit   … .claude/skills/demo/nested/SKILL.md
         … .claude/skills-archived/demo/nested/SKILL.md
```

The document was moved — and thereby disabled (§7) — while being told it does
not exist. That inverts §4's own sentence: `git log` records an effect the user
was told did not happen. The message is not merely unhelpful, it is false.

**2. An order-dependent wedge that needs manual filesystem recovery.** The same
call with the ids the other way round archives the **nested** skill alone, which
creates `.claude/skills-archived/demo/`, which then permanently blocks the outer
skill's archive:

```
changed  ["doc_skill78aafb0e"]
refused  [{id: "doc_skillfb157be1", reason: "write-failed",
           message: "the archive destination already exists: .claude/skills-archived/demo …"}]
```

One gesture on a skills column with select-all, and which of these two outcomes
you get depends on the order the board happened to send the ids in. Recovering
means moving a directory by hand. Behaviourally this equals two sequential
single-document calls, which is why it is filed here rather than against the
bulk route — but it is the sharpest reason this issue is P1.

## Acceptance Criteria

- [x] A nested skill's id survives its parent skill being archived, and survives
      the unarchive round trip
- [x] Whatever fix is chosen applies to the **single-document** archive route
      first — that is where the behaviour lives. The bulk route inherits it
- [x] A `[[ref]]` to a nested skill, and a thread parented on one, still resolve
      after the parent skill is archived and unarchived
- [x] Reproduce before fixing, and log the pre-fix id change in the E2E log
- [x] Check whether anything **else** synthesizes an id from a path and moves the
      file without stamping it — the defect is the pattern, not this one caller

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/archive.ts` (`planSetArchived` / the skill folder move)
  and wherever ids are synthesized and stamped.

### Notes

- The obvious fix — stamp every document under a moved folder, not only the
  requested one — is probably right, but check it against what stamping means:
  writing an id into a file the act did not otherwise change puts that file in
  the commit, which interacts with the containment invariant SERVER-077 states
  and with the "one action, one commit" report. Decide deliberately whether such
  a document belongs in `changed`.
- Consider whether a synthesized id should hash something more stable than the
  path in the first place. That is a bigger change and may be the wrong one —
  raise it rather than doing it silently.

## Testing Strategy

Archive a skill nesting another; assert the nested skill's id is unchanged in the
projection and on disk, and that a `[[ref]]` to it still resolves. Then unarchive
and assert the same. Plus the pattern sweep from the last acceptance criterion.

## Decisions

**1. Stamping is right, and the partition rule needs no amendment.** Every
document under a moved folder is stamped with the id it already has, not only
the requested one. The reporting question PR #37 raised answers itself once the
commit is looked at rather than the code: the carried file **was already in the
commit** — the folder move stages it, and `bulk.test.ts` already asserted both of
its paths are in `git show --name-only`. Stamping adds bytes to a file the act
had already moved; it adds no path to the commit. So the exception the bulk route
documents — "§7's skill folder move … carries every file under it … without the
act ever naming it" — covers the stamped file exactly as it covered the moved
one, and the shipped test that pins the partition (`carries a nested skill the
act never named, and names it in none of the three parts`) passes **unchanged**.
Nothing is held for sign-off; no contract prose or SPEC.md text needs to change.

Two things a stamp deliberately does *not* write into a carried document:
`updated` (nothing about its content changed, and §5's staleness clock must not
be reset by a neighbour's archiving) and `status` (for a skill the *root* says
what the status is, so a written one would lie after the reverse move). A carried
write is also not put through §14 validation — the content is the author's, and a
finding would be about a document the act never asked to edit.

**2. A more stable synthesized id was considered and rejected — raising it rather
than doing it silently, as the issue asks.** Hashing the path *below* the root
instead of the workspace-relative path would make `skills/demo/nested/SKILL.md`
and `skills-archived/demo/nested/SKILL.md` the same id and need no write at all.
Rejected for two reasons: (a) it changes the id of **every** synthesized document
in every existing workspace, breaking exactly the `[[refs]]`, `parent` fields and
anchor entries this issue is about — a data migration, not a fix; (b) it makes
the two roots collide, so a hand-made `.claude/skills-archived/demo/SKILL.md`
beside a live `.claude/skills/demo/SKILL.md` becomes a `duplicate_id` where today
they are two documents. Stamping preserves identity *forward* without touching
anything already written.

**3. The wedge got its own answer: a "recoverable destination".** A destination
folder that merely *exists* is no longer the refusal. The refusal was justified
as "merging two skill folders would silently overwrite files" — but the
overwriting is the danger, and a name is not an overwrite. `assertMergeable` now
asks whether any **file** under the source has a counterpart at the destination
(two directories of the same name merge; anything else refuses, naming the exact
colliding path). An unrelated archived skill of the same name still refuses,
because its own `SKILL.md` is precisely such a file. This makes both orders of a
select-all archive converge on the same tree, and it heals a workspace already
wedged by the old rule with no filesystem surgery.

**4. Pattern sweep (last criterion).** Two operations move a document's file:
`renameFile` (`docs/move.ts`) and `renameDir` (`docs/archive.ts`).
`docs/move.ts` cannot reach a synthesized-id document at all — `assertMovable`
goes through `parseDocumentPath`, which recognises only `data/docs/` and
`data/threads/`, and both roots have `synthesizeId: false`. That is now pinned by
a test derived from `DOCUMENT_ROOTS` itself, so a root added later with
`synthesizeId: true` fails there instead of re-minting ids in production.
`skills/create.ts` already mints a real `doc_*` id and says why in a comment that
anticipates this issue. `projection/rebuild.ts` and
`watcher/reconcile-out-of-band.ts` are the only other `renameSync` callers and
neither moves a document to a new path. Out of scope but worth recording: an
out-of-band `mv` of a skill folder by the user still re-mints ids — that is the
user editing the source of truth directly, not a mutation the server performed.

## E2E Verification Log

**Model: Opus 5 (1M context)** (`claude-opus-5[1m]`). Real `corpus` server (built
from source, `apps/cli/dist/bin/corpus.js`) on scratch port **8791** against a
real `corpus init` workspace at `/tmp/s078`; the user's server on 8765 untouched.
Setup: `.claude/skills/demo/SKILL.md` with `.claude/skills/demo/nested/SKILL.md`
inside it, plus a `[[ref]]` from a note and an anchored thread on the nested
skill.

### Pre-fix reproduction

Baseline — the nested skill is `doc_skill78aafb0e`, and three references point at
it:

```
demo rows: [('doc_skillfb157be1', '.claude/skills/demo/SKILL.md', 'open'),
            ('doc_skill78aafb0e', '.claude/skills/demo/nested/SKILL.md', 'open')]
links:     [('doc_cu74346n', 'doc_skill78aafb0e')]
anchors:   [('doc_skill78aafb0e', 'anc_0336b140', 'Nested skill body.', …, 11)]
threads:   [('th_skles3r4', 'doc_skill78aafb0e')]
```

**Symptom 1 — the id change, on the single-document route.**
`corpus doc archive doc_skillfb157be1`:

```
demo rows: [('doc_skill6060ce0d', '.claude/skills-archived/demo/nested/SKILL.md', 'archived'),
            ('doc_skillfb157be1', '.claude/skills-archived/demo/SKILL.md', 'archived')]
links:     [('doc_cu74346n', 'doc_skill78aafb0e')]      ← dangling
anchors:   [('doc_skill6060ce0d', 'anc_0336b140', 11)]  ← moved to the new id
threads:   [('th_skles3r4', 'doc_skill78aafb0e')]       ← dangling
```

`doc_skill78aafb0e → doc_skill6060ce0d`, exactly as filed. Over HTTP:

```
GET /api/docs/doc_skill78aafb0e                        -> 404
GET /api/docs?type=thread&parent=doc_skill6060ce0d     -> {"items":[],"total":0}
GET /api/docs?type=thread&parent=doc_skill78aafb0e     -> [('th_skles3r4', 'doc_skill78aafb0e', None, None)]
```

The thread survives with `parentTitle: null` and `anchorQuote: null` — parented
on a document that no longer exists.

**Symptom 2 — the false `not-found`.** `POST /api/docs/bulk`,
`ids: [outer, nested]`:

```
{"changed": ["doc_skillfb157be1"],
 "refused": [{"id": "doc_skill78aafb0e", "reason": "not-found",
              "message": "no document with id doc_skill78aafb0e", "lock": null}],
 "commit": "eae52b8234857fc2556be5c69a07963e4d393f12"}

$ git log -1 --name-only
bulk archive: 1 document by user
.claude/skills-archived/demo/SKILL.md
.claude/skills-archived/demo/nested/SKILL.md
```

The refused document's file is in the commit the caller was told did not touch it.

**Symptom 3 — the order-dependent wedge.** Same call, `ids: [nested, outer]`:

```
{"changed": ["doc_skill78aafb0e"],
 "refused": [{"id": "doc_skillfb157be1", "reason": "write-failed",
              "message": "the archive destination already exists: .claude/skills-archived/demo already exists; move or remove it first"}]}
```

and it is permanent — `corpus doc archive doc_skillfb157be1` afterwards:

```
{"error":{"code":"bad_request","message":"400 bad_request: the archive destination already exists",
  "details":[{"path":"id","message":".claude/skills-archived/demo already exists; move or remove it first"}]}}
```

Unarchiving the nested skill to recover does **not** clear it: the now-empty
`.claude/skills-archived/demo/` is left behind and the outer skill's archive is
refused with the identical message. Only `rmdir` by hand recovered it.

### Post-fix

Same workspace, same server rebuilt. The archive that was wedged now succeeds —
it merges past the leftover empty directory — and identity holds:

```
=== POST-FIX: single-document archive of the OUTER skill ===
  docs    [('doc_skillfb157be1', '.claude/skills-archived/demo/SKILL.md', 'archived'),
           ('doc_skill78aafb0e', '.claude/skills-archived/demo/nested/SKILL.md', 'archived')]
  links   [('doc_cu74346n', 'doc_skill78aafb0e')]
  anchors [('doc_skill78aafb0e', 'anc_0336b140', 11)]
  threads [('th_skles3r4', 'doc_skill78aafb0e')]

  while ARCHIVED, thread rows: [('th_skles3r4', 'doc_skill78aafb0e', 'nested', 'Nested skill body.')]
  GET /api/docs/doc_skill78aafb0e -> 200  (.claude/skills-archived/demo/nested/SKILL.md)

=== POST-FIX: unarchive round trip ===
  docs    [('doc_skillfb157be1', '.claude/skills/demo/SKILL.md', 'open'),
           ('doc_skill78aafb0e', '.claude/skills/demo/nested/SKILL.md', 'open')]
  thread rows [('th_skles3r4', 'doc_skill78aafb0e', 'nested', 'Nested skill body.')]
```

`parentTitle` and `anchorQuote` resolve in both states; the `links` row, the
`anchors` row and the thread's `parent` all still name `doc_skill78aafb0e`.

A carried document gets exactly one key written — a fresh pair, outer archived
alone, `.claude/skills-archived/demo3/leaf/SKILL.md`:

```
---
name: leaf
description: Third nested.
id: doc_skill912ec7f9
---

# Leaf
```

No `updated`, no `status`, body untouched — and it rides in the same commit as
the move:

```
doc archive: demo3 (doc_skillf1cd168c) by user
 .claude/skills-archived/demo3/SKILL.md      | 9 +++++++++
 .claude/skills-archived/demo3/leaf/SKILL.md | 7 +++++++
```

**Both bulk orders now converge, with no refusals** (fresh `demo2/inner` pair):

```
=== bulk archive, outer-first -> 200
  changed         ['doc_skillddadbacc', 'doc_skill29c5554f']
  refused         []
  rows            [(…'.claude/skills-archived/demo2/SKILL.md'), (…'.claude/skills-archived/demo2/inner/SKILL.md')]
=== bulk archive, nested-first -> 200
  changed         ['doc_skill29c5554f', 'doc_skillddadbacc']
  refused         []
  rows            [(…'.claude/skills-archived/demo2/SKILL.md'), (…'.claude/skills-archived/demo2/inner/SKILL.md')]
```

Same tree, same two ids, one commit each, whichever order the board sends.

**The real refusal survives.** An unrelated archived skill of the same name,
whose own `SKILL.md` would be overwritten:

```
POST /api/docs/doc_skillddadbacc/archive -> 400
  {"message": "the destination already holds a file this move would overwrite",
   "issues": [{"path":"id","message":".claude/skills-archived/demo2/SKILL.md already exists; move or remove it first"}]}
bulk -> refused [{"reason":"write-failed","message":"the destination already holds a file this move would overwrite: .claude/skills-archived/demo2/SKILL.md already exists; move or remove it first"}]
```

Neither side changed on disk; `HEAD` did not move.

Workspace healthy afterwards:

```
$ corpus db doctor --json
{"ok":true,"drift":[],"warnings":[],"stats":{"files":17,"documents":17,…}}
$ corpus doc check --json
{"ok":true,"errors":[],"warnings":[]}
```

Server stopped, port 8791 free, 8765 untouched.

### Checks

- `npx tsc --noEmit -p apps/server/tsconfig.json` — clean
- `npx eslint` / `npx prettier --check` on every touched file — clean
- `vitest run apps/server` — **176 files, 3646 tests, all passing**

Note for the orchestrator: mid-session, `apps/server/src/docs/query.test.ts` and
`performance.test.ts` were failing on `unansweredForms` — a concurrent agent's
in-flight work on this same branch, unrelated to this issue. Both were green by
the final full run.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
