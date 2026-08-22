# [UI-073] A plugin panel loading late moves the document under the pointer

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §10 Document view (plugin `DocPanel`, plugin `View`)
- SPEC.md §12 plugins (discovery)

## Summary
Escalated by UI-071 (2026-08-05), which went looking for a stale-anchor bug and
found this instead.

Plugin discovery is a dynamic `import()` started at bootstrap
(`apps/ui/src/plugins/registry.ts`), and a registered `DocPanel` renders **above**
the document body (`DocView.tsx`). When discovery settles *after* the editor has
painted, everything below the panel drops by the panel's height — **measured at
77.9px** in the todos workspace.

**Why this is a product defect and not only a test hazard.** The reader is where
you select text to comment. If the panel arrives mid-gesture, the words move out
from under the pointer between mousedown and mouseup, and the selection lands on
different text — silently, because the selection that results is perfectly valid.
UI-071's evidence is exactly this, driven deterministically:

| | x | y |
| --- | --- | --- |
| `Call the plumber`, panel absent | 54 | 306.7 |
| `Call the plumber`, panel present | 54 | 384.5 |
| `Chores that landed in the inbox.`, panel present | 33 | 315.95 |

A drag aimed at the item at y=306.7 released at y=317.2 — by then the *first
paragraph* — and selected `ores that landed `, two characters into a word. That
string then travelled all the way to a comment quote and a highlight.

A plugin `View` swapping in late is the same defect with a bigger jump, since it
replaces the body wholesale.

**Possible connection to a live report, worth checking rather than assuming:**
the user reported comments anchoring at the wrong place on 2026-08-03 (UI-062),
which was diagnosed and fixed as an offsets problem. Some of those may have been
this instead — a mis-selection rather than a mis-placement. The two are
indistinguishable after the fact from a screenshot, because both end with a
comment quoting words the user did not choose.

## The decision this issue has to make
Two shapes, and they trade differently:

1. **Reserve the slot's space.** The reader lays out as though a panel may
   appear, so nothing moves when it does. Cheap and total, but it costs vertical
   space on every document whether or not a plugin ever fills it, and the height
   is not known before the panel renders.
2. **Hold first paint until discovery settles.** Nothing moves because nothing is
   drawn early. Costs time-to-first-paint on every reader open, for a
   registration that is usually empty — and discovery is a network-ish import, so
   the wait is unbounded in the bad case.

A third, weaker option is to let it move but suppress the *consequence* — e.g.
cancel an in-flight selection when the layout shifts. That does not fix a click
landing on the wrong row, so it is a partial answer at best.

Whichever is chosen, say why in the code where the layout decision lives.

## Acceptance Criteria
- [x] A plugin panel arriving after first paint does not move content that is
      already on screen
- [x] Reproduced first, deterministically — hold the plugin manifest module at
      the route level until the reader has painted (UI-071's `todos.spec.ts`
      helper shows the technique) and record the shift before the fix
- [x] A drag started before discovery settles selects the words it was aimed at
- [x] A plugin `View` (which replaces the body) is covered too, not just a panel
- [x] No regression to time-to-first-paint that a user would notice, or if
      option 2 is chosen, a stated bound on the wait and what happens when
      discovery never settles
- [x] A document with no plugin panel looks unchanged — this must not cost
      vertical space on every reader for a slot nothing fills

## Technical Design
### Files to Create/Modify
- `apps/ui/src/plugins/registry.ts`, `apps/ui/src/reader/DocView.tsx`
- tests, plus an e2e that drives the late arrival deterministically

## Testing Strategy
Deterministic late arrival (module held at the route level), asserting geometry
before and after; a drag across the shift asserting the selected text.

## Decision: hold the document body, do not reserve space

`DocView` paints **nothing** of the document — not the panel, not the body, not a
plugin `View` — until plugin discovery has left the `pending` phase. The
argument, and the two alternatives it beats, is written where the layout
decision lives (`apps/ui/src/reader/DocView.tsx`, above the gate).

In short:

- **Reserving the slot's height** fails the last acceptance criterion outright —
  it spends vertical space on every document in the workspace for a slot almost
  none of them fill. The height is also not knowable in advance (the todos panel
  grows a legacy notice and a due chip), so the reservation would be a guess that
  still moves when wrong. And it cannot cover a plugin `View` at all: a `View`
  replaces the body wholesale at whatever size it likes — there is no slot.
- **Cancelling an in-flight selection** treats half the symptom. A plain click —
  placing a caret, ticking a task-list box — has no in-flight state to cancel and
  still lands on the row that moved into its place.
