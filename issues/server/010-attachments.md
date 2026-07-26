# [SERVER-010] Attachments: ingest + serving

## Domain
server

## Status
todo

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
- [ ] `POST /api/threads/:id/turns` accepts `multipart/form-data` with zero or more files alongside the turn fields; JSON requests keep working unchanged.
- [ ] `POST /api/threads` accepts the same multipart form, so a composer's first turn (Ask/Capture) can carry attachments.
- [ ] Bytes are written to `.corpus/attachments/<threadId>/<turnTs>/<sanitized-filename>` before the turn markdown is committed.
- [ ] The turn body gains a reference per file: `![<name>](attachments/<threadId>/<turnTs>/<name>)` for images, `[<name>](…)` otherwise, appended after the text body (or forming the whole body for attachment-only turns).
- [ ] An attachment-only turn (no text, ≥ 1 file) is accepted; an empty turn with neither text nor files remains a 422.
- [ ] `GET /attachments/<threadId>/<turnTs>/<name>` serves the bytes with the correct `Content-Type`, requires the bearer token, and is provably path-traversal-proof.
- [ ] `.corpus/` (and therefore attachment bytes) stays gitignored; the commit for the turn contains only the markdown reference.
- [ ] Deleting a turn removes `.corpus/attachments/<threadId>/<turnTs>/`; deleting a thread removes `.corpus/attachments/<threadId>/`.

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

### Reproduction (bugs only)
_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification
_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (security-sensitive: file upload + static serving)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-010]` prefix
