# Sprint 007 — Phase 2 Final Batch: Bytes, the Stewardship Surface, and Two Loose Ends

**Issues**: SERVER-010, CLI-003, SERVER-018
**Domains**: server, cli
**Date**: 2026-07-27
**Plan phase**: Phase 2 — Server Backbone + CLI (closing batch)
**Branch**: `phase-2-server-cli` (agents work in pre-created worktrees cut from it)

---

## What makes this sprint different

Sprint 006 closed the agent's **control** loop: a comment produces an event, the parked
binary wakes, claims, logs and completes. What it could not do was let the agent *change
anything*. `apps/cli` has **zero** document or thread verbs today — the whole
`doc create|edit|move|archive|delete` and `thread reply|resolve|reopen` surface that SPEC
§7's stewardship section is written against does not exist as a command. AGENT-003 (the
comment skill) is blocked on exactly this and on nothing else.

So this sprint ships the two things that make Phase 2's thesis complete rather than
merely demonstrated:

- **CLI-003 is the agent's hands.** After it merges, `corpus thread reply <id> --from agent`
  — the literal command SPEC §7's comment skill is written in — runs. Every stewardship
  sentence in §7 ("creates, edits, moves, and archives documents on its own initiative")
  becomes a command that exists, or it stays prose for another phase.
- **SERVER-010 is the one place bytes enter the system.** Every other mutation in Corpus is
  text the server parses, validates and commits. Attachments are the exception: opaque
  bytes, named by an untrusted client, written under a path derived from that name, and
  later served back over HTTP. It is the only issue in the whole plan where a filename is a
  security boundary.

And two loose ends the sprint-006 evaluator flagged as "minor, not failures" — SERVER-018 —
which are in this batch because Phase 2 should not hand Phase 3 a known-wrong SSE key or a
console row that cannot label itself.

Three things make this batch riskier than its size suggests, and all three are
**adjudications, not code**:

1. **Four of CLI-003's eleven acceptance criteria have no server endpoint.**
   `corpus doc check` needs a validation route; `corpus skill rollback` needs a targeted-revert
   route. Neither exists in `packages/contract` (grepped: zero hits). The `.githooks/pre-commit`
   edit CLI-003's file list asks for would run **in the Corpus tool repository**, which is not
   a Corpus workspace. **Open Conflicts 1, 2, 3.**
2. **SERVER-018's stated premise is false.** Its Technical Design says "`originTitle` is
   already nullable in the schema; this populates it." `JobSchema` has `eventId`, `status`,
   `started`, `updated`, `lastLine`, `originId` — and nothing else. The field does not exist
   anywhere in the repository. **Open Conflict 6.** And thread deletion appears to already
   emit `["tree"]`. **Open Conflict 7.**
3. **The CLI's actor default is `agent` today and CLI-003 specifies `user`.**
   `apps/cli/src/client.ts` hardcodes `actor: "agent"` for every request every shipped verb
   makes. Changing it is a behaviour change to CLI-004, which passed last sprint.
   **Open Conflict 4.**

Read Open Conflicts 1–13 before writing a line of any issue. **Conflict 13 is a defect this
contract found on its own**: `docs/archive.ts` emits no `["tree"]` although archived
documents are excluded from every folder count — the exact bug SERVER-018 was filed for, on
a path nobody had looked at.

---

## Verification Environment (read this first)

### What counts as the "real application", per issue

| Issue          | The real application in this sprint |
| -------------- | ----------------------------------- |
| **SERVER-010** | A **real server process** on port `8975`, against a **real `corpus init` workspace** which is a **real git repository**. Uploads are **real multipart** bodies over **real HTTP** — `curl -F "files=@<real file on disk>"` and at least one round through the generated client's `uploadTurn`/`uploadCapture` helpers. Effects are read from five independent surfaces: the **bytes on disk** (`ls -R`, `cmp` against the source file), the **thread markdown** (`cat`, the reference lines), **`git status`/`git show --stat`** (real git CLI), the **projection** (`sqlite3 .corpus/cache.db`), and the **served response** (`curl -sD-`, headers *and* body). A traversal criterion verified only by a unit test is **not** verified. |
| **CLI-003**    | The **real `corpus` binary** run from a **real workspace** whose server was started by `corpus server start`, on port `8985`. `npm run dev -w apps/cli` is acceptable for iteration; the E2E log must show at least one full pass through the **built** bin. **The from-source entry point is `apps/cli/src/bin/corpus.ts`** — `node --import tsx apps/cli/src/bin/corpus.ts <args>`. `apps/cli/src/index.ts` is the library barrel and running it does nothing; never `npx`. Every mutating verb's effect is read from **three** surfaces: the **file on disk**, **`git log --format='%an <%ae> %s'`**, and the **server** (`GET /api/docs/:id`). Unit tests may use a scripted `node:http` stub; **a stub is never E2E evidence for an attribution, exit-code-on-a-real-server, or filesystem-hygiene claim.** |
| **SERVER-018** | A **real server process** on port `8992` with a **real `curl -N /events`** subscriber attached across the whole sequence, and `GET /api/tree` / `GET /api/jobs` read over real HTTP before and after each mutation. |
| **Integration**| All three composed on port `8997`, in one `corpus init` workspace, **zero stubs in the chain**, driven end to end through the real binary and real HTTP. See "Cross-Issue Tests". |

**Build before verifying.** `@corpus/*` imports resolve through each package's `exports` map
into `dist/`. Each worktree is a separate checkout: run `npm install` (if `node_modules` is
absent) and `npm run build` **inside your own worktree** before any verification step.
CLI-003 must rebuild after every registry change, or the built bin serves the old command
surface and `docs/cli.md` drifts silently.

### Port allocation

Earlier ranges belong to earlier sprints' evidence; leave them alone so those sprints stay
re-runnable. This sprint takes fresh ranges from `8970`.

| Consumer                              | Range         | Primary                          |
| ------------------------------------- | ------------- | -------------------------------- |
| SERVER-010                            | `8970`–`8979` | `8975`                           |
| CLI-003                               | `8980`–`8989` | `8985` (stub servers: ephemeral `0`) |
| SERVER-018                            | `8990`–`8994` | `8992`                           |
| Sprint-007 integration (TEST-139…152) | `8995`–`8999` | `8997`                           |
| Automated tests, every workspace      | —             | `0` (ephemeral). Never hardcode. |

**Reserved — do not bind:**

- **`8765`** — the documented workspace default and the port the **UI e2e suite** claims. It
  must stay free for the whole sprint. **SERVER-010's issue file writes `localhost:8765`
  into its E2E steps: that is illustrative, not an instruction.** Substitute your assigned
  port and pass `--port` explicitly to `corpus init` so the default probe never reaches 8765.
- `8770`–`8899` — sprints 002–005. `8900`–`8935` — sprint 006 and its evaluator.
  `8950` — SERVER-017's E2E log. `8965` — sprint 004. Leave all of them alone.
- **`5173`** — held by an unrelated developer process on this machine. Playwright/Vite use
  `CORPUS_UI_PORT=5273`.

### Scratch directories — one prefix per issue

| Issue       | Prefix                                       |
| ----------- | -------------------------------------------- |
| SERVER-010  | `mktemp -d /tmp/corpus-s010-XXXXXX`          |
| CLI-003     | `mktemp -d /tmp/corpus-c003-XXXXXX`          |
| SERVER-018  | `mktemp -d /tmp/corpus-s018-XXXXXX`          |
| Integration | `mktemp -d /tmp/corpus-sprint007-int-XXXXXX` |

Automated tests use `fs.mkdtemp` with the same prefix. **Never** `rm -rf /tmp/corpus-*` —
delete only paths you created and captured in a variable.

**SERVER-010 has a scratch hazard the others do not.** Its traversal tests deliberately
construct paths that point *outside* the attachments root, and one of them plants a
**symlink**. Every such fixture is created under your own prefix; the target of a traversal
probe is a file **you created** (e.g. `$SCRATCH/outside/secret.txt`), never `/etc/passwd`
on the real machine. Assert the probe returns 404 **and** that your own bait file's contents
never appear in any response body.

**CLI-003 inherits SERVER-005's git hazard**: it drives `git commit` indirectly through the
server, and its read-only-git assertions shell out to `git`. Every git invocation carries an
explicit `cwd`. A `git` command that runs with the wrong working directory operates on **the
Corpus repository itself**. Before declaring done, run `git status` in your worktree and
confirm it shows only files you meant to change.

### Process cleanup — pid-targeted only

`pkill -f main.ts`, `pkill -f tsx`, `pkill node`, `killall node` **kill sibling agents'
servers** and are forbidden for the duration of this sprint. Stop what you started, by pid:

```sh
npx tsx apps/server/src/main.ts & SRV=$!   ; kill -TERM "$SRV"
corpus server stop                          # or: kill -TERM "$(jq -r .pid .corpus/server.pid)"
```

Before declaring a port free, check it with `lsof -nP -iTCP:<port> -sTCP:LISTEN`. `curl -N`
SSE clients are backgrounded with their pid captured and killed by pid.

### Runtime gotchas that will otherwise be misread as bugs

Every fact below was read out of the shipped tree while writing this contract. They are
stated so nobody spends an afternoon rediscovering one.

**Attachments and the contract**

- **The multipart turn field is `text`, not `body`.** `MultipartAppendTurnRequestSchema` is
  `{text?: string(min 1), requestsAgent, files}`; the JSON form is `{body: string(min 1),
  requestsAgent}`. A `curl -F "body=…"` on the multipart branch sends a field the schema does
  not read. `isMultipartTurn()` discriminates on the presence of `files`.
- **`POST /api/threads` is `application/json` only.** SERVER-010's AC 2 ("`POST /api/threads`
  accepts the same multipart form") is **not** satisfiable without a contract change.
  **Open Conflict 5.**
- **`POST /api/capture` already declares multipart** with a `files` part, and
  `CaptureRequestSchema.text` is `min(1)` and **mandatory** — an attachment-only capture is
  impossible by contract, and that is not a bug to fix here.
- **The refusal seams are already in place and named.** `apps/server/src/threads/turns.ts`
  and `apps/server/src/capture/capture.ts` both hold the constant "attachments are not
  accepted yet: ingest and serving land in SERVER-010" and a `400` carrying it. SERVER-010's
  job is to **remove** those, not to route around them. Two shipped tests assert the message
  contains `SERVER-010` and must be replaced, not deleted-and-forgotten.
- **`/attachments/*` is already mounted behind auth**: `app.ts` has
  `app.use("/attachments/*", headerAuth)`, and today an authenticated request to it answers
  `404` (there is no handler). So **401-before-anything is already true** and the handler
  never sees a tokenless request. `RESERVED_PREFIXES` is `["/api", "/attachments", "/events"]`
  — the static-UI fallback does not shadow the route.
- **`AttachmentPathSchema` is `z.string().min(1)` and nothing more.** It does **not** reject
  `..`, separators, or control characters. The contract explicitly says servers mount this as
  a **wildcard**. Every byte of path defence is SERVER-010's, in the handler.
- **The declared responses on `getAttachment` are `200 / 400 / 401 / 404`.** There is no
  `403` and no `413` declared on it — but `413` *is* needed on the two upload routes, which
  declare `400 / 401 / 404` only. **Open Conflict 5b**: decide whether an over-cap upload is
  the declared `400` or an undeclared `413`, and state it.
- **`.corpus/*` is already gitignored** (`assets/workspace/gitignore`), with `!.corpus/queue/`
  re-including the queue skeleton. Attachment bytes are ignored the moment they are written —
  **no gitignore change is needed**, and adding one is drift.

