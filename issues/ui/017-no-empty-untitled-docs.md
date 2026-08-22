# [UI-017] Never leave an empty untitled document behind

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-006 (editor), UI-005 (reader navigation)
- Blocks: —

## Spec References
- SPEC.md §10 — "Creating documents" bullet, amended and signed off 2026-07-30 (SHARED-004), user's rule verbatim-in-substance: **any document with no title and no content is auto-deleted on exit, whatever the exit route — including typed-then-erased**. The mechanism (defer-creation vs create-then-delete) is deliberately out of spec; the observable guarantee (board/search/disk/threads/locks clean) is what tests assert.

## Summary
User request (2026-07-29, follow-up phase after PR #11): creating a document in the UI
and exiting without typing anything currently leaves an empty, untitled document in the
corpus. Desired behavior: exiting a still-empty new document deletes it — equivalently,
never persist an empty + untitled document from the UI create flow. Design question for
the spec pass: create-then-delete-on-exit vs. defer-creation-until-first-content (the
latter avoids commit noise in the git audit trail but changes when the doc id exists,
which threads/anchors may assume). Server participation (a delete or deferred-create
call) makes this potentially cross-domain — decompose after the spec amendment if so.

## Acceptance Criteria
- [x] spec-writer amends SPEC.md with the chosen behavior (user-signed-off)
- [x] Exiting a new document that has no title and no body content leaves no document behind (board, search, disk, git all clean per the chosen design)
- [x] A new document with any content (title or body) persists exactly as today
- [x] No orphaned locks/threads from the abandoned doc

## Technical Design

### Files to Create/Modify
- apps/ui document create/exit flow (locate from UI-005/UI-006); possibly a server/contract rider after decomposition

### Key Implementation Details
To be refined after the spec amendment.

### Edge Cases
- Exit via navigation, tab close, and SSE-driven board refresh mid-edit.
- Content typed then fully deleted before exit — still "empty"?
- Autosave (UI-013 buffer semantics) interacting with the abandon path.

## Testing Strategy
Vitest for flow logic; Playwright e2e for the abandon path.

## E2E Verification Plan

### Verification Steps
1. Real app: create doc → exit untouched → board shows nothing, `data/docs/` clean, no commit (or per chosen design)
2. Create doc → type → exit → persists

## E2E Verification Log

**implemented on: opus** (issue recommendation: opus).

### Mechanism chosen: **create-then-delete**, not defer-creation (Adjudication 12)

Defer-creation would not have removed the need to delete: TEST-418's typed-then-erased
document *must* be created the moment content appears, and removed again when it is taken
away. So deletion is required either way, and deferring creation on top of it would mean a
second, phantom document state threaded through the reader, the frontmatter form, autosave,
the user lock, the anchor layer and the thread queries — every one of which assumes a real
document id and a real `GET /api/docs/:id`. The observable rule is identical, so the
cheaper mechanism wins.

**"Exiting the doc" = the document stops being displayed in a reader** (Adjudication 17),
counted per document rather than per reader: `apps/ui/src/abandon/registry.ts` holds a
*count* of the readers showing it, so closing focus mode over a document its column still
has open is not an exit. Switching the active column is not an exit either.

**TEST-428 resolution, stated as the test requires**: a push (following a `[[ref]]`, or a
search/console link opening another document into the same reader) **is** an exit for the
outgoing document, and its navigation-stack entry is dropped **with** it
(`useNavStack.drop`, driven by the registry's `announceAbandoned`). Back therefore never
lands on a tombstone — it reaches the entry below, or the list.

### Two defects the real app found that no unit test could

1. **Templates.** `corpus init` seeds a `note` template (SPEC.md §10 — "Templates are
   documents"), so a `＋` document is born holding `## Context / ## Notes / ## Open
   questions`. The first drill run therefore deleted nothing on the untouched path: the
   body was not blank. Fixed by recording the body a document was *born* with
   (`publishPristineBody`, published by `useCreateInColumn`) and treating an unchanged
   prefill as no content, compared through the editor's own `canonicalizeMarkdown` so a
   round trip is not mistaken for an edit.
2. **React's development double-mount.** StrictMode releases a reader in the same commit it
   takes it, which reached the exit path with the document still open and wiped the
   create-time state. Fixed by deferring the removal one microtask and skipping it if the
   document has been retained again (`scheduleAbandonEmptyDoc`).

### Part 1 — the real app, real server, real files

Workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-ui017-LAoOOW`, created from
a cwd **outside** this repository, server on `9187`, Vite on `5290`.

**Proxy target proved (Adjudication 2).** `export CORPUS_SERVER_ORIGIN="http://127.0.0.1:9187"`
before `npm run dev`, then a request *through the dev port*:

```
$ curl -sS -i -H "Authorization: Bearer $TOKEN" http://localhost:5290/api/health
HTTP/1.1 200 OK
content-type: application/json

{"status":"ok","version":"0.0.0","uptimeSeconds":38.34,
 "workspace":"/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-ui017-LAoOOW"}

$ lsof -nP -iTCP:8765 -sTCP:LISTEN
(nothing bound on 8765)
```

The workspace path in the answer is the proof: the dev proxy reached **my** server, and
`8765` was never bound, never killed and never proxied into.

**The drill** (real Chromium against `http://localhost:5290`, script
`drill-ui017.mjs` in the scratch workspace):

```
== A. create with ＋, leave untouched ==      created: doc_hgqqsk7q   rows after Back: []
== B. type a title and a body, erase both ==  created: doc_ge5flwn5   rows after Back: []
== C. title only — persists ==                KEPT_C=doc_xhh5a7wm     rows: ["doc_xhh5a7wm"]
== D. body only — persists ==                 KEPT_D=doc_nqlrckt6     rows: ["doc_nqlrckt6","doc_xhh5a7wm"]
== E. blank, then close the TAB (pagehide) == ABANDONED_E=doc_dvkcnk5w
== F. focus mode over the column reader ==    ABANDONED_F=doc_aef3p5h5
== G. another document takes over the reader  ABANDONED_G=doc_acuvezyz
== H. a whole-document thread was opened ==   KEPT_H=doc_ujnomons
```

**The six checks TEST-417 demands, per abandoned id:**

```
  ABANDONED doc_hgqqsk7q -> 404      KEPT doc_xhh5a7wm -> 200
  ABANDONED doc_ge5flwn5 -> 404      KEPT doc_nqlrckt6 -> 200
  ABANDONED doc_dvkcnk5w -> 404      KEPT doc_ujnomons -> 200
  ABANDONED doc_aef3p5h5 -> 404
  ABANDONED doc_acuvezyz -> 404

  grep -rl <id> data/ .corpus/  ->  only .corpus/server.log (a log, not the corpus)
  ls data/docs/inbox/           ->  untitled.md  untitled-2.md  untitled-3.md   (the three KEPT)
  corpus doc list --status archived,open  ->  none of the five ids present (12 docs)
  corpus lock list              ->  "no locks held."
  corpus db doctor              ->  "projection is clean — 12 documents from 12 files (1ms)"
  data/threads/th_p6s3pr35.md   ->  parent: doc_ujnomons   (the KEPT one; no orphan)
```

`git log --format='%an %s'` in the scratch workspace pairs every abandonment with a
user-authored deletion — note case B, where the title *was* committed and then erased, and
history did not save it:

```
user doc delete: Untitled (doc_acuvezyz) by user
user doc delete: Untitled (doc_aef3p5h5) by user
user doc delete: Untitled (doc_dvkcnk5w) by user
user doc delete: A thought (doc_ge5flwn5) by user
user doc edit:   A thought (doc_ge5flwn5) by user
user doc delete: Untitled (doc_hgqqsk7q) by user
user doc create: Untitled (doc_hgqqsk7q) by user
```

No confirmation dialog appeared at any point (Adjudication 27) — asserted in the browser
too (`abandon.spec.ts`, a `dialog` listener that never fires).

### Part 2 — Playwright, scoped, once (Adjudication 19)

`apps/ui/e2e/abandon.spec.ts` (4 tests) over `apps/ui/e2e/stubCorpus.ts`, a browser-side
API stub so the spec stays green in the suite's backend-less configuration. Run once:

```
$ CORPUS_SERVER_ORIGIN=http://127.0.0.1:9187 CORPUS_UI_PORT=5290 \
  playwright test abandon.spec.ts context-menu.spec.ts column-width.spec.ts --workers=1
  20 passed (15.9s)
```

### Unit tests (TEST-429)

`VITEST_MAX_THREADS=4 vitest run apps/ui/src` — **98 files, 1446 tests, all passing.** New:
`apps/ui/src/abandon/{emptiness,registry,abandonEmptyDoc,useAbandonEmpty}.test.*` (the
predicate's every branch, the registry, the act, and the exit path through the real
`Reader`), plus two cases in `apps/ui/src/editor/useAutosave.test.tsx` for the in-flight
race. No new exemption in `scripts/coverage-config.ts`.

### Blast radius

`apps/ui` only. `git diff SPEC.md` and `git diff packages/contract` are **empty** for this
issue — neither was touched.

### Evaluator fix round — FAIL-1 (TEST-419's title-only branch)

**What was wrong.** The title input committed **only** on `Enter` or the Save button — it was
never part of the save stream — while the emptiness predicate read the *uncommitted local*
draft. So typing a title and leaving kept the document on the strength of a title that would
never be written, and produced exactly the artifact this issue deletes: a document whose
state on disk was `Untitled` plus the untouched template prefill. My original drill passed
TEST-419 only because it scripted `press("Enter")`, a keystroke nothing in the UI asks for.

**The fix, within the signed rule** — leaving with a typed title now persists **both** the
document and the title:

- `FrontmatterForm` gained an **exit flush** on the same seams the abandon registry watches:
  the form's unmount and `pagehide`. Its notices moved from per-call to **hook-level**
  callbacks (`SettledCallbacks`), because a save issued while the reader is unmounting has no
  observer left and would otherwise commit in silence.
- `DocView` now **keys the form by document id** (prefixed, so it does not collide with the
  editor's key on the same parent), so a reader rebinding to another document flushes the
  outgoing document's draft instead of leaking it onto the incoming one.
- The flush **declines for an abandoned document**, exactly as autosave's does. The ordering
  is load-bearing: the abandon decision is taken in the host's *layout*-effect teardown,
  ahead of this passive one, so the blank case still deletes and no `PUT` chases the `DELETE`.
- The predicate now judges **persisted-or-about-to-persist** state: the draft title is
  published only when it can actually be written, and is withheld under a foreign lock, where
  nothing the form holds can reach the corpus.

**Regression tests that fail on the old behaviour.** Three in
`apps/ui/src/abandon/useAbandonEmpty.test.tsx` (title typed and left → one `PUT {title}` and
no `DELETE`; typed-then-erased → `DELETE` and no `PUT`; an uncommitted title never lands on
the document that took the reader) — verified red by disabling only the unmount flush:

```
× persists the title a user typed and left without pressing Enter
  → expected [] to have a length of 1 but got +0
× does not write an uncommitted title onto the document that took the reader
  → expected [] to have a length of 1 but got +0
```

and green with it. Two more in `apps/ui/e2e/abandon.spec.ts`, including the evaluator's A/B
probe in one test.

**Re-drilled in the real app** — fresh workspace
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-ui017fix-G5Dfie`, server `9188`, Vite
`5290`, `CORPUS_SERVER_ORIGIN` exported before `npm run dev` and proved:

```
PROXY PROOF — /api/health through the Vite dev port 5290:
  status   : ok
  workspace: /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-ui017fix-G5Dfie
  8765: nothing bound, never proxied into
```

The evaluator's A/B probe and every blur gesture it listed, plus the symmetric cases:

```
  OK A) title + Enter             200  title='Via Enter'
  OK B) title, then leave         200  title='Via leaving'
  OK C) blur via Tab              200  title='Blur via Tab'
  OK D) blur via column header    200  title='Blur via column header'
  OK E) blur via clicking body    200  title='Blur via body'
  OK F) typed + Escape (revert)   404  (gone)
  OK G) typed then erased         404  (gone)
  OK H) untouched                 404  (gone)
  OK I) typed + tab close         200  title='Typed then tab closed'
