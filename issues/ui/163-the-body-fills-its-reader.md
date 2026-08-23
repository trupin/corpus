# [UI-163] The body fills its column, and full screen keeps its own width

## Domain
ui

## Status
done

## Priority
P0 (critical path)

## Model
opus

## Dependencies
- Depends on: SHARED-069
- Blocks: —

## Spec References
- SPEC.md Section 10 — "UI — the board", Document view (body-width rider,
  SHARED-069)
- SHARED-061 — a bound is derived from room, never chosen as a number

## Summary

A column reader carries two widths, and the user has to set both. Delete the
body's width **in a column**: the body fills the column, and the column's edge
becomes the one gesture. Full screen has no column edge, so it keeps its body
width, keeps it sticky, and keeps a default wider than a column's.

## Acceptance Criteria

- [x] The column reader has no body-width handle. Nothing inside a column sizes
      text independently of the column.
- [x] The body fills the column's content box at every column width, from the
      column's own minimum upward.
- [x] Dragging a column's edge moves the text with it, in the same frame, with no
      second act.
- [x] Full screen keeps its width handle, and the width it sets survives
      navigation and a reload.
- [x] Full screen's width is **one** sticky value, shared by every document
      opened there — not one per document and not one per column.
- [x] A column's width and full screen's width are unrelated: changing either
      leaves the other exactly as it was. A test asserts both directions.
- [x] Full screen's default measure is wider than a default column, **measured in
      a real browser** and pinned by a test — not inferred from two stylesheets.
- [x] With anchored threads in the margin, a column's body fills the room **left
      by** the margin. It does not overlap it and does not stop short of it.
- [x] Per-column entries in `corpus.docWidth` are no longer read, and are dropped
      on the next write. The full-screen entry survives the change — a user who
      set a full-screen width keeps it.
- [x] Anchored thread placement still tracks the body on both surfaces.
- [x] The column reader loses no keyboard capability: the removed handle was
      keyboard-operable, and the column's edge already is.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/reader/docWidth.ts` — narrowed to the focus surface: the
  per-column keying, `MAX_WIDTH_SURFACES` and its eviction go
- `apps/ui/src/reader/DocWidthContext.tsx` — provided by full screen only
- `apps/ui/src/reader/Reader.tsx`, `DocView.tsx` — the handle and the inline
  width go from the column path
- `apps/ui/src/reader/FocusMode.tsx`, `FocusMode.css` — unchanged in behaviour,
  reviewed for anything it borrowed from the column path
- `apps/ui/src/reader/Reader.css` — the column body's `max-width: var(--doc-measure, 62ch)`
  becomes the host's box; `66ch` stays as full screen's default
- `apps/ui/src/reader/docWidth.test.ts`, `docWidthControl.test.tsx` — rewritten
- `apps/ui/e2e/doc-width.spec.ts` — rewritten in two halves: the body follows the
  column, and full screen's width sticks and is independent

### Key Implementation Details

**Do not delete the module.** An earlier draft of this issue deleted `docWidth.ts`
outright. Full screen still stores a number, so `clampDocWidth`,
`readDocWidthState` and `writeDocWidthState` all survive. What goes is the
*column* half: `columnSurface(columnId)` keying, and with it the eviction that
existed only because columns come and go. One `FOCUS_SURFACE` key needs no cap.

**Keep the storage version.** `DOC_WIDTH_STATE_VERSION` is documented as "a change
re-asserts the default", so bumping it would throw away the full-screen width this
issue is keeping. Read only the focus key, and prune the rest on the next write.

**The two defaults are not the same kind of thing any more.** A column's default is
the column's width — a real number in a view document. Full screen's is `66ch`, a
font-dependent measure only the browser knows. So the "wider by default"
criterion cannot be checked by comparing two stylesheet declarations. Measure both
in a browser and assert the comparison.

**The margin is part of the room in a column.** `MARGIN_COLUMN_RESERVE` (330px) is
taken off the room a *drag* may claim, because the body's width was a number and
the drag had to avoid a dead zone. With a column's body filling, the grid
decides — `.reader-scroll.with-margin` already declares the two-track layout, and
the body's track is what the body fills. That is SHARED-061's shape. The reserve
keeps its present job in full screen, which still drags.

**Find every consumer before narrowing.** `docWidth.ts` documents that anchored
thread placement follows the body. Each consumer on the column path must measure
the body instead of reading a number.

**The e2e spec is rewritten, not dropped.** `doc-width.spec.ts` asserts a real
guarantee. That guarantee becomes two: a column's body is the column's width, and
full screen's is its own and independent.

### Edge Cases
- A column at its own minimum. The body fills it and the reader stays usable.
- Full screen with the margin up and then down: the drag's room changes, and the
  stored width is clamped to it rather than lost.
- A column open and full screen open over the **same document**: two different
  body widths at once, and neither writes to the other.
- An old `corpus.docWidth` blob holding column keys. Ignored, pruned, never an
  error, and the focus key inside it still honoured.
- A stored full-screen width larger than the viewport after a window resize:
  `clampDocWidth` already holds it to the room.

## Testing Strategy

Component tests: render a column reader at three host widths and assert the
body's measured width equals the column's content box each time. Render with the
margin up and assert the body fills the remaining track. Render full screen, drag,
reload, and assert the width returns. Drag full screen and assert no column
changes, then drag a column and assert full screen does not.

