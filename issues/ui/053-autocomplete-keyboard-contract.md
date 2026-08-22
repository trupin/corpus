# [UI-053] One keyboard contract for all three autocompletes; ⇥ accepts everywhere

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-009 (Amendment 4)
- Blocks: —
- Coordinate with: UI-052 (composer keys — the menu claims `↵` while open)

## Spec References
- SPEC.md §10 "Smart input everywhere", as amended by SHARED-009 Amendment 4

## Summary
Live report 2026-08-03: _"When autocomplete shows, I want to be able to navigate
the results with the top and bottom arrows. I also want to be able to select one
with tab. Make it consistent with any autocomplete UX."_

Arrows already work in all three. `⇥` works in exactly one. Surveyed state:

| Implementation | Where | ↑↓ | ⇥ | ↵ | esc |
| --- | --- | --- | --- | --- | --- |
| `packages/kit/src/components/Autocomplete/useAutocomplete.ts` | `@` `/` `[[` in plain-text composers | wraps | **none — focus leaves the field** | unconditional accept | dismiss (+stopPropagation) |
| `apps/ui/src/editor/RefAutocomplete.tsx` (+ `refSuggestion.ts`) | `[[` in the TipTap document editor | wraps, no `preventDefault` | **none** | accept, falls through when list empty | close via `dismissedAt` |
| `apps/ui/src/board/query/useQueryAutocomplete.ts` | column query editor | wraps, sets `navigated` | **accepts** | conditional (`enterCompletes`) | dismiss (+stopPropagation) |

Three implementations, three behaviors. The kit one and the editor one are
keyboard-identical but are entirely separate code paths with separate state and
separate DOM — which is why they drifted from the query editor's without anyone
noticing.

**The fix the user asked for is `⇥` everywhere. The fix the code needs is one
implementation.** Do both, in that order of priority: no user-visible behavior
should wait on the refactor.

## Acceptance Criteria
- [x] `⇥` accepts the highlighted item in **all three** autocompletes
- [x] `↵` also accepts (unchanged where it already does; the query editor's
      `enterCompletes` conditionality is preserved — it exists because that menu
      can be open with nothing typed and an unconditional `↵` would commit an
      empty query; keep that reasoning in the code)
- [x] Arrows wrap at both ends, everywhere
- [x] `esc` dismisses leaving the typed text as it stands, everywhere
- [x] `⇥` does not move focus while a menu is open, and does move focus normally
      when no menu is open
- [x] The editor's `[[` menu and the kit's `[[` menu behave identically — a user
      cannot tell which one they are in
- [x] One implementation backs at least the two `[[` menus, or a written reason
      in code why TipTap's suggestion plugin makes that impossible
- [x] `RUNTIME_SURFACE` updated if the kit's exported surface changes
- [x] Screen-reader semantics preserved (`role="listbox"`, `aria-selected`,
      `aria-activedescendant` where present)

## Technical Design
### Files to Create/Modify
- `packages/kit/src/components/Autocomplete/useAutocomplete.ts` (+ `⇥`)
- `apps/ui/src/editor/RefAutocomplete.tsx` / `refSuggestion.ts` (+ `⇥`, and the
  consolidation question)
- `apps/ui/src/board/query/useQueryAutocomplete.ts` (already has `⇥`; align the
  rest)
- Tests alongside each

### Notes
- `refSuggestion.ts` returns `true` to tell ProseMirror a key was consumed rather
  than calling `preventDefault`; `⇥` must be consumed the same way or focus will
  still escape.
- UI-052 changes what `↵` means in composers. The menu must claim `↵` **only
  while open**, and hand it back on dismiss.

## Testing Strategy
Component tests per implementation for ↑ ↓ ⇥ ↵ esc, wrap-around at both ends, and
`⇥`-does-not-blur. E2E for at least one composer trigger and the editor's `[[`.

## E2E Verification Log

**Model: opus** (ui-dev). Real Chromium via Playwright against the real Vite dev
server on `CORPUS_UI_PORT=5984`; transport stubbed at `fetch` (`stubCorpus.ts`),
everything above it real — real React, real ProseMirror, real focus traversal.
New spec: `apps/ui/e2e/autocomplete-keys.spec.ts`.

### Pre-fix reproduction (negative control)
`⇥` was not a bug to reproduce so much as an absence, so the specs were proved
against the absence. With `Tab` removed from the shared contract's accept
condition and the tree rebuilt, the run was **3 failed / 3 passed**, and the
three failures were exactly the three `⇥` assertions, one per menu:

