# [PLUGINS-010] Clicking a todo item opens its document with the item revealed

## Domain
plugins

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: PLUGINS-005, UI-037 (the reveal seam: discriminated payload
  through kit's onOpen/OpenTarget/NavEntry + reader scroll/flash support —
  sprint-023 OC5; there is no existing anchor-flash to reuse, the original
  criterion was wrong)
- Blocks: —

## Spec References
- SPEC.md §12 todos; §11 reader (anchor highlight/scroll behavior)

## Summary
Live dogfood report (2026-08-02): clicking an item row in the todos column opens
the parent todo document positioned at the top, with nothing indicating which
item was clicked. For long lists (the user has a 17-item document) the clicked
item can be off-screen. Expected: the reader opens scrolled to the clicked item
with a transient highlight — same visual language as the anchor-highlight flash
used when opening a thread's anchor.

## Acceptance Criteria
- [x] Clicking an item row opens the document scrolled so the item is visible
- [x] The clicked item gets a transient highlight (UI-037's `.reveal-flash`,
      the flash treatment the rest of the board wears) — **with one caveat that
      is core's, not this plugin's**: on a cold open the box is drawn one layout
      frame early and ends up one to two lines off. Diagnosed and escalated in
      the log below; reproducible with no plugin involved
- [x] Clicking the document group header keeps today's behavior (top of doc)
- [x] Works in both the column reader and full-screen focus — see "Full-screen
      focus, honestly" in the log: the reachable half is asserted end to end,
      the other half is pinned by UI-037's `FocusMode.test.tsx`

## Technical Design
### Files to Create/Modify
- `plugins/todos/ui/reveal.ts` (new) — the reveal payload, and the one place a
  parsed item is translated back into the words the reader will find
- `plugins/todos/ui/TodosColumn.tsx` — groups carry the document's whole item
  list and each open item's position in it; item rows open with a reveal
- `plugins/todos/ui/reveal.test.ts` (new), `TodosColumn.test.tsx`
- `apps/ui/e2e/reveal.spec.ts` — the producer half UI-037 left for this issue
- No `apps/ui` source change was needed: UI-037 shipped the reader half

## Testing Strategy
Component test for the click payload; e2e asserting scroll position + flash on
a long fixture document.

