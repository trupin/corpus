# Evaluation: UI-027

**Date**: 2026-07-31
**Sprint**: sprint-018
**Evaluator model**: Opus 5 (`claude-opus-5[1m]`)
**Verdict**: PASS

## Rig

Independent workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/eval-p6/ws`
(`corpus init --port 8802`), server pid 99059 on `127.0.0.1:8802` from
`apps/cli/src/bin/corpus.ts` via tsx, Vite dev `:5280` with
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8802`. Proxy proved: `GET
localhost:5280/api/health` → `"workspace":"…/eval-p6/ws"` (mine). Port 8765 never
touched (held by pids 702/15627 throughout). Real Chromium via Playwright,
1600×1000; no stubs, no test client, no fixture transport.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                              |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Six sections, rig named with pids and ports.                                                                                        |
| Commands are specific and concrete      | PASS   | Doc ids, anchor ids, thread ids, byte-level `0a`/`2e` distinction, computed styles, pixel geometry.                                  |
| Real E2E (not mocked)                   | PASS   | Sections 1–4 declared stub-free; independently reproduced here against a real server + real browser.                                 |
| Scenarios cover acceptance criteria     | PASS   | All five criteria have named evidence.                                                                                              |
| Application restarted after changes     | PASS   | Pre-fix/post-fix runs on the same rig with the same two documents.                                                                   |
| Actual model recorded (implemented on:) | PASS   | "**Model: opus** — Opus 5 (`claude-opus-5[1m]`), ui-dev, 2026-07-31."                                                                |
| Reproduction logged before fix (bugs)   | PASS   | §1 records the conditional pre-fix reproduction (`.anchor-hl` 1 vs 0 keyed on the body's last byte) — the observation that named the cause. |

The log's root-cause claim was **independently confirmed, not taken on trust**: I
built the failing shape from scratch (below) and the fixed build renders it.

## Criteria Results

| #   | Criterion                                                                        | Result | Notes                                                                                              |
| --- | -------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| 1   | Commenting paints the highlight in both hosts, immediately and after reload       | PASS   | Real mouse-drag selection → 💬 Comment → send; highlight present at once and after a full reload.   |
| 2   | Clicking a highlight opens/expands its thread (§11)                              | PASS   | `.thread-slot.expanded` 0 → 1, `data-slot-thread="th_i4ynuerw"`.                                    |
| 3   | Margin cards align to anchors; narrow columns keep chips at the anchor            | PASS   | Focus mode: card viewport top **172px** == highlight viewport top **172px**; connector 23×1px.      |
| 4   | Orphaned anchors render per spec (no phantom highlight)                          | PASS   | 2 orphans on one doc → 0 highlights; threads under `[data-thread-section="detached"]`.              |
| 5   | e2e coverage for highlight presence                                              | PASS   | `apps/ui/e2e/anchor-layer.spec.ts` present on the branch (6.5K).                                    |
| 6   | **Root-cause case: a document with no trailing newline**                          | PASS   | The gate of this evaluation — see below.                                                            |

## Evidence

### The root-cause document, built from scratch

Created through the raw API with a body that does not end in `\n`:

```
$ POST /api/docs {"type":"note","title":"Rates memo","folder":"inbox",
                  "body":"Short memo about lender spreads and the shape of the yield curve."}
→ doc_jq7szwg6, data/docs/inbox/rates-memo.md

$ tail -c 20 data/docs/inbox/rates-memo.md | xxd
00000010: 7276 652e                                rve.        ← last byte 0x2e, no 0x0a
```

The control document (`doc_hffvakmq`, "Mortgage options") ends `overall.\n` — last
byte `0x0a`. This is exactly the one-byte difference the log names.

### Highlight renders on the no-trailing-newline document

Anchor created **through the CLI** (`corpus thread create --parent doc_jq7szwg6
--quote "lender spreads"` → `th_vv5qglbw` / `anc_57e56afb`), which also discharges
CLI-022's cross-issue check:

```
column reader doc_jq7szwg6:
  .anchor-hl  = 1   text "lender spreads"
                    data-thread=th_vv5qglbw  data-anchor=anc_57e56afb
                    background rgba(59,95,151,0.1)  border-bottom-width 2px
  .anchor-pip = 1   .anchor-slot = 1
focus mode (f):
  .anchor-hl present, .with-margin = 1, .focus-margin = 1
```

The file on disk still ends `0x2e` after the anchor write — the server did not
paper over the case by normalising the body.

### Commenting through the UI, then reloading

Real `mouse.down` → `mouse.move(steps:12)` → `mouse.up` over "yield curve" in the
column reader; the shipped `.sel-toolbar` appeared; 💬 Comment → `textarea.cm-input`
→ ⌘↵.

```
before comment      ["lender spreads"]
immediately after   ["lender spreads", "yield curve" (th_f26tfuzn/anc_a0906128)]
after page.reload() ["lender spreads", "yield curve"]
```

Frontmatter on disk gained the second §6 selector with real context
(`prefix: "er spreads and the shape of the "`), so the reload reads it off disk.

### Clicking a highlight opens its thread

```
.thread-slot.expanded  0 → 1
data-slot-thread = th_i4ynuerw
card text: "a 30-year fixed at 6.1 percent" open ✓ resolve – on Mortgage options
           · at "a 30-year fixed at 6.1 percent" USER … Is 6.1 percent still right?
```

### Margin alignment, measured

```
focus mode, doc_jq7szwg6
  .focus-margin .thread-card   style top: 85px   viewport top: 172
  .anchor-hl                                     viewport top: 172
  host .focus-margin                             viewport top:  87
  connector (::before)   width 23px  height 1px  background rgb(207,204,194)
```

Card and highlight share a viewport top to the pixel. Narrow column: 1
`.anchor-slot` carrying 1 `.t-chip`, `.with-margin` = 0.

### Orphans — no phantom highlight

Two deliberately unresolvable anchors on `doc_hffvakmq` (server reports
`range: null, orphaned: true` for both, `range:{10,40}` for the third):

```
.anchor-hl = 1   texts ["a 30-year fixed at 6.1 percent"]     ← only the resolving one
[data-thread-section="detached"] → "DETACHED THREADS 💬 1 · user new 💬 1 · user new"
```

And orphaning a live anchor from the UI — real drag over "lender spreads", typed
"mortgage pricing" over it, autosave:

```
before edit   ["lender spreads", "yield curve"]
after edit    ["yield curve"]                       ← no phantom
detached      "DETACHED THREADS 💬 1 · agent"
after reload  ["yield curve"] / detached unchanged
```

## Failures

None.

## Note (not a failure)

Clicking an anchor highlight places the caret in the body — the reader is
click-to-edit by design (`.focus-hint` reads "click anywhere to edit"), so a
keystroke after a highlight click edits the document. My first drill did exactly
that and inserted a stray `f`; that is my drill's fault, not the product's, and is
recorded here so a later reader does not mistake it for a finding. The anchor
correctly remapped across the edit.

## Summary

6 of 6 criteria passed. The fix is real and it is the right fix: a document whose
body does not end in a newline — the case that produced zero highlights before —
now paints, clicks through, aligns in the margin, and survives a reload, and the
orphan path stays clean. Verified against a workspace and a document set built
independently of the implementer's.
