# Evaluation: UI-024

**Date**: 2026-07-30
**Sprint**: N/A (post-Phase-5 polish batch, branch `ui-022-reader-polish`)
**Evaluator model**: Opus 5 (`claude-opus-5[1m]`)
**Verdict**: PASS

## Rig

Same real-app rig as UI-022/UI-023: workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/eval-polish/ws`, server `127.0.0.1:8802` (pid 25912), Vite dev `:5280` (pid 26432), Playwright Chromium 1600×1000. Every selection below is made with a **real mouse drag or double-click** except the two "macOS auto-select equivalent" cases, which set a DOM `Range` and then fire a **real right-click** — the app cannot tell the difference, and a drag over a row would open the row instead. A capture-phase `contextmenu` probe records the event target and the live selection at the instant the app sees the gesture. Clipboard cases run in contexts with and without `clipboard-read`/`clipboard-write` granted.

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Four sections: repro, stubbed suite, real app, gates |
| Commands are specific and concrete | PASS | Named ports/pids, exact menu labels and item order, exact file paths, exact commit subjects, the exact Paste error string |
| Real E2E (not mocked) | PASS | Section 3 is a real server + real Chromium + real files on disk; the stubbed Playwright suite is declared as such, not passed off as the E2E proof |
| Scenarios cover acceptance criteria | PASS | Every criterion has a row; the known limit (highlight after stubbed POST) is disclosed rather than hidden |
| Application restarted after changes | PASS | Pre-fix rule restored → suite run → fix restored → suite re-run → real-app run |
| Actual model recorded (implemented on:) | PASS | "**Model: opus** (ui-dev, 2026-07-30)" |
| Reproduction logged before fix (bug) | PASS | Pre-fix run `PASS (10) FAIL (4)` naming the four failing cases, plus the capture-phase probe establishing which gesture carries a selection |

**One claim in the log did not reproduce** (see LEDGER-1): the row "Comment on selection → the floating toolbar's flow" asserts that after send, "`.anchor-hl` painted over those words". On my rig no element ever carries `anchor-hl` — the class exists only as CSS. I audit the log as credible overall (13 of 14 concrete claims reproduced verbatim, including the on-disk anchor structure and commit-message shapes) and treat that cell as an overstatement, not fabrication: it is equally absent on the pre-existing 💬 floating-toolbar path, so it is not a UI-024 behavior.

## Criteria Results

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| 1 | Right-click on a selection in the doc body (reader **and** focus mode): Corpus menu with Comment on selection + Copy (+ Cut/Paste in editable content); Comment opens the same composer as the floating toolbar and produces a §6 anchored thread | PASS | FACT-1, FACT-2, FACT-3 |
| 2 | Right-click on a row while any selection exists (incl. the auto-selected word under the cursor): the row's Corpus menu opens — reproduce report 2's case and prove it fixed | PASS | FACT-4 |
| 3 | Right-click in the editor with no selection: native menu (spellcheck) — unchanged | PASS | FACT-5 |
| 4 | Right-click on empty/non-item space: native menu — unchanged | PASS | FACT-5 |
| 5 | Title field, inputs, plugin surfaces: native behavior unchanged | PASS (plugin surfaces N/A) | FACT-5; plugin-rendered surfaces are explicitly out of scope in v1 per SPEC §11 and were not exercised |

### FACT-1 — the selection menu, item set and order

Column reader, `doc_v5k7myux` open, real drag-select of `assume a 30-year fixed at 6.1 percent`, real right-click on the selection:

```
selection at contextmenu : "assume a 30-year fixed at 6.1 percent"
menus                    : 1
aria-label               : "Actions for the selection"
items (in order)         : 💬 Comment on selection  — opens a thread anchored to these words
                           Copy                     — the selected text, to the clipboard
                           Cut                      — copies the text and removes it from the document
                           Paste                    — replaces the selection with the clipboard's text
