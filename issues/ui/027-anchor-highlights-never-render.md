# [UI-027] Anchored text is never highlighted in the document body

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-008
- Blocks: —

## Spec References
- SPEC.md §11 document view: "threads sit Docs-style in the right margin, aligned to their anchors with connectors", "Clicking an anchored highlight opens its thread"; §6 anchors

## Summary
Evaluator finding (2026-07-30, UI-024 eval LEDGER-1 — pre-existing, reproduced on the
untouched floating-toolbar path too): after commenting on a selection, **no
`.anchor-hl` ever renders** — column reader, focus mode, and after a full reload with
two anchors verifiably on disk. The DOM carries only the empty margin container; the
`.anchor-hl` CSS ships unused (evidence: DOM dump grep — 0 markup hits, style-block
hits only). Two §11 behaviors are therefore unreachable: clicking a highlight to open
its thread, and margin cards aligned to anchors with connectors. Diagnose where the
anchor layer loses the ranges (anchors arrive in `GET /api/docs/:id`; the layer
resolves selectors to editor ranges) and make highlights + click-through + margin
alignment real in both hosts. The evaluator's rig steps are the reproduction recipe.

## Acceptance Criteria
- [x] Commenting paints the highlight over the anchored words in both hosts, immediately and after reload
- [x] Clicking a highlight opens/expands its thread (§11)
- [x] Margin cards (focus/wide) align to their anchors; narrow columns keep chips at the anchor
- [x] Orphaned anchors (§6) render per spec (no phantom highlight)
- [x] e2e coverage for highlight presence — the gap that let this ship silently

## Technical Design
### Files to Create/Modify
- `apps/ui/src/anchors/` layer (diagnose first — resolution vs decoration); DocView/margin wiring; e2e spec

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4); e2e assertion on `.anchor-hl` in the hermetic suite (stub carries anchors in the doc payload).

## E2E Verification Plan
Real app: comment via toolbar and via context menu; highlight visible, clickable, survives reload; margin alignment in focus mode.

## E2E Verification Log

**Model: opus** — Opus 5 (`claude-opus-5[1m]`), ui-dev, 2026-07-31.

### Rig

Real app, no stubs anywhere in sections 1–4. Workspace
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s018-ui/ui-027-rig/ws` (`corpus init --port 8795`),
server `127.0.0.1:8795` (pid 75139, started from `apps/cli/src/bin/corpus.ts` via tsx),
Vite dev `:5275` (pid 75955, `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8795`,
`VITE_CORPUS_TOKEN=…`), Playwright Chromium 1600×1000. Port 8765 never touched.

Two documents, deliberately differing in **one byte**:

| doc | created with | last byte of body |
| --- | --- | --- |
| `doc_244cgfun` "Mortgage options" | `corpus doc create --file` (file ended in `\n`) | `0a` |
| `doc_7tfxto7w` "Rates memo" | `POST /api/docs` with a body ending in `.` | `2e` |

Both then got a real anchored thread through `POST /api/threads`
(`anc_7ecbb215`/`th_p2gqales`, `anc_c2a82035`/`th_55y3cyim`), both written into the parent's
frontmatter on disk and resolved by the server:

```
GET /api/docs/doc_7tfxto7w →
  "anchors":[{"anchorId":"anc_c2a82035", …,"range":{"start":17,"end":31},"orphaned":false}]
