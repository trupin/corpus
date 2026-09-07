# Evaluation: sprint-026 / Phase 60 — "The product has one button"

**Date**: 2026-09-07 (first pass) · **re-checked 2026-09-07** after commit `47311538`
**Sprint**: sprint-026 (UI-191 · INFRA-040 · UI-193 · UI-192)
**Verdict**: **PARTIAL** — the first pass returned **FAIL**. Claim 3's FAIL-1 is **cleared**, verified
against a real `corpus init` workspace server. Claim 4 stands at PARTIAL: a sanctioned ratchet, and a
scope question for the orchestrator and the user rather than a defect. No failure remains open.

**Scope of this pass**: the four claims the user's own screenshots produced, driven against the
real product — not the acceptance ladder one test at a time. Where a sprint test number is the
authority for a claim, it is cited.

## How this was tested

No source file was read except `scripts/raw-controls-baseline.json` and the ESLint gate itself,
which claim 4 makes the explicit exception.

| Step               | What was done                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Build              | `npm run build` — exit 0 (kit `dist/` rebuilt; the falsification trap)                                             |
| Workspace          | `corpus init ws --port 8791` from the built CLI — a real workspace, real git repository, real template            |
| Server             | `corpus server start` — `corpus 0.35.0 listening on http://127.0.0.1:8791 (pid 24854)`, serving the built UI      |
| Seed               | 3 `agent-def` profiles (one 40 characters long), 1 note, 11 standalone threads, each `thread designate`d with a level |
| Roster             | 12 lanes (`corpus agents`), long lane names, long profile names, long level labels                               |
| Browser            | real Chromium via Playwright at 1280×720 (also 1440×900 and 1600×1000), light and dark                            |
| Port discipline    | 8791 only. Port 8765 was never touched.                                                                          |

Screenshots and probe scripts:
`/private/tmp/claude-501/-Users-theophanerupin-code-corpus/ff50cb74-5faf-42b9-ab2b-25c21287325d/scratchpad/shots/`

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                     |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | All four issues carry a filled `## E2E Verification Log`.                                                                                 |
| Commands are specific and concrete      | PASS   | Named ports (`CORPUS_UI_PORT=5273/5373/5473`), named specs, verbatim ESLint output, verbatim failure text, named screenshot files.         |
| Real E2E (not mocked)                   | PASS   | Real Vite server + real Chromium for the UI lanes. INFRA-040 ran the **real** `.githooks/pre-commit` end to end and the real `npm run lint`. |
| Scenarios cover acceptance criteria     | PARTIAL| Every criterion has evidence, but **no lane opened the designation popover in the "no owner" state** — the state UI-192 itself created. That gap is FAIL-1. |
| Application restarted after changes     | PASS   | Kit `dist/` rebuilt before each e2e run, stated in three of the four logs.                                                                 |
| Actual model recorded (implemented on:) | PASS   | UI-191 Fable 5 · INFRA-040 Opus 5 (`claude-opus-5[1m]`) · UI-193 Fable · UI-192 Fable 5.                                                   |
| Reproduction logged before fix (bugs)   | PASS   | UI-192's reproduction is UI-193's battery run against the pre-rebuild popover, with three verbatim failures. UI-193 records 7 first-contact failures, 4 fixed. |

The logs are credible. They are also, in one place, incomplete: UI-193's battery opens
`designation-popover` only in the designating state, so its "nothing interactive is clipped" check
has never seen the surface FAIL-1 describes.

## Claim Results

| # | Claim (the user's words, condensed)                                              | Result  |
| - | ---------------------------------------------------------------------------------- | ------- |
| 1 | ONE LANGUAGE — chip-pill everywhere, no native selects, one visible family        | PASS    |
| 2 | THE DESIGNATION POPOVER IS FIXED FOUR WAYS — exit, Escape, roster room, no duplicate | PASS    |
| 3 | NOTHING UNREACHABLE at 1280×720 with the drawer at default height                 | **PASS** (was FAIL; fixed by `47311538`, re-verified) |
| 4 | THE CHECK BITES — a raw `<button>` in any apps/ui component file fails lint       | PARTIAL |

---

## Claim 1 — ONE LANGUAGE: **PASS**

### Native chrome: zero, everywhere reached

`document.querySelectorAll("select").length` and `…("option").length` were read on every surface
below. Both are **0** on all of them:

