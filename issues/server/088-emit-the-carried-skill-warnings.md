# [SERVER-088] Emit the carried-skill warnings the contract now publishes

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-047
- Blocks: —
- Related: SERVER-078 (created the behaviour being reported)

## Spec References

- SPEC.md **§7** — location is a skill's enablement, so archiving moves the
  whole folder
- SPEC.md **§4** — the report and the commit are one story

## Summary

CONTRACT-047 published two `WarningCode`s and nothing emits them. Until this
lands, archiving a skill still enables or disables a nested skill and rewrites
its frontmatter while telling the caller nothing — the contract just now
describes a report that does not exist.

## Acceptance Criteria

- [x] `carried_skill` — one per carried document, **both directions**, whenever a
      skill folder move carried an indexed `SKILL.md` other than the requested
      one. Computed from `planSetArchived`'s `movedDocuments` minus
      `loaded.path`, resolved through `findDocumentRowByPath` — **from the plan,
      inside the lanes**, so it reports what actually moved rather than what was
      predicted
- [x] It therefore covers a document moved **but not stamped** (one that appeared
      after the lanes were chosen): the file moved, so its enablement changed
      whether or not its bytes were rewritten
- [x] A moved file with no projection row is **not** named — there is no document
      to name, which is `planCarriedWrites`'s existing stance
- [x] `carried_reconciliation` — exactly where `ownedFields` puts
      `status: "open"` into the patch **and** `setFrontmatterFields` returned a
      changed document. A file already saying `open` writes nothing and warns
      nothing. **Unarchive only**, because an archive's destination is
      `SKILLS_ARCHIVED_ROOT` and the gate is on `SKILLS_ROOT`
- [x] The id stamp is **not** reported. CONTRACT-047 decided that deliberately —
      it preserves an identity rather than changing one, and it fires on nearly
      every carry, which is how the reconciliation beside it would come to be
      ignored. A test pins the asymmetry, so restoring it fails a test
- [x] Both reach the response through `runMutation`'s existing `warnings`, and
      **do not depend on `plan.text`**
