# [UI-071] A highlight briefly lands on the wrong words while a document re-anchors

## Domain
ui

## Status
done — verified 2026-08-13 (INFRA-027): no commit of its own — squash-merge folded it into its phase's; verified instead by its implementation and named tests in `apps/ui/e2e/plugin-late-arrival.spec.ts`, which cite it by id. The work landed; this file was
never ticked.

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-062
- Blocks: —

## Spec References
- SPEC.md §6 Anchoring, §10 adaptive thread placement

## Summary
Caught by the pre-push gate on 2026-08-05, on the v0.3.0 release commit —
`apps/ui/e2e/todos.spec.ts:607`, "keeps the highlight on the item after the
checkbox is toggled":

```
Locator:  locator('.reader .anchor-hl')
Expected: "Call the plumber"
Received: "ores that landed "
  14 × locator resolved to
       <span class="anchor-hl" data-thread="th_new1" data-anchor="anc_new1">ores that landed </span>
```

**The failure mode is the point.** A highlight that is *missing* while a document
re-renders is ordinary timing. A highlight drawn over **different words** is the
confidently-wrong class the anchor work exists to prevent — the user sees a
comment attached to text it is not about.

**Load-sensitive, not deterministic.** It failed once in a full push gate (with
the unit suite and 270 other specs competing) and then passed **4 out of 4** runs
in isolation. So the window is real but narrow, and the assertion caught an
intermediate state rather than a settled one.

## Hypothesis to test first
The spec toggles a checkbox, which rewrites the document body. Between the new
body arriving and the newly-resolved anchors arriving, the reader plausibly holds
**the old range against the new text** — the offsets still apply cleanly, they
just name different characters now. `"ores that landed "` reads like the interior
of a longer word ("chores that landed"), which is what an offset shifted by a few
characters would produce.

If that is it, the fix is to refuse to draw a placement whose provenance does not
match the body it is being drawn on — the same discipline UI-062 applied to
incomparable offsets, extended to the transient case. **Do not fix it by
debouncing or by hiding the highlight during a refetch**: that narrows the window
without closing it, and the standard here is that a wrong highlight is worse than
no highlight.

Check also whether this predates UI-062 or is newly reachable because of it.
UI-062 made placement *succeed* in cases where it previously gave up, so a
transient that was invisible before may now be drawable. Either answer is useful;
say which.

## Acceptance Criteria
- [x] A checkbox toggle (or any body edit) never draws a highlight over text the
      anchor does not cover — asserted at the intermediate state, not only after
      it settles _(pinned both directions in `useAnchorLayer.test.tsx`; the
      reported artefact was a wrong **anchor**, not a wrong placement)_
- [x] Reproduced under load before the fix: run the spec with the machine busy,
      or drive the intermediate state directly, and record the wrong text
      _(driven directly; `"ores that landed "` byte-for-byte)_
- [x] The settled behaviour is unchanged — the highlight returns to the right
      words after the edit
- [x] Whichever way it is fixed, no debounce or visibility trick that merely
      shortens the window
- [x] A test that would fail against today's code, not one that passes because
      the race rarely loses _(deterministic on an idle machine)_

## Technical Design
### Files to Create/Modify
- `apps/ui/src/anchors/useAnchorLayer.ts`, `anchorPlacement.ts`
- `apps/ui/e2e/todos.spec.ts` (or a new spec closer to the seam)

## Testing Strategy
Drive the intermediate state deterministically — stale anchors against a fresh
body — rather than relying on a race to lose.

## E2E Verification Log

**Model: Opus 5 (1M context).** Real Chromium via Playwright against the real
Vite dev server (`CORPUS_UI_PORT=6010`), `apps/ui/playwright.config.ts`.

### The hypothesis is wrong, and the arithmetic disproves it before any browser

The highlight the gate caught is **17 characters** (`ores that landed `, with the
trailing space). The anchor it was supposed to carry quotes `Call the plumber` —
**16**. No path in `anchorPlacement.ts` can change a range's length inside a
non-atomic run: `mdRangeToPm` maps `start`/`end` through the same run offset, and
`rebaseRange` can only widen a range to a whole run — here the paragraph, 32
characters. **A 16-character anchor cannot produce a 17-character highlight.** So
the drawn range was never a shifted version of the right one; the anchor's own
`selector.exact` was `ores that landed `.

Confirmed against the fixture's real offsets (`traceOfBody(TODO_BODY)`):
`Call the plumber` is md `[94,110)` → one segment `{from:88,to:104,block:3}`,
before **and** after the toggle — the toggle is length-preserving
(`- [ ]` → `- [x]`), so no offset moves at all. The e2e stub re-resolves every
anchor with `indexOf` on every read, so its body and its ranges are always the
same version. There was no stale-offset window to lose.

