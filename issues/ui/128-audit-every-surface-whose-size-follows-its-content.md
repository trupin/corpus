# [UI-128] Audit: every surface whose size follows its content

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-057 (signed 2026-08-20)
- Blocks: UI-129, UI-131, UI-132, UI-133, UI-134, UI-135
- Related: UI-127 (the instance that prompted it)

## Spec References

- SPEC.md **§10** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)

## Summary

Requested by the user, 2026-08-20, after finding UI-127: *"Something else which I
notice is present in the UI in general. Elements resize based on their content,
which then moves other elements that are stacked on top of it or aligned right.
We should do an audit of all the places where that's the case… Instead, we should
find other ways like using tool tips, drop downs, etc… We should also figure out
ways for sizes to be enough for most texts to fit."*

SHARED-057 turns that into a rule. This issue measures the product against it.

## Scale, measured before the audit ran

- **28** stylesheets and **230** components across `apps/ui/src`, `packages/kit/src`, `plugins/`
- **8** sites anchor absolutely and grow back toward what they are anchored to — UI-127's exact shape
- **9** files use `margin-left: auto` or `justify-content: flex-end`, where a sibling's width decides a neighbour's position
- **18** places already truncate with `text-overflow: ellipsis`, which is the pattern SHARED-057 wants and the floor to compare against

## What the audit produces

A **ledger**, written into this issue: one row per site, each carrying

1. the file and the element
2. what content drives the size (a name, a count, an async value, a hover preview)
3. what moves as a result, and whether a person can be pointing at it when it moves
4. a severity: **reachable** (a person can hit it in ordinary use), **latent**
   (only with unusual content), or **compliant** (already sized or truncated)

Then **one issue per reachable cluster**, not per site — a whole surface with one
cause is one issue.

## The ranking, and why it decides the release

The user asked for the audit and the fixes. The fixes are ranked by whether a
person can hit them, and this release takes the reachable ones. **A cluster too
large to finish is filed rather than half-built**, and the release says what was
cut.

## Acceptance Criteria

- [x] Every stylesheet and every component that renders variable text is looked
      at — the sweep's coverage is stated, and anything skipped is named with a
      reason
- [x] The ledger distinguishes **reachable** from **latent** with a stated test,
      not a feeling: can a person be pointing at, or reading, the thing that
      moves?
- [x] The four known shapes are each searched for by name: pointer-driven preview
      (UI-127), async-arriving value, digit-count growth, and right-aligned rows
      whose sibling varies
- [x] Findings are **verified in a real browser** before being called reachable —
      a CSS rule that looks unstable may be constrained by a parent, and jsdom
      implements no layout
- [x] Sites that are already compliant are listed too, briefly. An audit that
      only reports faults cannot be checked for coverage
- [x] One issue per reachable cluster, filed with a `PLAN.md` row

## Technical Design

### Files to Create/Modify

- this issue (the ledger)
- `issues/ui/*.md` — one per reachable cluster
- `issues/PLAN.md`

### Key Implementation Details

**Read SHARED-057's applied text in SPEC.md §10 first**, and measure against it
rather than against taste. Its four clauses are the rubric: size follows place
not content; overflow is revealed not accommodated; boxes are sized for real
content; the one exception grows into empty space.

The sweep parallelises cleanly by surface — board, reader, thread, console,
compose, kit, plugins — and is read-only, so it may run as a fan-out.

### Edge Cases

- A body with no knowable size (document, thread) — SHARED-057's stated exception,
  and must be recorded as compliant rather than as a finding
- A component whose parent already constrains it, so the CSS reads unstable and
  the rendered result is not
- Content that only grows in a workspace larger than any test fixture

## Testing Strategy

The audit itself is not code. Each filed issue carries its own strategy, and the
pattern UI-127 sets — measure a bounding box, change the content, measure again —
is the one to reuse.

## E2E Verification Plan

### Verification Steps

1. Real Vite dev server, ports not 5173 / not 8765
2. For each candidate, produce the content that would grow it and watch what moves
3. Record the measurement, not the impression

---

# THE LEDGER

_Implemented on: opus. Real Chromium, real Vite dev server on `5284`, real React,
real TanStack cache; the API served in-page by `apps/ui/e2e/stubCorpus.ts`.
Throwaway specs were kept outside the repo, in the session scratchpad, because
`apps/ui/e2e/` belonged to the UI-127 agent while this ran._

## How severity was decided

**The stated test, applied to every row.** A site is **reachable** when both hold:

1. **Real content a user plausibly has** drives the change — not a fixture
   contrived for it. This is UI-127's own lesson: two lanes whose statements
   happen to be the same height reproduce nothing, and the first attempt at that
   reproduction passed for exactly that reason.
2. **A person can be pointing at, or reading, the thing that moves** at the
   moment it moves.

Everything else is **latent**: the CSS permits the growth, but either the content
is unusual or nothing a person is engaged with moves.

**Reachable additionally requires a measurement.** A reading-level diagnosis is
not a reproduction — UI-127's own reading had the direction of the movement
backwards, and only the browser corrected it. Every row below carries a
**Verified** column: `measured` rows were reproduced in Chromium and carry their
numbers, `read` rows were not, and **no `read` row is called reachable**. That is
deliberate and it is the audit's main self-imposed limit: several `read` rows
look worse than measured ones and are named as promotion candidates.

## Headline counts

| Severity | Count |
| --- | --- |
| **reachable** (measured) | **12** sites, in **6** clusters |
| **latent** | **31** sites |
| **compliant** | **58** sites |

