# Evaluation: UI-017 — an empty untitled document never survives being left

**Date**: 2026-07-30
**Sprint**: sprint-016 (TEST-417–430)
**Verdict**: **PASS** — flipped from FAIL on re-evaluation of commit `0a8c721`. See
"Re-evaluation (2026-07-30)" at the end of this file. The original FAIL verdict and its
evidence are preserved below unchanged, as the record of what the fix had to close.

**Original verdict (superseded)**: **FAIL** — 13 of 14 executable criteria pass; **TEST-419
fails**, and the failure re-creates the exact artifact the issue was filed to eliminate.

Evaluator environment: own workspace
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-evalui-7655/ws`, own server on `:9196`
(pid 7683), own Vite dev server on `:5294`. `CORPUS_SERVER_ORIGIN=http://127.0.0.1:9196`
exported **before** `npm run dev`; proxy proved below. `8765` empty throughout.

### Proxy proof (Adjudication 2)

```
$ export CORPUS_SERVER_ORIGIN="http://127.0.0.1:9196"     # BEFORE npm run dev
$ npm run dev -w apps/ui -- --port 5294 --strictPort      # pid 7876
$ curl -sS -i -H "Authorization: Bearer $TOKEN" http://localhost:5294/api/health
{"status":"ok","version":"0.0.0","uptimeSeconds":29.611,
 "workspace":"/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-evalui-7655/ws"}
$ lsof -nP -iTCP:8765 -sTCP:LISTEN
(nothing bound on 8765)
```

The workspace path in the answer is the proof the dev proxy reached **my** server. I then ran
the drills against the **real corpus server** at `:9196` serving the built UI — the installed
product's own path, which removes the 8765 hazard entirely rather than merely avoiding it.
Browser: real Chromium via Playwright's API (no Vite of its own, so no e2e single-holder
conflict); `npm run e2e` was never run.

---

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Detailed, with the mechanism decision, two named defects found in the real app, and both halves of Adjudication 19. |
| Commands are specific and concrete | PASS | Real ids, real `curl`/`grep`/`git log` output, a named drill script (`drill-ui017.mjs`, still on disk). |
| Real E2E (not mocked) | PASS | Real workspace on `9187`, real Chromium against `localhost:5290`, disk/git/lock/projection read from the shell. |
| Scenarios cover acceptance criteria | **FAIL** | TEST-419's title-only branch was drilled with `fill(...) + press("Enter")`. The `Enter` is what made it pass. Nothing exercised the gesture the spec itself describes as primary ("title selected, ready to type" → type → leave), and that gesture is broken. |
| Application restarted after changes | PASS | Fresh workspace and server per drill. |
| Actual model recorded | PASS | `implemented on: opus`. |
| Reproduction logged before fix | N/A | Feature issue. |

