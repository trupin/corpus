# [UI-166] What full screen does to a turn's leading and measure

## Domain
ui

## Status
done

## Priority
P2 (nice-to-have)

## Model
opus

## Dependencies
- Depends on: UI-156
- Blocks: —

## Spec References
- SPEC.md Section 10 — "UI — the board", Thread view and Document view

## Summary

**UI-156's own recommendation, filed because that issue's warning was exactly
against doing this inside it.**

UI-156 put the kit's stylesheets ahead of the app's, and a turn's **typeface**
became `var(--sans)` on every surface. Its second acceptance criterion asked for
typeface, size, leading and measure to be identical in a column and in full
screen. Typeface is met. Three differences survive, all measured:

| property | column | full screen |
| --- | --- | --- |
| font-size | 12.5px | 13.5px |
| line-height | 1.5 | 1.7 |
| max-width | `none` | `66ch` |

The size difference is `FocusMode.css`'s `.focus .turn-markdown`, at two classes,
which wins in **either** import order — the cascade change cannot reach it.

The leading and measure reach a turn for a different reason worth knowing:
`Turn.tsx` puts `doc-body` beside `turn-markdown`, so `.focus .doc-body`'s
statements about **document prose** land on a **conversation**.

## Why UI-156 did not do it

Two reasons, both recorded there and both good.

1. `max-width` **does not bind today** — a turn measures 488px inside a ~520px
   card, so `66ch` never applies. Changing it would be a change with no effect,
   which is worse than none: it looks fixed.
2. Tightening a turn's leading is a **visible re-theme of the reading path**,
   inside a P1 whose stated risk was silently re-theming a surface nobody looked
   at.

## The question this issue exists to answer

**Should a turn in full screen read as document prose, or as a conversation that
happens to be full screen?** Both are defensible and the product currently does
neither deliberately — it does whatever `.focus .doc-body` says, because a class
is shared.

- If **a conversation**, the fix is to stop `.focus .doc-body` reaching a turn,
  and the three differences resolve on purpose rather than by cascade accident.
- If **document prose**, then the column should match full screen rather than the
  other way round, and the 12.5px/1.5 column turn is the thing that is wrong.

Either answer is a re-theme of a surface people read. It wants a look before a
change.

## Decided by the user, 2026-08-23 — a turn is a conversation, on every surface

**Chosen: stop the document-prose rules reaching a turn.** A conversation reads
the same in a column and in full screen, differing only in the room it has.

**Why it won.** `design/index.html` already has this opinion: its turn body is
sans and carries no document-prose class at all. So the product's current
behaviour is not a design decision — it is a shared class, and the focus-mode
rules written for **documents** landing on a **conversation**.

**Rejected: treat a turn as document prose and change the column to match.** It
would make full screen's larger, looser turn the intended reading, and the
column the surface that is wrong. That is the more visible change, to the
surface people use constantly, in service of a styling nobody chose.

**Rejected: leave it.** The difference would stay decided by a shared class
rather than by a rule, so the next stylesheet change could move it again with
nobody noticing — which is how it arrived.

**The fix is a rule that names turns.** Not a specificity war with
`.focus .doc-body`, and not removing `doc-body` from `Turn.tsx` without checking
what else it carries. UI-156's browser sweep is re-runnable — use it to see what
any change moves, rather than reasoning about the cascade.

**`max-width` may still not bind** — a turn measures 488px inside a ~520px card.
If it does not, say so and leave it alone. A value with no effect is worse than
none, because it looks fixed.

## Acceptance Criteria

- [x] The intent is decided and written down, with the rejected reading and why.
      — "Decided by the user, 2026-08-23" above.
- [x] Whichever is chosen, a turn's typography is decided by a rule that names
      turns, not inherited from a document-prose selector it shares a class with.
      — `.focus .turn-markdown` in `FocusMode.css` now sets `font-size` and
      `line-height`. `Turn.tsx` keeps `doc-body`, which is what gives a turn its
      markdown styling at all.
- [x] `design/index.html` is checked. UI-156 found its `.turn-body` is sans and
      carries no `.doc-body` at all, so the mockup already has an opinion here.
      — quoted in the log. Its `.thread-card` is 12.5px on every surface, and its
      only focus-mode rule for a conversation moves the card's `max-width`.
