# Sprint 005 — Phase 2 Fourth Batch: The Write Path, Locks & Jobs, and the Board's Contract

**Issues**: SERVER-005, SERVER-009, CONTRACT-005
**Domains**: server, contract
**Date**: 2026-07-27
**Plan phase**: Phase 2 — Server Backbone + CLI
**Branch**: `phase-2-server-cli` (agents work in pre-created worktrees cut from it)

---

## What makes this sprint different

Every sprint so far has built a system that can **read** its workspace. Sprint 003 made a
workspace exist; sprint 004 made it alive and queryable. This one crosses the last and largest
threshold of Phase 2: **the server becomes the workspace's writer.**

That is not one more feature. It is the moment three separate architectural claims stop being
prose and become executable:

- **Architecture Decision 2** — "the server is the sole writer" — has until now been true
  only vacuously, because nothing wrote. After SERVER-005 it is a property that can be
  violated, and therefore a property that must be tested.
- **SPEC §4** — "`git log` doubles as the audit trail of who changed what" — requires the
  server to become a git **writer**, with acting-party authorship, structured messages, and
  session-granular squashing. There is no git writer anywhere in `apps/server` today.
- **SPEC §6** — "anchor reconciliation is a mechanical guarantee of the write path, not a
  discipline anyone has to remember" — has an engine (SERVER-002/012/013, four evaluation
  rounds and one revert) that nothing yet calls on a save.

The sprint's centerpiece is the full loop, with no hop stubbed:

```
POST /api/docs                      → file on disk, valid frontmatter, template-prefilled
  → git commit, author = acting party, structured subject + trailers   (SPEC §4)
  → projection updated synchronously, before the response                (SPEC §9.1)
  → one SSE invalidate frame carrying keys and no data                   (SPEC §2 rule 3)
  → GET /api/docs/<id> returns it with no wait                           (read-your-write)
PUT /api/docs/<id> around an anchored range
  → reconcileAnchors runs against the on-disk body                       (SPEC §6)
  → the new anchors map lands in the SAME write and the SAME commit
  → the response reports remapped / orphaned
PUT again, twice, inside the idle window
  → ONE commit, not three — one commit per editing session               (SPEC §4)
```

The other two issues are different in kind:

- **SERVER-009** adds the two coordination mechanisms that make the agent's work safe and
  visible — and it is where this sprint's **security-sensitive** surface lives. The tokenless
  loopback job-log ingest is the only unauthenticated mutating endpoint in the entire contract,
  and SPEC §7 hardens it in four named ways. Its issue file names one of the four. **Read Open
  Conflict 7 before writing a line of it.** SERVER-009 also becomes the second git writer in
  the server (the force-break audit commit) — it must reach git through SERVER-005's module,
  never its own.
- **CONTRACT-005** is additive schema growth whose acceptance criteria are precise but whose
  *illustrative* key list is wrong — it predates SERVER-007's recorded emission. The emitted
  vocabulary is the contract, not the guess. Its second half (DocRow fields) has a consequence
  its issue file does not state: the fields it adds are fields the **already-merged**
  SERVER-011 must populate, or the phase branch stops typechecking. That is Open Conflict 9,
  and it is the one thing the orchestrator must settle before contract-dev starts.

---

## Verification Environment (read this first)

### What counts as the "real application", per issue

| Issue        | The real application in this sprint                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SERVER-005   | A **real server process** on port `8855`, against a **real `corpus init` workspace** which is a **real git repository with real hooks**. Mutations go over **real HTTP** (`curl`, plus at least one round through the **generated typed client**). Effects are read from three independent surfaces every time: the **file on disk** (`cat`, parsed), **`git log` / `git show`** (real git CLI), and the **projection** (`sqlite3 .corpus/cache.db`). Git behaviour — authorship, amend, hook rejection, env inheritance — **cannot be mocked** and no test that mocks it is evidence. |
| SERVER-009   | A **real server process** on port `8875` against a **real `corpus init` workspace**. Locks are read as **real files** under `.corpus/locks/`; job logs as **real `.jsonl` files** under `.corpus/jobs/`. The loopback hardening is proved with **real sockets**: a real non-loopback request (bind the server to a non-loopback interface, or reach it via a real LAN/`ifconfig` address) and a real `Origin:` header on a real request. SSE is observed with **real `curl -N`**. A hardening claim produced by calling a middleware function in a unit test is a unit test, not proof. |
| CONTRACT-005 | The **generated artifacts** (`openapi.json`, `src/client/schema.generated.ts`) and **real `tsc` invocations** — the repo-wide `npm run typecheck` plus scratch probe files that import the published client. A claim about the generated types that was not produced by running `tsc` is not evidence.                                                                                                                                       |
| Integration  | All of the above composed on port `8885`, in one `corpus init` workspace, **zero stubs in the chain**.                                                                                                                                                                                                                                                                                                            |

**Build before verifying.** `@corpus/*` imports resolve through each package's `exports` map
into `dist/`. Each worktree is a separate checkout: run `npm install` (if `node_modules` is
absent) and `npm run build` **inside your own worktree** before any verification step. A probe
that imports another worktree's `dist/`, or a stale one, is not evidence. CONTRACT-005 must
rebuild `packages/contract` after regenerating, or its `tsc` probes test the old types.

### Port allocation

Earlier ranges belong to earlier sprints' evidence; leave them alone so those sprints stay
re-runnable. This sprint takes fresh ranges from `8850`.

| Consumer                                  | Range         | Primary                             |
| ----------------------------------------- | ------------- | ----------------------------------- |
| SERVER-005                                | `8850`–`8859` | `8855`                              |
| SERVER-009                                | `8870`–`8879` | `8875` (2nd, non-loopback bind for TEST-80: `8876`) |
| Sprint-005 integration (TEST-117…TEST-126) | `8880`–`8889` | `8885`                              |
| CONTRACT-005                              | —             | Needs no server and must bind none. |
| Automated tests, every workspace          | —             | `0` (ephemeral). Never hardcode.    |

**Reserved — do not bind:**

- **`8765`** — the documented workspace default and the port the **UI e2e suite** claims. It
  must stay free for the whole sprint. **Both server issue files write `localhost:8765` into
  their E2E steps: those are illustrative, not instructions.** Substitute your assigned port,
  and pass `--port` explicitly to `corpus init` so the default probe never reaches 8765.
- `8770`–`8839`, `8865`, `8965` — sprints 002, 003 and 004. Leave them alone. Note `8865` sits
  inside the otherwise-natural `8860`–`8869` block, which is why SERVER-009 is given `8870+`.
- **`5173`** — held by an unrelated developer process on this machine. Do not assume it is free
  and do not "fix" the Vite config's 5173 default. Playwright/Vite use `CORPUS_UI_PORT=5273`.

### Scratch directories — one prefix per issue

| Issue        | Prefix                                       |
| ------------ | -------------------------------------------- |
| SERVER-005   | `mktemp -d /tmp/corpus-s005-XXXXXX`          |
| SERVER-009   | `mktemp -d /tmp/corpus-s009-XXXXXX`          |
| CONTRACT-005 | `mktemp -d /tmp/corpus-c005-XXXXXX`          |
| Integration  | `mktemp -d /tmp/corpus-sprint005-int-XXXXXX` |

Automated tests use `fs.mkdtemp` with the same prefix. **Never** `rm -rf /tmp/corpus-*` —
delete only paths you created and captured in a variable.

**SERVER-005 has a scratch hazard no previous issue had: it creates git repositories and runs
`git commit` inside them.** Every fixture repo must be created under your own prefix with an
explicit `git init`, and every git invocation must carry an explicit `cwd`. A `git commit` that
runs with the wrong working directory commits **into the Corpus repository itself**. Before
declaring done, run `git status` in your worktree and confirm it shows only the files you
meant to change.

### Process cleanup — pid-targeted only

`pkill -f main.ts`, `pkill -f tsx`, `pkill node`, `killall node` **kill sibling agents' servers**
and are forbidden for the duration of this sprint. Stop what you started, by pid:

```sh
npx tsx apps/server/src/main.ts & SRV=$!   ; kill -TERM "$SRV"
corpus server stop                          # or: kill -TERM "$(jq -r .pid .corpus/server.pid)"
```

SERVER-009 and the integration block spawn **`curl -N` clients that hold sockets open**. Track
their pids the same way (`curl … & CURL=$!`) and kill them by pid — a stray `curl` holding a
stream is what makes "the server would not shut down" look like a bug in someone else's issue.
Before declaring a port free, check it with `lsof -nP -iTCP:<port> -sTCP:LISTEN`.

### Runtime gotchas that will otherwise be misread as bugs

- **`corpus init` seeds a small corpus** (one `template`, three `view`s, two `skill`s, all
  `evergreen: true`) **and makes one initial commit**. Every count assertion below — rows,
  files, and **commits** — is relative to that baseline. State the baseline in your log rather
  than assuming an empty database or an empty history. In particular, "two `PUT`s produce one
  commit" means one commit **beyond** the baseline.
- **`.corpus/` is gitignored** except the queue skeleton. Lock files, job logs, `seen.json`,
  the pidfile and `cache.db` never appear in a commit. This is why SERVER-009's force-break
  audit entry has to be an `--allow-empty` commit: there is no file to stage.
- **`.gitkeep` files live inside `.corpus/queue/<status>/`.** Anything that counts or lists
  queue events counts **`evt_*.json` only**. This has bitten sprints 003 and 004 and it is live
  again for SERVER-009's job listing and reaping.
- **`diff-match-patch`'s `Diff_Timeout` is 1 s.** Every `PUT` that changes a body pays a
  reconciliation cost proportional to the diff. A large-body edit that takes ~1 s is the
  timeout doing its job, not a hang. Measure the latency budget in TEST-53; do not assume it.
- **`better-sqlite3` is a native module.** Its first install in a fresh worktree may rebuild
  against the local Node ABI; do not report that delay as a performance result.
- **Node is v25.2.1 locally; CI pins Node 22.** Global `EventSource` is behind a flag on this
  build — observe SSE with **`curl -N`**, not a Node `EventSource` client. Do not "fix" the
  runtime and do not report the flag as a defect.
- **`curl` line-buffers.** Use `curl -N` and drain the stream; a `curl` whose output you never
  read will look like "no frames arrived".
- **The self-write registry matches on path *plus content digest*, and its TTL is 2000 ms**
  (`SELF_WRITE_TTL_MS`). Registration must happen **before** the bytes hit disk. A write
  registered afterwards loses the race and surfaces as a spurious out-of-band reconciliation —
  which will look like an anchor bug and is not one.
- **`git commit` writes `.git/index` and `.git/`, which are not watched.** But `git checkout`,
  `git stash` and `git reset` are forbidden to domain agents anyway (CLAUDE.md); no test below
  requires any of them.
- **jsdom's `localStorage` quirk** affects `apps/ui` only. No issue in this batch touches
  `apps/ui` or `packages/kit`.

### Deferred verification is recorded, not skipped

Any test below that cannot be executed — because a dependency has not landed at the moment of
verification — is marked `DEFERRED → <issue>` in the E2E Verification Log with the reason and
the substitute evidence supplied. Silent omission is a fail. **Four deferrals are expected and
pre-authorized:**

1. SERVER-005's write-path **423** responses until SERVER-009 merges (`DEFERRED → SERVER-009`).
   SERVER-005 ships the guard seam and a test that the seam is called; SERVER-009 fills it and
   TEST-110…TEST-113 prove it end to end.
2. SERVER-009's **`deferredEventId` re-enqueue** through a product action — nothing in the API
   can set that field (Open Conflict 8). The authorized substitute is a real lock file written
   with the field on disk, then broken over HTTP.
3. SERVER-009's **thread-creation lock exemption** — thread creation is SERVER-006 and is not
   in this batch (`DEFERRED → SERVER-006`). The exemption is recorded as a code comment citing
   §7 and nothing more.