The log is honest and well above the bar in every other respect — it even records two defects
the real app found that unit tests could not (the template prefill, React's double-mount). The
gap is a **test-design** gap, not a fabrication: the drill scripted a keystroke a user has no
reason to press, and that keystroke is the only thing standing between this issue and the
failure below.

---

## Criteria Results

| # | Criterion | Result | Observed |
| --- | --- | --- | --- |
| TEST-417 | Blank ＋ document, left, leaves nothing | PASS | `doc_735f6c5t`: `GET /api/docs/:id` → **404**; absent from `corpus doc list` (all statuses); no file under `data/docs/` (`grep -rl` finds it only in `.corpus/server.log` and the SQLite WAL); **0 rows** in the projection's `documents` table; `corpus lock list` → "no locks held."; `corpus db doctor` → "projection is clean — 11 documents from 11 files". `git log` pairs it with `user doc delete: Untitled (doc_735f6c5t) by user`. |
| TEST-418 | Typed, then erased, then left | PASS | `doc_5cl24tzz`: typed a body, erased it, left → **404**, no file, no projection row, `user doc delete` in git. History did not save it. |
| TEST-419 | A title alone persists; a body alone persists — **content intact** | **FAIL** | Body-only persists correctly with its content (`doc_pv6swzhe`, body `Kept by body only.` on disk). **Title-only does not**: the document persists but its title does not. See FAIL-1. |
| TEST-420 | Whitespace is not content | PASS | `doc_6sn2n3g5` (title `"   "`, body `"   \n\n   "`) → **404**, `user doc delete` in git. |
| TEST-421 | The "Untitled" placeholder is not a title | PASS | The untouched ＋ document (placeholder title, template-prefill body) does not survive — including the template-prefill case, which the log records as a defect found and fixed in the real app. |
| TEST-422 | The omnibox create path is unaffected | PASS | `Create "zebra planning offsite"` → opened `doc_op4pxr6w`, left immediately with no typing → **KEPT**, `title="zebra planning offsite"`. The omnibox supplies the title in the create request, so it never depends on the broken path. |
| TEST-423 | All five exit routes | PASS (4/5 confirmed, 1 inconclusive) | (1) Back → **GONE**. (2) `esc` → **GONE**. (3) ⇧-Back/⇧esc → **inconclusive**: `Shift+Escape` did not close the reader in my harness (`data-reader-doc` unchanged before and after), so the document correctly persisted — this is a limitation of my synthetic key, not an observed failure. (4) another document taking over the reader (via the omnibox) → **GONE**. (5) reload → **GONE**; **tab close** (`page.close()`, real `pagehide`) → **GONE**. No `beforeunload` dialog: **0** dialogs across every drill (Adjudication 27). |
| TEST-424 | Focus mode behaves identically | PASS | `⤢` into focus mode, `esc` back to the column reader, `esc`/Back out → **GONE**. |
| TEST-425 | Pending autosave does not resurrect | PASS | The deliberate race — type `x`, `Backspace`, click Back inside the 700 ms window — → **GONE**, and no later `PUT` re-created it (`db doctor` clean, no file). |
| TEST-426 | Nothing is orphaned | PASS | After every route: `corpus lock list` → "no locks held."; `corpus db doctor` clean; the Attention view (`?needs=me`) returns **0** items — no reason chip for a document that no longer exists. |
| TEST-427 | A document that acquired a thread is no longer abandonable | PASS | Blank ＋ document, `POST /api/threads` → `201`, then left → **KEPT** (`200`). The thread is not orphaned. |
| TEST-428 | Navigating deeper and back never lands on a tombstone | PASS (by stated resolution) | The log states the resolution TEST-428 requires: a push **is** an exit for the outgoing document and its nav-stack entry is dropped with it, so Back reaches the entry below or the list. Consistent with route 4's observed behavior (the outgoing blank vanished and the reader showed the incoming document, with no error state). |
| TEST-429 | Unit-tested at its seam, both branches | PASS | `apps/ui/src/abandon/{emptiness,registry,abandonEmptyDoc,useAbandonEmpty}.test.*` shipped in commit `0c51d5b`, plus two `useAutosave` race cases. `git log main..HEAD -- scripts/coverage-config.ts` is **empty** — no new exemption (Adjudication 15). |
| TEST-430 | Playwright covers the UI half, the drill the rest | PASS | `apps/ui/e2e/abandon.spec.ts` shipped; the log records one scoped run (`20 passed`) and the disk/git/lock/projection half from the manual drill. Both halves present. |

---

## Failures

### FAIL-1 — a document kept "because it has a title" is written to disk with no title

**Criterion**: TEST-419 ("Both persist, exactly as any document does today: on the board, in
search, on disk, **with their content intact**"), and behind it the signed rule at
`SPEC.md:383`.

**Expected**: a user creates a document with `＋`, types a title into the field the spec says
is already selected and ready ("The new document opens immediately in its column, **title
selected, ready to type**"), and leaves. The document persists with that title.

**Observed**: the document persists — but as **`Untitled`**, with the untouched template
prefill as its body. The typed title is silently discarded. The result is a document that, at
the moment it was written to disk, had no title and no content: exactly the artifact
`SPEC.md:383` says must not survive, and exactly the annoyance the issue was filed for.

The cause is a disagreement between two layers. The reader's title input commits **only on
`Enter`** — it is not part of the autosave stream at all:

```
# the only mutating request a full edit session produces:
PUT /docs/doc_pv6swzhe :: {"body":"Kept by body only. plus."}      # ← no title, ever
```

while UI-017's emptiness predicate reads the **uncommitted, local** title and therefore keeps
the document. Keep-on-a-title-that-will-never-exist is the whole defect.

**Steps to reproduce** (real Chromium, real server on `:9196`):

1. Open the board. In any column, click `＋`. A document is created; the reader opens with the
   title field selected and the body holding the seeded `note` template.
2. Type `Budget review 2027` into the title field. Do **not** press `Enter` — nothing in the
   UI asks you to.
3. Click `‹ Inbox` (Back).
4. `GET /api/docs/<id>` → **200**. The row is on the board reading **"Untitled"**.
5. `corpus doc show <id>`:

```
Untitled
doc_3s2mplca · note · open
data/docs/inbox/untitled-7.md
...
## Context

## Notes

## Open questions
```

**No `Enter` is required to reproduce, and no gesture other than `Enter` avoids it.** I
isolated the commit path exactly, on one document, in order:

```
A) .doc-title + Enter ................ "Via Enter"        ← persisted
B) .doc-title, typed, then leave ..... "Via Enter"        ← the newly typed title was discarded
```

and every blur gesture behaves like (B):

```
blur via Tab .................. title="Untitled"
blur via click column header .. title="Untitled"
blur via Escape ............... title="Untitled"
blur via clicking into the body title="Untitled"
```

**Blast radius observed**: after a normal evaluation session, the Inbox column held **five**
`Untitled` documents whose bodies are the untouched template prefill —
`doc_3s2mplca`, `doc_vixfwvuh`, `doc_xfkywlwe`, `doc_k6foyn3m`, `doc_e4cbeys5` — every one of
them created by typing a title and leaving. Each is byte-for-byte the state UI-017 deletes
when the user types nothing at all.

**Why the implementing agent did not see it**: its drill (`drill-ui017.mjs:44-46, 69-70`)
sets titles with `title.fill("A thought"); title.press("Enter")`. The `Enter` is what made
the title-only case pass. The commit path was never exercised without it.

**Not prescribing a fix** — but note that either layer alone resolves it, and the choice
matters: making the title commit on blur/exit keeps the document *with* its title; making the
predicate read only committed state deletes the document *and* the typed title. The second is
the more literal reading of "the state at exit" and the more surprising to a user.

---

## Summary

**13 of 14 executable criteria pass**, and the passing ones pass convincingly: I independently
confirmed all six of TEST-417's checks (API 404, absent from the doc list, no file on disk, no
projection row, no lock, clean `db doctor`) on three separately abandoned documents, drove four
of the five exit routes plus focus mode to a real deletion, won the deliberate 700 ms autosave
race, and confirmed both persistence branches that must not be destroyed (body-only, and a
document holding a thread). The mechanism the log chose — create-then-delete — is sound and its
two real-app defect fixes (template prefill, StrictMode double-mount) are genuine.

The one failure is not a corner case. It is the flow `SPEC.md:383` describes as the primary one,
it is reachable in three gestures, it silently destroys user input, and its visible outcome is
the empty `Untitled` document the issue exists to eliminate. TEST-419's "with their content
intact" is not met, and the issue's own purpose is not met for a user who types a title.

**Verdict: FAIL.** Fix FAIL-1 and re-drill the title-only branch **without** a synthetic `Enter`.

---

# Re-evaluation (2026-07-30)

**Against**: commit `0a8c721 [UI-017] Evaluator fix: uncommitted title joins the save stream`
(`apps/ui/src/reader/FrontmatterForm.tsx`, `apps/ui/src/reader/DocView.tsx`, plus tests).
`npm run build` run first, so the drills exercise the rebuilt bundle.
**Verdict**: **PASS** — FAIL-1 is closed and nothing it touched regressed. **14 of 14
executable criteria now pass.**

Fresh workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-reval017-17825/ws`
(cwd outside the repository), own server `:9198` (pid 17854), own Vite `:5294` (pid 17999).

### Proxy proof, before any dev server started

```
$ export CORPUS_SERVER_ORIGIN="http://127.0.0.1:9198"    # BEFORE npm run dev
$ npm run dev -w apps/ui -- --port 5294 --strictPort
$ curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:5294/api/health
{"status":"ok","version":"0.0.0","uptimeSeconds":19.915,
 "workspace":"/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-reval017-17825/ws"}
$ lsof -nP -iTCP:8765 -sTCP:LISTEN
(nothing bound on 8765 — never bound, never killed, never proxied into)
```

Pre-flight also confirmed `9180-9199` free. Drills ran in real Chromium against the real
corpus server serving the rebuilt UI.

## FAIL-1 — closed

The identical isolated probe from the original verdict, same shape, same document, in order:

```
=== THE EXACT ISOLATED A/B PROBE (same document, in order) ===
  A) .doc-title + Enter ................ "Via Enter"
  B) .doc-title, typed, then leave ..... "Via typing only"     ← was "Via Enter" before the fix