---

## A. REACHABLE — measured in a browser

### Cluster 1 — An image reserves no box, so the words below it move when it decodes → **UI-129**

| # | File + element | What drives the size | What moves | Person engaged? | Verified |
| --- | --- | --- | --- | --- | --- |
| A1 | `packages/kit/src/markdown/CorpusImage.tsx:103-112,115` — `ViewableImg` builds `src, alt, className, title, data-att-target` and **no `width`, `height` or `aspect-ratio`**; CSS is `max-*` only (`apps/ui/src/thread/thread.css:258-265` `.turn-att-img`; `packages/kit/src/markdown/markdown.css:127-129` `.doc-body img`) | The file's own pixel dimensions, known only after decode | Everything below the image in the same body or turn | Yes — decode fires while the person is reading, and the turn's `💬` / `✕` controls are directly below | **measured** |

**The measurement.** A document body with one **48×36** PNG and a sentinel
paragraph under it, with the attachment response held open and then released:

```
IMG before: box=0x0   sentinel_y=307
IMG after : box=48x36 sentinel_y=320
IMG moved sentinel by 13px
```

The `<img>` occupies **zero** until it decodes. 13px is the floor, from the
smallest fixture in the repo. `.turn-att-img` caps at 180px, so a screenshot in a
turn displaces up to **180px**; `.doc-body img` caps **width only**, so a tall
screenshot in a document body displaces an unbounded amount. `CorpusImage` is the
single renderer for every image in the product (`CorpusImage.tsx:12-20` says so),
so this one site is the thread, the reader, the editor and every plugin at once.

### Cluster 2 — The reader head has no shrink budget, and its controls leave the column → **UI-135**

| # | File + element | What drives the size | What moves | Person engaged? | Verified |
| --- | --- | --- | --- | --- | --- |
| A2 | `apps/ui/src/reader/Reader.css:30` `.reader-head`; `:40` `.back` (`flex: none`), `:53` `.reader-id` (`margin-left: auto`, nowrap), `:61` `.save-chip` (`flex: none`, nowrap), `:69` `.expand`. Column variant `apps/ui/src/board/Column.css:348,363`. Text from `apps/ui/src/editor/SaveChip.tsx:69-89` | `saveChipText()` walks `""` → `saving…` → `committed · git ✓` → `committed · git ✓ · 12 anchors orphaned`. Both async-after-paint and digit growth in one string | `.reader-id` walks left; past a threshold the whole row overflows and `.col { overflow: hidden }` clips `⋯` and `⤢` | Yes — the chip changes *because the person just typed*, and `⋯`/`⤢` are the controls they reach for next | **measured** |

**The measurement, part 1 — the ordinary case.** A reader at its default width,
each chip string in turn:

```
""                                        head_w=558 id_x=390 chip_w=  0 expand_x=507
"saving…"                                 head_w=558 id_x=346 chip_w= 44 expand_x=507
"committed · git ✓"                       head_w=558 id_x=283 chip_w=107 expand_x=507
"committed · git ✓ · 3 anchors moved"     head_w=558 id_x=169 chip_w=221 expand_x=507
"committed · git ✓ · 12 anchors orphaned" head_w=558 id_x=144 chip_w=247 expand_x=507
```

`.reader-id` travels **246px** across the chip's states. The buttons hold,
because `margin-left: auto` spends the slack first. **That is the well-behaved
case, and it is only well-behaved while slack exists.**

**The measurement, part 2 — the slack running out.** The same head, with a `Back`
label that is a real document title (`.back` is capped at `max-width: 40%`) and
the longest save chip:

```
head=19..577  scrollW=655  clientW=558  lastRight=674
kids= back@31..245 reader-id@253..354 save-chip@362..608 expand@616..644 expand@652..674
```

**655px of content in a 558px box.** `⤢` ends at x=674 against a head that ends
at 577 — **97px outside the column**, and clipped. Both head controls become
partly or wholly unclickable, and the trigger is saving a document you opened
from a long-titled parent. No item in the row can shrink: `.back` and
`.save-chip` are `flex: none`, and `.reader-id` is `nowrap`, so its min-content
is the whole string.

### Cluster 3 — A label that arrives late reflows the row it lands in → **UI-131**