4. CONTRACT-005's **turn-append helper exercised by a real call site** — `POST
   /api/threads/{id}/turns` has no server handler until SERVER-006 (`DEFERRED → SERVER-006`).
   The authorized substitute is the contract package's own mounted-stub test plus `tsc` probes.

---

## Acceptance Tests

### SERVER-005: Doc write paths + git auto-commit

**Scope note.** Read Open Conflicts 1–6 before starting. Four of SERVER-005's design details
contradict the shipped contract, and one AC (the response `warnings`) cannot be satisfied
inside it at all. None of those are the implementing agent's to decide.

#### Create — `POST /api/docs`

TEST-1: A minimal create lands in the inbox with a stamped, valid frontmatter block
Given: A real `corpus init` workspace on 8855 with no document titled "Mortgage options".
When: `POST /api/docs` with `{"type":"note","title":"Mortgage options"}` and no actor header.
Then: **201** with a `Doc` body. `data/docs/inbox/mortgage-options.md` exists on disk; its
frontmatter parses and carries `id` matching `doc_*`, `type: note`, the given `title`,
`created` and `updated` set to the same instant, `tags: []`, `status: open`, `anchors: {}`,
`due: null`, `reviewed: null`, `evergreen: false`. The response's `path` is the workspace-
relative path, and the response body validates against the contract's `DocSchema`.

TEST-2: The default folder is `inbox`, and an explicit folder is honoured in both spellings
Given: The TEST-1 workspace.
When: Three creates run — one with no `folder`, one with `"folder":"finance"`, one with
`"folder":"data/docs/finance"`.
Then: The first lands under `data/docs/inbox/`; the second and third both land under
`data/docs/finance/` (the bare name and the full prefix are the same destination, per
`MoveDocRequestSchema`/`CreateDocRequestSchema`'s shared `FOLDER_DESCRIPTION`). All three are
`201`.

TEST-3: A missing body is pre-filled from the matching template document
Given: A real `data/docs/templates/note.md` with `type: template`, `for: note`, and a
distinctive body sentence.
When: `POST /api/docs` with `{"type":"note","title":"Prefilled"}` — no `body`.
Then: **201**, and `cat` of the new file shows the template's body sentence verbatim. Any
frontmatter key the template defines that the request did not supply is carried over; `id`,
`type`, `created` and `updated` are the server's and are **never** taken from the template.

TEST-4: An explicit body wins over the template, and an absent template is not an error
Given: The TEST-3 workspace, plus no template whose `for` is `view`.
When: (a) `POST` a `note` **with** a `body`; (b) `POST` a `view` with no body.
Then: (a) is `201` and the file holds exactly the supplied body — no template text. (b) is
`201` with an empty body — a missing template is the documented "none → empty" case (§10), not
a `400` and not a `500`.

TEST-5: Template selection is deterministic and self-referential loops are refused
Given: Two `type: template` documents both declaring `for: note`, at paths that sort
differently; plus one archived template for `note`; plus one template declaring
`for: template`.
When: A `note` is created with no body, repeatedly, and separately a `template` is created with
no body.
Then: The `note` picks the **same** template every time — the first by `path` order — and never
picks the archived one. The `template` create does **not** pre-fill from the `for: template`
document; it lands with an empty body. No request hangs or recurses.

TEST-6: Slug collisions dedupe rather than overwrite
Given: `data/docs/inbox/mortgage-options.md` already exists.
When: Two further documents titled "Mortgage options" are created in the same folder.
Then: Three distinct files exist (`mortgage-options.md`, `mortgage-options-2.md`,
`mortgage-options-3.md`), each with a distinct `id`, and the original file's content is
unchanged. `select count(*) from documents where title = 'Mortgage options'` is 3.

TEST-7: Ids are unique against the projection, and pathological titles still produce a filename
Given: A workspace with existing documents.
When: Documents are created with titles that are (a) pure emoji, (b) 400 characters long, (c)
only punctuation, (d) a string of combining diacritics.
Then: Every create is `201`; every resulting filename is non-empty, distinct, within the
filesystem's name limit, and matches the slug rules (`slugifyTitle`'s 60-character cap). No
two documents share an `id`, and every `id` is absent from the projection before its create.

TEST-8: Path traversal in `folder` is refused before anything is written
Given: A running server.
When: `POST /api/docs` is called with `folder` values `"../.."`, `"/etc"`, `"data/docs/../../.."`,
and a symlink inside the workspace pointing outside it.
Then: Each is **400** with `code: "bad_request"` and a **non-empty `issues` array** (the
`ValidationError` variant requires it). Nothing is written anywhere: `git status` in the
workspace is unchanged, and no file exists outside `data/`.

#### Read-one — `GET /api/docs/{id}`

TEST-9: A created document is readable immediately, with no polling
Given: A create that has just returned `201` with id `<id>`.
When: `GET /api/docs/<id>` runs in the very next command, with no sleep.
Then: **200** with the document's frontmatter, body and `anchors` array. This is the
read-your-write guarantee of §9.1 and it must hold without the watcher's involvement.

TEST-10: Read-one resolves anchors and reports orphans
Given: A document carrying two anchors — one whose `exact` occurs in the body, one whose
`exact` does not — and a thread for each.
When: `GET /api/docs/<id>`.
Then: The `anchors` array carries one entry per anchor with `anchorId`, `selector`, `threadId`,
`threadStatus`, a non-null `range` and `orphaned: false` for the resolving one, and a `null`
`range` with `orphaned: true` for the other. The body validates against `DocSchema`.

TEST-11: An unknown or malformed id is 404 / 400, never 500
Given: A running server.
When: `GET /api/docs/doc_zzzzzzzz` (well-formed, absent) and `GET /api/docs/not-an-id`.
Then: The first is **404** `{code:"not_found"}`; the second is **400** `{code:"bad_request"}`
with a non-empty `issues` array. Neither is a 500 and neither leaks a filesystem path.

#### Update, and anchor reconciliation in the same write

TEST-12: A body edit is written, stamped and reported
Given: A projected document with a known `updated` value.
When: `PUT /api/docs/<id>` with a new `body`.
Then: **200** with `{doc, anchors:{remapped, orphaned}}`. The file on disk holds the new body;
`updated` is strictly newer than before; `created` is unchanged; the projection's
`body_excerpt` reflects the new text.

TEST-13: An edit **above** an anchored range remaps it, in the same commit as the body
Given: A document whose frontmatter carries `anc_*` quoting a sentence in the body, with a
thread pointing at it, both committed.
When: `PUT` inserts a paragraph **above** the quoted sentence.
Then: **200**, `anchors.remapped` contains the anchor id and `anchors.orphaned` is empty. The
file's `anchors:` block shows refreshed `prefix`/`suffix` with `exact` unchanged. **One**
commit results, and `git show --stat HEAD` lists that single file — the body change and the
anchors change are in the same commit (§6). A design that writes anchors in a second commit
fails this test.

TEST-14: An edit **inside** the anchored range rewrites `exact`
Given: The TEST-13 document.
When: `PUT` edits words inside the quoted sentence.
Then: **200**, the anchor is `remapped`, and the on-disk `exact` now matches the edited text.
The thread is still attached (`GET /api/docs/<id>` shows a non-null `range`).

TEST-15: Deleting the anchored text orphans the anchor and preserves its selector byte-for-byte
Given: The TEST-13 document.
When: `PUT` removes the paragraph containing the quoted sentence.
Then: **200**, `anchors.orphaned` contains the anchor id and `remapped` does not. The on-disk
selector (`exact`, `prefix`, `suffix`) is **byte-identical** to what it was before the edit —
the adjudicated behaviour (SERVER-002/013): a lost anchor keeps its last selector for history.
The thread file is untouched and still lists in the collection query.

TEST-16: Reconciliation runs against the **on-disk** body, never a client-supplied one
Given: A projected document.
When: The file is modified out of band (`printf >>` appends a paragraph), and then, **before
any watcher-driven reconciliation could have completed**, a `PUT` edits an unrelated part of
the document.
Then: The out-of-band paragraph survives in the resulting file, and the anchors are reconciled
against a body that included it — the response's `remapped`/`orphaned` sets reflect the real
on-disk state. Record the observed before/after content in the log. A lost out-of-band
paragraph fails this test.

TEST-17: A `reviewed`-only patch is not an edit
Given: A document with a known `updated`.
When: `PUT` sets only `reviewed` to the current instant.
Then: **200**; on disk `reviewed` is set and **`updated` is unchanged** (§5 — "still current"
is a committed act distinct from editing). The row's staleness tier recomputes from
`max(updated, reviewed)`, so the document leaves the `stale=` result set it was in.

TEST-18: A no-op `PUT` writes nothing, commits nothing, and still answers 200
Given: A projected document and a recorded `git rev-parse HEAD`.
When: `PUT` with an empty body (`{}`), and separately a `PUT` whose fields reproduce the
current values exactly.
Then: Both are **200** with empty `remapped`/`orphaned`. The file's mtime and content are
unchanged, `git rev-parse HEAD` is unchanged, and no `invalidate` frame is emitted. Autosave
will make this call constantly; a commit per no-op save fails this test.

TEST-19: Concurrent `PUT`s to one document serialize and chain correctly
Given: A projected document with one anchor.
When: Ten `PUT`s, each appending a distinct marker line, are fired in parallel at the same id.
Then: All ten return `200`; the final file parses, contains **all ten** markers, and has
well-formed frontmatter. The anchor is still attached. No `*.tmp` file remains anywhere under
the workspace. The projection row matches the final file.

TEST-20: Every server-generated 400 carries `issues`
Given: A running server.
When: Each rejecting write path is exercised — traversal (TEST-8), a malformed id (TEST-11), an
invalid `status` value, an invalid `due` date, a move to an occupied destination (TEST-23).
Then: Every response body parses as the contract's `ValidationError` — `{code:"bad_request",
message, issues:[{path, message}, …]}` with `issues` **present and non-empty**. A 400 whose
`issues` is absent fails its own contract parse (evaluator, sprint-002).

#### Move

TEST-21: A move changes the path and never the id
Given: A document at `data/docs/inbox/mortgage-options.md` with id `<id>` and a thread whose
`parent` is `<id>`.
When: `POST /api/docs/<id>/move` with `{"folder":"finance"}`.
Then: **200** with the document at `data/docs/finance/mortgage-options.md`. The old path is
gone, the new one exists, `GET /api/docs/<id>` still resolves, the thread's `parent` still names
`<id>` and needs no rewriting, and the projection's `documents.path` is updated with no
duplicate row.

TEST-22: The move commit records both paths
Given: The TEST-21 move.
When: `git log -1 --format='%an|%s%n%b'`.
Then: The subject names the old path and the new path and the id; the author is the acting
party. `git show --stat HEAD` shows a rename (or a delete+add) of exactly that file and nothing
else.

TEST-23: A move to an occupied destination is refused and changes nothing
Given: Two documents that would slug to the same filename, one already in `finance/`.
When: The other is moved to `finance`.
Then: The response is **400** with a non-empty `issues` array naming the destination (see Open
Conflict 4 — `moveDoc` declares no `409`). Both files are still at their original paths,
`git rev-parse HEAD` is unchanged, and nothing was overwritten.

TEST-24: Threads cannot be moved out of `data/threads/`, and traversal is refused
Given: A thread document `th_*`.
When: `POST /api/docs/th_*/move` with `{"folder":"finance"}`; and separately a document move
with `folder` values `"../.."` and `"/etc"`.
Then: Each is **400** with `issues`. Threads stay flat under `data/threads/` (§4). Nothing is
written.

#### Archive and unarchive

TEST-25: Archiving flips status and the document stays indexed
Given: An open document.
When: `POST /api/docs/<id>/archive`, then `GET /api/docs?status=archived`, then
`GET /api/docs` with no `status`.
Then: The archive call is **200** with `status: archived` in the returned `Doc`; the on-disk
frontmatter says `archived`; the `status=archived` query lists it; the default query does
**not** (SPEC §10 — archived drops out of the default result set). Unarchiving reverses all
three observations.

TEST-26: Archiving a `type: skill` document moves its whole folder
Given: A real skill folder `.claude/skills/demo/` containing `SKILL.md` **and at least one
sibling file** (a reference doc and a script), projected as a `type: skill` document.
When: The document is archived.
Then: `.claude/skills-archived/demo/` exists and contains `SKILL.md` **and every sibling**;
`.claude/skills/demo/` no longer exists; `GET /api/docs?type=skill&status=archived` still lists
the document — it is indexed in both states, because the archived root is a projection root.
The commit shows the folder move.

TEST-27: Unarchiving a skill reverses the folder move exactly
Given: The TEST-26 archived skill.
When: `POST /api/docs/<id>/unarchive`.
Then: `.claude/skills/demo/` is back with every file, `.claude/skills-archived/demo/` is gone,
`status` is `open`, and the document is still indexed with the same id.

TEST-28: A skill archive whose destination already exists fails without merging
Given: `.claude/skills/demo/` **and** `.claude/skills-archived/demo/` both present.
When: The skill document is archived.
Then: The call is refused with **400** and a non-empty `issues` array naming the conflicting
destination (Open Conflict 4). **Neither folder is modified** — no partial merge, no file moved,
no file overwritten. This is the destructive-failure case and it must be proved by listing both
folders before and after.

TEST-29: Archiving is idempotent-safe and never deletes
Given: An archived document.
When: It is archived again, then unarchived twice.
Then: No call is a 500; the file exists throughout; `git log --diff-filter=D` shows no deletion
of that path. Archiving is a reversible flip (§7).

#### Delete — user-only

TEST-30: An agent actor cannot delete
Given: A projected document.
When: `DELETE /api/docs/<id>` with header `x-corpus-author: agent`.
Then: **403** with `{code:"forbidden", message}`; the message names the rule ("the agent
archives, never deletes"). The file is **still present**, its projection row is intact, and
`git rev-parse HEAD` is unchanged.

TEST-31: A user actor deletes, and history survives
Given: The same document, and a thread whose `parent` is that document.
When: `DELETE /api/docs/<id>` with `x-corpus-author: user` (or no header — `user` is the
default).
Then: **200** with `{deletedId, orphanedThreadIds:[<threadId>]}`. The file is gone; the
`documents` row is gone; `git log --diff-filter=D -- <path>` shows the deletion **and** the
earlier history of the file is still retrievable with `git show <sha>:<path>`.

TEST-32: Deletion never cascades to threads
Given: The TEST-31 deletion.
When: `GET /api/docs?type=thread` and `sqlite3` on the `threads` table.
Then: The thread row is still present, still names the deleted id as `parent`, and is still
readable. Its anchors no longer resolve. Nothing cascade-deleted it (§9.2).

TEST-33: The default actor is `user`, and it is read from the shipped header
Given: A running server.
When: A delete is sent with **no** actor header; and a create is sent with
`x-corpus-author: agent`; and a create is sent with the **wrong** header name
`X-Corpus-Actor: agent`.
Then: The headerless delete succeeds (default `user`, per `DEFAULT_ACTOR`). The `agent` create
is authored by the agent. The `X-Corpus-Actor` request is treated as **headerless** — i.e. it
is authored by `user`, because that header does not exist in this API (Open Conflict 2). No
request is rejected for carrying an unknown header.

#### Auto-commit, authorship, and the audit trail

TEST-34: Every verb commits, with the acting party as git author
Given: A workspace and a recorded baseline commit count.
When: One create, one edit, one move, one archive, one unarchive and one delete run, each with
a known actor, spaced beyond the squash window.
Then: `git log --format='%an|%ae|%s'` shows one commit per mutation, in order, with
**`%an`** = `Corpus User`/`Corpus Agent` matching each call's actor and a structured subject
naming the verb, the title (or the paths, for a move) and the id. The **committer** is the
process identity, not the actor — `%an` alone is what makes the log a clean audit trail (§4).

TEST-35: The commit body carries machine-readable trailers
Given: The TEST-34 commits.
When: `git log --format='%b'` is read for each.
Then: Each body carries `Corpus-Doc: <id>` and `Corpus-Actor: <user|agent>`; a commit whose
edit remapped or orphaned anchors additionally carries `Corpus-Anchors: remapped=<n>
orphaned=<n>`, and a commit that touched no anchors does not carry that trailer.

TEST-36: The commit stages only the files the mutation touched
Given: A workspace with an unrelated dirty file (`printf >> README.md`) present before the call.
When: A document is edited through the API.
Then: `git show --stat HEAD` lists **only** the document's path. The unrelated dirty file is
still dirty afterwards (`git status` shows it). A `git add -A`–style commit that swallows
unrelated work fails this test.

TEST-37: Git operations serialize; no commit is cross-contaminated
Given: Two different documents.
When: Ten `PUT`s alternating between the two documents are fired in parallel.
Then: Every resulting commit's `git show --stat` lists exactly one document path, and every
commit's `Corpus-Doc` trailer matches the file in its diff. No commit contains both documents'
changes.

TEST-38: The git child process runs with a sanitized environment
Given: A shell in which `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_AUTHOR_NAME`,
`GIT_COMMITTER_EMAIL`, `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` and a
lowercase `git_work_tree` all point at a **second, foreign** git repository — exactly what a
`corpus` command invoked from inside a git hook inherits.
When: The server is started **directly** in that environment (`npx tsx apps/server/src/main.ts`,
not via `corpus server start`, which sanitizes for it) and a document is created and edited.
Then: The commits land in the **workspace's** repository, not the foreign one: the foreign
repo's `git log` is unchanged and its working tree is untouched; the workspace's log shows the
mutations with the actor as author, unaffected by the inherited `GIT_AUTHOR_*`/`GIT_CONFIG_*`
identity. **This must also hold for the existing read path** `readHeadVersion` (`git show
HEAD:<path>`), which today passes no `env` at all. There is a unit test mirroring
`apps/cli/src/git-env.test.ts` asserting the whole `GIT_` namespace is stripped
case-insensitively while `PATH`, `HOME` and non-git variables survive. See Open Conflict 6 for
where the function lives.

#### Squash-on-idle — one commit per editing session

TEST-39: Two rapid saves of one document by one author are one commit
Given: A projected document and a recorded `git rev-parse HEAD`.
When: Two `PUT`s, each changing the body, run ~100 ms apart with the same actor.
Then: `git log --oneline` shows **exactly one** new commit; `git show HEAD` contains **both**
edits; the file on disk holds the second edit's content. This is SPEC §4's "one commit per
editing session, not one per keystroke".

TEST-40: The amend preserves the session's original author timestamp
Given: The TEST-39 amended commit.
When: `git log -1 --format='%aI|%cI'`.
Then: The **author** date is the first save's instant (the session started then); the
**committer** date is the last save's. A session whose author date jumps forward on every
keystroke fails this test.

TEST-41: The window, the author, the document, and interleaving each break the amend
Given: A projected document.
When: Four scenarios run, each from a fresh recorded HEAD — (a) two saves separated by more
than the idle window; (b) two saves within the window but with **different** actors; (c) two
saves within the window to **different documents**; (d) two saves within the window with an
**unrelated commit** made in between.
Then: Each scenario produces **two** commits, not one. SPEC §4 pins all four: "a save by the
other author, to a different document, or after the idle window always starts a fresh commit;
squashing only ever folds into the immediately preceding, matching auto-commit". The idle
window is an exported constant so the value can be read from the code and stated in the log.

TEST-42: The amend never rewrites published or non-linear history
Given: Four repository states: (a) `HEAD` already pushed to a configured upstream / is an
ancestor of an upstream ref; (b) an in-progress merge; (c) an in-progress rebase; (d) a
detached HEAD.
When: A save that would otherwise qualify for an amend runs in each.
Then: In every case a **fresh commit** is created and nothing is rewritten. The fallback is
always safe, and there is no state in which the server rewrites a commit it did not just make.

TEST-43: A create followed immediately by an edit behaves as the adjudication says
Given: A fresh document created through the API.
When: A `PUT` edits it within the idle window, same actor.
Then: The observed behaviour matches Open Conflict 5's adjudication exactly, and the E2E log
states which behaviour was implemented and cites the adjudication. Either answer is defensible;
an unstated answer is not.

#### Hook failure, missing git, and the loud-warning gap

TEST-44: A failing pre-commit hook does not roll back the file
Given: A real executable `.git/hooks/pre-commit` in the workspace repository that `exit 1`s
after printing several lines to stderr.
When: A document is edited through the API.
Then: The response is a **success** (200), not a 500. The file on disk **holds the edit**.
`git status` shows the change as uncommitted. The server's log (stderr / `.corpus/server.log`)
carries a loud entry containing the hook's own output. The projection reflects the change and
an `invalidate` frame is emitted, so the UI still shows it. Removing the hook and repeating the
edit produces a normal commit.

TEST-45: The response surfaces the failure as far as the contract allows
Given: The TEST-44 scenario.
When: The response body is captured and validated against the route's declared response schema.
Then: The body validates. **What it carries about the failure depends on Open Conflict 1** — if
the orchestrator takes the rider, the body carries a `warnings` entry with a `commit_failed`
code and the first lines of the hook output, and this test asserts it. If the orchestrator
defers, this test asserts the body is exactly the declared shape with **no undeclared field**,
and the E2E log records `DEFERRED → <contract issue>` with the log line as substitute evidence
plus an explicit note that SPEC §11's "a warning on the API response" is not yet met. Emitting
an undeclared `warnings` field fails this test under either adjudication.

TEST-46: A workspace that is not a git repository stays fully usable
Given: A workspace directory with `.corpus/config.json` and `data/` but **no `.git/`**; and
separately, a workspace whose `PATH` has no `git`.
When: Create, edit, move, archive and delete all run.
Then: Every mutation succeeds and every file lands on disk; the projection updates; SSE frames
are emitted; no call returns a 500 and no call hangs. The skipped commit is recorded per Open
Conflict 1's adjudication (a `commit_skipped` warning if the rider lands, a log line otherwise).
The server must remain usable without git.

#### The pipeline's invariants

TEST-47: Writes are atomic — no reader ever sees a half-written document
Given: A document with a large body (≥ 1 MB).
When: A `PUT` rewrites it while a tight loop runs `GET /api/docs/<id>` and a second loop `cat`s
the file.
Then: Every `GET` returns either the whole old document or the whole new one; every `cat`
parses as valid frontmatter + body. No `*.tmp` file survives the operation, and none is ever
observed by the reader loop under `data/`.

TEST-48: A failure before the write leaves the workspace untouched
Given: A mutation that fails validation (traversal, occupied move destination, bad id).
When: Each is issued.
Then: `git status` in the workspace is byte-for-byte what it was before, no `*.tmp` file exists,
and the projection is unchanged. Any throw **before** the write leaves nothing behind.

TEST-49: Every mutation re-projects synchronously, before responding
Given: The watcher deliberately made irrelevant — assert this without waiting for it.
When: Each of create, edit, move, archive, unarchive and delete is followed **in the same
command chain, with no sleep** by the matching read (`GET /api/docs/<id>` or `GET /api/docs`)
and a direct `sqlite3` query.
Then: Every read already reflects the change. A single failing case here means the write path
is relying on the watcher, which fails §9.1's read-your-write guarantee.

TEST-50: The write path registers its own writes so the watcher does not double-project
Given: A running server with the watcher attached and a `curl -N` SSE client.
When: One document is created and then edited.
Then: The self-write registry suppresses the watcher's view of both writes: **no out-of-band
anchor reconciliation runs** for them (the log shows none), the projection is written once per
mutation (not twice), and the SSE stream carries the write path's own frames rather than a
duplicate pair. Registration happens **before** the bytes land — a test that stubs the clock or
inspects the registry proves the ordering.

TEST-51: The write path emits its own invalidations, and they carry only keys
Given: A `curl -N` SSE client attached.
When: A create, an edit, a move, an archive and a delete run.
Then: Each produces at least one `invalidate` frame. The keys are drawn from the pinned
vocabulary — `["docs"]` and `["docs", "<id>"]` for every mutation, plus `["tree"]` for the
structural ones (create, move, delete) — and every payload's only field is `keys`. No frame
carries a title, a body, a path or any other datum (§2 rule 3).

TEST-52: The invalidation is broadcast **after** the projection is updated
Given: An SSE client that, on receiving a frame, immediately re-queries `GET /api/docs`.
When: A document is created.
Then: The refetch triggered by the frame already returns the new document. A frame that
arrives before the projection is updated would make the UI refetch stale data; this is the same
ordering contract SERVER-007 established for the watcher.

TEST-53: The write path's latency is measured, not assumed
Given: Three documents: small (1 KB), medium (100 KB), large (1 MB), each with three anchors.
When: Ten `PUT`s are timed against each.
Then: The measured p50/p95 end-to-end latency (including reconciliation, git and re-projection)
is recorded in the E2E log **with the numbers**, along with the observed reconciliation share.
No threshold is asserted here — the number is the deliverable, so SERVER-006 and the UI's
autosave cadence can be designed against a real figure rather than a guess.

TEST-54: `rebuild && doctor` is clean after the whole verb surface
Given: A workspace after every SERVER-005 test above.
When: A projection rebuild runs, then `doctor`, with the server running.
Then: `doctor` reports `ok` with no drift — no `count_mismatch` from the queue `.gitkeep`
files, none from the archived skill folder, none from the deleted document, and none from any
anchor write-back.

TEST-55: The typed client drives the write surface
Given: The generated client from `@corpus/contract/client`.
When: A create, an update, a move, an archive and a delete are issued through it, with the
actor header set through the client's typed parameters.
Then: All five compile under `tsc` and succeed at runtime against the real server, and the
responses narrow to their declared types without a cast. This is the §9.3 claim; a `curl`-only
verification does not test it.

---

### SERVER-009: Document locks + job logs

**Scope note.** Read Open Conflicts 7 and 8 first. Six of this issue's stated behaviours
contradict the shipped contract, and the security hardening it must implement is larger than
the AC it names.

#### Locks — acquire, renew, conflict, expiry

TEST-56: Acquire creates the file and returns 201
Given: A projected document `<docId>` with no lock.
When: `POST /api/locks/<docId>` with `x-corpus-author: agent` and no body.
Then: **201** with a `Lock` body `{docId, holder:"agent", acquired, ttl:300}`.
`.corpus/locks/<docId>.json` exists on disk carrying the same holder, `acquired` and `ttl`. The
default TTL is `DEFAULT_LOCK_TTL_SECONDS` = **300**, matching the contract's documented default.

TEST-57: A bare acquire and a `ttl` acquire both work; TTL is clamped
Given: A document with no lock.
When: (a) a bare `POST` with no body; (b) `{"ttl":30}`; (c) `{"ttl":0}`; (d)
`{"ttl":86400}`.
Then: (a) takes the 300 s default (the body is `required: false` and a bare call is a designed
call). (b) is honoured. (c) is **400** with `issues` — the schema's `.min(1)` rejects it before
any clamp. (d) is accepted and clamped to the documented maximum, with the clamped value
returned in the response and written to the file. State the maximum in the log.

TEST-58: Re-acquiring your own lock renews it rather than conflicting
Given: A lock held by `agent`, acquired at T0.
When: `POST /api/locks/<docId>` runs again as `agent`.
Then: **201** with `acquired` refreshed to the new instant; the file's `acquired` is updated;
there is still exactly one lock file. No 409.

TEST-59: A lock held by the other party is a 409 that names the holder
Given: A live lock held by `agent`.
When: `POST /api/locks/<docId>` runs as `user`.
Then: **409** with `{code:"conflict", message, lock:{docId, holder:"agent", acquired, ttl}}` —
`lock` is **required** on this route's `LockConflictError`, not optional. The existing lock file
is unchanged; the loser did not steal the lease.

TEST-60: An expired lock is treated as absent by acquire, without waiting for a reaper
Given: A lock acquired by `agent` with `ttl=1`, then 2 seconds of real elapsed time.
When: `POST /api/locks/<docId>` runs as `user`.
Then: **201** — the takeover succeeds. Expiry is evaluated **on read**, so a stale lease never
blocks anything even before the reaper runs.

TEST-61: Acquiring a lock on a document that does not exist is a 404
Given: A running server.
When: `POST /api/locks/doc_zzzzzzzz` (well-formed, absent from the projection), and separately
`POST /api/locks/not-an-id`.
Then: The first is **404** `{code:"not_found"}`; the second is **400** with `issues`. Locks are
per-document, never free-form, and no lock file is created for either.

TEST-62: Two concurrent acquires produce exactly one winner
Given: A document with no lock.
When: Two acquires with different holders are fired simultaneously, repeatedly (≥ 20 rounds).
Then: In every round exactly one returns **201** and the other **409**; the lock file's holder
always matches the winner; the file is never corrupt or partially written.

TEST-63: `reap` is a route, not a document id
Given: A running server.
When: `POST /api/locks/reap` is called.
Then: It is handled by the reap route (**200** with `{reaped:[…]}`), **not** matched as
`POST /api/locks/{docId}` with `docId = "reap"`. Assert both that the reap semantics happened
and that no `.corpus/locks/reap.json` was ever created. Route ordering under Hono is the hazard
this test exists for.

#### Release, break, and the audit trail

TEST-64: Only the holder may release
Given: A lock held by `agent`.
When: `DELETE /api/locks/<docId>` runs as `user`.
Then: **403** `{code:"forbidden"}` — **not** 409 (Open Conflict 7). The lock file is still
present and still held by `agent`. Repeating as `agent` returns **200** with
`{docId, released:true, holder:"agent"}` and the file is gone.

TEST-65: Releasing or breaking an absent lock is a 404
Given: A document with no lock file.
When: `DELETE /api/locks/<docId>` and `POST /api/locks/<docId>/break`.
Then: Both are **404** `{code:"not_found"}` — the contract declares 404 on both routes and
declares no 200-for-absent path (Open Conflict 7). Neither creates a file, and the break makes
**no** empty commit.

TEST-66: Break is user-only
Given: A lock held by `user`.
When: `POST /api/locks/<docId>/break` runs with `x-corpus-author: agent`.
Then: **403** `{code:"forbidden"}` and the lock survives. An agent breaking its own contention
would defeat the mechanism, and the contract declares this — the issue file does not, which is
Open Conflict 7.

TEST-67: A user break clears any holder and records the audit entry
Given: A live lock held by `agent`, and a recorded `git rev-parse HEAD`.
When: `POST /api/locks/<docId>/break` runs as `user`.
Then: **200** with `{docId, released:true, holder:"agent"}` — `holder` names who *held* it. The
lock file is gone. `git log -1 --format='%an|%s'` shows a new **empty** commit authored by
`Corpus User` whose subject records the force-break, the document and the previous holder
(`.corpus/` is gitignored, so an `--allow-empty` commit is the only possible audit entry). The
commit is produced by **SERVER-005's git module** — a second git implementation in
`apps/server` fails this test (Integration Point 2).

TEST-68: Breaking a lock carrying a deferred event re-enqueues it
Given: A lock file written on disk carrying a `deferredEventId` naming a real `evt_*` event
currently in `.corpus/queue/in-progress/` (see Open Conflict 8 — nothing in the API can set
this field, so writing the file is the authorized substitute, recorded as such).
When: The lock is broken.
Then: The event file has moved back to `.corpus/queue/pending/`, `GET /api/queue/status` counts
it as pending, and a `["queue"]` invalidation was broadcast. The agent's deferred edit
re-entered the queue rather than being lost (§7).

TEST-69: `deferredEventId` never reaches the wire
Given: The TEST-68 lock file.
When: `GET /api/locks`, the acquire response, and the break response are all captured.
Then: **No response body contains `deferredEventId`.** Every body validates against the
contract's `LockSchema`/`ReleaseLockResult`, which declare four fields and three fields
respectively. The field is a server-internal property of a gitignored runtime file, not
contract surface.

#### TTL reaping, listing, and projection

TEST-70: Reap removes only expired locks and reports which
Given: Three locks — two expired, one live.
When: `POST /api/locks/reap`.
Then: **200** with `{reaped:[<the two expired docIds>]}` — an array of ids, **not** a count
(Open Conflict 7). Exactly those two files are gone; the live lock's file is untouched; a
second reap returns `{reaped:[]}`.

TEST-71: `GET /api/locks` hydrates banners and hides expired leases
Given: Two live locks and one expired lock, none reaped.
When: `GET /api/locks`.
Then: **200** with exactly the two live locks. The expired one is absent from the list even
though its file still exists — expiry is evaluated on read, everywhere.

TEST-72: Lock state is projected, and expired rows are dropped
Given: The TEST-71 state.
When: `sqlite3 .corpus/cache.db "select doc_id, holder, acquired, ttl from locks"`.
Then: Exactly the two live locks have rows, matching their files. After the reap, neither the
files nor the rows for expired locks remain. `rebuild && doctor` is clean.

TEST-73: Every lock transition broadcasts, and the keys are the pinned ones
Given: An attached `curl -N` SSE client.
When: Acquire, renew, release, break and reap each run in turn.
Then: Each produces an `invalidate` frame carrying `["locks"]` and `["locks","<docId>"]`, plus
the document's own key `["docs","<docId>"]` so the banner updates everywhere the document is
visible. Every payload's only field is `keys`.

TEST-74: An out-of-band lock file is caught by the watcher
Given: A running server.
When: A lock file is written directly under `.corpus/locks/` by `printf`, then deleted.
Then: Both changes are projected and both broadcast `["locks"]`-family invalidations — the
watcher covers `.corpus/locks/` as the out-of-band catch-all, and the server's own writes are
suppressed by the self-write registry rather than double-projected.

#### The write-path guard — 423

TEST-75: A write to a document the other party holds is refused with 423
Given: A live lock held by `agent`.
When: `PUT /api/docs/<docId>` runs as `user`.
Then: **423** with `{code:"locked", message, lock:{docId, holder:"agent", acquired, ttl}}` —
note there is **no `expiresAt`** field; the shape is the contract's `LockedError` (Open Conflict
7). The file on disk is unchanged and no commit was made.

TEST-76: The guard covers every write verb, and reads are never blocked
Given: The TEST-75 lock.
When: `PUT`, `POST …/move`, `POST …/archive`, `POST …/unarchive` and `DELETE` all run as
`user`; then `GET /api/docs/<docId>` and `GET /api/docs`.
Then: All five writes are **423**. Both reads are **200** — reading is never blocked by a lock
(§7 scopes locks to editing).

TEST-77: The holder's own writes pass
Given: The TEST-75 lock, held by `agent`.
When: The same five write verbs run as `agent`.
Then: All succeed normally, with the agent as git author. Holding the lock is what the lock is
for.

TEST-78: An expired lock blocks nothing
Given: A lock held by `agent` whose TTL has elapsed, not yet reaped.
When: `PUT /api/docs/<docId>` runs as `user`.
Then: **200**. The write succeeds and the stale lease is not an obstacle — a crashed editor can
never wedge a document (§7).

#### Job log ingest — the hardened, tokenless endpoint

> This block is the sprint's security surface. SPEC §7 names **four** hardening measures;
> SERVER-009's issue file names one. All four are required — see Open Conflict 7.

TEST-79: A loopback request with no token appends
Given: A real `evt_*` event, and a running server.
When: `curl -X POST 127.0.0.1:8875/api/jobs/<evtId>/log -d '{"line":"reading thread"}'` runs
with **no `Authorization` header** from loopback.
Then: **201** with `{eventId, appended:true}`. `.corpus/jobs/<evtId>.jsonl` gains exactly one
line of valid JSON. This is the Claude Code hook path, which holds no token.

TEST-80: A non-loopback request is refused
Given: The server bound so that a genuinely non-loopback peer can reach it (a second bind on
`8876` to a real LAN address, or an equivalent real-socket arrangement — a unit test that hands
the middleware a fake peer address is **not** this test).
When: The same POST is made from that non-loopback address.
Then: **403** `{code:"forbidden"}` and **nothing is appended**. `X-Forwarded-For: 127.0.0.1` on
that request changes nothing — the guard reads the kernel-reported socket address and cannot be
talked out of its answer.

TEST-81: A request carrying a browser `Origin` header is refused
Given: A loopback request that would otherwise succeed.
When: The same POST is repeated with `Origin: http://evil.example` and again with
`Origin: http://127.0.0.1:8875`.
Then: **Both are 403** and nothing is appended. SPEC §7: "requests carrying a browser `Origin`
header are rejected (defeats cross-origin POSTs from web pages to `127.0.0.1`)" — the check is
on the header's **presence**, not on its value, because a same-origin-looking `Origin` is
exactly what an attacker sends. The contract's route description states this, and the issue
file omits it entirely (Open Conflict 7).