**SSE, the tree and jobs**

- **The query-key vocabulary is closed at nine shapes** (`packages/contract/src/query-keys.ts`),
  pinned by `query-keys.test.ts`. A tenth shape fails a test. SERVER-018 adds **no** key names.
- **`GET /api/tree` counts threads in their _parent's_ folder** (`apps/server/src/docs/tree.ts`):
  threads are flat in `data/threads/` and are not tree *nodes*, but a parented thread moves its
  parent folder's badge, and a **standalone** thread (`parent: null`) contributes nothing.
  Archived documents are excluded. This is why `threads/create.ts` pushes `TREE_KEY` **only when
  `parentId !== null`** — and it is the invariant SERVER-018 must be written against.
- **`docs/delete.ts` already pushes `TREE_KEY` unconditionally**, and the last-turn cascade
  reaches it through `deleteDocumentLocked`. The middle-turn deletion branch in `cascade.ts`
  deletes no thread and correctly emits no tree key. **Open Conflict 7.**
- **`JobSchema` has no `originTitle`.** Six fields: `eventId, status, started, updated,
  lastLine, originId`. **Open Conflict 6.**

**The CLI**

- **Exit codes are already documented** in `docs/cli.md`: `0` success · `1` internal · `2`
  usage · `3` not a workspace / bad config · `4` server unreachable · `5` server returned an
  error · `6` a check-style command reported a failure. CLI-003 introduces **no new codes**.
- **Registered topics today**: `health`, `init`, `job`, `lock`, `queue`, `server`. There is no
  `doc`, `thread`, `skill` or `db` topic. `corpus lock acquire|release` and `corpus job list`
  **did** ship in CLI-004 despite sprint-006's out-of-scope note — do not re-implement them.
- **`apps/cli/src/client.ts` hardcodes `actor: "agent"`** with a comment citing SPEC §2.2.
  `lock break` overrides it per call because the endpoint is user-only. **Open Conflict 4.**
- **`--timeout` is a global flag** (`registry/globals.ts`, default `10000`) and
  `registry/validate.ts` rejects any command flag that shadows a global, **at module load**.
  `corpus db rebuild` therefore cannot register its own `--timeout`; it uses the
  `client.untimedApi` seam `queue idle` already uses. **Open Conflict 11.**
- **`corpus init --port <n>`** pins the port; without it, init probes upward from 8765. Config
  lands at `.corpus/config.json`, mode 600, holding the port and bearer token; the token is
  never printed.
- **`out.emit()` writes only under `--json` and may be called exactly once** — a second call
  throws `InternalError` ("--json guarantees exactly one"); `out.line()` is suppressed under
  `--json`; `out.write()` always reaches stdout. Under `--json`, **failures go to stderr** as
  one line of `{"error":{"code","message","details"?}}` — stdout stays empty. In human mode a
  failure is `corpus: <message>` plus an indented hint.
- **`corpus queue idle`'s window flag is `--wait`, not `--timeout`** (sprint-006 Open Conflict
  8's resolution). `db rebuild` follows the same pattern: no local timeout flag.
- **The validator already exists in-process.** `apps/server/src/core/check.ts` exports
  `checkCorpus(documents, options) → {errors, warnings}` over `CheckDocument = {path, ok:
  true, document} | {path, ok: false, error}` — the staged `(path, content)` pair is
  *already* its input type via `toCheckDocument(path, raw)`. Thirteen `CHECK_CODES` are
  defined. It is wired into the write path and exposed over **no** HTTP route. See Open
  Conflict 1: the missing piece is a route and a handler, not a validator.

**SSE, for SERVER-018's observation**

- **`GET /events` authenticates by `?token=<bearer>` query parameter**, not by header —
  `EventSource` cannot set headers, and `app.ts` mounts `allowQueryToken: true` on `/events`
  **only**. Every other route is header-only.
- **Frame format**: `:connected\n\n` on attach; `:hb\n\n` every 25 s (an SSE comment,
  invisible to `EventSource` but visible to `curl -N` — do not report heartbeats as stray
  frames); data frames are `event: invalidate\ndata: {"keys":[[…],[…]]}\n\n`. `invalidate` is
  the only event name and `keys` the only payload field. Keys are deduped per frame,
  first-seen order preserved.

**Error envelopes the criteria name**

- `400` → `{code: "bad_request", message, issues: [{path, message}]}` ·
  `423` → `{code: "locked", message, lock: {docId, holder, acquired, ttl}}` · plus
  unauthorized / forbidden / not-found / conflict / internal.

**Shapes the criteria below name**

- `POST /api/docs` → `{doc, warnings}` · `PUT /api/docs/{id}` → `{doc, anchors: {remapped[],
  orphaned[]}, warnings}` · move/archive/unarchive → `{doc, warnings}` ·
  `DELETE /api/docs/{id}` → `{deletedId, orphanedThreadIds[], warnings}`.
- `POST /api/threads/{id}/turns` → `{thread, turn: {author, ts, body}, eventId, warnings}`.
- `POST /api/db/rebuild` → `{path, documents, threads, turns, anchors, links, events, jobs,
  locks, seen, durationMs, skipped[]}` · `GET /api/db/doctor` → `{ok, drift[], stats}` where
  `ok` is true **exactly** when `drift` is empty.

**General**

- **`corpus init` seeds a small corpus and makes one initial commit**: one `template` (`note`),
  three `view`s (`inbox`, `open-threads`, `attention`), two `skill`s (`comment`, `orchestrate`),
  zero `agent-def`s, all `evergreen: true`. State this baseline in your log rather than
  assuming an empty database.
- **`.gitkeep` files live inside `.corpus/queue/<status>/`.** Anything counting queue events
  counts **`evt_*.json` only**. This has bitten sprints 003–006.
- **`SQUASH_IDLE_MS = 30_000`**, matched on `Corpus-Doc` + `Corpus-Actor` trailers. Two writes
  to the same document by the same actor inside 30 s fold into one commit. Several assertions
  below say "exactly one new commit" *because of* this and several say "two" *despite* it —
  read which is which.
- **Node is v25.2.1 locally; CI pins Node 22.** Observe SSE with **`curl -N`**, not a Node
  `EventSource` client, and drain the stream.
- **`better-sqlite3` is a native module.** A first-install rebuild delay in a fresh worktree is
  not a performance result.

### Deferred verification is recorded, not skipped

Any criterion below that cannot be executed — because an adjudication struck it, or a
dependency has not landed at the moment of verification — is marked `DEFERRED → <issue>` or
`STRUCK → Open Conflict N` in the E2E Verification Log, with the reason and the substitute
evidence supplied. **Silent omission is a fail.**

---

## Acceptance Tests

### SERVER-010: Attachments — ingest and serving

Ports `8970`–`8979`. Every assertion names the surface it was read from. This is the
sprint's security-sensitive issue: the traversal and header criteria (TEST-31…TEST-44) are
**not** satisfiable by unit tests alone — each needs a real request against a real server.

#### Ingest on turn append

```
TEST-1: A turn carrying two files stores both and references both
  Given: A `corpus init` workspace, a thread T with one turn, a clean `git status`, and two
         real files on disk: a real PNG and a real PDF
  When:  POST /api/threads/<T>/turns as `multipart/form-data` with `text=see attached`,
         `files=@shot.png`, `files=@notes.pdf`
  Then:  201 with the `{thread, turn, eventId, warnings}` shape; both files exist under
         `.corpus/attachments/<T>/<turn.ts>/`; `cmp` against both sources is silent; the turn
         body in `data/threads/<T>.md` is the text followed by exactly two reference lines

TEST-2: The reference block's shape is exactly as §6 and the issue specify
  Given: TEST-1's turn
  When:  The turn body is read from the file
  Then:  The text body, then ONE blank line, then one reference per line in UPLOAD order:
         `![shot.png](attachments/<T>/<ts>/shot.png)` for the image and
         `[notes.pdf](attachments/<T>/<ts>/notes.pdf)` for the PDF. The exact byte string of
         both lines is quoted in the E2E log — UI-008 resolves it and cannot guess

TEST-3: Image-ness is decided by the sanitized extension, never by the client's MIME type
  Given: A real PNG uploaded with `type=application/octet-stream`, and a real PDF uploaded
         with `type=image/png`
  When:  Both are attached to one turn
  Then:  The `.png` renders as `![…]` and the `.pdf` as `[…]` — the client's declared MIME
         type changed nothing. The extension set that counts as an image
         (`png,jpg,jpeg,gif,webp,avif,svg`) is stated in the log

TEST-4: An attachment-only turn is accepted
  Given: Thread T
  When:  POST a multipart turn with `files=@shot.png` and NO `text` part
  Then:  201; the turn body is exactly the one reference line (no leading blank line, no
         empty paragraph); the file is on disk; one commit

TEST-5: A turn with neither text nor files stays a 400
  Given: Thread T
  When:  POST a multipart turn with no `text` and no `files`
  Then:  400 with a non-empty `issues` array; no attachment directory created; no commit

TEST-6: The SERVER-010 refusal is gone from both routes
  Given: The shipped `400` constants in `threads/turns.ts` and `capture/capture.ts`
  When:  A `files`-bearing request reaches either route
  Then:  It succeeds. No response body anywhere in the server still contains the string
         "SERVER-010"; the two shipped tests asserting that message are REPLACED by tests of
         the new behaviour, not deleted

TEST-7: JSON turns are byte-for-byte unchanged
  Given: Thread T
  When:  POST `application/json` `{body: "plain"}`
  Then:  201; the turn body is exactly "plain" with no reference block and no trailing blank
         line; NO `.corpus/attachments/<T>/` directory is created at all

TEST-8: A fileless multipart turn is unchanged
  Given: Thread T
  When:  POST multipart with `text=plain` and zero `files` parts
  Then:  Identical outcome to TEST-7 — the empty-array default does not create a directory

TEST-9: The directory is named with the turn ts verbatim
  Given: TEST-1's turn, whose ts is `2026-…T…:…:…Z`
  When:  `ls .corpus/attachments/<T>/`
  Then:  The directory name is the ts string **including its colons**, byte-identical to the
         `turn.ts` in the response. The log states this and cites the code comment that
         forbids "fixing" it

TEST-10: A zero-byte file is a legitimate attachment
  Given: An empty file on disk
  When:  It is attached to a turn
  Then:  201; a zero-byte file exists at the expected path; the turn body references it

TEST-11: A file part with no filename is rejected
  Given: A multipart body whose `files` part carries no `filename` parameter
  Then:  400 (or 422 — state which); nothing written; no directory left behind

TEST-12: `requestsAgent` behaves identically on the multipart branch
  Given: An engaged thread T and a resolved thread R
  When:  Attachment-bearing turns are posted with `requestsAgent` true, false and omitted
  Then:  The `eventId` matrix is IDENTICAL to the JSON branch's shipped behaviour
         (sprint-006 TEST-35…43) — attachments changed the body, not the participation rules

TEST-13: Two turns in one thread get separate directories
  Given: Thread T
  When:  Two attachment-bearing turns are appended
  Then:  Two sibling directories under `.corpus/attachments/<T>/`, named by their own ts; no
         file from one appears in the other
```

#### Ingest on capture

