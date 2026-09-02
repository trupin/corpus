# [UI-187] TipTap 2 carries a shipped advisory with no backport, so the editor moves to 3

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: every commit and every CI run, because the audit gate is zero-tolerance

## Spec References

- SPEC.md **§5** — the styling grammar the editor parses, which is where
  document-supplied attribute *values* enter
- SPEC.md **§6** — the editor

## Summary

`GHSA-cp6q-959q-f8rh` landed 2026-09-02, mid-release:

> Tiptap: `mergeAttributes()` turns an own `__proto__` key into inherited
> executable DOM attributes

Affected range `>=2.0.0-alpha.0 <3.30.4`. This repository is on **2.27.2**, which
is `v2-latest` — the end of the 2.x line. **There is no backport.** The only
remedy is TipTap 3.

`npm audit` reports it as **33 separate advisories**, one per affected
`@tiptap/*` package, all reached through `@tiptap/core`.

## Why an exception was rejected

The audit gate's exception mechanism is deliberately narrow: one entry per
advisory id **plus** the exact lockfile route, dated and self-invalidating
(`scripts/audit-report.ts`). Thirty-three entries to cover one root cause is the
blanket ignore that mechanism exists to prevent, and the existing js-yaml
exception is defensible only because it is build-time and ships in nothing. This
one ships in the UI.

## What was measured before choosing

**The vulnerability appears unreachable in this codebase's usage**, and that is
why this is a P0 upgrade rather than an emergency:

- Every `mergeAttributes` call site (`styledBlock.ts`, `styledMarks.ts`,
  `rawNodes.ts`, `refNode.ts`) passes our own literal objects plus the
  `HTMLAttributes` TipTap builds from a **closed attribute schema declared in
  our code**.
- Every declared attribute renders to a **fixed key name** —
  `data-corpus-align`, `data-corpus-color`, `data-corpus-highlight`,
  `data-corpus-indent`.
- §5's styling grammar (`[x]{color="accent"}`, `::: {align="center"}`) supplies
  attribute **values**, never names.
- `parse.ts` builds every `attrs` object from **explicit literal keys** and never
  spreads parsed input. Line 262 reads the parsed style and writes only `color`
  and `highlight`, so a stray key is dropped there.

So no document text becomes an attribute name. **That is an argument for calm,
not for inaction** — it rests on a reading of our own call sites, and the
dependency is still carrying a live advisory in shipped code.

## Acceptance Criteria

- [x] Every `@tiptap/*` dependency is at a version outside the advisory's range
      (`>= 3.30.4`), and `node --import tsx scripts/check-audit.ts` passes with
      **no new exception**
- [x] The editor's behaviour is unchanged: the markdown round-trip, §5's styling
      grammar, tables, task lists, links, images, refs and raw nodes
- [x] `apps/ui`'s unit suite and the Playwright editor specs pass
- [x] No `@tiptap/*` version is pinned to a range that would silently accept the
      vulnerable line again

## Technical Design

### Files to Create/Modify

- `apps/ui/package.json` — 13 `@tiptap/*` dependencies
- `apps/ui/src/editor/markdown/` — 37 files reference `@tiptap`; most are type
  imports and `Node`/`Mark` definitions, which 3.x keeps

### Notes

- **The round-trip tests are the safety net.** `corpus.test.ts`,
  `roundtrip.test.ts` and `serialize.test.ts` assert the document model directly,
  so an API change that alters parsed output fails loudly rather than subtly.
- TipTap 3 reorganised some extension packages. Expect import moves rather than
  behaviour changes, and treat any behaviour change as a finding to report rather
  than to absorb.

## Testing Strategy

The existing editor suites are the test. Nothing new is needed to prove an
upgrade that is meant to change nothing — what is needed is that the existing
assertions still hold, and that the audit gate passes without an exception.

## E2E Verification Log

Model: **opus** (claude-opus-5, 1M context). Date: 2026-09-02.

### Baseline, before the upgrade

- `node --import tsx scripts/check-audit.ts --tolerate-unreachable` → **exit 1**,
  "35 vulnerable package(s), 33 unexcepted advisory(ies)".
- `vitest run apps/ui/src/editor/markdown` → 5 files, **796 passed**.

### What moved

- `apps/ui/package.json`: all 13 `@tiptap/*` deps `^2.27.2` → `^3.31.0`. The
  lockfile now carries 40 `@tiptap/*` entries, **every one at 3.31.0**, and none
  in `<3.30.4`. `^3.31.0` cannot resolve back into the advisory's range.