board (Files) · Attention view board · By status kanban board · search overlay · compose overlay ·
compose overlay with the address popover open · compose overlay in the "no owner" state · document
reader · full-screen reader with the format toolbar · console Jobs tab · console Notices tab ·
console Residents tab · console lane panel · console lane-weight menu open · console release
confirm · thread reader · thread composer · thread address popover · comment popover · column
context menu · board-tab context menu · **and every one of those again in the dark theme**.

### The format toolbar draws the chip-pill language (TEST-1228, TEST-1229, TEST-1231, TEST-1232, TEST-1233)

Four dropdowns — `Text ▾ · Colour ▾ · Align ▾ · Indent ▾` — each a `button.select-trigger` with a
`span.select-chevron`, `border-radius: 99px`, `background rgb(239,237,232)`, `1px solid
rgb(227,225,218)`, `ui-monospace 11px`. That is the mockup's `.select-trigger` transcribed.

```
<button type="button" class="select-trigger" aria-haspopup="menu" aria-expanded="false"
        aria-label="Block style" data-select="block" title="Text">
  <span class="select-value" title="Text">Text</span><span class="select-chevron">▾</span>
</button>
```

Operated from the keyboard with zero pointer events: focus the trigger → `Enter` opens →
`ArrowDown` → `Enter`. The pill reads `Heading 1` and the document body becomes
`<h1>Alpha paragraph about the product and its buttons.</h1>`. `Escape` on the align menu closes
it, leaves the value unchanged, returns focus to `[data-select="align"]`, and the full-screen
reader stays open.

### The composer row reads as one register (TEST-1234, TEST-1236)

`agent will answer ▾ · owner [its own ag… ▾] · at [the launch… ▾]` — three pills, one language, no
second style. Each trigger ellipsises and carries the full value in `title`.
`shots/02-composer.png`.

### Ask and Capture are the mockup's Button, measured

| Control                       | class                       | radius | background        | padding  | size     |
| ----------------------------- | --------------------------- | ------ | ----------------- | -------- | -------- |
| App — Ask                     | `btn btn-primary btn-ask`   | 8px    | rgb(59,95,151)    | 6px 16px | 13.5px   |
| Mockup — `.btn-ask`           | `btn btn-primary btn-ask`   | 8px    | rgb(59,95,151)    | 6px 16px | 13.5px   |
| App — Capture                 | `btn btn-outline btn-capture` | 8px  | transparent       | 6px 16px | 13.5px   |
| Mockup — `.btn-capture`       | `btn btn-outline btn-capture` | 8px  | transparent       | 6px 16px | 13.5px   |

Identical. The chip family is likewise everywhere it should be: the search overlay's thirteen
filter chips (`chip`, `chip warn`, `chip ghost` dashed for "save as view"), the reader's
frontmatter strip (`chip`, `chip on`, `chip ghost` for the empty `due: —`), the console strip's
status chips.

### Findings recorded against this claim (they do not fail the user's test)

**1a — the console's act buttons carry no kit class.** `Release the resident`, `Re-designate at
this level`, `Confirm release` and `Keep the resident` render as
`<button type="button" data-lane-release="…">` with `className === ""`: radius **6px**, padding
2px 9px, `ui-monospace 10.5px`. The composer's outline Button is radius **8px**, padding 6px 16px,
system 13.5px. The same is true of the format toolbar's thirteen icon controls (`className === ""`,
radius 6px). Visually they still read as one flat outlined family at two scales, so the user's
"visibly one family" test holds. But **TEST-1243's "every interactive element in the pane is a kit
primitive" is not demonstrable from the rendered DOM** — the primitive contributes no class and no
token there, so the console pane's look is the same CSS it had before the migration.

**1b — four of the seven primitives have no specimen in the mockup.**
`design/index.html#primitives` draws Button (primary/outline/quiet × rest/hover/active/disabled/
focus), Select (rest/hover/focus/disabled/long-label/open) and Chip (default/tinted/dashed/
disabled) — TEST-1223, TEST-1224 and TEST-1225 all pass. It draws **no** `IconButton`, `Popover`,
`Modal` or `ScrollArea` in any state. Sprint-026's Done Criteria says "`design/index.html` carries
every primitive in every state". The toolbar's icon buttons therefore have no authoritative design
to be compared against, which is why 1a has no reference to settle it.

---

## Claim 2 — THE DESIGNATION POPOVER IS FIXED FOUR WAYS: **PASS**

