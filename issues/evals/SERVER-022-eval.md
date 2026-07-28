# Evaluation: SERVER-022

**Date**: 2026-07-27
**Sprint**: sprint-008
**Verdict**: PASS

**Scope**: TEST-99 … TEST-122 + TEST-125 (28 criteria, 11 findings). Four criteria
(TEST-110/111, TEST-123/124) are N/A here by Open Conflict 9 — they belong to SERVER-014 and
SERVER-020 respectively and are covered by their own evaluations. **24 in-scope criteria, 24
PASS, 0 FAIL.**

**Rig used by this evaluation** (independent of the implementing agent's):

- `mktemp -d /tmp/corpus-e008-s022-rVPThu` → `corpus init ws --port 8976`, real git repository,
  real server (pid 49655), `curl -N /events?token=…` attached throughout (pid 49935).
- Second workspace `/tmp/corpus-e008-s022-w2-bsAEtU/ws` on **8977** for the unborn-branch fixture
  (finding 5) and the `dataDir` restarts (finding 9a). Every `git` call in that fixture carried an
  explicit `-C <scratch ws>`.
- Entry point `node --import tsx apps/cli/src/bin/corpus.ts`. `8765` confirmed unbound before and
  after. Baseline `GET /api/docs` = 6 seeded documents (1 template, 3 views, 2 skills).

---

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| E2E Verification Log present | PASS | 200 lines, one section per finding, plus Environment, gate and TEST-101 sections |
| `implemented on: <model>` line | PASS | Line 53: "**implemented on: opus**", with the reassignment carve-out stated |
| Commands specific, not hand-wavy | PASS | Concrete HTTP verbs + statuses + bodies, `git show --stat` output, `sqlite3` rows, SSE frames quoted verbatim |
| Real E2E, not mocked | PASS | Real `corpus init` workspace, real server process, real git repo, real SSE client. The one place a unit test is the evidence (the forced retry race) is *declared as such* per TEST-105's escape clause |
| Restarted the app after changes | PASS | Finding 9a's evidence is four boot attempts of a real daemon (`corpus server start`), with listener counts each time |
| Covers the ACs | PASS | AC1 "each item fixed with a colocated regression test or explicitly waived" — verdict table names a test per item; AC2 "no behavior changes beyond the findings" — TEST-101 file→finding table |
| Reproduction-before-fix per FIXED item (TEST-100) | PASS | Rightmost table column carries a distinct pre-fix observation for each of the ten rows; wording is specific ("reported `landed`", "7 of the 8 failed", "unhandled ENOENT — `POST /api/docs` 500") |
| Bug reproduced before the fix (SDLC step 1) | PASS | Finding 1's pre-fix probe is a *measurement on a running pre-fix server*, exactly what TEST-102 demands, and it contradicts the criterion's own optimistic static trace — a fact the agent surfaced rather than hid |
| Port / scratch / process discipline | PASS (with note) | Evidence recorded on 8945/8946, not the coordinator's named band; the deviation is stated with its reason and matches the sprint contract's own allocation table. `8765` confirmed unbound |
| Waivers | N/A | "No item was waived." Every disposition is a FIXED or a reassignment |

---

## Log Honesty Re-derivation

Twelve concrete claims re-derived independently. All CONFIRMED; none contradicted.

| Claim in log | Re-derived? | Actual observation |
| --- | --- | --- |
| "the WHATWG parser collapses `%2e%2e` exactly like `..`" — the mechanism behind the pre-fix 200s | CONFIRMED | `new URL(…)` in Node 25 normalizes `..`, `%2e%2e`, `%2E%2E`, `.%2e`, `%2e.` to the *same* pathname; `%2e` collapses as a single-dot segment; `%252e%252e` does not. Combined with the pre-fix predicate visible in the diff (`segment === "." \|\| segment === ".."`), the pre-fix 200-with-other-thread-bytes is mechanically certain |
| "`/attachments/%2e%2e/…/outside/secret.txt` → 200 `<!doctype html>` (UI shell)" pre-fix | CONFIRMED | The UI shell *is* mounted on this build: `GET /outside/secret.txt` and `GET /th_probe01/x/shot.txt` both return 200 `<!doctype html>` today, so the pre-fix normalization would land there exactly as logged |
| "post-fix every spelling is the one uniform 404" | CONFIRMED | 12 traversal spellings probed on 8976, all `404 {"code":"not_found","message":"no such attachment"}`, identical `content-type: application/json` |
| "the legitimate percent-encoded turn-stamp path still answers 200" | CONFIRMED | `/attachments/th_jsxnwiex/2026-07-28T00%3A07%3A40Z/shot.txt` → 200, `LEGIT-ATTACHMENT-BYTES-ONE` |
| 409 wording "queue event … is processed; only a failed job can be retried" is byte-identical to pre-fix | CONFIRMED | Observed verbatim: `{"code":"conflict","message":"queue event evt_lvfq5lcg7nqv is processed; only a failed job can be retried"}` |
| "the job log holds exactly one `retry requested` line — the legitimate one" | CONFIRMED | Six retried jobs on my rig, each log holds exactly 1 `retry requested` record; the refused (409) retry appended none |
| "```formula fence → not listed; quoted fence → not listed; real fence → listed" | CONFIRMED | Exactly that, plus an ```` ```FORM ```` uppercase case I added, also not listed |
| "the resolved thread remains under `needs=me` **via `unread-reply`**, a different reason" | CONFIRMED | After `POST …/seen` cleared the unread-reply reason, the resolved thread vanished from `needs=me` too |
| "`git show --stat HEAD` names only the mutation's path; `STAGED-BY-OPERATOR.txt` still staged" | CONFIRMED | On my own unborn-branch workspace: 1 commit, 1 file (`data/docs/inbox/s022-unborn-probe.md`), `A  STAGED-BY-OPERATOR.txt` still staged, `git log --all -- STAGED-BY-OPERATOR.txt` empty |
| "body starts `\n## Context\n\n## Notes\n\n## Open questions`" (template pre-fill) | CONFIRMED | Byte-for-byte the same string |
| Finding 8's two SSE frames (standalone / parented shapes) | CONFIRMED | `[["docs"],["docs","th_4xwrsicl"],["threads","th_4xwrsicl"]]` and `[["docs"],["docs","th_dnygyynh"],["threads","th_dnygyynh"],["docs","doc_wyjxmnn2"]]` |
| TEST-119a's materiality argument ("`toWireDoc` carries no `unread`") | CONFIRMED | `GET /api/docs/{id}` keys are `[anchors, body, frontmatter, path]`; the response is **identical** before and after mark-seen. The collection row's `unread` flips `true → false`. The log's "pattern inconsistency, not a behavioural bug" is exactly right |
| Finding 9a's refusal message and the three accepted spellings | CONFIRMED | Refusal reproduced verbatim for `content` and `../elsewhere` (0 listeners); `data`, `./data`, `data/` all boot and answer `/api/health` |
| Gate: "`vitest run apps/server` 2007 passed, 0 failed" | CONFIRMED (stronger) | `npx vitest run apps/server/src` at 4ea3e4b: **105 files, 2046 tests, 0 failed**, 33.7 s. No flake observed in a clean run, as the log predicted |

---

## Finding Verdict Table

| # | Issue-file verdict | Evidence quality | My finding |
| --- | --- | --- | --- |
| 1 — encoded traversal spellings | FIXED | Excellent — pre-fix measurement on a real server, contradicting the criterion's own static trace | **CONFIRMED.** All 12 spellings uniform 404; legit colon-encoded path 200. The finding was real misbehavior, not defence-in-depth |
| 2 — retry race + cap-notice substring | FIXED | Strong — HTTP sequence + declared escape clause + two named store tests | **CONFIRMED.** 6 forced concurrent retry/complete rounds: event always in exactly 1 status directory, and one round produced the refused (409) ordering over real HTTP. Cap notice: 2 quoting lines (one inside the 4 KB tail window) not mistaken; genuine notice emitted **exactly once** at 4194304 bytes |
| 3 — unanswered-form detector | FIXED | Strong — three threads over real HTTP + disclosed `needs=me` residue | **CONFIRMED.** Plus an uppercase ```` ```FORM ```` case (not listed) that the log did not claim |
| 4 — whitespace-only `exact` | *(reassigned)* | Recorded in the Summary block and in the log preamble, naming SERVER-014 | **N/A → SERVER-014 (Open Conflict 9).** `apps/server/src/anchors/reconcile.ts` is untouched by `dce21d0` and is touched only by `389208e [SERVER-014]` in the range — the reassignment is real, not a dodge |
| 5 — unborn-branch commit scoping | FIXED | Excellent — real dirty index, real unborn repo | **CONFIRMED** on my own fixture |
| 6 — template pre-fill ENOENT | FIXED | Strong | **CONFIRMED.** 201 + empty body + `warnings: []`, twice, before the watcher re-projected; not a 500, not a refusal |
| 7 — `assertWritable` before the lane | FIXED | Good, but the E2E section only exercises the **update** verb outside the test runner; the other five lean on `locks/write-guard.test.ts` | **CONFIRMED — and strengthened.** I drove **all six** verbs over real HTTP with a real parking `pre-commit` hook: update / move / archive / delete / anchored thread-create / last-turn cascade each returned **423** naming the holder, with **no** effect applied. The log under-claims its own coverage |
| 8 — mark-seen omits `docKey(id)` | FIXED (consistency) | Excellent — TEST-119a answered with the actual response shape, not an assertion | **CONFIRMED.** Standalone *and* parented frames carry `["docs", id]`; the single-doc response is provably unchanged, so "consistency, not behaviour" is the honest verdict |
| 9a — `dataDir` parsed but ignored | FIXED (dropped w/ validation error) | Excellent — four real boots, listener counts, config mode preserved | **CONFIRMED.** Refuses with the named field; 3 legal spellings still boot; `.corpus/config.json` still mode `600`, still 4 keys, token never printed |
| 9b — phantom lock row | FIXED | Strong — sqlite + API cross-check | **CONFIRMED.** Planted `docId: "doc_disagreeing"` under filename `doc_bchca37u.json` → row keyed by the **filename**; write on that doc 423s; deleting the file empties the table. Acquire/release, break and reap all end with 0 rows / 0 files / `{"locks":[]}` |
| 10 — watcher `git show` per anchored file | *(reassigned)* | Recorded in the Summary block and log preamble, naming SERVER-020 | **N/A → SERVER-020 (Open Conflict 9).** `watcher/watcher.ts` + `git-head.ts` untouched by `dce21d0`, touched by `ca7bd27 [SERVER-020]` |
| 11 — FTS STX/ETX | FIXED | Excellent — behaviour **observed first**, as TEST-125 demands, then removed | **CONFIRMED.** No forged `match: true` segment for a document body *or* a pasted turn; the enclosed word remains searchable; the file on disk still holds both control bytes |

---

## Criteria Results

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| TEST-99 | Every one of the eleven has a verdict | **PASS** | Ten table rows cover findings 1,2,3,5,6,7,8,9a,9b,11; findings 4 and 10 carry their verdict as an explicit reassignment, stated twice (Summary block quote, line 30; log preamble, line 53) and independently verified against the commit graph. *Note:* the table itself has no `N/A → SERVER-0xx` rows — bookkeeping nit, not a silent absence. No item's evidence is "no longer reproduces" |
| TEST-100 | Every fix has a test that fails before it | **PASS** | Every FIXED row names its regression test(s) *and* a distinct pre-fix observation. All named tests exist and pass today (verified by running them: `isUnnormalizedAttachmentTarget "refuses …"` ×14 + 10 pass-throughs, `retry > cannot re-run a job that completes while the retry is in flight`, `store > is not fooled by a logged line that quotes the notice` / `… mid-line`, `needs=form — what counts as an unanswered form` ×3, `commits only the mutation's paths on an unborn branch too`, `skips a template whose file has been deleted since it was projected` / `creates without pre-fill when the only template vanished under the projection`, `a lease acquired while a write is queued` ×7 + control, `announces the thread's own document key for a standalone thread too`, `refuses to start when dataDir names …` ×4 + `accepts …` ×3, `keys the row by the filename …` / `rebuilds the directory under filename ids too`, `toIndexableText` ×2 + `cannot be made to mark a span the query never matched` / `… from a pasted turn either`). Each pre-fix claim is corroborated by the diff's own before/after predicate. *Limitation:* I did not re-run the suite against `abb6b48` (would require a source checkout); the corroboration is mechanical, not executed |
| TEST-101 | Nothing changed beyond the findings | **PASS** | `git show dce21d0` = 29 files under `apps/server/src` + the issue file. Every non-test hunk read: `serve.ts` (DOT_SEGMENT_SPELLINGS + predicate) → 1; `queue/service.ts` (`RequeueOptions.onlyFrom`) + `jobs/service.ts` + `jobs/store.ts` (`isCapNoticeRecord`) → 2; `needs.ts` (`opensFormFence` + `status='open'`) → 3; `git/commit.ts` (drop `head !== null`) → 5; `templates.ts` (`isMissingFile`) → 6; `update/move/archive/delete/threads-create/threads-cascade` (guard moved into the lane) → 7; `seen.ts` (`docKey(id)`) → 8; `config.ts` (`unsupportedDataDirError`) + `project-runtime.ts` (key by filename) → 9; `fts.ts` (`toIndexableText`) + `project-document.ts` (3 call sites) → 11. **No opportunistic refactor; no unrelated hunk.** `anchors/reconcile.ts` and `watcher/watcher.ts` are untouched by this commit, as the log claims |
| TEST-102 | The uniform 404 is MEASURED first | **PASS** | Log records a genuine pre-fix measurement showing the spellings did **not** agree (`%2e%2e`/`%2E%2E`/`.%2e`/`%2e.` served another thread's bytes). Re-derived the mechanism: Node's WHATWG parser collapses all six identically, and the pre-fix predicate compared only literal `"."`/`".."`. Post-fix I measured 12 spellings + 2 controls on 8976 — all traversals 404, identical body and `content-type`, controls 200 |
| TEST-103 | The bait file is never disclosed | **PASS** | Bait at `$SCRATCH/outside/secret.txt` containing `TOP-SECRET-BAIT-E008-S022` (never `/etc/passwd`). `grep` over every response body: 0 hits. Every bait probe returned the uniform 404 |
| TEST-104 | Legitimate attachment serving unaffected | **PASS** | Real attachment at `.corpus/attachments/th_jsxnwiex/2026-07-28T00:07:40Z/shot.txt`; fetched as `…/2026-07-28T00%3A07%3A40Z/shot.txt` with the bearer token → **200**, `LEGIT-ATTACHMENT-BYTES-ONE`. The other thread's attachment likewise 200 by its own legitimate path. The guard did not break the percent-encoded path |
| TEST-105 | A retry cannot re-run a completed job | **PASS** | 6 concurrent retry-vs-complete rounds on real HTTP against real failed-then-completing jobs: **exactly one status directory every time** (`processed`), never a re-queue after completion. One round (attempt 1) produced the complete-first interleaving and the retry was refused `409`. The log's escape clause is honoured *both* halves — it names the colocated test (`jobs/service.test.ts` → "cannot re-run a job that completes while the retry is in flight", verified passing) **and** states why HTTP alone is insufficient post-fix |
| TEST-106 | Cap notice not detected by reading the log | **PASS** | Both halves asserted. (a) Two log lines legitimately containing `log capped at 4194304 bytes; further lines were dropped` — one deliberately placed inside the last-4 KB probe window (`NOTICE in tail[-4096:] → True`) — were **not** mistaken for the notice. (b) The genuine notice was still emitted **exactly once** when the cap was truly reached (`appended: false` at 4194455 bytes, 1 `source:"server"` record). A fix that suppressed the notice would have shown 0 |
| TEST-107 | A ```formula fence is not a form | **PASS** | Four agent turns: real ```` ```form ```` → listed; ```` ```formula ```` → not listed; `>`-quoted **and** 4-space-indented form fences → not listed; ```` ```FORM ```` (uppercase, my addition) → not listed |
| TEST-108 | A resolved thread leaves Attention | **PASS** | After `POST /api/threads/{id}/resolve`: `needs=form` → `[]`. It initially remained in `needs=me` — via its *own* still-live `unread-reply` reason, which the log disclosed. Clearing that reason with `POST …/seen` removed it from `needs=me` as well. Reason-scoped clearing is correct; the criterion's "appears in neither" is under-specified against a thread that legitimately holds a second reason |
| TEST-109 | `needs=me` still contains the union | **PASS** | Built one thread/doc per reason: `unread-reply` `th_y7eettbb`, `form` `th_jphhsioa`, `due` `doc_h45e4qiv` (due 2020-01-01), `stale` `doc_sc6vr7bd` (out-of-band `updated: 2020-01-01`, watcher re-projected), `failed-job` `th_dhybsfex` (real `POST /api/queue/{id}/fail`). All five appear under `needs=me` **and** each under its own individually-addressable reason. The tightened form predicate shrank nothing else |
| TEST-110 | Whitespace-only anchor not orphaned | **N/A → SERVER-014 (Open Conflict 9)** | Landed in `389208e`; covered by the SERVER-014 evaluation |
| TEST-111 | Guard still fires, no contract change | **N/A → SERVER-014 (Open Conflict 9)** | Same |
| TEST-112 | Fresh-commit mutation stages only its own paths | **PASS** | Own fixture on 8977: `git init` with **no commits**, `STAGED-BY-OPERATOR.txt` staged, then `POST /api/docs`. `git show --stat HEAD` → `data/docs/inbox/s022-unborn-probe.md \| 14 ++`, `1 file changed`. `git status` still `A  STAGED-BY-OPERATOR.txt`; `git log --all -- STAGED-BY-OPERATOR.txt` empty. Every git call carried `-C <scratch ws>` |
| TEST-113 | The normal path is unchanged | **PASS** | On the has-HEAD workspace: create → 1 commit naming only its path, trailers `Corpus-Doc: doc_jrf4ynku` / `Corpus-Actor: user`. Squash window measured: two same-actor edits within 30 s → still 1 commit; an **agent** edit → new commit (actor is part of the match); an agent edit after a **32 s** idle → new commit. `SQUASH_IDLE_MS = 30_000` on `Corpus-Doc` + `Corpus-Actor` behaves exactly as specified. An unrelated dirty file (`s022-stale-note.md`) survived every mutation uncommitted |
| TEST-114 | Deleted template does not fail the create | **PASS** | `data/docs/templates/note.md` removed out of band, `POST /api/docs {type:note}` issued immediately (same second, before re-projection) → **201**, `body: ""`, `warnings: []`. Repeated → same. Not a 500, not a refusal. After restore + watcher settle, pre-fill resumed |
| TEST-115 | Pre-fill still works and is body-only | **PASS** | With the template present and no `body`: body = `"\n## Context\n\n## Notes\n\n## Open questions\n"`. New frontmatter keys `[anchors, created, due, evergreen, id, reviewed, status, tags, title, type, updated]` — `type: note` (not `template`), **no `for`**, `evergreen: false` (template's is `true`). No bleed, per SPEC.md §11 |
| TEST-116 | Lock acquired while a write is queued still blocks it | **PASS** | Real parking technique: a `pre-commit` hook that sleeps 8 s holds the doc's lane; a second write is issued 1.5 s later; the agent takes the lease 1.5 s after that. Holding save → 200; queued save → **423** `{"code":"locked","message":"doc_4bun6qmp is being edited by agent; the lock was acquired at …"}`; the queued text never reached disk |
| TEST-117 | The guard runs in every listed path | **PASS** | All six driven over real HTTP with the same technique, each refused **423** naming the holder, each with **no** effect: update (body unchanged) · move (path still `inbox`) · archive (status still `open`) · delete (doc still fetchable) · anchored thread-create (parent's `anchors` still empty) · last-turn cascade (thread still 200). Colocated coverage confirmed too — `locks/write-guard.test.ts > a lease acquired while a write is queued` has 7 verb tests + the control, all passing |
| TEST-118 | An unlocked write is not slowed into different behavior | **PASS** | Same parking setup with **no** lease: holding save 200, queued save 200, disk holds the queued body, and `git log` shows **exactly one** new commit (`669df92 doc edit: S022 lane control (doc_3vblzw6e) by user`) — the §4 squash window, not a doubled side effect |
| TEST-119 | Mark-seen emits the thread's own document key | **PASS** | Read off the attached `curl -N /events`. Standalone: `[["docs"],["docs","th_4xwrsicl"],["threads","th_4xwrsicl"]]`. Parented: `[["docs"],["docs","th_dnygyynh"],["threads","th_dnygyynh"],["docs","doc_wyjxmnn2"]]`. Both carry `["docs", id]` |
| TEST-119a | The materiality is stated, not assumed | **PASS** | The issue states it plainly: "a **pattern-inconsistency fix, not a user-visible behaviour fix**", with the `toWireDoc` evidence. I checked it myself rather than take it: `GET /api/docs/{id}` before and after mark-seen is **byte-identical** (`{anchors, body, frontmatter, path}` — no `unread`), while the collection row's `unread` goes `true → false`. No user-visible fix was claimed, so nothing was over-claimed. FIXED on consistency grounds is legitimate per the criterion |
| TEST-120 | No new key name, and no `["tree"]` | **PASS** | Every emitted key is a closed-vocabulary shape (`["docs"]`, `["docs", id]`, `["threads", id]`); no out-of-vocabulary first segment, no 3-segment key, **no `["tree"]`** on either mark-seen |
| TEST-121 | `dataDir` stops being a lie | **PASS** | Expected branch taken (*dropped with a validation error*), with the rationale citing `roots.ts`'s documented non-goal. Reproduced on 8977: `"content"` and `"../elsewhere"` → daemon refuses, `{"level":"error","msg":"refusing to start with \"dataDir\": \"content\": … set \"dataDir\" to \"data\" in …/.corpus/config.json, or remove the key to use the default"}`, **0 listeners on 8977**. `"data"`, `"./data"`, `"data/"` → boots, `/api/health` `{"status":"ok"}`, no `content/` directory ever created. Only `dataDir` was edited; the token was never printed; `stat` says **600** before and after; the four keys are intact |
| TEST-122 | Lock row keyed by file content is removed when the file goes | **PASS** | Acquire → 1 row + `GET /api/locks` agrees + a user write 423s; release → 0 rows, 0 files, `{"locks":[]}`. Break → same. **Planted disagreement**: `.corpus/locks/doc_bchca37u.json` whose `docId` says `doc_disagreeing` → row inserted under **`doc_bchca37u`** (the filename), the write on that doc 423s, and deleting the file empties both the table and the API. Expired planted lease → no row; `POST /api/locks/reap` → `{"reaped":["doc_bchca37u"]}`, 0 files, 0 rows |
| TEST-123 | Anchored batch does not block the event loop | **N/A → SERVER-020 (Open Conflict 9)** | Landed in `ca7bd27`; covered by the SERVER-020 evaluation |
| TEST-124 | Out-of-band reconciliation still uses git HEAD | **N/A → SERVER-020 (Open Conflict 9)** | Same |
| TEST-125 | STX/ETX cannot forge a highlight | **PASS** | Behaviour observed, not omitted — and the verdict is FIXED rather than WAIVED, which the criterion permits. A document body carrying `FORGERYWORD` and a turn carrying `PASTEDFORGE`: `q=escrow` returns segments `[{"text":"Payment note about ","match":false},{"text":"escrow","match":true},{"text":".\n\nHere is a span: FORGERYWORD and the term…","match":false}]` — the enclosed span is **plain text**, no forged `match: true`. `q=forgeryword` / `q=pastedforge` still mark the enclosed word (searchability preserved). The file on disk still contains both control bytes (SPEC.md §4) |

---

## Failures

None. No FAIL findings were raised.

### Non-blocking observations

**OBS-1 — the TEST-99 table has no rows for the two reassigned findings.** The dispositions for
findings 4 and 10 are recorded twice in prose (the Summary's sprint-reassignment block quote, and
the sentence introducing the verdict table) and both are verifiable against the commit graph.
Adding two `N/A → SERVER-014 / SERVER-020` rows to the table would make the eleven-item coverage
readable in one place. Bookkeeping only.

**OBS-2 — finding 7's E2E section under-claims its own coverage.** The log E2Es the *update*
verb outside the test runner and defers the other five to `locks/write-guard.test.ts`. I drove all
six over real HTTP and all six refuse with 423. The evidence is stronger than the log presents it.

**OBS-3 — TEST-105's escape clause was invoked slightly conservatively.** The log states the
forced race "is not reliably reproducible over HTTP". That is true of *reliably*: in six rounds I
hit the complete-first interleaving once and observed a real-HTTP `409`. The log supplied both
required halves (the colocated test and the reason), so the criterion is met; the note is only
that the HTTP evidence is a little better than claimed.

**OBS-4 — TEST-108's "appears in neither" is under-specified.** A resolved thread whose *other*
Attention reason (unread-reply) is still live legitimately stays in `needs=me`. The log disclosed
exactly this and the disclosure is accurate; the behaviour is correct. Flagged so a future
criterion phrases the union test per-reason.

---

## Summary

SERVER-022 passes. **24 of 24 in-scope criteria PASS; 4 criteria are N/A by Open Conflict 9** and
belong to SERVER-014 (TEST-110/111) and SERVER-020 (TEST-123/124) — a reassignment I verified
against the commit graph rather than took on trust: `dce21d0` touches neither
`anchors/reconcile.ts` nor `watcher/watcher.ts`, and both files are touched in the range only by
`389208e [SERVER-014]` and `ca7bd27 [SERVER-020]`.

Nine findings are fixed, none waived, and every one of them I could reach behaviourally
reproduced on an independent rig — a different workspace, different ports, different fixtures,
and in several places a harder test than the log ran (all six lane verbs rather than one; an
uppercase form fence; a cap-notice quote deliberately planted inside the 4 KB probe window; a
second workspace with an unborn branch built from scratch). Nothing in the E2E log was
contradicted.

Two things distinguish this log from a merely compliant one. Finding 1's author **measured before
changing anything** and reported that the criterion's own optimistic static trace was wrong — the
encoded spellings really did serve another thread's bytes. And TEST-119a is answered with the
actual response shape (`toWireDoc` carries no `unread`), so the fix is claimed on consistency
grounds and nothing user-visible is over-claimed; I verified that the single-document response is
byte-identical across mark-seen, and it is.

TEST-101 holds: every hunk in `dce21d0` maps to a numbered finding, including the two files
outside the findings' named locations (`queue/service.ts` and `projection/project-document.ts`),
each carrying one hunk that is the only place its fix can live. No opportunistic refactor.

Gate re-run at `4ea3e4b`: `apps/server` — **105 files, 2046 tests, 0 failed**.
