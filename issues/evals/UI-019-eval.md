# Evaluation: UI-019 — column width is a property of the view document

**Date**: 2026-07-30
**Sprint**: sprint-016 (TEST-445–455)
**Verdict**: **PASS** — 11 of 11 criteria pass, with the headline chain (drag → frontmatter
write → idle-squashed single commit → second browser context sees it) re-derived end to end.

Evaluator environment: own workspace `…/s016-evalui-7655/ws`, own server `:9196` (pid 7683),
own Vite `:5294` with `CORPUS_SERVER_ORIGIN=http://127.0.0.1:9196` exported before it started;
proxy proved (see UI-017-eval.md, same session). Drills ran in real Chromium against the real
corpus server. `8765` empty throughout, never bound, never proxied into. `npm run e2e` never run.

---

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Contract no-op justification, drill transcript, the frontmatter dump, the squash proof, the relative-widening measurement, and the TEST-455 gap write-up. |
| Commands are specific and concrete | PASS | Named drill (`drill-ui019.mjs` + `drill-ui019b.mjs`, both on disk), real `sed`/`git log`/`grep -c` output, measured pixel values. |
| Real E2E (not mocked) | PASS | Real workspace on `9191`, real pointer drags in real Chromium at 1600×900, frontmatter and git read from the shell. |
| Scenarios cover acceptance criteria | PASS | Every TEST-445–455 has drill evidence or a stated, checked finding. |
| Application restarted after changes | PASS | Fresh workspace + server for the drill. |
| Actual model recorded | PASS | `implemented on: opus`. |
| Reproduction logged before fix | N/A | Feature issue. |

---

## Criteria Results

| # | Criterion | Result | Observed (re-derived) |
| --- | --- | --- | --- |
| TEST-445 | A column is resized by dragging its edge | PASS | `.col-resizer` (`role="separator"`, `aria-orientation="vertical"`, `aria-valuenow/min/max`). A single pointer drag: width tracked the pointer live through **376 → 426 → 476 → 526 → 576** px and stayed at **576** on drop. No board scroll and no column reorder started during the drag. |
| TEST-446 | The width is written to the view document's frontmatter, through the server | **PASS — headline claim re-derived** | The drag produced exactly one mutating request: `PUT /docs/doc_seedinbox :: {"extra":{"width":576}}`. `GET /api/docs/doc_seedinbox` then reports `extra = {"width":576}`, and `data/docs/views/inbox.md` gains `width: 576` in its frontmatter. No `localStorage`, no browser-local width — the payload is the whole write. |
| TEST-447 | The merge does not clobber other frontmatter | PASS | Before: `{pinned:true, order:2, query:{folder:"inbox"}}`, `extra: {}`. After the width write: `{pinned:true, order:2, query:{folder:"inbox"}}` — **unchanged** — with `extra: {"width":576}` beside them, and the file on disk carrying `pinned: true` / `order: 2` / `query:` / `width: 576`. The PUT sends only the one key, so the RFC 7386 merge is proven rather than assumed. |
| TEST-448 | One drag is one `PUT` and one commit | **PASS — headline claim re-derived** | Three drags inside ~5 s produced exactly three PUTs, one per drag, none per `pointermove`: `{"extra":{"width":516}}`, `{"extra":{"width":466}}`, `{"extra":{"width":546}}`. Then the squash: across **seven** completed drags in one idle window, `git log -- data/docs/views/inbox.md` went from **2** commits (init + one earlier edit) to **3** — a single new entry for all seven. History stayed meaningful. |
| TEST-449 | Persists across reload and syncs across browsers | **PASS — headline claim re-derived** | Reload → the width came back at **360** px, read from the view document. A **second browser context** (separate `browserContext`, separate storage) opened on the same workspace read **360**. I then dragged in the first context to **260** and the second context reached **260** on its own, with no manual reload — the SSE invalidation path works. |
| TEST-450 | Reader-open widening is relative to the chosen width | PASS | Base **260** px → opening a document widened it to **433** px, not a fixed 560. 260 × (560/336) = 433.3, and a default-width column still lands on exactly **560** (observed on a 336 px column). The hard `.col.reading { width: 560px }` constant is gone; the ratio is preserved. |
| TEST-451 | Bounds are enforced and degradation is sane | PASS | Dragging far right clamps at **960** px, far left at **240** px — matching the resizer's own `aria-valuemin="240"` / `aria-valuemax="960"`. The board kept rendering all four columns and scrolling horizontally at their chosen widths. |
| TEST-452 | A stored width that is nonsense does not break the board | PASS | Wrote each value straight into `extra` over the API (the server accepts all of them, `200`, by design — it never interprets `extra`) and reloaded the board: `"enormous"` (a string) → renders at the default **336**; `-400` → **336**; `0` → **336**; `999999` → clamped to **960**. In every case all four columns rendered and `pageerror` count was **0**. |
| TEST-453 | Plugin columns honor the same mechanism | PASS | Created a pinned `type: view` column querying `{type:"todo"}` — a plugin-rendered column over a real `type: todo` document. Dragging its edge behaved identically and produced `PUT /docs/doc_p2bgpw6l {"extra":{"width":486}}`. Nothing in the width path is conditioned on the column being a core type. |
| TEST-454 | No settings panel appears | PASS | No settings surface anywhere in the shipped UI: `/settings/i` does not match the rendered page text and `[aria-label*="ettings"], [title*="ettings"]` matches **0** elements. No gear icon, no global width preference. |
| TEST-455 | The agent-stewardable claim is checked, and its gap recorded | PASS | The log records the gap precisely, and I confirmed it independently: `corpus doc edit --extra 'width=700' --from agent` → `corpus: unknown flag "--extra" for "edit".` with the known-flag list printed (`--title, --add-tag, --remove-tag, --status, --due, --reviewed, --evergreen, --message, --file`) — **no way to write an arbitrary `extra` key**. Since the agent is CLI-only, `SPEC.md:377`'s "@agent make the finance column wider" is unreachable today. The gap was filed rather than fixed, exactly as Adjudication 23 requires: **`CLI-016 — corpus doc edit --extra: agent-writable extra frontmatter (UI-019 escalation)`** is in `issues/PLAN.md:195`. |

