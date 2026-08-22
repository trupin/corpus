# [UI-070] Attachments in every composer, through one kit surface

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-012
- Blocks: PLUGINS-012

## Spec References
- SPEC.md §10 as replaced by SHARED-012; §6 attachments (picker/paste/drag-drop,
  chip previews, the size cap and its 413)

## Summary
Three of five composers cannot take a file: `CommentPopover` (a comment on a
document selection), `NewChildThread` (a comment on a turn), and the todos
plugin's item composer. The other two can. The transport is already there on
both paths — multipart `POST /api/threads` and turn attachments — as are the
reusable pieces: `apps/ui/src/thread/useAttachmentIntake.ts` and
`PendingAttachments.tsx`.

So this is a placement problem, not a capability one, and it is the same shape
SHARED-009's key contract had: something true of two composers because each was
written on its own. That was fixed by moving the rule into the kit, and
PLUGINS-011 then consumed it with one import and no copy. Aim for the same
outcome here — **PLUGINS-012 should need no new kit export of its own.**

## Acceptance Criteria
- [x] A file can be attached by **picker, paste and drag-and-drop** in every
      composer in `apps/ui`, and appears as a chip preview before sending (§6)
      — done by UI-111 for the three that could not; unchanged here beyond
      re-pointing all four at the kit's copy
- [x] The intake and the chip strip are published from `@corpus/kit`, reachable
      by a plugin — verified by PLUGINS-012 consuming them without a copy
      (published here; consumability proved with a throwaway probe inside the
      plugin tree — see the log. PLUGINS-012 remains the consumer)
- [x] A comment that **starts a thread** sends multipart `POST /api/threads`; a
      comment that **replies** sends the turn-attachment call. Both already
      exist; no third path is invented — no transport was touched by this issue
- [x] An over-cap file is refused visibly, with the reason, on every surface —
      the 413 is contracted (CONTRACT-009) and a silently dropped file is worse
      than no attachments at all — unchanged; documented as the consumer's
      obligation in the kit README, since the intake deliberately holds no cap
- [x] Removing a pending attachment before sending works everywhere
- [x] Sending with attachments and sending without both still work, and the
      composer key contract (`↵` newline, `⌘↵` send) is unchanged
- [x] `CommentPopover` still reads as a popover with two files attached — check
      against `design/index.html` and say what it should look like; a popover
      that becomes a panel is a different component — the `.pending-atts:empty`
      collapse that makes this true is now pinned by an e2e measurement
- [x] Paste does not fight the clipboard work: pasting **text** into a composer
      still inserts text, and pasting an image attaches it. UI-042 made paste
      rich in the editor; these are plain-text fields and must not regress
- [ ] Attachments reach disk under the thread they belong to, verified against a
      real server rather than a stub — **not re-verified here**: `apps/server`
      does not currently parse on this branch (see the log), and this issue
      changed no transport. UI-111's log carries the on-disk evidence

## Technical Design
### Files to Create/Modify
- `packages/kit` — promote the intake hook and the pending-chip component
- `apps/ui/src/anchors/CommentPopover.tsx`, `apps/ui/src/thread/NewChildThread.tsx`
- `apps/ui/src/thread/` — the existing users become consumers of the kit copy
  rather than keeping their own
- `packages/kit/src/index.test.ts` — `RUNTIME_SURFACE`
- tests alongside