## E2E Verification Plan
Real app: 15+ item doc; click a bottom item in the column; reader opens with
that item visible and flashed.

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`), 2026-08-02, branch `dogfood-todos-polish`.**

### What was built

`plugins/todos/ui/reveal.ts` — `itemOpenRequest(docId, items, at)`, the payload a
clicked item row hands `onOpen`, on UI-037's seam. `TodosColumn` now carries each
group's **whole** item list (`all`) plus each open item's position in it (`{at,
item}`), because a reveal's frame is about what the *reader* renders, not about
what the column shows: a checked item between two open ones is a rendered line
and therefore a legitimate neighbour. The heading and "+N more" still pass a bare
`docId` — they name a document, not a line.

Payload rules, all pinned by `ui/reveal.test.ts` (12 cases):
- `exact` = the item's text **without** the inline due marker (the marker is part
  of the rendered line, so the quote still matches; leaving it out means a
  deadline edited between the click and the open does not cost the reveal, and
  the flash lands on the words rather than the bookkeeping);
- `prefix` = the previous line **with** its due marker (`chooseOccurrence` does
  `…trimEnd().endsWith(prefix)`, and the rendered text before the target ends
  with `(due: …)`, not with the item's words) — real-app payload confirms it:
  `"prefix":"Renew the car insurance (due: 2026-09-15)"`;
- `suffix` = the next item's text (matched with `startsWith`, so the marker is
  not needed);
- no item / blank text ⇒ `{docId}` alone. A reveal that cannot name its target is
  never sent: the reader would search for `""` and the entry would carry a dead
  instruction.

### Real-app drill (server + disk + git, no stubs)

Scratch workspace `/tmp/plugins010-drill` (`corpus init`), server on **8781**,
Vite on **5274** (8765/5173 untouched, both left to their holders). Fixture:
`data/docs/inbox/house-chores.md`, **17 items** — three of them the identical
"Call the plumber about the boiler" (positions 0, 5, 16), a checked item at 2,
deadlines at 1/4/12 — plus a pinned `column: todos/todos` view document. The
plugin's own route answered from the real body: `GET /api/x/todos/lists` → one
list, `items` length 17.

Concrete observations, all from a real Chromium against that server:

1. **The payload, captured off the navigation entry before the reader consumed
   it** (click on the 6th item, the *second* duplicate):
   ```json
   {"docId":"doc_housechores","scrollY":0,
    "reveal":{"kind":"item","exact":"Call the plumber about the boiler",
              "prefix":"Renew the car insurance (due: 2026-09-15)",
              "suffix":"Order more coffee"}}
   ```
   The real neighbours, the marker in the frame and not in the target — exactly
   what the unit tests describe, produced by the shipped column.
2. **Scroll.** In a 620 px-tall viewport the target starts below the fold; after
   the click `reader-scroll.scrollTop` = **257** and the line's box is fully on
   screen (`targetOnScreen: true`, text read back as "Call the plumber about the
   boiler"). A heading click on the same list leaves `scrollTop` at **0**.
3. **One-shot.** The entry after the reveal is
   `{"docId":"doc_housechores","scrollY":257}` — instruction gone, scroll kept —
   and a reload re-opens the document with **0** flash layers. The heading path
   never writes a `reveal` at all.
4. **Transient.** `[data-reveal-flash]` goes 1 → 0 on its own; the document's 17
   rendered lines are untouched.
5. **The right occurrence is chosen.** Under the stub e2e (below) the flash lands
   on the clicked duplicate; the real-app run confirms the frames reaching the
   reader, and the mutation check below proves the assertion is load-bearing.

### Defect found by the drill — the flash box is stale by one layout frame (core, not this plugin)

The real app exposes something the stub never does. Frame-by-frame instrumentation
of a cold open (`requestAnimationFrame` sampling both the flash box and the target
line in the same tick):

```
t=470  flashY=580  target li[5] y=579   ← drawn, correctly, on the target
t=471  flashY=580  target li[5] y=527   ← the document settled; the box did not
```

The tree at those two frames says what moved:

```
t=470  DIV.doc-main h=1086   fm-chips h=51  doc-title y=236  doc-panel y=268  doc-editor y=346 h=635
t=471  DIV.doc-main h=1033   fm-chips h=23  doc-title y=208  doc-panel y=240  doc-editor y=318 h=611
```

`.fm-chips` un-wraps from two rows to one (−28 px) and the editor re-lays out
(−24 px) on the frame **after** `hasContent` first went true — so the reveal fires
against a layout that is one frame old, and `flashRange`'s fixed-position boxes,
drawn once from client rects, never follow. The user sees the highlight one to two
lines below the line they clicked (screenshot `/tmp/plugins010-scroll.png`: the box
sits under "…about the boiler", not on it).

**This is core's, not the producer's.** Driving the *seeded* UI-037 path against
the same real document — no plugin click anywhere — misaligns identically
(`flashY: 450` while the target line sits at `527`). And in the todos column every
open is a cold open: the column list is replaced by the reader, so there is no
"document already rendered" click that would land on a settled layout.

Escalated to the orchestrator for a `ui` follow-up (re-measure the range for a few
frames, or observe the container while the flash is lit). Nothing in
`plugins/todos` can influence when the reveal fires or where the boxes are drawn.
Everything this issue owns — the payload, the occurrence choice, the scroll, the
one-shot — is correct in the real app.

### Stub e2e (the producer half of `reveal.spec.ts`)

`apps/ui/e2e/reveal.spec.ts` extended per UI-037's report with the missing
producer case: 7 new tests that **click a real row in the real plugin column**
(only the plugin's aggregate route is stubbed; the column, the payload and the
reader are shipped code). `CORPUS_UI_PORT=6073`:

```
Running 15 tests using 4 workers
  ✓ a click on a todo item › opens its document scrolled to that line, and flashes the line (1.8s)
  ✓ a click on a todo item › reveals the duplicate that was clicked, not the first line with the same words (1.6s)
  ✓ a click on a todo item › reveals the first of the duplicates when that is the one clicked (1.7s)
  ✓ a click on a todo item › leaves the document alone: the flash is drawn over it and takes itself away (4.0s)
  ✓ a click on a todo item › spends the instruction — reopening the board flashes nothing (2.7s)
  ✓ a click on a todo item › opens the document at the top when the list heading is clicked instead (1.8s)
  ✓ a click on a todo item › carries into full screen as an open, with the instruction already spent (3.1s)
  15 passed (11.2s)      ← the 8 seeded UI-037 tests still green alongside them
