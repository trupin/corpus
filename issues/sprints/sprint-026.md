# Sprint 026 — The product has one button

**Issues**: UI-191 · INFRA-040 · UI-193 · UI-192
**Domains**: ui · infra
**Release**: v0.36.0 — _"The product has one button"_ (Phase 60)
**Date**: 2026-09-07
**Test numbering**: continues the ladder from sprint-025's `TEST-1222`; this sprint runs
`TEST-1223`–`TEST-1276` — 54 tests across four lanes (A: 28 · B: 8 · C: 12 · D: 6).

**There is no SPEC rider here.** Phase 60 changes no behaviour the spec describes. Its authority is
SPEC.md **§10**'s standing sentence that `design/index.html` is authoritative for look and feel, plus
a user directive of 2026-09-06 given as three screenshots and two sentences:

> "I want you to come up with button / drop down component styles and apply them consistently across
> the whole product."

> "come up with some static check that ensures that those components are being used everywhere they
> should. Make that a pre-commit check + CI check so such inconsistencies stop happening."

The screenshots do not travel into the repo. UI-191's transcription of them is the record, and it is
binding on this sprint: flat fully-rounded pills, fill one step lighter than the surface, no
gradients and no native chrome, dashed border for empty, tinted fill for stateful, dropdown triggers
as the same pill with a chevron over a **custom** popover.

**The cut rule, from the release scope and binding here.** UI-191 is the largest diff and the most
e2e churn in the batch. If UI-191 slips, **all of Phase 60 is cut and shipped whole later** — never
half. A migrated toolbar with an unmigrated composer is the exact defect the user reported. There is
no partial landing of this phase.

---

## Premise checks — verified read-only against the tree, 2026-09-07

The pre-flight read the kit surface, the four offending files, `design/index.html`, the hooks, CI,
and the e2e tree. **The chain holds.** Eight things the issue files assume are not true of the built
system. Three of them change the plan materially (P4, P6, P7).

### P1 — `packages/kit/src/components/` exists, and holds no primitive

It exists with three subdirectories — `Autocomplete/`, `Composer/`, `Cost/` — and none of them is a
`Button`, `Select`, `Chip`, `Popover`, `ScrollArea` or `IconButton`. There is **no generic component
primitive anywhere in kit today**. `packages/kit/src/index.ts` exports hooks, the client, `Row`,
`MarkdownView`, `CostChart`, `ComposerAddress` — feature components, not primitives. UI-191 builds
the primitive layer from nothing. Nothing is being refactored into place, so no existing consumer
API constrains the shape.

### P2 — "82 files" is wrong by a factor of four, and the real number is 22

UI-191's acceptance criterion cites "all 82 files currently carrying raw `<button>`/`<select>`". The
tree says otherwise. Counted 2026-09-07 over `apps/ui/src` + `packages/kit/src`:

| Measure                                                 | Count |
| ------------------------------------------------------- | ----- |
| `.tsx` files, non-test, carrying JSX `<button\|select\|option>` | **22** |
| Raw `<button` occurrences (all files, tests included)   | 63    |
| Raw `<select` occurrences (all files, tests included)   | 9     |
| Raw `<option` occurrences (all files, tests included)   | 16    |

The 22 are the migration surface. Several of the wider grep's hits are **`.css` files** (`BoardBar.css`,
`editor.css`, `console.css` — CSS selectors) and **`.ts` files** (`shortcuts.ts`, `overlays.ts`,
`stageChoices.ts`, `weightChoice.ts` — prose in doc comments and string constants). Those are not
migration work and must not be counted as such, in the issue or in INFRA-040's exemption list.

**Ruling**: UI-191's acceptance criterion is amended to the real figure. The implementing agent
records the enumerated 22-file list in the issue, because INFRA-040's exemption list is derived from
it and P6 pins the two together.

**The 22** (recorded here so INFRA-040 has a source):
`apps/ui/src/` — `reader/FocusMode.tsx`, `upgrade/UpgradePanel.tsx`, `board/KanbanDialog.tsx`,
`shell/BoardBar.tsx`, `shell/ThemeToggle.tsx`, `compose/ComposeOverlay.tsx`, `image/ImageViewer.tsx`,
`search/SearchOverlay.tsx`, `menu/ContextMenu.tsx`, `thread/ThreadMenuTrigger.tsx`,
`thread/ThreadComposer.tsx`, `thread/ThreadPanel.tsx`, `anchors/CommentPopover.tsx`,
`editor/SaveChip.tsx`, `editor/FormatToolbar.tsx`, `console/LaneWeight.tsx`,
`console/ConsoleStrip.tsx`, `console/JobList.tsx`, `console/LaneList.tsx`,
`console/LaneRelease.tsx`; `packages/kit/src/` — `markdown/CorpusImage.tsx`,
`address/ComposerAddress.tsx`.