| # | File + element | What drives the size | What moves | Person engaged? | Verified |
| --- | --- | --- | --- | --- | --- |
| A3 | `apps/ui/src/console/LaneList.tsx:82` `.lane-weight` (`apps/ui/src/console/console.css:562-567`, `flex: none`), via `residentsModel.ts:186` → `weightLabel` (`packages/kit/src/address/addressModel.ts:188`) | `weightLabel` returns the **raw key** while the level table is unknown. `packages/kit/src/weight/useWeightLevels.ts:155` needs an exhaustive paged `?type=skill` scan **then** a `useDoc` before it can parse the table | `.lane-name` re-ellipsizes; `.lane-mark` and the weight itself slide left | Yes — the lanes are `<button>`s a person clicks the instant the tab opens | **measured** |
| A4 | `apps/ui/src/console/LaneScope.tsx:86` — same swap in the detail pane, where `.lane-scope-head .lane-name` is `flex: none; max-width: 40%` (`console.css:591-595`) so **only** `.lane-statement` can pay | Same | The sentence the tab exists to show shifts right and re-truncates by the same amount | Yes | **read** (same code path as A3; listed reachable on A3's measurement, not on its own) |

**The measurement.** The Residents tab with a designated resident at `weight:
heavy`, and the orchestrate skill's body held open then released:

```
BEFORE (skill body still in flight)
   name  : researcher [x=32 w=251]
   weight: heavy      [x=293 w=33]
   meta  : live       [x=337 w=27]
AFTER  (label arrived)
   name  : researcher [x=32 w=132]
   weight: Heavy or judgment-laden [x=174 w=152]
   meta  : live       [x=337 w=27]
```

**+119px on the weight, −119px on the name, and the weight's own left edge jumps
119px left** — a third of a 380px row, on a row that is a click target.
`.lane-meta` holds only because `.lane-name` is the flex-grow item that absorbs
it; the name is what re-truncates.

**On reachability, honestly.** `apps/ui/src/shell/Shell.tsx:128` warms
`useWeightLevels()` at mount, and the console tab resets to `jobs` on reload
(`Console.tsx:51`), so a person who reloads and then walks to Residents usually
finds the label already cached. The window is real but narrow on a small
workspace. It widens exactly where the scan is longest — `scanForOrchestrateSkill`
pages `?type=skill` until it finds the skill, and §7's skill genesis makes a
workspace's skill count grow in ordinary use. **This cluster's value is the shape,
not this one site**: the same key-or-id-then-label pattern is what A5–A7 below
and L1–L5 further down all are, and the fix is one reserved box per row.

### Cluster 4 — A bottom-anchored stack collapses toward its anchor → **UI-132**

| # | File + element | What drives the size | What moves | Person engaged? | Verified |
| --- | --- | --- | --- | --- | --- |
| A5 | `apps/ui/src/shell/Toasts.css:3-12` `.toast-wrap` — `position: fixed; bottom: 18px; flex-direction: column`; `apps/ui/src/shell/Toasts.tsx:79` puts the **newest first**, so the **oldest is the bottom child**, and `:80-83` expires it on a 6s timer | Which toasts exist, and their own text height (`.toast { max-width: 360px }`, wraps) | Every toast above the expiring one **drops** toward the anchor. Each carries a `✕` close button (`Toasts.css:44`) | Yes — the `✕` is a click target and the drop is on a timer nobody controls | **measured** |

**The measurement.** Three toasts in the real `.toast-wrap`, then the oldest
removed:

```
before: 0@y=568 1@y=615 2@y=663
after : 0@y=615 1@y=663
```

**47px, per expiry, under the pointer.** This is UI-127's shape exactly — bottom
anchor, growth back toward it — with a timer in place of a hover as the trigger.
Aiming at one toast's `✕` and hitting the next one down is the ordinary outcome.

### Cluster 5 — The console strip's height is its text, and the board pays for it → **UI-133**

| # | File + element | What drives the size | What moves | Person engaged? | Verified |
| --- | --- | --- | --- | --- | --- |
| A6 | `apps/ui/src/console/console.css:17-27` `.console-strip` — **no `height`, no `min-height`**; `.console { flex: none }` (`:11`) against `.board { flex: 1 }` (`apps/ui/src/shell/Board.css:4`) | Any strip child that can wrap. `.c-plugin-warn` (`ConsoleStrip.tsx:54`) **has no CSS rule anywhere in the repo** and is the one wrappable child; `.index-detail` (`console.css:181-186`) sets `overflow-wrap: anywhere` and wraps *by design* | Every board column and every open reader **shortens**, with no gesture from the person | Yes — the strip repaints on server and index state, unprompted | **measured** |
| A7 | `apps/ui/src/console/IndexPill.tsx:62-63` + `console.css:169-192` `.index-status` / `.index-detail` / `.index-failed`; `ConsoleStrip.tsx:145` mounts the whole pill only once `GET /api/index/status` answers | The server's free-text progress sentence, rendered verbatim, changing as indexing runs; `9 failed` → `147 failed` | The pill materialises (~210px) and pushes `.c-counts` right; a wrapped detail adds a line and triggers A6 | Yes — the strip is the collapsed click target, painted on the first frame | **read** (listed reachable on A6's measurement of the same mechanism) |

**The measurement.** The strip at rest, then with one realistic
skipped-plugin sentence appended:

```
rest      : strip_h=40 board_h=623 board_bottom=679
with warn : strip_h=62 board_h=601 board_bottom=657
```

**+22px on the strip is −22px on the board**, and the board's bottom edge rises
by the same. This is the one thing `console.css:1-9` and `Console.tsx:14-28`
promise cannot happen.

### Cluster 6 — Counts, ages and durations are not digit-stable → **UI-134**

| # | File + element | What drives the size | What moves | Person engaged? | Verified |
| --- | --- | --- | --- | --- | --- |
| A8 | **`font-variant-numeric: tabular-nums` appears nowhere in the repository.** A repo-wide search for `tabular-nums` and for `font-variant-numeric` across every stylesheet returns nothing | Every count, age, duration and elapsed timer in the product | Whatever sits beside them, on every digit-count crossing | Sometimes — see below | **measured** (the absence; the amplitude is per-site) |

The affected spans, all of which change while a person watches:
`.col-count` (`Column.css:135`), `💬 {n}` (`ReaderHead.tsx:125`), `.cp-meta`
(`Reader.css:376`), the save chip's anchor counts, `.c-counts` and the agent
pill's `queue N` (`console.css:57-92`), `.index-failed` (`:188`), `.scope-count`
(`:605`), `.lane-meta` (`:569`), `.age` (`row.css:117`), `UnreadBadge`
(`packages/kit/src/row/badges.tsx:38-41`), `humanizeElapsed`
(`packages/kit/src/time/elapsed.ts:13`), `.todos-group-count` (`todos.css:370`).
`var(--mono)` equalises digit widths but does **not** reserve a digit slot, so
`9 → 10` still adds a glyph.

