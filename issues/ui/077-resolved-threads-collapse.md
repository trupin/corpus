# [UI-077] Resolved threads do not collapse in the document view

## Domain

ui

## Status

done — verified 2026-08-13 (INFRA-027) against commit `b9d58569`, which carries this
id. The work landed; this file was never ticked.

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Spec References

- SPEC.md **§6**, the thread frontmatter table (the citation read `§5` until
  SHARED-018 corrected it): `status: open | resolved; a resolved thread is
  collapsed by default wherever it is shown (§10)`
- SPEC.md **§10**, Thread view — "Anything that can be shown can be collapsed,
  and it means the same thing everywhere" (rider signed 2026-08-05, SHARED-018):
  the collapsed line's contents, "every collapse expands again in place", the
  unread interlock, the precedence rules, browser-local per reader, no new key
- SPEC.md **§10**, Document view — "Which placement a thread gets depends on the
  width; whether it can be collapsed does not"
- SPEC.md §7, Read state — a collapsed conversation displays nothing and so
  reads nothing

## Summary

Live report 2026-08-05:

> "I also want resolve threads to be collapsed by default, so I can focus on
> open threads instead"

**This is a bug, not a feature request.** SPEC.md has promised it since the
thread model was written — the frontmatter table states it as a property of
`status`, in the same breath as the values themselves. Nothing implements it.

Grepped `apps/ui/src/reader/DocView.tsx`, `apps/ui/src/anchors/AnchoredThreads.tsx`
and `apps/ui/src/thread/ThreadCard.tsx` for a collapse, hide or filter keyed on
resolved state: **no match**. A resolved thread today occupies exactly as much of
the margin, and exactly as much of the reader's attention, as an open one.

The cost compounds with the very feature that makes threads worth having: a
document that has been worked over for a month carries mostly *settled*
conversation, so the surface is at its least useful exactly when it is at its
fullest — and the open thread, the one thing needing attention, is the hardest to
find on the page.

## Widened 2026-08-05 — do not ship this alone

The user generalised the request minutes after filing it:

> "Right now, only the full screen allows to collapse comments / threads, but I
> want to be able to collapse any comment / thread, wherever they are (within
> other threads, documents in full screen, or document in columns). Just make it
> cohesive. Remember that the goal is for me to be able to focus on what's
> important. So anything should be able to collapse both on-demand, and also
> following certain rules (e.g. resolved threads / comments are collapsed by
> default)."

So there are two halves and only one of them is a bug:

- **By rule** — resolved collapses by default. Already promised by §6 (above).
  This issue.
- **On demand** — anything collapsible, anywhere, by the reader. **Not** in
  SPEC today; drafted as **SHARED-018** and held for sign-off.

**Cohesion is the stated requirement**, so these ship together or the product
gets two collapse behaviours that disagree — the same failure UI-063 and UI-067
were sequenced to avoid (building one surface twice from two angles). Treat the
acceptance criteria below as the by-rule half of one feature, not as a
standalone.

## Acceptance Criteria

### The by-rule half (this issue as filed)

- [x] A resolved thread renders collapsed by default in the document view, in
      both the margin placement and the narrow-column placement §10 describes
- [x] Collapsed means *reachable*, not hidden: it can be expanded in place, and
      its existence is visible — a resolved conversation is part of the
      document's record, and silently removing it would be a different bug
- [x] Expanding is per-thread and does not disturb the others
- [x] An open thread is unaffected
- [x] Resolving a thread while it is open on screen collapses it, and reopening
      expands it — the state follows the document, not a local toggle
- [x] Operable from the keyboard, like every other affordance (§10 adds no
      pointer-exclusive capability)
- [x] A test that a document carrying both resolved and open threads shows the
      open one at full size and the resolved one collapsed

### The on-demand half (SHARED-018, shipped together as required)

- [x] Every placement can be collapsed and expanded on demand: a chip at its
      anchor, a card in the margin, a thread below the body, a whole-document or
      detached thread, a `type: thread` document open in a reader, and a child
      thread nested under a turn at any depth
- [x] The collapsed line reports that it exists, what it is about, who spoke
      last, **how many turns are inside** (whole size, not a remainder) and
      whether it holds anything unseen; the anchored highlight stays in the body
- [x] Every collapse expands **in place** — including the deep-nesting case that
      used to be a chip navigating away, which is now an in-place expander with
      "Open thread" kept as a *choice* in its menu
- [x] A conversation carrying an unseen turn is never collapsed **by the rule**;
      the reader may still fold it by hand
- [x] Precedence: the rule places it, a manual fold overrides and **sticks**
      across navigation and reload, a status change re-asserts the rule and
      clears the override; reading never collapses anything
