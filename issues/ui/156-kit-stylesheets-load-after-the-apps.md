# [UI-156] The kit's stylesheets load after the app's, so a turn changes typeface in full screen

## Domain
ui

## Priority
P1

## Status
done

## Model
opus

## Dependencies
- Depends on: UI-145 (which found it)
- Related: SHARED-061 (the size rule UI-145 was fixing when this surfaced)

## Spec References
- SPEC.md §10 — "UI — the board" (the reader and the thread view)
- `design/index.html:329` — turn bodies are sans

## Summary

Found by UI-145's implementer while sweeping for other cascade ties, and
**measured in a browser rather than read off a stylesheet**. Not folded into
UI-145: that issue is a menu height, and this one changes typography on the
reading path.

`apps/ui/src/main.tsx` imports `./app/App` **above** its kit stylesheets, so
every rule in `packages/kit` is injected after every rule in `apps/ui`. Any
one-class app selector that ties a one-class kit selector therefore loses.

UI-145's own tie (`.ctx-menu` losing to `.ac-menu`) is fixed. Two more are live:

- `.turn-markdown` loses to `.doc-body` on `font-family`, `font-size`,
  `line-height` and `max-width`.
- `.thread-conversation` loses to `.doc-body` on `font-family` and `font-size`.

A real turn in a column reader measures
`{"fontFamily": "Iowan Old Style", "fontSize": "15px", "maxWidth": "517px"}`
where `Reader.css` asks for `var(--sans)`, `12.5px` and `max-width: none`.

**The visible symptom**: `FocusMode.css`'s `.focus .turn-markdown` carries two
classes and wins, so **the same turn changes typeface when it enters full
screen**. A reader who opens a conversation full screen sees the type change
under them.

## Why it is filed rather than fixed

The root cause is one line, and flipping it repaints the reading path — every
turn, in both the column reader and full screen. That is a look-and-feel change
that wants a before/after review against `design/index.html`, not a side effect
of a menu-height fix landing in a release named for navigation.

Three other candidate pairs were checked at the call site and are false
positives: `.cp-item`/`.ac-item` (a ternary, never both) and `.chip`/`.r-chip`
(`chipClass` is only ever `r-reply`, `r-form`, `r-stale` or empty).

## Acceptance Criteria
- [x] `main.tsx` imports the kit stylesheets before `./app/App`, or the app's
      rules are made to win by a mechanism that does not depend on import order
- [~] A turn's typeface, size, line height and measure are identical in a column
      reader and in full screen, measured in a browser — **the typeface is, and
      that is the defect this issue names. The size is not, and cannot be
      without a separate look-and-feel decision**: `FocusMode.css` declares
      `.focus .turn-markdown { font-size: 13.5px }` at two classes, so it wins
      on specificity in either import order. See "What is still not identical"
      in the log below, which is filed for a decision rather than changed here.
- [x] The measured values match what `Reader.css` declares and what
      `design/index.html` draws
- [x] A test fails if the import order is flipped back — a cascade tie is
      invisible to any test that does not measure a computed style
- [x] The reading path is reviewed against `design/index.html` before and after,
      and the review is recorded here

## Testing Strategy
Vitest cannot see this: it is a cascade outcome in a real browser. Playwright,
reading `getComputedStyle` on a painted turn in both surfaces.

## E2E Verification Plan
### Verification Steps
1. Open a thread in a column reader, measure the turn body.
2. Open the same thread in full screen, measure the same turn body.
3. Both must agree, and both must match `Reader.css`.

## E2E Verification Log

**Model: opus.** Chromium via Playwright against the real Vite dev server on
`CORPUS_UI_PORT=5399`, viewport 1280×800 for the screenshots and Playwright's
1280×720 default for the sweep. `npm run build` first, kit included — kit's
stylesheets ship from `src/` through its `exports` map (`"./markdown.css":
"./src/markdown/markdown.css"`), so no `dist/` copy stands between an edit and
the browser for CSS, but the build was run anyway before every measurement.

### The blast radius, measured before touching anything

The instruction was to find the **full** set of ties before reversing the order,
not only the two the issue names. Two independent sweeps agree on the same
answer, and both are stronger than reading stylesheets.

**1. A browser sweep of what actually moves.** A scratch spec walked every
element on a surface, snapshotted every computed property, moved every kit
`<style>` ahead of every app `<style>` in `<head>`, snapshotted again, and
diffed. That is the import-order change itself, applied to a live page, so it
answers the question directly rather than by inference. Thirteen surfaces:

    board · reader(document) · reader(thread) · full screen · search overlay
    compose panel · compose + address card · compose + `[[` autocomplete
    row context menu · editor context menu · reply composer + address card
    explorer · console

