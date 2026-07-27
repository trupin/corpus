# [SERVER-010] Attachments: ingest + serving

## Domain
server

## Status
review

## Priority
P1

## Model
opus — narrow and well-specified by §6; the only care needed is on sanitization and path-traversal defense.

## Dependencies
- Depends on: SERVER-006
- Blocks: UI-008

## Spec References
- SPEC.md §6 — "Attachments" (byte layout, relative markdown references, attachment-only turns, gitignored bytes)
- SPEC.md §9.2 — `POST /api/threads/:id/turns` (multipart), `GET /attachments/...`
- SPEC.md §4 — repository layout (`.corpus/attachments/<thread-id>/<turn-ts>/`)

## Summary
Let turns carry files. Thread creation and turn append accept `multipart/form-data`; uploaded bytes land in `.corpus/attachments/<thread-id>/<turn-ts>/<filename>` and the turn body gains relative markdown links (images inline, everything else as plain links). A turn may be attachment-only with no text. `GET /attachments/...` serves the bytes behind the same bearer auth with correct content types and hardened path handling. Bytes stay out of git (`.corpus/` is gitignored); only the references are committed — and deleting a turn or thread takes its attachment directory with it.

## Acceptance Criteria
- [x] `POST /api/threads/:id/turns` accepts `multipart/form-data` with zero or more files alongside the turn fields; JSON requests keep working unchanged.
- [ ] ~~`POST /api/threads` accepts the same multipart form, so a composer's first turn (Ask/Capture) can carry attachments.~~ **STRUCK → sprint-007 Open Conflict 5.** `createThread`'s body declares `application/json` only, and adding a second media type is contract work (`packages/contract`), not server work. *Capture* — the composer action §6 names ("screenshot + one line is a first-class capture") — already declares multipart and is implemented here; *Ask* with attachments waits for the CONTRACT rider.
- [x] Bytes are written to `.corpus/attachments/<threadId>/<turnTs>/<sanitized-filename>` before the turn markdown is committed.
- [x] The turn body gains a reference per file: `![<name>](attachments/<threadId>/<turnTs>/<name>)` for images, `[<name>](…)` otherwise, appended after the text body (or forming the whole body for attachment-only turns). **Each path segment is percent-encoded in the link target** (sprint-007 Open Conflict 12); the display text stays the human-readable stored name.
- [x] An attachment-only turn (no text, ≥ 1 file) is accepted; an empty turn with neither text nor files is a **400** (the contract's `MultipartAppendTurnRequestSchema` refine, and the shape every other validation failure takes — the issue's "422" predates the shipped error vocabulary, which has no 422).
- [x] `GET /attachments/<threadId>/<turnTs>/<name>` serves the bytes with the correct `Content-Type`, requires the bearer token, and is provably path-traversal-proof.
- [x] `.corpus/` (and therefore attachment bytes) stays gitignored; the commit for the turn contains only the markdown reference. (No gitignore edit: `corpus init` already ignores `.corpus/*`.)
- [x] Deleting a turn removes `.corpus/attachments/<threadId>/<turnTs>/`; deleting a thread removes `.corpus/attachments/<threadId>/`.

### Adjudications applied (sprint-007 Open Conflicts)
- **5** — AC 2 struck, as above.
- **5b** — an over-cap upload is the **declared `400`** carrying an `issues[]` entry naming the offending file and the cap, not an undeclared `413`.
- **12** — the markdown target percent-encodes each segment; the sanitizer additionally reduces filenames to letters/digits/`.`/`-`/`_`, so for an ASCII name the encoded target and the stored name are byte-identical and only the turn ts's colons (and non-ASCII letters) actually encode.

## Technical Design

### Files to Create/Modify
- `apps/server/src/attachments/store.ts` — path construction, filename sanitization, collision handling, directory removal
- `apps/server/src/attachments/serve.ts` — `GET /attachments/*` handler (auth, resolve, content-type, stream)
- `apps/server/src/attachments/mime.ts` — extension → content-type map with an `application/octet-stream` fallback
- `apps/server/src/attachments/*.test.ts` — colocated Vitest specs
- `apps/server/src/threads/turns.ts`, `apps/server/src/threads/create.ts` — multipart branch + body reference generation
- `apps/server/src/threads/cascade.ts` — call the attachment-directory removal hook left by SERVER-006
- `apps/server/src/app.ts` — mount `/attachments/*`

### Key Implementation Details

**Multipart parsing.** Hono's `c.req.parseBody({all: true})` yields `File` objects for the file fields (field name `files`, repeated). Read text fields (`body`, `from`, `agent`, `noteOnly`, and the creation fields) from the same form, validating them with the same Zod schemas used for the JSON branch — one validation path, two encodings. Reject a request whose declared total size exceeds the cap before reading bodies.