Tested on both surfaces the user named: the composer's control (`button.address-line` in the global
Ask/Capture overlay) and the thread's (the same control in a designated thread's composer).

### A visible exit that works (TEST-1273)

```html
<button type="button" class="kit-popover-close" aria-label="Close Address" title="Close Address">✕</button>
```

Present on both. Pressing it closes the popover, the surrounding surface survives, and focus
returns to the opener:

```
opened:   {"pop":true,  "composer":true, "active":"recipient-opt on|BUTTON|agent"}
after X:  {"pop":false, "composer":true, "active":"address-line|BUTTON|agent will answer ▾"}
```

### Escape closes and returns focus without closing the surface (TEST-1273, P5)

```
after ESC: {"pop":false, "composer":true, "active":"address-line|BUTTON|agent will answer ▾"}
```

The compose panel survives the key — the `stopPropagation` guarantee holds. A second Escape then
closes the composer, as the app's chain should.

### Click-outside remains a third path (TEST-1274)

A click inside the compose panel but outside the popover closes the popover only
(`{"pop":false,"composer":true}`). A click on the scrim closes both, which is the overlay's own
behaviour and not a popover defect.

### The roster has room, and says it is scrolling (TEST-1275)

| Surface           | scroll region                     | clientHeight | scrollHeight | `data-overflowing` | affordance line              |
| ----------------- | --------------------------------- | ------------ | ------------ | ------------------ | ---------------------------- |
| Composer, 12 lanes| `.scroll-region.recipient-lanes`  | **120px**    | 179px        | `true`             | "12 lanes · scroll for the rest" |
| Thread, 12 lanes  | `.scroll-region.recipient-lanes`  | **181px**    | 450px        | `true`             | "12 lanes · scroll for the rest" |

Both meet the `--min-usable-height: 120px` token. A real wheel over the thread's roster moves it
(`scrollTop 269`) and the last lane row becomes hit-testable
(`elementFromPoint → BUTTON.recipient-opt`). This is a genuine repair: UI-193 recorded the
pre-rebuild region at **25px**.

### No control is duplicated (TEST-1271, TEST-1272, TEST-1276)

Every control on the surface, named by what it edits:

| Control                      | What it edits                                    |
| ---------------------------- | ------------------------------------------------ |
| `button.address-line` pill   | the recipient of **this message**                |
| `[data-select="owner"]`      | the **conversation's owner**                     |
| `[data-select="resident-weight"]` ("at") | the **level the resident is designated at** |
| popover roster (`recipient-opt`) | the recipient — the same field the trigger shows, which is the trigger's own menu, not a second editor |
| popover `weight-opt` rows    | the **message weight** — present only in the "no owner" state, where the "at" pill is gone |

No two answers are the same. The state switch was exercised: choosing `no owner — the main agent`
removes `[data-select="resident-weight"]` from the row (the row then holds only
`[data-select="owner"]`) and the popover grows a `WEIGHT` section. Choosing an owner again removes
the `WEIGHT` section and returns the "at" pill. Exactly one weight editor exists in each state.

The trigger tooltip is clean: `"agent will answer — Who answers this message. Open to change it."`
One control, one thing, no reconciling clause. TEST-1276 holds.

**Observation, not a failure.** On a designated thread whose recipient is the resident itself, the
popover closes with: *"archivist-… works at Heavy or judgment-laden — a weight set here would
govern only what archivist-… hands off"*. There is no weight control "here" in that state. The
sentence explains a boundary but names a control the reader cannot see.

**The fourth fix is undone by claim 3.** All four of the user's named repairs hold. The surface
nonetheless still hides a control — see FAIL-1, which is claim 3's territory.

---

## Claim 3 — NOTHING UNREACHABLE: **PASS** (first pass FAIL, re-checked after `47311538`)

### The lane weight menu: PASS (UI-193's escalation 2, verified fixed)

Console drawer at default height, 1280×720, lane selected. The menu opens **upward**
(rect top 485, bottom 600) and all four options sit inside the viewport with nothing clipped.
Escape closes it, focus returns to `[data-select="lane-weight"]`, the console stays open.
`shots/14-lane-weight-menu.png`.

### The release confirm (UI-195's control): PASS

`Confirm release` and `Keep the resident` both render at top 688 / bottom 709 inside a 720px
viewport, fully visible, with the drawer at its default height. `shots/15-release-confirm.png`.

### The designation popover: PASS — FAIL-1 cleared, see the re-check below

