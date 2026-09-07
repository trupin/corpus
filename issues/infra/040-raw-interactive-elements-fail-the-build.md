# [INFRA-040] A raw interactive element outside kit fails the build

## Domain

infra

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: UI-191 (the primitives and the migration — this check encodes
  its end state)

## Spec References

- **CLAUDE.md** → Verification Is On Demand: a diff-scopable check runs
  locally, a whole-codebase check is CI's (user rule, 2026-08-07)

## Summary

The second half of the 2026-09-06 directive:

> "come up with some static check that ensures that those components are
> being used everywhere they should. Make that a pre-commit check + CI check
> so such inconsistencies stop happening."

## What to build

**An ESLint rule, not a bespoke scanner** — recommended and to be confirmed
by the implementer against one alternative, recorded either way. The case:
ESLint already runs diff-scoped on staged TypeScript in pre-commit and
whole-repo in CI, so the rule rides both gates with **zero new hook steps**,
satisfying INFRA-025's placement rule by construction. A bespoke script
would duplicate that wiring for nothing.

- `no-restricted-syntax` (or a small local rule if messages need to name the
  replacement) forbidding JSX `<button>`, `<select>`, `<option>` in
  `apps/ui/src` and `packages/kit/src`, with the message naming the kit
  primitive to use instead — a refusal that does not say the fix is half a
  refusal.
