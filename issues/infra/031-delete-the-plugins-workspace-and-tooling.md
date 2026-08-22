# [INFRA-031] Delete the plugins workspace, its tooling and its docs

## Domain
infra

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SHARED-067 (signed and applied)

## Spec References
- SPEC.md — §10, §12 and §13 are deleted; the plugin concept is gone from §1, §3, §4, §5, §7, §9 and §12

## Summary

Part of Phase 41. The plugin surface and the todos plugin are removed entirely,
on the user's instruction: *"I want it fully gone, no trace of it in the codebase
or the specs."* `todo` is not a document type.

The full inventory for this area is in the orchestrator's brief to the
implementing agent. Two rules bind every part of this phase:

1. **A document carrying an unrecognised `type:` must still open, render with
   working checkboxes, search, and pass `doc check`.** That is SPEC §12's M6, and
   it is what protects the user's existing `type: todo` documents.
2. **Where a rule existed only because a plugin might, delete it. Where it
   survives its cause, keep it and restate the reason.** A docblock explaining a
   constraint by a plugin that no longer exists is worse than no docblock.

## Acceptance Criteria
- [x] No reference to plugins or todos remains in this area
- [x] Rules that outlive their plugin justification are kept and restated
- [x] Nothing that only existed for plugins is left behind as a stub

## E2E Verification Log

**Model: Opus 5 (1M context). 2026-08-22.**

68 files deleted under `plugins/` (`todos` 53, `_fixture` 14, `.gitkeep`) — exactly the
count the brief predicted. 35 further files changed.

**The judgement on `eslint.config.js`.** The core→plugin ban and the three-file
discovery allow-list are vacuous and gone. One clause of the kit-only rule survives its
cause and is kept: **`apps/ui` may not import `@corpus/contract/client`.** The old rule
justified that by "a plugin bypasses the kit's cache" — but the reason was always the
cache, and `apps/ui` is now the kit's only consumer, so it inherits the reason exactly.
Measured before writing the rule: zero such imports anywhere under `apps/ui`, so the rule
pins the tree rather than creating work. `scripts/eslint-boundaries.test.ts` was rewritten
to prove that rule in both directions instead of being deleted.

A second candidate was **rejected and the rejection recorded in the config**: "never reach
into a workspace by path". `no-restricted-imports` matches the specifier text, so a sibling
import written the short way (`../../cli/src/x.js` from `apps/server/src`) carries no
`apps/` segment and escapes any such pattern, while `rootDir` already rejects the ones it
would catch, at build time.

**Gates, all run on the final tree.**

| gate | result |
| ---- | ------ |
| `npm run build` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm test` | exit 0 — 575 files, 13,648 tests, 0 failures |
| `npm run package:build` | exit 0 — no plugins stage, 27 staged artifacts |
| `npm run pack:check` | exit 0 — 27 files, 1.05 MB packed / 3.49 MB unpacked |
| `npm run version:check` | ✓ every manifest 0.17.0, working tree and HEAD |
| `npm run spec:check` | ✓ 6,053 citations across 1,484 files |

**Lockfile.** After `npm install`, npm marked the two `plugins/*` entries `extraneous`
rather than dropping them, so the entries were removed by hand and `npm install` re-run to
confirm it does not re-add them. The diff is now exactly three hunks and nothing else: the
`plugins/*` workspaces glob, the two `node_modules/corpus-plugin-*` links, and the two
`plugins/*` package entries.

**One pre-existing break fixed in passing.** `scripts/spec-refs.test.ts` expected section
`"11"` from an input string SHARED-067's renumber had already rewritten to `§10`. The
expectation was a bare `"11"` with no `§`, so the sweep could not see it.

**`docs/cli.md` regenerated, not hand-edited.** `npm run build` re-ran the generator and it
dropped a plugin-column example `apps/cli` had already deleted from its source. Committing
the regeneration is what clears `check-generated-artifacts`.

### Escalations — not fixed, by the brief's rule

- **`apps/**` still carries plugin surface.** `apps/cli/src/commands/doc/frontmatter.ts`
  documents `--column` as `<plugin>/<type>` in `--help` and in a user-visible `UsageError`
  hint that promises a "plugin-missing card" no longer drawn. That prose is what keeps two
  `--column <plugin/type>` rows in the generated `docs/cli.md`, which cannot be hand-fixed.
  `frontmatter.test.ts` pins the wording. Further leftovers: `plugin:todos` manifest
  fixtures in `template/manifest.test.ts` and `workspace/upgrade.test.ts`, a
  `plugin.todos.v` extra key in `doc/edit.test.ts`, `COLUMN_REF_PATTERN` in
  `packages/contract/src/schemas/doc.ts` (still validated on create and update, consumed by
  nothing), and roughly 30 doc-comments naming the deleted system across `apps/ui` and
  `packages/kit`.
- **`issues/plugins/` was left intact** — it is the decision record, and
  `design/index.html` still cites `PLUGINS-017` for a live design choice (why no lock
  banner is drawn). Deleting the citation would delete the reason.
- **`issues:check` reports a bookkeeping mismatch** unrelated to this issue: UI-155 is
  `todo` in PLAN.md and `done` in its own file.

### UI-141 / UI-147, checked as asked

- **UI-147 closed out.** `.col.reading` now transitions `border-color` only, matching
  `apps/ui/src/board/Column.css`. Its Decision 1 is answered by a dated reconciliation note
  at the top of the mockup. Its Decision 2 is answered **no**: a hand-written HTML prototype
  is generated from nothing, so there is no artifact to diff it against, and a checker that
  guessed at the correspondence would fail more often than it caught anything. The guard is
  the dated note plus discipline.
- **UI-141 left open, deliberately.** It is not a deletion — it asks for a comments list,
  two filter axes with counts, row sentences, a reveal and a composer, all newly drawn. That
  is `ui-dev`'s work, not a cheap fold-in. The mockup's header note now names it as known
  stale so the next reader is not misled while it waits.
