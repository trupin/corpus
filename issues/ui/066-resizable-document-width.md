# [UI-066] The document body's width should be resizable, not fixed at the reading measure

## Domain
ui

## Status
done — implemented 2026-08-21 (SPEC §11's rider was signed 2026-08-04; SHARED-010
Amendment 2 settled the uniform-stretch question)

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-010 (the rider for this surface)
- Blocks: —

## Spec References
- SPEC.md §11 Document view
- `design/index.html` (authoritative for look and feel)

## Summary
Live report 2026-08-04: _"I want to be able to resize documents so they look
wider. I don't see a valid reason why the width of a document needs to be capped
to a such small width. It's fine to cap it, but I want to be able to resize to
the desired width, both in column and full screen mode."_

Today `.doc-body` is capped at **`62ch`** (`packages/kit/src/markdown/
markdown.css`). That number is a typographic reading measure — roughly 62
characters is where prose is comfortable to read — and it is a defensible default
for a *document*. It is a poor fit for the things people actually put in
documents: wide tables, fenced blocks of code or prompts, and pasted output. The
canvas work (UI-050) has just spent effort making long lines wrap *inside* that
measure; letting the measure grow is the other half of the same complaint.

The user is explicit that a cap is fine — the ask is that **they** choose it.

## Design questions to settle before coding
- **The control.** A draggable edge, a preset toggle (comfortable / wide / full),
  or both? A drag handle is the direct expression of "resize to the desired
  width"; presets are cheaper to make keyboard-accessible. Decide against
  `design/index.html` and the app's existing resize affordance — the console
  drawer is already resizable by dragging its top edge (§11), so there is a
  precedent to follow rather than a convention to invent.
- **Scope of the setting.** Per document, per column, or global? "Both in column
  and full screen" implies it should not be re-set every time the same document
  is opened in a different host.
- **Persistence.** §11 says navigation state is sticky. This should be too — say
  where it is stored and whether it is workspace state or per-browser.
- **Interaction with the column width itself.** A column has its own width; a
  document inside it cannot exceed it. Define what "wider" means when the column
  is the binding constraint — does resizing the body widen the column?
- **SETTLED (user, 2026-08-04): everything stretches uniformly.** Prose included.
  The user was offered the variant where prose keeps a reading measure while
  tables and fences break out to full width, and declined it — what you drag is
  what you get. Do not reintroduce a per-element measure as a "sensible default";
  the uniform behavior is the signed one (SHARED-010 Amendment 2).

## Clarified 2026-08-06 — threads are documents, and they resize too

The user, unprompted:

> "I want to be able to resize the width any document, including threads. I know
> we have an issue for that but just wanted to make that clear."

**Read the signed §11 text carefully before implementing, because it invites the
narrow reading.** It says "**the document body** has a comfortable default
width", and the only place it mentions threads is "anchored thread placement
follows the body when it moves" — which frames a thread as something attached to
a document rather than as a document in its own right. An implementer skimming it
would plausibly build this for notes and skip threads entirely.

§5 settles it: a thread **is** a document, whose body is its conversation. So the
signed text already covers it and no amendment is needed. What was missing is the
distinction between the two ways a thread appears, which this issue must build to:

- **A thread opened in a reader** — as its own document, in a column or in full
  screen — resizes exactly like any other document, with its own remembered
  width. This is the case the user is asking for.
- **A thread rendered as an anchored margin card or a chip** does **not** get its
  own width: it *follows the document it is anchored to*, which is precisely what
  the signed sentence already says. Two independently resizable widths on one
  screen, one nested in the other, is not what was asked for and would look
  broken.

So: the unit that carries a width is **a reader showing a document**, not a
thread card.

### Interaction with UI-077 (landed)

UI-077 routes every thread placement — margin card, chip, below-body list,
thread-as-document, nested child — through one component that decides its fold,
and holds sticky per-reader state browser-locally keyed by surface. Width is the
same shape of state on the same surfaces, so **reuse that keying rather than
inventing a second scheme**; two adjacent per-surface stores with different
conventions is how they drift. Read `apps/ui/src/thread/threadCollapse.ts` for
the precedent, including how it stamps state so a change re-asserts the default.

## Acceptance Criteria
- [x] The document body's width is adjustable by the user, in column view and in
      full screen
- [x] The chosen width persists across navigation and reload
- [x] A default is preserved for documents never adjusted — nobody is forced to
      set a width to read comfortably
- [x] Keyboard-accessible: the control is reachable and operable without a
      pointer (SPEC §11 requires no exclusive-pointer capability)