### P3 — there are three native-select sites, not two, and the console is the third

UI-191 names `ComposeOverlay.tsx:475` and `:517`. The census finds a third product surface:

- `apps/ui/src/editor/FormatToolbar.tsx` — **four** `<select>`s at `:333`, `:359`, `:388`, `:407`.
  This is the reported offence (heading, colour, align, indent).
- `apps/ui/src/compose/ComposeOverlay.tsx:475` (owner) and `:517` (at). The mixed row.
- `apps/ui/src/console/LaneWeight.tsx:133` — **the console's lane-weight picker, unnamed in any
  issue**. It is a native `<select>` on the console pane, and it is in scope: "everywhere" is the
  directive's word.

`FormatToolbar.tsx:228` carries a comment that a `<select>` cannot have its `mousedown` cancelled —
a second workaround, like `ComposeOverlay.tsx:100-103`'s null sentinel, that the kit `Select` deletes
rather than ports.

### P4 — `design/index.html` already has the chip language, has no dropdown, and its buttons are not pills

The mockup is further along than UI-191 assumes, and it disagrees with the transcription on one
point.

**Already there** (`design/index.html`): `.chip` at `border-radius: 99px` with `--surface-2` fill and
a `--line` border; `.chip.on` tinted with `--accent-wash`/`--accent-ink`; `.chip.warn` with
`--sepia-wash-2`; `.chip.good` with `--good-wash`; **`.chip.ghost` with `border-style: dashed`**.
That is exactly UI-191's four states — tinted-by-role fill, dashed for empty — already drawn and
already tokenised. `Chip` is a port, not an invention.

**The disagreement**: the mockup's buttons are **not** fully rounded. `.btn-compose` and `.btn-ask`
are `border-radius: 8px` accent-filled, `.btn-capture` is `8px` outlined, `.btn-queue` is `8px` on
`--surface-2`. The transcription says the target is "flat, fully-rounded pills". So the mockup's
button radius (8px) and the mockup's chip radius (99px) are two different shapes, and the user's
screenshot pointed at the **chip** row.

**Ruling**: this is a design decision, and `design/index.html` is where it is made and recorded — not
in kit, and not by prose in an issue. UI-191's design step resolves it explicitly, one way, with the
rejected direction written down: either `Button` adopts 99px and the mockup's three button classes
are restyled with it, or `Button` keeps 8px and "pill" in the transcription means the `Chip`/`Select`
family only. **Do not ship the ambiguity as two radii in one row** — that is the reported defect
wearing a different hat. This is the one open question in the sprint that the orchestrator should
expect to see answered before UI-192 starts.

**Nothing in the mockup is a dropdown.** There is no select, no chevron trigger, no menu popover
anywhere in `design/index.html`. `Select` is genuinely new design work and it is the long pole of
UI-191's design step.

### P5 — the address popover's missing Escape is a documented architectural decision, not an oversight

UI-192 reverses `ComposerAddress.tsx:66`'s "Escape is deliberately not handled". The file states the
reason, and it is not laziness:

> "the app's escape chain owns that key at the surface grain, and a kit component cannot register in
> it (`RecipientPicker` learned this; the reason survives it)."

The chain is real: `apps/ui/src/shell/overlays.ts` reads the DOM (`.overlay.open`, `[role="menu"]`)
to decide who owns the keyboard, and `apps/ui/src/keyboard/useShortcuts.ts` dispatches against it.
A kit component cannot import from `apps/ui` — the dependency direction forbids it.

UI-193 nevertheless requires kit's `Popover` to handle Escape **unconditionally**, as a property no
prop can switch off. **Both are right, and the collision is this sprint's hardest seam.**

**Ruling**: `Popover` handles Escape on its own DOM subtree via a listener it owns, and it
`stopPropagation()`s the key it consumed, so the app's chain never sees a key an inner popover
already answered. It participates in the chain by satisfying the chain's own DOM contract — a
`Popover` renders the markers `overlays.ts` looks for — rather than by importing anything from
`apps/ui`. The unconditional guarantee is kept and the layering is kept. If the implementer finds
this does not hold against the real dispatcher, that is an **escalation, not a workaround**: the
answer is not a `closeOnEscape` prop, because a prop is exactly what UI-193 exists to forbid.

