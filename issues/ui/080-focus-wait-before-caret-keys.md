# [UI-080] Ten e2e sites send a key straight after `click()` with no focus wait

## Domain

ui

## Status

todo

**Amended 2026-08-22 by SHARED-065 (Phase 41).** Two references to
`apps/ui/e2e/todos-menu.spec.ts` are removed — the file is deleted with the
plugin surface (SHARED-064, UI-150). It appeared only in the *"Already correct —
do not touch"* inventory and in an acceptance criterion asking that it stay
green, so nothing this issue asks anyone to fix has changed. **The sixteen-site
arithmetic below is unaffected**: the deleted site was never one of the fourteen
remaining.

## Priority

P2 (nice-to-have)

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: **INFRA-020** (todo) — the standing rule: "make it deterministic — wait
  on the condition, not on a duration". **UI-079** — the sibling from the same
  sweep; different mechanism (a decoration's lifetime, not focus).

## Spec References

- — (test hygiene; no product behaviour is in question)

## Summary

`click()` resolves when the mouse events have been delivered, which is **not** when
the target has taken focus. A key that arrives inside that gap reaches a page whose
editable surface is not yet `document.activeElement`, and the browser handles it as
a page-level key instead. The consequence is the dangerous part: `End` on an
unfocused page is a *scroll*, so it silently no-ops as a caret move — and the
*next* keystroke, by then focused, inserts at wherever the mousedown left the
caret. Mid-word.

That mechanism is not inferred. It was reconstructed on demand by blurring the
surface between the click and the key, which reproduces the corruption byte for
byte — the note is preserved verbatim in the fix's own docblock
(`apps/ui/e2e/soft-wrap.spec.ts:90-94`):

> the pre-push gate, and it is a race in the test rather than in the product: the
> caret was mid-word because `End` never ran, not because anything moved under it.
> Reproduced exactly by blurring the surface between the click and the key, which
> writes `offic!e opens later.` byte for byte. So the wait is on the condition —
> this element has the caret — and not on a duration.

**Two sites were fixed already**, in commit `7f9c376c` (Phase 14), because those
two corrupted **silently**: they typed real text into a real body and asserted on
the saved bytes, so a mis-placed caret produced a plausible-looking wrong document
rather than an error. The rest were deliberately left, on the reasoning that they
would fail loudly instead of mis-placing a caret. This issue is the tail: that
reasoning holds for *some* of the remaining sites and not others, and the two
classes have never been separated on the record.

## The fix pattern, already established

From the two fixed sites — cite this, do not invent a second shape.
`apps/ui/e2e/soft-wrap.spec.ts:96-99` extracts it into a helper:

```ts
async function caretIn(page: Page, target: Locator): Promise<void> {
  await target.click();
  await expect(page.locator(".reader .doc-editor .ProseMirror")).toBeFocused();
}
```

and `apps/ui/e2e/edit-session-close.spec.ts:98-104` inlines it with the reason:

```ts
await page.locator(".reader .ProseMirror").click();
// `End` before the surface has focus is a no-op that lands the sentence in the
// middle of the body instead of at the end — see `soft-wrap.spec.ts`'s
// `caretIn`. Waiting on the condition, not on a duration.
await expect(page.locator(".reader .ProseMirror")).toBeFocused();
await page.keyboard.press("End");
```

One line: `await expect(<editable locator>).toBeFocused();` between the click and
the first key. Note `soft-wrap.spec.ts:225-229` applies the same wait after a
`dblclick`, for the same reason — a double click selects from the mousedown and
focus lands after it.

## Inventory of the remaining sites

Ten sites remain in the class the fixed pair belongs to — a key that requires a
**specific element** to hold focus. All paths under `apps/ui/e2e/`.

### Class A — click into an editable surface, then a caret or selection key (7)

| # | Site | Key(s) | Note |
| --- | --- | --- | --- |
| A1 | `autocomplete-keys.spec.ts:161-162` | `ControlOrMeta+End` | The closest analogue to the fixed `End` bug. It is inside the file's shared `openEditor` helper, so **every test in the file inherits it**. Line 160 waits for the element to *attach*, which does not close the race. |
| A2 | `clipboard.spec.ts:146-148` | `ControlOrMeta+a`, `ControlOrMeta+c` | In the shared helper `copyWholeBody`. |
| A3 | `clipboard.spec.ts:292-293` | `ControlOrMeta+a` | |
| A4 | `clipboard.spec.ts:387-389` | `ControlOrMeta+a`, `ControlOrMeta+v` | |
| A5 | `clipboard.spec.ts:456-458` | `ControlOrMeta+a`, `ControlOrMeta+v` | |
| A6 | `clipboard.spec.ts:486-487` | `ControlOrMeta+a` | |
| A7 | `turn-breaks.spec.ts:112-115` | `type(…)`, `Enter`, `type(…)` | Click on a `[data-composer]` textarea, then typing. |

### Class B — right-click a context menu, then a roving-focus key (3)

| # | Site | Key(s) | Note |
| --- | --- | --- | --- |
| B1 | `context-menu.spec.ts:226-228` | `ArrowDown` | Partially mitigated: the *next* line asserts focus, so a lost key fails loudly. Compare the guarded sibling at :199-205, which waits `toBeVisible()` before its first `ArrowDown`. |
| B2 | `context-menu.spec.ts:243-245` | `ArrowDown`, `Escape` | No guard of any kind. |
| B3 | `context-menu.spec.ts:249-251` | `ArrowDown`, `Space` | `Space` activates the focused item, so a lost `ArrowDown` activates the **wrong entry** — or nothing. |

### Which of these are actually silent, and which fail loudly

This is the distinction the earlier triage asserted but never wrote down, and it
is what should decide the fix order:

- **A2–A6 are the silent ones, and they are silent in a new way.** An unfocused
  `Ctrl/Cmd+A` selects the whole **page** rather than the editor body. The
  subsequent copy or paste then operates on the wrong scope — a
  plausible-looking wrong result, not an error. This is the same defect class as
  the two already fixed, and the claim that "the rest would fail loudly" does not
  hold for them.
- **A1 is silent-adjacent and has the widest blast radius**: it is in a shared
  helper, and `ControlOrMeta+End` failing means every subsequent typing assertion
  in the file starts from the wrong caret.
- **A7 fails loudly** — a dropped prefix shows up as a value mismatch at
  `turn-breaks.spec.ts:117`.
- **B1 fails loudly** by construction (the next line asserts focus). **B3 can be
  silent**: activating the wrong menu entry may still satisfy a loose assertion.
  **B2** is bounded — `Escape` on a menu that has not taken focus leaves the menu
  open and the following `toBeHidden()` fails loudly.

### Adjacent, different mechanism — decide, do not silently include (4)

Four further sites click **to move focus away** and then press a *global* hotkey:
`compose-keyboard.spec.ts:273-274` (`c`), `:366-367` (`?`), `:402-403` (`c`), and
`board.spec.ts:119-120` (`Escape`). These are not the same bug — a document-level
hotkey does not need any particular element focused, it needs the *previous* focus
released — so `toBeFocused()` is the wrong instrument. `board.spec.ts:119` is the
sharpest illustration that the file's own standard is inconsistent: the same
click/key pair at `board.spec.ts:90-93` **is** guarded, with
`await expect(page.locator(".ac-menu.open")).toBeVisible();`. Include them or
exclude them explicitly; do not leave a fourth unexamined class behind.

### Already correct — verified, do not touch

`abandon.spec.ts:56` and `:83`; `board.spec.ts:93`; `smoke.spec.ts:90` and `:97`;
`images.spec.ts:302` and `:307`; `compose-keyboard.spec.ts:270`;
`context-menu.spec.ts:150`, `:203`, `:205`, `:231`, `:265`; `collapse.spec.ts:349`.
Each carries an awaited `toBeVisible()`,
`toBeFocused()`, `toBeEnabled()` or equivalent between the click and the key.
`query-editor.spec.ts` and `search.spec.ts` use locator-scoped `press` /
`pressSequentially` on an already-open input and are not preceded by a bare click.

## A correction to the plan row

The row's title says "Ten e2e sites". The full sweep finds **sixteen** click→key
sites with no intervening focus wait: two already fixed, and fourteen remaining.
Ten of those fourteen are the class above (A1–A7, B1–B3) — a key needing a
specific element focused — which is presumably where the count came from. The
other four are the global-hotkey shape, a different mechanism that was either not
counted or not noticed. The title is kept as filed; the inventory here supersedes
its arithmetic.

## Acceptance Criteria

- [ ] Every site in Class A and Class B either carries a condition-shaped wait
      before its first key, or carries a **written justification** at the site
      saying why it is safe — an undocumented omission is what produced this issue
- [ ] A2–A6 are fixed unconditionally. They are silent-corruption sites, which is
      the criterion the two already-fixed sites met
- [ ] A1 is fixed in the shared helper, so the whole file inherits the fix
- [ ] The fix is the **established pattern** — `await expect(<locator>).toBeFocused()`
      — not a new one, and not a `waitForTimeout`
- [ ] No `waitForTimeout`, no raised expect timeout, and no `waitFor()` on mere
      attachment (which is what A1 already has and which does not close the race)
- [ ] The four global-hotkey sites are explicitly **decided**: fixed with an
      appropriate condition (the shape `board.spec.ts:90-93` already uses), or
      excluded with a comment saying why
- [ ] Every file touched still passes at default workers and under deliberate load
- [ ] The reproduction is re-run at one site as proof the mechanism is understood:
      blur between click and key, observe the corrupted output, restore

## Technical Design

### Files to Create/Modify

- `apps/ui/e2e/autocomplete-keys.spec.ts` (A1, in `openEditor`)
- `apps/ui/e2e/clipboard.spec.ts` (A2–A6, two of them in shared helpers)
- `apps/ui/e2e/turn-breaks.spec.ts` (A7)
- `apps/ui/e2e/context-menu.spec.ts` (B1–B3)
- `apps/ui/e2e/compose-keyboard.spec.ts`, `apps/ui/e2e/board.spec.ts` — the four
  global-hotkey sites, if the decision is to fix them
- **Nothing under `apps/ui/src`.** This is a test-side race; the product is not at
  fault, and a change there would be treating a symptom.

### Key Implementation Details

**Do not extract a shared cross-file helper.** `caretIn` lives in
`soft-wrap.spec.ts` because it hardcodes that file's editor selector. The
surfaces differ — `.reader .doc-editor .ProseMirror`, `.reader .ProseMirror`, a
`[data-composer]` textarea, a `role=menu` — so a single helper would need the
locator passed anyway, at which point it is one line inline. Match the file's own
idiom; the repo's convention is to colocate by feature, not to build a test
utility module.

**The right condition differs by class.**

- Class A: the *editable surface* has focus — `toBeFocused()` on the ProseMirror
  root or the textarea. Note the click target and the focus target are often
  different elements (A1 and A3 click a `p` or an `h1` inside the editor; focus
  lands on the editor root), so assert on the root, as `caretIn` does.
- Class B: the menu has taken roving focus. `toBeVisible()` on the menu is what
  the guarded siblings at `:199-205` use, but B3's `Space` needs the *first item*
  focused, so `toBeFocused()` on the item is the honest condition there. Read
  what each test's next key actually requires rather than applying one wait
  everywhere.

**Guard against the pattern coming back.** Consider an ESLint rule or a repo
grep-check that flags a `.click()` whose next statement is a bare
`page.keyboard.*` in `apps/ui/e2e/`. Optional, and it must not fire on the
justified sites — but this issue is the *second* round of this exact fix, which is
the usual signal that a manual sweep will need a third.

### Edge Cases

- **`dblclick`** — same race, and the double click's own selection makes it worse.
  `soft-wrap.spec.ts:225-229` is the precedent.
- **Right-click** — `click({ button: "right" })` opens a menu asynchronously; the
  menu's focus arrives after it is visible, so visibility is a weaker condition
  than focus and B3 needs the stronger one.
- **A click that changes which element is focusable** (opening a reader, then
  clicking into it) — the fixed sites all wait on the *final* surface, not on the
  intermediate one, which is why `waitFor()` on attachment is insufficient.
- **A modifier chord** — `ControlOrMeta+a` is subject to the same rule; the
  modifier does not make the key reach a different target.

## Testing Strategy

The subject is the test suite, so verification is measurement:

- Run each touched spec `--repeat-each=20 --workers=8` with the machine loaded,
  before and after. Before-numbers matter: a site that never failed in 20 loaded
  runs was fixed on reasoning, and the issue should say so rather than claim a
  measured improvement.
- Re-run the deliberate-blur reproduction at one Class A site to confirm the
  mechanism, then restore.
- Full `npm run e2e` at default workers, green and not materially slower.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Pick a Class A site — `clipboard.spec.ts:146-148` is the clearest, since an
   unfocused `Ctrl/Cmd+A` selects the page rather than the body.
2. Insert a deliberate blur between the `click()` and the first key
   (`await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())`).
3. Expected: the test fails, or worse, **passes with the wrong content** —
   capture which, and the actual clipboard flavours observed.
4. Remove the blur; confirm the test passes again.

### Verification Steps

1. Apply the waits.
2. Re-insert the blur at the same site. Expected: the test now **hangs at the
   focus assertion and fails there**, naming the real condition, instead of
   producing a wrong document — that is the whole point of the fix.
3. Remove the blur; run each touched spec under load, 20×.
4. Full gate run at default workers.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the
implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_[Agent fills: the blur reproduction at a named site, exact observed output,
whether it failed or silently passed wrong.]_

### Post-Implementation Verification

_[Agent fills: per-file before/after pass counts under identical load, the
decision taken on the four global-hotkey sites and why, and any site left unfixed
with its written justification.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-080]` prefix