- [x] Wide content that motivated this — tables, fenced blocks — actually uses
      the new width
- [x] Anchored thread placement still lines up: margin cards and connectors are
      positioned against the body, and they must follow it when it moves
- [x] The editor and the rendered view agree at every width

- [x] A thread opened in a reader resizes like any other document, in both column
      view and full screen, and remembers its width
- [x] An anchored thread card or chip does **not** resize independently — it
      follows the document it is anchored to (the signed sentence's own rule)
- [x] Width state reuses UI-077's per-surface keying rather than a second scheme

## Technical Design
### Files to Create/Modify
- `packages/kit/src/markdown/markdown.css` (the `62ch` measure)
- `apps/ui/src/reader/` (the control, both hosts, persistence)
- watch `apps/ui/src/anchors/` — margin thread placement is measured off the body

### What was built

**One custom property, `--doc-measure`.** Every element in the reader that
carried a measure now reads `max-width: var(--doc-measure, <its own fallback>)`
— `62ch` in a column, `66ch` in focus mode, `76ch` on `.focus-inner`. A surface
nobody has dragged sets no property at all, so the shipped default is unchanged
character for character; a surface somebody has dragged sets one pixel value,
which every measured element then shares. Nothing else in the CSS moved.

**The control is a drag handle at the body's right edge**, not a preset and not
anything in the reader's head. The head is at its limit (UI-135's rules,
UI-063's 13px of slack), and the body's own edge is the thing being moved. It
copies `.col-resizer` exactly: `role="separator"`, invisible at rest,
`cursor: col-resize`, tinted on hover / focus / drag, `tabIndex={0}` with
`ArrowLeft` / `ArrowRight` at the console's own 16px step.

**A rail, so the handle knows where the edge is.** `ch` is font-dependent, so
only the browser knows the measure in pixels. `.doc-width-rail` is an empty box
carrying the *same* `max-width` and the *same* type as `.doc-body`, and the
handle hangs off it at `right: -12px` — entirely outside the measure, so it can
never swallow a click meant for the last character of a line.

**The width belongs to the surface**, keyed with UI-077's own
`columnSurface(columnId)` and `FOCUS_SURFACE`, in `localStorage` under
`corpus.docWidth` with a version stamp. §11 asks for a width that persists
*across navigation*, and navigation is what changes the document — so a
per-document width would be re-set on every ref followed, which is the opposite
of the sentence. What a person expresses by dragging is "documents in this
reader read too narrow".

### Decided, and rejected

- **Dragging the body does not widen the column.** A column's width is corpus
  state in its view document (`board/columnWidth.ts`), and coupling a
  browser-local reading posture to a `PUT` and a git commit would mean the app
  editing a document because somebody dragged. The column's own edge already
  exists for that, and the body then has more room to be dragged into. A 900px
  column drew 517px of prose and ~380px of gutter — closing that gutter is the
  whole of the report.
- **No reset gesture.** A double-click-to-restore with no keyboard equivalent
  would be an exclusive-pointer capability, which §11 forbids, and a second key
  was not worth claiming. The default survives for any surface never dragged.
- **No per-element measure.** SHARED-010 Amendment 2 — offered and declined.
  The table and the fence take the dragged width like the prose does.
- **`anchors/` was not touched.** `useMarginLayout`'s `ResizeObserver` on
  `.doc-main` already relaid the cascade on exactly this reflow.

### Three defects found only in a browser

1. **The handle did not drag, while the keyboard worked.** `.doc-editor` is
   `position: relative` and spans the whole of `.doc-main` — only the
   `.doc-body` inside it carries the measure — so as a positioned sibling later
   in document order it painted over the gutter and took every pointer event.
   `focus()` still reached the handle, so only the pointer was dead.
   `z-index: 3` on the rail fixes it, and the reason is recorded there.
2. **The handle lagged the cursor in focus mode.** `.focus-inner` is
   `margin: 0 auto`, so a body made 100px wider grows 50px each way and its
   right edge moves 50. Measured: a 260px drag widened the body by 189 and left
   the handle 130px behind the cursor. `pointerGain()` is the fix — 1 in a
   column, 2 under `.focus-inner` — and the servo alternative was rejected in
   the comment because it converges only while `pointermove` keeps arriving.
3. **The control stopped the reader scrolling — and this one nearly shipped.**
   See the section below. It is the only defect here that was not visible in the
   width at all.

## The scroll regression, and how it was found

**Reported by the orchestrator on 2026-08-21**, from A/B evidence the UI-140
agent produced: on a todos-column item click the reader opened and **never
scrolled** — `scrollTop` stuck at 0, the reveal flash left 584px from the line
it had found — reproduced 20/20. That agent reverted both of its own files
(`reveal.ts`, `useReaderSurface.ts`) and the failure survived, so it was not
theirs.

**It was mine, and the bisect is exact.**

| Build | `reveal.spec.ts` scroll tests |
| --- | --- |
| `DocWidthHandle` not rendered at all | pass, `scrollTop` 1239 |
| rendered, `.doc-width-rail { display: none }` | **fail**, `scrollTop` 0 |
| rendered, the `ResizeObserver` layout effect removed | pass, `scrollTop` 1239 |

The middle row is what named the cause. With the rail out of layout entirely the
defect persisted, so it was never the geometry — it was **a `setState` inside a
`useLayoutEffect`**, which makes React re-render synchronously within the mount
commit, the same commit the reveal arms in. The `ResizeObserver` then repeated
that update every frame while the column's 250ms width transition ran. The
effect existed to keep one attribute honest: `aria-valuenow`.

**The fix is that the control watches nothing.** It reads the body's width at
the three moments the number is used — once after mount (a passive effect, not a
layout one), on focus, and as a gesture begins — and never between them. The
cost is stated in the code: `aria-valuenow` can be stale after a window resize
nobody has touched the control through. That is a worse answer than a live one
and a far better one than a reader that will not scroll.

**Pinned in two places, because one of them cannot see it.**

- `docWidthControl.test.tsx` → *"observes nothing — the reader's scroll is not
  this control's to disturb"*. Asserts no `ResizeObserver` is constructed. That
  looks like a white-box test because the rule **is** the implementation choice.
  Falsified: restoring the observer turns it red.
- `doc-width.spec.ts` → *"does not stop the reader scrolling to a revealed
  line"*. Honest about its reach, and its comment says so: it reveals through
  the comments list, which is the `jumpToThread` seam, and **restoring the
  observer leaves it green**. The seam that broke is the todo item's
  `revealItem`/`trackReveal` path, which `reveal.spec.ts` owns and which caught
  this 20/20. Copying the todos fixture here would give one seam two owners.

**What I should have done differently:** run `reveal.spec.ts` before reporting
anything, not after the full suite. The suite *was* watching for this; I was not.

## Testing Strategy
Component tests for the control and persistence; e2e asserting the body's
rendered width changes and that an anchored thread card stays aligned to its
highlight after a resize.

- `apps/ui/src/reader/docWidth.test.ts` — 19 tests over the clamp and the store.
- `apps/ui/src/reader/docWidthControl.test.tsx` — 12 tests over the control in
  both hosts: it exists on each, sets no property until somebody chooses, reads
  the surface's own entry, moves one step per arrow key, holds the floor, keeps
  the width across a navigation, draws nothing outside a reader, and **observes
  nothing** (the scroll regression's rule).
- `apps/ui/e2e/doc-width.spec.ts` — 9 specs in a real browser, which is the only
  place `ch`, a pointer drag and the margin cascade mean anything.

## E2E Verification Log

**Model: Opus 5 (1M context).** Real Chromium via Playwright against the real
Vite dev server on `CORPUS_UI_PORT=5873`, transport stubbed in the browser
(`stubCorpus`) per INFRA-028. `packages/kit` rebuilt before every browser check;
note for the record that `markdown.css` is exported straight from `src/` in
`packages/kit/package.json`, so the dist trap does not reach this particular
file — the rebuild was run anyway and is not what made the change visible.

### Measured, in the browser

- **Default is unchanged.** `.doc-body` at `62ch` measured **517.20px** in a
  900px column, and the column stayed 900px. The handle's left edge sat within
  **2px** of the body's right edge, and it is 12px wide, entirely in the gutter.
- **Pointer drag.** Handle grabbed at the body's edge, dragged +220px:
  `.doc-body` 517 → **737px**. The paragraph and the fence both grew by the same
  amount, and `.title-grow` landed within 2px of the body's edge — the uniform
  stretch SHARED-010 Amendment 2 signed. The table stayed at or under the
  measure, which is right: a table is sized by its cells and was only ever
  wrongly *capped*.
- **Keyboard.** `focus()` on the separator, then six `ArrowRight` → exactly
  `517 + 96 = 613px`; three `ArrowLeft` → exactly `565px`. No pointer involved.
- **Persistence.** Dragged, went back to the list, reopened the document: same
  width. Reloaded the page: same width. Following a `[[ref]]` to another
  document in the same column also kept it (jsdom test, since the e2e note has
  no second document).
- **Nothing reaches the corpus.** Four `ArrowRight` presses, then
  `corpus.of("PUT")` — **0 requests**. The column's own width stayed `900px`.
- **A thread as a document.** `th_1` opened from a Conversations column, eight
  `ArrowRight` → its `.doc-body` moved by exactly 128px. (While probing this,
  the same conversation opened in a *default-width* column clamped at **530px**
  — the column's content box — which is the "the host binds it" behaviour, and
  is why the fixture's column is wide.)
- **Focus mode has its own width.** Column set to 581px, then ⤢: focus opened at
  its own default rather than at the column's, took ten `ArrowRight` of its own,
  and on `esc` the column behind it was still at 581px.
- **The anchor followed the body.** Focus mode with `.with-margin` up: the
  margin card's top and its highlight's top both measured **81px** from
  `.doc-main`'s origin. Body dragged from 606px to **795px**; both measured
  **81px** again afterwards. `.focus-margin` was **300px** before and after — an
  anchored card takes no width of its own — and its right edge stayed inside
  `.focus-scroll`'s content box, because the drag reserves the 330px the grid
  spends on it.

### Broken on purpose, and watched to fail

1. `packages/kit/src/markdown/markdown.css` → `max-width: 62ch` (the variable
   removed). **4 of 8** `doc-width.spec.ts` specs went red, including the drag
   and the keyboard. Restored. *(This also exposed a weak spec: "survives
   navigation" compared the width only against itself, so it passed with the
   feature broken. It now asserts the drag moved the body by more than 150px
   first.)*
2. `FocusMode.tsx` → focus mode keyed on `col:doc_col` instead of
   `FOCUS_SURFACE`. "reads focus mode's own width, not the column's" went red.
   Restored.
3. `FocusMode.css` → `.focus-margin > [data-thread-panel] { top: 0 !important }`.
   The alignment spec went red with **expected 81, received 0**, which is what
   proves that assertion is live and not two zeroes agreeing. Restored.
4. `DocWidthContext.tsx` → the `ResizeObserver` layout effect restored. The
   jsdom pin went red: *"expected spy to not be called at all, but actually been
   called 1 times"*. Restored. The same probe left the e2e scroll test green,
   which is why that test's comment says what it does not cover.
5. The `z-index: 3` defect was found *by* the suite rather than injected into
   it: before that line, the drag spec failed with the body at 517px unchanged
   while the keyboard spec passed.

### Suites

- `npx vitest run apps/ui/src/reader apps/ui/src/anchors apps/ui/src/editor
  apps/ui/src/shell apps/ui/src/board` — **75 files, 1978 tests, all passing.**
- `npx playwright test doc-width.spec.ts --workers=1` — **9 passed.**
- `npx playwright test reveal.spec.ts --workers=1` — **18 passed**, and the two
  scroll tests **9/9** under `--repeat-each 3`.
- `npx eslint`, `npx tsc --noEmit -p apps/ui/tsconfig.json`,
  `npx prettier --check` over every touched file — clean.
- **Full Playwright suite, `--workers=1`: 516 passed, 3 failed** (623s). All
  three A/B'd with `DocWidthHandle` unmounted and **all three fail identically
  without it**, so none is this change's:
  - `digit-geometry.spec.ts:246` *"does not re-cut the document id when it
    crosses into two digits"* — **deterministic, 2/2 with and 2/2 without**.
    `the document id was re-cut (86.984375 vs 83.078125)`, a 3.9px move against
    a 0.5px tolerance. A reader-head geometry defect, and somebody's to own.
  - `reveal.spec.ts:508` — fails 1/2 with and 1/2 without, under the load of two
    other spec files. In isolation it is 18/18 and 9/9 under `--repeat-each 3`
    against this change. Load-sensitive, in UI-140's own path.
  - `changelog.spec.ts:145` *"expands in place — the same body, the same
    scroll"* — failed in the full run and in the **without** arm, passed in the
    **with** arm. A cold-open geometry race of the same family UI-105 fixed in
    `soft-wrap.spec.ts`: the heading was measured at y=237 and again at y=77
    across a column still animating its width.

### Not done

- **Nothing in `apps/ui/src/anchors/` was changed**, as instructed, and none was
  needed: `useMarginLayout` already observes `.doc-main`. The one piece of
  knowledge this feature holds about that directory is the **330px** the margin
  grid costs (`MARGIN_COLUMN_RESERVE`), which is reserved out of the room a drag
  may claim so the pointer and the edge stay together.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