### P6 — INFRA-038's wiring is the wrong pattern to copy, and INFRA-040's own filing already says so

The release scope asks INFRA-040 to copy "how INFRA-038's `skills:check` is wired". Read as written,
that would be a mistake. INFRA-038 is wired as **two new steps**: a bespoke `node --import tsx
scripts/check-skill-budget.ts --staged` step in `.githooks/pre-commit` behind a bash pre-filter, and
a separate `npm run skills:check` step in `.github/workflows/ci.yml`. It needs its own wiring because
a markdown size budget is not something ESLint can see.

INFRA-040 is not in that position, and its own filing rejects the duplication:

> "ESLint already runs diff-scoped on staged TypeScript in pre-commit and whole-repo in CI, so the
> rule rides both gates with **zero new hook steps**."

That is correct against the tree. `.githooks/pre-commit` already runs `npx eslint $staged_ts`, and
`ci.yml:89` already runs `npm run lint`.

**Ruling**: copy INFRA-038's **shape** — diff-scoped locally, whole-repo in CI, per the 2026-08-07
placement rule — and **not its mechanism**. INFRA-040 adds an ESLint rule and **zero** lines to
`.githooks/pre-commit` and **zero** steps to `ci.yml`. An implementation that adds a hook step has
failed this contract, whatever else it does.

### P7 — the address popover is the most heavily e2e-tested surface in the product, and UI-192 invalidates that suite

This is the finding that changes the risk picture. UI-192 says the popover's scroll region is
"unusable" and the file's comments "lost" the fight. The tree says the fight was won, argued at
length, and pinned by a large green suite:

| Spec                             | Size   | What it holds                                                    |
| -------------------------------- | ------ | ---------------------------------------------------------------- |
| `address-geometry.spec.ts`       | 66.6KB | the card's layout, reserves, lane rows                            |
| `address-room-geometry.spec.ts`  | 29.2KB | 15 tests: "an ordinary roster is read, not scrolled", "a roster that outruns even the room says so", "the ceiling is the room and not a number" |
| `ask-designation-weight.spec.ts` | 10.5KB | the designation weight path UI-192 removes from the popover        |
| `recipient.spec.ts`              | 14.1KB | lane selection                                                     |

**~120KB of Playwright asserts the current popover, and it is all green.** These tests are not
absent — they encode the *rejected* design. So:

1. **UI-191's "every existing e2e must pass unmodified except selectors" cannot hold for UI-192.**
   UI-192 is a redesign, and a redesign changes assertions. The clause is scoped correctly for UI-191
   itself (restyling) and must be read as **not** binding on UI-192.
2. **The e2e churn estimate in the release scope is understated.** The churn is not spread thinly
   across 22 files — it is concentrated in four address specs, and `address-room-geometry.spec.ts`'s
   geometry claims are the ones UI-192 deliberately breaks.
3. **The existing suite passing is not evidence the surface is good** — INFRA-020's lesson, arriving
   again. A green geometry suite coexisted with a user calling the same surface "broken". The tests
   measured the room the card takes and never asked whether a person could scroll it.

**Ruling**: UI-192 rewrites `address-room-geometry.spec.ts`'s scroll-region claims against UI-193's
minimum-usable-height token, and deletes the weight-picker assertions in `ask-designation-weight.spec.ts`
that name the popover as the weight editor — moving them to the composer row's control. Every
deletion is listed in UI-192's E2E log with the reason. A deleted assertion with no replacement and
no reason is a finding.

### P8 — UI-195's release control is three raw buttons that copied the pane, exactly as predicted

`apps/ui/src/console/LaneRelease.tsx` renders three raw `<button>`s (`:134`, `:159`, `:171`) and its
own comment records the choice: "the list beside this is rows of real `<button>`s — `LaneList`'s
deliberate…". It copied the pane's style on purpose because no primitive existed to copy instead.
It migrates with everything else, and it is in the 22. Its neighbours `LaneList.tsx`, `JobList.tsx`,
`ConsoleStrip.tsx` and `LaneWeight.tsx` migrate in the same pass — the console pane is one visual
unit and half-migrating it is the reported defect again.

---

## The three seams, named

The release scope asked for these by name. They are binding.

### Seam 1 — the kit primitive API surface (UI-191 produces; UI-192 and UI-193 consume)

UI-192 and UI-193 cannot start until this surface is exported from `packages/kit/src/index.ts` and
stable. The contract is the **names and the guarantees**, not the props — the implementing agent
chooses prop shapes, and the following must be true of whatever it chooses:

