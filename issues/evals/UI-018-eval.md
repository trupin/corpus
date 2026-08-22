# Evaluation: UI-018 — right-click opens the item's own actions

**Date**: 2026-07-30
**Sprint**: sprint-016 (TEST-431–444)
**Verdict**: **PASS** — 14 of 14 criteria pass, every headline claim independently re-derived
in a real browser against a real workspace.

Evaluator environment: own workspace `…/s016-evalui-7655/ws`, own server `:9196` (pid 7683),
own Vite `:5294` with `CORPUS_SERVER_ORIGIN=http://127.0.0.1:9196` exported before it started;
proxy proved (see UI-017-eval.md, same session). Drills ran in real Chromium against the real
corpus server serving the built UI. `8765` empty throughout, never bound, never proxied into.
`npm run e2e` never run.

---

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Includes the TEST-443 placement decision with its reason, the one-source and one-dismissal-story sections, and a "found in the browser, not in jsdom" note. |
| Commands are specific and concrete | PASS | Named drill (`drill-ui018.mjs`, on disk), real ids, real `git log`/`grep`/`curl` output. |
| Real E2E (not mocked) | PASS | Real workspace on `9189`, real right-clicks in real Chromium, a real Archive and a real Delete that changed the corpus and appear in `git log`. |
| Scenarios cover acceptance criteria | PASS | Every TEST-431–444 has a drill step, a spec, or a stated placement decision. |
| Application restarted after changes | PASS | Fresh workspace + server for the drill. |
| Actual model recorded | PASS | `implemented on: opus`. |
| Reproduction logged before fix | N/A | Feature issue. |

The log's disclosure of the `compose-keyboard.spec.ts` pin change is exactly the kind of thing
Adjudication 13 exists to catch, and it survives scrutiny — see TEST-444.

---

## Criteria Results

| # | Criterion | Result | Observed (re-derived) |
| --- | --- | --- | --- |
| TEST-431 | Right-clicking a document row opens that row's actions | PASS | Menu opens at the pointer: `<div class="ac-menu open ctx-menu" role="menu" aria-label="Actions for zebra planning offsite" data-ctx-menu="true" style="left: 536px; top: 192px;">` with items `Open` · `Open in focus` · `Archive` · `Delete…`, each carrying a description line. Matches `SPEC.md:395`'s row enumeration (resolve/reopen is thread-only — confirmed below). |
| TEST-432 | Staleness actions appear only where they already appear | PASS | I aged a note on disk (`updated: 2024-…`) until `corpus doc list` reported `stale: very-stale` / `data-row-level="3"`. **Stale note row** → `Open · Open in focus · Still current · @agent triage · Archive · Delete…`. **Fresh note row** (`data-row-level="0"`) → `Open · Open in focus · Archive · Delete…`. The two extra items appear exactly at the stale tier and nowhere else. |
| TEST-433 | The menu targets the item under the cursor, not the selection | **PASS — headline claim re-derived** | Keyboard highlight placed on `doc_op4pxr6w` (`.row.kbd`, "zebra planning offsite"); right-clicked a *different* row, `th_rkr7fki6` ("Re: Untitled"). Menu opened as **`Actions for Re: Untitled`** — row B's, not the highlight's. |
| TEST-434 | Delete keeps its explicit confirmation | PASS | The item reads `Delete…` / "user-only · click twice to confirm". After **one** activation it re-reads `Really delete? Click again` / "permanent · git keeps history · its threads become orphaned records", and **zero** `DELETE` requests have been sent. Pressing `Escape` instead of confirming leaves the count at **zero**. |
| TEST-435 | Each surface opens its own set | PASS | **Column header** → `Rename` · `Edit query` · `Unpin` (the `ColumnMenu` set). **Open reader** → `Still current` · `Archive` · `Delete…`. **Thread row** → `Open` · `Open in focus` · **`Resolve`** · `Archive` · `Delete…` — resolve appears on threads only. **Console job row, `failed`** → `↗ open` · `Retry` · `Abandon`. **Console job row, `in-progress`** → **`↗ open` only** — no Retry, no Abandon, matching the detail header. |
| TEST-436 | The native menu survives where it is the useful one | **PASS — headline claim re-derived** | I instrumented `document.addEventListener("contextmenu", …)` and read `defaultPrevented` after each right-click: **inside the editor body** → corpus menus `0`, `preventDefault=false`; **on a text selection** (⌘A inside the editor) → `0`, `false`; **in the title `<input>`** → `0`, `false`; **empty board background** (`MAIN.board`, right of the last column) → `0`, `false`; **top-bar empty area** → `0`, `false`. Copy-on-selection and in-editor spellcheck are intact. |
| TEST-437 | Plugin-rendered surfaces are out of scope, demonstrably | PASS | Created a real `type: todo` document. **Plugin `ListItem` row** → right-click yields **no** corpus menu. **Plugin `View` body** (`<div class="doc-main" data-plugin-surface="">`) → corpus menus `0`, `preventDefault=false`. Native menu, not a half-populated Corpus one. |
| TEST-438 | The menu key / ⇧F10 opens the menu on the keyboard highlight | **PASS — headline claim re-derived** | Highlight on `th_rkr7fki6`; `Shift+F10` → menu `Actions for Re: Untitled`, anchored to that row, with `document.activeElement` carrying `data-act="open"` — the **first item focused**. |
| TEST-439 | The menu follows the app's menu conventions | PASS | `Escape` dismisses (menu count `1` → `0`). `ArrowDown` moves focus `open` → `open-focus`. An outside click dismisses (count → `0`). The menu is positioned at the pointer via inline `left`/`top`. |
| TEST-440 | The action lists have one source, not two | PASS | The reader's `⋯` sheet and the reader's context menu returned **byte-identical** item arrays: `["Still current\nsets reviewed: now — resets staleness", "Archive\nreversible — hidden from default lists", "Delete…\nuser-only · click twice to confirm"]`. Same descriptions, same order, same availability — one declaration (`menu/docActions.ts`), two presentations. |
| TEST-441 | Every action stays reachable without a pointer | PASS | The row menu's whole set is reachable by keyboard through TEST-438's ⇧F10 opening plus TEST-439's arrow/↵ navigation, which is exactly the satisfaction route the criterion names. The reader's set keeps its existing `⋯` route. No action is context-menu-exclusive. |
| TEST-442 | `ColumnMenu`'s divergent dismissal is reconciled, not duplicated | PASS | `apps/ui/src/board/ColumnMenu.tsx` is **deleted** in commit `0c51d5b` (`-70` lines) and is absent from the tree. The column header's `⋯` now dismisses identically to every other menu: `Escape` → `0` menus open; outside click → `0` menus open. One dismissal story, not three. |
| TEST-443 | Where the primitive lives is decided deliberately | PASS | The log states the choice and the reason (Adjudication 21: no kit export without a consumer). Verified mechanically: commit `0c51d5b` touches **zero** files under `packages/kit`; the primitive is `apps/ui/src/menu/ContextMenu.tsx`. |
| TEST-444 | Coverage and evidence | PASS | Unit tests shipped at `apps/ui/src/menu/{menuModel,nativeMenu,ContextMenu,rowContextMenu}.test.*`; `apps/ui/e2e/context-menu.spec.ts` shipped and run scoped once (`20 passed` alongside the other two specs); the real-app drill shows an Archive and a Delete from the context menu changing the corpus with `git log` pasted. `git log main..HEAD -- scripts/coverage-config.ts` is **empty** — no new exemption. |