Low amplitude, very high frequency, and one of the cheapest fixes available. It
is filed last for that reason, not because it is unimportant.

---

## B. LATENT — the CSS permits it, but the content is unusual or nothing engaged moves

Every row here was reached by reading. **None was measured**, and none may be
promoted to reachable without one. The `promote?` column names the ones that
looked closest to the line.

| # | File + element | Mechanism | Why latent | promote? |
| --- | --- | --- | --- | --- |
| L1 | `apps/ui/src/editor/RefNodeView.tsx:81` `{alias ?? title ?? id}` with `useDoc(id)` at `:46` | An un-aliased `[[ref]]` paints as `doc-20260819-a3f9` (17ch) then becomes a 37ch title, **inside contenteditable**. The paragraph rewraps; a gained line drops every block below it | I could not get a `.ref` node to render in the reader in the time available (my probe measured `absent` in both states), so the reflow is unconfirmed. `DocView.tsx:331-346` argues this exact hazard for a different cause | **yes — highest** |
| L2 | `apps/ui/src/reader/ScopeProvenance.tsx:52-73`, mounted `DocView.tsx:429` **above** the body; `Reader.css:657` (`flex-wrap: wrap`) | `useResidentLane(docId)` is a multi-hop §7 scope walk. `null` until it lands, then a ~28px band appears above the body; then `row.conversation ?? lane` swaps an id for a name and may wrap | Unmeasured. `DocView.tsx:378` holds paint for plugin discovery but not for this walk | **yes** |
| L3 | `apps/ui/src/anchors/AnchoredThreads.tsx:89,128` | A chip (~26px) or card (~100px+) is portalled *between two blocks of the body* a beat after the body paints | Unmeasured. `:31-53` defends the timing on §6/§10 grounds and predates the 2026-08-20 rider | **yes** |
| L4 | `apps/ui/src/search/FilterChips.tsx:177,190,238`; `filters.ts:174` (`hits.find(...)?.title ?? id`); `search.css:60` (`flex-wrap: wrap`) | A reference chip shows the id, then a 40ch title when the doc enters the hit set — and flips back as typing changes the set. The row rewraps and the result list drops ~28px mid-typing | Unmeasured | **yes** |
| L5 | `plugins/todos/ui/TodoListItem.tsx:72-74,127-144`; `todos.css:295-335` | `useTodoItems(row.id)` is async; the whole `.todo-items` preview block is **absent** until it lands, then ~65px appears inside every row at once | Unmeasured; needs the todos plugin loaded | **yes** |
| L6 | `apps/ui/src/thread/ResidentBadge.tsx:65-98` into `.t-head` (`Reader.css:471`, `flex-wrap: wrap`) | The badge inserts on `GET /api/agents`. `thread.css:598` asserts *"the head is one row"*, but `Reader.css:474` sets `flex-wrap: wrap`, so it wraps before it shrinks and adds a line | Unmeasured | yes |
| L7 | `apps/ui/src/reader/Reader.css:479` `.t-quote` inside a wrapping `.t-head`; `ThreadCard.tsx:161-164,249-250` | `headLabel` becomes `“<anchor quote>”` after `useDoc(parentId)`. `.t-quote` has **no `max-width`, no truncation** | Unmeasured, and needs a long quote | yes |
| L8 | `apps/ui/src/reader/Reader.css:168-215` `.title-grow`; `FrontmatterForm.tsx:316-330` | The mirror-grid exists **specifically** so the title box takes the height of its string. One wrapped line ≈ 30px, ≈38px in focus mode, and the whole body moves | **A direct, deliberate conflict, not an oversight.** UI-065 argued for it at length (`Reader.css:121-167`) and SHARED-057 was signed after. Clause 4's exception names a body, not a title | **escalate, do not fix silently** |
| L9 | `apps/ui/src/anchors/marginLayout.ts:71,105`; `useMarginLayout.ts:76-82` | `y = Math.max(top, lastBottom)`: an SSE turn arriving in card A pushes B, C, D down by its height, past Resolve and reply composers | Unmeasured. Clause 4 licenses a thread growing downward but not into space its siblings hold | yes |
| L10 | `apps/ui/src/anchors/useAnchorLayer.ts:572-593` vs `anchors.css:82` `.with-margin` | Margin mode turns on at `clientWidth >= 1100` and **shrinks that same element by 330px** — a `ResizeObserver` observing the element whose width the outcome changes. UI-127's loop, structurally | Guarded only by `MAX_COLUMN_WIDTH = 960` in a *different* module (`board/columnWidth.ts:27`) and by `inFocus`. One constant from live | **yes — audit the guard** |
| L11 | `apps/ui/src/thread/thread.css:113-122` `.working`; `PendingIndicator.tsx:77-253` | The 45s/3m/15m ladder rewords the row on its own clock, and `humanizeElapsed` appends a growing tail | **Measured and did not reproduce** — see the negative results below. Kept latent for narrow columns only | no |
| L12 | `apps/ui/src/console/JobList.tsx:64-77` `.job-blocked` (`console.css:381-384`, `max-width: 50%`) | `pending → deferred` inserts `🔒 <title>` — up to 190px — mid-row while the list is on screen; `.job-title` re-truncates | Unmeasured; needs a job to defer while watched | yes |
| L13 | `apps/ui/src/console/JobDetail.tsx:64,99-129` | `canAct` turns true on `failed`/`deferred`, so **Retry + Abandon (~135px) appear** beside `↗ open` in a painted header | Unmeasured | yes |
| L14 | `apps/ui/src/console/LaneScope.tsx:90-92` `.scope-count` (`console.css:605-609`) | The span does not exist until `GET /api/threads/{id}/scope` answers, then inserts `12 members listed` (~112px), growing leftward into `.lane-statement` | Unmeasured | yes |
| L15 | `apps/ui/src/console/AgentPill.tsx:90-95`; `consoleModel.ts:216-220` | `agent: unknown` (14ch) → `agent: disconnected · queue 0` (29ch) when queue status lands, then state words swap on a **15s clock with no request** | Unmeasured | yes |
| L16 | `plugins/todos/ui/TodoItemComposer.tsx:146-151` — `clampToViewport(..., { width: 320, height: 160 })` | **160px is a guess and the popover cannot be 160px**: quote + grow box + foot + padding already exceed it. Then it grows downward from a fixed `top` as you type, attach, or are refused | Clause 3 verbatim. Unmeasured | yes |
| L17 | `plugins/todos/ui/TodosColumn.tsx:196-204` `.todos-error` (`todos.css:589-610`) | The banner renders as the **first** child of the column, so a failed toggle pushes the whole list down ~50px one round trip after the click | Unmeasured | yes |
| L18 | `apps/ui/src/thread/ThreadComposer.tsx:118-122` and `ComposeOverlay.tsx:152-156` | `useLayoutEffect` sets the autocomplete's `top` from `rect.bottom`, with deps `[isOpen, items.length]` — **`text` is not a dep**, so the menu drifts as the textarea grows and *snaps* on the next keystroke that changes the item count, under a pointer that sets `activeIndex` on hover (`AutocompleteMenu.tsx:73`) | Unmeasured; needs a mention that wraps a line | **yes** |
| L19 | `packages/kit/src/components/Autocomplete/autocomplete.css:17-29` `.ac-menu` — `min-width: 250px`, **no `max-width`**; `.ac-item` (`:35-41`) has no truncation | The widest item decides the menu's width; the right edge moves as the list filters | Grows away from a top anchor | no |
| L20 | `packages/kit/src/row/row.css:68-74` `.row-badges` | The cluster's own width is content: `AgentActivityDot` appears on an SSE invalidation (+13px), `UnreadBadge` swaps `new` ↔ a count | `.row-title` yields correctly and nothing moves vertically | no |
| L21 | `packages/kit/src/row/row.css:285-293` `.reason` (`flex-wrap: wrap`); `reasons.ts:90-92` | `1 awaiting your answer` → `12 …` can reflow a chip to a second line in a narrow column, moving every row below | Needs 2–3 chips and a tight column | yes |
| L22 | `apps/ui/src/board/query/queryEditor.css:48` `.col-query-notice`; `QueryEditor.tsx:182-187` | `unknown.join(", ")` grows as unrecognised fields are typed, pushing `.col-list` down | Hands are on the keyboard; the list is not a target then | no |
| L23 | `apps/ui/src/search/search.css:125` `.search-note`; `SearchOverlay.tsx` | The note appears between filters and results as `results.semanticIndex` flips, dropping the list ~30px | Unmeasured | yes |
| L24 | `apps/ui/src/reader/Reader.css:104` `.fm-chips` (`flex-wrap: wrap`) | Adding a tag, or the `updated` chip appearing after the first save, rewraps the strip and drops the body ~24px | Usually user-initiated | no |
| L25 | `apps/ui/src/reader/Reader.css:639` `.related-doc .relation` beside an untruncated title | A long related title pushes the relation label out of the aligned column | Cosmetic; nothing else moves | no |
| L26 | `apps/ui/src/menu/MenuItems.tsx:31-32`; `docActions.ts:49-53` | Arming Delete swaps a 34ch meta for a 66ch one between the two clicks the confirmation requires | **Compliant by ordering luck**: Delete is last and the menu is top-anchored, so the second click target does not move. Reorder the list and it is reachable | no, but fragile |
| L27 | `apps/ui/src/menu/menuModel.ts:47` `MENU_SIZE = { width: 260, height: 200 }` | A constant stand-in for the real menu size, used by `clampToViewport`; `.ctx-menu` allows `max-height: min(60vh, 420px)` | Placement is decided once, before paint | no |
| L28 | `apps/ui/src/console/console.css:670-677` `.lane-note` inside `.lane-scope` (**no `min-height: 0`, no `overflow`**) inside `.console-body` (**no `overflow`**) | `scopeFailure` splices an arbitrary server message into a ~190ch note, which can paint past the bottom of the drawer | Nothing moves — but the text is lost, which is its own clause-2 failure | yes |
| L29 | `apps/ui/src/console/console.css:679-686` `.scope-bound` | A content-sized band in a fixed-height column steals from `.scope-list`; at `MIN_CONSOLE_HEIGHT` 120px it leaves ~30px of list | Arrives with the members, so no post-paint jump | no |
| L30 | `apps/ui/src/dev/DataProbe.css:17` `.probe-table` — auto layout, no column widths | `pending` → `ok`, `0 rows` → `128 rows` re-measures every column | Dev-only and unlinked; `DataProbe.tsx:18-21` says so | no |
| L31 | `plugins/todos/ui/todos.css:397-401` `.todos-bar { justify-content: flex-end }` | **Compliant by accident**: `Show completed` and `Hide completed` are both 14 characters in `--mono`, so the button's left edge does not move under the pointer that just clicked it. There is no `min-width` holding that | no, but fragile | **latent** |

