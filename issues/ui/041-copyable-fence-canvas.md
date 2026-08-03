# [UI-041] Copy button on fenced blocks in rendered turns

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §11 thread view copyable canvases (rider signed 2026-08-02)

## Summary
User request (2026-08-02): make agent-prepared text (e.g. prompts for other
agents) one-click copyable. Per the signed rider: every fenced code block in a
rendered thread turn gets a copy button that writes the block's RAW text (not
rendered HTML, no trailing-fence artifacts) to the clipboard via the async
clipboard API, with a brief "copied" confirmation; the fence's info string
(e.g. ```prompt) renders as a small label on the block. Applies to the
markdown-rendered turn surfaces (thread view; wherever turns render via the
shared markdown renderer).

## Acceptance Criteria
- [x] Every fenced block in a rendered turn shows a copy affordance (visible
      or on-hover per existing affordance conventions); click copies the raw
      block text exactly (newlines preserved, no fences included)
- [x] Brief copied-confirmation, then the button restores; keyboard reachable
- [x] Info string renders as the block label when present; absent → no label
- [x] Clipboard API failure (permissions) degrades to an honest error state,
      not a silent no-op
- [x] Editable document bodies unchanged (this is for rendered turns)

## Technical Design
### Files to Create/Modify
- The shared turn markdown renderer (MarkdownView / turn components) + css

### As built
- `packages/kit/src/markdown/CodeFence.tsx` (new) — the `pre` renderer
  `MarkdownView` installs. Reads the fence's raw text off the **hast** tree (not
  the DOM, not the rendered children), draws the info string as the block's
  label, and owns the copy button's three states.
- `packages/kit/src/markdown/MarkdownView.tsx` — one line: `pre: CodeFence` in
  the memoised `components` map. Wired at the renderer rather than at the thread
  because the rider is about *rendered* markdown: a fence in a turn, in a `view`
  body and in a plugin read surface are the same block seen from three hosts.
  The editable body is TipTap and reaches none of this, so document editing is
  untouched by construction.
- `packages/kit/src/markdown/markdown.css` — appended (nothing reordered): the
  `.fence` / `.fence-label` / `.fence-canvas` / `.fence-copy` rules.
- `packages/kit/src/markdown/CodeFence.test.tsx` (new) — 16 component tests.
- `apps/ui/e2e/fences.spec.ts` (new) — 4 Playwright specs with a real clipboard.

### The trailing-newline decision
The copied bytes are the fence's mdast `value`: **exactly one** trailing newline
is stripped, and never more than one. `mdast-util-to-hast` renders a code node's
value plus a newline (`"a\nb"` → the text `"a\nb\n"`) — that character is a
`<pre>` serialisation artifact, not something the author typed, so it comes off.
A fence whose author left a **blank final line** keeps it (its value already ends
in `\n` and gains a second, so one strip leaves `"text\n"`). Net effect: what is
pasted is byte-for-byte the content between the fence markers, with no trailing
newline surprise and no truncation of a deliberate blank line.

## Testing Strategy
Component tests (clipboard stubbed): raw-text fidelity incl. multiline +
special chars, label rendering, failure path. E2E: copy a fenced block in a
real thread, assert clipboard content (Playwright clipboard permissions).

## E2E Verification Plan
Real app: agent turn containing a labeled fence; click copy; paste-compare.

## E2E Verification Log

**Model: Opus 5 (claude-opus-5[1m]), ui-dev agent, 2026-08-02.**

Real browser (Chromium via Playwright), real Vite dev server on `CORPUS_UI_PORT=5473`,
real React / TanStack / `MarkdownView`, **real `navigator.clipboard`** with
`clipboard-read` + `clipboard-write` granted. The corpus and the thread's turns
are served from inside the page (`stubCorpus.ts` + a `**/api/threads/**` route),
which is the suite's standing arrangement — no workspace server is started, and
`127.0.0.1:8765` was off-limits this session (a commit gate and other agents were
running). So this is the browser half: rendering, the clipboard, focus and the
keyboard are real; the transport is not.

The turn used is an agent turn carrying two fences — a ```` ```prompt ```` block
with a blank line, two-space and four-space indentation, quotes and a literal
`[[doc_x]]`, followed by a bare fence.

`apps/ui/e2e/fences.spec.ts` — 4/4 passed (`4 passed (4.9s)`):

1. **copies the fence's raw text, exactly.** Opened `th_fence` from the Threads
   column → `.reader .thread-conversation .turn` visible → two `.fence` blocks.
   `.fence-label` of the first reads `prompt`; the second has **no** label
   element (count 0). Clicked `[data-fence-copy]`; the button's text became
   `Copied` and its `aria-label` became `Copied the prompt block to the
   clipboard`. `await page.evaluate(() => navigator.clipboard.readText())`
   returned, byte for byte:
   `You are a drafting agent.\n\n  Rewrite [[doc_x]] as:\n    - one "line"\n    - two`
   — asserted `.endsWith("\n") === false` and `not.toContain("```")`. The button
   then restored itself to `Copy` on its own.
2. **reachable and activatable from the keyboard alone.** Focused the first
   block's button, pressed `Tab` → the **second** block's button is focused
   (`toBeFocused`) and computed `opacity` is `1` (revealed by keyboard focus,
   `:focus-visible`); pressed `Enter` → text `Copied` and the clipboard holds
   `corpus doc list --type note`.
   **Defect found and fixed here, in the browser, not in a unit test:** the
   board binds `↵` globally on a `document` keydown listener that calls
   `preventDefault()` (`apps/ui/src/keyboard/useShortcuts.ts`), which cancelled
   the button's native activation — focus the button, press `↵`, nothing copied.
   Reproduced live (a scratch spec logged `:focus-visible true`, `clipboard`
   unchanged), then fixed by having the button stop — never prevent — its own
   `Enter`/`Space` keydown, so the native activation proceeds and the host's
   shortcut keeps working everywhere else. Re-run: green.
   (Programmatic `.focus()` alone does not set Chrome's focus-visible modality;
   that is why the spec reaches the button by a real `Tab`.)
3. **reports a refused clipboard instead of doing nothing.** `writeText` denied
   at the API (`addInitScript` → rejects `Write permission denied.`): the button
   reads `Copy failed`, `aria-label="Could not copy the prompt block — Write
   permission denied"`, `title="Could not copy — Write permission denied"`.
4. **stays out of the way until hovered.** Computed `opacity` `0` at rest, `1`
   after `hover()` — the app's one existing hover-reveal convention
   (`.turn-comment` / `.turn-del`).

Component tests, `packages/kit/src/markdown/CodeFence.test.tsx` — 16 passed
(raw-text fidelity incl. backticks/`$`/markdown/`[[ref]]`/empty fence, the blank
final line, label present/absent, confirm-then-restore on a fake clock, refusal,
no-clipboard-at-all, retry-after-failure, tab order, the global-shortcut guard,
inline code untouched, per-fence state).

Checks: `eslint packages/kit/src/markdown apps/ui/e2e/fences.spec.ts` clean ·
`prettier --check` clean · `tsc --noEmit` clean in **both** `packages/kit` and
`apps/ui` · `vitest run packages/kit/src/markdown` 50 passed.

Known unrelated red on this branch (**not** UI-041): `packages/kit/src/index.test.ts`
"exports exactly the runtime symbols it declares" fails because `INDEX_KEY` is
exported from `packages/kit/src/index.ts` but absent from that test's
`RUNTIME_SURFACE` — another agent's in-flight console/index work. UI-041 adds no
kit exports.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