```
TEST-14: A capture with a file lands the bytes on its filing thread's first turn
  Given: A `corpus init` workspace
  When:  POST /api/capture multipart with `text=screenshot of the error` and `files=@shot.png`
  Then:  201 `{docId, threadId, eventId, warnings}`; bytes are under
         `.corpus/attachments/<threadId>/<first turn ts>/shot.png`; the FILING THREAD's first
         turn carries the reference; the inbox DOCUMENT's body carries the text and NO
         reference (the attachment belongs to the conversation, not the document) — or state
         the opposite if that is what ships, and justify it against §6

TEST-15: A capture without `text` is still a 400
  Given: The contract's `text: min(1)`, mandatory
  When:  POST /api/capture with only `files=@shot.png`
  Then:  400 — an attachment-only capture is impossible by contract and SERVER-010 does not
         change that

TEST-16: A capture with a file still enqueues exactly one event
  Given: TEST-14's capture
  Then:  Exactly one `evt_*.json` in `pending/`; its payload names the filing thread; the
         attachment changed nothing about the queue
```

#### Filename sanitization and collisions

```
TEST-17: The sanitization table, verified as a table
  Given: A single turn carrying files named, one per row:
         `../../etc/passwd` · `a/b/c.png` · `  .hidden` · `.....` · a 300-character name
         with a `.png` extension · a name containing a NUL and a `\x07` · a name in NFD
         Unicode (`e` + combining acute) · `` (empty string, if the parser permits one)
  When:  The turn is posted
  Then:  Every stored name is quoted in the E2E log beside its input. Required properties,
         each asserted: NO stored name contains `/`, `\`, NUL or a control character; NO
         stored name is `.` or `..`; NO stored name begins with `.`; every stored name is
         ≤ 100 characters; the NFD name is stored in NFC; every unusable name became `file`
         (collision-suffixed); and `ls .corpus/attachments/` shows the files ONLY under the
         expected turn directory — nothing was created anywhere else on the filesystem

TEST-18: Truncation preserves the extension
  Given: A 300-character stem with a `.png` extension
  Then:  The stored name is ≤ 100 characters AND still ends `.png`; the reference renders as
         an image (TEST-3's rule still applies after truncation)

TEST-19: Collisions inside one turn get numeric suffixes
  Given: Three files all named `shot.png` in ONE request
  Then:  `shot.png`, `shot-2.png`, `shot-3.png` on disk; the turn body carries three DISTINCT
         references matching the three stored names, in upload order; all three files' bytes
         are their own (`cmp` each against its source)

TEST-20: Collisions against the fallback name behave the same
  Given: Two files whose names both sanitize to `file`
  Then:  `file` and `file-2`

TEST-21: Two turns may hold identically named files without colliding
  Given: `shot.png` uploaded in two separate turns of the same thread
  Then:  Both are stored as `shot.png` under their own ts directories; neither is suffixed

TEST-22: The stored name, the committed reference and the served URL are the same file
  Given: Every file from TEST-17 and TEST-19
  When:  Each reference is extracted from the committed markdown and requested verbatim
         against `/attachments/`
  Then:  Every one returns 200 with bytes matching its source. A reference that does not
         resolve is a fail — a committed link must never dangle

TEST-23: A filename needing URL encoding round-trips
  Given: Files named `my shot.png`, `a#b.png`, `q?x.png` and a non-ASCII name
  When:  They are attached, and the resulting reference is requested
  Then:  The reference's exact byte string is quoted in the log; requesting it returns the
         right bytes. Whether the markdown target percent-encodes each segment (Open
         Conflict 12) is stated, and the answer holds for the turn-ts colons too
```

#### Serving — content types, headers, auth

```
TEST-24: Content types come from the extension map
  Given: Attachments with extensions png, jpg, gif, webp, avif, pdf, txt, md, and `.wat`
  When:  Each is requested with a valid bearer token
  Then:  200 with `Content-Type` `image/png`, `image/jpeg`, `image/gif`, `image/webp`,
         `image/avif`, `application/pdf`, `text/plain`, `text/markdown`, and
         `application/octet-stream` for the unknown one. The full map is quoted in the log

TEST-25: SVG is served as a download, never inline
  Given: A `.svg` attachment containing a `<script>` element
  When:  It is requested
  Then:  200 with `Content-Type: image/svg+xml` AND `Content-Disposition: attachment` —
         the inline-script vector is closed by the disposition, not by rewriting the file

TEST-26: Disposition follows image-ness
  Given: A png and a pdf
  Then:  The png is `Content-Disposition: inline`; the pdf is
         `attachment; filename="notes.pdf"` with the filename quoted and any `"` or newline
         in the name escaped or stripped — a filename can never break out of the header

TEST-27: `X-Content-Type-Options: nosniff` on every response
  Given: A 200, a 404 and a rejected traversal
  Then:  All three carry the header

TEST-28: Content-Length and the bytes agree
  Given: A 3 MB binary attachment
  Then:  `Content-Length` equals the file size on disk and the downloaded body is
         byte-identical (`cmp` silent). A truncated or re-encoded body is a fail

TEST-29: Caching headers are as designed
  Then:  `Cache-Control: private, max-age=31536000, immutable` on a 200

TEST-30: Auth is enforced before anything else
  Given: A valid attachment path
  When:  It is requested with (a) no Authorization header, (b) a wrong bearer token
  Then:  401 both times, with NO bytes and no indication of whether the path exists

TEST-31: A missing file is a clean 404
  Given: A well-formed path naming a file that does not exist
  Then:  404; the body contains no filesystem path, no stack trace and no `errno`
```

#### Serving — path traversal (the security block)

Every probe in this block targets a **bait file you created under your own scratch prefix**,
never a real system file. Each asserts BOTH the status AND that the bait's contents are
absent from the response body.

```
TEST-32: Raw dot-dot traversal
  When:  GET /attachments/../../../<scratch>/outside/secret.txt
  Then:  404; the bait's contents do not appear in the body

TEST-33: Single-encoded traversal
  When:  GET /attachments/%2e%2e%2f%2e%2e%2fsecret.txt and the `..%2f` mixed form
  Then:  404 both

TEST-34: Double-encoded traversal
  When:  GET /attachments/%252e%252e%252fsecret.txt
  Then:  404 — decoding happens EXACTLY once; a second decode pass would open the hole

TEST-35: Backslash and mixed separators
  When:  GET /attachments/..\..\secret.txt and /attachments/..%5c..%5csecret.txt
  Then:  404 both

TEST-36: Absolute-path injection
  When:  GET /attachments//etc/hosts and GET /attachments/%2fetc%2fhosts
  Then:  404 both

TEST-37: NUL and control bytes in the path
  When:  GET /attachments/<th>/<ts>/shot.png%00.txt and a `%0a`-bearing path
  Then:  404 (or 400 — state which); nothing is served and no header is injected

TEST-38: A symlink inside the attachments root pointing outside it does not escape
  Given: `ln -s $SCRATCH/outside/secret.txt .corpus/attachments/<th>/<ts>/link.txt`
         (planted by hand — this is a defence test, not a supported feature)
  When:  GET the link's path
  Then:  404, and the bait's contents are absent. The log states whether the defence is a
         realpath check or an O_NOFOLLOW open

TEST-39: Legitimate names containing dots still serve
  Given: Attachments named `..hidden.png` (after sanitization), `a..b.png`, `v1.2.3.tar`
  Then:  200 with the right bytes — the defence rejects path SEGMENTS equal to `.`/`..`,
         not names that merely contain dots. A false positive here breaks real uploads

TEST-40: No existence oracle
  Given: (a) a traversal probe, (b) a well-formed path to a missing file, (c) a path under a
         thread directory that does not exist, (d) a path with too few segments
  Then:  ALL FOUR return 404 with the SAME body and the same headers. Different statuses or
         different messages would let a caller map the filesystem

TEST-41: Paths that resolve back inside the root are still rejected when malformed
  When:  GET /attachments/<th>/<ts>/../../<th2>/<ts2>/other.png
  Then:  404 — even though the target exists and is inside the root. Segment validation runs
         before resolution; a "harmless" traversal is still a traversal

TEST-42: Case sensitivity is decided, not accidental
  Given: `shot.png` on a case-insensitive macOS filesystem
  When:  GET /attachments/<th>/<ts>/SHOT.PNG
  Then:  The answer (200 or 404) is stated and pinned by a test, with the reasoning. An
         undecided answer that differs between macOS and CI Linux is a fail

TEST-43: The wildcard route does not shadow, and is not shadowed by, the UI fallback
  Given: `RESERVED_PREFIXES = ["/api", "/attachments", "/events"]`
  When:  GET /attachments (no trailing path) and GET /attachmentsx
  Then:  The first is a 400/404 from the attachment route (state which); the second is NOT
         handled by it

TEST-44: Serving mutates nothing
  Given: A `curl -N /events` subscriber and a clean `git status`
  When:  Twenty attachments are served, including several 404s
  Then:  ZERO SSE frames; zero commits; the projection is unchanged; no file's mtime changed
