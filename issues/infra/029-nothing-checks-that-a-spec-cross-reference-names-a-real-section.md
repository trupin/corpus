# [INFRA-029] Nothing checks that a SPEC cross-reference names a real section

## Domain

infra

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: SHARED-046 (the sweep this guard was the other half of)

## Spec References

- SPEC.md — the whole document is the input

## Summary

SHARED-046 corrected eleven citations of a **§9.4 that does not exist** — three
in SPEC.md, one in `packages/contract/src/schemas/key.ts` (and from there the
generated client, so it shipped), two in server and UI source, and ten in issue
files. The sweep is done and verified.

**The guard it asked for was not built.** SHARED-046's fourth acceptance
criterion named a check that no SPEC cross-reference names a non-existent
section, with `scripts/check-issues.ts` as the precedent. Nothing under
`scripts/` reads `SPEC.md` at all. Found by PR #49's review, which also found
that I had flipped SHARED-046 to `done` on the strength of the sweep alone.

**Why the guard is the point.** A citation to a section that does not exist reads
exactly like one that does. Nobody found §9.4 by reading; it was found by a
structural sweep four months and eleven copies later, having propagated through
the issue files people copy from and into a published artifact. The next `§9.5`
will do the same thing, and the sweep does nothing to stop it.

## Acceptance Criteria

- [x] A script enumerates SPEC.md's own headings and checks every `§N`/`§N.M`
      citation in the repository against them
- [x] It covers **SPEC.md itself** — three of the eleven were there — and source
      under `apps/`, `packages/`, `assets/` and `scripts/` (and `docs/`,
      `design/`, `.claude/`, `.githooks/`, the root markdown: the walk is a
      deny-list, so nothing escapes by being added later)
- [x] Issue files are covered or deliberately excluded, and the choice is stated:
      **excluded**, with the cost named — E2E log → *Exclusions*
- [x] Generated artifacts (`openapi.json`, `schema.generated.ts`) are excluded —
      taken from the `GENERATED_ARTIFACTS` inventory rather than re-listed, so
      the two cannot drift
- [x] Wired into CI (`CI / validate`, beside `issues:check`). **Not in pre-push**,
      and the reasoning is demonstrated rather than assumed: renumbering one
      SPEC heading strands 25 citations across 10 files that no diff of that
      commit contains — E2E log → step 5
- [x] It fails on a seeded bad citation and passes on the tree as it stands —
      both demonstrated (E2E log, steps 1–4), and it found two live defects the
      SHARED-046 sweep missed on its first run

## Technical Design

### Files to Create/Modify

- `scripts/check-spec-refs.ts` (new) — modelled on `scripts/check-issues.ts`
- `package.json` — a `spec:check` script
- `.github/workflows/*` — the CI wiring

### Key Implementation Details

`scripts/check-issues.ts` is the precedent for shape, exit code and the tone of
the failure message — read it first. Its message tells the author what to fix and
why the check exists, rather than only what failed.

**Match the citation form the repo actually uses**, which is `§` followed by
digits and dots, sometimes inside backticks, sometimes followed by a word
(`§9.2's`). Anchor on the heading set extracted from SPEC.md rather than a
hand-kept list, or the check becomes the same class of defect it is guarding
against.

**The exclusion list is the risky part.** An over-broad exclusion makes the check
pass vacuously. Prefer excluding by *path* (generated files) over excluding by
*pattern*, and assert in a test that the check would have caught the historical
§9.4 citations at the paths where they actually lived.

### Edge Cases

- A citation inside a fenced code block quoting an error message
- `§7`-style whole-section citations as well as `§9.2` subsections
- A heading that exists but is written differently in the citation (`§9.2` vs
  `§ 9.2`)

## Testing Strategy

Unit tests over a fixture SPEC and fixture sources: a valid citation passes, an
invalid one fails and names the file and line, an excluded path is not read. Then
the historical case: seed `§9.4` at the three paths it lived at and assert the
check reports all three.

## E2E Verification Plan

### Verification Steps

1. `npm run spec:check` on the tree as it stands — passes
2. Seed `(§9.9)` into SPEC.md and into a source file — fails, naming both
3. Revert; passes again

## E2E Verification Log

Implemented on **opus** (`claude-opus-5[1m]`), branch `phase-34-a-resident-without-a-profile`.

### What shipped

- `scripts/spec-refs.ts` — heading extraction, citation scanning, the walker,
  the exclusion list and the failure messages
- `scripts/check-spec-refs.ts` — the runner (`npm run spec:check`), modelled on
  `scripts/check-issues.ts` for shape, exit code and message tone