### Two composers judged against clause 4, deliberately

- `apps/ui/src/thread/thread.css:143-150` — `.composer` is `position: sticky;
  bottom: -1px` and grows **upward into the turn stream**, i.e. back toward its
  own anchor. The 30vh cap (`:170-174`) is a real reserved ceiling and the sticky
  range is short, so this is **defensible under clause 4** — but it is the one
  composer whose growth direction is inward. Worth an explicit sign-off rather
  than leaving it implied.
- `apps/ui/src/compose/compose.css:21-32` — `.compose-panel textarea` has
  `min-height: 110px` and **scrolls** instead of growing. This is the fully
  compliant composer in the set, and the contrast is the argument.

---

## C. COMPLIANT — the floor to compare against

Listed briefly, because an audit that reports only faults cannot be checked for
coverage.

**Truncate in place, full value revealed** (clause 2 done right, 18 sites):
`.col-title` + `title=` (`Column.css:106`, `ColumnHead.tsx:158`); `.back`
(`Reader.css:40`); `.cp-quote` (`:362`); `.t-chip` (`:407`); `.job-title`
(`console.css:339`); `.job-blocked` (`:361`); `.lane-name` (`:542`);
`.lane-statement` (`:597`); `.scope-title` (`:639`); `.row-title` (`row.css:56`);
`.row-meta` (`:111`); `.t-resident-note` / `.t-resident-line`
(`thread.css:599-625`); `.turn-model` (`thread.css:45-59`, with the 32ch measured
against a real `claude-opus-4-…` id and the reasoning written out);
`.check .todo-item-text` (`todos.css:105`); `.todos-group-title` (`:364`);
`.chip` within `.chips` (`Column.css:175,190`); `quotePreview()` (a hard 90-char
cap, `CommentPopover.tsx:174-178`).

