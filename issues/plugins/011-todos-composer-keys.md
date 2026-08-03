# [PLUGINS-011] Todos item composer adopts the composer key contract

## Domain
plugins

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: SHARED-009 (Amendment 1), UI-052 (sets the contract and, if it
  extracts a shared helper, the thing to reuse)
- Blocks: —

## Spec References
- SPEC.md §11 Global composer, as replaced by SHARED-009 Amendment 1: the
  contract binds "any composer a plugin contributes"

## Summary
`plugins/todos/ui/TodoItemComposer.tsx` sends on `↵` with `⇧↵` for a newline and
an IME guard — correct under the old convention, wrong under the new one. The
signed contract is `↵` newline, `⌘↵` send, and it explicitly covers plugin
composers, so the reference plugin has to demonstrate it rather than diverge.

Watch for the same thing in any other plugin surface that takes text.

## Acceptance Criteria
- [x] `↵` inserts a newline in the todos item composer; `⌘↵` submits
- [x] The submit control names its key (`Comment ⌘↵`)
- [x] IME composition commit still never submits
- [x] Dismissal (`useDismissable`: escape ordering + outside click) unchanged —
      but see UI-048 item 3, which questions whether outside-click should discard
      a non-empty draft; if UI-048 lands first, follow its resolution
- [x] If UI-052 extracts a shared key-handling helper, use it rather than
      re-implementing — but only through a path the plugin boundary allows
      (`@corpus/kit*` / `@corpus/contract` only; never `apps/ui`). If the helper
      is not reachable from a plugin, say so — that is a kit-gap note for UI-045.
- [x] Existing `TodoItemComposer.test.tsx` key assertions updated, not deleted

## Technical Design
### Files to Create/Modify
- `plugins/todos/ui/TodoItemComposer.tsx` + tests

## Testing Strategy
Component tests for `↵`, `⌘↵`, IME commit. E2E in `todos-menu.spec.ts` for the
real composer path.

## E2E Verification Log

**Model: opus** (claude-opus-5, 1M context), plugins-dev, 2026-08-03.

### Real-app drill — real server, real workspace, real keys

Not a bug, so nothing to reproduce first; the drill below is the proof of the
new binding. Recipe per the domain's real-app recipe: `corpus init
/tmp/plugins011-ws` (server on **8766** — never 8765, the user's live server),
fixture `data/docs/inbox/chores.md` (`type: todo`, three items) and a
`column: todos/todos` view written straight to disk, `corpus server start`,
then `vite --port 5986 --strictPort` from `apps/ui` with the workspace token,
driven by a scratch `@playwright/test` chromium script (removed afterwards).
Real React, real plugin manifest, real `/api/x/todos/lists`, real `POST
/api/threads`, real file writes — nothing stubbed.

```
STEP 1 — todos column rendered: 2 rows
STEP 2 — composer open on: “Call the plumber”
STEP 3 — submit control label: Comment ⌘↵
STEP 4 — after two ↵ the field holds: "which plumber\n\nwas it?"
STEP 4 — composer still open: true
STEP 5 — field height grew 38px -> 56px
STEP 6 — after an IME ⌘↵ commit, composer still open: 1
STEP 7 — ⌘↵ posted: {"parent":"doc_chores","selector":{"exact":"Call the
         plumber","prefix":" the passport appointment\n- [ ] ","suffix":"\n"},
         "body":"which plumber\n\nwas it?","requestsAgent":true}
STEP 7 — reader opened on: doc_chores
STEP 7 — composer closed: true
```

Steps 4 and 7 are the acceptance criteria in one keystroke sequence: two real
`Enter` presses put two real newlines in the field and posted nothing, and the
`Meta+Enter` that followed posted the multi-line body. Step 6 fired the IME
shape (`keydown` `Enter` + `metaKey` + `isComposing`) at the live field and the
composer stayed open with nothing posted. Step 5 is the growing field — the
textarea measured 38px on one line and 56px on three, in a real browser doing
real layout.

The thread it produced, read off disk after the run:

```
data/threads/th_cwft5jue.md
  parent: doc_chores        anchor: anc_f71c921d      agent: requested
  ## user · 2026-08-03T17:26:25Z
  which plumber
  <blank>
  was it?
```

The newlines `↵` inserted survived all the way to the file — the sole reason
the re-bind matters. `data/docs/inbox/chores.md` gained the matching
`anchors.anc_f71c921d` entry, so this is still the ordinary §6 thread, not a
shape of the plugin's own. Server stopped, Vite killed, workspace and scratch
script removed; 5986 and 8766 verified free.

### Was the kit helper cleanly consumable from a plugin? **Yes.**

`import { COMPOSER_PRIMARY_KEY, handleComposerKeyDown } from "@corpus/kit"` —
one import, no subpath, no gap, nothing copied. UI-052 put it in the kit
deliberately and the placement holds up: this composer's entire key handler is
now one call, the button's chord is the kit's constant rather than a glyph the
plugin spells itself, and `plugins/todos/imports.test.ts` (the boundary test)
passes unchanged. **No kit-gap note for UI-045 from this issue.**

Two things the kit still does not publish, neither of them blocking here and
both already on record: a composer *component* (this file remains a structural
copy of `CommentPopover` around the kit's keys), and an escape-layer seam —
`plugins/todos/ui/dismiss.ts` is still the workaround, which is UI-045 item 3.
Because `useDismissable` answers Escape on `window` in the capture phase, the
call deliberately passes **no** `onEscape`; the key never reaches the field's
React handler at all, and dismissal is byte-for-byte unchanged.

### On UI-048 item 3 (outside click discarding a non-empty draft)

Untouched, as instructed. For the record, the plugin's view: this composer has
the same hazard as core's — a `mousedown` anywhere outside throws away a typed
draft with no confirmation, and it is worse here than in a menu because `↵` now
*encourages* longer drafts. Whatever UI-048 resolves for `CommentPopover`,
`plugins/todos/ui/dismiss.ts` should follow in the same change, since it exists
only to imitate core's dismissal.

### Gates

- `vitest run plugins/todos` — **15 files, 372 tests passed**
  (`TodoItemComposer.test.tsx` 11 → **14**).
- `playwright test e2e/todos-menu.spec.ts` on `CORPUS_UI_PORT=5986` — **8
  passed, 0 failed** (real Vite dev server).
- `eslint --max-warnings 0` on the four touched TS files — clean.
- `prettier --check` on the five touched files — clean.
- `tsc --noEmit` in `plugins/todos` and in `apps/ui` — clean.
- Repo-wide suite deliberately not run (machine-load discipline); harvest gate
  is the orchestrator's.

### Files touched outside `plugins/`

`apps/ui/e2e/todos-menu.spec.ts`, one line: the `Comment ↵` locator became
`Comment ⌘↵`. Nothing else in that file was changed.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