---

## Contract no-op, verified (TEST-466 / Adjudication 22)

`git log --oneline main..HEAD -- packages/contract` names only
`3717887 [CONTRACT-020][CONTRACT-021]` — a wave-1 contract-dev commit. UI-019 amended nothing
in place. The width rides the shipped `extra` passthrough end to end, as the adjudication
predicted at contract time.

---

## The disclosed test change, audited (Adjudication 13)

Commit `8c73173` rewrites `reader.spec.ts`'s assertion that `.col.reading` declares
`width: 560px`. Since UI-019 deliberately deletes that constant, the old assertion pinned a
rule the stylesheet no longer states. I read the diff rather than the log's account of it:

- The stylesheet half now pins `.col { width: 336px }` — the prototype's default, still a
  hard assertion — plus the surviving `transition-property`/`transition-duration: 0.25s` on
  `.col.reading`.
- A **new running-board test** asserts that a column with no chosen width opens to exactly
  `560px`, over `stubCorpus`.

The 560 px pin was **moved to where it now lives, not dropped**, and the replacement asserts
observable behavior rather than a CSS constant — strictly stronger than what it replaced. It
passes. My own measurement corroborates it: a 336 px column opens to 560, a 260 px column to
433.

---

## Observations (non-blocking)

- The board renders the chosen width as an inline `style="width: 336px"` on `.col` and mirrors
  it into `aria-valuenow` on the resizer, which is what made every measurement in this
  evaluation unambiguous. Note that `aria-valuenow` tracks the **base** width, not the widened
  reading width (a 336 px column open for reading shows `style="width: 560px"` with
  `aria-valuenow="336"`) — correct, since the base is what the drag controls, but worth
  knowing before someone "fixes" the apparent mismatch.
- `PUT` with `{"extra":{"width":"enormous"}}` returns `200` and lands the string in
  frontmatter. That is the documented design (the server never interprets `extra`), and the UI
  is correctly the only place it is caught — TEST-452 confirms it degrades to the default
  rather than blanking the board.

---

## Summary

**11 of 11 criteria pass.** The headline chain was re-derived in full and in order: a real
pointer drag moved the column live and stopped where dropped; it produced exactly one
`PUT /api/docs/doc_seedinbox {"extra":{"width":576}}` and nothing else; `pinned`, `order` and
`query` survived the RFC 7386 merge untouched on disk; seven drags inside one idle window
collapsed into a **single** git commit; and a second browser context picked the new width up
live over SSE without a reload. Reader-open widening is a ratio over the chosen base rather
than the old 560 px constant, bounds clamp at the resizer's own advertised 240/960, four
different kinds of nonsense stored width all degrade to the default with zero page errors, a
plugin column behaves identically, and there is no settings surface anywhere.

The one gap in the signed spec — no CLI path writes an arbitrary `extra` key, so
`SPEC.md:377`'s agent-stewardability promise is not yet true — was correctly recorded rather
than quietly fixed, and has been filed as `CLI-016`.

**Verdict: PASS.**