---

## The disclosed test change, audited (Adjudication 13)

Commit `8c73173` widens `compose-keyboard.spec.ts`'s cheat-sheet pin from **twelve** §10
bindings to **thirteen**, adding `menu.open`. Adjudication 13 makes weakening a test to reach
green a fail, so I read the diff rather than the log's account of it:

- The count is not loosened — it is re-pinned at a **specific** new number, with the added
  binding named explicitly in the expected list and placed among the row bindings.
- The change carries a comment naming the §10 sentence the thirteenth comes from ("the menu key
  (or ⇧F10) opens the same menu on the current keyboard highlight"), which is a real, signed
  clause of the amended spec.

This is a pin reconciled to an amended spec, not a pin relaxed to accommodate code. It passes.
(The companion `reader.spec.ts` change belongs to UI-019 and is audited there.)

---

## Observations (non-blocking)

- **My one apparent negative was my own error.** A first pass reported a Corpus menu with
  `preventDefault=true` on "empty board background" — the selector `.board` resolved to an
  element whose bounding-box centre sits over a *column*. Right-clicking a genuinely empty
  region (right of the last column, and the top-bar gutter) gives the native menu. Recorded
  because a less careful evaluator would have filed it as a failure.
- The menu's `aria-label` naming the target item ("Actions for <title>") is what made TEST-433
  cheap to verify unambiguously — worth keeping.

---

## Summary

**14 of 14 criteria pass.** All three headline claims were re-derived from scratch: the menu
targets the row under the cursor and not the keyboard highlight (highlight on
`doc_op4pxr6w`, menu on `th_rkr7fki6`); the native menu is preserved wherever it is the useful
one, verified by reading `defaultPrevented` on the real `contextmenu` event rather than by
eyeballing a screenshot; and `⇧F10` opens the same menu on the keyboard highlight with the
first item focused. Beyond those, the four surfaces each open their own correct set (including
the running-vs-failed job distinction), Delete keeps its two-activation arm, the reader's `⋯`
and its context menu render byte-identical lists from one declaration, `ColumnMenu` is gone
rather than duplicated, and `packages/kit` is untouched.

**Verdict: PASS.**
