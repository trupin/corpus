# Evaluation: SERVER-010

**Date**: 2026-07-27
**Sprint**: sprint-007
**Verdict**: PASS

Evaluated black-box against a real server process (`corpus server start`, port **8975**) in a real
`corpus init` workspace (`/tmp/corpus-e007-s010-LWzcQI`, a real git repository), plus the
zero-stub integration workspace on port **8997**. Every upload is a real `multipart/form-data`
body over real HTTP (`curl -F` and Node `FormData`/`File` for names `curl` cannot express);
every traversal probe used `curl --path-as-is`. No source file under `apps/server` was read.

---

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes |
| --------------------------------------- | ------ | ----- |
| Verification log present                | PASS   | Filled, ~490 lines, per-TEST structure. |
| Commands are specific and concrete      | PASS   | Exact `curl` invocations, exact HTTP statuses, exact stored filenames, exact byte counts, exact ts strings. |
| Real E2E (not mocked)                   | PASS (one caveat) | Ingest/serving/traversal/limits/git/cascade are all real HTTP against a real server. **TEST-53/54 (atomicity) are logged as vitest fault-injection, not real HTTP** — the log says so honestly rather than implying otherwise. I closed that gap myself: both reproduce over real HTTP (evidence below), so the behaviour is verified even though the log's evidence type was unit-level. |
| Scenarios cover acceptance criteria     | PASS   | All 7 live ACs have evidence; struck AC 2 is marked with its adjudication. |
| Application restarted after changes     | PASS   | Restarts recorded for the raw-path-guard fix, the cap-reconfiguration (TEST-47) and the collision-hang fix; I independently confirmed the restarted behaviour. |
| Actual model recorded (`implemented on:`) | PASS | "**implemented on: opus** (claude-opus-5, 1M context)." |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue. The prior refusal state is described. Two defects *found during* E2E (raw-path traversal bypass; collision-resolution infinite loop) each carry a pre-fix reproduction — both re-derive (below). |

### Claims I re-derived independently