```

#### Limits

```
TEST-45: An over-cap single file is refused with nothing left behind
  Given: The configured per-file cap (named in the log; the issue's default is 25 MB)
  When:  A file one byte over the cap is uploaded
  Then:  The refusal status (Open Conflict 5b) with a message naming the cap and the file;
         NO attachment directory exists for that turn; the thread markdown is unchanged;
         `git log` shows no new commit

TEST-46: An over-cap request total is refused the same way
  Given: The configured per-request cap (the issue's default is 100 MB)
  When:  Several individually legal files exceeding the total are uploaded
  Then:  Same as TEST-45 — refused, nothing on disk, no commit

TEST-47: The caps are configurable
  When:  The server is restarted with a small per-file cap set through the server config
  Then:  A file that succeeded before now fails, and the message names the NEW value —
         proving the cap is read from config and not a hardcoded constant

TEST-48: The refusal happens before the bytes are read where the request declares its size
  Given: A request whose declared `Content-Length` exceeds the request cap
  Then:  Refused without streaming the whole body (state how this was observed — e.g. time,
         or bytes read). If the implementation cannot refuse early, say so explicitly rather
         than implying it does
```

#### Git hygiene — bytes never enter history

```
TEST-49: The working tree stays clean after an upload
  Given: A clean `git status --porcelain` before
  When:  Three attachment-bearing turns are posted
  Then:  `git status --porcelain` is EMPTY afterwards — no untracked, no modified, nothing
         under `.corpus/` staged. The gitignore was NOT edited to achieve this

TEST-50: The commit for an attachment turn touches only markdown
  When:  `git show --stat HEAD` for TEST-1's commit
  Then:  Exactly one path (the thread markdown), or two for a creation that also wrote the
         parent's frontmatter. No path under `.corpus/`

TEST-51: The bytes are provably absent from history
  Given: A text attachment whose contents are the unique string
         `CORPUS-ATTACHMENT-CANARY-<random>`
  When:  `git log -p --all` and `git rev-list --objects --all | git cat-file --batch` are
         grepped for the canary
  Then:  ZERO matches. The reference line matches; the bytes do not

TEST-52: Squashing behaves as before
  Given: Two attachment turns on the same thread by the same actor within 30 s
  Then:  ONE commit (SQUASH_IDLE_MS), and both turns' references are in it — attachments did
         not fork a second git writer
```

#### Atomicity and the deletion cascade

```
TEST-53: A failed markdown write takes the attachment directory with it
  Given: Fault injection making the thread-markdown write fail AFTER the files land
  Then:  5xx; `.corpus/attachments/<T>/<ts>/` does NOT exist; no commit; the thread file is
         byte-identical to before. A committed reference must never dangle, and orphan bytes
         are the second-worst outcome

TEST-54: A failed file write leaves no partial directory
  Given: Fault injection failing the second of three file writes
  Then:  The request fails; the turn directory is absent entirely (not partially populated);
         no commit; the thread file unchanged

TEST-55: Deleting a middle turn removes only its attachments
  Given: A thread with three attachment-bearing turns
  When:  DELETE /api/threads/<T>/turns/<ts of turn 2> as `user`
  Then:  200; `.corpus/attachments/<T>/<ts2>/` is gone; turns 1 and 3 directories and files
         are INTACT (`cmp` still silent); the deleted turn's reference line left the markdown
         with the turn

TEST-56: Deleting a thread removes its whole attachment tree
  Given: The thread from TEST-55
  When:  DELETE /api/docs/<T> as `user`
  Then:  200; `.corpus/attachments/<T>/` does not exist; sibling threads' attachment
         directories are untouched

TEST-57: The last-turn cascade cleans up too
  Given: A thread whose ONLY turn carries an attachment
  When:  That turn is deleted
  Then:  The thread is deleted (cascade, §6), the parent's anchor entry is removed, AND
         `.corpus/attachments/<T>/` is gone — one path, all three effects

TEST-58: Cleanup follows the commit, and a thread with no attachments deletes cleanly
  Given: (a) a thread with no attachments at all; (b) a deletion whose commit fails (hook
         rejection, §14)
  Then:  (a) deletion succeeds with no error and no attempt to remove a missing directory;
         (b) per §14 the file mutation stands and the failure surfaces as a warning — state
         whether the bytes were removed and justify it. Losing bytes for a turn that FAILED
         to delete is the outcome the design forbids
```

---

### CLI-003: Doc, thread and db verbs — the agent's hands

Port `8985`. Every mutating criterion is verified on three surfaces: the file on disk,
`git log --format='%an <%ae> %s'`, and the server's own read endpoint.

**Scope note.** `corpus doc check` and `corpus skill rollback` are subject to Open Conflicts
1 and 3 (no server endpoint exists). TEST-107…TEST-112 apply **only** if the orchestrator
files and lands the riders; otherwise they are marked `STRUCK → Open Conflict 1/3` in the log
and the issue's ACs 5 and 8 are struck, not silently skipped.

#### The command surface itself

```
TEST-59: The new topics are registered and self-documenting
  When:  `corpus --help`, `corpus doc --help`, `corpus doc create --help` (and the same three
         levels for `thread` and `db`) are run against the BUILT bin
  Then:  Every level renders from the registry; each verb shows a summary, a description for
         EVERY flag it accepts, and at least one runnable example. A flag with no description
         is a fail

TEST-60: `docs/cli.md` regenerates with no diff
  When:  The doc generator is run twice in a row from a clean tree
  Then:  No diff either time; the committed `docs/cli.md` contains `corpus doc`,
         `corpus thread` and `corpus db` sections with their verbs in the Contents index

TEST-61: The drift check blocks a stale doc
  When:  A flag description is changed in the registry and `docs/cli.md` is NOT regenerated
  Then:  `npx tsx scripts/check-generated-artifacts.ts` FAILS naming the regeneration command

TEST-62: Unknown verbs produce a usage error, not a stack trace
  When:  `corpus doc frobnicate x` and `corpus thred reply x`
  Then:  Exit 2, a message listing valid alternatives, nothing on stdout under `--json`

TEST-63: `--json` emits exactly one JSON value per command
  When:  Every verb in this issue is run with `--json` and piped through `jq .`
  Then:  Each parses; each produced exactly ONE top-level value; no human-readable line
         leaked onto stdout alongside it

TEST-64: Human output is one line
  When:  Each mutating verb succeeds without `--json`
  Then:  Exactly one line on stdout naming the affected id and the effect; structured data
         appears only under `--json`
```

#### `--from` attribution

```
TEST-65: The default actor is what the adjudication says, and it is applied uniformly
  Given: Open Conflict 4's adjudication
  When:  `corpus doc create --type note --title X` with no `--from` and no CORPUS_FROM
  Then:  The commit author is the adjudicated default, verified with
         `git log -1 --format='%an <%ae>'`. The E2E log states the adjudication it was
         written from

TEST-66: `--from` overrides the default
  When:  The same create with `--from agent`
  Then:  `git log -1` shows `agent <agent@corpus.local>`; with `--from user`, `user <…>`

TEST-67: `CORPUS_FROM` is honoured and `--from` beats it
  When:  `CORPUS_FROM=agent corpus doc create …` and
         `CORPUS_FROM=agent corpus doc create … --from user`
  Then:  Authors are `agent` and `user` respectively — flag > env > default, stated in help

TEST-68: An invalid actor is a usage error before any request
  When:  `corpus doc create … --from robot` and `CORPUS_FROM=robot corpus doc create …`
  Then:  Exit 2 with a message naming the valid values; a stub server records ZERO requests
         (the CLI never sends `x-corpus-author: robot` and lets the server 400 it)

TEST-69: Every mutating verb in this issue accepts `--from`
  When:  Each of doc create|edit|move|archive|delete and thread reply|resolve|reopen is run
         with `--from agent` and with `--from user`
  Then:  Each produces a commit with that author. A verb that accepts the flag and ignores it
         is a fail — assert the author, not the exit code

TEST-70: CLI-004's shipped verbs still behave after the actor change
  Given: A real workspace with a `user`-held lock
  When:  `corpus lock break <doc>`, `corpus lock acquire`, `corpus lock release`,
         `corpus queue claim-all`, `corpus job log`, `corpus queue complete` are exercised
  Then:  All behave as CLI-004's evaluation recorded — in particular `lock break` still
         succeeds and its break still appears in the audit trail as a `user`-authored commit.
         A regression here is a sprint failure even though CLI-004 is `done`

TEST-71: Read-only verbs are unaffected
  When:  `corpus health`, `corpus queue status`, `corpus lock list`, `corpus job list`
  Then:  Unchanged output and exit codes; the actor plumbing did not leak into reads
```

#### `corpus doc create`

```
TEST-72: A minimal create writes a real document
  When:  `corpus doc create --type note --title "Mortgage options"`
  Then:  Exit 0; one line printing the new `doc_*` id; the file exists under `data/docs/`
         with valid frontmatter (`id`, `type: note`, `title`, `created`, `updated`,
         `status: open`, `tags: []`); `GET /api/docs/<id>` returns it; ONE commit

TEST-73: Every documented flag reaches the server
  When:  `corpus doc create --type note --title T --folder finance --tags finance,housing
         --due 2026-09-01 --from user`
  Then:  The file lands at `data/docs/finance/…`; frontmatter carries both tags and the due
         date; `--tags a,b` split on commas is documented in the help

TEST-74: The body comes from `--file`
  Given: A file containing a known multi-line markdown body
  When:  `corpus doc create --type note --title T --file <path>`
  Then:  The document body is byte-identical to the file's contents (trailing-newline
         handling stated); the CLI READ the file and wrote nothing

TEST-75: The body comes from a heredoc on stdin
  When:  `corpus doc create --type note --title T <<'EOF' … EOF`
  Then:  Same body on disk. This is the agent's normal invocation form and must work with a
         body containing backticks, a fenced code block, and a `~~~form` block passed through
         BYTE-FOR-BYTE with no CLI-side markdown processing

TEST-76: Omitting both body sources is legal
  Given: The seeded `note` template document
  When:  `corpus doc create --type note --title T` with stdin closed
  Then:  Exit 0; the body is the template's pre-fill (state what the server did); the CLI did
         not block waiting on stdin

TEST-77: Body-source precedence is documented and enforced
  Given: `--message`/`-m`, `--file` and piped stdin supplied together
  Then:  `--message` wins, then `--file`, then stdin — the same helper used by `doc edit` and
         `thread reply`, asserted once per verb

TEST-78: A TTY stdin is never read as a body
  When:  A create with no body source runs with stdin attached to a TTY
  Then:  It does not hang; TEST-76's behaviour

TEST-79: `--json` returns the created document object
  When:  `corpus doc create … --json`
  Then:  One JSON value whose shape matches the contract's `{doc, warnings}` (or the doc
         alone — state which and keep it consistent across verbs)

TEST-80: A non-existent folder surfaces the server's answer verbatim
  When:  `corpus doc create --type note --title T --folder does/not/exist`
  Then:  Whatever the server does (create-on-demand or a typed problem) is what the user
         sees; the CLI did NOT pre-validate. The observed behaviour is recorded — it is the
         first written statement of it (Open Conflict 8)
```

#### `corpus doc edit`

```
TEST-81: A body replacement lands and commits
  Given: An existing document
  When:  `corpus doc edit <id> --from agent <<'EOF' … EOF`
  Then:  The file's body is the new text; frontmatter `updated` advanced; `git log -1` author
         is `agent`; `GET /api/docs/<id>` agrees

TEST-82: A frontmatter-only edit sends no body
  When:  `corpus doc edit <id> --title "New title"` with stdin closed
  Then:  The title changed on disk; the BODY is byte-identical to before; the stub-server test
         confirms no `body` key was sent (an empty-string body would wipe the document)