- **Exemptions are files, not comments**: the primitives' own internals
  (UI-191's recorded list) are exempted by path in the ESLint config. No
  inline `eslint-disable` is acceptable for this rule anywhere else — the
  Lint Discipline section already forbids fixing lint by disabling it.
- Native elements that stay legitimate (`<input>` for text, `<a>`, form
  internals inside kit's Composer) are out of scope — the rule bans exactly
  what UI-191 replaced, and the issue records the banned list.

## Acceptance Criteria

- [x] A raw `<select>` added to any apps/ui file fails `npx eslint` on that
      file with a message naming the kit primitive — shown in the log
- [x] Pre-commit blocks it (staged-file path, measured cost ~0 — it is the
      existing eslint step)
- [x] CI whole-repo lint catches a file nobody staged
- [x] Zero violations on the migrated tree; zero inline disables
- [x] The exemption list matches UI-191's recorded internals exactly, with a
      test or comment pinning the two together

## Implementation Record (2026-09-07, implementing agent)

### The gate ridden, and the alternative that was rejected

**ESLint's core `no-restricted-syntax`, configured in `eslint.config.js`.** It
adds **zero** lines to `.githooks/pre-commit` and **zero** steps to
`.github/workflows/ci.yml` — sprint-026 P6's bind. `.githooks/pre-commit`
already runs `npx eslint $staged_ts` and `ci.yml` already runs `npm run lint`,
so the rule is diff-scoped locally and whole-repo in CI by construction, which
is the 2026-08-07 placement rule satisfied without a placement decision.

REJECTED, per the filing's request that one alternative be weighed: a small
custom rule reading the baseline itself. It would buy per-file occurrence
*counts* — a file allowed exactly N raw buttons — and cost a plugin module and
its own RuleTester suite. The orchestrator's ratchet is file-grained, not
occurrence-grained, and `no-restricted-syntax` already carries a per-selector
`message`, which was the only thing that might have forced a custom rule.

### The shape: a ratchet, not an exemption list (orchestrator ruling)

UI-191's Census discrepancy paragraph was correct and is the reason. A bare
"primitives only" list would have been a lie: 38 non-test `.tsx` files still
carry a raw `<button>`. The check ships as INFRA-038's ratchet shape instead.

`scripts/raw-controls-baseline.json` is the whole definition of the check —
banned tags with their messages, the scope, the permanent exemptions and the
grandfathered files. `eslint.config.js` builds the rule from it, so the rule
and its baseline cannot drift apart. Three records must agree, and
`scripts/raw-controls-ratchet.test.ts` is where they are made to:

1. **the tree** — which files carry a raw control today;
2. **`baseline`** — which must name exactly those files, no more and no fewer;
3. **`CLOSED_CENSUS`** in the test — the census taken the day the ratchet
   landed, which the baseline may never exceed.

(1) === (2) forces a migrated file out of the baseline. The rule then locks
that file out for good. (2) ⊆ (3) is what stops a new violation being "fixed"
by appending a line to the JSON.

Two scope decisions, recorded because they are judgment and not measurement:

- **`**/*.test.tsx` is out of scope.** A fixture that renders a bare
  `<button>` to drive a roving-focus hook is not product chrome. Banning it
  would push unit tests into the kit's styling for no gain.
- **Per-tag grandfathering.** Every baseline entry names the tags it keeps, and
  today every entry is `["button"]`. A grandfathered file is therefore **still
  refused** a `<select>` or an `<option>` — UI-191 removed the last native
  dropdown from the product and the baseline does not hand one back.

### The permanent exemption, pinned

`primitives` holds the six files of UI-191's recorded allowed raw-element list:
`Button.tsx`, `Chip.tsx`, `IconButton.tsx`, `Modal.tsx`, `Popover.tsx`,
`Select.tsx` under `packages/kit/src/components/Controls/`. A primitive has to
render something. The test parses UI-191's own "The allowed raw-element list"
section and asserts the two sets are identical, so a seventh primitive cannot
be exempted without the issue recording it. `ScrollArea.tsx` is deliberately
**not** exempt — it renders no raw control, and the test asserts the rule
applies to it in full.

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`).** Worktree
`.claude/worktrees/agent-a46403eebc73683a8`, at `9cc94009 [UI-191] One button,
one dropdown, everywhere`. No git state was changed.

### 1. The rule fires, and the message names the primitive (TEST-1251/2/3)

Probe written to `apps/ui/src/shell/RatchetProbe.tmp.tsx` — a file no baseline
entry names — carrying `<button>`, `<select>`, `<option>`, `<input>`, `<a>`
and `<textarea>`.

```
$ npx eslint apps/ui/src/shell/RatchetProbe.tmp.tsx
  4:7  error  A raw <button> is not the product's button. Use Button, IconButton or Chip from
              @corpus/kit — one shape, one focus ring, one set of tokens (INFRA-040). The
              grandfathered files are listed in scripts/raw-controls-baseline.json, and that
              list may only shrink                                          no-restricted-syntax
  5:7  error  A raw <select> renders native chrome the product does not use. Use Select from
              @corpus/kit — the pill trigger with the custom menu (INFRA-040). No file is
              grandfathered for <select>                                    no-restricted-syntax
  6:9  error  A raw <option> only exists inside a native dropdown. Pass the choices to Select
              from @corpus/kit as its `items` prop instead (INFRA-040). No file is
              grandfathered for <option>                                    no-restricted-syntax

✖ 3 problems (3 errors, 0 warnings)
EXIT=1
```

Three refusals, not six. `<input>`, `<a>` and `<textarea>` are untouched —
sprint-026's Out of scope, "a text input is not a button".

### 2. A grandfathered file keeps `<button>` and is still refused a dropdown

The same probe, with `"apps/ui/src/shell/RatchetProbe.tmp.tsx": ["button"]`
temporarily added to the baseline:

```
$ npx eslint apps/ui/src/shell/RatchetProbe.tmp.tsx
  5:7  error  A raw <select> renders native chrome ... Use Select from @corpus/kit ...
  6:9  error  A raw <option> only exists inside a native dropdown ...
✖ 2 problems (2 errors, 0 warnings)
EXIT=1
```

The `<button>` refusal is gone. The dropdown refusals are not. The baseline was
restored afterwards.

### 3. Pre-commit blocks it, on the step that already existed (TEST-1254)

The **real** `.githooks/pre-commit` was run end to end, with only `git` stubbed
on `PATH` to answer `rev-parse --show-toplevel` and
`diff --cached --name-only --diff-filter=ACM`. Nothing in git changed — the
technique INFRA-025's record recommends.

```
pre-commit ▶ npm audit
audit:check ✓ npm audit: 0 untolerated vulnerabilities ...
pre-commit ▶ eslint (staged)
  2:10  error  A raw <button> is not the product's button. Use Button, IconButton or Chip
               from @corpus/kit ...                                         no-restricted-syntax
✖ 1 problem (1 error, 0 warnings)
pre-commit ✗ eslint (staged) failed — fix the errors above ('npm run format' fixes formatting).
pre-commit ▶ prettier (staged)
All matched files use Prettier code style!
pre-commit ▷ skills:check skipped (no skill or agent profile staged)
pre-commit: blocked. Nothing was committed.
HOOK EXIT=1
```

The failing step is `eslint (staged)`, which pre-dates this issue.
`.githooks/pre-commit` is byte-identical to its pre-sprint state, and a test
asserts it (`not.toMatch(/raw-controls/)`).

**Measured cost.** `TIMING=all npx eslint` over three real UI files reports
`no-restricted-syntax` at **0.046 ms, 0.0%** of rule time — against
`@typescript-eslint/no-misused-promises` at 223.436 ms, 68.5%. The rule visits
an AST ESLint already walks.

### 4. CI catches a file nobody staged (TEST-1255)

`apps/ui/src/reader/UnstagedProbe.tmp.tsx` was created and **not** staged. The
hook passed, because the staged list did not name it:

```
$ bash .githooks/pre-commit          # staged: docs/RELEASING.md
pre-commit ▷ eslint skipped (no TypeScript staged)
pre-commit ✓ (build, lint, typecheck and tests run in CI — INFRA-025)
HOOK EXIT=0
```

The whole-repo run CI performs then caught it:

```
$ npm run lint                        # `eslint .`, exactly ci.yml's step
apps/ui/src/reader/UnstagedProbe.tmp.tsx
  3:5  error  A raw <select> renders native chrome ... Use Select from @corpus/kit ...
  4:7  error  A raw <option> only exists inside a native dropdown ...
✖ 2 problems (2 errors, 0 warnings)
```

`.github/workflows/ci.yml` is unchanged, and a test asserts that too.

### 5. The migrated tree is clean (TEST-1256/1257)

```
$ npm run lint            # after removing both probes
> eslint .
(no output — exit 0)
```

Zero `no-restricted-syntax` errors repo-wide. Zero inline
`eslint-disable ... no-restricted-syntax` anywhere, swept over every tracked
`.ts`/`.tsx` by the test.

### 6. The ratchet has teeth — falsified in both directions

```
$ npx vitest run scripts/raw-controls-ratchet.test.ts
 ✓ scripts/raw-controls-ratchet.test.ts (15 tests) 2665ms
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

**Growing the baseline fails.** `"apps/ui/src/app/App.tsx": ["button"]` was
added to the JSON — a file that carries no raw control:

```
 FAIL > names no file outside the census closed the day it landed
AssertionError: The baseline may only shrink. A file that wants a raw interactive element
and is not in CLOSED_CENSUS needs a kit primitive, not a baseline entry (INFRA-040).:
expected [ 'apps/ui/src/app/App.tsx' ] to deeply equal []

 FAIL > names exactly the files that still carry a raw control
AssertionError: expected { …(38) } to deeply equal { …(39) }
-   "apps/ui/src/app/App.tsx": [
-     "button",
-   ],
      Tests  2 failed | 13 passed (15)
```

Two independent tests refuse it. The second failure is also the **stale-entry**
direction: a baseline entry whose file no longer carries a raw control fails
until the entry is deleted, which is what locks a migration in. The baseline was
restored and the suite returned to 15 passed.

### 7. Checks run

| Check | Result |
| ----- | ------ |
| `npm run lint` (whole repo, `eslint .`) | clean |
| `npx prettier --check` on the three touched files | clean |
| `npx tsc --noEmit -p scripts/tsconfig.json` | exit 0 |
| `npx vitest run scripts/raw-controls-ratchet.test.ts` | 15 passed |
| `npx vitest run scripts/eslint-boundaries.test.ts` | 3 passed (no regression) |

### 8. One environment note, not a finding

This worktree has no `apps/ui/node_modules`, so `@tiptap/*` and `react-router`
did not resolve and `npm run lint` reported 45 pre-existing type-resolution
errors unrelated to this issue (`no-redundant-type-constituents`,
`no-unnecessary-type-assertion` on TipTap `Editor`). Symlinking those two
packages from the main checkout cleared all 45. `npm run build` still fails in
this worktree for the same reason (`vite build` cannot resolve `react-router`),
which is a worktree install gap and not a change made here.