- [x] A carried document never enters `changed` — the three parts partition the
      **requested** ids (pinned by PR #37 in prose and two tests)
- [x] The bulk act reports them too: it goes through the same planners
- [x] Silence means the act carried **no other skill document at all** — not "no
      reconciliation was needed". CONTRACT-047 amended its own Testing Strategy
      on this point; read that amendment

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/archive.ts` (`planSetArchived`, `ownedFields`,
  `setArchived`), and `apps/server/src/docs/bulk.ts` where warnings are gathered.

### Notes

- Read CONTRACT-047's "What the contract now publishes" section: it names the
  exact computation site for each code and the canonical `detail` prose. The
  `detail` is prose the contract forbids parsing, so nothing depends on the exact
  bytes — but populate it as written, because a console cannot otherwise tell a
  routine §7 carry from the server rewriting a file the caller never named.
- `setArchived` currently passes a fixed warnings list; check what it does with
  `validateBeforeWrite`'s before concatenating.

## Testing Strategy

Archive a nested skill alone, then archive and unarchive the outer one: the
unarchive carries both codes, the archive carries `carried_skill` alone. A skill
folder carrying no other skill document carries neither. A carried file already
saying `open` carries `carried_skill` but not `carried_reconciliation`. The same
three through the bulk act. Plus the asymmetry pin: the id stamp emits nothing.

## E2E Verification Log

**Model: Opus 5 (1M context)** — `claude-opus-5[1m]`, as recommended. Date:
2026-08-09. Branch `phase-28-serializer-sweep-stub-typing`, main working tree, no
git commands run.

Not a bug, so no pre-fix reproduction: the report simply did not exist —
`setArchived` passed `validateBeforeWrite`'s warnings and nothing else, and
`planCarriedWrites` returned only operations.

**1. Build.** `npm run build` → exit 0 (CONTRACT-047's regenerated client
consumed through `dist/`).

**2. Real server, real workspace, real HTTP.** `corpus init /tmp/s088-e2e` (port
moved to a scratch **8791**; never 8765 or 5173), seeded
`.claude/skills/demo/{SKILL.md,reference.md,nested/SKILL.md}`, started with
`corpus server start`, torn down at the end (`stopped (pid 9806)`, `lsof` on 8791
→ free). Every object below is quoted verbatim from a `curl` response body.

_Archive the outer skill — `carried_skill`, disabled direction, destination path:_

```
POST /api/docs/doc_skillfb157be1/archive → 200
[
  {
    "code": "carried_skill",
    "detail": "doc_skill78aafb0e (.claude/skills-archived/demo/nested/SKILL.md) was carried by this skill folder move and is now disabled; the request never named it (SPEC.md §7)"
  }
]
doc.status= archived doc.path= .claude/skills-archived/demo/SKILL.md
```

That same act **stamped the nested skill's id** into its file (`id:
doc_skill78aafb0e` appears in the frontmatter afterwards) and reported nothing
about it — the asymmetry CONTRACT-047 decided, observed on a live server rather
than only in a unit test.

_Unarchive it — same document, other direction:_

```
[{"code":"carried_skill","detail":"doc_skill78aafb0e (.claude/skills/demo/nested/SKILL.md) was carried by this skill folder move and is now enabled; the request never named it (SPEC.md §7)"}]
```

_The reconciliation sequence._ Archive the nested skill alone (`warnings: []` —
it carries nothing), then the outer one (`warnings: []` — the folder now holds no
other `SKILL.md`), leaving on disk:

```
$ sed -n 1,8p .claude/skills-archived/demo/nested/SKILL.md
---
name: nested
description: A skill inside another skill's folder.
id: doc_skill78aafb0e
status: archived
updated: 2026-08-10T02:20:58Z
---
```

Then unarchive the outer one:

```
POST /api/docs/doc_skillfb157be1/unarchive → 200
[
  {
    "code": "carried_skill",
    "detail": "doc_skill78aafb0e (.claude/skills/demo/nested/SKILL.md) was carried by this skill folder move and is now enabled; the request never named it (SPEC.md §7)"
  },
  {
    "code": "carried_reconciliation",
    "detail": "doc_skill78aafb0e (.claude/skills/demo/nested/SKILL.md) still said `status: archived` under the enabled skills root, so its status was reconciled to `open`"
  }
]
```

and the commit it is one story with (§4) — the file the caller never named is in
it, and now so is the report:

```
$ git log --format='%h %an %s' -1
79e4ce7 user doc unarchive: demo (doc_skillfb157be1) by user
$ git show --stat --format= HEAD
 .claude/skills/demo/SKILL.md                             | 2 +-
 .claude/{skills-archived => skills}/demo/nested/SKILL.md | 2 +-
$ sed -n 4,5p .claude/skills/demo/nested/SKILL.md
id: doc_skill78aafb0e
status: open
```

_The bulk act, through the same planners:_

```
POST /api/docs/bulk  [{outer, archive}] → 200
changed:  [{"id":"doc_skillfb157be1","action":"archive"}]
warnings: [{"code":"carried_skill","detail":"doc_skill78aafb0e (.claude/skills-archived/demo/nested/SKILL.md) was carried by this skill folder move and is now disabled; the request never named it (SPEC.md §7)"}]
```

The carried document is in **no** part of the result — the three parts still
partition the requested ids.

_Silence, in three shapes:_ an ordinary note's archive → `warnings: []`; a
solitary skill's archive (`todos`, a folder with no nested `SKILL.md`) →
`warnings: []`; and the two no-op steps of the reconciliation sequence above.
Silence means "carried no other skill document at all", per CONTRACT-047's
amended Testing Strategy.

**3. One deviation from the issue text, and why.** The issue says the warnings
are computed from `movedDocuments` minus `loaded.path`. That is exactly what a
single-document route wants, but the contract also says, in
`WarningCodeSchema`'s published description, that neither code "ever describes
the document the caller named — that document is the response's own subject, or a
`changed` entry in a bulk result". In a bulk act naming **both** an outer skill
and the nested one it carries, the plan-level rule would have warned that the
request "never named" a document sitting in `changed`. So the plan now carries
**facts** (`ArchivePlan.carried: CarriedDocument[]` — id, destination path,
`enabled`, `reconciled`) and `carriedWarnings(carried, named)` turns them into
prose, excluding the ids the caller named: `new Set([id])` for the route, the
whole staged set for the bulk act (`requested`, deliberately **not** `held`,
which also contains the lanes taken *because* of the carry and would suppress
exactly what this reports). Verified live:

```
POST /api/docs/bulk  [{outer, unarchive}, {nested, unarchive}] → 200
changed: [{"id":"doc_skillfb157be1","action":"unarchive"}]   alreadyInState: [nested]
warnings: []

POST /api/docs/bulk  [{outer, archive}, {nested, archive}] → 200
changed: [{"id":"doc_skillfb157be1",...},{"id":"doc_skill78aafb0e",...}]
warnings: []
```

**4. Placement inside the bulk loop.** The carried warnings are pushed **after**
`applyOperations` succeeds, beside `changed.push`, not beside the validate
warnings: a row whose operations threw rolled itself back, so the folder never
moved and no skill's enablement changed. Reporting there would be §4's rule run
backwards.

**5. Tests.** `vitest run apps/server` → **178 files, 3695 tests, all passing**
(`VITEST_MAX_THREADS=4`); `vitest run apps/server/src/docs` after the last edit →
24 files, 480 tests, green. New tests: eight in `archive.test.ts` ("the response
says which documents the move carried") and three in `bulk.test.ts`. They cover
both directions, the reconciliation sequence, a carried file already saying
`open` (`carried_skill` alone, file byte-unchanged), a moved file with no
projection row (nothing named), a carried document **moved but not stamped**
(asserted at the plan level by holding only the requested lane — its
`CarriedDocument` is present with `reconciled: false` and no `write` operation
names its destination), a move where `plan.text === null` because the requested
skill's own bytes do not change (the criterion "do not depend on `plan.text`",
pinned rather than argued), the bulk exclusion, and the asymmetry pin
`emits nothing for the id stamp, which fires on nearly every carry`, which
asserts the stamp really happened and that the warning list is exactly
`["carried_skill"]`.

> One transient failure worth recording, not caused by this change: running
> `archive.test.ts` and `bulk.test.ts` in one invocation under concurrent
> machine load timed out `archives twenty documents as one commit whose files
> are exactly changed` at its 5 s budget (followed by an `ENOTEMPTY` in the
> fixture's own teardown). Both files pass individually and in the full
> workspace run above.

**6. Lint, format, typecheck.** `eslint` over the five touched files → exit 0
(two findings fixed properly rather than suppressed: a `let reconciled = false`
whose initializer was dead, and an `async` test with no `await`). `prettier
--check apps/server/src/docs/*.ts` → clean. `npm run typecheck -w apps/server` →
exit 0.

**7. Not done, deliberately.** Nothing in `packages/contract` was touched —
CONTRACT-047's published prose is treated as the specification, including the
"never names the document the caller named" sentence that produced the deviation
in item 3. Nothing in `apps/ui` or `apps/cli` (two ui-dev agents are working
there concurrently); CONTRACT-047 already flagged that several UI call sites
render warnings with `tone: "error"`, which a carried effect is not — that is a
UI issue for the orchestrator to file, and it is now reachable in the product
rather than hypothetical.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