**Seven of the thirteen reported zero flips**: the board, the compose panel with
and without its address card, the `[[` autocomplete, the row context menu, the
explorer and the console. The six that moved are the six that had a turn painted
somewhere on them — both readers, full screen, the search overlay and the editor
context menu (each with a reader behind), and the reply composer's address card,
which opens inside a conversation. All six moved on exactly the same two
selectors, and on nothing else:

    .turn-markdown        font-family  serif → var(--sans)
                          font-size    15px  → 12.5px
                          line-height  1.62  → 1.5   (24.3px → 18.75px)
                          max-width    var(--doc-measure) → none
    .thread-conversation  font-family  serif → var(--sans)
                          font-size    15px  → 12.5px

Every other reported difference is a **consequence** of those two, and each was
checked: `block-size`/`height` on the turns and the cards that hold them (sans
at 12.5px is shorter than serif at 15px), `transform-origin` and
`perspective-origin`, which are derived from the box, and two `ch` measures that
re-resolve against a different typeface — `.focus .doc-body` 605.65px → 685.94px
and the turn's own inherited cap 495.53px → 561.23px. No colour, no spacing, no
border, no layout property moved anywhere.

**2. A static co-occurrence pass, as a backstop for surfaces the sweep did not
paint.** Every rule in `apps/ui` whose selector is exactly one class was paired
against every such rule in `packages/kit` that declares a property in common,
and the pairs were filtered to class sets that really appear together on one
element. It returned five candidates. Three are false positives from prose in
doc comments and were read at the source:

- `.chip` (`Column.css:250`) vs `.age` (`row.css:255`) — the match came from
  the words "age" and "chip" in `staleness.ts`'s docblock, not a `className`.
- `.lane` (`console.css:650`) vs `.row` (`row.css:20`) — prose in
  `laneRows.ts`.
- `.path` (`Path.css:10`) vs `.row` (`row.css:20`) — prose in `strip.ts`.

The two that survive are `.turn-markdown` and `.thread-conversation`, both
against `markdown.css`'s `.doc-body`. **The two sweeps agree on which rules
changed hands.**

After the change, re-running the same browser sweep reports **zero flips on all
thirteen surfaces** — moving the kit sheets to the front is now a no-op, which is
what a cascade at its fixed point looks like.

### One thing the sweep could not see, and the full suite did

Both sweeps answer *which declaration wins*. Neither answers *what reads the
answer afterwards* — and one thing does.

`doc-width.spec.ts`'s "resizes a thread opened as a document too" went red on the
full Playwright run, deterministically, and it was mine. Full screen's width
control places its handle with `.doc-width-rail`, an empty box that carries the
same `max-width` and the same type the body carries, so that "its right edge
**is** the body's right edge, by construction". The type is written out in
`FocusMode.css`, and it was written as `var(--serif)`, because until this issue
**every** body in full screen was serif — a conversation's included, since
`.thread-conversation` was losing.

With the tie repaired, a conversation's body is sans, a `ch` is wider in it, and
`66ch` is 685.94px where a note's is 605.65px. The rail stayed at 605.65:

    a note           body ends at 963.1   handle at 963.1    (unchanged)
    a conversation   body ends at 963.1   handle at 922.5    40.6px inside

That is the one thing the rail's own note says must never happen — the handle
over the last characters of a line — and the drag starts from the rail, so a
first press of the control pulled the body 40px narrower (734px where 774px was
expected).

Fixed by deriving the rail's family from the body rather than assuming it:
`DocView` passes `reader.isThread` — the same branch that chooses which body to
render — and `FocusMode.css` gains `.doc-width-rail.rail-conversation {
font-family: var(--sans) }`. That is still a restatement, which the rail's note
already accepts and asks to be kept in step. What was missing was the thing that
makes the request enforceable, so **`doc-width.spec.ts` now asserts the handle's
left edge is the body's right edge, for a document and for a conversation**. It
is falsified by removing the new rule: the conversation case reports the 40.6px
and the resize case reports 734 against 774, while the document case stays green.
`docWidthControl.test.tsx` asserts the wiring in jsdom, which cannot resolve a
`ch` and so deliberately claims nothing about the geometry.

**So the honest answer to "what else moved" is: two rules changed hands, and one
downstream constant that had been reading their old answer.**

### Before, measured

`getComputedStyle` on `.turn-markdown` and `.thread-conversation`, thread
`th_1` open, at 1280×800:

    column reader   turn         Iowan Old Style · 15px   · 24.3px · max-width 100%
                    conversation Iowan Old Style · 15px   · 24.3px · max-width 100%
    full screen     turn         Iowan Old Style · 13.5px · 22.95px · max-width 495.53px
                    conversation Iowan Old Style · 16.5px · 28.05px · max-width 605.65px