---

## Re-check — 2026-09-07, commit `47311538` on `phase-60-the-product-has-one-button`

Narrow scope: FAIL-1 only. Claims 1 and 2 were not re-tested and stand as recorded. Claim 4 was not
re-tested and stands at its recorded ratchet judgment. The commit message also states it added the
four missing primitive specimens to the mockup (finding 1b) and recorded the `className=""` buttons
as a documented bare contract (finding 1a) — **neither was verified in this pass**.

### How the re-check was rigged

| Step         | What was done                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Build        | `npm run build` — exit 0. Kit `dist/` rebuilt first; the falsification trap.                                |
| Workspace    | `corpus init ws2 --port 8793` from the built CLI. Real workspace, real git repository, real template.       |
| Server       | `corpus server start` — `corpus 0.35.0 listening on http://127.0.0.1:8793 (pid 54283)`, serving the built UI. |
| Seed         | 13 `agent-def` profiles under `.claude/agents/`, names up to 40 characters. Standalone threads, each `thread designate --agent … --weight …`. Roster grown and shrunk with `thread release` / `thread designate`. |
| Browser      | Real Chromium via Playwright, 1280×720 (also 1100×640, 1440×900, 1600×1000).                                |
| Port         | 8793 only. Port 8765 was never touched.                                                                     |

This closes the gap UI-192's own log declared: *"Not run: a `corpus init` workspace server (the
evaluator's 8791 rig)."* The rig was run here, and it agrees with the battery.

Probes and screenshots:
`/private/tmp/claude-501/-Users-theophanerupin-code-corpus/ff50cb74-5faf-42b9-ab2b-25c21287325d/scratchpad/`
(`probe.mjs`, `probe2.mjs`, `probe4.mjs`, `probe5.mjs`, `sweep.mjs`, `shots2/`).

### The small roster: the card fits whole

Composer → owner `no owner — the main agent` (the `at` pill leaves the row, `atPill: 0`) → open the
designation popover.

```
{"popRect":{"t":144,"b":274,"h":131},"panelRect":{"t":86,"b":280,"h":194},
 "scrollRegion":{"client":21,"scroll":21,"overflowing":"false"},"laneCount":3}
  DIV.kit-popover address-pop    overflow-y: auto    client 129  scroll 129  canScroll false
  DIV.search-panel compose-panel overflow-y: hidden  client 192  scroll 192
```

The card's bottom is **274** against the panel's **280**. It fits whole and it does not scroll.
The roster takes its own **21px** instead of the 120px token — this is the `min(content, token)`
floor, and it is what the first pass measured as the collision (`client 120` for content that
needed none). All three level rows sit at y 243–264, inside the panel and inside the viewport:

```
{"t":"Small and mechanical",   "rect":{"t":243,"b":264},"hit":"BUTTON.weight-opt","answersRow":true}
{"t":"Standard",               "rect":{"t":243,"b":264},"hit":"BUTTON.weight-opt","answersRow":true}
{"t":"Heavy or judgment-laden","rect":{"t":243,"b":264},"hit":"BUTTON.weight-opt","answersRow":true}

AFTER real mouse click at (653,254):
  {"popStillOpen":true,"composerStillOpen":true,
   "rows":[…,"Heavy or judgment-laden pressed=true"]}
```

`elementFromPoint` at each row's centre answers the row. A real `page.mouse.click` **chooses** the
level and leaves the popover open. `shots2/3lane-04-popover-open.png` shows the whole card — TO,
roster, statement, WEIGHT, three pills — inside the panel.

At 4 lanes the roster takes **47px** (two chip lines), the card still does not scroll, and all three
rows are directly reachable. The floor tracks content, not the token.

### The crowded roster: the card scrolls as one piece inside the fixed 192px panel

15 lanes, names up to 40 characters.

```
{"popRect":{"t":92,"b":274,"h":182},"panelRect":{"t":86,"b":280,"h":194},
 "popScrolls":"true","scrollRegion":{"client":120,"scroll":307,"overflowing":"true"},
 "affordance":"15 lanes · scroll for the rest","laneCount":15}
  DIV.kit-popover address-pop    overflow-y: auto    client 180  scroll 228  canScroll TRUE
  DIV.search-panel compose-panel overflow-y: hidden  client 192  scroll 192
```