- `Button` — variants covering the mockup's three existing button roles (accent-filled, outlined,
  quiet). Radius per P4's recorded decision.
- `IconButton` — square/round icon-only, accessible name required (no unlabelled icon button
  compiles into the product).
- `Chip` — `default`, `on` (tinted by semantic role, never by colour name), `warn`, `good`, and
  `ghost` (dashed = empty/placeholder). Ports `design/index.html`'s existing `.chip*` classes.
- `Select` — pill trigger + chevron + **custom** popover menu. Takes real values including `null`
  (this is what deletes `ComposeOverlay.tsx:100-103`'s sentinel). Full keyboard: arrows, type-ahead,
  Escape, focus return. **States its long-label behaviour**: ellipsis on the trigger, full value in
  the popover, popover free to be wider than its trigger, `title` on hover.
- `Popover` — UI-193's unconditional set: close affordance, Escape with focus return, focus trap,
  outside-click dismiss. Per P5, it satisfies `overlays.ts`'s DOM contract rather than importing it.
- `Modal` — the same set at surface grain.
- `ScrollArea` — visible overflow affordance; visible region never below the minimum-usable-height
  token; throws in dev and clamps in production when it would render shorter.

**The token is part of the seam.** The minimum usable height is a value in
`packages/kit/src/tokens.css`, ported from `design/index.html` per that file's own header rule, and
UI-192's roster test and UI-193's battery both read it from there. Two hard-coded 120s in two specs
is not a shared minimum.

### Seam 2 — what the static check can honestly claim

UI-193 already tiers this and the tier boundaries are held exactly as filed. **A check that claims
coverage it does not have is worse than no check**, because it converts an open question into a
false answer.

| Tier                       | Mechanism            | What it actually catches                                                                                 | What it cannot |
| -------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------- | -------------- |
| **Correct by construction** | kit primitives       | An overlay with no exit **cannot be expressed** — Escape, close affordance, focus trap and outside-click are not props. A `ScrollArea` below the minimum throws in dev. | Anything a surface builds without using the primitive |
| **Lintable** (INFRA-040)   | ESLint, both gates   | JSX `<button>`, `<select>`, `<option>` outside the exempt list. UI-193's extension: raw `role="dialog"` / fixed-position overlay implementations outside kit. **Syntax, in the files it lints.** | Whether the primitive was used *well*; anything computed at runtime; anything in a `.css` or `.ts` file |
| **Playwright** (UI-193)    | the overlay battery  | Viewport fit, nothing interactive clipped, close button visible, Escape dismisses, focus returns, every scroll region meets the minimum and shows its affordance — **over seeded crowded content** | Meaning |
| **Review** (evaluator)     | a checklist item     | Semantic duplication — two controls meaning one thing                                                     | — |

**The honesty clause, binding**: nothing in this sprint may describe INFRA-040 as catching the
designation popover's defects. It catches **one** of the four (native chrome), and only as syntax.
The crowded modal and the unreachable scroll are the battery's. The duplicated controls are
**nobody's check** — that class is not statically decidable, and UI-193 says so. The evaluator
checklist item in `.claude/agents/evaluator.md` is the honest home, and it is a deliverable of this
sprint, not a note.

### Seam 3 — the battery's fixture needs

The battery runs against the **crowded** case, because the empty case is how these shipped. The
mechanism exists and needs extending, not inventing.

- **The seeder is `apps/ui/e2e/stubCorpus.ts`** (142KB), whose `StubOptions.lanes?: readonly AgentLane[]`
  (`:727`) is the roster `GET /api/agents` answers with.
- **Today's ceiling is 4 lanes.** `address-room-geometry.spec.ts` seeds four. `recipient.spec.ts`,
  `resident.spec.ts`, `resident-weight-change.spec.ts` and `residents-tab.spec.ts` seed one to a few.
  **No spec in the tree has ever opened this popover over nine lanes**, which is precisely why the
  reported defect shipped.
- **What UI-193 adds**: one exported crowded fixture in `stubCorpus.ts` — ≥9 lanes, long lane names,
  long agent profile names, long weight-level labels — used by the battery and by UI-192's roster
  test. One fixture, one place, so "crowded" means the same thing in both.
- **The registry is a module, not a convention.** UI-193's overlay registry enumerates every overlay
  the product can open, and the battery iterates it. Today's candidates, from the tree:
  `FocusMode`, `UpgradePanel`, `KanbanDialog`, `QueryHelp`, `ComposeOverlay`, `ImageViewer`,
  `SearchOverlay`, `CommentPopover`, `CheatSheet`, plus `ComposerAddress`'s popover and every
  `Select` menu. An overlay absent from the registry fails a test — that is the mechanism that makes
  a *future* overlay pay the battery too.

---

## Machine rules — binding on every agent in this batch

A rehearsal pass runs on this laptop. On top of each agent profile's Machine Resources section:

- **Scoped tests only.** `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run <path>`. Never the
  repo-wide suite, never `npm run test:coverage`, from any worktree.
- **Playwright is single-holder.** It starts its own Vite. Never run `npm run e2e` while another e2e
  run or a dev server is alive. With this batch's e2e churn, **the two UI lanes must not run
  Playwright at the same time** — coordinate through the orchestrator or run the battery last.
- **One heavy command at a time.** No overlapping build, test, e2e or `npm install`.
- **Kill what you started** before ending, by recorded pid, and verify your ports are free. Never
  kill the `corpus` process on `8765` — that is the user's live server.
- **The kit dist trap applies here more than anywhere** (memory, 2026-08): breaking `packages/kit/src`
  passes browser tests until you rebuild. This sprint moves the product's whole interactive surface
  into kit. **Rebuild kit before believing any green e2e run.**

---

## Acceptance Tests

### Group A — the component language (ui-dev) · UI-191

TEST-1223: The mockup draws Button in every state
Given: `design/index.html` open in a browser
When: The Button specimens are inspected
Then: Rest, hover, active, disabled and keyboard-focus states are each drawn for every variant, in
both the dark and the light theme

TEST-1224: The mockup draws Select, open
Given: `design/index.html`
When: The Select specimen is inspected
Then: A pill trigger with a chevron and an open custom popover menu are drawn, with rest, hover,
active, disabled and focus states — and no native `<select>` appears in the mockup

TEST-1225: The mockup draws Chip in all four variants
Given: `design/index.html`
When: The Chip specimens are inspected
Then: Default, tinted-by-role, dashed-empty and disabled are drawn; the dashed variant is the
empty/placeholder state

TEST-1226: The tokens are ported, not invented
Given: New values introduced by the mockup for the primitives
When: `packages/kit/src/tokens.css` is compared to `design/index.html`
Then: Every new value is transcribed verbatim, per `tokens.css`'s own header rule, and no primitive
in kit carries a hard-coded colour, radius or spacing that is absent from the mockup

TEST-1227: The radius decision is recorded
Given: P4's disagreement between the mockup's 8px buttons and the 99px chip language
When: UI-191's issue file and `design/index.html` are read
Then: One radius is chosen for `Button`, the rejected direction is written down, and no rendered row
in the product mixes the two radii for controls of the same kind

TEST-1228: The format toolbar renders zero native select chrome
Given: A document open in the editor
When: The editor DOM is queried
Then: `<select>` and `<option>` return zero nodes anywhere in the editor subtree

TEST-1229: Heading selection still works
Given: The cursor inside a paragraph
When: The heading control is opened and "Heading 1" chosen
Then: The block becomes an H1, exactly as before the migration

TEST-1230: Colour selection still works
Given: A text selection in the editor
When: The colour control is opened and a colour chosen
Then: The selection takes the colour, and the round-trip through markdown is unchanged

TEST-1231: Align and indent still work
Given: A block in the editor
When: The align control and the indent control are each exercised through the new dropdown
Then: The block's alignment and indentation change as they did before, with no change to stored
markdown

TEST-1232: A dropdown is fully operable from the keyboard
Given: Focus on any migrated `Select` trigger
When: The user presses Enter/Space to open, arrow keys to move, letters to type-ahead, Enter to
choose
Then: The value changes without any pointer event, and the menu closes

TEST-1233: Escape closes a dropdown and returns focus
Given: An open `Select` menu
When: The user presses Escape
Then: The menu closes, the value is unchanged, and focus is on the trigger that opened it

TEST-1234: The composer's owner control is a pill dropdown
Given: The Ask composer open
When: The designation row is inspected
Then: The owner control is a kit `Select` with the pill trigger, and no `<select>` node exists in the
composer subtree

TEST-1235: The composer's "at" control is a pill dropdown
Given: The Ask composer open with a resident chosen and the workspace declaring levels
When: The "at" control is inspected
Then: It is a kit `Select` with the pill trigger, and its behaviour — appearing only where there is a
resident to weigh, disappearing rather than dimming under "no owner" — is unchanged

TEST-1236: The designation row renders one language
Given: The Ask composer open
When: The recipient, owner and "at" controls are compared
Then: All three are the same pill dropdown; the row shows no native chrome and no second style

TEST-1237: A long label is readable, not truncated mid-word
Given: A workspace seeded with a long agent profile name and a long weight-level label
When: The owner and "at" triggers are read closed
Then: Each shows an ellipsis with the full value available via `title`, and neither cuts mid-word
without an affordance

TEST-1238: The popover may be wider than its trigger
Given: The same long-label workspace
When: The owner `Select` is opened
Then: The menu renders the full option text, at a width greater than the trigger's if it needs one

TEST-1239: The null sentinel is deleted and null still travels
Given: The Ask composer with profiles available
When: "no owner" is chosen and Ask is pressed
Then: The request carries a real `null` resident, and `NO_RESIDENT_VALUE` no longer exists anywhere
in `apps/ui/src`

TEST-1240: The unchosen state still shows the default
Given: A fresh Ask composer, nothing chosen
When: The owner trigger is read
Then: It shows the default resident label — not a "choose an owner…" placeholder — preserving Rider
A's meaning

TEST-1241: The console's lane-weight picker is migrated
Given: The console pane with a lane selected
When: The lane-weight control is inspected
Then: It is a kit `Select`, `LaneWeight.tsx` contains no `<select>`, and changing a weight has the
behaviour it had before

TEST-1242: The release control is migrated
Given: The console pane with a lane that can be released
When: `LaneRelease`'s three controls are inspected
Then: All three are kit `Button`s, their `title` text and their confirm behaviour are unchanged, and
UI-195's shipped behaviour still holds

TEST-1243: The console pane renders one language
Given: The console open
When: `LaneList`, `JobList`, `ConsoleStrip`, `LaneWeight` and `LaneRelease` are viewed together
Then: Every interactive element in the pane is a kit primitive, and no two controls of the same kind
draw differently

TEST-1244: The board chrome is migrated
Given: The board
When: `BoardBar`, `ThemeToggle`, `KanbanDialog` and `ContextMenu` are exercised
Then: Each renders kit primitives, and every existing board e2e passes with only selector changes

TEST-1245: The readers are migrated
Given: A document open, then full screen
When: `FocusMode`, `SaveChip` and `ImageViewer` are exercised
Then: Each renders kit primitives with unchanged behaviour

TEST-1246: The thread surfaces are migrated
Given: A thread open
When: `ThreadPanel`, `ThreadMenuTrigger`, `ThreadComposer` and `CommentPopover` are exercised
Then: Each renders kit primitives with unchanged behaviour

TEST-1247: The search and upgrade overlays are migrated
Given: The search overlay, then the upgrade panel
When: Each is opened and exercised
Then: Both render kit primitives with unchanged behaviour

TEST-1248: Kit's own surfaces are migrated
Given: `packages/kit/src/markdown/CorpusImage.tsx` and `packages/kit/src/address/ComposerAddress.tsx`
When: Their DOM is inspected in the running product
Then: Neither renders a raw `<button>` outside a primitive's internals

TEST-1249: Both themes hold
Given: The migrated product
When: Every migrated surface is viewed in the dark theme and then the light theme
Then: Every primitive renders correctly in both, per §10, with contrast from the semantic tokens and
never a hard-coded colour

TEST-1250: The suite is green and its assertions are unchanged
Given: The full Playwright suite before UI-192 begins
When: `npm run e2e` runs
Then: It is green, and every diff to a spec file in this lane changes a **selector** only — no
assertion's meaning is altered by UI-191

### Group B — the enforcement (infra-dev) · INFRA-040

TEST-1251: A raw `<select>` fails lint with a message naming the replacement
Given: The migrated tree
When: A JSX `<select>` is added to any non-exempt file under `apps/ui/src` and `npx eslint` is run on
that file
Then: It fails, and the message names the kit primitive to use instead

TEST-1252: A raw `<button>` fails the same way
Given: The migrated tree
When: A JSX `<button>` is added to a non-exempt file and linted
Then: It fails, with a message naming `Button` or `IconButton`

TEST-1253: A raw `<option>` fails the same way
Given: The migrated tree
When: A JSX `<option>` is added to a non-exempt file and linted
Then: It fails, with a message naming `Select`

TEST-1254: Pre-commit blocks it, and adds no step
Given: A staged file carrying a violation
When: `git commit` runs
Then: The existing `eslint (staged)` step fails and nothing is committed — and `.githooks/pre-commit`
has **zero** new steps and zero new lines of wiring relative to its pre-sprint state

TEST-1255: CI catches a file nobody staged, and adds no step
Given: A violation in a file the commit did not touch
When: `CI / validate` runs
Then: The existing `npm run lint` step fails — and `.github/workflows/ci.yml` has **zero** new steps

TEST-1256: The migrated tree is clean
Given: The tree after UI-191, UI-193 and UI-192
When: `npm run lint` runs
Then: Zero violations of the new rule

TEST-1257: No inline disables
Given: The migrated tree
When: The repository is searched for `eslint-disable` naming this rule
Then: Zero occurrences, anywhere, per Lint Discipline

TEST-1258: The exemption list is pinned to UI-191's record
Given: The ESLint config's path exemptions and UI-191's recorded internals list
When: The pinning test or comment is exercised
Then: The two sets are identical, and a primitive added or removed without updating both fails

### Group C — overlays correct by construction (ui-dev) · UI-193

TEST-1259: An overlay without an exit cannot be expressed
Given: The kit `Popover` and `Modal`
When: They are rendered with no props beyond their content
Then: A close affordance is present in the DOM — there is no prop that removes it

TEST-1260: Escape dismisses, returns focus, and does not reach the board
Given: An open `Popover` inside the board
When: Escape is pressed
Then: The popover closes, focus returns to the opener, and the board's shortcut dispatcher does not
act on that key (P5's `stopPropagation` guarantee)

TEST-1261: Focus is trapped while open
Given: An open `Modal`
When: Tab is pressed past the last focusable element
Then: Focus returns to the first, and never lands behind the overlay

TEST-1262: Outside click dismisses
Given: An open `Popover`
When: A click lands outside it
Then: It closes, and focus returns to the opener

TEST-1263: A too-short ScrollArea throws in development
Given: A `ScrollArea` whose visible region would render below the minimum-usable-height token
When: It renders in a development build
Then: It throws, with a message naming the token and the measured height

TEST-1264: The same ScrollArea clamps in production
Given: The same component in a production build
When: It renders
Then: It clamps to the minimum rather than throwing, and the surface stays usable

TEST-1265: Overflow is visible when content overflows
Given: A `ScrollArea` whose content exceeds its region
When: It renders
Then: An overflow indicator is visible, and the "N more" line is present where the registry's entry
declares one

TEST-1266: Raw overlays outside kit fail lint
Given: The migrated tree
When: A `role="dialog"` or fixed-position overlay implementation is added outside `packages/kit/src`
and linted
Then: It fails, with a message naming `Popover` or `Modal`

TEST-1267: An unregistered overlay fails a test
Given: The overlay registry and the battery
When: A new overlay surface is added to the product without registering it
Then: A battery test fails, naming the unregistered surface

TEST-1268: Every registered overlay survives the crowded case
Given: The crowded fixture — ≥9 lanes, long lane names, long profile names, long level labels —
seeded through `apps/ui/e2e/stubCorpus.ts`
When: The battery opens every overlay in the registry at the default window size
Then: Each fits the viewport with nothing interactive clipped, shows a visible close control,
dismisses on Escape with focus returned, and every scroll region inside meets the minimum height and
shows its affordance

TEST-1269: The battery would have caught the reported defect
Given: The pre-UI-192 `ComposerAddress` popover, before it is deleted
When: The battery is run against it
Then: **At least three** assertions fail — recorded in UI-193's E2E log with the failure text, as
proof the battery is not written to the fixed code

TEST-1270: The evaluator learns what no check can see
Given: `.claude/agents/evaluator.md`
When: Its checklist is read
Then: It carries the item "open every overlay; for each control, name what it edits; two answers the
same is a finding" — the honest home for semantic duplication, per Seam 2

### Group D — the designation popover rebuilt (ui-dev) · UI-192

TEST-1271: One editor per meaning
Given: The Ask composer with a resident and levels available
When: The weight is changed in the composer row, and then the designation popover is opened
Then: The popover offers **no second weight editor**, and the same holds for the owner agent

TEST-1272: A summary, if it exists, is read-only
Given: The rebuilt popover showing a weight or owner summary
When: The summary is clicked
Then: It moves focus to the composer row's control and edits nothing itself

TEST-1273: The popover has a visible way out
Given: The rebuilt popover open
When: The close button is pressed, and separately Escape is pressed
Then: Each closes it, and focus returns to the trigger both times

TEST-1274: Click-outside remains a third path
Given: The rebuilt popover open
When: A click lands outside it
Then: It closes — the path that was previously the only one still works

TEST-1275: The roster has room at nine lanes
Given: The crowded fixture's ≥9 lanes at the default window size
When: The popover is opened
Then: Its scroll region meets UI-193's minimum-usable-height token, its overflow affordance is
visible, and the "N more" line is present

TEST-1276: The tooltip stops disambiguating
Given: The rebuilt trigger
When: Its tooltip text is read
Then: It describes one control doing one thing, and contains no clause reconciling it with another
control — the string at `ComposerAddress.tsx`'s `WEIGHT_UNKNOWN_TITLE` family is rewritten or removed

---

## Out of scope

- **Any behaviour change outside the designation popover.** UI-191 is restyling and
  componentization. UI-192 is the one redesign in this batch, and its scope is the popover.
- **`<input>`, `<a>`, `<textarea>`, and form internals inside kit's Composer.** INFRA-040 bans
  exactly what UI-191 replaced. A text input is not a button.
- **`.css` and `.ts` matches for the banned tags.** CSS selectors and doc-comment prose are not
  interactive elements and are not migration work (P2).
- **The evaluator running the semantic-duplication sweep.** This sprint lands the checklist item
  (TEST-1270). Running it against the whole product is the evaluator's next pass, not a lane here.
- **New overlays.** The registry enumerates what exists. Building anything new to fill it is out.
- **SPEC.md.** Phase 60 writes no rider and needs none.
- **Retro-fitting the battery to surfaces that are not overlays** — menus, toasts, the console strip.

## Integration points — the seams that must hold

- **UI-191 produces → UI-192 and UI-193 consume**: `Button`, `IconButton`, `Chip`, `Select`, exported
  from `packages/kit/src/index.ts`. UI-192 and UI-193 do not start until these exist and typecheck.
- **UI-193 produces → UI-192 consumes**: `Popover`, `Modal`, `ScrollArea`, and the
  minimum-usable-height token in `tokens.css`. UI-192's TEST-1275 reads the token, never a literal.
- **UI-191 produces → INFRA-040 consumes**: the enumerated list of primitive-internal files, which is
  verbatim the ESLint config's path exemptions (TEST-1258).
- **UI-193 produces → UI-192 consumes**: the crowded fixture in `apps/ui/e2e/stubCorpus.ts`. One
  fixture, one definition of "crowded", used by TEST-1268 and TEST-1275.
- **UI-193 extends INFRA-040's rule**, it does not build a second mechanism. The overlay ban is a
  case added to the same rule, linted by the same two gates.
- **`overlays.ts`'s DOM contract is the interface, not an import.** Kit's `Popover` renders the
  markers `isOverlayOpen()` and `isMenuOpen()` look for. Neither package imports the other.

## Escalations — for the orchestrator, before spawning

1. **P4's radius question.** UI-191's design step answers it, in `design/index.html`. If the agent
   asks rather than deciding, this is a user question — the screenshots are the user's and the
   orchestrator cannot re-read them.
2. **P5's Escape collision.** If `stopPropagation` on the popover's own subtree does not satisfy both
   UI-193's unconditional guarantee and the app's escape chain, escalate. **Do not accept a
   `closeOnEscape` prop** — a prop is what UI-193 exists to forbid.
3. **P7's e2e deletions.** UI-192 deletes assertions in `address-room-geometry.spec.ts` and
   `ask-designation-weight.spec.ts`. Every deletion is listed with a reason in the E2E log. A large
   unexplained deletion in a geometry spec is a stop-and-ask, not a cleanup.
4. **The cut rule.** If UI-191 does not complete, the phase is cut whole. Do not land INFRA-040
   against a partly-migrated tree — the rule would fail on files nobody was asked to migrate.

## Spawn order — sequential at the seams, parallel where it is real

1. **UI-191 alone.** Largest diff, and everything else consumes its exports. No parallel lane while
   it runs — the machine rules forbid a second Playwright holder anyway.
2. **INFRA-040 and UI-193 in parallel**, once UI-191's primitives are exported and the migration is
   complete. INFRA-040 is config and lint (no Playwright). UI-193 owns the e2e slot.
3. **UI-192 alone**, last. It consumes both.

## Done Criteria

This sprint is complete when:

- All 54 acceptance tests PASS in the evaluator's verdict
- `npm run e2e` is green, with every UI-191-lane spec diff limited to selectors
- `/test` passes with no regressions and `/lint` passes
- `npm run typecheck` and `npm run build` pass, **kit rebuilt** before any green e2e is believed
- Zero violations and zero inline disables of INFRA-040's rule
- `design/index.html` carries every primitive in every state, and `tokens.css` transcribes it
- The P4 radius decision and the P7 deletions are recorded with their rejected alternatives
- Each issue's E2E Verification Log is filled with concrete evidence and states the model it ran on
