# [PLUGINS-012] The todos item composer takes attachments too

## Domain
plugins

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: SHARED-012, UI-070
- Blocks: —

## Spec References
- SPEC.md §10 as replaced by SHARED-012: the contract binds "any composer a
  plugin contributes"

## Summary
`plugins/todos/ui/TodoItemComposer.tsx` takes no attachments. The signed §10 text
covers plugin composers explicitly, so the reference plugin has to demonstrate
the capability rather than be the one surface without it.

This is deliberately the *second* consumer test of a kit surface. PLUGINS-011 was
the first — it consumed the composer key contract with a single root import,
nothing copied, and the boundary test unchanged, which is what vindicated putting
that helper in the kit rather than in `apps/ui`. UI-070 is required to publish
the attachment intake the same way.

**The interesting result this issue produces is whether that held.** If the
attachment surface is not cleanly consumable from a plugin, say so plainly and
file the gap against UI-045 — do not work around it with a copy, which is exactly
the debt UI-045 exists to retire.

## Acceptance Criteria
- [x] A file can be attached to a todo item comment by picker, paste and
      drag-and-drop, with chip previews before sending
- [x] Consumed from `@corpus/kit` — no copy of the intake or the chip strip
- [x] The plugin boundary holds: only `@corpus/kit*`, `@corpus/contract`,
      `react`, `zod`; `imports.test.ts` gained **one allowlist entry of the
      existing kind** (`@corpus/kit/composer.css`, beside `autocomplete.css`) —
      see the decision below; the rule itself is not widened
- [x] An over-cap file is refused visibly, matching every other surface
- [x] The composer key contract is unchanged (`↵` newline, `⌘↵` send)
- [x] The attachment lands under the created thread on disk, verified against a
      real server (md5-identical bytes; log below)

## Technical Design
### Files to Create/Modify
- `plugins/todos/ui/TodoItemComposer.tsx` + tests
- `plugins/todos/ui/todos.css` — the drop highlight and the chip strip's place in
  this popover (the kit ships no `.dropping` rule on purpose: the dropzone is the
  surface, and only the surface knows what it looks like)
- `plugins/todos/imports.test.ts` — one allowlist entry, `@corpus/kit/composer.css`
- `apps/ui/e2e/todos-menu.spec.ts` — a browser test for the three routes, plus
  the repair of a stale ⇧F10 locator left by PLUGINS-015

## Testing Strategy
Component tests for intake and refusal; a real-app drill asserting the bytes on
disk under the thread the comment created.

## E2E Verification Log

**Model: Opus 5 (1M context). 2026-08-16, plugins-dev.**

### The kit surface was consumable, and nothing was copied

`TodoItemComposer.tsx` gained five imports from `@corpus/kit` and no code:
`useAttachmentIntake`, `PendingAttachments`, `AttachButton` (plus the two it
already had). The intake's three routes are wired to the popover (drag), the
field (paste) and the foot (📎); `files: intake.pending.map(a => a.file)` rides
on the existing `useCreateThread`, which switches to multipart by itself. UI-070
published exactly what a plugin needed — the second consumer test held, as
PLUGINS-011 predicted it would.

### The stylesheet question — declared, not inherited

`@corpus/kit/composer.css` is imported by the component and added to
`ALLOWED_PACKAGES`. The reasoning:

- **The allowlist entry is the same *kind* as `autocomplete.css`**, not a
  widening. It is one exact-match subpath of an export the kit already declares
  (`packages/kit/package.json` `exports` + `files`), added because this plugin
  renders `.pending-atts` / `.att-chip` / `.clip`, exactly as `PluginMenu.tsx`
  renders `.ac-menu` / `.ac-item`. The list stays exact-match; no glob, no
  `@corpus/kit/*`. The existing comment above that entry already states the
  principle — "names the sheet rather than assuming whoever mounted it already
  did" — and this is the second instance of it, not a new rule.
- **Inheriting the board's cascade would have been the latent bug.** `main.tsx`
  does load `composer.css` globally, so the chips would look right today. That is
  precisely why the import matters: without it the plugin's appearance depends on
  a fact about its host that nothing checks. The kit-only rule exists so a plugin
  is defined by what it imports; a plugin that renders kit components while
  declaring none of their anatomy is one `main.tsx` edit away from unstyled.