TEST-83: The frontmatter flags all work
  When:  `--add-tag`, `--remove-tag` (repeatable), `--status`, `--due`, `--reviewed`,
         `--evergreen true|false` are exercised
  Then:  Each is reflected in the file and in `GET /api/docs/<id>`; `--reviewed` sets
         `reviewed` to an instant (SPEC §5's "still current"), not to `true`

TEST-84: Anchor reconciliation is reported
  Given: A document with two anchored threads, one anchor's text edited around and the
         other's text deleted
  When:  `corpus doc edit <id>` replaces the body
  Then:  The human line reports the counts, e.g. `edited <id> — 1 anchor remapped,
         1 orphaned (th_…)`; the numbers match `GET /api/docs/<id>`'s anchor states

TEST-85: `--json` passes the response through untouched
  When:  The same edit with `--json`
  Then:  The emitted value contains `anchors.remapped` and `anchors.orphaned` exactly as the
         server sent them — no reshaping, so the agent can act on it

TEST-86: A lock conflict is rendered, not retried
  Given: Document D locked by `user`
  When:  `corpus doc edit <D> --from agent`
  Then:  Exit 5 with a message naming the HOLDER ("document is locked by user — the edit was
         not applied"); the file is unchanged; the CLI issued exactly ONE request (no blind
         retry loop). The 423 is not rendered as a crash or as exit 1

TEST-87: An unknown id is a clean failure
  When:  `corpus doc edit doc_zzzzzzzz --title X`
  Then:  Exit 5 with a message naming the id; no stack trace

TEST-88: A multi-megabyte body works
  When:  A ~5 MB markdown body is piped in
  Then:  Exit 0; the file matches (`cmp`); the request body was not built twice (state how
         this was established) and no timeout fired
```

#### `corpus doc move` and `corpus doc archive`

```
TEST-89: `move` relocates and reports the new path
  When:  `corpus doc move <id> --folder archive-notes`
  Then:  Exit 0; the file is at `data/docs/archive-notes/…`; the printed line names the new
         path; the document ID is UNCHANGED; `GET /api/tree` reflects the move

TEST-90: `archive` flips status and reports it
  When:  `corpus doc archive <id>`
  Then:  Exit 0; `status: archived` in the file; the document leaves the default
         `GET /api/docs` result set

TEST-91: Archiving an archived document is a reported no-op
  When:  `corpus doc archive <id>` twice
  Then:  The second says "already archived" and exits 0 — the agent's loop never branches on
         it. Whether it produced a second commit is stated

TEST-92: Moving to the folder it is already in is a reported no-op
  Then:  Exit 0 with an "already there" line; no commit
```

#### `corpus doc delete` — the user-only guard

```
TEST-93: `--from agent` is refused client-side with NO request sent
  Given: A stub server recording every request it receives
  When:  `corpus doc delete <id> --from agent`
  Then:  Exit 2; stderr explains "deletion is user-only — the agent archives, never deletes";
         the stub received ZERO requests. A guard that relies on the server's 403 fails this

TEST-94: `CORPUS_FROM=agent` is refused identically
  When:  `CORPUS_FROM=agent corpus doc delete <id> --yes`
  Then:  Exit 2, zero requests — the env var is resolved before the guard, not after

TEST-95: Non-TTY without `--yes` is a usage error, never a hang
  When:  `corpus doc delete <id>` with stdin piped from /dev/null, and with stdin piped from
         a here-string
  Then:  Exit 2 naming `--yes`; the command returns immediately; a piped stdin was NOT read
         as a confirmation (Open Conflict 9)

TEST-96: `--yes` deletes for real
  When:  `corpus doc delete <id> --from user --yes`
  Then:  Exit 0; the file is gone from the worktree; `git log --diff-filter=D` shows it;
         `git show HEAD~1:<path>` still returns the content (history retained); the printed
         line names the deleted id and any orphaned thread ids

TEST-97: The server's 403 is still the backstop
  When:  `curl -X DELETE /api/docs/<id> -H "x-corpus-author: agent"` directly
  Then:  403 — the CLI guard is defence in depth, not the only defence

TEST-98: Deleting a document with threads reports what was orphaned
  Given: A document with two anchored threads
  Then:  The output (and `--json`'s `orphanedThreadIds`) names both; both thread files still
         exist and remain readable
```

#### `corpus thread reply | resolve | reopen`

```
TEST-99: `thread reply` appends a real turn from a heredoc
  Given: A real thread
  When:  `corpus thread reply <th> --from agent <<'EOF' … EOF`
  Then:  Exit 0; the printed line names the new turn's TIMESTAMP; the thread file gained
         `## agent · <ts>` with the body verbatim; `git log -1` author is `agent`;
         `GET /api/threads/<th>` shows the turn

TEST-100: All three body sources work for reply
  When:  `--message/-m`, `--file`, and piped stdin
  Then:  Each produces the same turn body; precedence per TEST-77

TEST-101: An empty body is a usage error
  When:  `corpus thread reply <th> -m ""` and a reply with an empty piped stdin
  Then:  Exit 2 (usage), NOT exit 5 — the CLI never sends a request the contract's
         `min(1)` will reject

TEST-102: A fenced/form block passes through byte-for-byte
  Given: A body containing a ```` ```form ```` block and a nested code fence
  Then:  The bytes in the file are identical to the bytes piped in; no CLI-side markdown
         post-processing happened

TEST-103: A reply mentioning `@agent` enqueues, and a plain one does not
  Given: A thread whose `agent` is `none`
  When:  (a) a reply whose body contains `@agent`; (b) a plain reply
  Then:  (a) an `evt_*.json` appears in `pending/`; (b) none. §8's participation semantics
         reach the CLI unchanged — the server decides, the CLI does not add a flag

TEST-104: `resolve` and `reopen` flip status through the server
  When:  `corpus thread resolve <th>` then `corpus thread reopen <th>`
  Then:  `status: resolved` then `open` on disk and in `GET /api/threads/<th>`; each prints
         one line; each authors a commit

TEST-105: Both are idempotent and exit 0
  When:  `corpus thread resolve <th>` twice, `corpus thread reopen <th>` twice
  Then:  The second of each prints "already resolved"/"already open" and exits 0

TEST-106: A reply to an unknown thread is a clean exit 5
  When:  `corpus thread reply th_zzzzzzzz -m "x"`
  Then:  Exit 5 naming the id; no stack trace
```

#### `corpus doc check` and `corpus skill rollback` — conditional on Open Conflicts 1 and 3

```
TEST-107: [CONDITIONAL] `doc check <id>` validates through the server
  Then:  Warnings (orphaned anchors, unresolved `[[refs]]`) exit 0; errors exit 6; `--json`
         emits the structured findings

TEST-108: [CONDITIONAL] `doc check --staged` posts staged blobs, not worktree files
  Given: A temp git repo with a staged malformed document AND a different, valid worktree
         version of the same file
  Then:  The STAGED content is what was validated (asserted against the stub's recorded
         request); `git status --porcelain` is byte-identical before and after; no git state
         changed

TEST-109: [CONDITIONAL] `doc check --staged` with nothing staged is silent and fast
  Then:  Exit 0, no output — hooks stay quiet on the common path

TEST-110: [CONDITIONAL] The pre-commit gate works end to end
  Then:  A corrupt staged document blocks `git commit`; fixing it lets the commit through.
         The hook lives in the WORKSPACE, installed by `corpus init` — not in the Corpus tool
         repository's `.githooks/` (Open Conflict 2)

TEST-111: [CONDITIONAL] `skill rollback <name>` restores the last-known-good version
  Then:  The skill file's previous content is back; a revert commit appears in `git log`; the
         printed line names the restored commit and file path

TEST-112: [CONDITIONAL] `skill rollback` for an unknown name is exit 5
  Then:  "no skill named <name>", exit 5
```

#### `corpus db rebuild` and `corpus db doctor`

```
TEST-113: `db rebuild` triggers a real rebuild and summarises it
  Given: A live server on a real workspace
  When:  `corpus db rebuild`
  Then:  Exit 0; one line reporting the counts and the duration, drawn from the response's
         `{documents, threads, turns, anchors, links, events, jobs, locks, seen, durationMs}`;
         the `cache.db` INODE changed (verified with `stat`), proving a real swap; the very
         next `corpus doc create` and `GET /api/docs` still work (the server reopened its
         handle — SERVER-017's seam)

TEST-114: `db rebuild --json` emits the full RebuildResult
  Then:  One JSON value carrying every count field, `durationMs`, `path`, and `skipped`

TEST-115: `db rebuild` does not use the 10 s global timeout
  Given: The global `--timeout` default of 10000 ms
  When:  A rebuild is run on a workspace large enough to take longer than the default (or the
         seam is asserted directly)
  Then:  It completes rather than aborting; the CLI registered NO local `--timeout` flag
         (registry validation would have rejected it at module load — Open Conflict 11)

TEST-116: `db doctor` on a clean workspace exits 0
  When:  `corpus db rebuild && corpus db doctor` — §14's standing invariant
  Then:  Exit 0; the human line says the projection is clean; `--json` emits
         `{ok: true, drift: [], stats: {…}}` with `drift` EMPTY and `ok` true

TEST-117: `db doctor` maps a drift report to exit 6
  Given: A scripted stub server returning `{ok: false, drift: [{kind, path, detail}], stats}`
  Then:  Exit 6 (the code the pre-commit hook gates on), the findings printed one per line,
         and `--json` passing the report through untouched. THIS is the required evidence for
         the drift path — see Open Conflict 10

TEST-118: `db doctor` right after an external file edit is CLEAN, and that is correct
  Given: A live server whose watcher is running
  When:  A document file is edited out of band with `printf >>`, then ~2 s pass, then
         `corpus db doctor` runs
  Then:  Exit 0, clean. The watcher healed the edit within about a second; this is the
         DESIGNED behaviour, not a doctor bug, and the log says so explicitly. Anyone who
         reports it as a failure has misread the system
         [OPTIONAL, not required: drift induced by direct `sqlite3` row surgery against
          `.corpus/cache.db` reproduces exit 6 on a real server. Permitted evidence; its
          absence is not a failure]
```

#### The read-only-filesystem constraint and the error surface

```
TEST-119: No command module in this issue writes to the filesystem
  When:  A lint rule or unit assertion scans `apps/cli/src/commands/{doc,thread,db}`
  Then:  No import of `node:fs` write APIs (`writeFile`, `rename`, `unlink`, `mkdir`, `rm`,
         `appendFile`, their sync twins) and no `createWriteStream`. Reading (`readFile`) is
         permitted and used by `--file`

TEST-120: No command module spawns a state-changing git command
  When:  The same scan looks for `git` invocations
  Then:  Only read-only plumbing appears (`diff --cached`, `show`, `status`, `rev-parse`), and
         only in the `--staged` path if it ships. Zero `commit`, `add`, `checkout`, `reset`,
         `stash`, `push`

TEST-121: The workspace's git state is untouched by every read verb
  Given: `git status --porcelain` captured in a variable before
  When:  Every non-mutating command in this issue runs
  Then:  `git status --porcelain` is byte-identical afterwards

TEST-122: A stopped server produces the actionable message, not a raw error
  Given: `corpus server stop`
  When:  Every verb in this issue is run
  Then:  Exit 4 with a message naming `corpus server start`; no `ECONNREFUSED`, no stack
         trace, no partial output

TEST-123: Being outside a workspace is exit 3
  When:  Any verb runs from a directory with no `.corpus/config.json` ancestor
  Then:  Exit 3 with a clear message

TEST-124: Server errors are exit 5 and render the typed problem
  When:  A 404, a 422 and a 423 are provoked
  Then:  Exit 5 each; the message comes from the contract's problem shape, not from a
         `JSON.stringify` of the whole body

TEST-125: Vitest covers the units the E2E cannot reach cheaply
  Then:  Colocated specs cover argument parsing, body-source resolution and precedence, the
         delete guard (including "zero requests sent"), exit-code mapping for 4/5/6, and
         `--from` resolution order. Combined coverage stays at or above the 90 % gate

TEST-126: Nothing in the CLI constructs a request by hand
  When:  `apps/cli/src/commands/{doc,thread,db}` is scanned
  Then:  Every call goes through `client.request((api) => api.…)` on the generated typed
         client (§9.3). A hand-built `fetch` or a hand-written URL string is a fail
```

---

### SERVER-018: The `["tree"]` key and the job's origin title

Port `8992`. **This is filed as a bug fix, so SDLC step 1 applies: reproduce first.** Both
halves of this issue rest on claims that did not survive reading the shipped tree (Open
Conflicts 6 and 7). The criteria below are written against the *invariant*, not against the
diff, so they are correct whichever way the reproduction goes.

#### The `["tree"]` invalidation key

```
TEST-127: Reproduce, or record that there is nothing to reproduce
  Given: A real server with `curl -N /events` attached and a real workspace
  When:  A thread is deleted by BOTH routes — `DELETE /api/docs/<th>` directly, and
         `DELETE /api/threads/<th>/turns/<ts>` on a single-turn thread (the cascade)
  Then:  The exact frames are captured verbatim into the E2E log. If `["tree"]` is ALREADY
         present in both, that is recorded with the evidence and this half of the issue is
         closed as "already correct" — no redundant key is added. If it is missing, the
         reproduction is the log entry the fix is measured against

TEST-128: The invariant, stated and enforced
  Given: `GET /api/tree` fetched immediately before and immediately after each mutation
  Then:  A frame carries `["tree"]` EXACTLY when the `GET /api/tree` response actually
         changed. This is the definition of correct, and it is asserted by comparing the two
         tree responses — not by grepping the code for a `TREE_KEY` push

TEST-129: A parented thread's deletion changes the tree and says so
  Given: Document D in folder `finance` with exactly one thread T
  When:  T is deleted
  Then:  `finance`'s count in `GET /api/tree` DECREASES by one, and the delete's frame
         carries `["tree"]`

TEST-130: A standalone thread's deletion does NOT change the tree and does NOT say so
  Given: A thread with `parent: null` (which `docs/tree.ts` counts nowhere)
  When:  It is deleted
  Then:  `GET /api/tree` is byte-identical before and after, and the frame carries NO
         `["tree"]`. Emitting it here would be a new bug, not a fix

TEST-131: Creation and deletion are symmetric
  Given: The same parented thread created then deleted
  Then:  Both frames carry the same key-set SHAPE with respect to `tree` — whatever creation
         does, deletion does

TEST-132: A middle-turn deletion emits no `["tree"]`
  Given: A three-turn thread
  When:  Turn 2 is deleted (no thread deleted, no tree change)
  Then:  No `["tree"]` in the frame — correct behaviour that must not regress while fixing
         the cascade

TEST-132b: [CONDITIONAL on Open Conflict 13] Archive and unarchive announce the tree change
  Given: Document D in folder `finance`, and `GET /api/tree` read before and after
  When:  `POST /api/docs/<D>/archive`, then `POST /api/docs/<D>/unarchive`
  Then:  `finance`'s count DECREASES then INCREASES (archived documents are excluded from
         every folder count — `docs/tree.ts`), and BOTH frames carry `["tree"]`. Today
         `docs/archive.ts` emits `[DOCS_KEY, docKey(id)]` and no tree key, so this fails
         before the fix — capture that as the reproduction. Also covered: archiving a
         parented THREAD (its parent's folder count moves too)
         [If the orchestrator keeps SERVER-018 at its filed scope: `DEFERRED → SERVER-019`]

TEST-133: The key vocabulary is unchanged
  When:  `packages/contract/src/query-keys.ts` and its pinning test are run
  Then:  Still nine shapes. SERVER-018 introduced no new key name, and
         `query-keys.test.ts` passes untouched

TEST-134: Every frame is still invalidation-only
  Given: The whole SERVER-018 sequence under `curl -N`
  Then:  Every frame is `event: invalidate` with `keys` only; grepping the stream for the
         thread titles and turn bodies returns ZERO matches (§2 rule 3)
```

#### `originTitle` on the jobs listing

```
TEST-135: The contract carries the field before the server populates it
  Given: Open Conflict 6 — `JobSchema` has no `originTitle` today
  Then:  Either the CONTRACT rider landed first (the field exists in `JobSchema`,
         `openapi.json` regenerates with no diff, and the generated client's `Job` type has
         it), or this half is `STRUCK → Open Conflict 6` and TEST-136…138 do not run.
         SERVER-018 does NOT edit `packages/contract` itself (§9.3)

TEST-136: A thread-origin job carries its thread's title
  Given: A real `comment.created` event produced by posting an `@agent` comment on a thread
         titled `Re: "assume a 30-year fixed at 6.1%"`
  When:  `GET /api/jobs?recent=5`
  Then:  The row's `originId` is the thread id AND `originTitle` is that exact title —
         the console (UI-011) can label the origin with no second fetch

TEST-137: A document-origin job is unchanged in shape and gains its title
  Given: A job whose origin is a document
  Then:  `originId` is unchanged from today's behaviour, and `originTitle` is the document's
         current title. State the rule in one sentence: `originTitle` is the current title of
         whatever `originId` names

TEST-138: Null origins and vanished origins are null, not errors
  Given: (a) a job with `originId: null`; (b) a job whose origin document was since deleted
  Then:  `originTitle` is `null` in both cases; the listing returns 200 and no row is
         dropped. A renamed origin reports the NEW title on the next fetch (it is projected,
         not frozen at enqueue time) — state which and pin it
```

---

### Cross-Issue Tests — the stewardship loop

Port `8997`, one `corpus init` workspace, **zero stubs**. This block is why the three issues
share a sprint, and a failure here is a sprint failure even if all three pass their own tests.

```
TEST-139: The stewardship loop, end to end, through the real binary
  Given: A real workspace, a real server started with `corpus server start`, `curl -N /events`
         attached with its pid captured, and `corpus queue idle --json` parked in the
         background with its pid captured
  When:  The following runs in order, with the observation after each hop:
         1.  `corpus doc create --type note --title "Mortgage options" --folder finance
             --from user <<'EOF' … EOF`
             → observe: exit 0, a `doc_*` id; the file under `data/docs/finance/`; ONE commit
               authored `user <user@corpus.local>`; `GET /api/tree` shows `finance` at +1;
               an SSE frame carrying `["docs"]`, `["docs","<D>"]` and `["tree"]`, NO data
         2.  POST /api/threads anchored on a sentence of D with `requestsAgent: true`
             (HTTP — thread CREATION has no CLI verb in this issue)
             → observe: 201; the anchor entry in D's frontmatter; ONE `evt_*.json` in
               `pending/`; the parked `idle` returns in under a second with that event id
         3.  `corpus queue claim-all` → the event moves to `in-progress/`
         4.  `corpus thread reply <th> --from agent <<'EOF' … EOF`
             → observe: exit 0, the turn's ts printed; the turn in the thread file; ONE commit
               authored `agent <agent@corpus.local>`; the thread reaches `agent: engaged`;
               `eventId: null` on the wire — the agent's own reply does not wake the agent
         5.  POST /api/threads/<th>/turns as MULTIPART with `files=@shot.png` and
             `text=here is what I saw`
             → observe: 201; bytes under `.corpus/attachments/<th>/<ts>/shot.png`; the
               reference line in the committed markdown; `git status --porcelain` EMPTY
         6.  `curl -sD- /attachments/<th>/<ts>/shot.png -H "Authorization: Bearer $TOKEN"`
             → observe: 200, `Content-Type: image/png`, `X-Content-Type-Options: nosniff`,
               `cmp` against the source silent
         7.  `curl -i "/attachments/%2e%2e%2f%2e%2e%2f<bait>"` and the raw `../` form
             → observe: 404 both, identical bodies, the bait's contents absent
         8.  `corpus doc edit <D> --from agent` replacing the body so the anchored sentence
             survives in altered surroundings
             → observe: the CLI reports the remapped/orphaned counts; they match
               `GET /api/docs/<D>`; ONE commit authored `agent`
         9.  `corpus job log <evt> "filed the mortgage note"` then `corpus queue complete <evt>`
             → observe: the line in `.corpus/jobs/<evt>.jsonl`; `GET /api/jobs` shows the row
               with that `lastLine`, `originId` resolving to the thread, and (per Open
               Conflict 6) `originTitle` carrying the thread's title
         10. `corpus thread resolve <th>`; then `corpus doc archive <D>`
             → observe: `status: resolved` and `status: archived` on disk and over HTTP;
               `GET /api/tree` shows `finance` back at its baseline (archived docs are
               excluded from folder counts) and — per Open Conflict 13 — the archive frame
               carried `["tree"]`. If Conflict 13 was deferred, record the tree change and
               the MISSING key as `DEFERRED → SERVER-019` rather than passing the step
         11. `corpus doc delete <D> --from agent` → refused, exit 2, ZERO requests, file intact
         12. `corpus doc delete <D> --from user --yes`
             → observe: exit 0; the file gone; the thread reported as orphaned;
               `.corpus/attachments/<th>/` handling stated (the thread was NOT deleted, so its
               bytes remain — assert it); `["tree"]` in the frame
  Then:  Every observation above holds, and the log records the actual command, the actual
         output and the actual file/git/sqlite/SSE state at each hop. A step whose observation
         is "presumably fine" is a fail

TEST-140: A CLI-authored reply wakes a parked agent
  Given: A parked `corpus queue idle` and an `engaged` thread
  When:  `corpus thread reply <th> --from user -m "one more thought"`
  Then:  The parked `idle` returns with a `comment.created` event whose payload names that
         thread — CLI-003's write path reaches CLI-004's read path with no glue

TEST-141: A capture with an attachment moves a folder badge and serves its bytes
  When:  `POST /api/capture` multipart with text and a file
  Then:  `GET /api/tree` shows `inbox` at +1; the filing thread's turn carries the reference;
         the referenced URL serves the bytes with the right content type; ONE commit touching
         only the document and thread markdown

TEST-142: Attribution is complete across the whole run
  When:  `git log --format='%an <%ae> %s'` is read at the end
  Then:  Every mutation appears with the correct acting party as AUTHOR; every commit subject
         is structured; and NOTHING under `.corpus/` was ever committed except the five
         queue-skeleton `.gitkeep` files

TEST-143: SSE carried invalidations and never content — including filenames
  Given: `curl -N /events` attached across TEST-139
  When:  The stream is grepped for the turn bodies, the document title, the log line AND the
         attachment filenames
  Then:  ZERO matches. Every frame is an `invalidate` with `keys` only

TEST-144: The projection is fully reconstructible after the loop
  When:  `.corpus/cache.db` is deleted and the server restarted (and, separately,
         `corpus db rebuild` is run against the live server)
  Then:  Every document, thread, turn, anchor, event, job, lock and seen row returns
         identically. Nothing this sprint added is stored only in SQLite, and attachments —
         which are not projected at all — do not break the rebuild

TEST-145: `rebuild && doctor` is clean at the end of the loop
  When:  `corpus db rebuild && corpus db doctor`
  Then:  Exit 0, `ok: true`, `drift: []` — §14's standing invariant holds on a workspace that
         has been through every mutation this sprint added

TEST-146: The whole surface is behind the bearer guard, except the one documented hole
  When:  Every route this sprint touches is called with NO Authorization header, including
         `GET /attachments/<valid path>`
  Then:  All answer 401 except `POST /api/jobs/{id}/log`, which is loopback-only and tokenless
         by design

TEST-147: Every CLI verb is reachable from `docs/cli.md` and every example in it runs
  When:  Each example command in the `doc`, `thread` and `db` sections of the regenerated
         `docs/cli.md` is executed against the live workspace (substituting real ids)
  Then:  Each exits 0 or fails for a stated, correct reason. An example that cannot run is a
         documentation bug

TEST-148: No orphan bytes and no dangling references anywhere in the workspace
  When:  Every `attachments/…` reference in every committed markdown file is extracted and
         requested, and every file under `.corpus/attachments/` is matched back to a reference
  Then:  Every reference resolves to 200, and every stored file is referenced by exactly one
         live turn. Bytes with no reference, or references with no bytes, are both failures

TEST-149: The workspace survives a restart with attachments in place
  When:  `corpus server stop` then `corpus server start`
  Then:  Every attachment still serves; the projection still matches; `doctor` is clean

TEST-150: No stray processes, no stray ports
  When:  Verification ends
  Then:  `lsof -nP -iTCP:8970-8999 -sTCP:LISTEN` is empty; every backgrounded `idle`,
         `curl -N` and server was stopped BY PID; **8765 is free**; `git status` in the Corpus
         repository is clean; every scratch directory was removed by its captured path

TEST-151: The repo-wide gate is green from a clean tree
  When:  `npm run build && npm run lint && npm run format:check && npm run typecheck &&
         npm test`, then `npm run e2e` with `CORPUS_UI_PORT=5273`, then
         `npx tsx scripts/check-generated-artifacts.ts`
  Then:  All green; combined coverage at or above the 90 % gate; `openapi.json` and
         `docs/cli.md` regenerate with no diff, TWICE in a row

TEST-152: Every adjudication is recorded where the next reader will find it
  When:  The three issue files' E2E Verification Logs are read
  Then:  Each Open Conflict this sprint adjudicated is written back into the issue it
         affects, with the decision and its rationale, and every `STRUCK` or `DEFERRED`
         criterion names the issue it was deferred to. Each log states the model the
         implementing agent ran on
```

---

## Out of Scope

- **`corpus doc check` and the validation endpoint** — no route exists in `packages/contract`
  (Open Conflict 1). Struck unless the orchestrator lands the rider; then TEST-107…110 apply.
- **`corpus skill rollback` and the targeted-revert endpoint** — same situation (Open
  Conflict 3). Struck unless the rider lands; then TEST-111…112 apply.
- **The Corpus tool repository's `.githooks/pre-commit`** — CLI-003's file list asks for an
  edit there. That hook runs in a directory that is **not a Corpus workspace**, so both
  commands would exit 3. The workspace-side hook belongs to the workspace template
  (`assets/workspace/`), installed by `corpus init` — an AGENT-001/CLI-002 rider (Open
  Conflict 2). **Do not touch `.githooks/`.**
- **Multipart on `POST /api/threads`** (Ask-with-attachments) — the route is JSON-only in the
  contract (Open Conflict 5). `POST /api/capture` already carries multipart and is this
  sprint's composer-attachment path. UI-008's Ask composer needs a CONTRACT rider first.
- **Forms** — `formAnswer` / `form.respond` are SERVER-016's, still unsurfaced in the
  contract. A ```` ```form ```` block passing through `thread reply` byte-for-byte (TEST-102)
  is the only thing this sprint asserts about them.
- **`corpus thread create` / `corpus thread list`** — CLI-003's ACs name `reply|resolve|reopen`
  only. Thread creation stays HTTP-only this phase; do not add verbs speculatively.
- **`corpus doc list` / `corpus doc show`** — the collection query is the board's read path
  (SERVER-011, UI-002). Not in CLI-003's ACs.
- **`corpus doc unarchive`** — `POST /api/docs/{id}/unarchive` exists and works, but CLI-003's
  ACs name `archive` only. Do not add the verb speculatively; note it as a gap the agent will
  eventually want (archiving is meant to be reversible, §7) and let the orchestrator decide
  whether it is a one-line rider or a follow-up.
- **An attachment resource in the contract** — `packages/contract/src/schemas/attachment.ts`
  explains why there is deliberately no `AttachmentRef` schema: the projection's `turns` table
  carries `body_md` only, so no endpoint can produce a structured attachment list. Do not add
  one, and do not add an attachments table to the projection.
- **Attachment thumbnails, image resizing, EXIF stripping, virus scanning** — none are in §6
  or the issue. Bytes are stored and served verbatim.
- **Attachment garbage collection / orphan sweeping** — cleanup is cascade-driven only.
  TEST-148 checks the invariant; it does not commission a sweeper.
- **`corpus workspace upgrade`** — CLI-005, a separate issue.
- **The orchestrate and comment skills** — AGENT-002/003. This sprint ships the verbs those
  skills call; it does not write the caller.
- **The UI** — no issue in this batch touches `apps/ui` or `packages/kit`. UI-008 consumes
  attachment references and UI-011 consumes `originTitle`; neither is built here.
- **Anchor engine changes** — SERVER-002/012/013/014 own it. `doc edit` *reports* the
  reconciliation result; it does not change how reconciliation works.

---

## Integration Points

**SERVER-010 produces → UI-008 (Phase 3) consumes.** The committed reference string is the
contract, and it is `Record<string, unknown>`-grade — the type system will **not** catch a
rename later. It must be recorded verbatim in SERVER-010's E2E log:

```
Committed markdown reference (SPEC §6, the relative form the UI resolves against /attachments/):
    images:      ![<sanitized name>](attachments/<threadId>/<turnTs>/<sanitized name>)
    other files: [<sanitized name>](attachments/<threadId>/<turnTs>/<sanitized name>)
Served at:       GET /attachments/<threadId>/<turnTs>/<sanitized name>   (bearer-guarded)
Encoding:        per Open Conflict 12 — the E2E log states whether path segments are
                 percent-encoded in the markdown target, and the turn ts's colons with them.
Ordering:        upload order, one per line, separated from the text body by ONE blank line.
```

**SERVER-006 produced → SERVER-010 consumes.** The two `400` refusal seams
(`threads/turns.ts`, `capture/capture.ts`) and the multipart parse path already exist.
SERVER-010 **removes** the refusals and fills in the branch behind them; it does not add a
second multipart parser, and it does not fork `mountAppendTurn`.

**SERVER-005 owns, SERVER-010 calls.** `runMutation` / `AutoCommitter`
(`apps/server/src/docs/write.ts`, `git/commit.ts`) is the only git writer. Attachment bytes
are written **outside** the mutation's file operations (they are gitignored and must not be
staged) but their lifecycle is bound to it: written before the plan runs, removed by the
plan's rollback path when it fails. SERVER-010 does not wrap `runMutation` in a second
writer and does not reimplement the squash.

**CLI-001 owns, CLI-003 extends.** The declarative registry (`apps/cli/src/registry/`), the
global flags, the exit-code surface and `client.request()` are CLI-001's. CLI-003 registers
three topics into them and hand-constructs no request (§9.3, TEST-126). `client.untimedApi`
is the existing seam for the long call (`db rebuild`), the same one `queue idle` uses.

**CLI-004 shipped, CLI-003 must not break.** `lock break`'s per-call actor override exists
because the CLI's global actor is `agent`. If Open Conflict 4 changes that default, the
override may become redundant — **redundant is fine, broken is not** (TEST-70).

**SERVER-018 → UI-011.** `originTitle` exists so the console can label a job's origin without
a second fetch. Its rule is one sentence and must be written into the issue: *the current
title of whatever `originId` names, or `null`.*

**Neither SERVER issue nor the CLI issue may change `packages/contract`.** Any shape change
is a CONTRACT issue, filed and sequenced — never a server-side or CLI-side improvisation
(§9.3). This binds Open Conflicts 1, 3, 5 and 6.

---

## Merge order (recommendation)

1. **The CONTRACT riders first, if the orchestrator takes them.** Open Conflict 6's
   `originTitle` is one nullable field plus a regenerate — minutes, and it hard-blocks half of
   SERVER-018. Open Conflicts 1, 3 and 5 are larger and should probably be deferred out of
   this sprint entirely.
2. **SERVER-010 second.** It is the largest issue, it is the one with a security surface, and
   it extends shipped code (`threads/turns.ts`, `capture/capture.ts`, `threads/cascade.ts`,
   `docs/delete.ts`, `app.ts`'s mounting block).
3. **SERVER-018 in parallel with SERVER-010.** They touch different files
   (`threads/cascade.ts` is the one possible overlap — SERVER-010 adds the attachment-cleanup
   call, SERVER-018 may add a key). Worktree isolation, and whoever lands second rebases.
4. **CLI-003 in parallel throughout.** `apps/cli` is disjoint from `apps/server`; its own
   tests run against a stub. Only the **verification** of TEST-139…149 is ordered, since the
   integration block needs SERVER-010's ingest and SERVER-018's `originTitle` to be real.

The three issues touch **disjoint workspaces** except for `threads/cascade.ts`, so the
parallelism is real. The only shared artifact is the phase branch's green typecheck.

---

## Open Conflicts — orchestrator decision required before implementation

Thirteen disagreements between the issue files, the shipped contract, the shipped code and
the spec, in rough order of blast radius. Each carries a recommendation; the orchestrator
adjudicates **before** the domain agents start, and each adjudication is written back into
the issue it affects (TEST-152). Conflict 13 is a defect this contract found rather than a
disagreement between documents.

### 1. `corpus doc check` has no server endpoint

CLI-003's AC 5 specifies `corpus doc check [<id>…] [--staged]` validating "via the server".
`packages/contract` declares no validation route: the full route inventory is docs (list,
get, create, put, move, archive, unarchive, delete), threads (get, create, delete-turn,
resolve, reopen, seen), turn-append, capture, attachments, db (rebuild, doctor), events,
health, jobs, locks, queue, tree. SPEC §14 requires that the hook and the API share **one**
validator implementation, so the CLI cannot legitimately validate locally either.

**The validator itself is not missing.** `apps/server/src/core/check.ts` already exports
`checkCorpus(documents, options) → CheckReport {errors: CheckFinding[], warnings:
CheckFinding[]}` with `CheckFinding = {code, severity, docId, path, detail}` and thirteen
`CHECK_CODES` (`frontmatter-unparseable`, `duplicate-id`, `anchor-malformed`,
`thread-parent-missing`, `anchor-unresolved`, `ref-unresolved`, …). Its input type
`CheckDocument = {path, ok: true, document} | {path, ok: false, error}` — built by
`toCheckDocument(path, raw)` — **is already exactly the `(path, content)` shape `--staged`
needs to post**. What is missing is a route and a handler, not an implementation.

**Recommendation (orchestrator's call, and it is closer than it looks):**

- *Take it* if the appetite exists: a CONTRACT rider declaring `POST /api/check` (body: ids
  and/or `(path, content)` pairs; response: `{errors, warnings}` off the existing types) plus
  a thin SERVER handler over `checkCorpus` is genuinely small, and it would let CLI-003 ship
  AC 5 whole. Sequence it first, like Conflict 6's rider.
- *Otherwise strike AC 5* and file the trio as follow-ups. Rationale for striking: M3's
  milestone check (§15) names `doc create|edit`, `thread reply --from agent` and the queue
  verbs — not `doc check`; and the pre-commit hook that consumes it has no installer either
  (Conflict 2), so shipping the verb this sprint delivers no gate.

**Not negotiable either way**: the CLI must not grow its own validator. §14 requires the
hooks and the API to share one implementation, and that implementation is `core/check.ts`
inside the server. TEST-107…110 are marked `STRUCK → Open Conflict 1` if the rider is
declined.

### 2. `.githooks/pre-commit` is the tool repo's harness, not a workspace hook

CLI-003's Files to Create/Modify lists `.githooks/pre-commit` — "call `corpus doc check
--staged` and `corpus db doctor` per SPEC.md §14". `.githooks/` belongs to the **Corpus tool
repository** (CLAUDE.md: "versioned git hooks, wired via `npm run setup-hooks`"). That
repository is not a Corpus workspace: it has no `.corpus/config.json`, so both commands would
exit **3** on every commit any developer makes — including the agents working this sprint.

SPEC §14's hooks are the **workspace's** hooks ("If the workspace's git repository has
hooks, the server's auto-commits run through them").

**Recommendation: strike the `.githooks/` edit entirely and file the workspace-hook
installation as an AGENT-001/CLI-002 rider** (the hook ships in `assets/workspace/` and
`corpus init` installs it). Do not touch `.githooks/` in this sprint under any adjudication —
a broken pre-commit hook in the tool repo blocks every other agent.

### 3. `corpus skill rollback` has no server endpoint

SPEC §7 specifies `corpus skill rollback <name>` as "a targeted git revert, **performed by
the server**". No such route exists in the contract, and no server issue in the plan
implements one.

**Recommendation: strike AC 8 from CLI-003 and file the CONTRACT + SERVER + CLI trio as a
Phase-2-tail or Phase-5 follow-up.** Rationale: rollback is the operator's recovery path for
a bad skill edit (§7 loop safety), and skills-as-documents only becomes editable in the UI in
Phase 3/M5 — nothing in Phase 2 can produce the bad edit it recovers from. AGENT-003, which
CLI-003 blocks, needs `doc *` and `thread *`; it does not need rollback. TEST-111…112 are
marked `STRUCK → Open Conflict 3` if taken.

### 4. The CLI's default actor is `agent`; CLI-003 specifies `user`

`apps/cli/src/client.ts` hardcodes `actor: "agent"` with the comment "The CLI is the agent's
only interface (SPEC.md §2.2), so its writes are attributed to the agent". CLI-003's AC 9
specifies `--from user|agent` **defaulting to `user`**, overridable by `CORPUS_FROM`.

Both readings have support. §2.2 rule 4 says the agent reaches the system only through the
CLI; §7's comment skill writes `corpus thread reply <id> --from agent` **explicitly**, which
only makes sense if `agent` is not already the default. A human operator running `corpus doc
create` in their own workspace is a `user`.

**Recommendation: adopt CLI-003's `user` default**, resolved once at the dispatcher
(`--from` ?? `CORPUS_FROM` ?? `"user"`), validated against the union, and threaded to the
client seam so **every** verb inherits it rather than each verb re-deriving it. Rationale:
the spec's own example passes `--from agent` explicitly; a default that attributes a human's
typing to the agent corrupts the audit trail in the one direction that cannot be detected
after the fact; and the skills that need `agent` are the ones being written next
(AGENT-002/003), so the cost is a flag they were already going to pass.

**Required either way**: TEST-70 — CLI-004's shipped verbs re-verified against a real server,
`lock break` in particular. Whichever default is chosen must be stated in `docs/cli.md`'s
global-flags table and in every verb's help.

### 5. `POST /api/threads` is JSON-only, so SERVER-010's AC 2 is unbuildable as written

SERVER-010 AC 2: "`POST /api/threads` accepts the same multipart form, so a composer's first
turn (Ask/Capture) can carry attachments." `createThread`'s body declares
`"application/json"` only. Adding multipart means the dual-media dance `turn-append.ts`
documents at length (a `required: false` twin handed to the library for content-type
dispatch, with mandatoriness re-imposed by hand) — real contract work, not a one-liner.

**Recommendation: strike AC 2 from SERVER-010 and file a CONTRACT rider + SERVER follow-up
sequenced with UI-008.** `POST /api/capture` already accepts multipart, so *Capture* — the
composer action §11 actually describes as "screenshot + one line is a first-class capture" —
is covered by this sprint (TEST-14…16, TEST-141). *Ask* with attachments waits for the rider.
TEST-14 asserts the Capture half either way.

**5b. The over-cap status is undeclared.** `appendTurn` and `capture` declare `400/401/404`;
the issue specifies `413`. An undeclared status is contract drift the drift-check will not
catch (it checks generation, not responses).

**Recommendation: refuse over-cap uploads with the declared `400`** carrying an `issues[]`
entry whose message names the cap and the offending file, and file the `413` as part of the
same CONTRACT rider. Rationale: `413` is the semantically right answer and should ship — but
shipping a status the contract does not declare, in the same sprint that forbids contract
edits, is worse than a precise `400`. TEST-45 asserts whichever answer is given and requires
it to be stated.

### 6. `originTitle` does not exist anywhere in the repository

SERVER-018's Technical Design: "No contract changes — `originTitle` is already nullable in
the schema; this populates it." It is not. `JobSchema`
(`packages/contract/src/schemas/job.ts`) is `{eventId, status, started, updated, lastLine,
originId}`. A repo-wide grep for `originTitle` returns four hits, all in issue and eval
markdown. The sprint-006 evaluator's observation named a field that has never existed — the
row it saw had no such key, which reads as `undefined`, not `null`.

**Recommendation: file a one-field CONTRACT-007 rider** (`originTitle: z.string().nullable()`
on `JobSchema`, regenerate `openapi.json` and the client) and land it before SERVER-018.
Rationale: it is genuinely minutes of work, UI-011 needs it, and the alternative — SERVER-018
editing `packages/contract` itself — breaks the §9.3 rule this sprint is otherwise enforcing.
If the orchestrator declines, the second half of SERVER-018 is `STRUCK → Open Conflict 6` and
TEST-135…138 do not run.

### 7. Thread deletion may already emit `["tree"]`

SERVER-018's first premise, from the sprint-006 evaluator: "Thread deletion emits no
`["tree"]` key while thread creation does." Reading the shipped tree:
`apps/server/src/docs/delete.ts` builds `keys = [DOCS_KEY, docKey(id), TREE_KEY, …]`
**unconditionally**, and `threads/cascade.ts`'s last-turn branch calls
`deleteDocumentLocked`, which is that same function. The path that does **not** emit
`TREE_KEY` is the **middle-turn** deletion branch — which deletes no thread and therefore
correctly changes no tree.

There is a second candidate: `docs/tree.ts` counts a thread in its **parent's** folder, so a
**standalone** thread contributes nothing; `threads/create.ts` pushes `TREE_KEY` only when
`parentId !== null`, and `docs/delete.ts` pushes it unconditionally — meaning deletion is if
anything *over*-emitting for standalone threads, the opposite of the reported bug.

A read-only sweep of every `TREE_KEY` emitter came back with the two readings still in
disagreement — one tracing the last-turn branch into `deleteDocumentLocked` (emits it), one
reading `cascade.ts`'s own key array (does not). That disagreement, between two careful
readings of the same file, is itself the argument for reproducing rather than patching. The
same sweep found Conflict 13, which is the *real* instance of this bug.

**Recommendation: require reproduction before change (TEST-127), and write the criteria
against the invariant (TEST-128) rather than against a diff.** If the key is already emitted
where it belongs, SERVER-018 records that with evidence, corrects the eval's observation in
the issue file, and closes that half — a redundant `TREE_KEY` push added to satisfy a
misdiagnosis is worse than no change. If deletion turns out to over-emit for standalone
threads, fixing that is in scope and TEST-130 already covers it.

### 8. `corpus doc create --folder <nonexistent>` — nobody has decided

CLI-003's edge cases say "the server decides (create-on-demand or reject); the CLI surfaces
the typed problem verbatim". Nothing in SPEC or the contract states which.

**Recommendation: leave the CLI dumb** — no client-side pre-validation, surface whatever
comes back — and have TEST-80 **record the observed server behaviour** as the first written
statement of it. If the server's answer looks wrong, that is a SERVER issue, filed, not a CLI
workaround.

### 9. `doc delete` confirmation when stdin is not a TTY

The AC says "Interactive use requires `--yes` unless stdin is a TTY and the confirm prompt is
answered." The agent's normal invocation is non-TTY, and several verbs in this issue read a
body from stdin.

**Recommendation: non-TTY without `--yes` → exit 2**, a usage error naming `--yes`, returning
immediately. The CLI must **never** read piped stdin as a confirmation — a heredoc intended
as a document body would silently authorise a deletion. TEST-95 pins this.

### 10. `db doctor` drift cannot be induced through a black-box CLI

Confirmed by SERVER-017's implementer: on a live server, an out-of-band file edit is healed by
the watcher within about a second, so `doctor` reports clean; drift can only be induced by
mutating projection rows directly, which a CLI test has no verb for.

**Recommendation: define done as shape + clean behaviour + exit-code mapping.** TEST-116
(clean → 0), TEST-117 (a scripted stub's drift report → 6) and TEST-118 (post-external-edit
cleanliness is *correct*, and the log says so) are the required evidence. Induced drift via
direct `sqlite3` surgery is **permitted** evidence and explicitly **not required** — its
absence is not a failure and must not trigger an evaluator FAIL.

### 11. `corpus db rebuild` cannot register its own `--timeout`

`--timeout` is a global flag (`registry/globals.ts`, default 10 s) and `registry/validate.ts`
rejects any command flag shadowing a global **at module load**, before `main` runs — the same
wall CLI-004's `queue idle --timeout` hit (sprint-006 Open Conflict 8). A rebuild of a large
corpus is, by the contract's own description, "the longest-running call in the API".

**Recommendation: `db rebuild` calls through `client.untimedApi`**, exactly as `queue idle`
does, and registers no local flag. The operator can still raise the global `--timeout`.
TEST-115 pins it.

### 12. Attachment path encoding in the committed markdown reference

The stored convention is `attachments/<threadId>/<turnTs>/<name>`. The turn ts contains
**colons** (`2026-07-19T10:05:00Z`) and a sanitized filename may contain spaces, `#`, `?`,
`(`, `)` or non-ASCII. A raw markdown link target with a space breaks the link; a `#`
truncates it at the fragment; a `(` can terminate the target early.

**Recommendation: percent-encode each path segment in the markdown target** (so the colons
and any unsafe filename bytes are encoded), keep the **display text** as the human-readable
sanitized name, and have the serve route decode each segment exactly once. Additionally,
consider sanitizing `#`, `?`, `(`, `)` and spaces out of stored filenames so the encoded and
raw forms coincide and the reference stays readable — the issue's sanitizer already collapses
whitespace, and extending it is cheaper than relying on encoding alone.

Whatever is chosen, **the exact reference string is quoted verbatim in SERVER-010's E2E log**
(Integration Points) — UI-008 has to resolve it and cannot guess. TEST-23 and TEST-9 assert
whichever answer is given.

### 13. Archive and unarchive change the tree and do not say so (new — found while writing this contract)

Same family as Conflict 7, found by auditing every `TREE_KEY` emitter rather than only the
one the evaluator named:

- `docs/tree.ts` **excludes archived documents** from every folder count, "exactly as the
  default result set of `GET /api/docs` excludes them".
- `docs/archive.ts` emits `[DOCS_KEY, docKey(id)]` for **both** archive and unarchive —
  **no `["tree"]`**.

So archiving a document under `data/docs/finance/` decrements that folder's badge and
broadcasts nothing that would make a subscribed board refetch it. Unarchiving increments it
and does the same. This is the *same* defect SERVER-018 was filed for, on a path nobody
looked at — and unlike the thread-deletion claim (Conflict 7), it reproduces by inspection.

**Recommendation: fold it into SERVER-018.** It is one `TREE_KEY` push in a file the issue is
already reasoning about, it is covered by the invariant SERVER-018 is being written against
(TEST-128: a frame carries `["tree"]` exactly when `GET /api/tree` changed), and leaving a
known-wrong key in place while fixing its twin is the worst of both. If the orchestrator
prefers to keep SERVER-018 at its filed scope, file it as SERVER-019 and mark TEST-139 step
10 and TEST-134b `DEFERRED → SERVER-019`.

**Note for whoever takes it**: archiving a *thread* also changes its parent folder's count
(threads count in their parent's folder), and archiving a document in the workspace root
folder still changes that folder's count. The invariant covers all three; a fix that special-
cases only `data/docs/<subfolder>/` is incomplete.

---

## Done Criteria

This sprint is complete when:

- **Every acceptance test above has a verdict** in the evaluator's report — PASS, or
  `STRUCK → Open Conflict N` / `DEFERRED → <issue>` with the reason and substitute evidence
  recorded. Silent omission is a fail.
- **Every Open Conflict was adjudicated before implementation started**, and each adjudication
  is written back into the issue it affects (TEST-152).
- **Each issue's E2E Verification Log is filled with concrete evidence** — actual commands,
  actual output, actual file/git/sqlite/SSE state — and states which model the implementing
  agent ran on.
- `/test` passes with no regressions; combined coverage at or above the 90 % gate.
- `/lint` passes (ESLint, Prettier, `tsc --noEmit` across all workspaces).
- `npm run e2e` passes with `CORPUS_UI_PORT=5273`.
- `npx tsx scripts/check-generated-artifacts.ts` is green **twice in a row** — both
  `openapi.json` and `docs/cli.md`.
- **`/audit` has been run on SERVER-010** (security-sensitive: file upload and static serving)
  and on CLI-003 (P0, cross-domain, the user-only deletion guard).
- **pr-reviewer verdict APPROVE** on the phase PR, with CRITICAL and MAJOR findings fixed or
  explicitly waived by the user.
- No stray processes, no bound ports in `8970`–`8999`, `8765` free, and `git status` clean in
  the Corpus repository.