### Notes
- `NewChildThread.tsx` currently documents the absence ("deliberately not a
  second composer: it carries no attachments"). That comment is now wrong and
  must go with the change, not survive it.
- Watch the interaction with UI-067 (the always-available comment section), which
  adds a composer and per-thread replies. If both land in the same phase, they
  should agree about which component they are composing with rather than each
  growing an attachment strip.

## Testing Strategy
Component tests per composer for the three intake routes and the refusal path;
e2e against a real server attaching a file to a document-selection comment and
asserting the bytes land under the created thread.

## E2E Verification Log

**Model: opus** (claude-opus-5, 1M context). Date: 2026-08-16.

### What this issue turned out to be

UI-111 landed the behavioural half — the three `apps/ui` composers that could
not take a file now can, by all three §6 routes — and deliberately left the kit
surface. So this issue is the **publication**, and its acceptance test is not "a
file can be attached" (UI-111 proved that on disk) but "a plugin can obtain the
capability by importing".

Published from `@corpus/kit`, under `src/components/Composer/` beside
`composerKeys.ts`, which settled the same argument the same way:

| Export | Was | Now |
| --- | --- | --- |
| `useAttachmentIntake`, `releaseAttachments`, `PendingAttachment`, `AttachmentIntake` | `apps/ui/src/thread/useAttachmentIntake.ts` | `@corpus/kit` |
| `PendingAttachments` | `apps/ui/src/thread/PendingAttachments.tsx` | `@corpus/kit` |
| `AttachButton` | `apps/ui/src/thread/AttachButton.tsx` (extracted by UI-111 for exactly this) | `@corpus/kit` |
| `.pending-atts` / `.att-chip` / `.clip` | `apps/ui/src/thread/thread.css` | `@corpus/kit/composer.css` |

The four `apps/ui` composers (`ComposeOverlay`, `ThreadComposer`,
`CommentPopover`, `NewChildThread`) and the two owners that free taken snapshots
(`useAnchorLayer`, `useTurnComments`) now import the kit's copy. **Nothing was
left behind in `apps/ui` — the three modules were deleted, not re-exported**, so
there is one implementation and the app is its first consumer rather than its
owner. `restore-on-failure` (`take` / `restore` / `release`) crossed unchanged;
UI-111's popover still gets its attachments back on a refusal.

### Consumability, proved from inside the plugin boundary

A throwaway `plugins/todos/ui/ui070Probe.tsx` — the whole trio wired as a
composer wires it — was written, checked, and deleted (PLUGINS-012 is the real
consumer and is not implemented here):

- `tsc --noEmit -p plugins/todos` → clean. The four code exports resolve through
  the plugin's own tsconfig with no path mapping and no `apps/ui` reach.
- `plugins/todos/imports.test.ts` → **47 passed, unchanged**. The boundary holds
  for the code exports.
- With `import "@corpus/kit/composer.css"` added, that test **fails**:
  `ui070Probe.tsx imports "@corpus/kit/composer.css"`. `ALLOWED_PACKAGES` is an
  exact-match set and lists `@corpus/kit/autocomplete.css` but nothing else.
  **Not a defect and not a blocker** — `apps/ui/src/main.tsx` loads
  `composer.css` globally, so a plugin rendering inside the board already gets
  the chip anatomy without importing anything. PLUGINS-012 can consume the trio
  with `imports.test.ts` untouched, and if it wants the explicit import for
  documentation (as `PluginMenu.tsx` does for `autocomplete.css`) it is a
  one-line allowlist entry of exactly the existing kind. Flagged, not
  pre-empted.
- Probe deleted; `imports.test.ts` back to 46 passed.

### Falsification — every new test broken on purpose first

| Break | Test that went red |
| --- | --- |
| dropped `multiple` from `AttachButton`'s input | `AttachButton > opens its own hidden input…` — `expected false to be true` |
| dropped `event.target.value = ""` | `AttachButton > …clears its value for a re-pick` — `expected [] to deeply equal [ '' ]` |
| removed the README's attachment section | `packages/kit/README.md > states that a refused send puts the attachments back` |
| removed `import "@corpus/kit/composer.css"` from `main.tsx` | both new e2e measurements: `.att-chip` display `flex` → **`inline`**, `.pending-atts:empty` `none` → **`block`** |

The second one is the reason to do this at all: the first version of that test
asserted `expect(picker.value).toBe("")` and **passed against a component that
cleared nothing** — a file input reads `""` before anything is picked. It was
rewritten to install a `value` accessor that reports a browser's post-pick
spelling and records writes, and only then did it fail on the break.

The first e2e assertion was also wrong on the first run and the browser
corrected it: `.att-chip` declares `inline-flex`, but it is a flex item of
`.pending-atts` and a flex item's outer display is **blockified**, so the
computed value is `flex`. Kept, with the explanation, because an unstyled span
in the same place computes `inline` — which is precisely what the falsification
above produced.

### Real browser, real Vite bundle

The stylesheet move is the one thing unit tests cannot see: a sheet the kit
exports but nobody imports type-checks, unit-tests green and renders naked
chips. Two new measurements in `apps/ui/e2e/compose-keyboard.spec.ts`, in the
cascade the real bundle produces (headless Chromium, Vite dev server on **5478**
— never 5173, which an ssh tunnel holds):

- `.att-chip` → `display: flex`, `align-items: center`, `gap: 6px`,
  `background-color` = `--surface-2`, `color` = `--ink-2`,
  `border-radius: 7px`, `font-size: 11px`; `.clip` → `--ink-3`, `13px`,
  `0px 4px`. Every value matches `design/index.html` line 461-463 character for
  character.
- `.pending-atts:empty` → `display: none`. This is the rule that keeps the
  comment popover a popover rather than a panel, and it now has a browser
  assertion instead of a comment.
- The pre-existing `thread.spec.ts > previews a pending attachment at 34px` and
  `compose-keyboard > insets the pending-attachment strip` both still pass,
  which pins the **specificity** across the move: the app's per-surface insets
  still win over the kit's base rules.

**Full Playwright suite: 377 passed, 1 failed** (4.6 min).

A first full run showed 4 failures. Three of them — `console.spec` and
`smoke.spec`'s "server unreachable" assertions and one `reveal.spec` flake —
were **my rig, not the code**: `vite.config.ts` proxies `/api` to
`127.0.0.1:8765` by default, and the user's live server holds that port, so the
suite was talking to a real server where it requires none. Re-run with
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8799` (nothing listening — CI's
condition) all three pass. Worth recording: **running this suite on a machine
with a live workspace server silently tests the wrong thing.**

### Unit

- `vitest run apps/ui packages/kit plugins` → **215 files, 4239 tests, all pass**
  (`VITEST_MAX_THREADS=4`).
- `npm run build` → clean. `npm run typecheck -w packages/kit -w apps/ui` → clean.
- `eslint` and `prettier --check` over everything touched → clean.

### Two standing failures that are not this issue's, and were not caused by it

1. **`apps/server` does not parse on this branch.** `apps/server/src/projection/schema.ts:366`
   puts a markdown comment `` -- `orchestrator`, or the id of… `` **inside a
   template literal**; the raw backtick terminates it, and esbuild reports
   `Expected ";" but found "orchestrator"`. `corpus server start` therefore dies
   during startup, which is why the on-disk drill was not repeated here. There
   is a matching `tsc` error at `apps/server/src/queue/lanes.ts:60` —
   `Property 'lane' does not exist on type 'StoredEvent'`. Both are SERVER-111 /
   SHARED-043 work in flight. Escalated, not touched.
2. **`todos-menu.spec.ts:272` — `⇧F10` does not open the todo item menu**
   (`[data-todo-menu]` count 0). Fails consistently, in isolation and in the
   full run, with and without a live server. `⇧F10` is handled in
   `apps/ui/src/keyboard/shortcuts.ts` and `apps/ui/src/menu/*` and the plugin's
   `PluginMenu.tsx` — none of which this issue touches; the other 25 tests in
   that file, including the pointer path to the same menu, pass. Escalated.

### Cleanup

Temporary workspace `/tmp/ui070-ws` removed. No process left running; 5478 and
8793 free. Nothing was ever bound to 8765 or 5173.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