`Reader.css` asks for `var(--sans)`, `12.5px`, `1.5` and `max-width: none`, and
got none of the four. (`max-width: 100%` rather than the `517px` the filing
reports: a column sets `--doc-measure: 100%` since UI-066 moved the width
control into full screen, so `.doc-body`'s `var(--doc-measure, 62ch)` computes
to `100%` there. Same defect, one surface later.)

### After, measured

    column reader   turn         var(--sans) · 12.5px · 18.75px · max-width none
                    conversation var(--sans) · 12.5px · 20.25px
    full screen     turn         var(--sans) · 13.5px · 22.95px
                    conversation var(--sans) · 16.5px · 28.05px

The typeface is the same in both surfaces, and it is the one `Reader.css` asks
for. The sizes are `Reader.css`'s 12.5px in a column and `FocusMode.css`'s
declared 13.5px in full screen.

### Reviewed against `design/index.html`

Screenshots taken of the column reader and of full screen, before and after,
same fixture, 1280×800.

The mockup draws a conversation card at `design/index.html:290` —
`.thread-card { font-family: var(--sans); font-size: 12.5px; }` — and a turn body
at line 329, `.turn-body { color: var(--ink); font-family: var(--sans); }`. **In
the mockup a turn is sans and carries no `.doc-body` at all**, so no reading
measure and no serif ever reaches it. The app reuses the `doc-body` class on a
turn (`Turn.tsx:252`) to get markdown rendering, which is what put a turn in
range of `.doc-body` in the first place.

*Before*: the card's own furniture — `whole-document thread`, `on Rates memo`,
`USER Jul 1, 02:00 AM` — was small sans and mono, and the turn text beside it was
Iowan Old Style at 15px, larger than the document title's own body type would be
in that card. The screenshot shows a serif paragraph sitting in a sans card. That
is not a surface the mockup draws anywhere.

*After*: sans at 12.5px, the same family as the card's furniture, the mockup's
composition. Full screen reads the same conversation one step larger and in the
same face.

### What is still not identical, and why it was left

Three differences survive between a column and full screen, and **none of them
is an import-order tie** — each is a two-class selector in `FocusMode.css`
winning on specificity, which reads the same whichever stylesheet loads first:

| | column | full screen | declared by |
|---|---|---|---|
| font-size | 12.5px | 13.5px | `.focus .turn-markdown` |
| line-height | 1.5 | 1.7 | `.focus .doc-body` |
| max-width | none | 66ch | `.focus .doc-body` |

The first is deliberate and predates this issue: `.focus .turn-markdown` was
written in PHASE-3 to stop `.focus .doc-body`'s 16.5px reaching a turn, and it
chose 13.5px rather than 12.5px. Changing it is a look-and-feel decision, not a
cascade repair.

The other two reach a turn only because `Turn.tsx` puts `doc-body` beside
`turn-markdown`, so `.focus .doc-body`'s statements about *document prose* land
on a *turn*. Completing `.focus .turn-markdown` with `line-height: 1.5;
max-width: none;` would make full screen agree with the column. It was measured
and deliberately not done here:

- `max-width` **does not bind today**. The turn is 488px inside a card capped at
  ~520px by `.focus .thread-card`, well under the turn's own 561px cap, so the
  declaration changes nothing until somebody drags the width control wider.
- `line-height` does bind, 22.95px against 20.25px. Tightening it is a visible
  change to full screen's reading path, and this issue's whole warning is that
  a cascade repair must not re-theme a surface as a side effect. The mockup does
  not settle it either: there, a turn inherits the body's leading, which is the
  opposite of what `Reader.css` decided for a column.

Recommend a follow-up issue: *what does full screen do to a turn's leading and
measure* — a typography question, one file, no cascade in it.

### Falsification

`apps/ui/e2e/cascade-order.spec.ts` was run against the reverted `main.tsx` — the
two import blocks put back in their old order and nothing else changed. All
three tests fail, each on the assertion that names the typeface:

    Expected: "-apple-system, "system-ui", "Segoe UI", system-ui, sans-serif"
    Received: ""Iowan Old Style", "Palatino Linotype", Palatino, Charter, Georgia, serif"

Restored, all three pass. The spec therefore fails for the reason it is about,
and not incidentally.

### The shipped bundle, not only the dev server

The dev server injects one `<style>` per module and the production build
concatenates one file, so the two could in principle disagree. They do not.
`npm run build -w apps/ui`, then byte offsets in `dist/assets/index-*.css`:

    before   .turn-markdown{ at 40706   .doc-body{ at 47403   ← kit wins
    after    .doc-body{ at 7261         .turn-markdown{ at 57204

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[UI-156]` prefix