- [x] Before and after screenshots of both surfaces, at the default widths.
      — 1440×900, both surfaces, rule active and reverted. The column's two
      files are byte-identical.
- [x] If `max-width` still cannot bind, say so and leave it alone rather than
      setting a value with no effect. — **it still cannot**: 519.65px computed
      against a turn rendering at 487.6px or 268px. Not declared. The spec
      asserts the box rather than the declaration.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/reader/FocusMode.css`
- `apps/ui/src/thread/Turn.tsx` — if the class pairing is what changes
- `apps/ui/e2e/cascade-order.spec.ts` — UI-156's guard, extended

### Key Implementation Details

Read UI-156's E2E log first. It carries the measurements above and the two
sweeps that produced them, and its browser sweep is re-runnable — use it to check
what any change here moves, rather than reasoning about specificity.

### Edge Cases
- A turn in a column that is wide enough for `66ch` to bind, which UI-165 says is
  not reachable today.
- A thread opened as a document, whose body is a conversation — UI-156 found the
  width rail had assumed otherwise.

## Testing Strategy

Extend `cascade-order.spec.ts`. The claim is about computed style on a real
turn on both surfaces, so the test is a measurement, not a class assertion.

**Falsify**: revert the rule and watch the measurement part.

## E2E Verification Plan

### Verification Steps
1. Measure a turn in a column and in full screen, before and after
2. Compare both against `design/index.html`

## E2E Verification Log

Implemented by **ui-dev on opus** (`claude-opus-5[1m]`), 2026-08-23, branch
`phase-44-reach-and-size`. Every number is `getComputedStyle` or
`getBoundingClientRect` off a real Chromium page, Playwright against the Vite dev
server on `CORPUS_UI_PORT=5399`, viewport 1600×900. UI-156's sweep was re-run
rather than re-reasoned, on **four** surfaces rather than two.

### The change

One rule, in `FocusMode.css`, that names turns:

    .focus .turn-markdown {
      font-size: 12.5px;
      line-height: 1.5;
    }

It replaces `.focus .turn-markdown { font-size: 13.5px }`. `Turn.tsx` is not
touched: `doc-body` is what gives a turn all of `markdown.css`, and only these
two declarations were ever unwanted. No specificity war either — the rule already
weighed two classes and already came after `.focus .doc-body` in the file.

### Before and after, measured

`.turn-markdown`, the element the issue's table is about:

| surface | before | after |
| --- | --- | --- |
| thread-as-document, column | 12.5px / 18.75px (1.5) / `none` / 274px wide | unchanged |
| thread-as-document, **full screen** | **13.5px / 22.95px (1.7)** / 561.23px / 487.6px wide | **12.5px / 18.75px (1.5)** / 519.65px / 487.6px wide |
| anchored card, column | 12.5px / 18.75px / `none` / 268px wide | unchanged |
| anchored card, **full screen** | **13.5px / 22.95px** / 561.23px / 268px wide | **12.5px / 18.75px** / 519.65px / 268px wide |

The typeface was already `var(--sans)` on all four (UI-156). After this rule the
four rows agree on typeface, size and leading. A conversation now reads the same
on every surface, and differs only in the room it has: 274px in a default column
against 487.6px in full screen.

### `max-width` does not bind — said out loud, and left alone

It never bound, and it still does not:

| surface | `max-width` computed | the turn's rendered width |
| --- | --- | --- |
| thread-as-document, full screen | 519.65px (66ch of 12.5px sans) | **487.6px** |
| anchored card, full screen | 519.65px | **268px** |
| both, in a column | `none` | 274px / 268px |

`.focus .doc-body` still puts `var(--doc-measure, 66ch)` on a turn in full
screen, and the card the turn sits in is narrower than that on every surface
measured. **Declaring `max-width: none` in the new rule would change nothing on
screen while looking like a fix**, so it is not declared, exactly as the decision
asked. `cascade-order.spec.ts` pins the fact rather than the declaration: it
asserts the turn fills its parent's box and that the computed `max-width` is
*wider* than that box.

### The look, before and after

Both surfaces were screenshotted at 1440×900 with the rule active and with it
reverted, and looked at rather than only measured — the decision says this is a
re-theme of a surface people read.

- **The column is byte-identical.** `sha256(before-column.png) ==
  sha256(after-column.png)` = `bfdbdacc…52e8a665`. Nothing outside full screen
  moved, which is the strongest form the "unchanged" claim can take.
- **Full screen, before**: the turn body reads visibly larger and looser than
  everything around it — the `standalone thread · th_type` context line, the
  `USER` / `AGENT` labels, and the composer's own "Reply — @ route · / skill"
  line directly beneath it. The agent's reply wraps after "by 200,".
- **Full screen, after**: the turn sits at the same scale as the card furniture
  and the composer under it. The agent's reply now wraps after "which is",
  because the same room holds more of the smaller type.

The screenshots are in the session scratchpad rather than the repository; the
byte-identical column hash and the computed-style tables above are the durable
record.

### What else the cascade change moved — nothing

The sweep read the whole conversation tree on all four surfaces, not just the
turn. Everything else is byte-identical before and after: `.thread-conversation`,
`.thread-card`, `.turn`, `.turn-body`, `.turn-who`, and `.doc-width-rail`.

Two of those are worth stating, because they look like they should have moved:

- **`.thread-conversation` in full screen stays 16.5px / 685.94px**, and that is
  deliberate. That number is not typography — it is the *measure*: 685.94px is
  `66ch` of 16.5px sans, and `.doc-width-rail.rail-conversation` carries the same
  type so the drag handle sits exactly on the body's right edge
  (`doc-width.spec.ts` › "puts the handle at the right edge of a
  conversation"). Every child of that container sets its own size, so the 16.5px
  reaches no text. Pulling it to 12.5px would have moved `66ch` to ~519px, left
  the rail at 685.94px, and put the handle 166px off the edge it measures.
- **`.turn-body` was already 12.5px in full screen**, inherited from
  `.thread-card` / `.thread-conversation`'s own furniture, so the turn's markdown
  was the only thing reading larger than the card around it. That is the visual
  oddity this rule removes.

### Against `design/index.html`

The mockup already had this opinion, and it is now what ships:

    .thread-card { … font-family: var(--sans); font-size: 12.5px; … }
    .turn-body   { color: var(--ink); font-family: var(--sans); }
    .focus .thread-card, .focus .backlinks, .focus .skill-fm { max-width: 66ch; }

`.turn-body` carries **no** `doc-body`, no size, no leading and no measure; it
takes the card's 12.5px. The mockup's only focus-mode rule for a conversation
changes the card's `max-width` — the room — and nothing about the type. So the
13.5px/1.7 a turn used to take in full screen was never a design decision.

### Falsification

The rule was reverted in place to `font-size: 13.5px` and the spec re-run:

    ✘ cascade-order.spec.ts › a turn reads the same in full screen as in a column
      Error: full screen resized the conversation
      Expected: 12.5
      Received: 13.5

The other three tests in the file stayed green, including the `max-width` one —
correct, because the dead measure is dead in both states. Restored, all four
green.

### Suites run

- `playwright cascade-order.spec.ts doc-width.spec.ts --workers=1` — **19
  passed** (4.5m).
- `playwright turn-model.spec.ts collapse.spec.ts anchor-layer.spec.ts
  anchors.spec.ts --workers=1` — **50 passed** (6.7m). `turn-model.spec.ts` is
  the other spec that reads a turn on both surfaces and in the margin.
- `vitest run apps/ui packages/kit` — 4678 passed; the 2 failures are
  `apps/ui/src/main.test.tsx` timing out at its 5s budget, **pre-existing and
  load-sensitive** (it fails the same way on the committed tree, and passes on
  this tree with `--testTimeout=30000`). Not this change; belongs with INFRA-020.
- `eslint` clean, `prettier --check` clean, `tsc --noEmit` clean in both
  workspaces.

### Nothing needs a decision

The one judgment call inside the decision's boundaries was **which** number a
turn takes in full screen. The decision says a conversation reads the same on
every surface, and the mockup says 12.5px on both, so full screen came down to
the column rather than the column going up.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
