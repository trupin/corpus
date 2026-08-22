# Evaluation: UI-022

**Date**: 2026-07-30
**Sprint**: N/A (post-Phase-5 polish batch, branch `ui-022-reader-polish`)
**Evaluator model**: Opus 5 (`claude-opus-5[1m]`)
**Verdict**: PASS

## Rig

Nothing mocked; nothing read from source.

| Piece | Value |
| --- | --- |
| Workspace | `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/eval-polish/ws` (`corpus init … --port 8802`, from-source CLI `apps/cli/src/bin/corpus.ts` via `tsx`) |
| Server | `http://127.0.0.1:8802`, pid 25912 — `corpus server status --json` → `{"running":true,"healthy":true,…,"version":"0.0.0"}` |
| UI | Vite dev on `:5280`, pid 26432, `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8802`, `VITE_CORPUS_TOKEN` from the workspace config |
| Browser | Playwright Chromium, 1600×1000 (real mouse/keyboard events throughout) |
| Fixtures (created through the CLI) | `doc_v5k7myux` "Mortgage options" (body carries `[[doc_ah34rz62]]`), `doc_ah34rz62` "Rates this week", `doc_qf4dktqw` "Rates memo" |

The user's live server on `:8765` was never touched.

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Dated section with rig, reproduction and post-fix runs |
| Commands are specific and concrete | PASS | Names workspace path, server pid 24758/port 8790, Vite `:5273`, exact head strings, exact element counts |
| Real E2E (not mocked) | PASS | `corpus init` workspace + real server + real Chromium; the assertions are DOM counts against the running app, not test doubles |
| Scenarios cover acceptance criteria | PASS | All four criteria have matching evidence (depth 0, depth 1, column variant, esc) |
| Application restarted after changes | PASS | "the conditional was then restored and the runs below repeated against the shipped code"; also re-verified against the prettier-formatted files |
| Actual model recorded (implemented on:) | PASS | "2026-07-30 — ui-dev on opus (claude-opus-5)" |
| Reproduction logged before fix (bug) | PASS | Pre-fix head string plus `PRE-FIX after clicking back at depth 0, overlay open: 0` — the bug was observed before the fix |

Independent re-derivation: every quoted head string in the log reproduced verbatim on my rig (see below), including the exact `✕ Close | esc closes · click anywhere to edit | doc_… · git ✓ | ⋯` shape.

## Criteria Results

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| 1 | Focus head at stack depth 0: `✕ Close` renders, the back button does not | PASS | Verified on **three** entry routes — see FACT-1 |
| 2 | Focus head after following a ref (depth ≥ 1): back button renders, labeled by the previous document, and navigates back (does not close) | PASS | FACT-2 |
| 3 | Column reader head unchanged: back button always renders (list title at depth 0), never a Close | PASS | FACT-3 |
| 4 | esc behavior unchanged (focus layer closes; ⇧esc straight out) | PASS | FACT-4 |

### FACT-1 — depth 0 keeps Close only

Measured as `[data-close-focus]` count vs `.back:not([data-close-focus])` count inside `.focus.open`.

| Entry route | Focus head text | close btns | nav backs |
| --- | --- | --- | --- |
| ⤢ from the column reader | `✕ Close \| esc closes · click anywhere to edit \| doc_v5k7myux · git ✓ \| ⋯` | 1 | `[]` |
| `⇧↵` on the keyboard highlight (arrow-navigated) | `✕ Close \| esc closes · click anywhere to edit \| doc_ah34rz62 · git ✓ \| ⋯` | 1 | `[]` |
| Row context menu → "Open in focus full screen (⇧↵)" | `✕ Close \| esc closes · click anywhere to edit \| doc_ah34rz62 · git ✓ \| ⋯` | 1 | `[]` |

Screenshot: `…/tmp/eval-polish/022-focus-depth0.png`. The redundant `‹ Open threads` / `‹ <list>` pair from the user's screenshot is gone.

### FACT-2 — depth 1 back button is labeled by the previous document and navigates

1. ⤢ into full screen on `doc_v5k7myux`.
2. Clicked the `[[doc_ah34rz62]]` ref inside `.focus.open .doc-body`.
   → head becomes `✕ Close | ‹ Mortgage options | esc closes · click anywhere to edit | doc_ah34rz62 · git ✓ | ⋯`; nav backs `["‹ Mortgage options"]` — labeled by the **previous** document, not by the list. (`022-focus-depth1.png`)
3. Clicked `.focus.open .back:not([data-close-focus])`.
   → `focusOpen: true` still, head back to `✕ Close | esc closes … | doc_v5k7myux …`, nav backs `[]`. **It navigated; it did not close.**

### FACT-3 — the column reader is untouched

| State | `.col.reading` backs | `[data-close-focus]` in the column |
| --- | --- | --- |
| depth 0 (`doc_v5k7myux`) | `["‹ Inbox"]` | 0 |
| after following the ref inside the column (depth 1, `doc_ah34rz62`) | `["‹ Mortgage options"]` | 0 |
| after clicking that back | `["‹ Inbox"]` | 0 |

A back button always renders; a Close never does. (`022-col-depth1.png`)

### FACT-4 — esc precedence

- Focus open at depth 0 → `esc` → `.focus.open` count `0`, `.col.reading .doc-body` count `1` (the column reader underneath survives) → `esc` again → `.col.reading` count `0`.
- Focus open at depth 1 → `esc` → focus closes in one press (it does not first pop to depth 0); column reader survives showing `doc_v5k7myux` with `‹ Inbox`.
- `⇧esc` from depth 1 → focus closed, column reader still open — same shape as before.
- ✕ Close from depth 1 → focus closed, then `esc` closes the column reader.

## Failures

None.

## Ledger (observed on PASS, not a UI-022 defect)

### LEDGER-1: after closing full screen, the active column can silently move, so `esc` stops closing the reader you were reading

Reproduction (deterministic on my rig):

1. Inbox column, open `doc_v5k7myux`, ⤢ into full screen.
2. Click the `[[ref]]` (depth 1). At this moment `.col.kactive` = `doc_seedinbox`.
3. Press `esc`. Focus closes — and `.col.kactive` is now **`doc_seedopenthreads`** (the pointer, parked where the overlay's ref link was, lands over a different column once the overlay disappears).
4. `esc` and `⌫`, pressed any number of times (I tried 7), now do nothing: the active column has no reader.
5. Hover the Inbox column → `.col.kactive` returns to `doc_seedinbox` → `esc` closes the reader normally.

`localStorage["corpus.board"]` is clean throughout (`nav: [{"docId":"doc_v5k7myux","scrollY":0}]`), and the state survives a full page reload, so this is the hover-follows-active rule in SPEC §10 ("The active column follows focus/hover"), not corrupted navigation state. It is not caused by UI-022 — the back-button change cannot move the active column — but a user who closes full screen with the keyboard and then presses `esc` again will find it dead until they move the mouse. Worth a separate issue.

## Summary

4 of 4 criteria passed. The redundant depth-0 back button is gone across all three ways into full screen, the depth-1 back button is correctly labeled by the previous document and navigates rather than closes, the column reader variant is byte-for-byte unchanged in behavior, and esc precedence holds. One unrelated hover/active-column wrinkle is ledgered above.