| Log claim | Re-derived? |
| --- | --- |
| Reference byte string `![shot.png](attachments/th_x/<ts %3A-encoded>/shot.png)` | **Yes, byte-identical.** Observed: `![shot.png](attachments/th_2enrrjbj/2026-07-27T17%3A38%3A56Z/shot.png)` |
| Sanitization table (9 hostile names) | **Yes.** `../../etc/passwd`→`passwd`, `a/b/c.png`→`c.png`, `  .hidden`→`hidden`, `.....`→`file`, 300-char→100-char keeping `.png`, NFD `café.png`→NFC (len 8), `my shot#1?.png`→`my-shot-1-.png`. (My control-char input carried an extra `i` between NUL and BEL, so I got `shi-x.txt` where the log has `sh-x.txt` — consistent, not a contradiction.) |
| TEST-48 "refused after 64 KB … in 0.34 s" | **Yes.** Measured `uploaded=65536 total_time=0.321` on a 2,097,465-byte body. |
| TEST-43 `/attachments`→404 (route's own body), `/attachmentsx`→200 SPA shell | **Yes, exactly.** |
| TEST-42 case-insensitive FS → exact-match only (404) | **Yes.** `SHOT.PNG` → 404, `shot.png` → 200. |
| Raw-path guard fix (`curl --path-as-is` `../` no longer reaches a real attachment) | **Yes.** All raw, encoded, double-encoded, backslash and absolute forms → 404 with an identical body. |
| Canary provably absent from git objects | **Yes.** `git rev-list --objects --all \| git cat-file --batch \| grep -c` = **0**; reference line present = 1. |
| Collision-hang fix (three 300-char names) | **Yes.** 201 in 157 ms; three distinct 100-char names ending `.png`, all rendered `![…]`. No hang. |
| TEST-58b "bytes go with a turn whose deletion succeeded but whose commit failed" | **Yes.** With a `pre-commit` hook returning 1: `200` + `warnings:[{code:"commit_failed",…}]`, turn gone from disk, bytes removed, no commit. |

### Deviations found in the log

1. **Port deviation (process, not behaviour).** The log records the E2E on **port 8941**. The
   sprint contract allocates SERVER-010 **8970–8979** (primary 8975). 8941 is not in any
   reserved band, so nothing was clobbered, but the allocation was not followed.
2. **TEST-53/54 evidence type.** Logged as vitest fault injection ("real filesystem faults …
   not with mocks") rather than real HTTP. Truthfully labelled; gap closed by this evaluation.

No claim in the log failed to reproduce.

---

## Criteria Results

### Ingest on turn append

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 1 | Two files stored + both referenced | PASS | 201 `{thread,turn,eventId,warnings}`; both files under `.corpus/attachments/th_2enrrjbj/2026-07-27T17:38:56Z/`; `cmp` silent for both; body = text + 2 reference lines. |
| 2 | Reference block shape (exact bytes) | PASS | `see attached\n\n![shot.png](attachments/th_2enrrjbj/2026-07-27T17%3A38%3A56Z/shot.png)\n[notes.pdf](attachments/th_2enrrjbj/2026-07-27T17%3A38%3A56Z/notes.pdf)` — text, ONE blank line, upload order. |
| 3 | Image-ness from extension, never client MIME | PASS | PNG sent as `type=application/octet-stream` → `![…]`; PDF sent as `type=image/png` → `[…]`. Full set observed rendering as images: `png,jpg,gif,webp,avif,svg`. |
| 4 | Attachment-only turn accepted | PASS | 201, body is exactly `[notes.pdf](attachments/th_gu6z7iil/2026-07-27T17%3A19…/notes.pdf)` — no leading blank line. |
| 5 | Neither text nor files → 400 | PASS | `400 {"code":"bad_request",…,"issues":[{"path":"form.text","message":"A turn needs \`text\`, at least one file, or both."}]}`; no directory; no commit. |
| 6 | SERVER-010 refusal gone from both routes | PASS | Files-bearing `POST /api/threads/:id/turns` → 201 and `POST /api/capture` → 201. `grep -c 'SERVER-010'` over every captured response body = 0. |
| 7 | JSON turns byte-for-byte unchanged | PASS | body `"plain"`; **no** `.corpus/attachments/th_ktginkgc/` created. |
| 8 | Fileless multipart unchanged | PASS | body `"plain"`; **no** `.corpus/attachments/th_6fyngrf7/` created. |
| 9 | Directory named with the ts verbatim (colons) | PASS | `.corpus/attachments/th_2enrrjbj/2026-07-27T17:38:56Z/` — byte-identical to `turn.ts`. |
| 10 | Zero-byte file is legitimate | PASS | 201; `empty.txt` 0 B on disk; referenced; serves with `content-length: 0`. |
| 11 | File part with no filename rejected | PASS | **400** (stated) `{"path":"form.files.0","message":"Expected an uploaded file part."}`; nothing written. An empty-string filename is rejected the same way. |
| 12 | `requestsAgent` identical on multipart | PASS | Full 3×2×3 matrix run (thread `none` / `engaged` / `resolved` × multipart / JSON × omit / true / false). **Multipart column is identical to the JSON column in all nine rows.** |
| 13 | Two turns → separate directories | PASS | `…/17:39:40Z/shot.png` and `…/17:39:42Z/shot.png`. |

### Ingest on capture

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 14 | Capture with a file lands bytes on the filing thread's first turn | PASS | 201 `{"docId":"doc_zhw64a7c","threadId":"th_kckm7smc",…}`; bytes at `.corpus/attachments/th_kckm7smc/2026-07-27T17:45:25Z/shot.png`; the **filing thread's** first turn carries `![shot.png](…)`; the inbox **document** body is exactly `screenshot of the error` with **no** reference — §6 puts attachments on turns. |
| 15 | Capture without `text` still 400 | PASS | `400 {"path":"form.text","message":"Invalid input: expected string, received undefined"}`. |
| 16 | Capture enqueues exactly one event | PASS | `.corpus/queue/pending/` = exactly one `evt_m4t4wq7yhp3m.json`; payload names the filing thread. |

### Sanitization and collisions

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 17 | Sanitization table, all properties asserted | PASS | 8 hostile names in ONE turn. Every stored name: no `/`, no `\`, 0 control code points, never `.`/`..`, never leading `.`, ≤ 100 chars, NFC-normalised. `find .corpus/attachments` showed files **only** under the expected turn directory. |
| 18 | Truncation preserves the extension | PASS | 300-char stem → 100 chars ending `.png`, still rendered `![…]`. |
| 19 | Collisions inside one turn | PASS | `shot.png`, `shot-2.png`, `shot-3.png`; three distinct references in upload order; `cmp` silent against each of three *different* sources. |
| 20 | Fallback-name collisions | PASS | `...` and `///` → `file` and `file-2`. |
| 21 | Same filename in two turns, no suffix | PASS | Both stored as `shot.png` under their own ts directories. |
| 22 | Stored name = committed reference = served URL | PASS | All **17** references extracted from committed markdown and requested verbatim → **17 × 200** with the right byte counts. Zero dangling. |
| 23 | URL-encoding round-trip | PASS | `my shot#1?.png`→`my-shot-1-.png` (200); NFD `café.png`→ target `caf%C3%A9.png` (200, len 69). **Encoding answer: each path segment is percent-encoded exactly once in the markdown target; the display text stays the readable stored name; the turn ts's colons encode as `%3A`.** |

### Serving — content types, headers, auth

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 24 | Content types from the extension map | PASS | `png→image/png`, `jpg→image/jpeg`, `gif→image/gif`, `webp→image/webp`, `avif→image/avif`, `pdf→application/pdf`, `txt→text/plain; charset=utf-8`, `md→text/markdown; charset=utf-8`, `.wat→application/octet-stream`. |
| 25 | SVG served as a download | PASS | `image/svg+xml` + `Content-Disposition: attachment`, body served unmodified (contains the live `<script>`). |
| 26 | Disposition follows image-ness | PASS | png → `inline; filename="shot.png"; filename*=UTF-8''shot.png`; pdf → `attachment; filename="notes.pdf"; …`. Quoted filename plus RFC-5987 form. |
| 27 | `nosniff` on every response | PASS | Present on 200s, on the 404, and on every rejected traversal (all 22 probes). |
| 28 | Content-Length and bytes agree (3 MB) | PASS | `content-length: 3145728`, source 3145728, `cmp` silent. |
| 29 | Caching headers | PASS | `cache-control: private, max-age=31536000, immutable` on every 200. |
| 30 | Auth enforced before anything | PASS | No header → 401 `{"code":"unauthorized",…}`; wrong token → 401. No bytes, no existence hint. |
| 31 | Missing file is a clean 404 | PASS | `{"code":"not_found","message":"no such attachment"}` — no path, no `errno`, no stack frame. |

### Serving — path traversal (security block)

Bait files created under my own scratch prefix only (`…/outside/secret.txt` and a workspace-local
`bait.txt`, both containing `CORPUS-BAIT-DO-NOT-SERVE`). **Never `/etc/passwd`.** All probes sent
with `curl --path-as-is`. Every row asserts status, `nosniff`, and bait-absence.

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 32 | Raw dot-dot | PASS | `/attachments/../../bait.txt`, `/attachments/../../../<scratch>/outside/secret.txt`, `/attachments/../../../etc/hosts` → 404, nosniff, bait=0, body sha `3adecb2f3520`. |
| 33 | Single-encoded | PASS | `%2e%2e%2f%2e%2e%2f…` and `..%2f..%2f…` → 404 both, same sha. |
| 34 | Double-encoded | PASS | `%252e%252e%252f…` → 404. Decoding happens exactly once. |
| 35 | Backslash / mixed | PASS | `..\..\bait.txt` and `..%5c..%5c…` → 404 both. |
| 36 | Absolute-path injection | PASS | `//etc/hosts` and `%2fetc%2fhosts` → 404 both. |
| 37 | NUL and control bytes | PASS | `shot.png%00.txt` and `shot%0a.png` → **404** (stated); nothing served, no header injected. |
| 38 | Symlink escape | PASS | Leaf symlink (`link.txt → <bait>`) → 404; **symlinked directory** (`linkdir → <bait dir>`) → 404; a legitimate sibling in the same directory still served 200, so the defence is per-entry. Bait absent from both bodies. |
| 39 | Legitimate dotted names still serve | PASS | `..hidden.png`, `a..b.png`, `v1.2.3.tar` (planted by hand) → 200 with their own bytes. |
| 40 | No existence oracle | PASS | Traversal probe, missing file, missing thread dir, too-few-segments, bare prefix — **all five return 404 with byte-identical bodies (sha `3adecb2f3520`) and identical headers.** |
| 41 | Malformed paths that resolve back inside | PASS | Both the encoded (`..%2f..%2f<th>/<ts>/notes.pdf`) and raw (`/attachments/zzz/yyy/../../<th>/<ts>/shot.png`) forms → 404, even though the target exists inside the root. |
| 42 | Case sensitivity decided | PASS | **Exact match only.** `SHOT.PNG` → 404 on a case-insensitive macOS filesystem; `shot.png` → 200. Deterministic across platforms (per-component `readdir` match, per the log). |
| 43 | Wildcard route does not shadow / is not shadowed | PASS | `GET /attachments` → **404 from the attachment route** (same body as every other 404). `GET /attachmentsx` → **200 SPA shell**, not handled by the attachment route. |
| 44 | Serving mutates nothing | PASS | 22 requests (17 hits, 5 misses) with `curl -N /events` attached: **0 `event: invalidate` frames** (only `:connected`); commits 16→16; `turns` rows 20→20; thread mtime 1785174090→1785174090; `git status --porcelain` unchanged. |

### Limits

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 45 | Over-cap single file refused, nothing left behind | PASS | Default caps **25 MB / 100 MB**. 25 MB + 1 byte → **400** (the adjudicated status, Open Conflict 5b) `"attachment toobig.bin is 26214401 bytes, over the per-file limit of 26214400 bytes (25 MB)"`; no attachment directory; markdown md5 unchanged; commits 17→17. |
| 46 | Over-cap request total refused the same way | PASS | 5 × 24 MB → 400 `"the upload totals 125830065 bytes, over the per-request limit of 104857600 bytes (100 MB)"`; nothing on disk; no commit; git clean. |
| 47 | Caps are configurable | PASS | Server restarted with `.corpus/config.json` → `attachments:{maxFileBytes:1024,maxRequestBytes:4096}`. The 3 MB file that had succeeded now fails naming **the new value**; a 2000-byte file trips the new per-file cap; a 500-byte file still succeeds (201). |
| 48 | Refusal before the bytes are read | PASS | `curl --limit-rate 200k` on a 2,097,465-byte body → **400 after `uploaded=65536` in 0.32 s**. Answered from the declared `Content-Length`. |

### Git hygiene

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 49 | Working tree stays clean | PASS | `git status --porcelain` empty before and after every attachment turn throughout the run. No gitignore edit. |
| 50 | Commit touches only markdown | PASS | `git show --stat HEAD` for TEST-1's commit: `data/docs/finance/mortgage-options.md` (the parent's anchor entry) + `data/threads/th_2enrrjbj.md`. Nothing under `.corpus/`. |
| 51 | Bytes provably absent from history | PASS | Canary `CORPUS-ATTACHMENT-CANARY-e6c27f0a66ce`: objects matching = **0**, `git log -p --all` matching = **0**, reference line in history = **1**, bytes present on disk. Only paths ever committed under `.corpus/` are the five queue-skeleton `.gitkeep` files. |
| 52 | Squashing behaves as before | PASS | Two attachment turns, same actor, same thread, inside 30 s → **0 new commits** (folded into the thread's existing commit); the single commit's diff carries **both** references. |

### Atomicity and the deletion cascade

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 53 | Failed markdown write takes the attachment directory with it | PASS **(reproduced over real HTTP by this evaluation)** | `chmod 555 data/threads` then POST a multipart turn → **500**; `.corpus/attachments/<T>/` **does not exist**; thread md5 identical; commits 19→19; git clean. |
| 54 | Failed file write leaves no partial directory | PASS **(reproduced over real HTTP by this evaluation)** | Planted a directory named `b.png` inside six candidate ts directories (EISDIR on the 2nd of 3 files) → **500**; the turn's ts directory (`…17:45:07Z`) is **absent entirely** — not even the already-written `a.png` survived; markdown md5 identical; commits 20→20; 1 turn heading. |
| 55 | Middle-turn deletion removes only its attachments | PASS | 200 `{"deletedTurn":true,"deletedThread":false,…}`; `…/17:47:21Z/` gone; turns 1 and 3 intact (`cmp` silent); `f2.png` reference count in markdown = 0, `f1`/`f3` = 1 each. |
| 56 | Thread deletion removes the whole tree | PASS | 200 `{"deletedId":"th_h7rz65s7",…}`; `.corpus/attachments/th_h7rz65s7` gone; the sibling capture thread's bytes untouched; git clean. |
| 57 | Last-turn cascade cleans up too | PASS | 200 `{"deletedTurn":true,"deletedThread":true,"removedAnchor":"anc_09b6ab24","parentId":"doc_arzivte5"}`; thread file gone; parent frontmatter `anchors: {}`; `.corpus/attachments/<T>/` gone — one path, all three effects. |
| 58 | Cleanup follows the commit; no-attachment thread deletes cleanly | PASS | (a) A thread with no attachments deletes with 200 and no error. (b) With a `pre-commit` hook exiting 1: **200 + `warnings:[{code:"commit_failed",…}]`**, the turn is gone from disk (§11: the file mutation stands), and the bytes went with it. The forbidden outcome — losing bytes for a turn that *failed* to delete — did not occur, because a write failure aborts before cleanup (TEST-53/54). |

### Struck / not applicable

| # | Item | Disposition |
| --- | --- | --- |
| AC 2 | `POST /api/threads` multipart | **STRUCK → sprint-007 Open Conflict 5.** Independently confirmed against the served contract: `/api/threads` `post` declares `application/json` only; `/api/threads/{id}/turns` declares both; `/api/capture` declares multipart. Rider filed as CONTRACT-009. |
| 5b | Over-cap status | **Adjudicated `400`, not `413`.** Confirmed: `getAttachment`/upload routes declare no 413. TEST-45/46/47 assert the 400 and it names the cap and the file. |

---

## Cross-Issue (twelve-hop loop) — SERVER-010's hops

Run on port **8997**, fresh `corpus init` workspace, **zero stubs**, real binary + real HTTP.

- **Hop 5** — multipart turn: 201; `![shot.png](attachments/th_afa65myb/2026-07-27T17%3A50%3A04Z/shot.png)` in the committed markdown; bytes at `.corpus/attachments/th_afa65myb/2026-07-27T17:50:04Z/shot.png`; `git status --porcelain` **EMPTY**; commit touches only the thread markdown. **PASS**
- **Hop 6** — serve: `200`, `content-type: image/png`, `x-content-type-options: nosniff`, `cache-control: private, max-age=31536000, immutable`, `cmp` silent. **PASS**
- **Hop 7** — traversal: encoded and raw forms both `404`, identical bodies (sha `3adecb2f3520`), bait absent. **PASS**
- **Hop 12** — after `doc delete <D> --from user --yes`, the thread was orphaned (not deleted), so **its bytes remain** (`.corpus/attachments/th_afa65myb/…/shot.png` still present and still serving 200). Asserted as the contract requires. **PASS**
- **TEST-141** — capture with an attachment: `inbox` appears in `GET /api/tree` (count 2 = doc + filing thread); the filing thread's turn carries the reference; the referenced URL serves the bytes as `image/png`; **one** commit touching exactly `data/docs/inbox/screenshot-of-the-error.md` + `data/threads/th_g2huja7l.md`. **PASS**
- **TEST-143** — SSE never carried filenames: `shot.png` matched **0** times in the whole stream. **PASS**
- **TEST-148** — every `attachments/…` reference in every committed markdown resolves 200 (2/2) and every stored file maps back to exactly one live turn: **orphan byte files = 0**. **PASS**
- **TEST-149** — after `server stop` / `server start`, every attachment still serves 200 and `db doctor` is clean. **PASS**
- **TEST-144** — projection fully reconstructible with attachments in place: dumps of `documents/threads/turns/anchors/events/jobs/locks/seen/links` are **byte-identical** after a live `db rebuild` and again after deleting `.corpus/cache.db` and restarting. **PASS**

---

## Failures

None.

## Observations (not failures)

1. **`.svg` renders as `![…]` in the markdown reference** while being served `Content-Disposition: attachment`. TEST-25 only requires the header, and an `<img>` load of SVG does not execute scripts, so the vector stays closed — but UI-008 should be aware the image-ness set and the inline-disposition set differ by exactly `svg`.
2. **Port allocation not followed.** The E2E log ran on 8941 rather than the assigned 8970–8979. Harmless here (no reserved band touched) but it makes the sprint's evidence-reproducibility scheme weaker.
3. **TEST-53/54 were logged as unit-level fault injection.** The behaviour is correct — I reproduced both over real HTTP — but the log should not be read as containing real-HTTP evidence for those two.

## Summary

**58 of 58 applicable acceptance tests PASS**; AC 2 / thread-create multipart is `STRUCK →
Open Conflict 5` (rider CONTRACT-009 filed) and the over-cap status is the adjudicated `400`.
The security block (TEST-32…44) is fully verified against a real server with real raw-path
probes and self-planted bait: every traversal form — raw, single-encoded, double-encoded,
backslash, absolute, NUL/newline, symlinked leaf, symlinked directory, and resolve-back-inside
— returns 404 with a byte-identical body and `nosniff`, with no existence oracle. Git hygiene
is provable at the object level. The two atomicity criteria, which the log evidenced with unit
fault injection, both reproduce over real HTTP.