```

Screenshot `024-selection-menu.png`. Same gesture in **focus mode** (`.focus.open` = 1), selecting `current numbers`: `count: 1`, label `Actions for the selection`, items `["💬 Comment on selection","Copy","Cut","Paste"]`.

### FACT-2 — Comment on selection produces a real §6 anchored thread

Activated `💬 Comment on selection` from the menu. The composer that opened is the floating toolbar's: it quotes *"assume a 30-year fixed at 6.1 percent"*, carries the **ask agent** toggle and a `Comment ↵` action (`024-composer.png`). Typed `Is that the 30-year or the 15-year assumption?` and sent.

On disk, in `…/eval-polish/ws`:

`data/docs/inbox/mortgage-options-2.md` frontmatter gained
```yaml
anchors:
  anc_163d4307:
    exact: assume a 30-year fixed at 6.1 percent
    prefix: "We "
    suffix: ", which may be stale. See [[doc_"
```
`data/threads/th_2rnukozk.md`
```yaml
id: th_2rnukozk
type: thread
title: 'Re: "assume a 30-year fixed at 6.1 percent"'
status: open
parent: doc_v5k7myux
anchor: anc_163d4307
agent: requested
---
## user · 2026-07-31T06:27:26Z
Is that the 30-year or the 15-year assumption?
```
Workspace git: `cade69b comment: new thread on doc_v5k7myux (th_2rnukozk) by user`.

Exactly SPEC §6's selector shape, turn format and one-anchor-per-thread rule. In the UI the reader head shows `💬 1`, the thread appears in the Open threads column quoting the anchor, and in focus mode it renders as a margin thread card `"assume a 30-year fixed at 6.1 percent" … on Mortgage options` (`024-focus-anchors.png`). A second comment made through the **floating toolbar** on `15-year fixed and a 7/1 ARM` produced the same structures — the two paths are one flow.

### FACT-3 — clipboard actions are honest

| Case | Observed |
| --- | --- |
| Copy (permissions granted) | `navigator.clipboard.readText()` = `"lender spreads"`, identical to the selection; document body unchanged |
| Cut | clipboard = `"lender spreads"`; body became `Short memo about  and the shape of the yield curve.`; autosaved to `data/docs/inbox/rates-memo-2.md` and committed `d5ae889 doc edit: Rates memo (doc_qf4dktqw) by user` |
| Paste (granted, clipboard = `INTEREST-RATE`) | selection `yield curve` replaced: `Short memo about  and the shape of the INTEREST-RATE.` |
| Paste, clipboard-read **denied** | visible toast, `data-tone="error"`: `Could not paste — Failed to execute 'readText' on 'Clipboard': Read permission denied. Reading the clipboard needs the browser's permission; ⌘V still works.` Document unchanged. (`024-paste-denied.png`) |

The denied case fails visibly rather than silently no-opping, as the issue requires.

### FACT-4 — report 2: item menus win over selections

Capture-phase probe output, so the selection state at the moment the app handles `contextmenu` is on the record:

```
right-click the row's OWN selected title (the reported gesture)
  PROBE target=SPAN.row-title text="Rates memo" selection="Rates memo"
  MENU  "Actions for Rates memo"        items [Open, Open in focus, Archive, Delete…]

same, second row
  PROBE target=SPAN.row-title text="Mortgage options" selection="Mortgage options"
  MENU  "Actions for Mortgage options"  items [Open, Open in focus, Archive, Delete…]

selection on row A, right-click row B
  MENU  "Actions for Rates this week"   items [Open, Open in focus, Archive, Delete…]

selection live, right-click the column header
  MENU  "List options for Inbox"        items [Rename, Edit query, Unpin]

selection live, right-click a console job row
  MENU  "Actions for comment.created · Re: \"15-year fixed and a 7/1 ARM\""   items [↗ open]

thread row / open thread reader, text selected inside a turn
  MENU  "Actions for Re: \"15-year fixed and a 7/1 ARM\""  items [Still current, Resolve, Archive, Delete…]
```

A live selection never suppresses an item's menu — rows, column headers and job rows all open theirs. This is the bug the report described, and it is fixed.

### FACT-5 — native menu still reachable where it should be

| Gesture | contextmenu target | Corpus menus |
| --- | --- | --- |
| Editor body, nothing selected | `P.` | **0** |
| Document title field | `INPUT.doc-title` | **0** |
| Ghost column / board background | `BUTTON.col ghost-col` | **0** |
| Empty space inside an open reader | `DIV.reader-scroll` | 1 — `Actions for Mortgage options` `[Still current, Archive, Delete…]` |