- `scripts/spec-refs.test.ts` — 40 tests
- `package.json` → `spec:check`; `.github/workflows/ci.yml` → a `SPEC
  cross-references` step beside `issues:check`, before the build

### 1. `npm run spec:check` on the tree as it stands

First run — **two real defects, one of them the very thing SHARED-046 swept for**:

```
$ node --import tsx scripts/check-spec-refs.ts
spec:check ✗ 13 citation(s) name a section SPEC.md does not have

  apps/ui/src/editor/markdown/serialize.ts:849 cites §5.3 — §5 has no subsections
  design/index.html:1088 cites §9.4 — §9 has §9.1, §9.2, §9.3
      …r: it appears in the text, live, which is the event itself (§9.4).
  scripts/spec-refs.ts:… (11 more — the check's own docblocks, see below)
```

- **`design/index.html:1088` cited the missing §9.4.** SHARED-046's sweep did not
  reach `design/`, so a twelfth copy was sitting in the tree the whole time the
  issue was marked `done`. Repointed to `§9.2`, the same correction SHARED-046
  applied everywhere else (`GET /api/agents` … "behind the ordinary invalidate
  keys (§9.2)").
- **`apps/ui/src/editor/markdown/serialize.ts:849`** cited CommonMark's §5.3 with
  no document named, in a file that also cites SPEC.md §10 and §6. Rewritten as
  `(CommonMark §5.3, "Lists")` — which is what the check asks for, and a better
  comment than the one it replaced.
- The other eleven were **the check's own docblocks**, which quote the missing
  9.4 to explain themselves. Fixed by naming the missing sections in prose
  ("section 9.4") rather than by excluding `scripts/spec-refs.ts` — see
  *Exclusions* below. (The CI step's own comment was caught the same way on the
  next run, which is the mechanism working on its author.)

Also found and fixed while getting here: the walker's first binary sniff was a
NUL byte, which classified `apps/server/src/watcher/self-writes.ts` (ordinary
TypeScript that joins a path and a digest with a NUL separator) as binary and
**silently dropped it from the scan**. Replaced with strict UTF-8 validity, and
every unread file is now reported by path and reason instead of vanishing.

Clean run:

```
$ npm run spec:check
spec:check ✓ 5764 citation(s) across 1514 file(s), against 22 section(s) of SPEC.md
spec:check ▷ not read (not-utf8): corpus-0.0.0.tgz
EXIT=0
```

0.28 s wall clock. The counts print on success as well as failure, so a run that
stopped looking cannot read as a clean tree.

### 2. Seed a bad citation into SPEC.md **and** a source file — fails, naming both

```
$ # SPEC.md:419 ← "(`corpus db rebuild`, §9.9)"
$ # apps/server/src/edit/sessions.ts:168 ← "(§9.2)" → "(§9.9)"
$ npm run spec:check
spec:check ✗ 2 citation(s) name a section SPEC.md does not have
  apps/server/src/edit/sessions.ts:168 cites §9.9 — §9 has §9.1, §9.2, §9.3
      * those writes land live instead (§9.9). Free by construction —
  SPEC.md:419 cites §9.9 — §9 has §9.1, §9.2, §9.3
      …ctible from the workspace at any time (`corpus db rebuild`, §9.9).
EXIT=1
```

Both named, with file, line, excerpt and the sections §9 *does* have.

### 3. Revert — passes again

```
$ npm run spec:check
spec:check ✓ 5764 citation(s) across 1514 file(s), against 22 section(s) of SPEC.md
EXIT=0
$ git diff --stat SPEC.md apps/server/src/edit/sessions.ts
(empty)
```

### 4. The historical §9.4, at the three paths it lived at

`scripts/spec-refs.test.ts` seeds it into a fixture repository at `SPEC.md`,
`packages/contract/src/schemas/key.ts` and `apps/server/src/edit/sessions.ts` and
requires **all three** to be reported, each as `9.4`; a companion test repoints
them to `§9.2` and requires a pass. Two more assert that no exclusion spares any
of the three paths, and that the real-tree run actually reads them — a green line
from an over-broad exclusion is indistinguishable from a green line from a clean
tree, so the pass is asserted together with what it read.

### 5. Why this is CI's and not the hooks' (INFRA-025's rule, demonstrated)

The citation half is diff-scopable; the heading half is not, and the heading half
is the one that matters. Renumbering `### 9.3` → `### 9.4` in SPEC.md alone:

```
$ perl -0pi -e 's/^### 9\.3 Contract-first/### 9.4 Contract-first/m' SPEC.md
$ npm run spec:check
spec:check ✗ 25 citation(s) name a section SPEC.md does not have
  .gitattributes:1 · apps/cli/src/docs/generate.ts:9 · apps/server/src/docs/routes.ts:39
  apps/server/src/ui-runtime-config.ts:11 · packages/contract/scripts/generate.ts:4
  packages/contract/src/client/events.ts:9 · … 19 more
```

**Twenty-five citations in ten files, none of them in that commit's diff.** A
staged-file version of this check would have passed the exact commit that broke
them. Nothing here is unrecoverable after the fact either — unlike a `v*` tag,
which is why `version:check` is pre-push's one survivor — so PR time is early
enough, four months and eleven copies earlier than the sweep that found it.
Wired into `CI / validate` beside `issues:check`, before the build (it needs
none). **Not added to any hook.**

### Exclusions, and what each one costs

Scope is a **deny-list**: everything under the repo root is read unless named
below, so a directory added later is covered by default rather than by remembering
to add it. Every exclusion is a repo-root-**anchored** path, never a glob — a test
asserts that (`apps/server/src/issues/` stays covered; only the tracker at the
root is spared), and another asserts that none of them spares the three paths the
historical citation lived at.

| Not read                                                                                | Why                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contract/openapi.json`, `…/schema.generated.ts`, `docs/cli.md`                 | Generated. Taken from `GENERATED_ARTIFACTS` in `scripts/generated-artifacts.ts` so the two lists cannot drift. They inherit citations verbatim from source, so reading them reports one defect twice and points the reader at a file it is wrong to edit. |
| `issues/`                                                                                | The deliberate one. See below.                                                                                                                                                                  |
| `.claude/worktrees/`                                                                     | Agent worktrees are checkouts of this repo, not repo content.                                                                                                                                   |
| `node_modules/`, `dist/`, `dist-package/`, `build/`, `coverage*/`, Playwright output      | Dependencies and build output, skipped by directory name at any depth.                                                                                                                          |

**`issues/` is excluded, and it is a real loss.** Issue files legitimately hold
citations that are wrong on purpose: `issues/shared/046-*` and `048-*` quote the
missing 9.4 in order to *describe* it, this file seeds 9.9 and 9.5 as examples,
and several use `§` for something else entirely (`§957–1002` is a line range in
`docs/cli.md`; `§0` names a section of an issue's own log). Covering them would
have taken a per-occurrence allowlist that needs a new entry every time somebody
writes an issue about a citation defect — and since a closed issue is never
edited again, that allowlist could only grow until it, rather than SPEC.md, was
the thing certifying citations. The loss is that a wrong citation is not caught in
the issue file it is drafted in; it is caught the moment it is copied into
SPEC.md, source, `assets/`, `docs/` or `design/`, which is the moment it becomes
something a user can be shown. Including `issues/` today would report 1 real stale
citation (`issues/agent/002` cites a §10.2 that no longer exists) against ~20
deliberate ones.

**No exemption for the check itself.** `scripts/spec-refs.ts`, its runner and its
tests are all inside the tree they walk. Rather than exclude them, the docblocks
name missing sections in prose and the test file assembles its bad citations from
a `SIGN` constant. A checker that excludes itself is not a checker, and the
alternative would have been the first entry on that list with no reason behind it
except convenience.

**One thing is decided by pattern rather than path, deliberately.** `§` is not
only SPEC.md's: `apps/ui/src/editor/markdown/` discharges CommonMark and GFM
proofs in files that cite SPEC.md sections in the neighbouring comment, so this
cannot be settled by path. A citation is attributed to another document when that
document's name sits immediately before the `§` **on the same line**
(`FOREIGN_DOCUMENTS = ["CommonMark", "GFM"]`). Same line, not a window over the
surrounding prose: a window would also silence every real SPEC citation that
happens to follow a mention of CommonMark, and its reach would not be visible at
the point of use. The failure mode is a message telling the author to name the
document, which is how `serialize.ts:849` got fixed.

### 6. Gates

```
$ npx eslint scripts/spec-refs.ts scripts/spec-refs.test.ts scripts/check-spec-refs.ts \
      apps/ui/src/editor/markdown/serialize.ts     → No issues found
$ npx tsc --noEmit -p scripts/tsconfig.json        → exit 0
$ npm run format:check                             → All matched files use Prettier code style
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/spec-refs.test.ts
                                                   → 40 passed
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts
                                                   → 782 passed, 1 failed
```

The one `scripts` failure is `workspace-template.test.ts` asserting on
`assets/workspace/claude/skills/orchestrate/SKILL.md`, which another agent has
modified in this working tree. Untouched by this issue.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[INFRA-029]` prefix
