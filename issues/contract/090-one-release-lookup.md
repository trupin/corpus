# [CONTRACT-090] One release lookup, in the package both consumers already have

## Domain

contract

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: SERVER-050

## Spec References

- SPEC.md §2.4 — Upgrading: the version comparison, and the published-checksum
  requirement that makes `verifiable` a separate verdict from `upgradeAvailable`

## Summary

`GET /api/upgrade/check` has to answer two questions — is there a newer release,
and can it be installed — and both are already answered, correctly and with
their reasoning written down, in `apps/cli/src/commands/upgrade/release.ts`.
That module is not reachable from `apps/server`: apps do not import apps, and
`package:build` bundles the two separately with every `@corpus/*` import inlined,
so a server that imported `@corpus/cli` would carry the whole CLI.

The alternative is a second copy of the judgment in the server. That is the one
duplication here that costs something real. `verifiable` exists precisely
because a release can look upgradable and still be refused, so two
implementations disagreeing is not a hypothetical drift — it is a server that
offers an "Upgrade & restart" button the upgrade then declines, which is the
exact failure `UpgradeCheckSchema`'s prose says a client must never produce.

Move the module to `packages/contract`, which both consumers already depend on.

## Acceptance Criteria

- [x] `lookupLatestRelease`, `selectAssets`, `compareVersions`, `evaluateRelease`
      and their types live in `packages/contract/src/release.ts` and are exported
      from the package index
- [x] `apps/cli/src/commands/upgrade/release.ts` re-exports them, so every
      existing import inside the CLI is unchanged
- [x] `apps/cli`'s release tests pass **unmodified** — that is the evidence the
      move changed no behaviour, and modifying them would destroy it
- [x] Nothing in the moved module performs I/O at import time, and the package
      keeps `sideEffects: false`, so the UI's bundle does not grow a GitHub
      client it never calls
- [x] The module does not import from `./routes/` or the generated client — it
      is shared logic beside `scope.ts` and `turns.ts`, not route surface

## Technical Design

### Files to Create/Modify

- `packages/contract/src/release.ts` — the moved module, verbatim
- `packages/contract/src/index.ts` — one export line
- `apps/cli/src/commands/upgrade/release.ts` — becomes a re-export with a note
  saying where the code went and why

### Key Implementation Details

`packages/contract` is not schemas-only: `scope.ts`, `turns.ts`, `headings.ts`,
`query-keys.ts` and `code.ts` are all shared logic living beside the route
definitions. This is that shelf, and the module belongs on it because it
computes the `UpgradeCheck` the contract publishes — the type and the thing that
produces it end up in one place.

The CLI keeps the file rather than having its imports rewritten. A re-export is
one line per name and leaves `release.test.ts` importing exactly what it
imported before, which is what makes "unmodified tests pass" meaningful.

### Edge Cases

- `DEFAULT_RELEASES_REPO` and the `CORPUS_RELEASES_*` env var names move with
  the code. The server reads the same variables, so a fork or a test fixture
  redirects both consumers at once — which is the point.

## Testing Strategy

The CLI's `release.test.ts` is the test suite for this module and it does not
move: it imports through the re-export and must pass with no edit at all. Add
nothing new — a second copy of those tests in `packages/contract` would be the
duplication this issue exists to remove.

## E2E Verification Plan

### Verification Steps

1. `npm run build` — the whole graph compiles in dependency order
2. `npm test -w apps/cli` — the release suite passes unmodified
3. Falsify: break `compareVersions` in `packages/contract/src/release.ts` and
   confirm the CLI's suite goes red, proving the re-export is live and the tests
   are not silently reading a stale copy

## E2E Verification Log

Run by the orchestrator on **opus** (Claude Opus 5), 2026-08-26.

1. `git mv apps/cli/src/commands/upgrade/release.ts packages/contract/src/release.ts`
   — moved verbatim; the only edit to the body is the import line
   (`@corpus/contract` → `./schemas/upgrade.js`) and a paragraph saying why the
   module now lives here.
2. `npm run build` — full graph, contract → kit → apps, clean.
3. `vitest run apps/cli/src/commands/upgrade` — **95 passed**, `release.test.ts`
   27 of them, with **no edit to any test file**.
4. **Falsification, through the built `dist/`.** Inverted the sign in
   `compareVersions` inside `packages/contract/src/release.ts`, rebuilt *only*
   `packages/contract`, and re-ran the CLI's suite: **7 failed | 20 passed**.
   Restored and rebuilt; green again.

   The rebuild is the part that matters. `@corpus/*` resolves through each
   package's `exports` map into `dist/`, so breaking the source and not
   rebuilding leaves the consumer reading the old bytes and passing — which is
   how three false negatives were recorded in an earlier release. A
   falsification that does not fail is evidence the falsification missed, not
   evidence the test is good.

## Completion Checklist (domain agent)

- [x] Tests pass, CLI's release tests unmodified
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-090]` prefix