```

**Mutation check (the frame is load-bearing).** Dropping `prefix`/`suffix` from
`itemOpenRequest` — leaving `exact` alone, which is what this issue would have
shipped without OC4 — turns "reveals the duplicate that was clicked" red
(`expect(received).toBeLessThan(expected)`: the flash moved to the *first* line
with the same words) while "reveals the first of the duplicates" stays green,
which is exactly the silent wrong-item failure. Restored immediately; suite green
again.

### Full-screen focus, honestly

Criterion 4 is met by the seam, and the reachable half is asserted here. A plugin
column body is handed `onOpen` and no focus seam (`Column.tsx` gives
`onOpenFocus` to core rows only), so **no producer can put a reveal into focus
mode today** — `FocusMode`'s honouring of both reveal kinds is pinned by UI-037's
`FocusMode.test.tsx`. What the e2e asserts instead is the claim that can bite:
expanding to full screen after a reveal shows the same document with all its
items, and the spent instruction does not fire a second time in the other host.

### Gates

- `vitest run plugins/todos/ui` → 5 files, **86 tests**, all passing
  (`reveal.test.ts` 12 new, `TodosColumn.test.tsx` 16 incl. 3 new/changed).
- `tsc --noEmit` clean in `plugins/todos` and `apps/ui`.
- `eslint` + `prettier --check` clean on every file touched; no suppressions.
- Scoped runs only, `VITEST_MAX_THREADS=4`; playwright only this spec on 6073;
  drill processes (server 8781, Vite 5274) stopped, ports verified free.
- Coordinated with the concurrent PLUGINS-009 agent by file: this change is the
  row's click/open wiring and `ui/reveal.ts`; its `itemAnchor.ts`, `PluginMenu`
  and `TodoItemMenu` were not touched. The one shared file is `TodosColumn.tsx`,
  where this diff is the group shape (`all` + `{at, item}` — which that issue's
  menus need anyway) and the `onClick`.

### PR #19 review follow-up — MAJOR 1: a deadlined duplicate revealed the wrong line

**Model: Opus 5 (`claude-opus-5[1m]`), 2026-08-03, branch `dogfood-todos-polish`.**

The frames this issue shipped were asymmetric: `prefix` carried the previous
line's due marker (correct — it is rendered text), `suffix` carried only the
next item's words. But the target's **own** marker sits between `exact` and the
next line, so the reader's `chooseOccurrence` — which tests the suffix with
`trimStart().startsWith(tail)` — was matching against `"(due: 2026-08-09) Send
the form"` and could never satisfy a suffix of `"Send the form"`. It fell back
to the first occurrence, so **clicking the second of two identical deadlined
items flashed the first**. Confidently wrong, not degraded; exactly what
sprint-023 OC4 exists to prevent.

The gap was baked into the tests: `reveal.test.ts` pinned the unmatchable
payload (single occurrence, so the fallback hid it), and `reveal.spec.ts` put
its `due` on the **non-duplicated** item, so producer and consumer never met.

**Fix** (`ui/reveal.ts`): a new `dueMarker(item)`, and `suffix` is now the
target's own marker joined with the next line's *full* rendered text — built the
same way `prefix` always was. `exact` still excludes the marker (documented,
wanted: a deadline edited between click and open costs the frame, which degrades
to the first occurrence, not the quote, which would find nothing). Also
tightened: an out-of-range index now returns before `exact` is computed instead
of relying on `?.`.

**Red proof, unit** (new tests against the pre-fix producer):

```
× itemOpenRequest > quotes a deadline in both frames and never in the target
× itemOpenRequest > frames the last item with its own deadline when it has one
× …against what the reader does with it > lands on the clicked duplicate when the target carries a deadline
     AssertionError: expected null to be 116        ← no occurrence satisfies the frame
× …against what the reader does with it > lands on the first duplicate when that is the one clicked
     AssertionError: expected null to be 33         ← the *first* one's frame was unusable too
× …against what the reader does with it > resolves every item of a mixed list onto its own line
  Tests  5 failed | 13 passed (18)
```

The new `describe("itemOpenRequest, against what the reader does with it")`
crosses producer and consumer: it builds the string the reader actually indexes
(collapsed, markers included) and runs the reader's occurrence rule over it,
**without** its first-occurrence fallback — the fallback is right in production
and is precisely what hid this for a release. It restates `chooseOccurrence`
rather than importing it because a plugin may not import `apps/ui` and the kit
publishes no reveal matcher (see the kit gap below).

**Red proof, real browser** (the un-copied crossing). `apps/ui/e2e/reveal.spec.ts`'s
fixture now puts the deadline on the **duplicated** item. Mutation check —
restore the old one-line `suffix` and run the spec:

```
PASS (17) FAIL (1)
1. reveals the duplicate that was clicked, not the first line with the same words
   Error: expect(received).toBeLessThan(expected)      ← the flash moved to the first line
```

Restored; `reveal.spec.ts` **18 passed**, and 26 passed with `todos-menu.spec.ts`
alongside it (`CORPUS_UI_PORT=6373`; 5173 and 8765 left to their holders). One
flake seen once under two specs × two workers — "carries into full screen as an
open" — passed alone and passed on the re-run of the pair; unrelated to this
change (focus-mode expansion timing).

`plugins/todos` → **15 files, 369 tests, all passing**. `eslint --max-warnings 0`,
`prettier --check`, `tsc --noEmit` clean in `plugins/todos` and `apps/ui`; no
suppressions.

**Kit gap, one entry wider than UI-045 item 1 records**: `chooseOccurrence` is
the consumer of every reveal a plugin will ever produce and it lives in
`apps/ui/src/reader/reveal.ts`, unreachable and untestable from a plugin. The
crossing test above is a restatement, which is the same drift risk
`SELECTOR_CONTEXT` has. Publishing the matcher (or a frame builder) from the kit
would let a producer be tested against the real consumer — worth folding into
UI-045.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
