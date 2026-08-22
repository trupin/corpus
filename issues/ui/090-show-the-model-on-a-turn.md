# [UI-090] Show which model wrote an agent turn

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-043, SERVER-074
- Blocks: —

## Spec References

- SPEC.md §10 Thread view — "An agent turn says which model wrote it" (rider signed 2026-08-07)

## Summary

The reading half of SHARED-027, and the thing the user actually asked for:
*"Anytime an agent takes note... I want to be able to quickly identify which
model worked on it."*

## Acceptance Criteria

- [x] An agent turn shows the model that wrote it, wherever the turn is read —
      a card in the margin, a chip at its anchor, a thread in a column, in full
      screen, and a child thread nested under a turn
- [x] **Quickly identifiable** is the requirement, not merely present: it reads
      at a glance beside the author and timestamp, without opening anything
- [x] A turn with **no recorded model shows nothing** — no "unknown", no dash
      that reads as a value. §10 is explicit that an unknown says so by absence
      rather than by a plausible attribution
- [x] A person's turn shows nothing
- [x] A **collapsed** conversation is unaffected: §10 fixes exactly what a
      collapsed line reports, and this is not in that list. Do not add it
- [x] It survives a revised turn (§10), which changes text without adding a turn

## Technical Design

### Files to Create/Modify

- `apps/ui/src/thread/Turn.tsx` and the turn header, plus `thread.css`.

### Notes

- The turn header is already dense (author, timestamp, revised marker). Adding a
  fourth element risks the header becoming the noisiest part of a conversation —
  weigh placement against how often it is the thing being looked for.
- Check `packages/kit` — if a plugin can render turns, the model belongs to the
  shared surface rather than to `apps/ui` alone.

### As built

**Placement — the header, decided rather than defaulted to.** The alternative
weighed was the turn's footer, beside the trace line. The header won on three
counts, recorded in `Turn.tsx`: §10's phrasing is "shown with the turn" and this
issue's own criterion is "beside the author and timestamp", which names this row
and no other; the motivating question is *which* turns a given model wrote, and a
footer makes that scan alternate between two y-offsets per turn while a long turn
pushes the answer off screen; and the footer is already the trace's, which
answers a different question ("what did it do") that deserves not to be crowded.

The density is paid for rather than ignored. At rest the header holds **two**
things — the two controls beside them ship at `opacity: 0` — so the model is the
third, and it is deliberately the quietest: a neutral pill on `--surface-2` with
a `--line` hairline, a step smaller than the author it qualifies. It borrows none
of the three colour axes `packages/kit/src/row/badges.tsx` keeps disjoint, which
also stops it reading as a variant of the accent unread pill it has nothing to do
with. Model names are an open display string (CONTRACT-043), so no colour can key
off the name and none tries to.

**`packages/kit`: nothing to move, and here is why.** The kit exports **no turn
renderer at all** — no `Turn`, no `ConversationThread`, no turn header. The whole
conversation surface (`Turn`, `ThreadCard`, `ThreadPanel`, `CollapsedThread`)
lives in `apps/ui/src/thread/`; what the kit shares is the *row* vocabulary for
lists (`Row`, `badges`, `reasons`), `MarkdownView`, the composer/autocomplete
contracts and the data hooks. A plugin can reach `useThread` and therefore the
turn data — `Turn.model` is on the wire type it already receives — but there is
no shared component for a model chip to belong to, and §10 makes `thread` one of
the two document types a plugin `View` may not replace. No plugin in `plugins/`
renders a turn (verified). So the display stays in `apps/ui`; if a turn renderer
is ever promoted to the kit, the model goes with it as part of that move.

**One component, five surfaces.** `ThreadCard` is deliberately one component in
four hosts, so the chip landing in `Turn.tsx` reaches every placement §10 names
without a second code path — which is what the browser suite then checks one
placement at a time rather than assuming.

### Files changed

- `apps/ui/src/thread/turnModel.ts` — **new.** `turnModelLabel(turn)`: the rule
  for when to show a name and the three ways to show nothing (person's turn,
  no record, blank record), with the trim.
- `apps/ui/src/thread/Turn.tsx` — the chip in `.turn-who`, after the timestamp
  and before the hover controls that own the right edge.
- `apps/ui/src/thread/thread.css` — `.turn-model`.
- `apps/ui/src/thread/turnModel.test.tsx` — **new.** 12 tests.
- `apps/ui/e2e/turn-model.spec.ts` — **new.** 8 browser tests.
- `apps/ui/e2e/stubCorpus.ts` — `StubRow.turnModels`, a frontmatter-shaped map
  keyed by turn timestamp, layered onto the body-parsed turns in `turnsOf`
  (which `GET /api/threads/{id}` now goes through). Faithful to where the server
  keeps the record; a timestamp with no entry still reports `null`.

## Testing Strategy

A thread mixing agent turns with a model, agent turns without, and person turns:
assert exactly which show it. Plus a collapsed conversation asserting it does not
appear there.