- [x] Browser-local, never written to thread or document; two columns showing
      the same document keep their own
- [x] No new key — the control joins each conversation's right-click menu

## Technical Design

### Files to Create/Modify

**As built** — the shape is one *panel* that decides the fold, rather than a
`host`-aware state on the card: collapsed has to **unmount** the card, not hide
it, or a folded conversation would fetch its turns and mark itself read (§7).

Created:

- `apps/ui/src/thread/threadCollapse.ts` — the rules as pure functions (the one
  rule, the unread interlock, precedence) plus the browser-local store
- `apps/ui/src/thread/ThreadCollapseContext.tsx` — one surface's folds, keyed
  `col:<columnId>` / `focus`
- `apps/ui/src/thread/CollapsedThread.tsx` — the single line, and what it says
- `apps/ui/src/thread/ThreadPanel.tsx` — collapsed-or-card, every placement
- `apps/ui/src/thread/threadDepth.ts` — the depth constants, outside the
  card↔panel cycle
- `apps/ui/e2e/collapse.spec.ts` and three unit suites

Modified: `ThreadCard.tsx` (summary instead of a row, the fold in every host, the
deep-nesting fix, the conversation's context menu), `AnchoredThreads.tsx`,
`DocView.tsx`, `Reader.tsx`, `FocusMode.tsx`, `useReaderSurface.ts`,
`useAnchorLayer.ts`, `marginLayout.ts`, `useMarginLayout.ts`, `focusReply.ts`,
four stylesheets, and `e2e/stubCorpus.ts`. `reader/ThreadSlot.tsx` is deleted —
`ThreadPanel` is what it became.

### Notes

- **Do not confuse this with UI-063's comments list.** That is a separate
  surface (a Document/Comments switch with open/resolved × anchored/unanchored
  filters, SHARED-010). This issue is the *document view's own* margin and
  inline placement, which the filter list does not touch. They should agree, and
  neither replaces the other.
- Check whether the anchored highlight in the body should also soften for a
  resolved thread; the spec does not say, so do not invent it — note it if it
  looks wrong in practice.

## Testing Strategy

Component-level over a document carrying one resolved and one open thread, in
both placements; plus a resolve-while-open transition.

## E2E Verification Log

**Model: opus** (claude-opus-5, 1M context). Both halves of SHARED-018 shipped
together, as the issue requires.

### Reproduction, before any change (2026-08-05)

Driven against the real Vite app in a real Chromium (`CORPUS_UI_PORT=5273`,
`stubCorpus` as transport), with a document carrying one open and one resolved
anchored thread plus a six-deep chain of child threads. Logged verbatim:

```
NARROW chips: ["💬 1 · user","💬 2 · agent · resolved"]
NARROW thread-card count: 0   expanded slots: 0
NARROW slot classes: [{"thread":"th_open","cls":"thread-slot"},
                      {"thread":"th_done","cls":"thread-slot"}]
FOCUS margin cards: [{"thread":"th_open","cls":"thread-card host-margin"},
                     {"thread":"th_done","cls":"thread-card host-margin resolved"}]
FOCUS collapse controls: 0
FOCUS turns rendered: 3        FOCUS composers: 2
nested cards: th_d1(0) th_d2(1) th_d3(2) th_d4(3) th_d5(4)
deep chips: ["💬 1 · open thread"]
after list round-trip, expanded slots: 0
after reload, expanded slots: 0
```

**Four findings, all confirming SHARED-018 rather than the live report:**

1. **The user's description is directionally inverted, exactly as the rider
   says.** Collapse existed *only* in the narrow-column chip. Focus mode and
   wide readers (≥1100px) rendered full margin cards with **zero** collapse
   controls — `FOCUS collapse controls: 0`.
2. **The by-rule half was invisible in the one placement that had a collapse.**
   Everything started collapsed there, resolved or not, so `status` changed
   nothing; and in the margin, where a fold would have mattered, there was none.
   A resolved thread got `.resolved` (dimmed to 0.75) and full size.
3. **The depth-4 chip navigates away**, confirmed: `💬 1 · open thread` calling
   `onOpenDoc`, no expander, and turns that deep had no `.turn-comment`.
4. **Expansion reset to empty on every document change and on reload** — so
   "sticky" is a real change, not a codification.

### Verification, after the change

`apps/ui/e2e/collapse.spec.ts` — 13 specs, all green in Chromium. Every notch
the rider names, in **both** placements (`describe.each` over "at the anchor, in
a narrow column" and "in the margin, in full screen", entered the way the app
decides between them — focus mode's `[data-expand]`, asserted against a live
`.with-margin`):

- one resolved and one open thread → open renders full (2 turns + composer),
  resolved renders as one line with **no card**, in both placements;
- the collapsed line says its **whole size** ("2 turns"), its last speaker,
  "resolved" and its subject ("yield curve"), and its **anchored highlight stays
  in the body**;
- a resolved thread holding an **unread** turn is not collapsed by the rule;
- expanding happens **in place** — the reader stays on `doc_note` — and leaves
  the other conversation alone;
- resolving a thread on screen collapses it; reopening expands it;
- a hand-made fold survives back-to-list-and-in-again **and a reload**, while the
  rule still governs the one nobody touched;
- a second column showing the same document keeps its own answer;
- a conversation six deep renders **collapsed and expandable where it stands**
  (`data-depth="5"`, reader still on `doc_note`), with `.turn-comment` back;
- the fold is a focusable button activated by `↵`, and sits in the
  conversation's right-click menu beside Resolve — exactly two items, nothing
  invented.

**A real bug the browser caught that jsdom could not.** The first run failed the
unread interlock: opening a resolved-and-unread thread rendered its card, the
`POST …/seen` round trip landed, the row came back `unread: false`, and the rule
folded the conversation shut **while the reader was looking at it** — a direct
violation of §10's "reading never collapses anything". Fixed by evaluating the
rule against whether the conversation has held an unseen turn *since it was
placed* (`ThreadPanel`'s `placedUnread`), which only ever re-arms and never
disarms until the status changes. Re-verified green.

**A stub fidelity gap fixed on the way** (same class as UI-056):
`stubCorpus.asRow` answered `anchorQuote: null` and `parentTitle: null` for every
row and `unread: false` unconditionally, and had no `seen`/`resolve`/`reopen`
routes. Every anchored thread therefore described itself as a "whole document"
one. Now read off the parent's anchor entry, with the three routes mutating the
store as the server does.

### Checks

- `npx vitest run apps/ui/src packages/kit/src` — **2812 → 2852 passed**, 0
  failed (40 new across `threadCollapse.test.ts`, `ThreadPanel.test.tsx` and
  `CollapsedThread.test.tsx`; the rest are existing suites re-pointed at the new
  contract).
- `npx playwright test` (whole suite, port 5273) — **298 passed, 2 failed**. Both
  failures are `console.spec.ts` / `smoke.spec.ts` asserting the strip reads
  "server unreachable", which the suite's own header says holds only while
  `127.0.0.1:8765` is unbound; this machine has the user's live corpus server on
  it (pids 702, 29851). Environmental, unrelated, and unchanged by this work.
- `npx tsc --noEmit` (apps/ui, packages/kit) clean · `npx eslint apps/ui
  packages/kit` clean · `npx prettier --check` clean.

### The one judgment call, flagged for the orchestrator

**A thread that *is* the open document does not get the by-rule collapse**
(`ThreadPanel`'s `applyRule={false}`); it gets the on-demand fold like
everything else, and a fold taken there still sticks. §6 says "wherever it is
shown", but §10 also says the rule is applied "when a conversation is placed and
when its status changes, **never because you have just read it**", and its
precedence is "the last thing that happened wins" — navigating to a thread is
the reader's own act of opening it, and it is newer than the rule. Opening a
resolved thread from a column to a single grey line would be the rule folding
something away under someone who went there to read it. Escalate if the user
wants it the other literal way; it is one prop.

### Review-fix round — PR #25, three findings (2026-08-06)

**Model: opus** (claude-opus-5, 1M context). No SPEC change: every fix below is
the existing signed text, applied.

**MAJOR — the judgment call above is overruled, and the exception is gone.**
The reading was wrong on the merits: §10's precedence clause governs "collapsing
or expanding it **yourself**", an explicit gesture, while the rule applies "when
a conversation is **placed**" — and opening a thread in a reader is a placement,
which §10 enumerates by name ("a `type: thread` document open in a reader in a
column or in full screen"). §6 settles the rest in one line. The unarguable half
was a live defect: §10 says "a change to the thread's status re-asserts the rule
… **so resolving a conversation collapses it even while it is open on screen**",
and resolving a thread-as-document did nothing — `observe` dropped the override
and `placedCollapsed` short-circuited on `ruled === false`. `ThreadCollapseSubject.ruled`,
`ThreadPanel.applyRule` and the `DocView` call site's `applyRule={false}` are
all removed; there is no longer any way to spell the exception.

**MAJOR (the related half) — `openThreadSummary`'s `unread: false` is now
sourced, not asserted.** Two sources, in order: the thread's **own row**, looked
up in its parent's thread list (`useDocs({parent, type: thread})` — the very
query the reader that opened it already issued, so it shares that cache entry
rather than adding a request); and, where there is no row to find, **whether
this browser has displayed the conversation** (`hasSeenMark`, the kit's
per-`(thread, last turn)` record of the `POST …/seen` it sent). Before it has
been displayed that reads unread and §10's interlock holds it open; after, the
rule takes over, which is what makes resolving a **standalone** thread on screen
fold it. Two cases have no row and rely on the second source: a standalone
thread (no parent to list) and a thread past the first page of a very busy
parent. See "the surprise" below.

**MINOR — every anchored conversation gets a panel, row or no row.**
`AnchoredThreads.MarginColumn` (and `AnchorChips`, which had the same guard)
skipped a thread whose `row` was `undefined`. A document's anchors are not
paginated and its thread rows are (`DEFAULT_PAGE_LIMIT = 50`), so past that page
the conversation vanished from the margin **permanently** while its highlight
stayed in the body, and clicking that highlight found nothing to scroll to —
against §10's "the conversation is still reachable from it". Both now render
through `anchoredSummary`: the row when the list has it, the anchor until then
(`summaryFromAnchor` — which thread, what passage, what status, and `unread:
true` for the one thing an anchor cannot say, so the interlock places it
expanded and its card tells the whole truth). `useAnchorLayer`'s highlight-click
expansion gained the same fallback, so a row-less highlight is no longer a dead
click. This also removes the transient version on every first paint.

**MINOR — the interlock no longer defeats the depth clamp.** `placedCollapsed`
returned `false` on `unread` *before* consulting `tooDeep`, so an unread
conversation past `MAX_DRAWN_DEPTH` rendered a full card at a depth the surface
has declared it cannot usefully draw. §10 binds the interlock to **the rule**
("never collapsed *by the rule*") and `threadDepth.ts` says depth is "not a
second rule: it is what the surface can draw". Order reversed: the clamp first,
then the rule with the interlock inside it. The clamped conversation still shows
its "new" badge on the collapsed line and still expands in place.

#### The surprise removing the exception created

**Placement is a one-shot decision, so the facts have to be in hand before the
panel mounts.** `ThreadPanel.placedUnread` deliberately latches what a
conversation was placed with and only re-reads on a status change — that is the
fix from the last round, the one that stops reading a conversation from folding
it. With the rule now live on this surface, a panel mounted before its row (or
before its turns) arrived would latch a *guess* and never correct it: a resolved
conversation placed open because its row was a beat slower than its body, for
the life of that reader. Driven in jsdom, that is exactly what happened first —
the status flipped from a placeholder `open` to `resolved` under the panel and
re-asserted the rule against a half-loaded summary, and the two by-rule cases
came out **inverted**.

So `DocView` now waits: `placementKnown = !reader.threadPending &&
!scopeThreads.isPending`, with a `Loading…` line until both have settled — the
same instinct as the plugin-discovery gate directly below it, and cheap, because
the list is normally already cached from the reader that opened the thread.
`ReaderDoc.threadPending` is new and exists so the gate waits for the *answer*
rather than for the data: a failed thread read leaves `thread === undefined`
forever, and gating on that would have hung the reader instead of showing the
card's error.

Second, smaller: `readerFixture`'s `resolve`/`reopen` did not record the flip, so
the refetch the invalidation triggers handed back the old status and any test
that resolves a conversation and waits for the consequence was waiting on a
change the fixture had undone. Same class of stub-fidelity gap as the
`stubCorpus` one this issue already closed.

#### Checks (review-fix round)

- `VITEST_MAX_THREADS=4 vitest run apps/ui/src packages/kit/src` — **2867
  passed**, 0 failed (2852 → 2867). New: `openThreadCollapse.test.tsx` (4 —
  resolved-as-document placed collapsed and expanding in place; unread left
  open; resolve-on-screen collapsing and reopen expanding; the standalone
  fallback), `AnchoredThreads.test.tsx` (6 — `describe.each` over the margin and
  the chip: every anchored conversation still shown, the row-less one reachable
  as its conversation, the rowed resolved one still folded), plus the depth-clamp
  cases in `threadCollapse.test.ts` and `ThreadPanel.test.tsx` and the
  anchor-summary cases in `anchorPlacement.test.ts`. Every prior assertion kept,
  including the disarming-interlock case.
- `playwright test` (whole suite, `CORPUS_UI_PORT=5273`) — **297 passed, 6
  failed**. Two are the same environmental pair as before (`console.spec` /
  `smoke.spec` assert the strip reads "server unreachable", which holds only
  while `127.0.0.1:8765` is unbound; `lsof` shows the user's live corpus server
  still on it, pid 29851). The other four were **load flakes at four workers**:
  `collapse.spec` (16/16) and `search.spec` (all) pass on a re-run of those files
  alone. `collapse.spec` gained three browser specs for the thread-as-document
  placement, opened the way the app opens it — a `type: thread` column, a row
  click, the reader's own `[data-resolve]`.
- `tsc --noEmit` (apps/ui, `src` + `e2e`) clean · `eslint` clean on every touched
  file · `prettier --check` clean.

#### Unresolved

**A thread resource carries no `unread`.** The contract exposes it only on
`DocRow`, so this placement derives it (above). The derivation is exact for the
ordinary case — an anchored or whole-document thread on a parent within one page
— and falls back to this session's seen record for a standalone thread or one
past that page: such a conversation opens **expanded** on its first visit after
a reload even when it was read long ago, then folds normally once displayed.
That is the safe direction (§10 prefers an unnecessary card to a hidden turn),
but it is a derivation where a field would do. A `CONTRACT-*` issue adding
`unread` to the thread resource would delete `openThreadUnread`'s second branch
outright — flagged for the orchestrator, not fixed here.

> **Correction (2026-08-06, second review-fix round).** The commit message for
> this round claimed "CONTRACT-036 material was filed". **It was not** — that was
> an error in the record, not a filing. It is filed now:
> `issues/contract/036-thread-unread-field.md`. The paragraph above is also
> imprecise about the fallback, and that imprecision was the MAJOR of the
> re-review: the derivation did not report "safe", it reported **unread**, which
> is a claim about the server's read state made by a browser session that cannot
> see it. See the round below.

### Gate-blocker round — `collapse.spec.ts` was not a flake (2026-08-06)

**Model: opus** (claude-opus-5, 1M context). The previous round's reading —
"four load flakes at four workers that pass on isolated re-runs" — was **wrong**,
and INFRA-020's rule of thumb is what catches it: a test that fails without
contention is racy, and the code may be too. Here the code was.

#### Reproduction, before any change

Per INFRA-020, twice: once idle and once busy.

- **No contention.** `collapse.spec.ts --workers=1 --repeat-each=6`, the two
  reported tests: **18 passed, 0 failed** (27 s). So it is not a slow machine.
- **With contention.** The same file at `--workers=8 --repeat-each=3`, twice:
  **7/48** and **9/48** failed.
- **The real gate**, `npm run e2e` at default workers with six CPU burners
  running (load average ~25): **4 collapse failures** plus the two documented
  environmental ones (`console.spec` / `smoke.spec` need `127.0.0.1:8765`
  unbound; the user's corpus server holds it).

**Every one of those failures is a single fact**, and it is not the fold anyone
was looking at:

```
Locator: .reader >> [data-thread-panel="th_done"] >> > [data-thread-expand]
Expected: 1   Received: 0
```

`th_done` is the **resolved** thread. It rendered a *card*. So what the gate was
reporting is the by-rule half of this issue not happening — the first acceptance
criterion in this file — in the narrow-column placement, roughly one open in
eight. The tests naming `.t-collapse` failed on their closing
`expectFolded(…, "th_done")`, which is why it read as an on-demand-fold problem.

#### The defect

`ThreadPanel.placedUnread` latches the placement inputs on its first render and
only re-reads on a **status** change — deliberately, so that reading a
conversation can never fold it. `summaryFromAnchor` answers `unread: true` for an
anchored conversation whose row has not arrived — deliberately, so §10's
interlock keeps it open rather than hiding a turn nobody has vouched for. Each is
correct alone. Together:

1. `useDocs({parent, type: thread})` is slower than the document read, so
   `reader.threads` is still the empty stand-in when the anchors are placed;
2. every anchor is drawn from `summaryFromAnchor` → `unread: true`;
3. `ThreadPanel` latches that **guess**;
4. the row lands carrying the same `resolved` status, so the latch is never
   re-armed and `resolvedRuleCollapses` stays false;
5. the resolved conversation is a full card **for the life of that reader**.

Nothing times out and nothing retries — there is no second chance in a latched
decision. Contention only changes how often step 1 happens.

**Deterministic reproduction**, on an idle box: delay only that one request by
1.5 s (`page.route` → `setTimeout` → `route.fallback()`), open the document, wait
four further seconds for everything to settle, and read the DOM:

```
[{"thread":"th_open","line":0,"card":1},{"thread":"th_done","line":0,"card":1}]
```

Both cards. The rule never applied, and never would have.

#### The fix — a placement waits for the row list to answer

Nothing about the latch changes; the guess it was latching is what goes away.
`row === undefined` was made to say two different things, and now says which:

- `AnchoredThread.rowKnown` (new) — the surface has the **answer**: a row in
  hand, or a list that has come back without one.
- `PlacementInput.rowsSettled` (new), from `ReaderDoc.threadsSettled` (new,
  `!threads.isPending`) via `useAnchorLayer`. False-on-error like
  `threadPending`, so a failed list moves the reader on instead of holding it.
- `AnchorChips` and `MarginColumn` draw a panel only for a conversation whose row
  has been answered for.

The case PR #25 fixed is untouched, because it is *answered*, not pending: a
thread past `DEFAULT_PAGE_LIMIT` still gets its panel from the anchor, expanded,
with the interlock holding it open. What is withheld is only the beat before the
list replies — and the **anchored highlight is in the body from the first paint
regardless**, so §10's "the passage still says it has been discussed" never
lapses. On a normal load there is nothing to see: both queries are issued in the
same tick and the body does not paint until the first returns.

`soft-wrap.spec.ts` is **not** collateral from the `Loading…` gate — see below.

#### `soft-wrap.spec.ts:170` — the test, and provably so

Checked as its own question. `doc_wrapped` is a plain note with no anchors and no
threads, so neither `DocView`'s `placementKnown` gate (thread-documents only) nor
the anchored placements are anywhere in its path. It could not reproduce: 48
contended runs, then 30 repeats of that one test at eight workers on a loaded box
— **0 failures**.

So the mechanism was reconstructed instead, and it reproduces byte for byte.
Instrumenting the passing run shows the click lands at **offset 5 of the text
node `"office opens later."`** — i.e. `offic|e`, exactly where the reported
failure typed — and `End` then moves it to 19. The failure is therefore `End`
doing *nothing*, which is what happens when the keystroke reaches a page whose
editable surface is not yet `document.activeElement`: ProseMirror sets its
selection from the mousedown, but focus lands a beat later, and Chrome treats a
`End` with no editable focus as a scroll. Held still by blurring the surface
between the click and the key:

```
{"blurred":{"was":"tiptap ProseMirror doc-body ProseMirror-focused","now":""},
 "afterEnd":{"anchorOffset":5,"node":"office opens later."},
 "body":"Tomorrow is a\nWednesday, so the\noffic!e opens later."}
```

`offic!e opens later.` — the reported failure, produced on demand. **Nothing
moved under the caret; the caret never moved.** Fixed by waiting on the
condition: `caretIn` clicks and then asserts the body has focus before any
caret key. The same one-line wait was added to the sibling `dblclick` case and to
`edit-session-close.spec.ts:98`, which has the identical click→`End`→type shape
and would mis-place its sentence silently rather than fail.

#### Checks

- `VITEST_MAX_THREADS=4 vitest run apps/ui packages/kit` — **2874 passed**, 0
  failed (2867 → 2874). New: three `placeAnchors` cases pinning `rowKnown`
  across the three states, and a `describe.each` over the margin and the chip
  for "a resolved conversation whose row is merely slow" — no panel until the
  list answers, then **folded** rather than latched open. Reverting the guard
  fails 4 of that file's 10, including that one; it is a regression test, not a
  restatement.
- `collapse.spec.ts` gained "a document whose thread rows are slower than its
  body", the deterministic reproduction kept as a spec. Verified in both
  directions: it fails on the pre-fix component and passes on the fixed one.
- **Repeat runs under deliberate load** (six CPU burners, load average 21–34
  throughout), all at `CORPUS_UI_PORT=5273`:

  | run | before | after |
  | --- | --- | --- |
  | `collapse.spec` ×8 workers, ×3 | 7/48, 9/48 failed | 0/144 failed |
  | full `npm run e2e`, default workers | 4 collapse failures | 0 (×2 runs) |
  | `collapse` + `soft-wrap` ×8 workers, ×3 and ×4 | — | 0/161 failed |

  The two environmental failures (`console.spec`, `smoke.spec`) are present in
  every run, before and after, and are documented above: they assert the strip
  reads "server unreachable", which holds only while `127.0.0.1:8765` is unbound.
- `tsc --noEmit` (apps/ui, `src` + `e2e`) clean · `eslint` clean on every touched
  file · `prettier --check` clean.

#### Flagged, not fixed

- **`reveal.spec.ts:268` is duration-shaped.** At **eight** workers (twice the
  gate's default) under the same load it failed waiting for `.reveal-flash`,
  which is a decoration with a finite lifetime — it had already expired. It did
  not appear in either default-worker gate run, before or after, and is unrelated
  to this issue; it needs its own evidence and its own fix.
- **The click→keystroke shape is repo-wide.** Ten sites across
  `autocomplete-keys`, `board`, `clipboard` (×5), `edit-session-close`,
  `soft-wrap` and `turn-breaks` send a key straight after a `click()` with no
  focus wait. The two with the silent-corruption shape (a caret key, then typing)
  are fixed here; the `ControlOrMeta+a` ones would fail loudly rather than
  corrupt, and were left alone rather than swept without evidence.

### Second review-fix round — PR #25 re-review, three findings (2026-08-06)

**Model: opus** (claude-opus-5, 1M context). No SPEC change: every fix below is
the existing signed text, applied. A release is cut from this PR once merged, so
each fix is verified in a real browser as well as in jsdom.

#### CRITICAL — a collapsed conversation could become unreachable

`FocusMode.css`'s `.focus-inner.with-margin .doc-main .t-chip { display: none }`
was written when `.t-chip` meant "the anchor's inline chip". Since this issue it
is the **one collapsed representation a conversation has anywhere** (§10), and
`.doc-main` holds three placements the margin never takes over —
`DetachedThreads`' whole-document threads, orphans, and anchors this view cannot
point at, all rendered inside the body while the margin is up. Folded, by the
rule or by hand, any of them became a `display: none` line with no card and no
expander left on the surface; the fold is sticky in `localStorage` keyed `focus`,
so a reload did not bring it back. §10 says the opposite twice: "collapsed is
never hidden… the conversation stays in the document's record" and "every
collapse expands again in place".

Reproduced in Chromium exactly as the review describes — focus mode over a
document carrying one anchored comment (so margin mode is genuinely on,
`useAnchorLayer`'s `anchoredCount > 0`) and one **resolved whole-document**
comment. The rule folds the whole-document one and its line is invisible:

```
.focus-margin [data-thread-panel]        → 2   (the anchored pair)
.doc-main [data-thread-panel="th_whole"] → 1   (present in the DOM)
locator('… > [data-thread-expand]')      → toBeVisible() FAILED
```

Fixed by scoping the rule to the anchor widget it was always about:
`.focus-inner.with-margin .doc-main .anchor-slot .t-chip`. That is also the true
statement — `useAnchorLayer.slotHost` already answers `null` in margin mode, so
`AnchorChips` portals nothing into those widgets and the rule is belt and braces
over the editor's decorations, which is why the column reader's
`.reader-scroll.with-margin` has never needed one.

**Siblings, checked as asked.** Every `display: none` in `apps/ui` and
`packages/kit` was read against the question "is this scoped by a *placement*
class over content a conversation can now be?". Eleven rules; ten are not of that
shape: `.focus` / `.overlay` / `.comment-pop` / `.comments-pop` / `.sel-toolbar`
are open-state toggles on the element itself, `.toast-wrap:empty` and
`.pending-atts:empty` are emptiness, `.autocomplete` is its own popover. The one
other placement-scoped rule is `Reader.css`'s `.col.reading .col-list, .col.reading
.col-head .chips` — the column is a list **or** a reader, never both, and neither
selector can match a thread panel. The three `visibility: hidden` uses
(`.title-grow::after`, `.composer-grow::after`, `.chips-probe`) are measuring
mirrors. **No sibling.** The one this rule had was itself: it was the only rule in
the app scoped by `with-margin` that hides anything.

#### MAJOR — the `unread` fallback claimed to know, and it was load-bearing

`openThreadUnread` answered `!hasSeenMark(threadId, ts)` where no row was found —
a module-level `Map` with a **page session's** lifetime (`useMarkSeenOnce`),
standing in for read state that SPEC.md §7 puts on the server and says "survives
browser changes". The mark can confirm a read and can never deny one, so the
negative branch was this tab reporting a conversation the server knows was read
as carrying something unseen. `ThreadPanel` latches a placement, so the guess was
permanent: Ask from the global composer (`useCompose`, `parent: null` — a
standalone thread), read the answer, resolve it, reload, open it, and it is
placed **expanded**, every time, against §6.

**The honest UI answer, and it is now what the code says.** Read state is
tri-state here, and the third value is named: `ThreadReadState = "read" | "unread"
| "unknown"` (`threadCollapse.ts`). The rule asks for **knowledge** —
`resolvedRuleCollapses` is `status === resolved && readState === "read"` — so
`unknown` stands it down exactly as `unread` does. That is the direction the
review preferred and the one §10 forces: a fold hides the turns (§7), so a
surface that cannot vouch they have been read cannot make §10's promise about
what the fold costs. The reader may still fold such a conversation by hand; the
override binds the rule, not them.

Three placements answer honestly now instead of guessing:

- `openThreadReadState` (was `openThreadUnread`) — the row when there is one
  (including `unread: null`, the contract's "no answer", as `unknown`);
  `hasSeenMark` **only** to confirm a read; `unknown` otherwise. A conversation
  with no confirmed turn is `read`, which is knowledge rather than a guess —
  there is nothing to have read, and `useMarkSeenOnce` treats it the same way.
- `summaryFromAnchor` — was `unread: true`, "the one thing an anchor cannot say"
  said as a fact. Now `unknown`. Same placement, no claim.
- `summaryFromRow` — `readStateOf(row.unread)`, so a thread row whose `unread` is
  null does not read as "nothing unseen".

**What changes on screen**: a collapsed line no longer says **"new"** for a
conversation nobody has evidence about. What does *not* change is the placement
itself — this is honesty about a guess that happened to land right, not a
behaviour fix, and the report says so rather than claiming more.

**The field this deletes.** `issues/contract/036-thread-unread-field.md` — filed
this round, precise about what it removes: with `unread` on `ThreadSchema`,
`openThreadReadState` becomes `readStateOf(thread.unread)` and the whole second
branch goes, along with the `hasSeenMark` import and the `useDocs({parent, type:
thread})` row lookup. `ThreadReadState` itself stays: an anchor still has no
answer to give.

#### MINOR — the latch survived less than it appeared to

`placedUnread` was a ref, so it was a property of one mounted component, and the
chip↔margin swap is an unmount and a remount (`slotHost` → `null`, `MarginColumn`
mounts a fresh panel). Dragging a column past `MARGIN_MIN_WIDTH` while reading a
resolved conversation re-placed it against the row it had just marked read and
folded it mid-sentence — "reading never collapses anything", broken by a resize
instead of by a round trip.

Moved into the surface: `ThreadCollapseApi.place` records what a conversation was
placed with, per thread, merged with `strongerReadState` so the answer only ever
gets more cautious, and taken fresh on a status change. **The lifetime is the
fix, not the memory**: `ThreadCollapseApi.hold` refcounts the panels showing a
conversation and drops the record on a microtask, so a swap (both panels in one
commit — React runs every removal's cleanup before every addition's setup) keeps
it, while leaving the document and coming back does not. Otherwise the repair
would have become this round's own MAJOR: a conversation placed expanded forever.

#### Verification

- **Each fix has a test that fails without it**, checked by reverting the fix and
  re-running:
  - CRITICAL — `e2e/anchors.spec.ts`'s "hides the anchor widget's chip, and leaves
    every other placement reachable" and two new `collapse.spec.ts` browser specs
    over a document carrying **both** an anchored and a whole-document comment
    (the fixture gap the review named: the existing deep-nesting case uses
    `{ ...NOTE, anchors: [] }`, which switches margin mode off). With the old
    selector: **3 failed**, all three on the collapsed line's visibility.
  - MAJOR — `AnchoredThreads.test.tsx`'s "does not announce a new turn on the
    row-less one it cannot vouch for", in both placements. With
    `summaryFromAnchor` back at `"unread"`: **2 failed**. Plus
    `openThreadCollapse.test.tsx`'s three direct cases over
    `openThreadReadState`, and the tri-state cases in `threadCollapse.test.ts`.
  - MINOR — `ThreadPanel.test.tsx`'s "does not fold under the reader when the
    column widens into the margin", with its counterpart "does fold when the
    reader leaves it and comes back" pinning the lifetime. With the latch put
    back in the component: **1 failed**, the swap one.
- `VITEST_MAX_THREADS=4 vitest run apps/ui packages/kit` — **2885 passed**, 0
  failed (2874 → 2885). Every prior assertion kept, including
  `AnchoredThreads.test.tsx`'s `rowKnown` cases and `ThreadPanel.test.tsx`'s
  disarming-interlock case.
- `playwright test collapse.spec.ts anchors.spec.ts` (`CORPUS_UI_PORT=5273`) —
  **29 passed**; and **under contention** per INFRA-020, `--workers=8
  --repeat-each=3`: **87 passed, 0 failed**.
- Full `playwright test`, default workers, `CORPUS_UI_PORT=5273` — **304 passed,
  2 failed**. The two are the documented environmental pair (`console.spec` /
  `smoke.spec` assert the strip reads "server unreachable", which holds only
  while `127.0.0.1:8765` is unbound; `lsof` shows the user's corpus server on it,
  pid 29851). Unchanged before and after this work.
- `tsc --noEmit` (apps/ui, `src` + `e2e`) clean · `eslint` clean on every touched
  file · `prettier --check` clean.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
