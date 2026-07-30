# Evaluation: SERVER-037 — a document nobody can ever read is never created

**Date**: 2026-07-30
**Sprint**: sprint-017 (wave 3), TEST-557–565
**Verdict**: **PASS** (9 of 9 criteria)

Re-derived against a real running server (`.../s017-eval3/wsV6`, port `9193`, `corpus init`-ed from a
cwd outside this repository) plus a filesystem-and-git inspection of the implementing agent's own
pre-fix drill workspace, which still holds the artefacts its reproduction created. No implementation
source was read.

---

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                             |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Filled, per test.                                                                                                                                                 |
| Commands are specific and concrete       | PASS   | Real curl calls with bodies, real document ids, real commit hashes, real file paths, `HEAD` before/after.                                                          |
| Real E2E (not mocked)                    | PASS   | Real server from source against a scratch workspace; the pre-fix reproduction wrote real files and produced real auto-commits, which still exist and I inspected them. |
| Scenarios cover acceptance criteria      | PASS   | Every TEST-557–565 has drill evidence.                                                                                                                            |
| Application restarted after changes      | PASS   | The pre-fix and post-fix runs are against the same workspace with the server rebuilt between them; the surviving files prove which run produced what.               |
| Actual model recorded (implemented on:)  | PASS   | `implemented on: **opus** (server-dev, sprint-017 stage D, 2026-07-30)`.                                                                                           |
| Reproduction logged before fix           | PASS   | TEST-557 shows the `404` response, the written file, and the auto-commit — **and all three still exist on disk in that workspace**, which is as independent as a pre-fix reproduction gets. See FINDING-3. |

---

## Criteria Results

| #        | Criterion                                        | Result | Observed                                                                                                                                                                              |
| -------- | ------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-557 | The bug is reproduced before it is fixed         | PASS   | Logged with the `404`, the file and the commit. Corroborated independently: the drill workspace still contains `data/docs/.claude/skills/invisible-doc.md`, `data/docs/node_modules/ignored-dir-doc.md` and `data/docs/notes/.hidden/x/nested-hidden.md`, and its git log still carries `4975d21 doc create: Invisible Doc (doc_2qk2usjf) by user`. |
| TEST-558 | A dot-segment folder is a `400` naming the field | PASS   | `.claude/skills`, `.foo`, `notes/.hidden/x`, `data/docs/.claude`, `sub/.git` — all **400**, all `issues[0].path = "folder"`. Leading, nested and whole-folder positions all drilled.        |
| TEST-559 | Nothing written and nothing committed            | PASS   | See FINDING-1.                                                                                                                                                                        |
| TEST-560 | Every segment the projection skips is refused    | PASS   | Both doors: dot-prefixed **and** ignored-directory names (`node_modules`, `notes/node_modules/x`, `.git`, `.corpus`) → 400. And see FINDING-2, which is the stronger half: the rule is demonstrably *derived*, not a hand-copied blocklist. |
| TEST-561 | Legal near-misses round-trip, no over-refusal    | PASS   | `my.notes`, `v1.2`, `notes/2026.07`, `a.b/c.d`, `finance/2026` — each **201**, each with a file at the expected path, **one `doc create: … by user` auto-commit per document**, `GET /api/docs/{id}` → **200**, and each listed by `GET /api/docs?folder=<folder>`. Full write → commit → project → read, not a status-code check. |
| TEST-562 | Containment not weakened                         | PASS   | `../../etc` → *"…is not a folder under data/docs"*; `data/docs/../../escape` → same; `/etc` → *"…is an absolute path, not a folder name"*; `C:\Windows` → same; `..` and `a/../../b` → the containment message. Every pre-existing refusal keeps **its own** message, distinct from the new one — the new check runs after, it does not short-circuit the old ones. |
| TEST-563 | Reads are left alone                             | PASS   | `git diff --name-only 9d27e4e~1 9d27e4e` → `apps/server/src/docs/write.ts`, `docs/write.test.ts`, `docs/create.test.ts`. **`apps/server/src/projection/` is not in the commit** — `classifyPath` was not taught to index dot-segment paths. |
| TEST-564 | Already-committed invisible docs recorded, not inherited | PASS | The log states plainly that the fix is forward-only. Verified: the three pre-fix files still sit in the old drill workspace, unreadable by every read surface, and `db doctor` is structurally silent about them. The recovery path was **filed, not built** — `issues/server/038-invisible-doc-recovery.md` exists, `status: todo`, `Depends on: SERVER-037`. Scope discipline held. |
| TEST-565 | Blast radius                                     | PASS   | Exactly three files (above). `SPEC.md`, `packages/contract`, `apps/ui` empty across the batch. `400` was already a declared response on both affected routes, so no contract change was needed — and none was made. |