**Ordering.** Assign the turn's timestamp first (it names the directory), write all files, then write and commit the turn markdown. If any file write fails, remove the partially written directory and fail the request — a committed reference must never dangle. If the markdown write or commit fails, remove the attachment directory too.

**Directory naming.** The turn ts is used verbatim as the directory name (`2026-07-19T10:05:00Z`), matching §6's `<turn-ts>` layout. Colons are legal on the POSIX filesystems Corpus targets (macOS/Linux, Node ≥ 22); Windows is not a supported host. Record this in a code comment so nobody "fixes" it into drift with the spec.

**Filename sanitization.** Take the basename only; strip path separators, NUL, and control characters; collapse whitespace; drop leading dots; normalize Unicode (NFC); truncate the stem so the total name is ≤ 100 chars while preserving the extension; empty result → `file`. Collisions inside the same turn directory get a numeric suffix before the extension (`shot.png` → `shot-2.png`).

**Reference generation.** Images are detected by the sanitized extension (`png`, `jpg`/`jpeg`, `gif`, `webp`, `avif`, `svg`) — not by the client-supplied MIME type. References are appended to the turn body, one per line, separated from the text by a blank line, in upload order. The relative form `attachments/<threadId>/<turnTs>/<name>` is the committed convention; the UI resolves it against the server's `/attachments/` route.

**Serving.** Resolve the request path against the attachments root with `path.resolve`, then assert the result starts with `attachmentsRoot + path.sep` — reject anything else with 404 (not 403; do not confirm the existence of paths outside the root). Decode the URI component exactly once and reject any segment that is `.`, `..`, empty, or contains a separator after decoding. Stream the file with `Content-Type` from the extension map, `Content-Length`, `Content-Disposition: inline` for images and `attachment; filename="…"` otherwise, and `Cache-Control: private, max-age=31536000, immutable` (paths are content-addressed by turn ts). `X-Content-Type-Options: nosniff` on every response; `svg` is served as `image/svg+xml` with `Content-Disposition: attachment` to avoid an inline-script vector.

**Limits.** Per-file cap 25 MB and per-request cap 100 MB by default, both configurable through the server config; exceeding either → 413 with a clear message.

**Cascade cleanup.** SERVER-006's deletion cascade exposes a hook; implement it here as `removeTurnAttachments(threadId, ts)` and `removeThreadAttachments(threadId)` (recursive removal, tolerant of a missing directory). Cleanup happens after the markdown deletion commit succeeds — losing bytes for a turn that failed to delete would be worse than a brief orphan.

### Edge Cases
- Two uploads with the same filename in one turn → deduplicated with a numeric suffix; a third gets `-3`.
- Filename that is entirely unsafe characters, or a zero-length name → `file` (then collision-suffixed).
- Zero-byte file → accepted and written (a legitimate empty file), still referenced.
- A file part with no filename at all → 422.
- Over-cap file → 413, with no partial directory left behind.
- Non-multipart JSON post with no files → unchanged behavior (no attachment directory created).
- `GET /attachments/` with `..%2f`, double-encoded traversal, absolute paths, or symlinked targets → 404, verified by test.
- Request for a thread/turn that no longer exists → 404 from the filesystem check, no stack trace leaked.
- Deleting a middle turn that had attachments → only that turn's directory is removed; sibling turns keep theirs.
- Thread with no attachments at all → deletion cleanup is a no-op, never an error.

## Testing Strategy
Vitest in `apps/server` against a temp workspace fixture, driving the real Hono app via `app.request()` with a real `FormData` body:
- Upload on turn append: one image + one PDF → files present at the expected paths, body contains one `![]()` and one `[]()` reference in upload order, one commit whose diff touches only the thread markdown.
- Upload on thread creation: attachments land under the created thread's first turn ts.
- Attachment-only turn: no text field → turn body is just the references; empty request (no text, no files) → 422.
- Sanitization table: `../../etc/passwd`, `a/b/c.png`, `  .hidden`, a 300-char name, a name of only dots → expected stored names.
- Collisions: three uploads named `shot.png` → `shot.png`, `shot-2.png`, `shot-3.png`.
- Serving: correct content types per extension; unknown extension → `application/octet-stream`; missing bearer token → 401; traversal attempts (raw and encoded) → 404.
- Limits: an over-cap file → 413 and no leftover directory.
- Cascade: delete a turn with attachments → its directory gone, siblings intact; delete the thread → the whole thread directory gone.
- Git hygiene: after an upload, `git status --porcelain` shows no untracked files under `.corpus/`.