The card fits its clip (92 → 274 inside 86 → 280) and holds **48px** of content below the fold. The
roster is capped at the 120px token and says so. Before any scroll the level rows lay out at y
292–313, past the panel's edge — the first pass's geometry — but now a real wheel moves the card:

```
scrolls BEFORE wheel: {"popScrollTop":0,  "weightHeading":{"t":272,"b":288}}
6 × page.mouse.wheel(0,120) at (645,262):
scrolls AFTER  wheel: {"popScrollTop":48, "weightHeading":{"t":224,"b":240}}

hit-test AFTER wheel:
{"t":"Small and mechanical",   "rect":{"t":244,"b":265},"hit":"BUTTON.weight-opt","answersRow":true}
{"t":"Standard",               "rect":{"t":244,"b":265},"hit":"BUTTON.weight-opt","answersRow":true}
{"t":"Heavy or judgment-laden","rect":{"t":244,"b":265},"hit":"BUTTON.weight-opt","answersRow":true}

AFTER real mouse click at (653,254):
  {"popStillOpen":true,"composerStillOpen":true,"Heavy or judgment-laden pressed=true"}
```

`shots2/crowded-05-after-wheel.png` shows WEIGHT and the three pills fully painted after the wheel.
The first pass's three probes — hit-test answers the scrim, the wheel moves nothing, a real click
dismisses — all now answer the other way.

### The choice is real, not decorative

The level chosen by mouse reaches the server. Composing after choosing `Small and mechanical` and
pressing **Ask** put this on the wire:

```
POST http://127.0.0.1:8793/api/threads
{"parent":null,"selector":null,"body":"what weight did this message carry?",
 "requestsAgent":true,"weight":"light","resident":null}
```

The trigger pill also updates: `agent will answer · Heavy or j…`.

### Every window size, every roster size

| Window    | Lanes | Card fits clip | Card scrolls | Rows reachable      | Real click chooses |
| --------- | ----- | -------------- | ------------ | ------------------- | ------------------ |
| 1100×640  | 15    | yes            | yes          | yes, after wheel    | Standard, pressed  |
| 1280×720  | 15    | yes            | yes          | yes, after wheel    | Standard, pressed  |
| 1440×900  | 15    | yes            | yes          | yes, after wheel    | Standard, pressed  |
| 1600×1000 | 15    | yes            | yes          | yes, after wheel    | Standard, pressed  |
| 1280×720  | 9     | yes            | yes          | yes, after wheel    | Standard, pressed  |
| 1280×720  | 6     | yes            | yes          | yes, after wheel    | Standard, pressed  |
| 1280×720  | 4     | yes            | **no**       | yes, **no scroll needed** | Standard, pressed |
| 1280×720  | 3     | yes            | **no**       | yes, **no scroll needed** | Heavy, pressed    |

The transition between "fits whole" and "scrolls as one piece" is clean at every size tested. The
first pass's finding that "the window size never helps" is no longer the case for reachability: the
card is bounded by the clip at every size and always reaches its rows.

### The exits survive the new scrolling state

| Path                                   | Result                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `Escape` on the scrolled card          | `{"pop":false,"composer":true,"active":"address-line\|BUTTON\|agent will answer · Heavy or j"}` |
| Scroll back up, real click on the `✕`  | `{"pop":false,"composer":true}`, focus back on the opener                |
| `✕` while scrolled to the bottom       | y 49–67, outside the panel's clip, `hitsSelf:false` — see OBS-B          |

An exit is available from every scroll position. Escape never closes the composer with it.

### The keyboard path is now better than "drags them into the clip"

Tab from the open popover walks the roster — every lane focused, inside the card, hit-testable —
then reaches the first level row, and **the card scrolls itself to bring it into view**:

```
{"cls":"recipient-opt","t":"reviewer",            "y":220,"popScrollTop":0, "inCard":true,"hitsSelf":true}
{"cls":"weight-opt",   "t":"Small and mechanical","y":244,"popScrollTop":48,"inCard":true,"hitsSelf":true}
Enter → {"popOpen":true,"rows":["Small and mechanical=true","Standard=false","Heavy or judgment-laden=false"]}
```

### No regression to the designating state

Owner left at `its own agent`, 14 lanes: card 92 → 273 inside the panel, `data-address-pop-scrolls`
**false**, the card does not scroll as one piece, the roster scrolls internally (120 / 205,
`data-overflowing="true"`, "14 lanes · scroll for the rest"), the `at` pill is present and there are
no weight rows. A real wheel over the roster moves it to `scrollTop 84` and the last lane hit-tests
to `BUTTON.recipient-opt`. Claim 2's geometry is unchanged.