**Space reserved rather than accommodated** (clause 1 done by hand):
`.kbd-row .keys { min-width: 92px; flex: none }` (`keyboard.css:37`) — the model
site; `.row::before` reserves the staleness rail on **every** row and paints it
conditionally (`row.css:38-48`); `SaveChip` renders an **empty** `.save-chip`
rather than nothing when no editor is mounted (`SaveChip.tsx:41-48`);
`.expand` is `disabled` rather than unmounted while the doc loads
(`ReaderHead.tsx:135`); `↗ open` stays rendered-and-disabled
(`JobDetail.tsx:26-28`); `.doc-editor .ProseMirror { min-height: 1.62em }`
(`editor.css:34,61`); `.pending-atts:empty { display: none }`
(`composer.css:45-47`); `.att-chip img { height: 34px }` — a fixed height, so a
chip thumbnail does **not** reflow on decode, which is precisely the fix A1 is
missing; `console.css:130-141` refuses a border on the unknown dot *"because a
border would grow the dot to 9px and break the row of them"*.

**Fixed boxes, sized by their place** (13 sites): `.col { width: <stored>px;
flex: none }` (`Column.css:10`, the width is the view document's, never the
content's); `.job-list` / `.lane-list` at `380px; flex: none`;
`.comments-pop { width: 300px }`; `.comment-pop { width: 320px }`;
`.todo-comment-pop { width: 320px }`; `.ac-menu { max-height: 200px }`;
`.ctx-menu { max-height: min(60vh, 420px) }`; `.todo-menu { max-height:
min(60vh, 420px) }`; `.chip-menu { max-height: 240px }`;
`.reattach-context { max-height: 12em; overflow-y: auto }`;
`.fence-clipped { max-height: 420px }` with the 20-line measurement justified
against a real workspace (`markdown.css:337-361`) — clause 3 done properly;
`.doc-body { max-width: 62ch }`; `.check-list { max-width: 62ch }`.

**Paint held until the size is knowable**: `DocView.tsx:378` refuses to paint
until plugin discovery settles, with `DISCOVERY_BUDGET_MS` and a `paintedBlind`
latch so a late registry is honoured by the *next* document rather than by moving
words under a pointer. The best-reasoned compliance in the codebase, and the
model the async cluster should copy.

**Overflow revealed by an overlay that grows away from its anchor**:
`.fence-copy` is `position: absolute; top/right` with an opacity reveal, so
`Copy` → `Copied` → `Copy failed` shifts **no** text (`markdown.css:380-402`);
`reveal.css:1-15` + `reveal.ts:250-262` write only `top/left/width/height`, never
`bottom`/`right`, into a `pointer-events: none` fixed layer;
`SelectionToolbar.tsx:43-53` places from a measured rect, uses constant labels and
**closes** on scroll rather than chasing; `usePopoverShift` (`popover.ts:52-63`)
measures in a *layout* effect so the shift lands before paint, and slides rather
than flips.

**The one adaptive control that provably cannot oscillate**: `board/sortFit.ts`
degrades the sort label instead of wrapping, measures against an out-of-flow
`width: max-content` probe (`Column.css:217`), and its predicate (`:67`) is
**provably independent of the current state** (`:19-22`) — which is exactly the
property `useAnchorLayer.ts:572` (L10) lacks.

**Clause-4 growth into empty space, correctly**: `.job-log-lines`
(`console.css:465-478`, `flex: 1; overflow-y: auto`, with an 8KB-single-line
comment that is clause 2 in prose, and `JobLog.tsx:57-61` scrolling with
`scrollTop` rather than `scrollIntoView` **so it cannot move the page**);
`.reader-scroll` / `.focus-scroll` bodies; `Backlinks` and `RelatedPanel`
appended below everything; the search panel under `max-height: 78vh`; the
`.spacer` at `console.css:33` and `compose.css`'s, which are real reserves.

**Explicit non-findings on sites the brief named**: `Column.css:135`
(`.col-count`) — compliant, and the pattern the reader head should copy: the
count is async and digit-growing, but `.col-title` truncates and the auto margin
absorbs, so `＋` and `⋯` never move. `Column.css:204` (`.sort`) — compliant, and
the best site in the surface. `Topbar.css:55` — constant `⌘K` inside a
`max-width: 620px` bar. `search.css:231` — static string.
`ImageViewer.css:30` — `IMAGE_VIEWER_HINT` is a constant.
`row.css:69,118` — the right idiom, correctly paired with a yielding title.
`thread.css:63` — `.turn-comment` / `.turn-del` grow **leftward** with the
`+ .turn-del { margin-left: 0 }` correction, so the pointer stays inside the
button it is on. Deliberate and correct.

---

## D. NEGATIVE RESULTS — things that looked unstable and are not

Recorded because they cost real measurement time and because a future reader
should not re-open them.

**The pending indicator's escalation ladder does not grow its row.** Seven
fixtures across both vocabularies, measured at reader width:

```
fresh   (5s)  live   working_h=38  "queued — waiting for claims-review"
slow    (60s) live   working_h=38  "still waiting for claims-review"
longer  (4m)  live   working_h=38  "still waiting — claims-review has not picked this up yet"
elapsed (18m) live   working_h=38  "still waiting for claims-review — 18m"
fresh   (5s)  away   working_h=38  "waiting — claims-review is away, the agent will pick this up"
longer  (4m)  away   working_h=38  "still waiting — claims-review is away, the agent will pick this up"
elapsed (18m) away   working_h=38  "still waiting — 18m, claims-review is away, the agent will pick this up"
```

And without a lane, `queued — waiting to be picked up` through
`still waiting — 1h 05m, no agent is connected`: **`working_h=38` and
`composer_y=390` in every case.** The 62-character lane sentence does not wrap at
456px. It remains latent (L11) for a genuinely narrow column, and it is not
reachable.

**The `💬 n` threads button does not push the head's controls.** With
`margin-left: auto` on `.reader-id`, all free space sits *before* the id, so
everything after it is already packed against the right padding. Inserting the
button moves `.reader-id` and nothing else.

**Shape (a) — the pointer-driven text preview — exists in exactly one place.**
Three independent sweeps of `onMouseEnter` / `onMouseOver` / `onPointerEnter`
across `apps/ui/src`, `packages/kit/src` and `plugins/` return three hits:
`Column.tsx:273` (`onMouseOver={onActivate}`, no text change),
`AutocompleteMenu.tsx:73` (sets an index that swaps a background colour), and
`ComposerAddress.tsx:249` — **UI-127 itself**. Every `:hover` rule in
`console.css`, `row.css`, `thread.css` and `todos.css` changes background, colour
or border only. **UI-127 is not the tip of a class of hover bugs.** The class
behind it is shape (b), the async arrival, which is where 12 of the 31 latent
rows and 3 of the 6 reachable clusters sit.

---

## E. COVERAGE, and what was skipped

**Read in full: all 28 stylesheets** (6,292 lines) —
`anchors.css`, `global.css`, `Column.css`, `queryEditor.css`, `compose.css`,
`console.css`, `DataProbe.css`, `editor.css`, `ImageViewer.css`, `keyboard.css`,
`menu.css`, `FocusMode.css`, `Reader.css`, `reveal.css`, `reattach.css`,
`search.css`, `Board.css`, `Shell.css`, `Toasts.css`, `Topbar.css`, `thread.css`,
`address.css`, `autocomplete.css`, `composer.css`, `markdown.css`, `row.css`,
`tokens.css`, `todos.css` — each read **together with** the components beside it,
because a CSS rule that looks unstable is often constrained by a parent and the
reverse.

**Components**: every `.tsx` in `apps/ui/src`, `packages/kit/src` and
`plugins/todos/ui` that renders variable text was read. The four named shapes
were each searched for by name with `/usr/bin/grep` across all three trees:
pointer/focus preview (three hits, §D), async arrival (the dominant shape),
digit-count growth (§A8), and right-aligned rows (25 hits across 9 files, each
resolved above).

**Verified in a real browser**: 7 measurement specs, 18 measured states, on
Chromium against a real Vite dev server. Every **reachable** row carries its
numbers.

### Skipped, and why

1. **`packages/kit/src/address/*`** — under active edit by the UI-127 agent for
   the whole of this session. It is the audit's origin case and is already filed.
   **It has not been re-audited for anything beyond UI-127's own defect**, and
   should be swept again once that lands.
2. **`design/index.html`** — read for the toast and console-strip anatomy only.
   It is the look-and-feel authority, not a shipped surface, so its own layout
   was not audited.
3. **`plugins/todos` was read but not run.** L5, L16 and L17 need the plugin
   loaded in the dev server, which the scratch harness did not do. All three are
   filed as latent with `promote?: yes`.
4. **The 31 latent rows were not measured.** Named individually above with a
   `promote?` column. **`L1`, `L2`, `L3`, `L4`, `L5`, `L10`, `L16` and `L18` are
   the promotion candidates** — each looks reachable on reading and only lacks a
   browser measurement. A follow-up sweep should measure those eight first.
5. **`L8` (`.title-grow`) was deliberately not filed as a fix.** It is a
   documented, argued decision (UI-065) that SHARED-057 now contradicts.
   **Escalated to the orchestrator as a spec-adjudication question**, not handled
   as a defect.

## E2E Verification Log

### Post-Implementation Verification

_Implemented on: opus._

Environment: real Vite dev server on `5284` (`CORPUS_UI_PORT=5284`,
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8894`), real Chromium via Playwright, the
API served in-page by `apps/ui/e2e/stubCorpus.ts`. Scratch specs were kept in the
session scratchpad, not in `apps/ui/e2e/`, because that directory was held by the
UI-127 agent. Port `5284` was released at the end (`lsof -ti :5284` → empty).

Seven specs, eighteen measured states. The numbers are quoted in place above:

1. `a-residents-weight` — the console weight key→label swap: **+119px** on the
   weight, **−119px** on the name.
2. `b-pending-tiers` — five tiers, `working_h=38` in all five. **Negative
   result.**
3. `c-pending-lane-narrow` — seven lane fixtures, `working_h=38` in all seven.
   **Negative result.**
4. `d-image-reflow` — a 48×36 PNG moves the paragraph below it **13px** on
   decode, from `box=0x0`.
5. `e-reader-head` — `.reader-id` travels **246px** across the save chip's five
   states, at two viewport widths.
6. `f-head-overflow` — **`scrollW=655` in `clientW=558`**; `⤢` ends 97px outside
   the head.
7. `g-strip-toasts` — the strip grows **40→62px** and the board shrinks
   **623→601px**; a toast expiry drops the stack above it **47px**.

One harness lesson worth keeping: `rtk proxy` is required in front of
`npx playwright test`. A bare invocation was filtered to `PASS (0) FAIL (0)` while
the run had died on a module-resolution error — the same failure mode the memory
records for `tsc`.

## Completion Checklist (domain agent)

- [x] Ledger complete, coverage stated
- [x] Reachable findings verified in a browser
- [x] One issue per reachable cluster, filed
- [x] Self-review

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-128]` prefix
- [ ] Adjudicate `L8` (`.title-grow`) — UI-065's decision against SHARED-057

## Adjudications by the orchestrator, 2026-08-20

**1. `.title-grow` (`apps/ui/src/reader/Reader.css:168`) is compliant, not a
finding.** The auditor escalated it because the rule makes the title box's height
its text deliberately (UI-065 argued for it), and SHARED-057 was signed
afterwards. It stands, under the rider's own stated exception.

The exception reads: *"Where a surface genuinely cannot be sized ahead — a
document body, a thread — it grows in one direction only, into space nothing else
occupies."* A title being authored is such a surface: its length is unknowable
ahead, it grows downward only, and **the growth is caused by the author's own
keystroke**. What moves is the body below the caret, which is not what the person
is pointing at or reading at that moment. The failure SHARED-057 names is
something moving out from under a person; a field growing as you type into it is
the opposite — the caret stays with the text.

The clause "into space nothing else occupies" is the part that strains, since the
body does move. It is read as bounding the *direction and the cause* rather than
requiring literally empty space below, because on the strict reading no editable
field could ever grow, which is not what the rider was signed to mean.

**2. UI-127's hover shape is not a class, and the auditor is right to say so.**
`onMouseEnter` appears three times across all three trees and only one changes
layout — the bug itself. The class that actually recurs is the **late-arriving
value**, which accounts for three of the six reachable clusters (UI-129, UI-131,
UI-133). That is worth recording because the release is named for the hover
symptom, and the general defect is the asynchronous one.

**3. `packages/kit/src/address/*` was skipped** because UI-127 held it during the
sweep. It has since landed (UI-127) and gained a second finding of its own
(UI-130, the popover's missing ceiling, found by that issue's own measurement
rather than by this audit). **The address surface is therefore covered**, by two
issues, and does not need the re-sweep this ledger asked for.


## Corrections after PR #53's review, 2026-08-20

The reviewer read this ledger as a deliverable and found three places where it
does not hold up. All three are recorded rather than quietly edited, because a
ledger whose errors are silently repaired teaches a reader to trust it more than
it deserves.

**1. The headline "12 reachable sites" is not reconstructible from the table.**
The A-table has eight numbered rows, one of which lists twelve spans. The
stylesheet-coverage claim is checkable — 28, enumerated — and this count is not.
Read the **six clusters** as the load-bearing number: those are what issues were
filed against, and each is traceable to its rows. The site count is an
approximation of how many spans those clusters touch.

**2. `.col-count` is listed in §C as an explicit non-finding and again as a
cluster-6 span, which UI-134 then changed.** The two readings are not
reconcilable and §C is the wrong one: UI-134's own comment records that the count
re-cuts the title beside it, which is text a person is reading. Treat the
cluster-6 row as correct and §C's compliance reasoning as withdrawn.

**3. Adjudication 3 was wrong within hours and was left standing.** It ruled the
address surface *covered* and said it needed no re-sweep, because UI-127 and
UI-130 had worked it. UI-131's implementer then measured a reachable P0 in
exactly that surface — the address line pushing Send, filed as UI-137 and fixed
in this release. The adjudication is withdrawn: **the address surface was never
swept by this audit**, and it was two independent measurements, not this ledger,
that found what was wrong with it.

**4. One residual has no owner and now does.** UI-134's log flagged
`.lane-meta` — a word swapping on a fifteen-second clock, `margin-left: auto`, so
it re-cuts `.lane-name` beside it — as found-and-not-fixed. It appears in no
latent row here and in no issue. Filed as **UI-138**.