### What the intermediate state actually is

The **selection** was made over the wrong words, three lines up, because the
document moved between the moment the spec measured the item's position and the
moment it dragged over it.

Measured live, in the browser:

| | x | y | width |
|---|---|---|---|
| `Call the plumber`, plugin panel absent | 54 | 306.7 | 112.73 |
| `Call the plumber`, plugin panel present | 54 | 384.5 | 112.73 |
| `Chores that landed in the inbox.`, panel present | 33 | 315.95 | 216.30 |

Plugin discovery is a dynamic `import()` kicked off at bootstrap
(`apps/ui/src/plugins/registry.ts`), and the `DocPanel` it registers renders
**above** the body (`DocView.tsx`). When it settles after the editor has painted,
everything below it drops **77.9px**. `openTodo()` waits only for
`.reader .ProseMirror`, so the spec measured `y = 306.7` and released the mouse at
`y = 317.2` — which by then was the **first paragraph** (315.95–336.95). The drag
spans x 55 → 165.7; on the paragraph (x = 33, same font) that is characters 2–19:
`ores that landed `.

Driven directly rather than raced for — the plugin manifest module held at the
route level until the reader had painted:

```
plugin module requests delayed: [".../plugins/todos/manifest.ts", ".../plugins/_fixture/manifest.ts"]
panels present at measure time: 0
measured rect (panel absent)   {"x":54,"y":306.6875,"width":112.734375,"height":21}
same text now at (panel present) {"x":54,"y":384.546875,...}
paragraph now at                 {"x":33,"y":315.953125,...}
SELECTION: "ores that landed "
QUOTE:     “ores that landed”
```

Byte-for-byte the string in the gate's failure, trailing space included.

**The anchor layer is innocent.** It drew exactly the words its anchor covered.
The confidently-wrong artefact came from the *harness* commenting on words nobody
selected, and only surfaced four assertions later as a highlight over the wrong
sentence.

### Pre-fix red, deterministic

`selectItemText` measured once and trusted the result. With the shift driven from
a one-shot capturing `mousemove` listener (a spacer of the panel's own measured
height), the original helper fails on an idle machine, every run:

```
Error: expect(locator).toHaveText(expected) failed
  Locator:  locator('[data-comment-pop] .cm-quote')
  Expected: "“Call the plumber”"
  Received: "“ores that landed”"
  14 × locator resolved to <div class="cm-quote">“ores that landed”</div>
```

The same `14 ×` shape as the gate's failure. With the fixed helper the identical
scenario is green.

### Does it predate UI-062?

**Neither.** It is independent of UI-062 and was not made reachable by it: no
placement path is involved. The fixture's body is byte-identical to its canonical
serialization (`offsetsComparable` → `true`), so `readerFor` returns the identity
reader and `rebaseRange` — the whole of UI-062's contribution — never runs. The
race is in the spec's coordinate handling and has been latent since
`selectItemText` was written (PLUGINS-006).

### The transient the issue worried about is real machinery, and it is closed

`useAnchorLayer.applyAnchors` refuses to dispatch unless
`traceOfDoc(editor.state.doc).markdown === wanted.current`, i.e. the editor is
showing exactly the body the offsets index. One direction was pinned; the
direction an **edit** takes — the server's copy moves on first, the editor adopts
it a commit or more later — was not. It is now
(`useAnchorLayer.test.tsx` → "draws nothing from a body the editor has not
adopted yet"): eight characters inserted ahead of the quote, new body and new
anchors served together, editor left on the old body — the highlight stays on the
words on screen through `REAPPLY_DEBOUNCE_MS × 3`, then lands in the *right* new
place the moment the editor adopts. No debounce, no visibility trick: the layer
declines to draw and says so by drawing nothing.

### Checks

- `apps/ui` unit: **2073 passed / 127 files** (`vitest run apps/ui/src`,
  `VITEST_MAX_THREADS=4`); `src/anchors` alone 279 passed.
- e2e `todos.spec.ts`: **11 passed** (was 10; one added).
- `eslint --max-warnings 0`, `prettier --check`, `tsc --noEmit -p apps/ui`: clean.

### Escalation — the root cause is not in this issue's files

The 77.9px shift is a real product defect, not only a test hazard: a plugin
`DocPanel` appearing after first paint moves the document body under a user's
pointer mid-drag. Every reader on the board is exposed, and a plugin `View`
swapping in late is the same defect with a larger jump. Fixing it is a design
call (reserve the slot's space, or hold the reader's first paint until discovery
settles) that spans `apps/ui/src/plugins` and `plugins/` — recommended as its own
issue rather than taken unilaterally here.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