## E2E Verification Log

**Implemented on `opus` (Claude Opus 5, 1M context), 2026-08-08.** Not a bug, so
no pre-fix reproduction is owed.

**Apparatus.** Real Vite dev server on **port 5473** (`CORPUS_UI_PORT=5473` —
5173 holds an ssh tunnel and 8765 the user's live corpus server; neither was
bound by this work), real Chromium via Playwright, real React / TanStack cache /
clicks. The stub is the transport and nothing above it. Which model wrote which
turn is seeded where the server keeps it — the thread document's frontmatter,
keyed by turn timestamp (§6) — never in the turn's own text, so the read path
under test is the one the real server feeds.

**The fixture** is the conversation the rider has to be read against: a person's
turn; an agent turn naming `claude-opus-4-20250514`; an agent turn nobody
recorded a model for; an agent turn naming a **different** model,
`claude-haiku-4-20250514` (so a surface painting the thread's first model onto
every agent turn fails rather than passing); plus a child thread anchored into
the second turn's text, which is what makes the nested case a real nesting.

**`apps/ui/e2e/turn-model.spec.ts` — 8/8 passed (6.3 s).** Observed, per test:

1. _thread open in a column_ — turn `09:05` drew `claude-opus-4-20250514`, turn
   `09:09` drew `claude-haiku-4-20250514`, and the `.turn-model` element
   **count was 0** on both the unrecorded agent turn and the person's turn.
   Absence asserted as `toHaveCount(0)`, not as empty text.
2. _full screen_ — same four results after `[data-expand]`, inside `.focus.open`.
3. _chip at its anchor, narrow column_ — same four results, with
   `.reader .with-margin` count 0 confirming the narrow placement was the one
   actually entered. Also measured: the chip's right edge stays inside the
   conversation's box, so it gives before the row does.
4. _card in the margin_ — same four results, with `.focus-margin` count 1
   confirming the margin placement.
5. _child thread nested under a turn_ — `[data-thread-panel="th_child"]` resolved
   **inside** `.turn[data-turn-ts="…09:05:00Z"]` (count 1), and its own turn drew
   `claude-haiku-4-20250514`.
6. _on screen at rest_ — the assertion this suite exists for. `toBeVisible()`,
   computed `opacity` **"1"**, bounding box 130×15 px; and in the same row the
   `.turn-comment` control measured computed `opacity` **"0"**. So the model is
   drawn without opening or hovering anything, and is drawn *unlike* the two
   controls that share its row. Also `scrollWidth <= clientWidth`, pinning the
   name as whole rather than ellipsized.
7. _collapsed_ — with the conversation expanded the chip read `…opus…`; after
   clicking its own `.t-collapse`, `.turn-model` count went to **0**, the
   collapsed line contained neither model name, and the five things §10 fixes for
   that line were all still there (`4 turns`, `agent`, `lender spreads`).
8. _revised turn_ — the same thread with turn `09:05`'s body rewritten in place
   (same author, same timestamp, no new turn) still drew all four results
   unchanged; the model rides on the timestamp, which a revision keeps.

**Looked at, not only asserted.** Screenshots of the rendered turn stream in both
themes (throwaway spec, deleted after). Light and dark both read as intended: the
`AGENT` label stays the loud thing, the pill is legible and clearly the third
item, and the two turns that name nothing show a clean two-item row. One defect
found this way and fixed: `max-width: 24ch` clipped `claude-opus-4-20250514` to
`claude-opus-4-20250…` — the chip's own padding and border count against a
border-box width. Raised to `32ch` with `min-width: 0`, so a full model id shows
whole at ordinary width and a genuinely tight column ellipsizes rather than
overflowing. Test 6's `scrollWidth` check is the regression guard.

**Unit tests.** `apps/ui/src/thread/turnModel.test.tsx` — 12/12 passed. Covers
the rule function (recorded name; no record; person's turn; person's turn that
*does* carry a record, which the write path `400`s and the reader declines to
publish; blank record; trim; field missing outright) and the rendered
conversation through `ThreadPanel` (per-turn models `[null, opus, null, haiku]`;
the chip's position as child index 2 of `.turn-who`, after author and stamp;
no element at all for the unrecorded turn; the fold; the revision).

**Regression runs.**

- `vitest run apps/ui packages/kit` — **180 files, 3040 tests, all passed**
  (26.2 s).
- `playwright test e2e/collapse.spec.ts e2e/thread.spec.ts
  e2e/turn-comment.spec.ts e2e/turn-breaks.spec.ts` — **37/37 passed** (22.4 s).
  Run because the stub's thread read and the turn header's layout both changed.
- `tsc --noEmit` clean in `apps/ui` and `packages/kit`; eslint and prettier clean
  on every touched file.
- The 4 known failures in `apps/server/src/json-body.test.ts` are another agent's
  in-flight contract route and were not run or worked around here.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
