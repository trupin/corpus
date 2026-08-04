# [UI-054] Newlines typed into a turn don't render — `a\nb` shows as `a b`

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-052 (which makes this reachable)
- Blocks: —

## Spec References
- SPEC.md §11 Thread view ("turns markdown-rendered")
- SPEC.md §11 composer key contract (SHARED-009 Amendment 1)

## Summary
Found by UI-052 (2026-08-03) while verifying the new composer contract in a real
browser. The newlines **are** written to the file — the agent confirmed
`"reply line one\nreply line two\nreply line three"` on disk — but the turn
renders them as a single run of prose, because `packages/kit/src/markdown/`
configures no `remark-breaks` and CommonMark treats a single newline as a space.

Pre-existing behavior, **newly reachable**: before UI-052, `↵` submitted, so a
multi-line turn body was something you had to work at. Now it is the default
thing that happens when a user presses Enter, which the signed contract tells
them to do. Shipping "Enter makes a newline" alongside "newlines are invisible"
is a worse experience than either alone.

**The scoping decision, which is the real content of this issue.** Do NOT apply
`remark-breaks` globally without deciding this deliberately:

- **Thread turns are conversational.** A user typing into a reply box expects
  their line breaks to survive, the way every chat tool behaves. Strong case for
  breaks.
- **Document bodies are authored markdown.** Documents are written, edited in
  TipTap, and round-tripped to markdown on disk; making every single newline a
  hard break there changes the meaning of existing files and would put `<br>`s
  through prose that was deliberately hard-wrapped. Strong case against.

Recommendation: **turns only**, leaving document rendering unchanged. Both
surfaces render through the same `MarkdownView`, so this needs a per-instance
option rather than a global plugin — design that seam rather than reaching for
the global switch.

If the implementing agent concludes the split is wrong, escalate to the
orchestrator rather than deciding it silently: it changes how existing files
display.

## Acceptance Criteria
- [x] A newline typed into a thread reply or turn comment renders as a line break
- [x] Document bodies render exactly as they do today — a test pins that existing
      hard-wrapped prose does not gain breaks
- [x] The on-disk markdown is unchanged by this (rendering-only; no new escapes,
      no trailing double-spaces written into files)
- [x] The editor's own round-trip is unaffected — typing in a document, saving,
      and re-reading produces the same bytes as before
- [x] The split is expressed as an explicit option at the `MarkdownView` call
      site, not a global default, with the reasoning in the code
- [x] Plugin surfaces rendering through `MarkdownView` keep today's behavior
      unless they opt in

## Technical Design
### Files to Create/Modify
- `packages/kit/src/markdown/MarkdownView.tsx` (the option + plugin wiring)
- `apps/ui/src/thread/Turn.tsx` (opt in)
- Tests in both

### Notes
- `remark-breaks` may or may not already be a dependency — check before adding.
- Watch the interaction with UI-049, which is adding an `img` override to the
  same component, and with UI-050, which is changing fence CSS.

## Testing Strategy
Component tests for both modes off one fixture. E2E: type a multi-line reply in
the real app and assert the rendered turn has the breaks while a hard-wrapped
document body does not.

## E2E Verification Log

**Model: Opus 5 (1M context).** Implemented with UI-050 (same files).

### The scoping decision — narrower than the recommendation, and why
Shipped: **`hardBreaks` on user turns only**, not on all turns. Document bodies
are unchanged, as recommended; the refinement is *inside* the turn.

This is a narrowing of "thread turns, not document bodies", made on measurement
rather than taste — and it is the conservative direction, because the
recommendation as written would have changed how every existing agent turn
displays. The live workspace at `~/cos/data/threads` (6 threads, 21 turns) says:

| author | turns | turns with a soft newline | soft newlines |
|---|---|---|---|
| user | 10 | **0** | 0 |
| agent | 11 | **10** | 60 |

Applying breaks to every turn would have put **60 `<br>`s through 10 of the 11
agent turns** — the agent hard-wraps its prose at ~80 columns, so paragraphs and
list continuations would have become ragged — while changing **nothing at all**
for the 10 existing user turns, which contain no newline (until UI-052, `↵`
submitted, so a multi-line user turn was not something you could type). Every
benefit of the change is in user turns; every regression is in agent turns.

The distinction is the same one the issue draws between surfaces, applied one
level down: an agent turn *is* authored markdown — the agent writes markdown
files for a living, and markdown already gives it two ways to write a break
(two trailing spaces, a backslash), both of which still work and are tested. A
person typing into a textarea has no such key, only `↵`.

Reversing this is a one-line change at the call site
(`hardBreaks={turn.author === "user"}` → `hardBreaks`) — flagged to the
orchestrator rather than buried, since it decides how existing turns look.

### The seam
`MarkdownViewProps.hardBreaks?: boolean`, default `false`, choosing between two
hoisted plugin lists (`REMARK_PLUGINS` / `REMARK_PLUGINS_HARD_BREAKS`) so the
array identity stays stable — a fresh array is a fresh tree in react-markdown,
which is the bug the memoised `components` object already exists to avoid.
`remark-breaks@4` added to `packages/kit`'s dependencies (it was not present).
Nothing about the write path is touched: this is a render-time plugin, the
composer sends the same bytes, and the editor never renders through
`MarkdownView` at all.

**The property that made this safe for UI-051.** A selection inside a turn is
mapped rendered-text → markdown, so if the `<br>` had *replaced* the newline the
two projections would have stopped agreeing and every comment spanning two typed
lines would have silently started declining. `mdast-util-to-hast` emits the
`<br>` **and** a `"\n"` text node beside it — verified directly against the
installed packages, then pinned by a test in both `MarkdownView.test.tsx` and
`turnBreaks.test.tsx` (`p.textContent === "line one\nline two"` in both modes).

### Real browser (Chromium via Playwright, dev server on `CORPUS_UI_PORT=5985`)
Typed into the **real reply composer** with real keystrokes:
`check 6.1%` · `↵` · `then rerun` · `⌘↵`.

- Before submitting, the textarea held `"check 6.1%\nthen rerun"` — `↵` inserted
  and did not send (SPEC.md §11's contract).
- The appended user turn rendered with `br: 1`, `innerText:
  "check 6.1%\nthen rerun"`, box height **49px** against a 24.3px line height —
  two drawn lines.
- The agent turn beside it (`"the rate\nlooks stale"`) rendered with `br: 0`,
  `innerText: "the rate looks stale"`, height **24px** — one drawn line, the
  space CommonMark says a newline is.
- Screenshot: `/tmp/turn-breaks.png`.

### Tests
- `packages/kit/src/markdown/MarkdownView.test.tsx` — 5 new (both modes off one
  fixture; the rendered-text alignment property; fences unaffected; refs
  unaffected).
- `apps/ui/src/thread/turnBreaks.test.tsx` — 5 new. Named for the behavior
  because `Turn.test.ts` already exists: TypeScript's wildcard `include` keeps
  only the highest-priority extension for a shared basename, so a
  `Turn.test.tsx` beside it is dropped from the program — it typechecks against
  nothing and ESLint's project service refuses to parse it (hit, diagnosed,
  avoided).
- `apps/ui/e2e/turn-breaks.spec.ts` — new spec, 2 tests (above).

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
