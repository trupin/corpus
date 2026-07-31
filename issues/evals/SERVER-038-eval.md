# Evaluation: SERVER-038

**Date**: 2026-07-31
**Sprint**: sprint-018 (TEST-603–614)
**Evaluator model**: Opus 5 (`claude-opus-5[1m]`)
**Verdict**: PASS

## Rig

Workspace `…/tmp/eval-p6/ws`, server `127.0.0.1:8802` (pid 99059). Invisible
documents seeded the way the issue specifies — **raw file write plus a git commit in
the workspace**, not through the API (SERVER-037 refuses that route now) — then
`corpus db rebuild`. Negative-evidence claims measured with `/usr/bin/grep` over the
full `--json` report.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                     |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | TEST-603 → TEST-614, plus a Technical Design section recording the decisions.                               |
| Commands are specific and concrete      | PASS   | Commit shas, verbatim doctor output, a 17-row near-miss table with measured counts, `git` shim timings.     |
| Real E2E (not mocked)                   | PASS   | Two real servers, real git commits, raw HTTP against `/api/db/doctor`; reproduced here independently.        |
| Scenarios cover acceptance criteria     | PASS   | All three criteria; plus bound, timing, report-only, and boot catch-up.                                     |
| Application restarted after changes     | PASS   | Pre-fix run on 8794, post-fix run after restart (pid 8793) on the same workspace.                           |
| Actual model recorded (implemented on:) | PASS   | "**Implemented on: opus** (`claude-opus-5[1m]`)."                                                           |
| Reproduction logged before fix (bugs)   | PASS   | TEST-603 shows the blind spot before the fix: clean verdict, exit 0, three committed documents unreadable.   |

TEST-608's `git`-shim measurement (and its self-report that the first attempt
silently produced an empty log because `sanitizeGitEnv` stripped a `GIT_`-prefixed
variable) is the kind of detail that only comes from actually running the thing.

## Criteria Results

| #   | Criterion                                                                            | Result | Notes                                                            |
| --- | ------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------- |
| 1   | `corpus db doctor` names every file under `data/docs/` the projection will never index, with its creating commit | PASS   | 4 findings, each with the right sha.                             |
| 2   | Zero false positives on a healthy workspace (near-miss folders stay silent)           | PASS   | Every near-miss measured at 0 mentions and confirmed indexed.    |
| 3   | Report-only unless a cleanup verb is explicitly added                                 | PASS   | Tree and HEAD identical across two doctor runs.                  |
| 4   | TEST-609 — `ok` stays true, exit 0, `rebuild && doctor` stays clean                    | PASS   | Both modes and the exit code agree.                              |
| 5   | TEST-612 — dot-leading filename discriminated by the presence of an `id`               | PASS   | `.hidden.md` reported, `.scratch.md` silent.                     |

## Evidence

### Seeded pre-fix style

```
$ git commit -m "seed invisible documents and near-miss fixtures (pre-SERVER-037)"
c737c70
  data/docs/.claude/skills/invisible-doc.md      (id: doc_inv1skill0001)
  data/docs/node_modules/ignored-dir-doc.md      (id: doc_inv2ignored01)
  data/docs/notes/.hidden/x/nested-hidden.md     (id: doc_inv3nested01)
  + near-misses (below)
$ corpus db rebuild
rebuilt the projection in 13ms — 24 documents, 7 threads, …
```

Still invisible to the corpus after the rebuild:

```
$ corpus doc show doc_inv1skill0001 --json
{"error":{"code":"not_found","message":"404 not_found: no document with id doc_inv1skill0001"}}
```

### Doctor names them, with the creating commit

```
$ corpus db doctor
unindexable_file data/docs/.claude/skills/invisible-doc.md: … is a document the projection
  will never index: its path crosses a segment the document walk skips, so the corpus can
  never show it. Added in c737c70 "seed invisible documents and near-miss fixtures
  (pre-SERVER-037)". Move it elsewhere under data/docs/ or delete it — doctor changes nothing.
unindexable_file data/docs/node_modules/ignored-dir-doc.md: …  Added in c737c70 …
unindexable_file data/docs/notes/.hidden/x/nested-hidden.md: … Added in c737c70 …
projection is clean — 24 documents from 24 files (17ms)
exit=0
```

`--json` carries the same set with `kind`/`path`/`detail`/`commit`, and raw HTTP
agrees:

```
GET /api/db/doctor → ok True  kinds {'unindexable_file'}  commits {'c737c70'}
```

### The dot-leading rule, both sides

Second commit `6597e91` added `data/docs/.hidden.md` **with** an `id`:

```
unindexable_file data/docs/.claude/skills/invisible-doc.md   c737c70
unindexable_file data/docs/.hidden.md                        6597e91   ← reported
unindexable_file data/docs/node_modules/ignored-dir-doc.md   c737c70
unindexable_file data/docs/notes/.hidden/x/nested-hidden.md  c737c70
```

`data/docs/.scratch.md`, dot-leading but carrying **no** frontmatter:
`grep -c "scratch"` over the full `--json` report → **0**.

### Near-misses, measured rather than asserted

`/usr/bin/grep -o <item> doctor.json | grep -c .` over the full report:

| item                          | mentions |
| ----------------------------- | -------- |
| `data/docs/my.notes/a.md`     | 0        |
| `data/docs/node_modules.md`   | 0        |
| `data/docs/README.md`         | 0        |
| `data/docs/.scratch.md`       | 0        |
| any `nearmiss` id             | 0        |

And they are not merely unreported — they are **indexed**:

```
$ corpus doc show doc_nearmiss0001 → "Near miss dotted folder"
$ corpus doc show doc_nearmiss0002 → "File named like the ignored dir"
$ corpus doc show doc_nearmiss0003 → "Readme"
```

Every warning path is under `data/docs/` (checked programmatically:
`all under data/docs/: True`), and the only kind emitted is `unindexable_file`.

### Report-only

```
git status --porcelain  before → after two doctor runs   IDENTICAL
git rev-parse HEAD      before → after                   IDENTICAL
```

### Verdict and exit code unmoved

```
doctor on the affected workspace   ok: true, exit 0, 4 warnings
rebuild && doctor                  exit 0
```

## Failures

None.

## Summary

5 of 5 criteria passed. Files that were committed into a location the document walk
skips — the case that was structurally invisible before — are now named with the
commit that introduced them, without moving the verdict or the exit code, without
touching the tree, and without a single false positive across the seventeen
near-miss shapes I could build. The dot-leading discriminator (`id` present or not)
behaves exactly as the Technical Design describes.