### Recorded against this re-check — observations, not failures

**OBS-A — the card gives no visual cue that it scrolls.** In the crowded state the card holds 48px
below the fold and carries no affordance for it: `mask-image: none`, `::before` and `::after`
`content: none`, no gradient at the cut. The only scroll wording on the surface is
`"14 lanes · scroll for the rest"`, which names the **roster**, not the card. The card's last
visible line is the statement sentence (`"observability-… will answer — no listener yet"`), which
reads as a natural end. A mouse user who does not wheel over the card may not learn the WEIGHT
section exists. This does **not** fail the user's criterion — "visible or reachable by real wheel
scrolling" is met, and Tab reaches it with auto-scroll — but the reachable control is unannounced.

**OBS-B — the visible `✕` scrolls out of the clip.** With the card scrolled to its bottom the close
button sits at y 49–67, above the panel's top edge at 86, clipped and not hit-testable. Scrolling
back returns it and a real click on it works. Escape works from every scroll position, so an exit is
always available. Recorded because claim 2's first repair was "a visible exit"; in this one state it
is a scrollable-to exit rather than a visible one.

---

## Claim 4 — THE CHECK BITES: **PARTIAL**

### Where it bites

**A file no baseline entry names** (`apps/ui/src/shell/EvalProbe.tmp.tsx`, created and removed):

```
$ npx eslint apps/ui/src/shell/EvalProbe.tmp.tsx
  4:7  error  A raw <button> is not the product's button. Use Button, IconButton or Chip from
              @corpus/kit — one shape, one focus ring, one set of tokens (INFRA-040). …
  5:7  error  A raw <select> renders native chrome the product does not use. Use Select from
              @corpus/kit — the pill trigger with the custom menu (INFRA-040). …
  6:9  error  A raw <option> only exists inside a native dropdown. Pass the choices to Select
              from @corpus/kit as its `items` prop instead (INFRA-040). …
✖ 3 problems (3 errors, 0 warnings)
```

Three refusals, each naming the primitive. `<input>`, `<a>` and `<textarea>` are untouched.

**A migrated component file.** `export function EvalProbeTmp() { return <button type="button">press me</button>; }`
was appended to two real files and then restored byte-for-byte (`cmp -s` verified):

| File                                  | Result                                              |
| ------------------------------------- | --------------------------------------------------- |
| `apps/ui/src/compose/ComposeOverlay.tsx` | `592:10 error … Use Button, IconButton or Chip …` |
| `apps/ui/src/editor/FormatToolbar.tsx`   | `544:10 error … Use Button, IconButton or Chip …` |

**The tree as it stands**: `npm run lint` → `> eslint .` → **exit 0**, no output.

### Where it does not bite

The same snippet appended to `apps/ui/src/board/Column.tsx` produced **no error at all**.

The shipped check is a **ratchet**, not the exemption list the sprint contract described.
`scripts/raw-controls-baseline.json` carries, beside the 6-file `primitives` exemption, a
`baseline` of **38 grandfathered files** — 34 under `apps/ui/src`, 4 under `packages/kit/src` —
each keeping `["button"]`. Against 130 in-scope non-test `.tsx` files:

| Tag        | Files where a new raw tag fails lint |
| ---------- | ------------------------------------- |
| `<button>` | 86 of 130                             |
| `<select>` | 124 of 130                            |
| `<option>` | 124 of 130                            |

So the claim as stated — "add a raw `<button>` to **any** apps/ui component file and it fails" — is
false for 34 apps/ui files, among them `board/Column.tsx`, `board/ColumnHead.tsx`,
`console/Console.tsx`, `console/JobDetail.tsx`, `console/LaneScope.tsx`, `reader/ReaderHead.tsx`,
`thread/Turn.tsx`, `thread/ThreadCard.tsx`, `shell/Topbar.tsx`, `shell/Toasts.tsx`,
`menu/MenuItems.tsx`, `search/SearchResults.tsx` and `editor/SelectionToolbar.tsx`.

