# [UI-022] Focus mode: redundant back-to-list button next to ✕ Close

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: — (UI-005 focus mode, landed)
- Blocks: —

## Spec References
- SPEC.md §10 — focus mode (⤢ / full screen), esc/⌫ close-back precedence

## Summary
User report (2026-07-30, screenshot): the full-screen head renders
`✕ Close  ‹ Open threads  esc closes · click anywhere to edit`. At the bottom of the
focus stack the shared `ReaderHead` back button falls back to the column title
(`‹ Open threads`), and `FocusMode`'s depth-0 effect means clicking it just closes the
overlay — exactly what the adjacent `✕ Close` does. Two adjacent controls, one action.
User direction: **in full screen keep Close only** — drop the back-to-list button. The
back button stays meaningful (and stays) when the focus stack has depth: it is then
labeled by the previous document and navigates within the excursion. The column reader
is untouched — there the back button is the only way back to the list, and there is no
Close.

`design/index.html` (focus-overlay markup) shows the same redundant pair with the back
button `hidden` by default — the mockup's `#focus-back` is only unhidden with depth,
which is the behavior to match; the shared-head port lost that conditional.

## Acceptance Criteria
- [x] Focus head at stack depth 0: `✕ Close` renders, the back button does not
- [x] Focus head after following a ref (depth ≥ 1): back button renders, labeled by the previous document, and navigates back (does not close)
- [x] Column reader head unchanged: back button always renders (list title at depth 0), never a Close
- [x] esc behavior unchanged (focus layer closes; ⇧esc straight out)

## Technical Design
### Files to Create/Modify
- `apps/ui/src/reader/ReaderHead.tsx` — suppress the back button in the `focus` variant when `previous === null` (+ tests)
- `apps/ui/src/reader/FocusMode.test.tsx` — host-level assertion

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4); adjust the existing focus e2e spec if it asserts the back button at depth 0.

## E2E Verification Plan
Real app: open a doc full screen → only ✕ Close (+ hint) on the left; follow a `[[ref]]` → `‹ <previous title>` appears and goes back; column reader still shows `‹ <list>`.

## E2E Verification Log

**2026-07-30 — ui-dev on opus (claude-opus-5).** Real app, no stubs: `corpus init`
workspace at `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/ui022/ws`, server on
`127.0.0.1:8790` (pid 24758), Vite dev server on `:5273` proxying to it, driven with a
real Chromium (Playwright, 1600×1000). Two documents created through the CLI:
`doc_htrpjtk2` "Mortgage options" (body carries `[[doc_23nhejrj]]`) and `doc_23nhejrj`
"Rates this week".

**Reproduction (pre-fix).** With `ReaderHead`'s conditional temporarily reverted to the
unconditional back button and the dev server hot-reloaded:

```
PRE-FIX focus head, depth 0: ✕ Close | ‹ Inbox | esc closes · click anywhere to edit | doc_htrpjtk2 · git ✓ | ⋯
PRE-FIX focus back buttons: 1
PRE-FIX after clicking back at depth 0, overlay open: 0     ← Back did exactly what ✕ Close does
```

Screenshot: `repro-focus-depth0.png` (scratch dir). The conditional was then restored and
the runs below repeated against the shipped code.

**After the fix.**

- Column reader head, depth 0: back button reads `‹ Inbox`, `[data-close-focus]` count `0`
  — the column variant is untouched.
- ⤢ into full screen, depth 0: `✕ Close | esc closes · click anywhere to edit |
  doc_htrpjtk2 · git ✓ | ⋯`; `.focus .back:not([data-close-focus])` count `0`
  (`focus-depth0.png`).
- Clicked the `[[doc_23nhejrj]]` ref in focus: head becomes `✕ Close | ‹ Mortgage options |
  esc closes · click anywhere to edit | doc_23nhejrj · git ✓ | ⋯`, back-button count `1`,
  labelled by the **previous** document (`focus-depth1.png`).
- Clicked that back button: title returns to "Mortgage options", `.focus.open` still
  present (it navigated, it did not close), back-button count back to `0`.
- `esc`: overlay closed, the column reader underneath still open (`.col.reading .doc-body`
  count `1`) — the escape precedence is unchanged.
- Re-verified against the final (prettier-formatted) files: `POST-FIX focus head, depth 0:
  ✕ Close | esc closes · click anywhere to edit | doc_htrpjtk2 · git ✓ | ⋯`.

**Automated.** `apps/ui` scoped Vitest (`VITEST_MAX_THREADS=4`):
`ReaderHead.test.tsx` (10, new file), `FocusMode.test.tsx` (8), `Reader.test.tsx` (21) —
all pass. Playwright single specs on `CORPUS_UI_PORT=5273`: `reader.spec.ts` 6/6,
`editor.spec.ts` 10/10 (the two specs that exercise the focus overlay; neither asserted the
depth-0 back button, so no e2e spec needed changing). `eslint`, `prettier --check` and
`tsc --noEmit` clean over `apps/ui`.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