```

### 1 — Reproduction (pre-fix)

The evaluator's LEDGER-1 reproduced *conditionally*, which is what named the cause. Opening
each document in the column reader and in focus mode, counting DOM nodes:

| doc | body's last byte | `.anchor-hl` | `.anchor-pip` | `.anchor-slot` | `.focus-margin` |
| --- | --- | --- | --- | --- | --- |
| Mortgage options | `\n` | **1** | 1 | 1 | 1 (card aligned) |
| Rates memo | `.` | **0** | 0 | 0 | 1 (empty container) |

The failing document's focus body innerHTML was exactly what LEDGER-1 recorded — plain
`<p>Short memo about lender spreads and the shape of the yield curve.</p>`, with the empty
`.focus-margin` the only anchor-ish node in the overlay. The anchor was in the payload with a
non-null `range` the whole time.

**Root cause.** `offsetsComparable(body, canonical)` (`apps/ui/src/anchors/anchorPlacement.ts`)
short-circuited on `body.length !== canonical.length`. The trace's canonical spelling comes from
`serializeDoc`, whose `normalizeBody` ends every document with exactly one `\n`; the server
stores and returns the body it was handed, so a document created without a trailing newline is
one character shorter than its own canonical form — for ever. `placeAnchors` therefore gave
every anchor `segments: []`, the decoration plugin drew nothing, `measureMargin` found no
`.anchor-hl`/`.anchor-pip` to measure and reported `anchorTop: null`, and the cascade stacked the
cards at 0. Nothing downstream was broken: the ranges were lost at the very first gate. Confirmed
in isolation before touching the app — `offsetsComparable("…curve.", "…curve.\n")` → `false`,
`offsetsComparable("…curve.\n", "…curve.\n")` → `true`.

The trailing newline moves **no** offset: every character of the body keeps its index in the
canonical form. So the fix judges both sides by the serializer's own tail convention
(`normalizeBody` on each) and applies the unchanged line-shape check to what is left — a setext
heading, an indented code block or any other reshaping construct is still refused.

### 2 — After the fix, same rig, same documents

| check | Rates memo (`.`) | Mortgage options (`\n`) |
| --- | --- | --- |
| `.reader .anchor-hl` on fresh load | 1, text `lender spreads`, `data-thread=th_55y3cyim`, `data-anchor=anc_c2a82035` | 1, text `a 30-year fixed at 6.1 percent` |
| computed style | `background rgba(59,95,151,0.1)`, `border-bottom-width 2px` | same |
| `.anchor-pip` | `1` | `1` |
| chip at the anchor (narrow column) | 1 × `.anchor-slot .t-chip`, `.with-margin` = 0 | same |

**Clicking the highlight opens its thread** (§11): `.thread-slot.expanded` 0 → 1,
`data-slot-thread="th_55y3cyim"`, card reading
`💬 1 · user "lender spreads" … Which lenders?`.

**Focus mode margin** (`f`): `.with-margin` = 1, one `.focus-margin > .thread-card`, and the
alignment measured against the live geometry —

```
thread th_55y3cyim   anchorTop 85   cardTop 85   inline style top: 85px
connector (::before) width 23px  height 1px  background rgb(207,204,194)
```

The connector is the stylesheet hairline `design/index.html` draws, not an `svg`/`canvas` — which
is why the evaluator's `svg|canvas` probe found none even where one was correct. Chips are hidden
in margin mode (`.anchor-slot .t-chip` present but `display: none`), so the card never doubles.

### 3 — Commenting through the UI, then reloading

Column reader on `doc_244cgfun`, real selection over `15-year fixed` in the second paragraph,
floating toolbar 💬 → composer → "Which lender quoted the 15-year?" → send:

```
before comment      [ "a 30-year fixed at 6.1 percent" (th_p2gqales) ]
immediately after   [ "a 30-year fixed at 6.1 percent", "15-year fixed" (th_4l4ovgok/anc_028f4b90) ]
after full reload   [ "a 30-year fixed at 6.1 percent", "15-year fixed" ]
```

`data/docs/inbox/mortgage-options.md` gained the second §6 selector in its frontmatter
(`exact: 15-year fixed`, with prefix/suffix), so the reload is reading the anchor off disk.

### 4 — Orphaned anchors (§6)

`PUT /api/docs/doc_7tfxto7w` replacing `lender spreads` with `pricing`; the server answered
`{"anchors":{"remapped":[],"orphaned":["anc_c2a82035"]}}` with the `orphaned_anchor` warning.
In the reader: `.anchor-hl` 0, `.anchor-pip` 0, `.anchor-slot` 0, body innerHTML plain — **no
phantom highlight** — and the thread is listed under `[data-thread-section="detached"]` with its
chip, still fully usable.

### 5 — The gap that let this ship, closed

New hermetic spec `apps/ui/e2e/anchor-layer.spec.ts` (6 tests) opens documents that **arrive**
with anchors rather than creating them — `stubCorpus` grew a `StubRow.anchors` seed for exactly
this, since the stub pushes no SSE `invalidate` (the limitation UI-024's log recorded). The
seeded body deliberately ends without a newline.

Pre-fix / post-fix, `CORPUS_UI_PORT=5276 playwright test e2e/anchor-layer.spec.ts e2e/context-menu.spec.ts`:

```
pre-fix   8 failed, 18 passed   (5 of the 6 anchor-layer tests + UI-028's 3)
post-fix  26 passed
```

The one anchor-layer test that passes either way is the orphan case — correctly, since an orphan
has no highlight under either spelling.

### 6 — Gates

- `vitest run apps/ui/src` → **104 files, 1555 tests, all passing** (`anchorPlacement.test.ts` 18, +5 new for the tail rule).
- `tsc --noEmit -p apps/ui/tsconfig.json` → clean. `eslint apps/ui/src apps/ui/e2e` → clean. `prettier --check` → clean.
- Full `playwright test` (147 tests): 146 passed, 2 failed — `smoke.spec.ts` "a failing health check…" and `console.spec.ts` "keeps the failed-job count off the health notice's class". Both assert `.console-strip .c-failed` reads `server unreachable`, which requires nothing listening on `127.0.0.1:8765`; another agent's server (pid 15627) holds that port in this tree. Environmental, unrelated to this change, and not touched per the session's port rule.

### Observation (not fixed here)

`MARGIN_MIN_WIDTH` is 1100 while `MAX_COLUMN_WIDTH` is 960, so an in-column reader can never
reach margin mode: "wide" is focus mode only today, and `.reader-scroll.with-margin` in
`anchors.css` is unreachable in practice. Left alone — changing either number is a UX decision
beyond this issue.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