This is a **sanctioned** deviation: INFRA-040's Implementation Record calls it "the shape: a
ratchet, not an exemption list (orchestrator ruling)", and UI-191's Census discrepancy paragraph is
the reason it was taken. Sprint-026's TEST-1258 nonetheless said the config's path exemptions and
UI-191's recorded internals list "are identical". Only the 6-file `primitives` set satisfies that;
`baseline` sits beside it. The ratchet is real and has teeth in the direction it claims — the
entries may only shrink, and no file is grandfathered for `<select>` or `<option>`. But the user
should be told plainly that 34 apps/ui files still accept a new raw `<button>` silently.

---

## Failures

### FAIL-1: **CLEARED** by commit `47311538`, re-verified 2026-09-07 against a real workspace server

The report below is the first pass, kept verbatim for the record. Every one of its three probes now
answers the other way, at every window size and every roster size tested. See the re-check section
above for the evidence. **Original report follows.**

### FAIL-1 (original): The composer's designation popover hides its only weight editor behind a clip, with no way to scroll to it

**Claim**: 3 — "NOTHING UNREACHABLE … every menu and confirm you can open is fully visible or
scrollable — … the designation popover."
**Also bears on**: TEST-1268 ("nothing interactive clipped" over every registered overlay) and
UI-192's own decision record, which makes these rows the surface's sole weight editor in this
state.

**Expected**: with the Ask composer open and owner set to "no owner — the main agent", the
popover's `WEIGHT` rows are visible, or the surface scrolls to them.

**Observed**: the `WEIGHT` heading is sliced in half at the compose panel's bottom edge and its
three level buttons are **not painted at all**. They lay out at y 291–312. The clipping ancestor is
`div.search-panel.compose-panel` with `overflow: hidden`, bottom edge y **280**.

```
COMPOSER no-owner overflow chain
  DIV.kit-popover address-pop   overflow-y: visible  client 228  scroll 228  canScroll false
  DIV.composer-address          overflow-y: visible  client  21  scroll 116  canScroll true
  DIV.compose-settings          overflow-y: visible  client  29  scroll 124  canScroll true
  DIV.search-panel compose-panel overflow-y: HIDDEN  client 192  scroll 235  canScroll true
  DIV.overlay open              overflow-y: visible  client 720  scroll 720  canScroll false
```

Nothing a user can operate scrolls. A wheel over the region changes nothing. Hit-testing each row's
centre returns the scrim, not the row:

```
{"t":"Small and mechanical",   "rect":{"t":291,"b":312}, "reachable":false, "hit":"DIV.overlay open"}
{"t":"Standard",               "rect":{"t":291,"b":312}, "reachable":false, "hit":"DIV.overlay open"}
{"t":"Heavy or judgment-laden","rect":{"t":291,"b":312}, "reachable":false, "hit":"DIV.overlay open"}
```

A real pointer gesture at those coordinates dismisses the popover instead of choosing a level:

```
weight-opt classes BEFORE: ["weight-opt","weight-opt","weight-opt"]
AFTER real mouse click at (653,302): {"popStillOpen":false,"classes":[]}
```

**It is not a small-window case.** Reproduced identically at 1280×720, 1440×900 and 1600×1000 —
the compose panel is a fixed 192px box, so the window size never helps.

**It is not a crowded case either.** Reproduced with 12 lanes (`scroll-region` client 120,
content 179, overflowing) and again after releasing nine residents, with **3 lanes** and no
overflow at all (`client 120, content 120, data-overflowing false`, card bottom 321 vs panel
bottom 280). UI-193's `--min-usable-height: 120px` clamp keeps the roster at 120px whether it
needs the room or not, which is what pushes the card past the panel that clips it. The primitive's
guarantee and the panel's fixed height collide, and nothing in the batch caught the collision.

**Consequence**: in the Ask/Capture composer's "no owner" state, the message weight cannot be set
with a mouse. `Tab` does reach the rows — focus drags them into the clip as the roster scrolls —
so the control exists and is keyboard-operable. It is simply invisible and unclickable.

**Steps to reproduce**:

1. `corpus init ws --port 8791 && corpus server start`, open `http://127.0.0.1:8791/` at 1280×720.
2. Press the topbar's `＋ Ask / Capture`.
3. Open the `owner` pill and choose **"no owner — the main agent"**.
4. Press the `agent will answer ▾` pill to open the designation popover.
5. Read the bottom edge of the card: `WEIGHT` is cut in half and no level row is drawn.
6. Click where "Heavy or judgment-laden" is laid out (x≈653, y≈302). The popover closes; no level
   is chosen.
7. Wheel over the same point. Nothing moves.