```

`git log --format='%an %s'` shows a `doc edit` carrying each surviving title and a
`doc delete` for each of F/G/H; `corpus lock list` → "no locks held."; `corpus db doctor` →
"projection is clean — 14 documents from 14 files". Not one `Untitled` template-prefill
document was left behind.

**Verification**: `vitest run apps/ui/src` → **98 files, 1449 tests, all passing**; scoped
Playwright (`abandon.spec.ts reader.spec.ts`, `--workers=1`, own port, `CORPUS_SERVER_ORIGIN`
pinned) → **12 passed**; lint, format and typecheck green. `apps/ui` only.

### PR #12 fix round (2026-07-30, opus) — the tab-close route

The reviewer found that the tab-close exit was the weak one: the title flush went out on a client
the browser cancels, and nothing enforced that the abandon decision preceded the flushes. Both
fixed in `apps/ui` only.

- **MINOR 13 — `reader/FrontmatterForm.tsx`.** The `pagehide` flush now goes through
  `abandon/unloadClient.ts` (`keepalive: true`), the same client the abandon `DELETE` uses; the
  unmount/rebind flush still goes through the hook (whose `SettledCallbacks` carry the toast). One
  helper, `outgoingWrite()`, decides what to send, so the two routes cannot drift about the
  abandoned-document guard.
- **MINOR 14 — new `abandon/pagehide.ts`.** Three surfaces acted on `pagehide` as plain listeners,
  fired in registration order = effect order = child-before-parent — i.e. the editor's flush **ran
  before** the reader's abandon decision, which is the `PUT`-racing-`DELETE` this rule exists to
  avoid. There is now one listener and two phases: `decide` (`useAbandonEmpty`) runs to completion
  before `flush` (`useAutosave`, `FrontmatterForm`). That restores, on the tab-close route, exactly
  the guarantee layout-effect teardown gives every other route (sprint-016 TEST-425).
- **MINOR 15 — `abandon/emptiness.ts`.** The `hasExtra` comment justified the guard with the old
  §12 (`extra.items`), falsified by this PR. Re-checked and re-justified: `extra` is opaque
  passthrough the core never interprets (§8's `extra_json`, §12), so a blank body is no evidence
  about a document that has any. The guard still stands — but **not** for todos: §12 puts items in
  the body, so a todo with items has a non-blank body and never reaches it, and an empty new one is
  correctly removed like any other note.
- **NIT 24 (second half) — `abandon/registry.ts`.** The pristine map is the one that outlives its
  document; documented rather than trimmed (trimming it earlier is what broke the `＋` path once).
  Bounded by documents created in this tab's session, one body string each.

**Red-bar proof (jsdom).** Ordering and keepalive reverted: `Tests 2 failed | 73 passed (75)` —
`has decided the removal before any flush handler runs` → *"expected [ false ] to deeply equal
[ true ]"* (the flush handler saw `isAbandoned === false`), and `sends a typed title through the
keepalive client when the tab goes away` → the keepalive `updateDoc` was never called.

**Red-bar proof (real browser + real server, A/B).** Workspace
`…/tmp/pr12-fix/ws` on `127.0.0.1:9186` (pid 87229, `corpus init --port 9186` run from a cwd
outside this repo), Vite on `9188 --strictPort`, `CORPUS_SERVER_ORIGIN` exported before it and
proven mine — `curl http://localhost:9188/api/health` → `"workspace":"…/tmp/pr12-fix/ws"`. Same
drill both ways: ＋ a document, type a title, `page.goto("about:blank")` (a genuine unload), then
read the file back with the CLI.

```
post-fix (keepalive):      corpus doc show doc_ej6k5s62 → "Typed and closed"   data/docs/inbox/untitled.md
pre-fix  (ordinary client): corpus doc show doc_3xoyk7dy → "Untitled"           data/docs/inbox/untitled-2.md
```

The typed title is **lost on disk** without the fix and committed with it. (A permanent Playwright
spec for this is not possible: a `keepalive` request issued during unload is detached from the
frame, so neither `page.route` nor `page.on("request")` observes it — the earlier attempt was
removed rather than left as a test that cannot fail for the right reason. The deterministic proof
is the jsdom test above; this is the corpus half.)

New tests: `apps/ui/src/abandon/pagehide.test.ts` (4) and 3 in
`apps/ui/src/abandon/useAbandonEmpty.test.tsx`. `8765` was never bound, proxied to, or killed.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[ISSUE-ID]` prefix