TEST-82: Line length is capped, and the cap is visible
Given: A running server.
When: A line of 64 KB is appended.
Then: **201**, and the stored line is truncated to the documented cap with an explicit
truncation marker. `GET /api/jobs/<evtId>/log` returns the truncated line. State the cap in the
log. An empty `line` is **400** with `issues` (the schema's `.min(1)`).

TEST-83: An unknown job id is refused
Given: A running server.
When: The POST targets a well-formed `evt_*` id that names no event anywhere in
`.corpus/queue/`, and separately an id containing `..` or `/`.
Then: The unknown id is **404**; the traversal-shaped ids are **400** with `issues`, rejected
**before any filesystem access** (assert no file or directory was created under
`.corpus/jobs/`). The contract pins the 404 (Open Conflict 7c); note the recommended
"unknown" definition there — resolve against the queue store, not the projection mirror, so a
hook firing before the mirror catches up still succeeds.

TEST-84: The file is capped, and a runaway job cannot fill the disk
Given: A job whose log has reached the documented file-size cap.
When: Further appends are attempted.
Then: They stop growing the file; one final `truncated` line is written; subsequent calls do
not error the server, and the log read still returns cleanly. State the cap in the log.

TEST-85: The ingest route is the only unauthenticated route in `/api/*`, and only for POST
Given: A running server.
When: `POST /api/jobs/<evtId>/log` with no token (loopback); `GET /api/jobs/<evtId>/log` with
no token; `GET /api/jobs` with no token; `POST /api/docs` with no token.
Then: The first is **201**; the other three are **401** with `WWW-Authenticate: Bearer`. The
auth exemption is **method-and-path exact** — widening it to the whole `/api/jobs/{id}/log`
path, or to all of `/api/jobs`, fails this test.

TEST-86: The authenticated CLI path writes through the same endpoint and the same file
Given: A running server.
When: The same append is made **with** the bearer token from loopback.
Then: **201**, and the line lands in the same `.jsonl` file, interleaved correctly with the
tokenless appends. There is one append path, not two.

TEST-87: Concurrent appends never interleave within a line
Given: A running server.
When: 200 appends are fired concurrently from a mix of tokenless and authenticated callers.
Then: Every line in the resulting `.jsonl` parses as a complete JSON object; the file has
exactly 200 data lines (modulo the documented caps); no line is truncated mid-object.

#### Job log reads and live streaming

TEST-88: The log reads back with an incremental cursor
Given: A job with 20 appended lines.
When: `GET /api/jobs/<evtId>/log`, then 5 more lines are appended, then
`GET /api/jobs/<evtId>/log?cursor=<nextCursor>`.
Then: The first returns 20 `{ts, line}` entries with `nextCursor: 20`; the second returns
exactly the 5 new ones with `nextCursor: 25`. The parameter is **`cursor`**, not `since` (Open
Conflict 7). A cursor beyond the file length returns `{lines:[], nextCursor:<count>}`, not an
error. A job that has never logged returns `{lines:[], nextCursor:0}`, not a 404.

TEST-89: The wire shape of a log line is `{ts, line}` and nothing more
Given: A log whose on-disk records carry a `source` discriminator.
When: `GET /api/jobs/<evtId>/log` is captured and validated against `JobLogSchema`.
Then: Every entry has exactly `ts` and `line`. The on-disk `source` field — an internal
property of a gitignored runtime file — does not appear on the wire (Open Conflict 7).

TEST-90: Live log streaming announces, never pushes
Given: An attached `curl -N` SSE client and a job being logged.
When: 50 lines are appended as fast as possible.
Then: The client receives a **small, coalesced** number of `invalidate` frames (single digits,
not 50), each carrying `["jobs"]` and `["jobs","<evtId>"]`. **No frame contains any log text**
at any depth — this is §2 rule 3's regression test, and a frame carrying a log line fails it
even if the line is short. `GET /api/jobs/<evtId>/log` then returns all 50 lines.

TEST-91: The tail updates the projection's `last_line`
Given: A job with appended lines.
When: `sqlite3 .corpus/cache.db "select event_id, status, last_line from jobs"`.
Then: `last_line` matches the most recent appended line. `status` is joined from the **`events`
mirror**, never read from the log file (the pinned SERVER-004 handoff) — verify by changing the
event's queue status without touching the log and observing `status` follow.

#### Jobs listing, retry, abandon

TEST-92: The console listing returns the contract's row shape
Given: Several events in different statuses, some with logs.
When: `GET /api/jobs`.
Then: **200** with `{jobs:[{eventId, status, started, updated, lastLine, originId}, …]}` —
exactly those six fields, most recent first. There is **no** event `type` field and **no**
nested `doc:{id,title,type}` object (Open Conflict 7). `originId` is the document or thread the
event came from, resolved from the payload through the projection, and is `null` when the event
names none. `lastLine` is `null` for a job that never logged.

TEST-93: `recent` defaults to 50 and caps at 200
Given: More than 200 events.
When: `GET /api/jobs` with no parameter; with `recent=1`; with `recent=200`; with `recent=201`;
with `recent=0`.
Then: The bare call returns 50; `1` returns 1; `200` returns 200; **`201` is 400** with
`issues` (the schema's `.max(200)` rejects rather than clamps); `0` is 400. The defaults are
**50/200**, not the issue file's 20/100 (Open Conflict 7).

TEST-94: `.gitkeep` files are never jobs
Given: A freshly initialized workspace whose `.corpus/queue/*/` directories contain `.gitkeep`.
When: `GET /api/jobs` and the `events`/`jobs` tables are read.
Then: No row corresponds to a `.gitkeep`; counts match `evt_*.json` files only; `doctor`
reports no `count_mismatch`.

TEST-95: Retry moves a failed event back to pending and is refused otherwise
Given: One event in `failed/` with an existing log, and one in `pending/`.
When: `POST /api/jobs/<failedId>/retry`, then `POST /api/jobs/<pendingId>/retry`.
Then: The first is **200** with the `Job`, the event file is back in `.corpus/queue/pending/`,
its attempt count is reset, its `.jsonl` is **kept** and gains a "retry requested" line, and a
`["queue"]`/`["jobs"]` invalidation is broadcast. The second is **409**
`{code:"conflict"}` — retry requires `failed`.

TEST-96: Abandon moves the event and deletes nothing
Given: A job with a log file.
When: `POST /api/jobs/<evtId>/abandon`.
Then: **200** with the `Job`. The event file is in `.corpus/queue/abandoned/`. **The `.jsonl`
file still exists** — the contract's route says "Nothing is deleted", and SERVER-008's queue
moves event files rather than deleting them because the file is evidence. See Open Conflict 7f:
this contradicts SERVER-009's AC, and the contract and the queue win.

TEST-97: `POST /api/jobs/{id}/abandon` and `DELETE /api/queue/{id}` agree
Given: Two equivalent events.
When: One is abandoned through each route.
Then: Both end in `.corpus/queue/abandoned/` with identical resulting state, and both broadcast
the queue and jobs keys. There is one transition implementation, reached by two routes.

TEST-98: An out-of-band job file is tailed
Given: A running server.
When: Lines are appended directly to `.corpus/jobs/<evtId>.jsonl` with `printf >>`.
Then: The tail notices, updates `last_line`, and broadcasts `["jobs"]`/`["jobs","<evtId>"]` —
the watcher covers `.corpus/jobs/` and this is its catch-all role.

TEST-99: The whole SERVER-009 surface leaves the projection clean
Given: A workspace after every test above.
When: `rebuild && doctor` runs with the server up.
Then: `doctor` reports `ok` — locks, jobs and events all reconcile against their files with no
drift.

---

### CONTRACT-005: Board contract growth

**Scope note.** Additive only. `ENDPOINT_INVENTORY` is a pinned closed set and
`openapi.test.ts` pins the request-body count at **11** — this issue adds **no routes** and
**no request bodies**. Read Open Conflicts 9–11 before starting.

#### The query-key vocabulary

TEST-100: The published vocabulary is exactly the vocabulary the server emits
Given: SERVER-007's recorded emission, verbatim from its E2E Verification Log, and
`apps/server/src/events/keys.ts`.
When: The contract's published constants/helpers are enumerated.
Then: The set is exactly:

```
["docs"]                   ["docs", "<docId|threadId>"]   ["tree"]
["threads", "<threadId>"]  ["queue"]                      ["jobs"]
["jobs", "<eventId>"]      ["locks"]                      ["locks", "<docId>"]
```

Nine shapes, no more and no fewer. The issue file's illustrative list — `["doc", id]`,
`["thread", id]`, `["job-log", id]`, `["docs", {filter-hash}]` — is **not** the vocabulary; it
predates the emission (Open Conflict 10). Note that `["docs", id]` covers threads too (a thread
is a document) and `["threads", id]` is the thread-specific key; both exist and both are
emitted.

TEST-101: The closed set is pinned by a test that fails when it grows
Given: The published vocabulary.
When: A tenth key shape is added locally.
Then: A contract test fails naming it. The set is closed by assertion, not by convention.

TEST-102: Every published key is a valid `QueryKey`
Given: The published constants and helpers.
When: Each is validated against `QueryKeySchema`, and each helper is called with a
representative id.
Then: All validate — arrays of `string | number | object`, non-empty. A helper that returns a
bare string fails, because `createEventStream` rejects such a frame at runtime.

TEST-103: Each key documents what emits it and what refetches on it
Given: The published module.
When: The generated `openapi.json` and the module's exported doc comments are read.
Then: Every key shape carries a description naming its emitter (which server action produces
it) and its consumer (which query should refetch). This is the whole point of publishing it:
UI-002 must not have to re-derive it.

TEST-104: Consumers can import it without pulling the validation layer
Given: A scratch probe importing only the vocabulary from the contract package.
When: `tsc` compiles it and the import graph is inspected.
Then: It compiles, and the vocabulary is importable from the client-facing surface — the same
constraint that put `ACTOR_HEADER`/`ACTORS` outside `schemas/`. A browser consumer must not have
to bundle Zod to know the key names.

#### `DocRow` — staleness and thread fields

TEST-105: Every row carries a staleness tier
Given: The regenerated `DocRowSchema`.
When: A row is round-tripped through it.
Then: It carries a staleness field whose values come from the existing `STALE_TIERS`
(`aging | stale | very-stale`) plus an explicit representation of `fresh` — the enum's own
comment says "`fresh` is the absence of a tier", so the field is either nullable or the enum
gains `fresh`. Whichever is chosen is documented in the schema description, and the same value
is what `stale=` filters against. `evergreen: true` documents always render as fresh/absent.

TEST-106: Thread rows carry the §10 affordances; non-thread rows carry them as null
Given: The regenerated `DocRowSchema`.
When: A thread row and a note row are each round-tripped.
Then: The thread row carries the thread affordances SPEC §10 renders — agent participation
state, the anchor quote, a last-turn preview, unread/awaiting indicators, and the parent id —
and the note row carries the same keys with `null` values. **Nullable, not optional**
(Open Conflict 9): a row always has the key, and `null` means "not a thread", consistent with
`due`/`reviewed` in `docRowBaseShape`.

TEST-107: Every new field is populatable from the shipped projection
Given: The projection's schema (`documents`, `threads`, `anchors`, `seen`, `turns`).
When: Each new field is traced to its source column.
Then: Each has one — staleness from `updated`/`reviewed`/`evergreen`; agent state, parent,
turn count, last author and last turn from `threads`; the anchor quote from
`anchors.exact_text`; unread from `seen` against the thread's last turn. Any field with no
source is **flagged, not invented** — the AC says so explicitly.

TEST-108: The nullable-timestamp decision is made and written down
Given: `documents.created`/`updated` are legitimately null for hand-written skill files, while
`DocRow` declares both non-nullable and the server currently serializes an epoch sentinel.
When: The decision is applied.
Then: Either the row fields become nullable (and the schema description says the UI renders
"—"), or the sentinel is blessed (and the description says exactly what the sentinel is and why
staleness treats it as fresh). **Silence fails this test.** Recommendation and consequence are
in Open Conflict 11.

#### The turn-append mounting helper

TEST-109: The dual-media turn-append body declares `required: true`
Given: The regenerated `openapi.json`.
When: `POST /api/threads/{id}/turns`'s request body is read.
Then: `required` is **true**, and both media types (`application/json` and
`multipart/form-data`) are still declared.

TEST-110: Both media forms still validate, dispatched by content-type
Given: The contract's own mounted-stub app (the pattern in `routes/index.test.ts`).
When: A JSON turn and a multipart turn are each posted, plus a JSON body missing a required
field and a multipart body missing its required part.
Then: The two valid forms succeed; the two invalid forms are **400** with `issues`. This is the
behaviour `@hono/zod-openapi@1.5.1` breaks when `required: true` registers every media type's
validator unconditionally, and it is what the helper exists to restore.

TEST-111: A bare call no longer compiles
Given: A scratch probe calling `client.api.POST("/api/threads/{id}/turns")` with no body.
When: `tsc` runs on it.
Then: It **fails to compile**, and the pre-fix probe that compiled is recorded in the E2E log
as the before-state. This is the loss CONTRACT-004 escalated, now closed.

TEST-112: The exemption is gone and its guard test is updated honestly
Given: `RULE_EXEMPTIONS` in `openapi.test.ts` and its two consuming tests.
When: The helper lands.
Then: `RULE_EXEMPTIONS` is **empty**; the "keeps every exemption earned" test — which currently
pins `Object.keys(RULE_EXEMPTIONS)` to exactly `["POST /api/threads/{id}/turns"]` — is updated
to assert emptiness rather than deleted; the required-body rule test now covers the route with
no filter; and the "partitions the surface" test's pinned map records `true` for it. Deleting
the guard instead of updating it fails this test.

#### Invariants and artifacts

TEST-113: Every standing contract invariant still holds
Given: The full `openapi.test.ts` suite.
When: It runs against the regenerated document.
Then: All pass — the endpoint inventory is unchanged (no route added or removed); the request
body count is still **11**; `required` is explicit on every body; no request body declares a
server-applied default; every authenticated operation declares `401`; every input-taking
operation declares `400`; no operation declares `500`; every named component stays a plain,
non-nullable, undefaulted object; the actor header is declared on every mutating operation and
appears in no request body.

TEST-114: Regeneration is idempotent and drift-free
Given: A clean tree.
When: `npm run generate -w packages/contract` runs **twice**, then the repo's drift check.
Then: The second run produces a byte-identical `openapi.json` and
`src/client/schema.generated.ts`; `node --import tsx scripts/check-generated-artifacts.ts`
passes; `git diff` on the committed artifacts is empty after regeneration.

TEST-115: Round-trip tests cover every changed schema
Given: `DocRowSchema`, the vocabulary constants, and the turn-append body.
When: The contract package's test suite runs.
Then: Each changed schema has a round-trip test (parse → serialize → parse) and the vocabulary
has its closed-set pin. Coverage does not fall below the gate.

TEST-116: The repo typechecks with the new fields
Given: The regenerated contract, built.
When: `npm run build && npm run typecheck` runs across every workspace.
Then: It passes. **This is where Open Conflict 9 bites**: if `DocRow` gains nullable fields that
`apps/server`'s collection query does not populate, `apps/server` fails to typecheck and the
phase branch is red. The adjudication must be in place before this test is attempted, and this
test is the one that proves it was.

---

### Cross-issue integration

TEST-117: **The centerpiece — a document's whole life, with no hop stubbed**
Given: A real `corpus init` workspace on port 8885, a real daemon, a `curl -N` client on
`/events`, and a real `data/docs/templates/note.md` with `type: template`, `for: note`.
When: This exact sequence runs, with output, commit shas and timings captured:

```sh
WS=$(mktemp -d /tmp/corpus-sprint005-int-XXXXXX); cd "$WS"
corpus init --port 8885 && corpus server start
TOKEN=$(jq -r .token .corpus/config.json)
# … seed data/docs/templates/note.md (type: template, for: note) …
curl -sSN "127.0.0.1:8885/events?token=$TOKEN" > /tmp/sse.$$ & SSE=$!
BASE=$(git rev-parse HEAD)

# 1. create through the API
ID=$(curl -sS -X POST "127.0.0.1:8885/api/docs" -H "Authorization: Bearer $TOKEN" \
     -H 'content-type: application/json' -H 'x-corpus-author: user' \
     -d '{"type":"note","title":"Mortgage options"}' | jq -r .frontmatter.id)
git log -1 --format='%an|%s'          # author + structured subject
cat data/docs/inbox/mortgage-options.md   # template body present
curl -sS "127.0.0.1:8885/api/docs/$ID" -H "Authorization: Bearer $TOKEN" | jq .frontmatter.id

# 2. add an anchor + its thread, commit them, then edit above the quote
# … write the anchors: block and data/threads/<th>.md, commit …
curl -sS -X PUT "127.0.0.1:8885/api/docs/$ID" -H "Authorization: Bearer $TOKEN" \
     -H 'content-type: application/json' -d '{"body":"…paragraph inserted above…"}' | jq .anchors

# 3. two more edits inside the idle window
curl -sS -X PUT … -d '{"body":"…edit A…"}' >/dev/null
curl -sS -X PUT … -d '{"body":"…edit B…"}' >/dev/null
git log --oneline "$BASE"..HEAD
kill -TERM "$SSE"; corpus server stop
```

Then: **Every hop is real and every hop fires.**

1. The create is `201`; `data/docs/inbox/mortgage-options.md` exists with the **template's body**
   and a full stamped frontmatter block.
2. `git log -1 --format='%an|%s'` shows `Corpus User|doc create: Mortgage options (doc_…) by user`
   (or the implemented equivalent subject), and the body carries `Corpus-Doc`/`Corpus-Actor`.
3. An `invalidate` frame carrying `["docs"]`, `["docs","<id>"]` and `["tree"]` — and **only**
   `keys` — arrives on the open stream.
4. `GET /api/docs/<id>` returns the document **immediately**, with no sleep and no watcher
   involvement.
5. The `PUT` reports the anchor in `anchors.remapped`; the file's refreshed `prefix`/`suffix`
   and the new body are in **one** commit (`git show --stat`).
6. The two rapid edits produce **one** further commit whose content holds both, and
   `git log --oneline "$BASE"..HEAD` totals the expected number and no more.
7. `corpus server stop` leaves no process and no pidfile.

**No hop in this chain is stubbed.** This test is what makes SERVER-005 the centerpiece.

TEST-118: The lock refuses the write, and the write path is the thing refused
Given: The TEST-117 workspace and document.
When: `POST /api/locks/<id>` as `agent`, then `PUT /api/docs/<id>` as `user`, then
`GET /api/docs/<id>` as `user`, then `PUT` as `agent`.
Then: The `PUT` as `user` is **423** carrying the holder; the `GET` is **200**; the `PUT` as
`agent` is **200** and commits with `Corpus Agent` as author. The 423 came from SERVER-009's
guard called by SERVER-005's pipeline — one guard, one call site per verb.

TEST-119: A force-break's audit commit and the write path's commits are the same git writer
Given: The TEST-118 lock, still held.
When: `POST /api/locks/<id>/break` as `user`, then a `PUT` as `user`.
Then: The break produces an **empty** commit authored by `Corpus User` recording the break and
the previous holder; the subsequent `PUT` produces a normal document commit. Both used the same
git module, the same env sanitization, and the same identity mapping — grep proves there is
exactly one `execFile`-based git command builder in `apps/server/src/`.

TEST-120: A break re-enqueues the deferred edit, and the queue announces it
Given: A lock carrying a `deferredEventId` for a real in-progress event (per TEST-68's
authorized substitute).
When: The lock is broken while an SSE client is attached.
Then: The event is back in `pending/`, `GET /api/queue/status` counts it, and `["queue"]` and
`["jobs"]` invalidations arrive. The agent's deferred work re-entered the loop.

TEST-121: The write path and the watcher do not both project the same change
Given: A running server with the watcher attached.
When: A document is created and edited through the API, and separately edited out of band with
`sed -i ''`.
Then: The API mutations project **once** each (assert via a counter, a log, or by observing that
no out-of-band reconciliation ran for them); the out-of-band edit projects through the watcher
and **does** run reconciliation against `git show HEAD:<path>`. Both paths call the same
`reconcileAnchors` — a second copy of the reconciliation logic anywhere in `apps/server` fails
this test.

TEST-122: `HEAD` now advances, closing sprint-004's honest degradation
Given: The sprint-004 record that "until SERVER-005 lands, `HEAD` only advances when someone
commits manually, so a second out-of-band edit reconciles against an older `oldBody`".
When: An API edit is made (which commits), and then an out-of-band edit is made.
Then: The watcher's `oldBody` is the API edit's committed version, not an older one — the
out-of-band reconciliation now diffs against the immediately preceding state. Record the
observed `git show HEAD:<path>` content used as `oldBody`.

TEST-123: A job's whole life through the console
Given: The TEST-117 workspace with an `evt_*.json` whose payload names the document.
When: `claim-all`, then a tokenless loopback log append, then
`POST /api/queue/<id>/fail`, then `GET /api/jobs`, then `POST /api/jobs/<id>/retry`.
Then: The listing row shows `status: failed`, the appended `lastLine`, and `originId` resolving
to the document; the retry returns it to `pending/` and keeps the log; every transition
broadcast `["queue"]`/`["jobs"]`; and `?needs=me` surfaces the failed job as `"failed-job"` in
`attention` and clears it after the retry.

TEST-124: The published vocabulary is the emitted vocabulary, proved against the wire
Given: CONTRACT-005 merged and a running server with a `curl -N` client.
When: Every emitting action in this sprint runs in turn — document create/edit/move/archive/
delete, lock acquire/release/break/reap, job log append, queue transition, and an out-of-band
edit — and every frame's keys are collected.
Then: The union of the observed keys is a **subset** of CONTRACT-005's published closed set, and
every published shape was observed at least once. A published shape nothing emits, or an emitted
shape nothing published, fails this test and is exactly the drift §9.3 exists to kill.

TEST-125: `rebuild && doctor` is clean after the whole chain
Given: The integration workspace after every step above.
When: A rebuild runs, then `doctor`, with the server running.
Then: `doctor` reports `ok` with no drift — none from the queue `.gitkeep` files, none from the
archived skill folder, none from the deleted document, none from the lock and job files, none
from the anchor write-backs.

TEST-126: The repo-wide gates stay green
Given: All three issues landed and merged onto the phase branch.
When: `npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`
run from a clean tree, followed by `npm run e2e` with `CORPUS_UI_PORT=5273`.
Then: All pass with no regression against the pre-sprint baseline; combined coverage stays at or
above the 90 % gate; `openapi.json` regenerates with no diff; `docs/cli.md` regenerates with no
diff; the pre-push hook passes end to end. **And `git status` in the repo is clean** — no
fixture git repository, no scratch workspace, and no stray commit made it into the Corpus
repository (see the scratch hazard note above).

---

## Out of Scope

Nothing below belongs to this sprint. An agent building one of these has drifted; an evaluator
failing an issue for lacking one is wrong.

**Doc write paths (SERVER-005)**

- **Every thread write path** — `POST /api/threads`, `POST /api/threads/{id}/turns`,
  `DELETE /api/threads/{id}/turns/{ts}`, resolve/reopen, `POST /api/threads/{id}/seen`,
  `POST /api/capture`. All SERVER-006. SERVER-005 writes **documents**; a thread happens to be a
  document, but nothing in this batch creates one through the API.
- **Anchor entry creation.** Writing a new `anc_*` entry into a parent's frontmatter is what
  thread creation does (SERVER-006). SERVER-005 **reconciles** existing anchors; it never adds
  one.
- **Optimistic concurrency (`baseHash`, the 409-with-current-document path).** No such field
  exists in the contract (Open Conflict 3). Last-write-wins, but always anchor-correct because
  reconciliation runs against the on-disk body.
- **Re-opening the anchor adjudications.** The diff is advisory; in-place-edit evidence outranks
  a verbatim duplicate elsewhere; deleted-claim verification is exact-only plus
  insertion-overlap; fuzzy never runs on deletion-shaped claims; relocation evidence voids a
  rewritten slice; similarity thresholds are permanently off the table. SERVER-005 **consumes**
  the engine and adds nothing to `src/anchors/`.
- **Re-opening the squash semantics.** SHARED-001 landed SPEC §4's revised text and it is
  binding (Open Conflict 5). Amend-within-idle-window is pinned behaviour, not a proposal.
- **`corpus doc create|edit|move|archive|delete`** — CLI-003.
- **`skill rollback`** (§7's targeted git revert) — a later issue; this sprint's git writer
  commits, it does not revert.
- **Attachments** — SERVER-010.

**Locks and jobs (SERVER-009)**

- **The thread-creation lock exemption's proof.** Commenting is not editing and is exempt (§7);
  the exemption is a code comment now and a test when SERVER-006 lands.
- **Any API surface for setting `deferredEventId`.** Nothing in the contract can set it
  (Open Conflict 8). SERVER-009 honours the field; it does not invent a route or a body field
  to write it.
- **The UI's lock banner, force-unlock button, editor-session acquire/release** — UI-011.
- **The console drawer, the job list, the log panel** — UI-004/UI-012.
- **`corpus lock acquire|release|break|reap` and `corpus job log`** — CLI-004.
- **Adding routes or response fields.** `ENDPOINT_INVENTORY` is closed and the response shapes
  are shipped. A needed shape is an escalation, never an untyped extra.
- **Queue transition semantics** — SERVER-008 shipped them. SERVER-009 calls the service; it
  does not reimplement claim, fail, reap or halt.

**Contract growth (CONTRACT-005)**

- **New routes.** The inventory is a pinned closed set.
- **New request bodies or changes to existing request fields.** The body count is pinned at 11
  and the required-body rule is settled (CONTRACT-004's binding adjudication).
- **Editing `apps/server`.** CONTRACT-005 publishes and reports; it does not re-point
  `events/keys.ts` and it does not populate `DocRow` (Open Conflicts 9 and 10 say who does).
- **The UI's SSE bridge and TanStack Query wiring** — UI-002.
- **Board columns, staleness ramp rendering, thread row affordances** — UI-003.
- **Changing the `GET /api/docs` query grammar.** Settled in sprint-004; a parameter change is a
  new contract issue, not a rider.

---

## Integration Points

**1. CONTRACT-005 → SERVER-005 (only if Open Conflict 1's rider is taken).**
CONTRACT-005 would produce a `warnings` array on the document mutation responses; SERVER-005
consumes it to satisfy SPEC §11's "a warning on the API response". **This is the only hard
compile-time dependency between the two domains in this sprint**, and it inverts the merge
order — CONTRACT-005 would have to land first. If the orchestrator defers the warning envelope
instead, the two are independent and can merge in either order.

**2. SERVER-005 → SERVER-009 (one git writer, one lock guard).**
SERVER-005 produces (a) the git module — `execFile`-based, no shell, sanitized environment,
actor-to-identity mapping, the global git mutex — and (b) the `assertWritable(docId, actor)`
seam on every write verb, a no-op until filled. SERVER-009 consumes both: its force-break audit
entry is an `--allow-empty` commit **through SERVER-005's module** (never a second git
implementation, which is the duplication Decision 2 forbids), and it fills the guard with the
423 payload. **Note the issue file's error:** SERVER-005 says the guard is "a seam that
SERVER-006 fills". It is SERVER-009's, and SERVER-009 is in this batch. TEST-119 and
TEST-118 are the joint proofs.

**3. SERVER-005 → SERVER-009 (shared write-path machinery).**
Both write files the watcher observes: SERVER-005 writes documents under `data/` and
`.claude/skills*/`; SERVER-009 writes locks and job logs under `.corpus/`. Both must register
with the **same** `SelfWriteRegistry` instance (`server.selfWrites`, created once in `app.ts`)
**before** the bytes land, and both must invalidate through the **same** bus. Shared types:
`SelfWriteRegistry` from `apps/server/src/watcher/self-writes.ts`, `InvalidationBus` and the key
helpers from `apps/server/src/events/`.

**4. SERVER-005 and SERVER-009 both mount routes into `createServer`.**
The seam is already pinned (sprint-004 Adjudication 3): the projection is opened in
`lifecycle.ts` and handed in as `deps.projection`; `mountDocsRoutes(app, projection, {now})` is
a plain registration inside `createServer`. Both issues need **more** than the projection —
the workspace root, the git module, the self-write registry, the bus. **The extension of
`CreateServerDeps` is one design, made once**: whichever issue merges first lands it, and the
other consumes it. See Open Conflict 12.

**5. Both server issues add files under `apps/server/src/docs/`.**
That directory is not empty — it holds SERVER-011's shipped collection query (`query.ts`,
`tree.ts`, `staleness.ts`, `needs.ts`, `fts.ts`) and, critically, **`routes.ts` already
exists** with `mountDocsRoutes`. SERVER-005's issue file lists `apps/server/src/docs/routes.ts`
as a file to create; it is a file to **extend**. SERVER-009 also touches `src/docs/*.ts` to call
the lock guard. Worktree isolation plus the merge order below is what keeps this from being a
conflict.

**6. CONTRACT-005 → UI-002 / UI-003 (the reason it exists).**
CONTRACT-005 produces the published key vocabulary and the enriched `DocRow`. UI-002 consumes
the vocabulary instead of mirroring it by hand; UI-003 consumes the staleness tier and the
thread affordances. Neither is in this batch, and neither may be pre-empted here.

**7. CONTRACT-005 → the already-merged SERVER-011.**
CONTRACT-005's `DocRow` additions are fields SERVER-011's `queryDocs` must return. SERVER-011 is
**done**; this is a change to shipped code by a different issue. Open Conflict 9 decides who
does it, and TEST-116 is where the decision is proved.

### Merge order (recommendation)

1. **CONTRACT-005 first** — but only if Open Conflict 9 is settled and Open Conflict 1's rider
   is decided, because both change what contract-dev builds. It touches only
   `packages/contract`, and landing it first means every later worktree rebuilds against the
   final types once instead of twice. **Its merge is gated on the `DocRow` population landing
   with it** (TEST-116), so in practice CONTRACT-005 and that server change form one PR-sized
   unit even if they are two issues.
2. **SERVER-005 second.** It owns the git module, the write pipeline, the `CreateServerDeps`
   extension and the guard seam — every piece SERVER-009 builds on. It is also the largest and
   riskiest issue in the phase; it should not be rebased onto a moving target.
3. **SERVER-009 third**, rebased onto SERVER-005: it fills the guard, reaches git through
   SERVER-005's module, and its integration tests (TEST-118…TEST-120) only become executable
   once SERVER-005 is present.

If the orchestrator reverses 2 and 3, then SERVER-009 must land the git module and the guard
seam instead — but exactly one of them does, and it is decided here rather than discovered at
merge.

---

## Open Conflicts — orchestrator decision required before implementation

Twelve disagreements between the issue files, the shipped contract, the codebase and the spec,
in rough order of blast radius. Each carries a recommendation; the orchestrator adjudicates
**before** the domain agents start, and each adjudication is written back into the affected
issue file(s).

**1. SPEC §11 requires a warning on the API response, and the contract has nowhere to put it.**
§11 is unambiguous: when a hook fails during auto-commit, "the failure surfaces loudly — **a
warning on the API response**, a server log entry, and console visibility". SERVER-005 has two
ACs and two edge cases built on it (`commit_failed`, `commit_skipped`). But there is **no
`warnings` field anywhere in `packages/contract`** (grepped: zero hits): `UpdateDocResponse` is
`{doc, anchors}`; create, move, archive and unarchive return a bare `DocSchema`; delete returns
`{deletedId, orphanedThreadIds}`. §9.3 forbids the server serving a shape the contract does not
declare, so implementing the AC literally means emitting an undeclared field.

**Recommendation: take it as a rider on CONTRACT-005.** Add a `Warning` component
(`{code: "commit_failed" | "commit_skipped", detail: string}`) and a `warnings: Warning[]` field
to the five mutation responses — introducing `DocMutationResponse {doc, warnings}` for
create/move/archive/unarchive, adding `warnings` to `UpdateDocResponse` and to
`DeleteDocResult`. This adds **no routes and no request bodies**, so every pinned invariant
(inventory, body count 11) still holds; contract-dev is already in the batch; and it is the only
path that satisfies the spec. The cost is real and must be stated: it makes CONTRACT-005 **hard-
blocking** for SERVER-005 and inverts the merge order.

The coherent alternative is to **defer**: SERVER-005 logs loudly, the mutation stands, the
response stays exactly the declared shape, and the E2E log records `DEFERRED → CONTRACT-006`
with an explicit note that §11's response-warning half is unmet. That keeps the two domains
independent and keeps SERVER-005 — already the largest issue in the phase — from growing a
contract dependency. **It must be decided either way**, because TEST-45 is written from the
adjudication and SERVER-005 cannot invent the field.

**2. The actor header in both server issue files does not exist.**
SERVER-005's design says `X-Corpus-Actor: user|agent`. The shipped header is
**`x-corpus-author`** (`ACTOR_HEADER`), lowercase, optional, `default: "user"`
(`DEFAULT_ACTOR`), declared via `ActorHeaderSchema` on every mutating route and pinned by two
`openapi.test.ts` invariants (present on every mutating op; never a request-body field).

**Recommendation: the contract wins**, trivially. Correct the prose in both issue files. A
request carrying `X-Corpus-Actor` is simply a request with no actor header, i.e. `user`
(TEST-33) — it is not an error, because rejecting unknown headers is not a thing this API does.

**3. `baseHash` optimistic concurrency does not exist in the contract.**
SERVER-005 describes an optional `baseHash` on `PUT` producing a `409` with the current
document in the detail. `UpdateDocRequestSchema` has seven fields and none is `baseHash`; the
route declares no `409`.

**Recommendation: strike it.** Out of scope, not deferred — last-write-wins is the shipped
semantics and it is *still anchor-correct*, because reconciliation runs against the on-disk
body (TEST-16). If the orchestrator wants it, it is a CONTRACT issue filed now and sequenced
before a follow-up server issue, not a server-side extra.

**4. SERVER-005 wants `409` on three paths where the contract declares none.**
The design returns `409` for a move to an occupied destination and for a skill archive whose
destination folder already exists. `moveDoc`, `archiveDoc` and `unarchiveDoc` declare exactly
`200, 400, 401, 404, 423` — **no `409`** — and `openapi.test.ts` has a "routes declare only the
codes they can return" block asserting this class of thing.

**Recommendation: these become `400` with a non-empty `issues` array** naming the destination.
That is honest: the request named a destination that cannot be used, which is a request-level
rejection, and `ValidationError` is exactly the shape for "here is the offending field". No
contract change is needed and no undeclared status code is smuggled past §9.3. If the
orchestrator prefers a true `409`, that is a one-line contract addition per route — file it,
do not improvise it. **TEST-23 and TEST-28 are written from this adjudication.**

**5. SERVER-005's squash section is flagged for a decision that has already been made.**
The issue says "Flagged for SHARED-001: the exact squash semantics … are a spec-level decision
that SHARED-001's revision pins." **SHARED-001 is done** (merged in PR #6), and its E2E log
records the arbitration verbatim: "autosave squash = amend-within-idle-window, pinned
behaviorally in §4". The shipped §4 text pins four of the five sub-questions outright: repeated
saves of the same document by the same author within a short idle window fold into the previous
auto-commit; a save by the other author, to a different document, or after the window starts a
fresh commit; squashing only ever folds into the immediately preceding, matching auto-commit;
and it never rewrites anything published or interleaved.

**Recommendation: treat it as pinned, not open**, and delete the flag from the issue file.
Amend-within-idle-window is implemented exactly as written; TEST-39…TEST-42 are the spec text
turned into tests. Two residuals the spec does **not** settle, both of which the orchestrator
should pin here so the implementing agent does not guess:

- **The window length.** §4 says "a short idle window" and nothing more. The issue's
  `SQUASH_IDLE_MS = 30_000` stands as an exported constant, adjustable without redesign.
  Recommend: keep 30 s, state it in the E2E log.
- **Whether create→edit folds.** The issue's amend conditions match on `Corpus-Doc` +
  `Corpus-Actor` trailers, which a create commit also carries — so as designed, an edit within
  the window would amend the create. Recommend: **allow it.** "Create the document, type into
  it" is one editing session by §4's own framing, the same document and the same author, and
  the fallback is always safe. **TEST-43 asserts whichever answer is given**, and requires it to
  be stated — an unstated answer fails.

**6. `sanitizeGitEnv` lives in `apps/cli`, and `apps/server` may not import it.**
The precedent is real and tested (`apps/cli/src/git-env.ts` strips the whole `GIT_` namespace
case-insensitively; `apps/cli/src/git-env.test.ts` pins it). The dependency direction in
CLAUDE.md forbids `apps/server` importing from `apps/cli`. Meanwhile the server's existing git
call — `readHeadVersion`'s `execFileSync("git", ["show", …])` — passes **no `env` at all** and
inherits whatever `GIT_*` variables the process has. That is a latent bug today (`corpus server
start` sanitizes what it hands the daemon, so it only bites a directly-started server) and a
real one the moment the server starts committing.

**Recommendation: SERVER-005 implements its own in `apps/server/src/git/env.ts`**, with a test
mirroring `apps/cli/src/git-env.test.ts`, and applies it to **every** git child process in
`apps/server` — including retrofitting `watcher/git-head.ts`. Two small duplicated functions
with cross-referencing comments beat a dependency-direction violation or a premature shared
package. **TEST-38 is the proof, and it must be run against a directly-started server**, not one
spawned by `corpus server start`, or it proves nothing. If the orchestrator prefers a shared
home, that is an INFRA issue filed now — not something SERVER-005 invents.

**7. SERVER-009's issue file contradicts the shipped contract in eight places.**

| #   | SERVER-009 says                                             | The contract says                                                                             |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| a   | acquire at `POST /api/locks/:docId/acquire`, returns **200** | `POST /api/locks/{docId}`, returns **201** with `Lock`                                          |
| b   | release by a non-holder → **409**                            | **403** `ForbiddenError` (409 is reserved for *acquire* conflicts; the distinction is deliberate and tested) |
| c   | release/break of an absent lock → **200**, idempotent        | **404** on both routes; break with no lock therefore makes no empty commit                      |
| d   | break is available to anyone                                 | break is **user-only**; `x-corpus-author: agent` → **403**                                      |
| e   | 423 body `{error:"locked", holder, acquired, expiresAt}`     | `{code:"locked", message, lock:{docId, holder, acquired, ttl}}` — no `expiresAt`, no `error`     |
| f   | abandon **deletes** the job's `.jsonl`                       | "Nothing is deleted"; and SERVER-008's queue *moves* event files because the file is evidence   |
| g   | log read cursor is `since`; listing defaults 20/max 100; rows carry `type` and `doc:{id,title,type}` | cursor is **`cursor`**; defaults **50**/max **200**; rows are `{eventId, status, started, updated, lastLine, originId}` |
| h   | log ingest for an unknown event id still creates the file    | unknown id → **404** (stated in the route description, which is itself test-pinned)             |

**Recommendation: the contract wins on all eight** — the same call sprints 002, 003 and 004
made. Two carry consequences worth naming rather than burying:

- **(f) makes AC 13 vacuous.** "A job's `.jsonl` is deleted when its event is reaped, abandoned,
  or pruned" has no trigger left: abandon moves, fail moves, reap-stale moves, and SERVER-008
  deletes no event file anywhere. Recommend **striking the AC** and noting that log-file
  lifecycle follows a future prune verb. Do not invent a prune to satisfy it.
- **(h) can be reconciled honestly.** The issue's rationale — "a hook can fire before the mirror
  catches up" — is a real race. Recommend defining "unknown" as **absent from the queue store**
  (`QueueStore.locate(id)`, which reads the filesystem) rather than absent from the projection's
  `events` mirror. The 404 then fires only for genuinely unknown ids, and the hook race
  resolves correctly. **TEST-83 is written from this.**

**Additionally, SERVER-009's issue file omits three things the contract and SPEC §7 require, and
they are not optional:** `GET /api/locks` (a whole route it never mentions); the **`Origin`
header rejection** on the log ingest (SPEC §7 names it explicitly as one of four hardening
measures, and `localhostOnly` does not implement it — TEST-81); and the fact that the auth
exemption must be **method-and-path exact**, since the auth middleware currently exempts routes
by a hardcoded path check and widening it to `/api/jobs/{id}/log` would expose the **GET** log
read too (TEST-85).

**8. `deferredEventId` has no way in and no place to live on the wire.**
SERVER-009's AC 4 requires that breaking a lock carrying a deferred event id re-enqueues that
event, and the design says "the field is set by whoever defers (the orchestrator, via the
acquire/patch route)". There is no such route and no such field: `AcquireLockRequestSchema` has
exactly `{ttl?}`, `LockSchema` has exactly four fields, and the `locks` projection table has
exactly four columns.

**Recommendation: implement the behaviour, keep the field off the wire, and defer the setter.**
`.corpus/locks/<docId>.json` is a gitignored runtime file, not contract surface — the server may
store `deferredEventId` in it, honour it on break, and never serialize it (TEST-69). Nothing in
this batch sets it; SERVER-006/CLI-004 will need a contract change to do so, filed then. The
E2E proof uses a real lock file written on disk (TEST-68), recorded as
`DEFERRED → SERVER-006/CLI-004`. Adding a field to `LockSchema` now, with no caller, would be
contract surface invented for a test.

**9. CONTRACT-005's `DocRow` growth breaks the phase branch unless someone populates it.**
SERVER-011 is **done and merged**, and its E2E log records both fields as
`DEFERRED → CONTRACT-005`. When `DocRowSchema` gains the staleness tier and the thread
affordances, `apps/server`'s `queryDocs` must return them or `app.openapi(contractRoutes.listDocs,
…)` fails to typecheck and the phase branch goes red (TEST-116). Every needed value is
available — staleness from `updated`/`reviewed`/`evergreen` (already computed in
`docs/staleness.ts`), the thread affordances from `threads`, `anchors.exact_text` and `seen` —
so this is population work, not a projection change. The orchestrator asked whether it is a
rider on SERVER-005's harvest or its own issue.

**Recommendation: neither a silent rider nor a later issue — file SERVER-015 ("populate
`DocRow`'s staleness tier and thread fields") and run it in this sprint**, spawned on server-dev
the moment CONTRACT-005's schema is settled, and merged **with** CONTRACT-005. Reasons:

- It is read-path work in `apps/server/src/docs/query.ts` — the *same directory* SERVER-005 is
  filling with write-path files. Folding it into SERVER-005 buys a merge conflict on the
  sprint's riskiest issue and blurs a clean issue boundary.
- Deferring it past this sprint is not available: the branch must typecheck.
- It is small (one query builder, one row mapper, tests) and independently verifiable.

If the orchestrator would rather avoid a fourth issue, the coherent alternative is to make the
new fields `.optional()` rather than nullable — the branch then typechecks with them absent —
but that contradicts Open Conflict 11's recommendation and hands UI-003 a weaker contract.
**Decide before contract-dev starts**, because it determines whether CONTRACT-005 may merge
alone.

**10. CONTRACT-005's illustrative key list is not the emitted vocabulary, and nothing re-points
the server.**
The AC lists `["docs"]`, `["docs", {filter-hash}]`, `["doc", id]`, `["thread", id]`, `["tree"]`,
`["queue"]`, `["jobs"]`, `["job-log", id]` and says to "derive the actual set from SPEC §10's
refetch surfaces and SERVER-007's emitter". SERVER-007's emitter and its E2E log record a
different set: `["docs"]`, `["docs","<docId|threadId>"]`, `["tree"]`, `["threads","<threadId>"]`,
`["queue"]`, `["jobs"]`, `["jobs","<eventId>"]`, `["locks"]`, `["locks","<docId>"]`. There is no
`["doc", id]`, no `["job-log", id]`, no filter-hash key, and the AC omits both lock keys
entirely.

**Recommendation: the emitted set wins, verbatim, all nine shapes** (TEST-100), and the AC's
list is corrected in the issue file before contract-dev starts. Separately: publishing the
vocabulary does not by itself remove the duplication — `apps/server/src/events/keys.ts` keeps
its own copies, and its header comment already anticipates this ("publishing them as typed
contract surface is a follow-up CONTRACT issue"). **Recommend a one-file rider on SERVER-009**
(which already emits lock and job keys and touches `src/events/`) making `events/keys.ts` a thin
re-export of the contract's constants — no behaviour change, and it is what makes TEST-124's
"published set == emitted set" true by construction rather than by coincidence. The alternative
is to leave both copies and rely on TEST-124 to catch drift; that is weaker but acceptable if
the orchestrator wants SERVER-009's scope frozen.

**11. The nullable-timestamp decision has a consequence the AC does not mention.**
`documents.created`/`updated` are legitimately null for hand-written skill files; `DocRow`
declares both non-nullable; the server currently serializes an epoch sentinel and staleness
treats unknown age as fresh.

**Recommendation: make the row fields nullable and document it.** The sentinel is a lie that
every consumer then has to special-case — the staleness ramp already does — and UI-003 rendering
"—" for "we do not know" is more honest than rendering "1970". The consequence: the epoch
sentinel currently emitted by `apps/server` must be replaced with `null`, which is the **same**
server change as Open Conflict 9 and should land in the same issue. If the orchestrator blesses
the sentinel instead, the schema description must say precisely what it is and why staleness
treats it as fresh, and the server keeps emitting it. **TEST-108 fails on silence, not on
either choice.**

**12. Two server issues need to extend `CreateServerDeps`, and neither issue file says so.**
`createServer` is a pure function of its config, receiving the projection as a dep
(`deps.projection`) per sprint-004 Adjudication 3. SERVER-005's handlers need the workspace
root, the git module, the self-write registry and the invalidation bus at request time;
SERVER-009's need the workspace root, the lock store, the job store and the same bus. The bus
and the registry are already created inside `createServer` (`app.ts:206–217`) and exposed on the
`CorpusServer` handle; the workspace root is on `config`. So the shape of the extension is not
obvious, and two agents will otherwise invent two.

**Recommendation: pin it before either agent starts, and pin it as "no new deps".** Everything
both issues need is already reachable — `config.workspaceRoot`, the locally-created `bus` and
`selfWrites`, and `deps.projection` — so the write paths mount exactly like
`mountDocsRoutes(app, projection, {now})` does today, taking what they need as explicit
parameters from inside `createServer`. The git module is constructed there too (it is a pure
function of the workspace root, and `createServer` "reads no environment and touches no
filesystem" is about *opening handles*, not about constructing a command builder). **SERVER-005
lands whatever wiring change is required** (per the merge order) and SERVER-009 consumes it. If
the orchestrator reverses the merge order, SERVER-009 lands it instead — but exactly one of them
does.

---

## Done Criteria

This sprint is complete when:

- **Every acceptance test above PASSES in the evaluator's verdict**, with deferrals recorded as
  `DEFERRED → <issue>` plus their substitute evidence — never silently omitted.
- Each issue's **E2E Verification Log** carries concrete evidence: real commands, real output,
  real ports from its assigned range, real scratch paths from its own prefix, and the model it
  ran on. SERVER-005 additionally records the **measured write-path latency figures** (TEST-53),
  the **squash window constant** and the **create→edit adjudication** (TEST-43); SERVER-009
  records the **line cap, the file cap and the TTL maximum** as implemented; CONTRACT-005 records
  its **pre-fix compiling bare-call probe** (TEST-111).
- The twelve adjudications the orchestrator makes here (Open Conflicts 1–12) are **written back
  into the affected issue files** before implementation starts, and any conflict resolved as
  "the contract wins" that the orchestrator wants changed has a **CONTRACT issue filed**, not a
  server-side deviation. In particular: Open Conflict 1 must be decided before contract-dev
  starts; Open Conflict 9 must be decided before CONTRACT-005 can merge; Open Conflict 5's two
  residuals must be pinned before server-dev starts.
- **The security surface is proved with real sockets.** TEST-80 and TEST-81 are executed against
  a real non-loopback peer and a real `Origin` header, not against a middleware function in a
  unit test. SERVER-009 qualifies for `/audit` on this basis alone.
- **There is exactly one git writer and one anchor engine in `apps/server`.** Grep proves it
  (TEST-119, TEST-121).
- `/test` passes with no regressions; combined coverage stays at or above the 90 % gate.
- `/lint` passes (ESLint, Prettier, `tsc --noEmit`) across every workspace.
- `openapi.json` and the generated client regenerate with **no diff**; the drift check is green
  twice in a row.
- TEST-126's repo-wide gate run is green from a clean tree, including `npm run e2e` with
  `CORPUS_UI_PORT=5273`, **and `git status` in the Corpus repository is clean** — no fixture
  repo, no scratch workspace, no stray commit.
- No stray process and no stray port: every server and every `curl -N` started during
  verification was stopped **by pid**, and `lsof` confirms the assigned ranges are free.
