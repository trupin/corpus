# [CLI-083] `updated:` restamps count as modification

## Domain

cli

## Status

done — 2026-09-06, implemented with its sibling by one cli-dev agent
(one mechanism); committed on phase-58

## Priority

P0

## Model

opus

## Dependencies

- Depends on: **CONTRACT-098** (the importable key sets)
- Related: CLI-081, CLI-082 (both consume the same comparison), UI-189 (its
  presentation key rides the same mechanism)

## Spec References

- SPEC.md **§5** — server-stamped core fields; **§4** — upgrade

## Summary

Reported from a real upgrade (0.32.0 → 0.33.0, `cos` workspace, 2026-09-06).

Server-stamped keys — `updated:` foremost — make a content-identical file
read as "edited here" in the template comparison. This never conflicts alone,
but it widens every diff and can turn a no-op into a flagged file.

## What to build

The template comparison (`apps/cli/src/template/plan.ts` and the manifest
hashing) ignores server-stamped frontmatter keys when deciding whether a file
diverges from baseline. Enumerate the ignored set from one place (the
contract already knows which core fields the server stamps — reuse, never
restate), and record which keys made the list and why. A file whose only
delta is stamped keys is **unmodified**: not flagged, and eligible for a
clean template update.

## Acceptance Criteria

- [ ] A template file touched only by an `updated:` restamp reads unmodified
      and upgrades cleanly — E2E on a real workspace
- [ ] The ignored-key set is derived from the contract's own definition, with
      a drift test
- [ ] A file with a stamped delta AND a real edit still reads modified
- [ ] `workspace diff` output for a stamp-only file shrinks to nothing (or
      states the file is stamp-only — decide and record)

## E2E Verification Log

**Model: Fable 5 (claude-fable-5).** Implemented together with UI-189 (one
mechanism, sprint-024 P1/S1), 2026-09-06.

### Decisions recorded (sprint-024 requires them in writing)

- **The ignored-key set.** `UPGRADE_IGNORED_KEYS` in
  `apps/cli/src/template/ignored-keys.ts` is the union of the contract's
  `SERVER_STAMPED_FRONTMATTER_KEYS` (`created`, `updated`) and
  `PRESENTATION_FRONTMATTER_KEYS` (`width`), formed in **one** expression at the
  call site — the contract deliberately exports the classes, not the union.
  `created` rides along with `updated` because both are server clock stamps and
  the contract declares them as one class; ignoring one and not the other would
  be two answers to "is a stamp an edit".
- **O2, the residual case** (upstream changed the file AND the local delta is
  only ignored keys): manifests written by this tool record a per-entry
  `normalizedSha256` (optional field, still `version: 1`, structural `isEntry`
  reads both generations); with it recorded the case reads `update`. A
  **legacy** entry has only the raw sha, the baseline's bytes are gone, its
  normalized form is unrecoverable, and the verdict falls back to the raw
  comparison: `keep-modified`. Never guess a baseline. Pinned by
  `plan.test.ts` ("reads the same delta against a LEGACY baseline as
  keep-modified") and `upgrade.test.ts` ("honestly reports the legacy residual
  case as a conflict").
- **`workspace diff` on a stamp-only file** (TEST-1096): not empty output and
  not a raw diff — **one line naming the keys**, the same for a `width`-only
  file. Under `--json` the report carries `ignoredKeyDelta: ["updated"]`, the
  verdict stays `current`, `diff` is `null`.
- **P5 preservation.** The `update` write no longer copies bytes:
  `preserveUpgradeIgnoredKeys` writes the template's content with the
  workspace's ignored keys carried over (replace in place, append before the
  closing fence for a key the template lacks, and a key the workspace lacks
  keeps the template's value). The manifest records the **merged** bytes' raw
  and normalized shas, so the next run reads the file as current.
- Normalization is **line-based, not YAML-parse-based**: parsing and
  re-serializing would erase comments and formatting and make genuinely
  different files compare equal, and it would put `yaml` on the startup path
  (CLI-058). Dropping top-level ignored-key lines (plus indented continuations)
  inside the fence erases exactly the ignored delta and nothing else.

### Pre-fix reproduction

The reporting incident is the real 0.32.0 → 0.33.0 upgrade of the `cos`
workspace (2026-09-06, cited in this issue and sprint-024): content-identical,
`updated:`-restamped files read "modified here". The pre-fix comparison is a
raw-sha equality (`plan.ts` before this change), and the legacy-manifest tests
above reproduce exactly that arithmetic on the current tree.

### E2E, real workspace, built CLI (`apps/cli/dist/bin/corpus.js`, tool 0.33.0)

1. `corpus init` in a scratch dir → 36 files installed; the manifest records
   `normalizedSha256` on all 36 entries (verified by reading
   `.corpus/template-manifest.json`).
2. `corpus server start` (port 8767) → **real restamp**: `corpus doc edit
   doc_seedinbox --key … -m "temporary body"`, then a second edit back to the
   original body. On disk `data/docs/views/inbox.md` then differed from the
   template at **one line**: `updated: 2026-09-06T15:55:46Z` (verified with
   `cmp`: "differ: char 92, line 6").
3. `corpus workspace diff data/docs/views/inbox.md` → exit 0, no diff body, one
   line:
   `differs from the copy corpus 0.33.0 ships only in updated — server-stamped and presentation frontmatter, not an edit. An upgrade treats this file as current and keeps this workspace's values for those keys.`
4. Stopped the server, appended an upstream sentence to the worktree's
   `assets/workspace/data/docs/views/{inbox,attention,open-threads}.md`
   (the "new tool changed the file" side), ran `corpus workspace upgrade`:
   ```
   upgrade (tool 0.33.0 → 0.33.0):
     update  data/docs/views/attention.md
     update  data/docs/views/inbox.md
     keep    data/docs/views/open-threads.md — modified here — 2 lines only here, 2 lines only in the new copy
             unresolved — corpus workspace diff data/docs/views/open-threads.md
   wrote 2 files in commit 621442d…
   ```
   - TEST-1093: the stamp-only file's verdict is `update`, not a conflict.
   - TEST-1094: the written `inbox.md` carries the new template body **and**
     `updated: 2026-09-06T15:55:46Z`; the template's fixed
     `2026-07-26T00:00:00Z` is gone from the file.
   - TEST-1095: `open-threads.md` (restamped **and** genuinely edited through
     `doc edit`) reads `keep`, reported as a conflict, file untouched.
5. A second `corpus workspace upgrade` reports only `open-threads.md` — the
   merged writes recorded their own hashes, so the updated files read current.
6. Template files restored afterwards; scratch server stopped (pid 62052), port
   8767 verified free.

### Checks

- `npm run typecheck -w apps/cli` — clean.
- Full `apps/cli` suite (the one workspace-scoped run, `VITEST_MAX_THREADS=4`):
  **114 files, 2400 tests, all pass** — includes the registry byte-budget
  validation (help prose additions fit) and the docs drift test.
- `eslint` and `prettier --check` on every changed file — clean.
- `docs/cli.md` regenerated (`npm run docs:cli -w apps/cli`), no leftover diff.

### Drift protection (TEST-1091/1092)

No literal key set exists outside `packages/contract`: the CLI derives the
union from the contract's exports, and the server (since CONTRACT-098) calls
`isPresentationFrontmatterKey`. `ignored-keys.test.ts` drives an `it.each` over
the contract's own lists — a key added there is exercised with no test edit —
and pins the union as exactly the two classes. The server-side drift test is
`apps/server/src/docs/frontmatter-key-classes.test.ts` (CONTRACT-098).