- `markdown/tableNode.ts`: `import Table from` → `import { Table } from`.
  `@tiptap/extension-table` v3 dropped its default export. It is the only one of
  the 13 that did — `extension-image`, `extension-link`, `suggestion`,
  `starter-kit` and the five table/task shim packages all keep theirs.
- `editor/DocEditor.tsx` and `menu/useSelectionContextMenu.test.tsx`:
  `setContent(x, false)` → `setContent(x, { emitUpdate: false })`. v3 replaced
  the positional `emitUpdate` with an options object. Three call sites, same
  meaning.
- `markdown/schema.ts`: four StarterKit v3 extensions switched **off** — see
  below. No node, mark or attribute in the schema changed.
- `markdown/schema.test.ts`: **new**, the guard for the next bump.

### The finding: StarterKit v3 ships four extensions v2 did not

Confirmed by reading `node_modules/@tiptap/starter-kit/dist/index.js`. Two of
them collided with names this schema owns, one changed every document, and
**the round-trip suite could not see any of it**.

1. **`TrailingNode` appends an empty paragraph to every document.** Measured on
   a live editor: a document parsed to `["table"]` came back `["table",
   "paragraph"]`, and the same for `heading`, `codeBlock`, `horizontalRule` and
   `bulletList`. `roundtrip.test.ts`, `serialize.test.ts` and `corpus.test.ts`
   all stayed green because they run the parse and the serializer and never
   build an editor — and the serializer drops a trailing empty paragraph. The
   document model had stopped matching the file while the bytes were identical.
2. **`Link` collides with the `Link.configure` in `corpusExtensions`.** TipTap
   logs `Duplicate extension names found: ['link', 'underline']` and keeps one.
   Measured, this repository's won — the rendered `rel` was still
   `noreferrer noopener` and not StarterKit's `noopener noreferrer nofollow` —
   but which one wins is not a documented guarantee.
3. **`Underline` collides with §5's `UnderlineMark`** (`styledMarks.ts`), the
   same way.
4. **`ListKeymap` rewrites Backspace and Delete at a list boundary.** No schema
   effect, and a §6 gesture change that a security upgrade should not make.

All four are disabled with a reason written beside each. `history` is also
renamed `undoRedo` in v3 — nothing configured it, so only the docblock changed.

### Verification

- `npm run build` → clean (contract, kit, cli, server, ui).
- `npm run typecheck` → **exit 0**, every workspace.
- `npm run lint` → **clean**. `npm run format:check` → clean.
- `vitest run apps/ui` → 187 files, **4059 passed, 0 failed**. No assertion was
  changed; the two `setContent` edits are call-site API, not expectations.
- `vitest run apps/ui/src/editor apps/ui/src/menu apps/ui/src/anchors
  packages/kit` → 110 files, **2718 passed**.
- Playwright, `CORPUS_UI_PORT=5273`: editor-focused set (editor, clipboard,
  format-toolbar, styled-text, table-pipes, list-blocks, fences, soft-wrap,
  images, render-fixes) → **82 passed**; anchors/menu/comment set (anchors,
  anchor-layer, changelog, context-menu, edit-session-close, turn-comment,
  comment-move, reveal, smoke, frontmatter-chips, query-editor,
  autocomplete-keys) → **123 passed**.
- `npm run e2e` (full suite) → **681 passed, 1 failed**. The one failure is
  `foot-geometry.spec.ts:126` and is **not this upgrade**: it pins
  `reflected: "2026-08-19T10:00:00.000Z"` and asserts the label reads
  `since 1w`. Today is 2026-09-02, so the label correctly reads `2w`. It fails
  on an unchanged tree and touches no TipTap code. Reported separately.
- `node --import tsx scripts/check-audit.ts --tolerate-unreachable` → **exit 0**,
  zero `@tiptap` findings, `scripts/audit-report.ts` untouched. The strict form
  (no flag, what CI runs) → **exit 0**.

### The new guard, and its falsification

`apps/ui/src/editor/markdown/schema.test.ts` (10 tests) asserts against a **live
editor** what the parse tests cannot: that the editor holds no node the parse
did not produce, that no extension name resolves twice, and that a link carries
the `rel` this repository configures.

It is falsified. With the four `false` lines removed, **8 of its 10 tests fail**;
with them, all 10 pass. Two details it had to get right, and got wrong first:

- The editor must be built empty and filled by `setContent`. `TrailingNode`
  reacts to a transaction, so an editor built with `content:` in its constructor
  reports clean while the same editor one keystroke later does not. The first
  draft built it full and passed against the defect.
- The duplicate check must read `editor.extensionManager.extensions`, not
  `corpusExtensions()`. StarterKit is one extension named `starterKit` whose
  children exist only after the manager resolves it, so a check over the list
  the module returns sees one name and reports nothing.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