Evidence: `shots/19-noowner-popover.png`, `shots/21-noowner-final.png`,
`shots/25-composer-noowner-after-wheel.png`, `shots/35-small-roster-noowner.png` (the 3-lane case).

**Why no check saw it**: UI-193's battery opens `designation-popover` in the designating state
only, where the card is 181px and fits inside the 192px panel. The state UI-192 created — the one
where the popover becomes the weight editor — is not in the registry's fixture.

---

## Summary — after the 2026-09-07 re-check

**3 of 4 claims pass, 1 partial, none fail.**

Claim 3's FAIL-1 is closed. Against a real `corpus init` workspace on port 8793, serving the built
UI, in real Chromium: the small-roster card fits the 192px panel whole and its three level rows are
directly clickable, and the crowded card scrolls as one piece inside that same panel so a real wheel
brings the rows in — after which `elementFromPoint` at each row's centre answers the row and a real
mouse click chooses the level rather than dismissing the popover. The chosen level reaches the wire
as `"weight":"light"`. This holds at 1100×640, 1280×720, 1440×900 and 1600×1000, and at 3, 4, 6, 9
and 15 lanes. Escape and the `✕` both still exit, the keyboard now scrolls the card to the rows on
its own, and the ordinary designating state is unchanged.

Two things are recorded rather than failed against the repair: the card gives no visual cue that it
scrolls (OBS-A), and the `✕` scrolls out of the clip while the card is at its bottom (OBS-B).

Claim 4 stands where the first pass left it — a sanctioned ratchet, honestly documented, reaching
less than the claim's wording. That is a scope question for the orchestrator and the user, not a
defect to fix.

**The first pass's summary follows, unchanged.**

---

**First pass: 2 of 4 claims pass, 1 partial, 1 fails.**

The component language landed and it landed well. Native `<select>` chrome is gone from every
surface reachable in the running product, in both themes; the editor toolbar and the composer row
speak the mockup's pill language; Ask and Capture measure identical to `design/index.html`; the
designation popover gained a real ✕, a real Escape with focus return, an outside-click exit, a
roster that is 120px instead of 25px and says how much it is hiding, and exactly one editor per
meaning in each state. The lane-weight menu now flips upward instead of dying under the drawer,
and the release confirm fits. The ESLint rule fires with messages that name the primitive, and the
tree lints clean.

Two things stop this being done.

**The phase reintroduced its own defect class in the one surface it rebuilt.** In the global
composer's "no owner" state, the designation popover's three weight rows — the only weight editor
that state has — are painted nowhere and cannot be pressed, at every window size and at every
roster size. That is not a regression at the margin: it is the reported defect, in the file the
sprint existed to fix, on a path a user reaches in three clicks from a fresh workspace.

**The static check reaches less than the claim says.** It bites in 86 of 130 in-scope files for
`<button>`; 34 apps/ui files still take a new raw one in silence. The ratchet is a defensible
engineering answer to UI-191's census, and it is honestly documented in INFRA-040 — but sprint-026
Seam 2's own honesty clause applies to it: a check must not be described as catching more than it
catches.

Two further items are recorded rather than failed: the console pane's buttons and the toolbar's
icon buttons render with no kit class or token (1a), and four of the seven primitives named in
Seam 1 have no specimen in `design/index.html` (1b), which is the reason 1a has no reference that
can settle it.

**Next**: UI-192's lane owns FAIL-1. UI-193's lane owns the registry gap that let it through — the
battery must open `designation-popover` in the "no owner" state. INFRA-040 owns nothing here; its
gap is a scope question for the orchestrator and the user, not a defect.

---

## Re-check disposition (2026-09-07)

- **FAIL-1 — closed.** Fixed by `47311538`, verified against a real workspace server. Nothing left
  for UI-192's lane on this defect.
- **The registry gap — closed by the same commit's own account**, not re-audited here: it states the
  registry now requires a `furtherStates` declaration per entry, that `designation-popover` declares
  `no-owner`, and that the battery runs 51/51 including the evaluator's exact probe. This pass
  verified the **product behaviour** the battery is meant to guard, not the battery itself.
- **Claim 4 — open as a scope question** for the orchestrator and the user. Unchanged.
- **1a and 1b** — the commit claims both are addressed. **Not verified in this pass.**
- **OBS-A and OBS-B** — new, minor, recorded above. Neither fails a stated criterion. OBS-A is the
  one worth a decision: the only weight editor in this state is reachable but unannounced when the
  roster is crowded.