- **It costs nothing.** Verified in a production build: `.att-chip` /
  `.pending-atts` appear once, in the shared `index-*.css` chunk, because Rollup
  emits a CSS module once for the whole graph — identical to how `autocomplete.css`
  behaves for `PluginMenu` (`ac-menu` × 3 in index, 0 in the plugin chunk). The
  plugin chunk carries only this plugin's own two new rules.
- **`imports.test.ts` was checked red** with the entry removed:
  `ui/TodoItemComposer.tsx imports "@corpus/kit/composer.css": expected false to
  be true`. The boundary test is load-bearing, not decorative.

### Real-app drill

Real workspace (`corpus init /tmp/plug012-ws`, its own port **8766** — never
8765), real server started from source with the plugin present, real Vite on
**5291** with `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8766` (so `/api` went to my
server, not the user's), real Chromium via `@playwright/test`, real files on
disk. Item row → right-click → *Comment on item*, then:

```
board: todos column rendered
drop: highlight while dragging = true { border: 'rgb(59, 95, 151)',
      background: 'rgba(59, 95, 151, 0.1)' } | after drop = false
chips before sending: [ 'dropped.png✕', 'pasted.png✕', '📄picked.txt✕' ]
chip thumbnail: { height: 34, src: 'blob:' }
POST /api/threads → 201 thread th_g4xxt5uw
first turn body:
all three routes, one comment

![dropped.png](attachments/th_g4xxt5uw/2026-08-16T23%3A59%3A20Z/dropped.png)
![pasted.png](attachments/th_g4xxt5uw/2026-08-16T23%3A59%3A20Z/pasted.png)
[picked.txt](attachments/th_g4xxt5uw/2026-08-16T23%3A59%3A20Z/picked.txt)

attachment-only: send enabled with no text = true
POST /api/threads → 201 thread th_bun4r2ng
attachment-only turn body:
![pasted.png](attachments/th_bun4r2ng/2026-08-16T23%3A59%3A20Z/pasted.png)

over-cap alert: Comment failed — attachment huge.bin is 27262976 bytes, over
      the per-file limit of 26214400 bytes (25 MB)
over-cap kept: [ '📄huge.bin✕' ] | words kept: here is the recording
```

**The bytes on disk**, md5-identical to the originals — a real 1×1 PNG and a
real text file, not a fixture string:

```
.corpus/attachments/th_g4xxt5uw/2026-08-16T23:59:20Z/dropped.png  70 bytes  md5=2cd8bde463f5d82aae0f0cec061d6b8f
.corpus/attachments/th_g4xxt5uw/2026-08-16T23:59:20Z/pasted.png   70 bytes  md5=2cd8bde463f5d82aae0f0cec061d6b8f
.corpus/attachments/th_g4xxt5uw/2026-08-16T23:59:20Z/picked.txt   26 bytes  md5=4411df9d3df3f14fb6f4c8706582f070
.corpus/attachments/th_bun4r2ng/2026-08-16T23:59:20Z/pasted.png   70 bytes  md5=2cd8bde463f5d82aae0f0cec061d6b8f
originals: dropped.png/pasted.png md5=2cd8bde…  picked.txt md5=4411df9…
```

The thread document on disk is the ordinary §6 one — `parent: doc_week012`,
`anchor: anc_7b30ae60`, the first turn under its `## user · <ts>` heading with
the three links — and the parent's frontmatter grew the anchor. No thread shape
of the plugin's own. The over-cap request wrote **nothing**: only four files
exist under `.corpus/attachments/`.

**Refusal → recovery → send, in the browser** (second drill script):

```
refused: Comment failed — attachment huge.bin is 27262976 bytes, over the
         per-file limit of 26214400 bytes (25 MB)
words kept: the recording of the call
chips kept: [ '📄huge.bin✕' ]
chips after the fix: [ 'dropped.png✕' ]
recovered send → 201 th_lnwdslqc
posted attachment renders: { complete: true, naturalWidth: 1,
                             src: 'blob:http://localhost:5291/0d79e923-…' }
```

The last line is the round trip closing: the image the composer sent came back
out of the workspace through `/attachments`, decoded (1×1 = the PNG that was
dropped). A link that 404s is indistinguishable in markdown, so it is asserted as
a decoded bitmap.

**On restore-on-failure.** The kit's `take()`/`restore()` pair exists for a
composer that clears itself optimistically. This one clears nothing until the
thread exists — the words already behaved that way — so the chips simply stay,
which is the same guarantee one step stronger: they are never taken away to be
put back, and there is no in-flight window where the text is on screen and the
files are not. Asserted three ways: the words *and* the chips survive a refusal;
the previews are **not** revoked (a restored chip showing a broken image would be
the same loss later); and pressing send again puts the *same file* on the wire a
second time. The real-app run above shows the whole recovery, including removing
the offending chip and sending a different file from the same composer.

### Tests

- `plugins/todos/ui/TodoItemComposer.test.tsx` — 10 new cases (three routes, chip
  previews, removal, attachment-only, refusal + re-send, over-cap, preview
  release on close). Plugin suite: **418 passed, 17 files**.
- `apps/ui/e2e/todos-menu.spec.ts` — one new browser test: all three routes in
  real Chromium (real `<input type=file>`, real `DataTransfer`, real
  `ClipboardEvent`), the highlight asserted as a *computed colour change*, and
  every route asserted by **the chip it produced**. It deliberately stops before
  the send: `stubCorpus.ts:889` records requests with `JSON.parse(postData())`,
  which throws on `multipart/form-data`, so no spec in this suite has ever posted
  an attachment on any surface. That fixture gap is reported to the orchestrator;
  the wire and the disk are covered by the drill above. **9 passed.**

**Every new test was checked red** by mutating the plugin source and re-running:

| mutation | red |
| --- | --- |
| drop `onPaste={intake.onPaste}` | paste test (unit + e2e) |
| drop the four drag handlers | highlight + drop tests |
| **keep the highlight, point `onDrop` at `onDragLeave`** | *only* the drop-sends test — the class-list test still passed, which is the trap UI-111 named |
| remove `<AttachButton>` | 6 tests |
| remove `<PendingAttachments>` | 6 tests |
| drop `files:` from the request | 3 tests (the wire) |
| revert `canSend` to text-only | attachment-only + over-cap |
| remove the allowlist entry | `imports.test.ts` |

Kit source was never mutated for falsification: plugins resolve `@corpus/kit`
through the exports map into `dist/`, so a source-only change there proves
nothing (UI-097's finding). Every mutation above is in the plugin's own source,
which the tests compile directly.

### Found on the way — a stale e2e left by PLUGINS-015 (fixed)

`todos-menu.spec.ts`'s "behaves like every other menu: ⇧F10, arrows, ↵ and esc"
was failing **before** this change and deterministically: PLUGINS-015 made the
item row a container of two controls and moved focus to `.todo-item-open`
(`TodosColumnMenu.test.tsx` documents that model as `openControlFor`), but the
spec still called `focus()` on the row — a `<div>` with no `tabindex`, so the
call was a no-op and ⇧F10 reached nothing. The unit tests stayed green because
`fireEvent.keyDown` targets the row directly regardless of focus. Repaired here
with an `itemOpen()` locator, since it would otherwise have failed CI for the
release: 9/9 pass.

### Checks

`vitest plugins/todos` 418/418 · `tsc --noEmit -p plugins/todos` exit 0 ·
`tsc --noEmit -p apps/ui` exit 0 · `eslint plugins/todos apps/ui/e2e/todos-menu.spec.ts`
clean · `prettier --check` clean · `npm run build -w apps/ui` succeeds (the new
CSS import resolves through the kit's `exports` map in a production build) ·
Playwright `todos-menu.spec.ts` 9/9.

Ports used: 8766 (scratch server) and 5291 / 5293 (Vite). **8765 and 5173 were
never bound**; both scratch servers were stopped and the ports verified free.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