```

(B) is the line that was broken. The typed title now reaches the server without `Enter`, and
it does so through **every** leave gesture — each on its own fresh `＋` document, each title
read back from `GET /api/docs/:id` after leaving:

| Gesture | Persisted title | Doc |
| --- | --- | --- |
| Back button | `"Kept via Back button"` | `doc_ie7i55s4` |
| `Tab` (blur) | `"Kept via Tab (blur)"` | `doc_zundb3p5` |
| click the column header | `"Kept via click column header"` | `doc_hp4lcxua` |
| click into the body | `"Kept via click into the body"` | `doc_ce5xiexl` |
| close the tab (real `pagehide`) | `"Survives a tab close"` | `doc_6fh5iihe` |

And on disk — the check that matters, since the original failure was a document written
without its title:

```
$ for f in data/docs/inbox/*.md; do grep -m1 '^title:' "$f"; done
data/docs/inbox/untitled.md      title: Via typing only
data/docs/inbox/untitled-2.md    title: Kept via Back button
data/docs/inbox/untitled-3.md    title: Kept via Tab (blur)
data/docs/inbox/untitled-4.md    title: Kept via click column header
data/docs/inbox/untitled-5.md    title: Kept via click into the body
data/docs/inbox/untitled-6.md    title: Untitled              ← the body-only case, correctly untitled
data/docs/inbox/untitled-7.md    title: Survives a tab close
```

No document is kept on the strength of a title that was never saved. The two layers now agree.

## The symmetric abandons still hold

The risk in this fix is the mirror image: a title that now counts as content could keep a
document that should vanish. It does not.

| Case | Result | Evidence |
| --- | --- | --- |
| Untouched `＋` document, left | **GONE** ✓ | `doc_b5uu7aem` → `404`; `user doc create` + `user doc delete` in git |
| Typed-then-erased (title **and** body, both committed then removed) | **GONE** ✓ | `doc_nak6yhy4` → `404`; git reads `user doc edit: A thought (doc_nak6yhy4)` then `user doc delete: A thought (doc_nak6yhy4)` — the title *was* committed and history did not save it, which is TEST-418's sentence exactly |
| Typed-then-`Escape` | **GONE** ✓ | `doc_wfwzpktw` → `404`. `Escape` cancels the title edit — the field reverted to `"Untitled"` while the reader stayed open — so the document was empty at exit and was removed. Commit/cancel semantics are now symmetric and legible. |
| Whitespace-only title and body | **GONE** ✓ | `doc_2n4kllgm` → `404` — whitespace is still not content |
| The 700 ms race (type `x`, erase, leave immediately) | **GONE** ✓ | `doc_wg5uyb4l` → `404`, no resurrecting `PUT` |
| Body-only | **KEPT** ✓ | `doc_fjsxb5hp`, body `Kept by body only.` on disk |

Each of the five abandoned ids passes the full check, not just the API one:

```
  doc_b5uu7aem  GET=404  data/files=[none]  projection_rows=0
  doc_nak6yhy4  GET=404  data/files=[none]  projection_rows=0
  doc_wfwzpktw  GET=404  data/files=[none]  projection_rows=0
  doc_2n4kllgm  GET=404  data/files=[none]  projection_rows=0
  doc_wg5uyb4l  GET=404  data/files=[none]  projection_rows=0
```

**No strays.** `corpus doc list` reports exactly **one** remaining `Untitled` document,
`doc_fjsxb5hp` — the body-only case, whose file carries `Kept by body only.`. It is untitled
by the user's own choice and has content, so it is a keep, not a leftover. Nothing resembling
the five placeholder-titled, template-bodied documents the original verdict found.

Environment after the drills: `corpus lock list` → "no locks held."; `corpus db doctor` →
"projection is clean — 15 documents from 15 files"; **0** confirmation dialogs across the
whole run (Adjudication 27 intact).

Scoped unit run over the touched seam: `VITEST_MAX_THREADS=4 vitest run apps/ui/src/abandon
apps/ui/src/reader/FrontmatterForm` → **5 files, 82 tests, all passing**, including the new
cases in `useAbandonEmpty.test.tsx` and `FrontmatterForm.test.tsx`.

## Revised criteria result

| # | Criterion | Was | Now |
| --- | --- | --- | --- |
| TEST-419 | A title alone persists; a body alone persists — content intact | **FAIL** | **PASS** — title-only persists with its title through five gestures, body-only persists with its body, and neither branch was traded for the other |

All other rows stand as originally recorded. TEST-423's route 3 (⇧-Back to list) remains
inconclusive for the same harness reason as before — `Shift+Escape` does not close the reader
under synthetic keys, so the document correctly persists; that is a limitation of my driver,
not an observed defect, and it is unchanged by this fix.

## Re-evaluation summary

**14 of 14 executable criteria pass. Verdict flipped to PASS.** The fix closes the exact
divergence the original verdict named — the emptiness predicate and the persistence layer now
agree about what a title is — without loosening the rule in the other direction: an untouched
document, a typed-then-erased one, a cancelled title edit, a whitespace-only one and a
lost 700 ms race all still leave nothing behind, each paired with a `user doc delete` in git
and zero rows in the projection.

