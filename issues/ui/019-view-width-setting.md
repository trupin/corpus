# [UI-019] Wider views: user-adjustable view/column width

## Domain
ui

## Status
in_progress

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-003 (board columns)
- Blocks: —

## Spec References
- SPEC.md §11 — "Columns are pinned view documents" bullet, amended and signed off 2026-07-30 (SHARED-004): per-view edge-drag resize (console-height pattern), width stored in the view doc's frontmatter like `order` (synced, idle-squashed auto-commit, agent-stewardable, server stays sole writer), snap scrolling unchanged, **no settings panel introduced**.

## Summary
User request (2026-07-29, follow-up phase after PR #11): views are too narrow, and the
user looked for "a settings panel somewhere" to widen them — there isn't one. Make view
width user-adjustable. Design questions for the spec pass: per-view drag-to-resize vs.
a global width setting (or both); where the preference lives (no settings surface
exists today — localStorage vs. a workspace config the server owns; note the
server-sole-writer rule if it's file-backed); and whether this seeds a general settings
panel or stays a minimal affordance.

## Acceptance Criteria
- [x] spec-writer amends SPEC.md with the chosen mechanism (user-signed-off)
- [x] User can make views wider through a discoverable UI affordance
- [x] The width choice persists across reloads
- [x] Layout degrades sanely on narrow windows (existing responsive behavior preserved)

## Technical Design

### Files to Create/Modify
- apps/ui board/column layout components; persistence per spec decision

### Key Implementation Details
To be refined after the spec amendment.

### Edge Cases
- Many columns × wide setting → horizontal scroll behavior.
- Plugin-provided views (todos column) should honor the same width mechanism.

## Testing Strategy
Vitest for persistence logic; Playwright for resize + reload persistence.

## E2E Verification Plan

### Verification Steps
1. Real app: widen a view, reload, width persists; narrow window still usable

## E2E Verification Log

**implemented on: opus** (issue recommendation: opus).

### Contract: a no-op, as adjudicated (TEST-466 / Adjudication 22)

`git diff packages/contract` is **empty**. The width rides on the existing `extra`
passthrough: `PUT /api/docs/{id}` with `{ extra: { width } }`, merged per RFC 7386, on the
same `useUpdateDocById` path `order` already uses. Verified end to end below — `width`
lands beside `pinned`, `order` and `query` and displaces none of them.

### The real app, real server, real files

Workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-ui019-UwmjLW`, created from
a cwd **outside** this repository, server on `9191`, Vite on `5292`.

**Proxy target proved (Adjudication 2):**

```
proxied /api/health via the Vite dev port 5292 ->
  status   : ok
  workspace: /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-ui019-UwmjLW
$ lsof -nP -iTCP:8765 -sTCP:LISTEN   ->   (nothing bound on 8765)
```

**The drill** (real Chromium, real pointer drags, `drill-ui019.mjs`, 1600×900):

```
== 1. the shipped default ==            width: 336px
== 2. three drags in under 30 s ==
  after drag 1: 456px
  after drag 2: 546px
  after drag 3: 486px
  elapsed ms: 2485
== 3. reload — the width comes from the view document ==   width after reload: 486px
== 4. a second browser context sees it too ==              width: 486px
== 5. opening a document widens relative to the base ==    (see below)
== 6. bounds: drag far past both extremes ==
  after dragging way left:  240px      (MIN_COLUMN_WIDTH)
  after dragging way right: 960px      (MAX_COLUMN_WIDTH)
  snap alignment still: start
== 7. no settings surface anywhere ==   buttons matching /settings/i: 0
```

**The write reached the view document's frontmatter, and clobbered nothing** (TEST-446/447):

```
$ sed -n '1,16p' data/docs/views/inbox.md
---
id: doc_seedinbox
type: view
title: Inbox
...
evergreen: true
pinned: true
order: 2
query:
  folder: inbox
width: 300
---
```

**One history entry, not fifty** (TEST-448). Five completed drags plus one out-of-band
`PUT`, all inside the 30 s idle window, folded into a single commit:

```
$ git log --oneline
8cc122e doc edit: Inbox (doc_seedinbox) by user
174adb2 doc create: Mortgage options (doc_ep7wz7t3) by user
c575e93 workspace: initialize corpus workspace by user

$ git log --format='%s' | grep -c 'Inbox (doc_seedinbox)'
1
$ corpus db doctor  ->  projection is clean — 9 documents from 9 files (1ms)
```

**Reader-open widening is relative** (TEST-450), measured after `.col`'s 0.25 s width
transition settles:

```
  base width: 300px
  reading width (after the 0.25s transition): 500px      # 300 × (560/336), not a fixed 560
```

A column left at the default still lands on exactly `560` — `READING_WIDTH_RATIO` is
`560/336`, so the shipped constants are reproduced rather than replaced.

### TEST-455 — the agent-stewardability gap, recorded (Adjudication 23)

`SPEC.md:377` promises "@agent make the finance column wider" just works. **It does not
today, and closing it is out of this issue's scope** (`apps/ui`). Checked against the
shipped CLI in the drill workspace:

- `corpus doc edit --help` offers `--title`, `--add-tag`, `--remove-tag`, `--status`,
  `--due`, `--reviewed`, `--evergreen`, `-m/--file` — and **no way to write an arbitrary
  `extra` frontmatter key**.
- `grep -n 'extra' docs/cli.md` finds no `--extra` (or equivalent) on any verb; `extra` only
  ever appears in *read* output (`doc list --json`, `doc show --json`).
- The agent is CLI-only (SPEC.md §7), so with no such flag it cannot set `extra.width` at
  all — the promise is unreachable from the agent side.

**Finding for a follow-up issue** (CLI, and possibly CONTRACT if a narrower verb is
preferred over a general one): *give the CLI a way to write an arbitrary `extra`
frontmatter key on a document* — e.g. `corpus doc edit <id> --extra width=520` or a
`corpus doc set` verb — so §11's stewardability sentence becomes true. Nothing in `apps/ui`
blocks it: the UI already reads `extra.width` from the projection row, so an agent write
would appear on the board over SSE with no further change.

### Playwright, scoped, once

`apps/ui/e2e/column-width.spec.ts` (8 tests): a real pointer drag writing one `PUT` with
only `{extra:{width}}`, the RFC 7386 merge leaving `pinned`/`order`/`query` and a foreign
`extra` key alone, the width surviving a reload from the document (not from storage), the
relative reader widening, nonsense stored values falling back to the default, snap scrolling
and the ghost column unchanged, and no settings panel. Ran once with the other two specs:
**20 passed (15.9s)**.

### Unit tests

`apps/ui/src/board/columnWidth.test.ts` (the stored-value parser's every degradation, the
viewport-recomputed clamp, the reading ratio) and `apps/ui/src/board/useColumnWidth.test.tsx`
(the drag through the real `Board`: one write on release, none for a drag that ends where it
started, the minimum clamp, keyboard resizing, the relative widening, the ARIA bounds).
Whole workspace: **98 files, 1446 tests, all passing.** No new coverage exemption.

### Scope

`apps/ui` only. `SPEC.md` and `packages/contract` untouched. Plugin columns honour the same
mechanism by construction (TEST-453) — the width path lives in `Column`, above the
core/plugin body dispatch, and is conditioned on nothing about the column's type.

### Shipped spec pin reconciled to the amended §11

`apps/ui/e2e/reader.spec.ts`'s "gives the column reader the prototype's measure" read the
560 px straight out of `.col.reading`. UI-019 deleted that constant on purpose — the
reader-open width is now a ratio over the column's own base — so the assertion was pinning
a rule the stylesheet no longer states. It has been split into the two things that are now
true, neither of them weaker than what it replaced:

- the **stylesheet** half asserts `.col` is still the prototype's `336px` and that the
  `width` transition (`0.25s`) survives on `.col.reading`;
- a **new running-board** test asserts that a column with no chosen width opens to exactly
  `560px` — the prototype measure, pinned where it now actually lives, over `stubCorpus`.

Caught by the full e2e suite, which a scoped run of the three new specs could not see.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[ISSUE-ID]` prefix
