# [UI-198] The composer's "at" select does not hold a chosen level

## Domain

ui

## Status

done — 2026-09-09, fixed (WebKit blur order) and harvested, awaiting the gated commit

## Priority

P0

## Model

fable

## Dependencies

- Depends on: — (regression on UI-191/UI-192's shipped surface, v0.36.0)

## Spec References

- SPEC.md **§10** — every composer can choose how much thought the work gets

## Summary

**User report, 2026-09-09, with screenshot:** *"I can't pick what I want
here. It always defaults to 'agent will decide'."* The composer row's "at"
Select opens and lists the levels, but a chosen level does not persist — the
trigger reverts to "the launcher decides". §10's choice is unusable on the
primary surface, on a released build.

The v0.36.0 battery asserted a click **chooses** (aria state at click time).
It did not assert the choice **survives** — menu closed, trigger re-rendered,
value still the chosen one, and carried on the wire at send. That gap is the
suspected class: choose-then-reset (a re-render from stale state, a
focus-first/onChange-second ordering losing the update, or the designation
default overwriting the user's pick).

## What to build

1. **Reproduce first** against the real served UI (the SDLC's bug rule):
   open the composer, pick each level, log what the trigger shows after the
   menu closes and what the POST carries on send.
2. Fix wherever it lies (kit Select's value plumbing or the compose state).
3. Close the class: the battery/spec asserts the chosen value persists in
   the trigger after close AND rides the request — for the "at" select in
   both designating and no-owner states, and for the owner select.

## Acceptance Criteria

- [ ] Pre-fix reproduction logged with the exact observed reset
- [ ] Each level, picked with a mouse, persists and rides the wire — E2E on
      the real app
- [ ] The persistence probe joins the battery so choose-then-reset cannot
      pass again

## E2E Verification Log

_Model: Fable 5 (`claude-fable-5`)._

### Environment

Real app, per the SDLC's bug rule: `npm run build` in the worktree, `corpus
init` into a scratch workspace (template orchestrate skill declaring the three
default levels), `corpus server start` serving the built UI on
`http://127.0.0.1:8767` (v0.36.0 code at `e4748626`), driven by real browsers
(Playwright chromium / webkit / firefox, scripted gestures and wire capture).

### Pre-fix reproduction — the defect is WebKit's, and Chromium cannot show it

Chromium, every gesture tried, **held the pick** on the shipped build: plain
click, a 12-step human pointer path with press-dwell and a held micro-drift,
hover-across-rows-then-click, pick-then-type, a 500px viewport, keyboard,
a 12 s SSE settle, owner toggled away and back — trigger correct every time,
and the POST carried `"resident":{"weight":"standard"}`.

WebKit (Safari's engine — the reporter is on macOS), same build, same server,
verbatim:

```
webkit plain click: "the launcher decides"
webkit human path: "the launcher decides"
webkit wire: {"parent":null,"selector":null,"body":"UI-198 webkit probe",
              "requestsAgent":true}
```

Every pick reverted and **no designation rode the wire at all** — the user's
report exactly. Mechanism probe (instrumented listeners on the select root,
verbatim):

```
focused after open: select-option
menu count after mousedown, before mouseup: 0
activeElement now: BODY
value after: the launcher decides
```

WebKit does not focus a button on mousedown — it blurs the focused option to
`body` with `relatedTarget: null`. The root's blur-dismiss read that as focus
leaving and unmounted the menu **between the option's mousedown and its
mouseup**, so the `click` that chooses never fired. Chromium masks the defect
by focusing buttons on mousedown (`relatedTarget` = the option, contained, no
close). The same press order also broke toggle-closing the menu from its own
pill in WebKit (blur closes, then the click's toggle reopens). The owner
select shares the component and therefore shared the defect.

Why no shipped suite saw it: e2e runs Chromium only, and the jsdom suite's
`fireEvent.click` dispatches no mousedown/blur. The format toolbar never
showed it because its wrapper cancels every mousedown inside itself.

### Fix

`packages/kit/src/components/Controls/Select.tsx`, three coordinated changes:
option rows cancel their `mousedown` (no engine moves focus for a press —
the toolbar's own contract, now the primitive's); the blur-dismiss ignores a
blur to nowhere while `document.hasFocus()` (an outside press is the capture
listener's dismissal, cmd-tab drops `hasFocus()`); trigger toggle-close goes
through `close(true)` so focus lands on the trigger rather than an
unmounting option.

### Post-fix verification, same real server

- WebKit: every level picked with a mouse persists ("Small and mechanical",
  "Standard", "Heavy or judgment-laden" each shown on the trigger after
  close), owner pick persists ("no owner — the main agent", at pill leaves),
  trigger toggle-close closes once, and the wire carries
  `"resident":{"weight":"heavy"}`.
- Firefox: pick persists, wire carries `"resident":{"weight":"heavy"}`.
- Chromium: unchanged, all gestures hold, wire correct.

### Falsification

The three new jsdom probes (`Select.test.tsx`, replaying WebKit's exact event
order: mousedown → focusout to null) were run against the shipped v0.36.0
component: all three failed there (menu gone before the click, toggle
reopening) and pass with the fix. The fourth (a blur to a real outside target
still dismisses) passes on both, guarding the behavior the fix must keep.

### Tests

- `vitest run packages/kit/src/components/Controls apps/ui/src/compose` —
  109 pass (15 in `Select.test.tsx`, 4 new).
- e2e (`CORPUS_UI_PORT=5973`, chromium): `overlay-battery` +
  `ask-designation-weight` — 80 pass, including the battery's new fifth
  check ("a real pick survives the close and a reopen") on `lane-weight-menu`
  and both compose states, and the new per-level persist-and-ride-the-wire
  spec; `weight.spec` + `resident-weight*` + `compose-keyboard` +
  `composer-press` + `composer-sticky` + `composer-room` + `format-toolbar`
  — 87 pass.
- `npm run lint`, `npm run typecheck` — clean.
- `vitest run apps/ui packages/kit` — 257 files, 5223 tests, all pass.

### Class closure

The battery gains a `choice` declaration (`SelectChoiceDecl`) and a fifth
check: a real mouse pick must survive the close (trigger text), a reopen
(`aria-checked`), and an Escape — declared on every registered `Select`
menu. The wire half is pinned in `ask-designation-weight.spec.ts`: each
level, picked with a mouse under the default owner, persists on the trigger
and rides `resident.weight`; the named-profile state now asserts both
triggers after close before reading the wire. The WebKit event order itself
is held by the jsdom probes, since e2e runs Chromium — stated in the specs
rather than claimed as covered.