```
✘ the composers' `@` menu › wraps with the arrows, accepts on ⇥, and keeps the caret in the field
✘ the document editor's `[[` menu › is the kit's menu, wraps, and accepts on ⇥ without leaving the editor
✘ the column query editor's menu › wraps, accepts on ⇥, and keeps the caret in the field
      expect(await tabWasCancelled(page)).toBe(true)   Expected: true   Received: false
```

The query editor already accepted on `⇥` before this issue, yet it failed too:
its old handler called `preventDefault` on the *React synthetic* event only when
it took the key, and the assertion reads `defaultPrevented` off the real bubbling
keydown. The contract restored, the same run is 6/6.

### `⇥` does not move focus — the proof, per menu
`preventDefault` on a `keydown` is what cancels the browser's focus move, so each
test arms a one-shot `window` `keydown` listener (bubble phase, therefore *after*
React's delegated root handler and after ProseMirror's handler on the
contenteditable) and reads `event.defaultPrevented` back. Reading focus alone
would not be proof: both accept paths call `.focus()` as part of applying the
completion, which would mask a blur. Both facts are asserted.

| Menu | trigger typed | `defaultPrevented` after `⇥` | focus after `⇥` | result |
| --- | --- | --- | --- | --- |
| kit composer (`@`, global composer) | `@` | `true` | `<textarea aria-label="Ask the agent, or capture a thought">` still focused; value `@agent ` | accepted, focus held |
| document editor (`[[`, TipTap) | `[[` | `true` | `.reader .ProseMirror` still focused; `.ref` renders the highlighted row's title | accepted, focus held |
| column query editor | `status=` | `true` | `Edit query for Inbox` still focused; value `status=open` | accepted, focus held |

The editor's `true` is the case the issue warned about: in the ProseMirror path a
`⇥` that only returned `true` would be consumed by the plugin but the *browser*
default (focus move) is cancelled only because `handleAutocompleteKeyDown` calls
`preventDefault` itself. Verified as the flag on the real event, not inferred.

### The negative of the same criterion
`hands ⇥ back to the browser once no menu is open` — global composer, nothing
typed, `⇥`: `defaultPrevented` is `false` and the textarea is **no longer**
focused. `⇥` still tabs when it is nobody's key.

### The rest of the contract, per menu
- **Arrows wrap at both ends**: `↑` from row 0 lands on the last row and `↓` back
  to row 0, asserted via `aria-selected` in all three menus (composer 2 rows,
  editor N rows, query editor 3 rows).
- **`esc` dismisses leaving the typed text**: composer keeps `ask @res` and the
  overlay stays open; editor keeps the literal `[[` in the body and the reader
  stays open. One press closes one layer.
- **Both `[[` menus are one menu**: the editor's first option now carries
  `class="ac-item active"` — the class `AutocompleteMenu` emits — asserted in the
  browser, and its `.d` column is the document type, matching the composers' and
  `design/index.html`.

### Runs
```
CORPUS_UI_PORT=5984 npx playwright test autocomplete-keys editor.spec query-editor  →  22 passed
CORPUS_UI_PORT=5984 npx playwright test thread.spec board.spec search.spec context-menu.spec smoke.spec
                                                                                   →  104 passed, 1 failed
```
The single failure is `smoke.spec.ts › a failing health check fails soft…`, which
asserts the console strip reads "server unreachable". `playwright.config.ts`
documents that this only holds while `127.0.0.1:8765` is unbound; the user's live
personal server holds that port on this machine (`lsof -iTCP:8765` → `node
92431`), which I was directed not to touch. Environmental, unrelated to this
issue — no autocomplete surface is involved.

### Unit
```
vitest run packages/kit apps/ui/src   →  163 files, 2585 tests, all passing
npx eslint <14 touched files> --max-warnings 0   →  clean
npx prettier --check                              →  clean
npx tsc --noEmit -p packages/kit -p apps/ui       →  clean
```

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Consolidation outcome
One implementation now backs both `[[` menus for everything a user can perceive.
`apps/ui/src/editor/RefAutocomplete.tsx` renders `@corpus/kit`'s
`AutocompleteMenu`, lists through the kit's new `useRefCompletions`, and answers
keys through the kit's new `handleAutocompleteKeyDown`. What stays in `apps/ui`
is only what `@tiptap/suggestion` makes irreducible — the trigger is a document
*range* (not an offset into a string, so `detectTrigger` cannot see it), the
insertion is a ref *node* (not text, so `applyCompletion`'s `{ text, caret }`
cannot express it), and the plugin owns open-ness (hence `refSuggestion.ts`'s
`dismissedAt`). That reason is written at the top of `RefAutocomplete.tsx`.

The query editor keeps its own trigger grammar and vocabulary — a query string is
not `@`/`/`/`[[` — but now shares the keyboard contract as literally the kit's
function rather than a third copy of it.

Three real drifts were found and closed by the consolidation: the `[[` limit (12
vs 8), the `.d` column (document id vs type — `design/index.html` settles it as
the type), and the highlight class (`.ac-item.active` vs `.ac-item.on`, which the
kit stylesheet had been carrying an apology comment for).

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