- **Holding** costs, in practice, zero. The registry goes empty → loaded exactly
  once per session, kicked off from `main.tsx` at bootstrap; the wait a reader
  adds is only whatever is left of a local module import after its own
  `GET /api/docs/:id` round trip, and every reader opened after the first settle
  waits for nothing at all. Core's boot stays uncoupled from plugin load time
  (§10's containment): the shell, board and keyboard are live from the first
  frame — only the surface whose geometry is at risk waits, and it says
  "Loading…" while it does.

**The bound** is `DISCOVERY_BUDGET_MS = 2000` (`plugins/registry.ts`). Past it
the phase turns `abandoned` and the body paints with no plugin chrome — an
unreadable document is worse than an unadorned one. A registry that lands after
that still installs; `DocView` keeps the already-painted document unadorned for
as long as it is on screen (`paintedBlind`), so the next document opened gets the
plugin rather than the words moving under a pointer that is already on them.

## E2E Verification Log

**Model: opus (claude-opus-5, 1M context).** Real Vite dev server on
**6021** (never 5173, never 8765), real Chromium driven by Playwright, real
React/TanStack/TipTap; only `fetch` is answered from `stubCorpus`. New spec:
`apps/ui/e2e/plugin-late-arrival.spec.ts`.

### The race is held, not raced

`holdDiscovery(page)` routes `**/plugins/**/manifest.ts*` and parks every request
on a promise the test releases by hand, so "discovery settles after the reader
painted" is a fact of the run. Every test asserts the interception count, because
a pattern that silently matched nothing would make all of them false passes.

### Pre-fix reproduction (before any source change)

Held discovery, opened `doc_todo` (`type: todo`, the todos plugin's `DocPanel`),
measured the text node reading exactly `Call the plumber`, released, re-measured:

```
Received: {"earlyY": 306.6875, "settledY": 384.546875, "shiftPx": 77.859375}
```

**77.86px**, and `earlyY` 306.69 is UI-071's own y=306.7 to the pixel.

Then the drag, driven straight through the arrival — mousedown at the left edge
of `Call the plumber`, one move, release discovery, wait for the panel, second
move, mouseup:

```
- Expected  - 1        Call the plumber
+ Received  + 5        in the inbox.
                       (blank)
                       Book the passport appointment (due: 2026-08-01)
```

A drag aimed at one task item came back holding the tail of the *first
paragraph* — starting mid-sentence — plus the whole item above the one it meant.
Silent, and a perfectly valid selection. Pre-fix run: **4 of 5 failed**
(`never paints…`, `shows the panel in the first frame…`, `selects the words…`,
`does not paint the core editor under a document a plugin View owns`); the fifth
(`costs a document with no panel nothing at all`) passed, as it must both before
and after.

### Post-fix

Same spec, same held discovery: **5 passed (4.5s)**.

- While held, the reader shows exactly one `.reader-note` reading `Loading…` and
  `boxOfText` finds no text node at all — there is nothing on screen to move.
- The frame the body first appears in already has `[data-todo-panel]` above it
  (asserted in the same commit).
- The drag now selects `Call the plumber`, one attempt, no re-measure.
- `fixture-note` (the `_fixture` plugin's `View`) never shows the core editor
  underneath: `[data-doc-editor]` count is 0 while held and 0 after
  `[data-fixture-view]` arrives — the body swap never happens because there is
  no first body to swap.
- A `type: note` document has zero `.doc-panel` nodes and its `[data-doc-editor]`
  is still the immediate next sibling of `.title-grow`: nothing was wedged in to
  hold a place.

### Regression sweep (same dev server, port 6021)

- `todos`, `todos-menu`, `todos-legacy`, `reader`, `anchors`, `anchor-layer`:
  **54 passed**.
- `editor`, `board`, `context-menu`, `reveal`, `render-fixes`, `thread`,
  `related`, `smoke`: **97 passed, 1 failed** — `smoke.spec.ts › a failing health
  check fails soft`. **Environmental, not this change**: that test asserts the
  workspace server is *unreachable*, and the user's live personal server is up on
  8765, which is the Vite proxy target. Re-run with
  `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8799`: **1 passed**.
- `abandon`, `autocomplete-keys`, `clipboard`, `column-header`, `column-width`,
  `compose-keyboard`, `console-index`, `console`, `fences`, `images`,
  `query-editor`, `search`, `turn-breaks`: **118 passed, 1 failed** —
  `console.spec.ts › keeps the failed-job count off the health notice's class`,
  the same "server unreachable" assertion and the same environmental cause.

### Unit

`vitest run apps/ui/src`: **2099 passed, 1 failed** — `src/anchors/offsetMap.test.ts
› is the same corpus the round-trip suite runs over` expects 14 fixtures and
found 15 (`src/editor/markdown/fixtures/hard-wrapped.md`, added by the concurrent
soft-wrap work in `apps/ui/src/editor/`). Untouched by this issue; flagged to the
orchestrator.

### The 2026-08-03 reports — checked, and this was not them

The only anchoring report that day is the one UI-062 was filed on, and it can be
ruled out as this defect on three independent grounds:

1. **The symptom is the wrong shape.** UI-062's screenshot showed the card pinned
   at the **top of the document with no highlight in the body at all** — a
   mis-*placement*. This defect produces a perfectly ordinary card beside an
   ordinary highlight, just over the wrong words. They are not indistinguishable
   after all, for this report.
2. **The quote is the words the user chose.** UI-062's captured `exact` was
   `Moushmi Verma** on repositioning Fernando under Mesbah` — a coherent span
   with the closing `**` proving both drag boundaries landed where the user put
   them. A shifted drag starts mid-word in a *different block*, as the
   reproduction above does.
3. **No panel could have moved that document.** `_fixture` is dev-only
   (excluded from production bundles by the `_*` convention), so the only
   `DocPanel` in a shipped workspace is the todos plugin's, and it claims the
   `todo` type alone. The reported document was a standup note. With no panel
   registered for its type, there is no late arrival and nothing to shift.

UI-062's own diagnosis (`offsetsComparable` false because the printer drops the
leading blank line, forcing `segments: []` for every anchor) explains the
reported symptom completely, and its fix was verified against the real report.
Nothing suggests a second cause hid behind it. No evidence either way exists for
reports *other* than that one — none were filed.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
