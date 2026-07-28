# Evaluation: UI-006

**Date**: 2026-07-28 (re-verified after the fix pass at `85d929a`)
**Sprint**: sprint-011 (TEST-1…36)
**Verdict**: PASS

> **Round 2 — FAIL-1 is fixed.** Re-checked at `85d929a` on a fresh workspace
> (`/tmp/corpus-eval-s011re-u0MvB0`, port 9031). The original repro and four adjacent mark shapes all
> emit clean CommonMark, and `grep -rn '&#' <workspace>/data/` is **empty** after a full editing
> session. Detail in "Round 2 re-verification" below. Verdict flipped FAIL → **PASS**.

Evaluated against the **production-served board** (`corpus server start`, token injected by
SERVER-024) on port `9030`, workspace `/tmp/corpus-eval-s011-main-v31nHu`, real Chromium driven by
Playwright. No source was read except for the singularity greps the contract's own criteria demand.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                          |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Long, structured, per-criterion                                                                                  |
| Commands are specific and concrete      | PASS   | Real `corpus init`/`server start` output with pids, real computed styles, real `git diff` hunks                  |
| Real E2E (not mocked)                   | PASS   | Real workspace on 9002, real server, real Chromium. Unit tests are cited only as *supplements*, never as the proof |
| Scenarios cover acceptance criteria     | PASS   | Every TEST-1…36 addressed                                                                                        |
| Application restarted after changes     | PASS   | Fresh workspace + server per pass                                                                                |
| Actual model recorded (implemented on:) | PASS   | "Implemented on: opus."                                                                                          |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue                                                                                                    |

