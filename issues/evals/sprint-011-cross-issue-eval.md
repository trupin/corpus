# Evaluation: sprint-011 cross-issue (TEST-159…176)

**Date**: 2026-07-28 (re-verified after the fix pass at `85d929a`)
**Sprint**: sprint-011 — Phase 3, the writing surface
**Verdict**: PASS (17 of 18 met; 1 pending orchestrator bookkeeping; 3 N/A by design)

> **Round 2.** Round 1 at `ae1e855` returned PARTIAL on TEST-161. The fix pass at `85d929a` closed
> both issue-level FAILs and the flagged highlight anomaly; all three were re-verified on a fresh
> workspace at port 9031. TEST-161 flipped FAIL → **PASS**. The only outstanding item is TEST-175,
> which is the orchestrator's own bookkeeping step.

Run against the **production-served board** — `npm run build`, `corpus server start`, opened at the
URL the server printed, no Vite and no env var — which is TEST-167's own preferred environment and
what an installed user gets.

- Workspace: `/tmp/corpus-eval-s011-main-v31nHu`, port `9030` (assigned range 9030–9039)
- `8765` confirmed **unbound** for the whole session
- Branch tip `ae1e855`, `git status` clean throughout

## Criteria Results

| #   | Criterion                                   | Result | Notes |
| --- | ------------------------------------------- | ------ | ----- |
| 159 | §12 M4's gold path, one unbroken act        | PASS   | See the transcript below. Create → type → autosave → select → comment (`○ note only`) → highlight + chip **with no reload** → thread in the Open-threads column → reply lands in the thread file → squashed auto-commits in `git log` |
| 160 | One serializer / autocomplete / intake / open-in-column / escape chain | PASS | Five greps, five results, quoted below |
| 161 | Body survives a full session byte-clean     | PASS (round 2) | Round 1 FAILed: three documents ended the session carrying HTML character references. **Fixed at `85d929a` and re-verified** — after a full round-2 editing session across four documents, `grep -rn '&#' $WS/data/` is **empty** and every body is clean CommonMark |
| 162 | Keyboard doesn't fight editor/composer/anchors | PASS | Every writing surface swallowed every letter shortcut (`c e f r j k ?` × 5 surfaces); navigation shortcuts worked outside them; `esc` unwound popover → overlay one layer per press; no shortcut fired twice |
| 163 | Read state closes its loop                  | PASS   | Expanding a chip fired exactly one `POST …/seen`; opening the parent with chips collapsed fired none; three collapse/expand cycles fired none; badges cleared |
| 164 | Agent lock respected by every writing surface | PASS | Under `corpus lock acquire <id> --from agent`: editor `contenteditable=false`, `caret-color rgba(0,0,0,0)`, `.sel-toolbar` count 0, `[[` menu count 0, typed text did not appear, 0 PUTs — **and** highlights still rendered and threads stayed readable and repliable. `lock release` restored all of it live, with the editor DOM node identity preserved (no remount) |
| 165 | No document content crosses SSE             | PASS   | Full `/events` capture across the session: every frame was `event: invalidate` with `keys` only, drawn from the closed vocabulary — e.g. `{"keys":[["docs"],["docs","th_ha4pjovs"],["threads","th_ha4pjovs"],["docs","doc_bcy35lzp"]]}`. Grep for nine content terms (`Mortgage`, `Rates`, `paragraph`, `mortgage rate`, `stray thought`, `30-year`, `alpha beta`, `Torture`, `bullet one`) → **0 matches each** |
| 166 | No UI file bypasses the kit                 | PASS   | `git grep "fetch(" -- apps/ui/src` returns exactly one non-test hit: `apps/ui/src/app/apiClient.ts:95` — the provider wiring the criterion exempts. `git grep "@corpus/contract/client" -- apps/ui/src` → **none**, including the multipart paths |
| 167 | Production-served board carries all of it   | PASS   | Everything in these five verdicts was tested there, with the SERVER-024 injected token. Editor, anchors, threads, composer and keyboard all work against real data |
| 168 | Generated artifacts green twice in a row    | PASS   | `node --import tsx scripts/check-generated-artifacts.ts` exit 0, twice; `git status` clean after |
| 169 | Whole-repo gate green at the tip            | N/A (orchestrator) | `npm run build` succeeded (exit 0, dependency order). Lint/typecheck/test are the orchestrator's single harvest run — not duplicated here, per the sprint's machine-load rules |
| 170 | Merged coverage gate holds                  | N/A (orchestrator) | Not run by the evaluator (machine-load rules) |
| 171 | e2e green at the tip, ports respected       | N/A (orchestrator) | Playwright is single-holder; I held a browser session for the whole evaluation. `8765` confirmed free by `lsof` throughout |
| 172 | Four Playwright specs cover the §12 checks  | PASS   | `editor.spec.ts`, `thread.spec.ts`, `anchors.spec.ts`, `compose-keyboard.spec.ts` all present in `apps/ui/e2e/` |
| 173 | Prototype comparison done side by side      | PASS   | Every chrome surface I measured came back on-token: editor typography, thread card, composer foot, compose panel, cheat sheet, autocomplete menu, margin connector. The single deviation found is cosmetic and non-binding (UI-007 TEST-116's `max-width`) |
| 174 | Light and dark both from the token set      | PASS   | Grep for hex/rgb literals in every CSS file this sprint added — `editor.css`, `anchors.css`, `thread.css`, `compose.css`, `keyboard.css`, kit's `autocomplete.css` — returns **0 literals** in all six |
| 175 | PLAN.md tells the truth at the end          | PENDING (unblocked) | `issues/PLAN.md` still reads `in_progress` for UI-006, UI-007, UI-008 and UI-010. **All four now carry a PASS verdict**, so the evaluator gate is clear and the statuses can flip. Orchestrator bookkeeping, not an implementation defect |
| 176 | Nothing left running, repo clean            | PASS   | See Cleanup below |

## TEST-160 — the five greps

```
$ git grep -ln "export function serialize\|export const serialize" -- 'apps/ui/src/**' 'packages/kit/src/**'
apps/ui/src/editor/markdown/serialize.ts                    ← one serializer

$ git grep -ln "AutocompleteMenu\|useAutocomplete" -- 'packages/kit/src/**'
packages/kit/src/components/Autocomplete/AutocompleteMenu.tsx   ← one menu
packages/kit/src/components/Autocomplete/useAutocomplete.test.tsx
                                                            ← one matcher, in kit
   (per the Wave-B Addendum: two surface-native trigger detectors are accepted;
    singularity is asserted on the menu and the matcher, and it holds)

$ git grep -ln "useAttachmentIntake" -- 'apps/ui/src/**'
apps/ui/src/compose/ComposeOverlay.tsx      (consumer)
apps/ui/src/thread/ThreadComposer.tsx       (consumer)
apps/ui/src/thread/useAttachmentIntake.ts   ← one implementation

$ git grep -ln "useOpenInColumn" -- 'apps/ui/src/**'
apps/ui/src/board/openInColumn.tsx          ← one scroll+flash+open
   (consumers: anchors/useAnchorLayer, console/JobDetail, keyboard/boardCommands,
    reader/useReaderSurface, search/SearchOverlay, shell/Board)

$ git grep -ln "EscapeLayerPriority" -- 'apps/ui/src/**'
apps/ui/src/reader/useEscapeStack.ts        ← one escape-precedence registry
   (registrants only: anchors/CommentPopover, compose/ComposeOverlay,
    keyboard/CheatSheet, reader/*, search/SearchOverlay, thread/Turn)
```

## TEST-159 — the gold path, as it actually ran

```
create      → col-add on Inbox → "Gold path note" → reader opens on doc_65era3l2
type        → a paragraph typed into the body; 2 PUTs across the session
select      → drag over the paragraph → selection "The refinance wind"
comment     → 💬 Comment → popover → "Confirm the date." → toggle to ○ note only → send
no reload   → highlights: ["The refinance wind"]   chips: ["💬 1 · user"]
open+reply  → chip → thread card → composer → "Yes, March 14."
              POST /api/threads/th_b43j4a3q/turns {"body":"Yes, March 14.","requestsAgent":true}
              turns: ["Confirm the date.","Yes, March 14."]
column      → Open threads: ["Re: \"The refinance wind\"", …]
```

On disk:

```
$ cat data/threads/th_b43j4a3q.md
parent: doc_65era3l2      anchor: anc_05032963      agent: requested
## user · 2026-07-28T19:34:02Z   Confirm the date.
## user · 2026-07-28T19:34:07Z   Yes, March 14.

$ sed -n '/^anchors:/,/^due:/p' data/docs/inbox/untitled.md
anchors:
  anc_05032963:
    exact: The refinance wind
    prefix: |+ …## Open questions
    suffix: ow closes in March and we should

$ git log --format='%h %an :: %s' <base>..HEAD
1870c5e user :: comment: turn on th_b43j4a3q by user
e08c85b user :: doc edit: Gold path note (doc_65era3l2) by user
fc1da65 user :: doc edit: Gold path note (doc_65era3l2) by user
```

## Failures

None at `85d929a`.

### FAIL-1 (round 1, at `ae1e855` — FIXED at `85d929a`): HTML character references reached document bodies (TEST-161)

Full round-1 reproduction is in `issues/evals/UI-006-eval.md`. In cross-issue terms: after a
session of ordinary editing, three of the workspace's documents carried entities the editor wrote —

```
$ grep -rn "&#x" $WS/data/docs/
notes/repro-esc.md:16:      **link:&#x20;**[[doc_ydahlzw4]]**6.4%** this week. See [[mort
notes/bold-space-test.md:14:**alpha beta&#x20;**&#x67;amma delta!
finance/rates.md:16:        **link:&#x20;**[[doc_mbc52nvo]]**6.4%** this week. See [[mort
```

Trigger: select a phrase whose selection includes a trailing space and press **B**. TEST-161 asks
for "no marker character" in the body over a full session; SPEC.md §6 makes it a data-integrity
guarantee rather than a rendering preference.

**Fixed and re-verified at `85d929a`.** The fix hoists edge whitespace outside the emphasis markers
per CommonMark flanking, rather than special-casing the end-of-block symptom. I re-ran the original
repro plus four adjacent shapes of my own choosing (mark at block start, mark at block end, ref after
a bold run, nested/overlapping marks, and a mark whitespace-flanked at both ends) — all emit clean
CommonMark — and swept the workspace after a full editing session across four documents:

```
$ grep -rn '&#' $WS/data/
(no output — EMPTY)
```

Note what this never was: it was unrelated to anchors. TEST-89's decoration purity held in round 1
too — no `<span>`, no `class=`, no marker was ever written by highlighting, expanding, replying or
resolving. The pollution came from the serializer's escaping on the plain-editing path.

## Observations for the phase PR reviewer

1. ~~**The `&#x20;`/`&#x67;` serializer defect is the one thing that should block.**~~ **Resolved at
   `85d929a`** and re-verified across five mark shapes plus a clean workspace sweep. Nothing here
   blocks any more.
2. ~~**Escape does not disarm the armed turn-delete button.**~~ **Resolved at `85d929a`** and
   re-verified in the exact `contenteditable`-ancestor case, with click-elsewhere and the two-click
   delete both confirmed non-regressed.
3. ~~**One unreproduced highlight-loss.**~~ **Root-caused and closed at `85d929a`**: adoption after
   save collapsed the decorations and the repair waited on a 120 ms debounce that a non-re-rendering
   commit could miss; adoption now re-applies on a microtask. Re-verified over three full save
   cycles — 78 samples at 250 ms, **zero** highlight-free frames.
4. **Cosmetic, still open:** margin `.thread-card` computes `max-width: 519.653px` where TEST-116
   states `none`. Non-binding — `left:0/right:0` fixes the rendered width at 300px as required.
5. **Correction to my round-1 observation (my error, not the product's).** I reported that an
   omnibox-created document opens title-focused but not title-*selected* and lands as `untitled.md`.
   The fix agent is right: my TEST-159 transcript used the **column `＋`** path, which is a zero-form
   "Untitled" by design. Re-checked the **omnibox** path specifically at `85d929a`:

   ```
   ⌘K → type "Quarterly refinance memo" → click .sr-create
   POST /api/docs {"type":"note","title":"Quarterly refinance memo","folder":"inbox"}
   file on disk : data/docs/inbox/quarterly-refinance-memo.md      ← not untitled.md
   title field  : "Quarterly refinance memo"
   selection    : inputSelection="Quarterly refinance memo"  active=doc-title   ← selected
   ```

   Sprint-009's `selectTitle` works as specified. My round-1 note was a mis-attribution; withdrawn.

6. **Open SPEC question, flagged for the PR (not a criterion failure).** Retitling a document
   updates `title:` in the frontmatter but does **not** rename the file:

   ```
   title edited to "Renamed memo title" (commits on Enter/blur — PUT {"title":"Renamed memo title"})
   on disk: data/docs/inbox/quarterly-refinance-memo.md   holding   title: Renamed memo title
   ```

   Nothing in sprint-011 requires either behavior; SPEC.md does not settle whether a retitle should
   rename. Worth a user decision at the phase PR. (Related, harmless: the title field commits on
   Enter/blur rather than per keystroke — that is UI-005's `FrontmatterForm`, and it is deliberate.)

7. **Credit where due:** UI-010's log flagged its own TEST-155 deviation and asked for a ruling
   instead of overclaiming, and CONTRACT-013's log declined to reach into another domain's tree and
   named the follow-up that closed the duplicate. Both are the behavior the process wants.

## Cleanup (TEST-176)

Both rounds, after each session:

```
$ lsof -nP -iTCP:8765 -sTCP:LISTEN     → (empty, throughout both sessions)
$ corpus server stop                   → stopped (round 1 pid 37444, round 2 pid 71712)
$ lsof -nP -iTCP -sTCP:LISTEN | grep -E ':90[0-9][0-9]|:52[0-9][0-9]'  → (empty)
$ ps aux | grep [v]itest               → (none; the evaluator ran no vitest)
$ git status                           → clean (only the issues/evals/*.md verdicts)
```

Scratch removed by name: round 1 `/tmp/corpus-eval-s011-main-*` and `/tmp/corpus-eval-s011*`;
round 2 `/tmp/corpus-eval-s011re-*`. No `/tmp/corpus-s011-*` (the implementing agents') or
`/tmp/corpus-eval-s010-*` path was touched in either round.

## Summary

**17 of 18 cross-issue criteria met at `85d929a`; 0 FAIL; 1 pending orchestrator bookkeeping
(TEST-175, now unblocked); 3 marked N/A as the orchestrator's single harvest run.** Round 1 at
`ae1e855` was 16/18 with TEST-161 failing.

Phase 3's closing sprint delivers what it set out to. The gold path runs unbroken across all four
issues in a real browser against a real server. There is one serializer, one autocomplete menu, one
attachment intake, one open-in-column and one escape chain — verified by grep, not by assertion. No
document content crosses the SSE wire. No UI file bypasses the kit. An agent lock stops every
writing surface at once while leaving reading and replying intact, and releases without a remount.

Round 1's single blocking defect — the serializer writing HTML character references for an ordinary
first-minute action — is fixed at the right level and re-verified against every mark shape I could
construct. The two smaller items (Escape disarm, the once-seen highlight loss) are also closed, the
second with a real root cause rather than a papered-over symptom. Nothing in this batch blocks the
phase PR on my account.

Two things travel forward to the reviewer rather than to an issue: the cosmetic `max-width`
deviation on margin cards, and the genuinely open SPEC question of whether retitling a document
should rename its file. Neither is a sprint-011 criterion.