## E2E Verification Plan

### Verification Steps
1. Start the real server against a scratch workspace with the bearer token exported; create a thread and note its id.
2. Upload on a real turn: `curl -X POST localhost:8765/api/threads/<th>/turns -H "Authorization: Bearer $TOKEN" -F "from=user" -F "body=see attached" -F "files=@/path/to/shot.png" -F "files=@/path/to/notes.pdf"`.
3. `ls -R .corpus/attachments/<th>/` → both files under the turn's ts directory; `cat data/threads/<th>.md` → the turn body ends with the image and link references.
4. `git status --porcelain` → clean (bytes ignored); `git show --stat HEAD` → only the thread markdown changed.
5. Serve: `curl -sD- "localhost:8765/attachments/<th>/<ts>/shot.png" -H "Authorization: Bearer $TOKEN" -o /tmp/out.png` → 200, `Content-Type: image/png`, and `cmp /tmp/out.png /path/to/shot.png` is silent.
6. Auth: the same request without the header → 401.
7. Traversal: `curl -i "localhost:8765/attachments/../../../etc/passwd"` and the `%2e%2e%2f`-encoded variant → 404 both times, nothing leaked.
8. Attachment-only turn: post with `files=@…` and no `body` → the turn exists with only a reference line.
9. Collisions: upload `shot.png` twice in one request → `shot.png` and `shot-2.png` on disk, two distinct references in the body.
10. Cascade: `DELETE /api/threads/<th>/turns/<ts>` → the turn's attachment directory is gone; delete the thread → `.corpus/attachments/<th>/` is gone.

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work. Must be from real E2E
testing — no mocks, no test clients. Real application, real requests, real
interfaces. Include specific commands run, actual outputs observed, and pass/fail
conclusions. State which model the implementing agent ran on ("implemented on:
opus | fable")._

**implemented on: opus** (claude-opus-5, 1M context).

### Reproduction (bugs only)
Not a bug — a feature. The prior state was the deliberate refusal both routes
shipped with (`"attachments are not accepted yet: ingest and serving land in
SERVER-010"`, a `400`), and `GET /attachments/...` had no handler at all.

### Post-Implementation Verification

**Environment.** Real `corpus init` workspace at `/tmp/corpus-s010-e2e-K77ydi`
(real git repository), real server process from source on **port 8941**
(`node --import tsx apps/server/src/main.ts`, pids 44417 → 36613 → 441, each
stopped by recorded pid; `lsof -nP -iTCP:8941 -sTCP:LISTEN` empty at the end).
Real files on disk under `/tmp/corpus-s010-files/`. Every request is real HTTP
via `curl`. Baseline: `corpus init` seeded 8 template files in one commit.

#### Ingest on turn append (TEST-1, 2, 3, 9)

```
$ curl -X POST .../api/threads/$TH/turns -H "Authorization: Bearer $TOKEN" \
    -F "text=see attached" \
    -F "files=@shot.png;type=application/octet-stream" \
    -F "files=@notes.pdf;type=image/png"
HTTP 201   ts = 2026-07-27T16:14:46Z
```

The **exact byte string** of the reference block, as committed (UI-008 resolves
this and must not guess):

```
see attached

![shot.png](attachments/th_xhs5xyqc/2026-07-27T16%3A14%3A46Z/shot.png)
[notes.pdf](attachments/th_xhs5xyqc/2026-07-27T16%3A14%3A46Z/notes.pdf)
```

Text, then **one** blank line, then one reference per line in **upload order**.
The PNG was uploaded declaring `application/octet-stream` and the PDF declaring
`image/png`: the `.png` still rendered `![…]` and the `.pdf` still `[…]` —
**image-ness comes from the sanitized extension** (`png,jpg,jpeg,gif,webp,avif,svg`),
never from the client's MIME type (TEST-3).

Bytes and directory naming:

```
$ ls -R .corpus/attachments
th_xhs5xyqc/2026-07-27T16:14:46Z/{notes.pdf,shot.png}
$ cmp .corpus/attachments/$TH/$TS/shot.png  shot.png   → silent
$ cmp .corpus/attachments/$TH/$TS/notes.pdf notes.pdf  → silent
```

The directory name is the turn ts **verbatim, colons included**, byte-identical
to `turn.ts` in the response (TEST-9). The code comment forbidding a "fix" is in
`apps/server/src/attachments/store.ts` → `turnAttachmentDir`.

#### Attachment-only, empty, JSON and fileless multipart (TEST-4, 5, 7, 8)

```
attachment-only (files only, no text part) → 201, body is exactly:
  [notes.pdf](attachments/th_xhs5xyqc/2026-07-27T16%3A19%3A18Z/notes.pdf)
  (no leading blank line, no empty paragraph)

no text, no files → HTTP 400
  {"code":"bad_request","message":"request failed validation",
   "issues":[{"path":"form.text","message":"A turn needs `text`, at least one file, or both."}]}
```

JSON turns and fileless multipart turns are unchanged and create **no**
`.corpus/attachments/<thread>/` directory at all (unit-verified in
`ingest.test.ts` → "creates no attachment directory for a JSON turn or a
fileless multipart one").

#### The SERVER-010 refusal is gone (TEST-6)

`ATTACHMENTS_DEFERRED_MESSAGE` and `CAPTURE_ATTACHMENTS_DEFERRED_MESSAGE` are
deleted; `grep -rn "SERVER-010" apps/server/src` returns nothing. The two shipped
tests that asserted the message were **replaced** by tests of the new behaviour
(`threads/turns.test.ts` → "accepts attachments and references them from the
committed turn"; `capture/capture.test.ts` → "files an attachment on the filing
thread, leaving the document text alone").

#### `requestsAgent` on the multipart branch (TEST-12)

Against a thread whose `agent:` is `requested`:

```
requestsAgent omitted → eventId = None
requestsAgent=true    → eventId = evt_lplwqvyps3er
requestsAgent=false   → eventId = None
```

Identical to the JSON branch's shipped §8 behaviour — attachments changed the
body, not the participation rules.

#### Two turns, two directories (TEST-13, 21)

```
turn 1 ts = 2026-07-27T16:24:10Z  body = 'turn 1\n\n![small.png](attachments/th_t4leqf6a/2026-07-27T16%3A24%3A10Z/small.png)'
turn 2 ts = 2026-07-27T16:24:11Z  body = 'turn 2\n\n![small.png](attachments/th_t4leqf6a/2026-07-27T16%3A24%3A11Z/small.png)'
.corpus/attachments/th_t4leqf6a/2026-07-27T16:24:10Z/small.png
.corpus/attachments/th_t4leqf6a/2026-07-27T16:24:11Z/small.png
```

Identically named files in two turns; **neither is suffixed**.

#### Capture (TEST-14, 15, 16)

```
$ curl -X POST .../api/capture -F "text=screenshot of the error" -F "files=@shot.png"
HTTP 201 {"docId":"doc_k2xccxvx","threadId":"th_t4leqf6a","eventId":"evt_ohgazkpiyfa2","warnings":[]}
```

The **filing thread's** first turn carries the reference:

```
## user · 2026-07-27T16:20:45Z
screenshot of the error

Captured to the inbox. Please file it: …

![shot.png](attachments/th_t4leqf6a/2026-07-27T16%3A20%3A45Z/shot.png)
```

The inbox **document** body is `screenshot of the error` and contains no
`attachments/` reference — §6 puts attachments on *turns*; a document body
quoting bytes the user attached to a message would be the server inventing
content. Exactly one `evt_*.json` in `pending/`. A capture with only a file is
still `400` (`CaptureRequestSchema.text` is `min(1)` and mandatory) — SERVER-010
does not change that.

#### Sanitization table (TEST-17, 18, 20, 22, 23)

One turn, nine hostile names, over real HTTP. Input → stored name:

| uploaded filename        | stored name                                  | len |
| ------------------------ | -------------------------------------------- | --- |
| `../../etc/passwd`       | `passwd`                                     | 6   |
| `a/b/c.png`              | `c.png`                                      | 5   |
| `  .hidden`              | `hidden`                                     | 6   |
| `.....`                  | `file`                                       | 4   |
| `LLL…(300)….png`         | `LLL…(96 L)….png`                            | 100 |
| `sh<BEL>-x.txt`          | `sh-x.txt`                                   | 8   |
| `café.png` (NFD input)   | `café.png` (NFC)                             | 8   |
| `my shot#1?.png`         | `my-shot-1-.png`                             | 14  |
| (collision) `shot.png`×3 | `shot.png`, `shot-2.png`, `shot-3.png`       | —   |
| (both unusable) `...`,`///` | `file`, `file-2`                          | —   |

Every stored name: no `/`, no `\`, no NUL/control byte, never `.` or `..`, never
leading `.`, ≤ 100 chars, NFC. Truncation kept `.png`, so the reference still
renders `![…]` (TEST-18). `ls .corpus/attachments/` showed **only**
`th_xhs5xyqc/`, and under it only the four turn directories — nothing was
created anywhere else.

Every committed reference was extracted from the markdown and requested verbatim
(TEST-22, 23) — all 200 with the right byte counts:

```
attachments/th_xhs5xyqc/2026-07-27T16%3A19%3A37Z/passwd          200 len=12
attachments/th_xhs5xyqc/2026-07-27T16%3A19%3A37Z/c.png           200 len=70
attachments/th_xhs5xyqc/2026-07-27T16%3A19%3A37Z/hidden          200 len=6
attachments/th_xhs5xyqc/2026-07-27T16%3A19%3A37Z/file            200 len=4
attachments/th_xhs5xyqc/2026-07-27T16%3A19%3A37Z/LLL…png         200 len=70
attachments/th_xhs5xyqc/2026-07-27T16%3A19%3A37Z/sh-x.txt        200 len=3
attachments/th_xhs5xyqc/2026-07-27T16%3A19%3A37Z/caf%C3%A9.png   200 len=3
attachments/th_xhs5xyqc/2026-07-27T16%3A19%3A37Z/my-shot-1-.png  200 len=6
```

**Open Conflict 12, answered:** each segment of the markdown target is
percent-encoded exactly once (`encodeURIComponent`), and the serve route decodes
each segment exactly once. Because the sanitizer only emits
`\p{L}\p{N}._-`, an ASCII stored name encodes to itself — so in practice only the
turn ts's colons (`%3A`) and non-ASCII letters (`caf%C3%A9.png`) change. The
display text is always the readable stored name.

#### Serving: content types, dispositions, headers (TEST-24…29)

```
pic.jpg      200  image/jpeg               inline;    len 70
pic.gif      200  image/gif                inline;    len 70
pic.webp     200  image/webp               inline;    len 70
pic.avif     200  image/avif               inline;    len 70
shot.png     200  image/png                inline;    len 70
notes.pdf    200  application/pdf          attachment; filename="notes.pdf"   len 59
drawing.svg  200  image/svg+xml            attachment; filename="drawing.svg" len 71
mystery.wat  200  application/octet-stream attachment;  len 14
canary.txt   200  text/plain; charset=utf-8       attachment;  len 38
readme.md    200  text/markdown; charset=utf-8    attachment;  len 5
empty.txt    200  text/plain; charset=utf-8       attachment;  len 0
```

Every 200 also carried `cache-control: private, max-age=31536000, immutable` and
`x-content-type-options: nosniff`. The SVG contained a live `<script>` element
and was served **unmodified** with `Content-Disposition: attachment` — the
disposition is the defence, not a rewrite (TEST-25). Disposition carries both
`filename="…"` (printable-ASCII, quotes/backslashes/control bytes replaced) and
`filename*=UTF-8''…`, so a filename can never break out of the header (TEST-26).

3 MB fidelity (TEST-28): `content-length: 3145728`, source size `3145728`,
`cmp` silent. Zero-byte file: `content-length: 0`, 200.

#### Auth (TEST-30) and clean 404 (TEST-31)

```
no Authorization header → 401 + www-authenticate: Bearer, body is the
  contract's `unauthorized`, no bytes, no hint that the path exists
wrong bearer token      → 401
```

A well-formed path naming a missing file → `404 {"code":"not_found","message":"no such attachment"}`
— no filesystem path, no `errno`, no stack frame.

#### The traversal block (TEST-32…44) — every probe against a bait file **I** created

Bait: `/tmp/corpus-s010-files/outside/secret.txt` containing
`CORPUS-BAIT-DO-NOT-SERVE`. Never `/etc/passwd`. Each probe asserts **status**,
**`nosniff`**, and **that the bait string is absent from the body**.

```
TEST-32 raw dot-dot     GET /attachments/../../..<scratch>/outside/secret.txt  → 404 nosniff bait=0
                        GET /attachments/../../../etc/hosts                    → 404 nosniff bait=0
TEST-33 single-encoded  GET /attachments/%2e%2e%2f%2e%2e%2fsecret.txt          → 404 nosniff bait=0
                        GET /attachments/..%2f..%2fsecret.txt                  → 404 nosniff bait=0
TEST-34 double-encoded  GET /attachments/%252e%252e%252fsecret.txt             → 404 nosniff bait=0
TEST-35 backslash       GET /attachments/..\..\secret.txt                      → 404 nosniff bait=0
                        GET /attachments/..%5c..%5csecret.txt                  → 404 nosniff bait=0
TEST-36 absolute        GET /attachments//etc/hosts                            → 404 nosniff bait=0
                        GET /attachments/%2fetc%2fhosts                        → 404 nosniff bait=0
TEST-37 NUL / newline   GET /attachments/<th>/<ts>/shot.png%00.txt             → 404 nosniff bait=0
                        GET /attachments/<th>/<ts>/shot%0a.png                 → 404 nosniff bait=0
TEST-38 planted symlink GET /attachments/<th>/<ts>/link.txt                    → 404 nosniff bait=0
TEST-41 back inside     GET /attachments/<th>/<ts>/..%2f..%2f<th>/<ts>/notes.pdf → 404
                        GET /attachments/zzz/yyy/../../<th>/<ts>/shot.png      → 404
TEST-42 case            GET /attachments/<th>/<ts>/SHOT.PNG                    → 404
TEST-43 bare prefix     GET /attachments                                       → 404 (the attachment route's own body)
        neighbour       GET /attachmentsx                                      → 200 SPA shell, NOT the attachment route
```

All raw probes were sent with **`curl --path-as-is`**. The symlink was planted
by hand (`ln -s <bait> .corpus/attachments/<th>/<ts>/link.txt`) and the
legitimate sibling in the same directory still served 200 — the defence is
per-entry, not per-directory.

**TEST-38, how the symlink is refused:** neither `realpath` nor an explicit
prefix check is the primary mechanism. Every path component is `lstat`ed
(intermediates must be real directories, the leaf a real file — a symlink
reports as neither), and the leaf is then opened with **`O_NOFOLLOW`**, which
closes the window between the check and the open. A symlinked *turn directory*
is refused the same way (unit-tested).

**TEST-42, case sensitivity, decided:** exact-match only, on every platform.
Measured first: macOS `realpath` does **not** canonicalise case
(`realpath("/x/DIR/SHOT.PNG")` returns `/x/DIR/SHOT.PNG`), so a realpath-based
check would answer 200 on macOS and 404 on CI's Linux. The route instead
requires each component to appear byte-for-byte in its parent's `readdir`
listing, which is 404 on both. `lstat` runs first, so a miss costs no `readdir`.

**TEST-39, the false-positive guard:** names that merely *contain* dots still
serve. Verified with `a..b.png` (uploaded), and with `..hidden.png` and
`v1.2.3.tar` planted by hand (the sanitizer drops leading dots, so `..hidden.png`
cannot be produced by an upload — but the *serving* rule must not reject it).
All three → 200 with their own bytes. The rule rejects path **segments** equal
to `.` or `..`, not names containing them.

**TEST-40, no existence oracle:** a traversal probe, a well-formed path to a
missing file, a path under a nonexistent thread, a too-short path, and the bare
prefix all return **404 with the identical body**
(`{"code":"not_found","message":"no such attachment"}`) and the identical headers.

**A real finding, and the fix — read this.** On the first E2E pass the *raw*
dot-dot and raw-backslash probes (TEST-32, TEST-35) answered **200 with the UI
shell**, not 404, and `/attachments/zzz/yyy/../../<th>/<ts>/shot.png` **served a
real attachment**. Cause, measured rather than guessed:

```
$ node -e 'console.log(new URL("/attachments/../../../etc/hosts","http://h").pathname)'
/etc/hosts
$ node -e 'console.log(new URL("/attachments/..\\..\\secret.txt","http://h").pathname)'
/secret.txt
```

Every `Request` is built by the WHATWG URL parser, which resolves `.`/`..` and
rewrites `\` → `/` **before any Corpus code runs**; by the time Hono routes, the
path no longer starts with `/attachments` and the attachment route is never
consulted. Nothing leaked (the body was byte-identical to the answer for any
unknown path — `sha=469dce14…` for `/attachments/../../../etc/hosts`,
`/etc/hosts` and `/no-such-path-at-all` alike), but two things were wrong: a
"harmless" traversal could be rewritten into a *different real attachment*, and
the raw answer differed from its encoded twin.

Fixed by `createRawAttachmentPathGuard()` (`attachments/serve.ts`), mounted
globally in `app.ts` after the auth mounts. It reads the **unnormalized request
target** off the Node adapter (`c.env.incoming.url`) and answers the route's own
404 for any `/attachments…` target containing a `.`/`..`/empty segment or a
backslash. Re-run after restarting the server: all four rows above became 404
with `nosniff`, `/attachmentsx` stayed the SPA fallback, and the legitimate
attachment still served 200. No real client is affected — browsers, `fetch` and
`curl` all normalise before sending.

**TEST-44, serving mutates nothing.** With `curl -N /events?token=…` attached
across the whole sequence, 20 requests were served (15 hits, 5 misses):

```
SSE frames observed: `:connected` only — 0 `event: invalidate` frames
commits:      3 → 3
turns rows:   6 → 6   (sqlite3 .corpus/cache.db 'select count(*) from turns')
thread mtime: 1785169205 → 1785169205
git status --porcelain: (empty)
```

#### Limits (TEST-45…48)

Defaults are **25 MB per file / 100 MB per request** (`attachments.maxFileBytes`
/ `attachments.maxRequestBytes` in `.corpus/config.json`). **Open Conflict 5b:
the refusal status is the declared `400`**, not `413`.

```
25 MB + 1 byte, default caps:
  400 {"code":"bad_request",
       "message":"attachment toobig.bin is 26214401 bytes, over the per-file limit of 26214400 bytes (25 MB)", …}
  no attachment directory for that turn; commit count unchanged; thread markdown unchanged
```

Then the server was **restarted** with `attachments: {maxFileBytes: 1024,
maxRequestBytes: 4096}` written into `.corpus/config.json` (TEST-47):

```
the 3 MB file that succeeded before → 400 "the upload totals 3146050 bytes, over the per-request limit of 4096 bytes (4.0 KB)"
five legal 1000-byte files          → 400 "the upload totals 5946 bytes, over the per-request limit of 4096 bytes (4.0 KB)"   (TEST-46)
one 2000-byte file (under the request cap, over the file cap)
                                    → 400 "attachment mid.bin is 2000 bytes, over the per-file limit of 1024 bytes (1.0 KB)"
a 500-byte file                     → 201, stored and referenced
nothing left on disk from any refusal; no new commits; git status clean
```

The message names the **new** value, proving the cap is read from configuration
rather than from a constant.

**TEST-48, the early refusal, measured:**

```
$ /usr/bin/time -p curl --limit-rate 200k -F "files=@slow.bin" …   # 2 MB body, ≈10 s to upload
400 "the upload totals 2097468 bytes, over the per-request limit of 4096 bytes (4.0 KB)"
uploaded = 65536 bytes      real 0.34 s
```

Refused after **64 KB of a 2,097,468-byte body, in 0.34 s** — the guard answers
from the declared `Content-Length` before any validator asks for the body. A
request with no `Content-Length` (chunked) falls through to the post-parse check,
which is the authoritative one.

#### Git hygiene (TEST-49…52)

```
$ git status --porcelain          (before and after six attachment turns) → empty
$ git show --stat --format='' HEAD
 data/threads/th_xhs5xyqc.md | 37 ++++++++++++++++++++++++++++++++++++-
 1 file changed, 36 insertions(+), 1 deletion(-)
```

Exactly one path, the thread markdown. Nothing under `.corpus/`. **The gitignore
was not edited** — `corpus init` already writes `.corpus/*`.

Canary (TEST-51): a text attachment whose contents were
`CORPUS-ATTACHMENT-CANARY-149ecb0e7e95`.

```
$ git rev-list --objects --all | awk '{print $1}' | git cat-file --batch | grep -c "$CANARY"   → 0
$ git log -p --all | grep -c "$CANARY"                                                          → 0
$ git log -p --all | grep -c "canary.txt](attachments/"                                         → 1
$ cat .corpus/attachments/$TH/$TS/canary.txt                → CORPUS-ATTACHMENT-CANARY-149ecb0e7e95
```

The reference is in history; the bytes are provably not, in any object.

Squashing (TEST-52): six attachment turns by one actor on one thread inside the
30 s window produced **two** commits, not six — `SQUASH_IDLE_MS` still folds
them, and both turns' references appear in the folded commit. Attachments did
not fork a second git writer.

#### Atomicity (TEST-53, 54)

Verified with **real filesystem faults** in `attachments/ingest.test.ts` against
a real workspace and a real git repository, not with mocks:

- *A later file cannot be written*: a directory is planted at the path the second
  of three files must occupy (`EISDIR`). → 500; the turn directory does **not**
  exist (not even the first file); thread markdown byte-identical; no commit.
- *The write is refused after the bytes land*: the thread is given two turns
  sharing a timestamp, so §14's `duplicate-turn-timestamp` blocks
  `validateBeforeWrite` — which runs *after* the bytes are on disk, exactly the
  window the cleanup exists for. → 400; `.corpus/attachments/<thread>/` does not
  exist at all (the turn directory went, and the pruning took the empty thread
  directory with it); markdown unchanged; no commit.

Ordering is: choose the ts → write the bytes → write and commit the markdown. A
*commit* failure is deliberately **not** a cleanup trigger (§14: the file
mutation stands and the failure is a warning), so bytes stay with the turn that
references them.

#### The deletion cascade (TEST-55…58)

```
TEST-55  DELETE /api/threads/$TH/turns/<ts of turn 2>  → 200
  .corpus/attachments/$TH/<ts2>/ gone
  turns 1 and 3 intact — `cmp` against both sources still silent
  the deleted turn's reference left the markdown with the turn (grep count 0)

TEST-56  DELETE /api/docs/$TH                          → 200
  find .corpus/attachments → only the sibling capture thread remains:
    .corpus/attachments/th_t4leqf6a/2026-07-27T16:20:45Z/shot.png
  th_xhs5xyqc tree gone entirely; git status clean

TEST-57  an anchored thread whose only remaining turn carries an attachment
  DELETE that turn → 200
  {"deletedTurn":true,"deletedThread":true,"removedAnchor":"anc_919faf4f","parentId":"doc_ovehgag7"}
  thread file gone (cascade) · parent frontmatter now `anchors: {}` ·
  .corpus/attachments/<thread>/ gone — one path, all three effects

TEST-58a a thread with no attachments at all deletes with no error and no
  attempt to remove a missing directory (unit-verified; removal is `rmSync`
  with `force`).
TEST-58b a deletion whose commit fails (a `pre-commit` hook that always exits 1):
  the DELETE still answers 200, the turn is gone from disk, and the bytes go
  with it. Justification: §14 says the *file mutation stands* — the deletion
  succeeded, only its commit did not, so the bytes belong to a turn that no
  longer exists. The outcome the design forbids is losing bytes for a turn that
  **failed** to delete, and that cannot happen: cleanup runs only after
  `runMutation` returns, and `runMutation` throws on a failed write, never on a
  failed commit.
```

#### A second real finding: a hang in collision resolution

Self-review of the test run turned up a suite that never finished. Cause,
reproduced standalone before any fix:

```
$ node -e '…the shipped truncate/dedupe logic…'
long len 100
2 -> SAME AS INPUT (infinite loop)
3 -> SAME AS INPUT (infinite loop)
```

`dedupeName` built `<stem>-<n><ext>` and then truncated it back to 100
characters. For a name that is *already* 100 characters the truncation returns
the original name, so every candidate collided and the `for (;;)` loop spun
forever — pegging a CPU inside a request handler. **Reachable from an upload**:
two files whose sanitized names are both 100 characters (any two ≥ 96-character
stems with the same extension). Fixed by making the *stem* give up room for the
marker instead of truncating afterwards, which bounds the loop at
`taken.size + 1`. Regression tests: `names.test.ts` → "terminates for a name
already at the length limit, and stays within it" and "terminates when the
extension leaves no room for a stem".

Re-verified over real HTTP against a restarted server — three uploads all named
`LLL…(300)….png`:

```
HTTP 201   real 0.08s
LLL…(94 L)…-2.png   (len=100)
LLL…(94 L)…-3.png   (len=100)
LLL…(96 L)….png     (len=100)
```

Three distinct names, each within the limit, each still ending `.png` and still
rendering `![…]`.

#### Other real-HTTP checks

- **TEST-11** — a `files` part with no `filename` parameter →
  `400 {"issues":[{"path":"form.files.0","message":"Expected an uploaded file part."}]}`.
  Nothing written, no directory. (`400`, not `422` — the shipped error vocabulary
  has no 422.)
- **TEST-19** — three `shot.png` in one request → `shot.png`, `shot-2.png`,
  `shot-3.png` on disk and three distinct references in upload order.
- **TEST-10** — a zero-byte file is stored and referenced, and serves with
  `content-length: 0`.

#### Cleanup

Server stopped by recorded pid; `lsof -nP -iTCP:8941 -sTCP:LISTEN` empty. Port
`8765` never bound (`corpus init --port 8941`). Only paths under
`/tmp/corpus-s010-*` were created, and none were removed with a wildcard.
`git status` in the worktree shows only files this issue meant to change.

## Completion Checklist (domain agent)
- [x] Tests written and passing — six new colocated suites under
      `apps/server/src/attachments/` (`names`, `mime`, `references`, `limits`,
      `serve`, `ingest`), plus `nextTurnTs` in `core/turns.test.ts` and the two
      replaced refusal tests in `threads/turns.test.ts` and
      `capture/capture.test.ts`.
- [x] `/lint` passes — ESLint, Prettier and `tsc --noEmit` across all workspaces.
      No rule was disabled: `no-control-regex` was satisfied by replacing the
      control-character regexes with code-point predicates (`attachments/chars.ts`).
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified (AC 2 struck per Open Conflict 5)

## Completion Checklist (orchestrator)
- [ ] `/audit` run (security-sensitive: file upload + static serving)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-010]` prefix
