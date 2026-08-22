# Evaluation: SERVER-005

**Date**: 2026-07-27
**Sprint**: sprint-005 (TEST-1…TEST-55, plus TEST-117, TEST-121, TEST-122, TEST-124…TEST-126)
**Verdict**: **PASS** (round 2, at `6e23872`) — was FAIL in round 1 (at `879a443`)

**Round 1** (HEAD `879a443`): 54 of 55 criteria passed; FAIL-1 — a delete inside the squash window
never recorded the deletion and leaked a **staged** change into the next commit anyone made.

**Round 2** (HEAD `6e23872`, "Amend-would-empty falls back to a fresh commit; index never left
dirty"): **FAIL-1 is fixed**, both contamination probes are clean, four adversarial pokes at the
new seam hold, every round-1 passing path is unchanged, and the fix additionally closed round-1's
Note 1. **55 of 55 criteria pass.** Detail in "Round 2" below.

Round 1 was evaluated against the merged state of `phase-2-server-cli` (HEAD `879a443`), on real
`corpus init` workspaces with real servers on 127.0.0.1:8890/:8892, real git repositories, real
`curl`, real `sqlite3`, and real `curl -N` SSE. Where sprint prose and the issue's "Sprint-005
Adjudications" conflict, the adjudication governs.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                                             |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Main log plus three signed amendments (warnings wiring, git-identity spelling, template body-only correction).                                                                     |
| Commands are specific and concrete      | PASS   | Real ids, real commit shas, real author/committer pairs, byte-level selector diffs, a measured latency table, exact warning JSON.                                                  |
| Real E2E (not mocked)                   | PASS   | Real server started **directly** with `node --import tsx apps/server/src/main.ts` (deliberately unsanitized, for TEST-38), real git repo with real hooks, real `curl`, real SSE.   |
| Scenarios cover acceptance criteria     | PASS   | Every AC has evidence. The one deferral (`423` → SERVER-009) was declared with a substitute and later discharged at harvest.                                                       |
| Application restarted after changes     | PASS   | Fresh servers for the main run, the warnings wiring, and the template-fix re-verification; ports checked free afterwards.                                                          |
| Actual model recorded (implemented on:) | PASS   | "**Implemented on: opus.**", restated in each amendment.                                                                                                                           |
| Reproduction logged before fix (bugs)   | PASS   | The template body-only correction is a bug fix and carries a **pre-fix reproduction** on a real server (`201 … "evergreen":true` before any code change), plus a blast-radius demonstration. Exemplary. |

**Honesty spot-check.** This log is unusually detailed, so I re-derived its most checkable claims
rather than accepting them. **Every one reproduced**, several near-exactly:

| Claim in the log                                            | My independent measurement                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1 MB PUT, zero anchors, p50 **121.8 ms**                    | **120 ms** p50 over 10 timed PUTs                                                 |
| 1 KB p50 90.8 ms / 100 KB p50 99.8 ms                       | 80 ms / 90 ms (same ballpark; my figures include `curl` startup)                  |
| Squash window `SQUASH_IDLE_MS = 30_000`                     | Two saves 100 ms apart → 1 commit; 31 s apart → 2 commits                         |
| Author date = first save, committer date = last             | `2026-07-27T00:18:13-07:00 \| 2026-07-27T00:18:31-07:00`                          |
| Orphaned selector preserved byte-for-byte                   | md5 of the anchors block identical before/after                                   |
| Template pre-fill is body-only after the fix                | `evergreen:false, tags:[], status:open, due:null` with the template body present  |
| `%an` is a clean audit column                               | 50 `user <user@corpus.local>` + 2 `agent <agent@corpus.local>`; committer is the process identity |

The log's self-corrections are honest and unusually good: the struck "§10 carry-over rule"
sentence, the superseded `Corpus User`/`Corpus Agent` naming, and the volunteered
"Observed, not a regression" paragraph about a stale `anchors.orphaned` report all describe real
behaviour I confirmed. **Nothing in this log was found to be overstated or fabricated.** The
defect below was simply never exercised — no test in the log deletes a document inside the squash
window.

## Criteria Results

### Create

| #      | Criterion                                          | Result | Notes                                                                                                                                                                  |
| ------ | -------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TEST-1 | Minimal create lands in inbox, frontmatter stamped  | PASS   | 201; `data/docs/inbox/mortgage-options.md`; `id doc_*`, `type note`, `created == updated`, `tags: []`, `status: open`, `anchors: {}`, `due: null`, `reviewed: null`, `evergreen: false`. Response validates as `Doc`. |
| TEST-2 | Default folder `inbox`; both folder spellings       | PASS   | No folder → `inbox/`; `"finance"` and `"data/docs/finance"` both → `data/docs/finance/`. All three 201.                                                                  |
| TEST-3 | Body pre-filled from the matching template          | PASS   | Seeded `templates/note.md` body (`## Context / ## Notes / ## Open questions`) appears verbatim; `id`/`type`/`created`/`updated` are the server's.                        |
| TEST-4 | Explicit body wins; absent template is not an error | PASS   | Explicit body → exactly `"Only my words."`, no template text. `type: view` with no template → **201 with `body: ""`** (the §10 "none → empty" case), not 400, not 500.  |
| TEST-5 | Template selection deterministic; loops refused     | PASS   | With four competing templates, three consecutive creates all picked **the same first-by-path open one**; the `status: archived` template (which sorts first) was never picked; a `type: template` create did **not** pre-fill from the `for: template` document (`body: ""`) and did not hang or recurse. |
| TEST-6 | Slug collisions dedupe rather than overwrite        | PASS   | `dupe-title.md`, `dupe-title-2.md`, `dupe-title-3.md`, distinct ids, original untouched; `select count(*) … title='Dupe title'` → **3**.                                 |
| TEST-7 | Ids unique; pathological titles still produce files | PASS   | Emoji, 400 chars, pure punctuation and combining diacritics all 201. Filenames non-empty and distinct; the 400-char title truncated to **60** chars (`slugifyTitle`'s cap); emoji/punctuation fall back to the id. 49 rows / 49 distinct ids. |
| TEST-8 | Path traversal refused before anything is written   | PASS   | `"../.."`, `"/etc"`, `"data/docs/../../.."` → **400** `bad_request` with non-empty `issues`. A **symlink** inside the workspace pointing at `/etc` → 400 `"…resolves outside the workspace"`; nothing created outside `data/`; `git status` unchanged. |

### Read-one

| #       | Criterion                                     | Result | Notes                                                                                                                                        |
| ------- | --------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-9  | Created document readable immediately          | PASS   | `GET` in the very next command, no sleep → 200 with the same id and path. Read-your-write holds without the watcher.                          |
| TEST-10 | Read-one resolves anchors and reports orphans  | PASS   | `{"anchorId","selector","threadId","threadStatus","range":{start,end},"orphaned":false}` for the resolving anchor; `range: null, orphaned: true` after its text was removed. |
| TEST-11 | Unknown/malformed id is 404/400, never 500     | PASS   | `doc_zzzzzzzz` → **404** `not_found`; `not-an-id` → **400** with `issues[param.id]`. Neither is a 500 and **neither leaks a filesystem path** (checked for the absolute workspace path). |

### Update and anchor reconciliation

| #       | Criterion                                          | Result | Notes                                                                                                                                                        |
| ------- | -------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-12 | Body edit written, stamped, reported                | PASS   | 200 `{doc, anchors:{remapped,orphaned}, warnings}`; file holds the new body; `updated` advances; `created` unchanged; `body_excerpt` follows.                |
| TEST-13 | An edit **above** the anchor remaps in ONE commit   | PASS   | `{"remapped":["anc_eval0001"],"orphaned":[]}`; **one** new commit; `git show --stat HEAD` lists that single file; `exact` unchanged, `prefix`/`suffix` refreshed. Body and anchors land in the same commit. |
| TEST-14 | An edit **inside** the range rewrites `exact`       | PASS   | On disk `exact: The rate is fixed for eleven years.`; `GET` still shows a non-null `range` — the thread stays attached.                                       |
| TEST-15 | Deleting the text orphans and preserves the selector | PASS  | `{"remapped":[],"orphaned":["anc_eval0001"]}`; the anchors block is **byte-identical** (md5 match) before and after; the thread file is untouched and still lists. |
| TEST-16 | Reconciliation runs against the on-disk body        | PASS   | A paragraph appended out of band with `printf >>` **survived** the next `PUT` and the reconciliation saw it. No client-supplied `oldBody`.                    |
| TEST-17 | A `reviewed`-only patch is not an edit              | PASS   | `reviewed` set, **`updated` unchanged** (`2026-07-27T07:18:31Z` before and after).                                                                            |
| TEST-18 | A no-op `PUT` writes, commits and emits nothing     | PASS   | Both `{}` and a field-for-field-identical `PUT` → 200 with empty `remapped`/`orphaned`; `HEAD` unchanged, **mtime unchanged**, `updated` unchanged, and **zero** `invalidate` frames emitted. |
| TEST-19 | Concurrent `PUT`s serialize and chain correctly      | PASS   | Ten parallel PUTs → all **200**; final file parses with well-formed frontmatter; projection row matches the file; the anchor entry survived; no `*.tmp` anywhere. |
| TEST-20 | Every server-generated 400 carries `issues`         | PASS   | Traversal, malformed id, invalid `status`, invalid `due`, occupied move destination, thread move, `ttl: 0`, empty log line — **every one** parsed as `ValidationError` with a non-empty `issues` array. |

### Move

| #       | Criterion                                    | Result | Notes                                                                                                                                             |
| ------- | -------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-21 | A move changes the path, never the id         | PASS   | 200 → `data/docs/finance/mortgage-options.md`; old path gone; `GET` still resolves; the thread's `parent` still names the id, unrewritten; one projection row. |
| TEST-22 | The move commit records both paths            | PASS   | `doc move: data/docs/inbox/… → data/docs/finance/… (doc_2y44j4hq) by user`, author `user <user@corpus.local>`; `git show --stat` shows a **rename** of exactly that file. |
| TEST-23 | A move to an occupied destination is refused  | PASS   | **400** `issues:[{"path":"folder","message":"data/docs/finance/mortgage-options.md already exists"}]`; both files at their original paths; `HEAD` unchanged. |
| TEST-24 | Threads cannot leave `data/threads/`; traversal refused | PASS | Thread move → 400 with `issues`; `"../.."` → 400 with `issues`. Nothing written.                                                                   |

### Archive and unarchive

| #       | Criterion                                        | Result | Notes                                                                                                                                                    |
| ------- | ------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-25 | Archiving flips status; the document stays indexed | PASS | 200 with `status: archived`; on-disk frontmatter agrees; `?status=archived` lists it (1); the default list does **not** (0). Unarchive reverses all three. |
| TEST-26 | Archiving a skill moves its whole folder          | PASS   | `.claude/skills/demo/` with `SKILL.md` **plus `refs/notes.md` and `run.sh`** → all three under `.claude/skills-archived/demo/`; source folder gone; `?type=skill&status=archived` still lists it; the commit shows the folder move. |
| TEST-27 | Unarchiving reverses the folder move exactly       | PASS   | Every file back, archived root gone, `status: open`, same id.                                                                                              |
| TEST-28 | A skill archive into an occupied destination fails without merging | PASS | **400** `issues:[{"path":"id","message":".claude/skills-archived/dup2 already exists; move or remove it first"}]`. Both folders' file sets **byte-identical** before and after (md5 of per-file digests), `HEAD` unchanged. No partial merge. |
| TEST-29 | Archiving is idempotent-safe and never deletes     | PASS   | archive×2 → 200/200, unarchive×2 → 200/200, no 500; file present throughout; `git log --diff-filter=D -- <path>` empty.                                    |

### Delete

| #       | Criterion                                | Result | Notes                                                                                                                                                            |
| ------- | ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TEST-30 | An agent actor cannot delete              | PASS   | **403** `{"code":"forbidden","message":"deletion is user-only; the agent archives, never deletes"}` — the message names the rule. File present, row intact, `HEAD` unchanged. |
| TEST-31 | A user actor deletes, and history survives | **PASS (r2)** | Round 1: FAIL inside the squash window — the deletion was never committed. Round 2 at `6e23872`: `HEAD` advances to a real `doc delete:` commit, `--diff-filter=D` finds it, the file is absent from HEAD's tree, the index is clean, and the create commit survives unrewritten as an ancestor. |
| TEST-32 | Deletion never cascades to threads         | PASS   | `orphanedThreadIds:["th_eval0001"]`; the `threads` row survives, still names the deleted id as `parent`, still readable. Its anchors no longer resolve. Nothing cascaded. |
| TEST-33 | Default actor is `user`, read from the shipped header | PASS | Headerless delete succeeds as `user`. `x-corpus-author: agent` → commit authored `agent <agent@corpus.local>`. The wrong header **`X-Corpus-Actor: agent`** is treated as headerless (authored `user`) and is **not rejected**. |

### Auto-commit, authorship, audit trail

| #       | Criterion                                       | Result | Notes                                                                                                                                                              |
| ------- | ----------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-34 | Every verb commits with the acting party as author | PASS | Whole history: **50** `user <user@corpus.local>`, **2** `agent <agent@corpus.local>`, plus my own manual commit. **Committer is the process identity** (`Theophane Rupin`), so `%an` alone is a clean audit column, uniform from the `corpus init` commit onward (the adjudicated spelling, superseding the sprint's "Corpus User"). |
| TEST-35 | The commit body carries machine-readable trailers | PASS  | **51 doc commits, 0 missing** `Corpus-Doc` + `Corpus-Actor`. Exactly one commit carried `Corpus-Anchors: remapped=0 orphaned=1` — and it is the right one: the trailer is **refreshed on amend** and reports the session's net anchor outcome. Commits touching no anchors carry no such trailer. |
| TEST-36 | The commit stages only the files the mutation touched | **PASS (r2)** | Always held for normal mutations. Round 1: broken by FAIL-1's staged leak, observed contaminating SERVER-009's force-break audit commit and a user's own manual `git commit`. Round 2: `git diff --cached` is empty after every scenario; an operator's `git add UNRELATED.md && git commit` carries **only** `UNRELATED.md`; the force-break audit commit is **empty** again; an unrelated dirty file still stays dirty. |
| TEST-37 | Git operations serialize; no cross-contamination | PASS   | Ten parallel PUTs alternating between two documents → **10 commits, 0 cross-contaminated**. Every commit lists exactly one path and its `Corpus-Doc` trailer matches the file in its diff. |
| TEST-38 | The git child process runs with a sanitized environment | PASS | Server started **directly** with `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/`GIT_AUTHOR_*`/`GIT_COMMITTER_*`/`GIT_CONFIG_COUNT|KEY_0|VALUE_0` and lowercase `git_work_tree` all aimed at a foreign repo. Commits landed in the **workspace**; the foreign repo's log was unchanged and its tree clean. Authors were `user`/`agent <@corpus.local>`, **not "Hook Leak"**. The read path (`git show HEAD:<path>`) also stayed clean. |

### Squash-on-idle

| #       | Criterion                                       | Result | Notes                                                                                                                                                     |
| ------- | ----------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-39 | Two rapid saves are one commit                   | PASS   | Two PUTs ~100 ms apart → **exactly one** new commit containing **both** edits (`grep -c 'EDIT [AB] marker'` → 2); the file holds the second.                |
| TEST-40 | The amend preserves the session's author timestamp | PASS | `%aI \| %cI` → `2026-07-27T00:18:13-07:00 \| 2026-07-27T00:18:31-07:00`. Author date = session start, committer date = last save.                          |
| TEST-41 | Window, author, document and interleaving each break the amend | PASS | All four → **2** commits: (a) >30 s apart; (b) same doc, `user` then `agent`; (c) two documents inside the window (also confirmed by TEST-37's 10/10); (d) an unrelated manual commit in between. Control (same doc/actor inside the window) → 1. |
| TEST-42 | The amend never rewrites published or non-linear history | PASS | (a) pushed upstream → **fresh commit**, the pushed sha still an ancestor and still `origin/main`'s tip. (b) in-progress merge, both conflicted and clean → 200 with `commit_failed` (`"cannot do a partial commit during a merge"`), `HEAD` unchanged, `MERGE_HEAD` preserved, no accidental merge commit. (c) interrupted rebase → **fresh commit**, `C1` unchanged and still an ancestor. (d) detached HEAD → **fresh commit**, `main` byte-identical. **No state rewrites a commit it did not just make.** |
| TEST-43 | Create → edit inside the window behaves as adjudicated | PASS | **Folds**, per Adjudication 2. One commit, subject stays `doc create: …`, content holds both. The log states the choice and cites the adjudication. |

### Hook failure, missing git, warnings

| #       | Criterion                                         | Result | Notes                                                                                                                                                             |
| ------- | ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-44 | A failing pre-commit hook does not roll back the file | PASS | Response **200** (not 500); the file **holds the edit**; `git status` shows it uncommitted; `HEAD` unchanged; the server log carries a loud entry containing the hook's own three stderr lines; the projection updated and an `invalidate` frame still fired. Removing the hook → a normal commit. |
| TEST-45 | The response surfaces the failure as far as the contract allows | PASS | The CONTRACT-005 rider landed, so the stronger branch applies: the body validates **and** carries `{"code":"commit_failed","detail":"git commit failed: <the hook's own output>"}`. No undeclared field. SPEC §11's "a warning on the API response" is met on every mutation verb, alongside the log line. |
| TEST-46 | A workspace that is not a git repository stays usable | PASS | Both variants. `.git` moved aside: create/edit/move/archive/unarchive/delete all succeeded, files landed, immediate GETs reflected every change, `commit_skipped` — `"the workspace is not a git repository"`. **No `git` on `PATH`** (a `PATH` containing only `node` and `sh` symlinks): the same full set succeeded with `commit_skipped` — `"git is not available on PATH"`. No 500, no hang. |

### Pipeline invariants

| #       | Criterion                                         | Result | Notes                                                                                                                                                        |
| ------- | ------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-47 | Writes are atomic                                  | PASS   | 1.4 MB body, 3 full rewrites under concurrent readers: **1 672 HTTP GETs and 11 314 `cat`s, zero anomalies**. Both readers saw only whole, parseable documents (4 distinct digests). No `*.tmp` observed during or after. |
| TEST-48 | A failure before the write leaves the workspace untouched | PASS | After traversal, occupied-destination and bad-id rejections: `git status` unchanged, no `*.tmp`, projection unchanged.                                        |
| TEST-49 | Every mutation re-projects synchronously            | PASS   | With no sleep, in the same command chain: create → `GET` 200 and a `documents` row; edit → new `body_excerpt`; move → new `path`; archive → `archived`; unarchive → `open`; delete → row gone and `GET` 404. |
| TEST-50 | The write path registers its own writes             | PASS   | **Exactly one** `invalidate` frame per API mutation (a watcher double-projection would produce a second). An out-of-band edit still produced its own frame, so the watcher is live — the suppression is selective, not blanket. |
| TEST-51 | The write path emits its own invalidations, keys only | PASS | Per verb: create/move/delete → `["docs"]`, `["docs","<id>"]`, `["tree"]`; edit/archive/unarchive → `["docs"]`, `["docs","<id>"]`. Exactly the pinned vocabulary. `grep '^data:' | grep -v '^data: {"keys":'` → nothing; no title, body or path in any frame. |
| TEST-52 | The invalidation is broadcast after the projection updates | PASS | Waited for the frame naming the new id, then refetched immediately: the document was already there.                                                          |
| TEST-53 | Latency measured, not assumed                       | PASS   | Independently re-measured. 1 KB p50 **80 ms**; 100 KB p50 **90 ms**; 1 MB (0 anchors) p50 **120 ms** — the log's 121.8 ms figure reproduces almost exactly, corroborating its ~76 ms reconciliation share at 1 MB. `Diff_Timeout` never reached. |
| TEST-54 | `rebuild && doctor` clean after the whole verb surface | PASS | After every verb above: `rebuild` → `{"documents":59,…,"skipped":[]}`; `doctor` → **`{"ok":true,"drift":[]}`**. No `count_mismatch` from queue `.gitkeep`s, the archived skill folder, deleted documents, lock files, job logs or anchor write-backs. Independently: 30/30 files ↔ rows, no orphan rows, no unprojected files, no `.gitkeep` ever projected. |
| TEST-55 | The typed client drives the write surface           | PASS   | **Verified myself.** create/update/move/archive/delete through `createCorpusClient(...).api`, actor header via typed `params.header`. `tsc --strict --module nodenext` **exit 0**; all five succeeded at runtime; responses narrowed **without a cast** (`const title: string = created.data.doc.frontmatter.title`, `const remapped: string[] = updated.data!.anchors.remapped`). |

### Cross-issue

| #        | Criterion                                        | Result | Notes                                                                                                                                                  |
| -------- | ------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-117 | **The centerpiece — a document's whole life**     | PASS   | Every hop fired, nothing stubbed. See below.                                                                                                            |
| TEST-121 | The write path and the watcher do not both project | PASS  | One frame per API mutation; the out-of-band edit projected through the watcher and produced its own frame.                                               |
| TEST-122 | `HEAD` now advances, closing sprint-004's degradation | PASS | After an API edit, `git show HEAD:<path>` returned **the API edit's committed body** (`two`) — the immediately preceding state, not an older one.        |
| TEST-124 | The published vocabulary is the emitted vocabulary | PASS   | All nine published shapes observed on a live stream; no shape emitted outside the set. Detail in `CONTRACT-005-eval.md`.                                 |
| TEST-125 | `rebuild && doctor` clean after the whole chain    | PASS   | `{"ok":true,"drift":[]}` after documents + locks + jobs + queue + out-of-band edits.                                                                     |
| TEST-126 | The repo-wide gates stay green                     | PASS   | My own runs from a clean tree: `build` ✔ · `lint` ✔ · `format:check` ✔ · `typecheck` (all workspaces) ✔ · `vitest run --coverage` → **2 725 passed / 670 suites, 0 failed**, 98.81 % lines / 95.05 % branches (gate 90 %) · `check-generated-artifacts.ts` ✔ (openapi + `docs/cli.md` both drift-free) · `CORPUS_UI_PORT=5273 npm run e2e` → **13 passed**. `git status` in the repo clean. |

### TEST-117, the centerpiece — observed

```
1. POST /api/docs {"type":"note","title":"Mortgage options"}  → 201
   data/docs/inbox/mortgage-options.md, template body verbatim, full stamped frontmatter,
   evergreen:false (body-only pre-fill), warnings:[]
2. git log -1 → user <user@corpus.local> | doc create: Mortgage options (doc_2y44j4hq) by user
   body   → Corpus-Doc: doc_2y44j4hq / Corpus-Actor: user
3. SSE   → data: {"keys":[["docs"],["docs","doc_2y44j4hq"],["tree"]]}      (keys only)
4. GET /api/docs/doc_2y44j4hq, next command, no sleep → 200
5. PUT inserting a paragraph above the quote
   → {"anchors":{"remapped":["anc_eval0001"],"orphaned":[]},"warnings":[]}
   ONE commit; git show --stat HEAD → data/docs/inbox/mortgage-options.md (that file alone);
   exact unchanged, prefix/suffix refreshed  → body + anchors in the SAME commit
6. Two further PUTs ~100 ms apart → ONE commit holding both edits
   %aI|%cI = 00:18:13 | 00:18:31   (author = session start, committer = last save)
7. corpus server stop → no process, no pidfile, port free
```

## Failures

### FAIL-1: A delete inside the squash window never records the deletion and leaks a staged change — **FIXED, verified round 2**

**Criterion**: TEST-31 (`git log --diff-filter=D -- <path>` shows the deletion), TEST-36 (the
commit stages only the files the mutation touched), SPEC §4 ("`git log` doubles as the audit trail
of who changed what").

**Expected**: Deleting a document records the deletion in git history and leaves the workspace's
index clean, exactly as it does outside the squash window.

**Observed**: When `DELETE /api/docs/{id}` amends a preceding auto-commit in which the document was
**created**, the amend would empty that commit, git refuses, and the server gives up without
falling back. The HTTP call still returns **200** and the file and projection row are gone, so
nothing looks wrong to the caller — but git history is left actively wrong and the index is left
dirty:

```
POST /api/docs {"type":"note","title":"Repro CD"}   → 201 doc_ecmleqvq
  HEAD = f408330 doc create: Repro CD (doc_ecmleqvq) by user
DELETE /api/docs/doc_ecmleqvq   (same actor, <30 s)  → HTTP 200
{
  "deletedId": "doc_ecmleqvq",
  "orphanedThreadIds": [],
  "warnings": [{ "code": "commit_failed",
    "detail": "git commit --amend failed: On branch main\nNo changes\nYou asked to amend the
               most recent commit, but doing so would make it empty. You can repeat your command
               with --allow-empty, or you can remove the commit entirely with \"git reset HEAD^\"." }]
}

file gone from disk:                YES
projection row:                     0
HEAD:                               f408330 doc create: Repro CD (doc_ecmleqvq) by user   ← unmoved
file still in HEAD's tree:          1                                                     ← still there
git log --diff-filter=D -- <path>:  []                                                    ← deletion never recorded
git status --porcelain -- <path>:   D  data/docs/inbox/repro-cd.md                        ← STAGED leak
```

Two consequences, both observed:

1. **The audit trail is wrong, permanently.** `git log` shows a `doc create:` commit for a document
   that no longer exists, and the deletion appears nowhere. `git show HEAD:<path>` still returns
   the file. This is precisely the guarantee SPEC §4 exists to provide.

2. **The staged `D` contaminates the next commit anyone makes** — it is in the *index*, so any
   later commit by any path sweeps it up. I observed this twice:

   - SERVER-009's force-break audit commit, which TEST-67 requires to be **empty**:
     ```
     $ git show --stat --format= HEAD      # after POST /api/locks/<id>/break
      data/docs/finance/key-vocab-probe.md | 14 --------------
      data/docs/finance/verb-chain.md      | 14 --------------
      2 files changed, 28 deletions(-)
     ```
   - A user's own manual commit:
     ```
     $ git add UNRELATED.md && git commit -m "an unrelated user commit"
     $ git show --stat HEAD
       an unrelated user commit
        UNRELATED.md                |  1 +
        data/docs/inbox/repro-cd.md | 19 -------------------
     ```
     A user committing their own work silently ships someone else's deletion.

**Scope, measured.** The failure is specific to the amend producing an empty commit:

| Scenario                                                              | Result                                                                 |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| create → delete inside the window                                     | **BROKEN** — no delete commit, staged `D` left                         |
| create → edit → move → archive → unarchive → delete inside the window | **BROKEN** — same (this is how I first hit it)                          |
| create → *wait 31 s* → delete                                          | correct — 2 commits, file absent from HEAD, index clean                |
| create → *wait 31 s* → edit → delete inside the edit's window          | correct — delete amends the edit commit, file absent from HEAD, `warnings: []` |
| move / archive / unarchive amending inside the window                  | correct — no leak                                                      |

So the trigger is ordinary: **create a document and delete it within 30 seconds** — quick-create a
note, change your mind, discard it. Autosave and quick-create are exactly the flows the squash
window was built for.

**Steps to reproduce**:

1. `corpus init <ws> --port 8890 && corpus server start --workspace <ws>`
2. `curl -X POST 127.0.0.1:8890/api/docs -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"type":"note","title":"Repro CD"}'` — note the returned id.
3. Immediately (within 30 s): `curl -X DELETE 127.0.0.1:8890/api/docs/<id> -H "Authorization: Bearer $TOKEN"` — returns 200 with a `commit_failed` warning.
4. `git -C <ws> log --diff-filter=D -- data/docs/inbox/repro-cd.md` → **empty**.
5. `git -C <ws> ls-tree -r --name-only HEAD | grep repro-cd` → **the file is still in HEAD's tree**.
6. `git -C <ws> status --porcelain` → `D  data/docs/inbox/repro-cd.md`, staged.
7. `printf x > <ws>/UNRELATED.md && git -C <ws> add UNRELATED.md && git -C <ws> commit -m "unrelated"` then `git -C <ws> show --stat HEAD` → the unrelated commit carries the document deletion.

Independently reproduced twice, on two separate workspaces, by two separate testers.

## Round 2 — re-evaluation at `6e23872`

Fresh `corpus init` workspace, real server on 127.0.0.1:8890, real git, real `curl`. Every probe
below was run by me against the running application.

### The round-1 failing scenario

```
POST /api/docs {"type":"note","title":"Repro CD"}   → 201 doc_nkvy3ofs
  create commit = 3b660f0 doc create: Repro CD (doc_nkvy3ofs) by user
DELETE /api/docs/doc_nkvy3ofs   (same actor, <30 s)
  → 200 {"deletedId":"doc_nkvy3ofs","orphanedThreadIds":[],"warnings":[]}     ← no commit_failed

HEAD advanced to a delete commit  → 268c238 user <user@corpus.local> | doc delete: Repro CD (…) by user
--diff-filter=D non-empty         → 268c238 doc delete: Repro CD (doc_nkvy3ofs) by user
file absent from HEAD tree        → 0 matches
index clean                       → git status --porcelain empty
create commit still an ancestor   → YES, and 3b660f0 is unrewritten
trailers                          → Corpus-Doc / Corpus-Actor
```

All five required properties hold, and the `commit_failed` warning is gone because the commit now
actually happens.

### Both contamination probes

| Probe                                                                              | Round 1                                                   | Round 2                                        |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| Operator's unrelated commit, after two `create→move→archive→unarchive→delete` chains | carried `key-vocab-probe.md` and `verb-chain.md` deletions | carries **only `UNRELATED.md`**; index was empty beforehand |
| SERVER-009 force-break audit commit (TEST-67), staged immediately after a create→delete pair | 2 files / 28 deletions                                     | **`git show --stat --format=` is empty**        |

### Adversarial pokes at the new seam

| # | Poke                                                                 | Observed                                                                                                                                                                     |
| - | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 | Two docs created in one window, then one deleted                      | Different documents correctly break the amend, so the pair never shares a commit — the premise cannot arise. 2 creates → 2 commits; the delete makes its own third commit; **pair-one untouched in HEAD's tree and still `GET` 200**; index clean. |
| 2 | Delete-in-window when the amended commit **does** carry other content (multi-file skill-folder archive: 4 paths) | The amend is correctly **not** empty, so it amends rather than falling back: 1 commit, re-subjected `doc delete: multi`, carrying the folder move **and** the `SKILL.md` deletion. Disk, HEAD tree and projection all agree exactly (`refs/a.md` + `run.sh` present, `SKILL.md` gone; row deleted; `GET` 404). Index clean. |
| 3 | Hook rejects the **fallback fresh commit** itself                     | 200 with an **honest** `{"code":"commit_failed","detail":"git commit failed: doc check: refusing this commit"}` (the real reason, not round 1's misleading amend text). `HEAD` unchanged, the create commit not rewritten or emptied, the file gone from disk (mutation stands), and — decisively — **`git diff --cached` is empty**. The residue is ` D` (worktree-only), *not* round 1's `D ` (staged). An operator's `git add … && git commit` afterwards carried **only their own file**. This is the same shape as TEST-44's blessed hook-rejected edit (` M`). |
| 4 | Hook rejects a **create**                                              | `?? data/docs/inbox/hooked-create.md` — untracked, **not** staged-`A`; the mutation stands on disk, `HEAD` unchanged, and the document is readable (`GET` 200). Non-contaminating. |
| 5 | The fallback under TEST-42's protected states                          | **Pushed upstream**: fresh delete commit; the pushed create commit survives unrewritten and is still an ancestor of `origin/main`; index clean. **Detached HEAD**: fresh delete commit; `main` byte-identical; the detached create commit not rewritten; index clean. The new plumbing query does not weaken the amend-safety guarantees. |

### Amended commits are re-subjected by the latest verb

```
after create  → doc create: Subject probe (doc_63sy7zky) by user
after edit    → doc edit: Subject probe (doc_63sy7zky) by user
after archive → doc archive: Subject probe (doc_63sy7zky) by user
after move    → doc move: data/docs/inbox/subject-probe.md → data/docs/finance/subject-probe.md (…) by user
all folded into 1 commit; final tree path = the moved path; index clean
```

This closes **round-1 Note 1**: a folded session's `git log` line now names what actually last
happened to the document instead of being frozen at `doc create:`.

### Round-1 passing paths, re-verified unchanged

| Criterion                                              | Round 2 observation                                                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| TEST-31 past-window delete                              | 2 commits, absent from HEAD tree, `--diff-filter=D` finds it — byte-identical to round 1                  |
| TEST-39/40 two rapid saves fold                         | 1 commit containing both edits                                                                            |
| TEST-18 no-op `PUT`                                     | `HEAD` unchanged, mtime unchanged                                                                         |
| TEST-30 agent cannot delete                             | 403 `"deletion is user-only; the agent archives, never deletes"`                                          |
| TEST-36 staging hygiene                                 | `git show --stat HEAD` lists only the document; the unrelated `DIRTY.md` still ` M`                        |
| TEST-13/15 anchors in the same commit                   | `{"remapped":["anc_r2000001"],"orphaned":[]}`, one commit / one file, `Corpus-Anchors: remapped=1 orphaned=0` |
| TEST-54 projection health                               | `rebuild` `{"documents":12,…,"skipped":[]}` → `doctor` **`{"ok":true,"drift":[]}`**                        |

### Round-2 gates

`npm run build` ✔ · `npm run lint` ✔ · `npm run format:check` ✔ · `npm run typecheck` (all
workspaces) ✔ · `npx vitest run` → **2 732 passed / 670 suites, 0 failed** (up 7 from round 1's
2 725 — the fix carries new tests) · `check-generated-artifacts.ts` ✔.

Final workspace: `git diff --cached` empty; the only worktree residue is my deliberate `DIRTY.md`
fixture plus the two intentionally hook-rejected mutations; no `*.tmp` anywhere.

## Notes for the record

1. ~~**Different verbs fold into one commit inside the window**, leaving the subject frozen at
   `doc create:`.~~ **Closed in round 2** — the amended commit is now re-subjected by the latest
   verb, so `git log` names what last happened. Folding itself remains by design (TEST-34 assumes
   spacing; TEST-41 lists only four amend-breakers; Adjudication 2 pins create→edit folding).

2. **A save during an interrupted rebase is non-durable.** TEST-42(c) passes — a fresh commit is
   created and nothing is rewritten — but the commit lands on the throwaway rebase HEAD. After
   `git rebase --abort` it is unreachable from any ref and the file edit is reverted on disk. Not
   a rewrite, so not a TEST-42 failure, but the write is silently lost. Worth a follow-up.

3. **`anchors.orphaned` can be stale relative to `warnings`.** Already volunteered in the issue's
   own log and confirmed: reconciliation does not re-attach an anchor that was already orphaned in
   `oldBody`, so the response's `orphaned` list can name an anchor that `GET /api/docs/{id}` then
   resolves. The selector is preserved byte-for-byte, so nothing is lost. Pre-existing
   SERVER-002/013 behaviour, correctly identified as out of scope here.

4. **SPEC §10 vs §9.2 on template pre-fill.** The implementer flagged that §10 line 376 says
   "frontmatter/body" while §9.2 says body only, implemented per §9.2 and the orchestrator's
   directive, and did not silently re-widen. That is the right call and the right escalation; the
   spec text still needs reconciling.

5. **Deleting a multi-file skill leaves its sibling files behind.** `DELETE` on a skill document
   removes `SKILL.md` only; `refs/a.md` and `run.sh` stayed on disk *and* in git, consistently. The
   sprint does not specify skill deletion (archive is the specified folder-level operation) and
   disk, git and projection agree, so this is not a defect — recorded because it contrasts with
   TEST-26's folder-level archive and may deserve a spec sentence.

## Summary

### Round 2 verdict: PASS

**55 of 55 SERVER-005 criteria pass**, plus all six cross-issue criteria. FAIL-1 is genuinely
fixed, not papered over: the delete now produces a real `doc delete:` commit, git history is
correct and complete, and the index is left matching HEAD in every outcome I could construct —
including the two I designed specifically to break the new seam (a hook rejecting the fallback
commit itself, and the fallback running under a pushed upstream and a detached HEAD). The
remaining residue after a refused commit is worktree-only and provably non-contaminating: an
operator's own `git commit` now carries only their own work in every scenario that broke it in
round 1.

Two things I want to credit rather than just record. The fix chose the *narrow* correct condition —
it asks git plumbing whether the amend would actually empty the commit, rather than blanket-
disabling the amend for deletes — which is why poke 2 (a delete amending a genuinely non-empty
multi-file commit) still amends and still produces the right tree. And the index restoration was
generalised to every non-landed outcome rather than patched at the delete site, which is why the
hook-rejected *create* also improved (`??` instead of a staged `A`) even though nothing in my
round-1 report asked for that.

### Round 1 record (superseded)

**54 of 55 criteria passed**, plus the centerpiece with no hop stubbed. The hard cases the sprint
singled out are genuinely hard and genuinely pass: the hostile-environment test with a
directly-started server, atomicity under 13 000 concurrent reads, git serialization across ten
interleaved parallel writes, all four amend-safety states, both no-git variants, and the typed
client compiling and running without a cast. The proof-of-work log is the most honest I have
audited in this project — its numbers reproduce, its self-corrections are real, and its bug fix
carries a proper pre-fix reproduction. The one defect (FAIL-1) was never exercised by it because
no logged test deleted a document inside the squash window.

<details>
<summary>Round 1 summary text, for the record</summary>

**54 of 55 SERVER-005 criteria pass**, plus all six cross-issue criteria that touch this issue,
including the sprint's centerpiece with no hop stubbed. The hard cases the sprint singled out are
genuinely hard and genuinely pass: the hostile-environment test with a directly-started server,
atomicity under 13 000 concurrent reads, git serialization across ten interleaved parallel writes,
all four amend-safety states, both no-git variants, and the typed client compiling and running
without a cast. The proof-of-work log is the most honest I have audited in this project — its
numbers reproduce, its self-corrections are real, and its bug fix carries a proper pre-fix
reproduction.

**One defect fails the issue.** Deleting a document within 30 seconds of creating it returns 200
but never records the deletion, leaving `git log` describing a document that does not exist and
leaving a staged deletion in the index that contaminates the next commit made by anything — the
server's own force-break audit commit and the user's own manual commits included. It is an
ordinary user flow, it silently corrupts the audit trail SPEC §4 promises, and it escapes the
workspace boundary by dirtying the user's index. The fix needs to handle the "amend would empty
the commit" case (`--allow-empty`, or reset-and-recommit, or simply decline to amend and make a
fresh delete commit — variant 2 shows the non-amending path already works), and the delete path
must never leave staged changes behind when its commit does not happen.

Re-evaluate after the fix: FAIL-1's reproduction steps, plus TEST-31, TEST-36 and TEST-67
(SERVER-009's audit commit must be empty again).

</details>

*All three re-evaluation targets above were met in round 2.*