---

## Load-bearing evidence

### FINDING-1 — TEST-559, the audit trail is the surface the bug damaged

Seven refused shapes fired around a fixed `HEAD`, then the workspace swept:

```
400 ".claude/skills"       path=folder :: .claude/skills contains a folder name the corpus never indexes
                                          (a name starting with `.`, or an ignored directory such as
                                          `node_modules`), so a document filed there could never be read back
400 ".foo"                 path=folder :: idem
400 "notes/.hidden/x"      path=folder :: idem
400 "node_modules"         path=folder :: idem
400 "notes/node_modules/x" path=folder :: idem
400 "data/docs/.claude"    path=folder :: idem
400 "sub/.git"             path=folder :: idem

HEAD before: 97386e4d7b8bd6ea6539d70812ff02a0bf09b07c
HEAD after : 97386e4d7b8bd6ea6539d70812ff02a0bf09b07c   (UNCHANGED)
/usr/bin/grep -rl "Invisible Post Fix" <ws>/data   → (no match, exit 1)
git status --porcelain                             → only my own untracked server.log
```

No file, no commit, no projection row. Checking the response alone would not have been enough: the
entire original defect was a `400`-shaped outcome arriving **after** a successful commit.

### FINDING-2 — TEST-560, the rule is derived, not copied — proved by what it *accepts*

A blocklist would be checked by what it refuses. The interesting evidence is the opposite: folders
that *look* like build cruft but are **not** in the projection's skip set must still be accepted, and
they are — and, crucially, they are then **readable**, which is what makes accepting them correct:

```
folder=dist       POST 201  doc_c4rhw6wp  data/docs/dist/probe-dist.md          → GET 200
folder=coverage   POST 201  doc_tlolym7r  data/docs/coverage/probe-coverage.md  → GET 200
folder=node_modules   400   (refused)
folder=.git           400   (refused)
```

`dist/` and `coverage/` are accepted **and** round-trip, while `node_modules` and `.git` are refused.
That asymmetry is exactly what a rule derived by asking `classifyPath` about a probe path produces,
and exactly what a hand-maintained "looks like build output" list would get wrong. There is one
declaration, not two, and the refusal set tracks it.

### FINDING-3 — `POST /api/docs/{id}/move` inherits both halves

```
move -> .claude/skills   400  path=folder  .claude/skills contains a folder name the corpus never indexes …
move -> node_modules     400  path=folder  (same, the ignored-directory door)
move -> archive.2026     200  data/docs/archive.2026/mover-2.md
```

Both routes share the one helper, so the second write path cannot drift from the first.

### FINDING-4 — the forward-only consequence, seen rather than described

In the implementing agent's own pre-fix workspace, the three documents its reproduction created are
still there:

```
data/docs/.claude/skills/invisible-doc.md
data/docs/node_modules/ignored-dir-doc.md
data/docs/notes/.hidden/x/nested-hidden.md
git log:  4975d21 doc create: Invisible Doc (doc_2qk2usjf) by user
```

They are invisible to every read surface **and** to `db doctor`, because `enumerateDocuments` skips the
same segments `classifyPath` does. A workspace that ever hit this bug therefore carries files only
`git log` and a filesystem walk can find. The log says this plainly and files `SERVER-038` for the
recovery path rather than inventing a migration inside a P2. That is the right call and the right
record.

---

## Refuted claims

None. Every status code, message, path and blast-radius claim in the log matched what I observed, and
the one thing I set out to catch — an over-broad hand-written blocklist wearing the costume of a
derived rule — is disproved by `dist/` and `coverage/` round-tripping (FINDING-2).

---

## Summary

**9 of 9 criteria pass.** A folder the projection would never index is now refused at validation time
with a `400` naming `folder`, before anything is written — both doors of `classifyPath`'s skip
condition, in every nesting position, on `POST /api/docs` and on `POST /api/docs/{id}/move`. Nothing
is written, nothing is committed, no id is burned. Folders that merely resemble the refused shapes are
not over-refused and walk the full write → commit → project → read round trip. Containment keeps its
own error class and its own messages. Reads were left alone. The fix is forward-only and says so, with
the recovery path filed as `SERVER-038` rather than smuggled into a P2.