**Honesty audit — one contradiction found in round 1, since resolved.** I sampled and re-derived
claims across the log; all reproduced faithfully (typography, caret colour, one-PUT debounce, disk
diff, `[[` menu computed style, lock read-only, user-lock acquire/idle-release, ref dedup counts).
**The exception was the "Defects found and fixed during this pass" entry 1**, which claimed the
`&#x20;` defect was "fixed twice over"; at `ae1e855` it was not — the claimed fix ("the serializer
drops trailing whitespace at the end of a block") did not cover a trailing space *inside a mark,
mid-block*, which is the case ordinary users hit. The fix pass at `85d929a` closed the gap properly
by hoisting edge whitespace outside the emphasis markers per CommonMark flanking rules. The log's
claim is now true; it was premature rather than fabricated.

## Criteria Results

| #  | Criterion                                  | Result   | Notes |
| -- | ------------------------------------------ | -------- | ----- |
| 1  | Editable, no mode/ceremony                 | PASS     | `contenteditable=true`, `caret-color rgb(59,95,151)` = `--accent #3b5f97`, `outline: none`. Full button sweep of the rendered tree: no save button, no mode toggle (only `col-add`, `col-menu`, `back`, `expand`, `fm-edit-toggle`, theme, compose, halt) |
| 2  | Editor replaces exactly one branch         | PASS     | One serializer module (`apps/ui/src/editor/markdown/serialize.ts`); `MarkdownView` still renders turn bodies (verified live: a `[[ref]]` in a turn resolved to "Rates") |
| 3  | Focus mode = same editor at focus measures | PASS     | Focus surface renders the editor; `.focus-inner` grid confirmed; column 15px/24.3px/62ch vs focus measures per log |
| 4  | Prototype typography, computed             | PASS     | serif, 15px, line-height 24.3px (=1.62), max-width 517.222px (62ch); `h2` 17px margin `22px 0 6px`; non-first `p` margin `10px/10px`; `ul` `8px 0` + `padding-left 22px`; `li` `4px 0` |
| 5  | Plugin/`view` type never gets the editor   | PASS     | Per log; view documents render `.doc-body` with `contenteditable: null` |
| 6  | Byte-identical round-trip over the corpus  | PASS     | Independently re-derived on a 13-construct torture document: the PUT body was byte-identical to the source except the one injected char — including `\` hard breaks, `   1.` nested-ordinal indentation, fences with and without a language, `>` blockquote containing a list, `---`, `[[ref]]` and `[[ref\|alias]]` |
| 7  | Idempotent from the second pass            | PASS     | Non-canonical input (setext, `*` bullets, `_italic_`, `__bold__`, trailing spaces, triple blank lines) → pass 1 normalized; pass 2 differed only by the newly typed char |
| 8  | Stated normalization rules                 | PASS (round 2) | ATX/`- `/`**`/`*`/fences/one-blank-line/single trailing `\n` all hold. Round 1 FAILed on HTML character references; **fixed at `85d929a` and re-verified** — see "Round 2 re-verification" |
| 9  | Serializer written, not borrowed           | PASS     | No `turndown`/`rehype-remark`/`node-html-markdown`/`showdown` in either `package.json`; exactly one `export function serialize` in `apps/ui/src` + `packages/kit/src` |
| 10 | Empty document serializes to empty         | PASS     | Frontmatter-only doc shows exactly one empty `P`; type-then-delete produced **0** PUTs |
| 11 | Ref serializes from attributes             | PASS     | `[[doc_mbc52nvo]]` and `[[doc_mbc52nvo\|the rate assumption]]` render as "Rates"/"the rate assumption" and serialize back to the bracket form byte-identically |
| 12 | §11 input shortcuts                        | PASS     | `## `,`### `,`#### `,`- `,`1. `,`> `,`**b**`,`*i*`,`_i_`,`` `c` `` → `H2,H3,H4,UL,OL,BLOCKQUOTE,P`; wire body is canonical markdown |
| 13 | Shortcuts inert inside a fence             | PASS     | Node types unchanged after typing `## `,`- `,`**x**` inside a fence; disk holds them verbatim inside ``` |
| 14 | Paste parses / literal in fence            | PASS (log) | Not independently re-run; log is specific and consistent with the fence behavior I did verify |
| 15 | N rapid edits = one PUT                    | PASS     | 15 chars in 431 ms → **0** PUTs during typing, **exactly 1** after the debounce, carrying the full serialized body |
| 16 | No-op edit issues no request               | PASS     | Type + delete + idle → **0** PUTs (compared against last *saved* string) |
| 17 | Chip reflects the response                 | PASS     | `save-chip saved`, `rgb(78,122,70)` = `--good`, text `committed · git ✓` |
| 18 | Chip's anchor claim = response's claim     | PASS     | Independently produced an orphan: chip read **`committed · git ✓ · 1 anchor orphaned`** — it does not claim `anchors ✓`. Derived from the PUT response |
| 19 | Failed PUT keeps buffer + retries          | PASS (log) | Not independently re-run (would require server fault injection); the analogous 413 path in UI-008 restored state correctly under my own test |
| 20 | Pending saves flush before loss            | PASS (log) | Log quotes the outgoing doc id in the PUT URL and both files' disk state |
| 21 | Autosave never touches undo history        | PASS     | Save landed mid-sequence; ⌘Z walked back past it to the pre-save text; redo restored |
| 22 | Disk proof — one intended change           | PASS     | `git diff` showed **only** the edited paragraph + `updated:`. Nested lists, ordered list, python fence, blockquote, `**bold**`, `*italic*`, `amortization_schedule`, `2 * 3 = 6`, `[draft]`, bare URL all byte-identical |
| 23 | Commit lands with `user` as author         | PASS     | `rev-list` 7 → 8; `user <user@corpus.local> :: doc edit: Mortgage options (doc_bcy35lzp) by user`. A long undo/redo burst produced ONE commit (squashed) |
| 24 | `[[` opens the prototype's menu            | PASS     | `.ac-menu open`: fixed, `rgb(255,255,255)`, `1px solid rgb(227,225,218)`, radius 9px, padding 4px, min-width 250px, max-height 200px, `overflow-y: auto`, shadow present; rows are `.ac-item` |
| 25 | Menu is keyboard-first                     | PASS     | ↓/↑ move `aria-selected`; Escape closes the menu, leaves literal `[[`, keeps the editor focused and **does not** close the reader |
| 26 | Selection inserts an id ref                | PASS     | Typing `[[mort` filtered to `["Rates","Mortgage options"]`; selection produced `[[doc_e24jef7k]]` on the wire while rendering the target's title; `.ref` is `rgb(46,75,120)` with `1px solid rgba(59,95,151,0.1)` bottom border |
| 27 | Broken ref is visibly broken, round-trips  | PASS     | `[[doc_deadbeef]]` renders `.ref-broken`; no page errors collected |
| 28 | Cache-deduped per-id `useDoc`              | PASS     | A body citing one id twice plus one broken id issued exactly **2** title requests (`doc_mbc52nvo` once, `doc_deadbeef` once) |
| 29 | Selection toolbar                          | PASS     | `.sel-toolbar open`, fixed, surface, `1px solid rgb(227,225,218)`, radius 9px, padding 4px; buttons `B`,`I`,`💬 Comment`; `.divider` 1px `--line`; comment button `rgb(46,75,120)` weight 600 |
| 30 | B/I toggle marks and report state          | PASS     | B produced `**…**` on disk (and exposed FAIL-1); `aria-pressed` reflects the mark |
| 31 | Comment hands off without mutating         | PASS     | Comment click issued **0** PUTs and **0** POSTs; body byte-identical |
| 32 | Agent lock ⇒ read-only over SSE            | PASS     | `corpus lock acquire … --from agent` → within one SSE round trip and no reload: `contenteditable=false`, `aria-readonly=true`, `caret-color rgba(0,0,0,0)`, LockBanner present, typed text did not appear, **0** PUTs, `.sel-toolbar` count 0, `[[` menu 0 |
| 33 | Unlock restores without a remount          | PASS     | A `data-identity-probe` stamped on the editor node before the lock **survived** the release (no remount); `contenteditable` back to `true`, caret colour restored, scroll preserved |
| 34 | User lock decided, implemented, logged     | PASS     | First keystroke issued `POST /api/locks/doc_6jrmdezn`; `corpus lock list` showed `doc_6jrmdezn — user, acquired …, lease 300s` **while typing** and `NOT HELD` at ≈10 s idle. Sprint text's `--holder` is `--from` per the addendum |
| 35 | SSE invalidation doesn't clobber buffer    | PASS (log) | Not independently re-run |
| 36 | Invalidation registry keyed by doc         | PASS (log) | Not independently re-run |

## Round 2 re-verification (commit `85d929a`)

Fresh workspace `/tmp/corpus-eval-s011re-u0MvB0` on port 9031, production-served board, rebuilt from
the fix commit. `8765` unbound throughout.

**The original repro, step for step** — document body `alpha beta gamma delta`, select `alpha beta `
including the trailing space (`Home` + 11 × `Shift+ArrowRight`), click **B**:

```
selection : "alpha beta "
editor html: <p><strong>alpha beta</strong> gamma delta</p>
PUT body  : "**alpha beta** gamma delta\n"          ← was **alpha beta&#x20;**&#x67;amma delta
```

Both defects are gone: the trailing space is hoisted outside the `**` markers, and the adjacent `g`
of "gamma" is no longer escaped.

**Four adjacent shapes, my choice:**

| Shape | Action | Serialized to the wire |
| ----- | ------ | ---------------------- |
| Mark at block **start**, trailing space | select `"Second "` at `Home`, press **I** | `*Second* paragraph with words to mark.` |
| Mark at block **end**, leading space | select `" mark."` at `End`, press **B** | `to **mark.**` |
| **Ref after a bold run** (round 1's second path) | bold the lead, then type `link: ` at `Home` and insert `[[…]]` from the menu | `**link:** [[doc_l72q4ijy]]**The rate** is here.` |
| **Nested** marks, overlapping, edge spaces | bold `"Alpha unique "`, then italic across `"Alpha unique sentenc"` | `***Alpha unique*** *sentenc*e one here.` |
| Mark flanked by whitespace at **both** ends | drag-select `"istinct senten"` mid-word, press **B** | `Beta d**istinct senten**ce two here.` |

**The sweep**, after that whole editing session across four documents:

```
$ grep -rn '&#' $WS/data/
(no output — EMPTY)

$ # every note body on disk
anchor-watch.md    ***Alpha unique*** *sentenc*e one here.
                   Beta d**istinct senten**ce two here.
                   Gamma separate sentence three here.
bold-space-test.md **alpha beta** gamma delta
edge-marks.md      **Bold lead** then plain tail here.
                   *Second* paragraph with words to **mark.**
ref-target-test.md **link:** [[doc_l72q4ijy]]
                   one two three four five**The rate** is here.
```

Every body is clean CommonMark. Zero page errors across all round-2 runs.

## Failures

None at `85d929a`.

### FAIL-1 (round 1, at `ae1e855` — FIXED at `85d929a`): serializer wrote HTML character references

**Criterion**: TEST-8 (stated normalization rules), and TEST-161 / SPEC.md §6 ("the body stays
clean — no inline markers"). Also contradicts the E2E log's "Defects found and fixed" entry 1.

**Expected**: An ordinary bold action produces clean markdown — `**alpha beta** gamma delta` (or any
faithful spelling that contains no HTML entities).

**Observed**: The body on disk becomes `**alpha beta&#x20;**&#x67;amma delta` — an entity for the
trailing space *inside* the bold run, and a second entity escaping the plain letter `g` of "gamma".
The state is stable across reload and re-serialization (idempotent), so the corruption is permanent
and compounds into every later `git diff` of that document.

**Steps to reproduce**:

1. `corpus doc create --type note --title "Bold space test" --folder notes --file <file>` where the
   file contains exactly `alpha beta gamma delta`.
2. Open the document in a column reader on the production-served board.
3. Click into the paragraph, press `Home`, then press `Shift+ArrowRight` eleven times — the selection
   is `"alpha beta "`, including the trailing space (the same selection an ordinary double-click-drag
   produces).
4. Click **B** in the `.sel-toolbar`.
5. Wait for autosave, then `cat` the file.

```
selection: "alpha beta "
editor html after B: <p><strong>alpha beta </strong>gamma delta</p>
PUT body:  "**alpha beta&#x20;**&#x67;amma delta\n"
on disk:   **alpha beta&#x20;**&#x67;amma delta
```

Reload, type one more character, and the re-serialized body is
`"**alpha beta&#x20;**&#x67;amma delta!\n"` — the entities survive the round trip.

**Second, independent path to the same defect** (no toolbar involved): in a document whose paragraph
opens with a bold run, place the caret at the start of the bold text and type `link: ` before
inserting a `[[ref]]` from the `[[` menu. Observed on disk:

```
**link:&#x20;**[[doc_mbc52nvo]]**6.4%** this week. See [[mort
```

Three documents in my workspace ended a normal session carrying entities:

```
$ grep -rn "&#x" $WS/data/docs/
notes/repro-esc.md:16:      **link:&#x20;**[[doc_ydahlzw4]]**6.4%** this week. See [[mort
notes/bold-space-test.md:14:**alpha beta&#x20;**&#x67;amma delta!
finance/rates.md:16:        **link:&#x20;**[[doc_mbc52nvo]]**6.4%** this week. See [[mort
```

## Summary

**36 of 36 criteria PASS at `85d929a`** (5 accepted on an audited, specific log rather than
re-run; 2 not independently re-run). Round 1 at `ae1e855` scored 33 PASS / 1 FAIL; the single
failure was fixed and re-verified.

The editor is a genuinely good editor. The five criteria the sprint contract names as load-bearing —
editable-with-no-mode (TEST-1), byte-identical round-trip (TEST-6), N-edits-one-PUT (TEST-15),
disk-diff-shows-only-the-intended-change (TEST-22), lock read-only and back without losing scroll
(TEST-32/33) — all hold under independent testing, and TEST-22 in particular is impressive: a
15-construct document survived editing with a two-line diff. The user-side lock (Adjudication 3b)
is really implemented, not struck: acquire on first keystroke, release at ~10 s idle, verified
through `corpus lock list`.

Round 1's one failure was narrow but real, and it landed exactly where this sprint said it could not
afford one: the serializer's output was not clean markdown for a first-minute user action. The fix
pass addressed it at the right level — hoisting edge whitespace outside the emphasis markers per
CommonMark's flanking rules, rather than special-casing the end-of-block symptom — and it holds
across every mark shape I could think to throw at it, including nested and overlapping marks and the
ref-after-bold path. SPEC.md §6's clean-body guarantee now holds on the plain-editing path as well as
the anchoring path.