The last row is correct, not a violation: SPEC §11 lists "the open reader (its ⋯ menu set)" among the actionable items, so the reader surface *is* a Corpus item. Truly non-item space (ghost column, board background) yields the native menu, and the editor with nothing selected keeps spellcheck's home.

Negative claims above were re-derived with `/usr/bin/grep` over a saved DOM dump where applicable (see LEDGER-1).

## Failures

None.

## Ledger (observed on PASS, not UI-024 defects)

### LEDGER-1: anchored text is never highlighted in the document body

The issue's log claims `.anchor-hl` is "painted over those words" after a comment. It is not, on any path:

- After the context-menu Comment: `document.querySelectorAll('.anchor-hl')` → **0**.
- After a comment made through the **pre-existing floating toolbar 💬**: still **0**.
- After a full page reload with two anchors on disk, in the column reader **and** in focus mode: still **0**; the focus body's `innerHTML` is plain `<p>…</p>` with only the `docRef` span, and the only anchor-ish node in the whole overlay is the empty container `DIV.focus-margin[data-anchor-margin=true]`. No connectors (`svg`/`canvas` under `.focus` → none).

Re-derived per the negative-evidence rule against a saved DOM dump (`…/tmp/eval-polish/focus-dom.html`):

```
/usr/bin/grep -c 'class="anchor-hl' focus-dom.html   → 0
/usr/bin/grep -c 'anchor-hl"'       focus-dom.html   → 0
/usr/bin/grep -n  'anchor-hl'       focus-dom.html   → 1242,1250,1259,1274  (all inside the injected <style>)
/usr/bin/grep -o  'data-anchor[a-z-]*="[^"]*"'       → 1 × data-anchor-margin="true"
```

So the CSS ships and nothing uses it. Because the floating-toolbar path behaves identically, UI-024 did not cause this — but it contradicts SPEC §11 ("threads sit Docs-style in the right margin, **aligned to their anchors with connectors**"; "Clicking an anchored **highlight** opens its thread") and it means the log's claim was not verified as written. Worth its own issue against the anchor layer.

### LEDGER-2: `↵` does not activate a context-menu item (any Corpus menu, pre-existing)

SPEC §11: "The menu follows the app's existing menu conventions — `esc` dismisses, arrows navigate, `↵` activates."

```
row menu, ArrowDown → focused item data-act="open"
  Enter       → menus still 1, reader NOT opened
  NumpadEnter → menus still 1, reader NOT opened
  Space       → menu closed, reader opened      ← only Space works

selection menu, ArrowDown ×2 → focused data-act="copy"
  Enter → menus still 1, clipboard still holds the sentinel value (Copy never ran)
```

`esc` dismisses correctly and arrows move roving focus correctly in both menus. The Enter gap is identical on the row menu shipped by UI-018 (whose eval asserted "arrow/↵ navigation" but only ever exercised ArrowDown), so it is pre-existing and not attributable to UI-024.

### LEDGER-3: a thread conversation yields the reader's item menu, not the native menu

The issue's "As built" note says that where the selection menu could offer nothing but Copy — "a thread's conversation, a `view`, a foreign lock" — "it declines and **the native menu appears**". Observed: selecting `ARM on the table` inside a thread turn and right-clicking gives `Actions for Re: "15-year fixed and a 7/1 ARM"` `[Still current, Resolve, Archive, Delete…]` — the reader's item menu, no native menu. That is the correct outcome under SPEC §11 (the open reader is an item), so the behavior is right and the note's prose is what is inaccurate. Recorded so the issue text is not taken as the contract later.

## Summary

5 of 5 criteria passed. The selection menu appears with the specified items in the specified order in both the column reader and focus mode; Comment on selection opens the floating toolbar's own composer and writes a genuine §6 anchor into the parent's frontmatter plus a `parent`/`anchor`-carrying thread file, auto-committed; Copy/Cut/Paste act on the real clipboard and the real document, with a visible error when clipboard read is denied; and the reported bug is fixed — a live selection, including the row's own selected title, no longer suppresses a row's, header's or job row's Corpus menu, while the editor with nothing selected, the title field and true empty space keep the native menu. Three unrelated behaviors are ledgered above, the most significant being that anchored text is never highlighted in the body on any path.