**Falsify, twice.** Reintroduce a `max-width` on the column body and watch the
column assertion part from the host's box. Then point full screen's width at a
column key and watch the independence assertion fail. A test that asserts only
"the body has some width" would pass with either bug in place.

E2E: drag a column's edge and assert the body's box moves with it in the same
gesture. Separately, assert full screen's default measure is wider than a default
column.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Open a document in a column
2. Drag the column's edge wider
3. Expected: the text widens with the column
4. Actual: the text stays at 62ch and needs its own handle dragged

### Verification Steps
1. `npm run build -w packages/kit`, then restart the app
2. Drag a column's edge through its whole range and watch the text follow
3. Confirm no width handle remains in the column reader
4. Open the same document in full screen, drag its width, reload, confirm it
   returns
5. Confirm the column's width did not move, and that full screen opens wider than
   a default column
6. Repeat step 4 with the thread margin up and down

## E2E Verification Log

### Reproduction (bugs only)
Reproduced 2026-08-23 in the shipped `doc-width.spec.ts` (pre-change, Chromium,
real Vite dev server): a 900px column drew its body at the `62ch` measure
(asserted band 450–650px, the spec's own "62ch of the shipped serif") with a
`Document width` handle beside it — the second gesture. Dragging the column's
edge moved the column and left the text at 62ch. That is the pre-change suite's
own testimony; it was green before this issue and its column half is rewritten
by it.

### Post-Implementation Verification

Model: **Fable 5** (`claude-fable-5`) — the issue recommended opus; this agent
session ran both UI-162 and UI-163 and was already on Fable.

Command (real browser, real Vite dev server, Chromium):

```
CORPUS_UI_PORT=5373 ./node_modules/.bin/playwright test \
  --config apps/ui/playwright.config.ts doc-width.spec.ts --workers=1
→ 13 passed (40.9s)
```

Concrete evidence, from the rewritten `apps/ui/e2e/doc-width.spec.ts`:

- **The body fills the column.** At a 900px column the body's measured box
  equals `.reader-scroll`'s content box within 1.5px, and so does
  `.title-grow`. No `[role=separator][aria-label="Document width"]` and no
  `.doc-width-rail` exists inside `.reader` (asserted `toHaveCount(0)`).
- **Same gesture, same frame.** With the pointer still down mid-drag on
  `.col-resizer`, the body's box already equals the moved content box (polled
  to <1.5px); after release the prose, the fence and the table all sit at or
  under the new box.
- **Column minimum.** At `width: 240` (the column's own minimum) the body
  equals the ~196px content box.
- **Margin room.** With `.reader-scroll.with-margin` up, the body equals the
  `minmax(0,1fr)` track — content box − 300 − 30 — measured atomically with
  the class. (The class is applied by hand in that test: margin mode in a
  column needs `.doc-main` ≥ 1100px (`MARGIN_MIN_WIDTH`) and
  `MAX_COLUMN_WIDTH` is 960, so no gesture reaches the state today; the grid
  seam is real (`useAnchorLayer` toggles this exact class) and the geometry is
  what is pinned. Reported to the orchestrator below.)
- **Full screen keeps its control and its width.** Drag → close → reopen →
  reload → reopen: the chosen width returns each time (`toBe(chosen)`).
- **Independence, both directions.** Arrow-keying focus +80px leaves the
  column body byte-identical (`toBe(columnBody)`) and the column at 900px;
  dragging the column −150px afterwards leaves focus at its chosen width.
- **Wider by default, measured.** Default column (336px): body ≈ its 292px
  content box. Full screen over the same document: `66ch` measured in-browser,
  asserted `> inColumn` and inside 450–780px. Both sides measured in one run,
  not read off stylesheets.
- **Storage migration.** A seeded v1 blob
  `{col:doc_view_inbox: 780, focus: 600, col:doc_view_threads: 520}`: the
  column renders at its room (not 780), focus opens at exactly 600, and one
  ArrowRight rewrites the blob to `{"version":1,"surfaces":{"focus":616}}` —
  columns pruned, focus kept, version unchanged.
- **No corpus writes** from the focus handle (`corpus.of("PUT")` empty), and
  the anchored margin card stays level with its highlight across a +240px
  body resize (card top == anchor top from one origin; margin still 300px and
  on-surface).

Unit/component: `docWidth.test.ts` (24) + `docWidthControl.test.tsx` (14) pass;
full reader+anchors+thread sweep 59 files / 1151 tests green.

**Falsified, twice, as the issue demands:**

1. Reintroduced the cap (`.reader-scroll { --doc-measure: 62ch }`): the three
   column e2e tests went red ("fills the content box…", "follows the column's
   edge…", "fills the track the margin leaves…" — each on the box-equality
   assertion).
   Reverted; 13/13 green again. One test **cannot** fail under this mutation:
   "fills the column at the column's own minimum" (240px), because a 62ch cap
   does not bind below ~500px — it pins the narrow edge case, not the cap.
2. Pointed full screen's read at the first stored surface instead of the focus
   key: 4 tests went red — both store tests ("honours the focus key…", "reads
   no width at all out of a blob holding only column keys") and both control
   tests ("reads its own width out of a mixed legacy blob", "writes without
   touching a column, and prunes"). Reverted; green.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier + tsc clean on every touched file;
      pre-existing tsc errors in `board/`, `explorer/`, `reflect/` belong to a
      parallel agent's in-flight work, none in files this issue touches)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
