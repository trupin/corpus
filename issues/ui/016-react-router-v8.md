# [UI-016] Migrate to react-router v8 (clears GHSA-qwww-vcr4-c8h2)

## Domain

ui

## Status

blocked

## Priority

P1

## Model

opus — a mechanical major-version migration with a green e2e suite as the bar.

## Dependencies

- Depends on: UI-029 (React 19 prerequisite — ruling 2026-07-31, option 1), UI-005
- Blocks: —

## Spec References

- GHSA-wrjc-x8rr-h8h6 — open redirect via backslash in <Link>/useNavigate (high, 6.0.0–8.2.0)
- GHSA-337j-9hxr-rhxg — arbitrary constructor injection via deserializeErrors (SSR-only)
- GHSA-qwww-vcr4-c8h2 — RSC-mode CSRF (RSC-only), vulnerable 7.12.0–8.2.0
- issues/infra/010-audit-brace-expansion-vitest-peer.md

## Summary

The installed router is `react-router-dom@6.30.4` — the line the code is actually written for
(App.tsx passes v6 `future` flags; INFRA-010 found the declared `^7.18.2` had never truly
installed). npm audit unions three high advisories across 6.0.0–8.2.0, so NO 6.x or 7.x release
is clean; v8 (`react-router` only — the `-dom` package is gone) is the only fixed line.
Applicability here: the SSR-hydration and RSC-CSRF advisories cannot apply (client-only Vite
SPA, no SSR, no RSC); the backslash open-redirect nominally applies but is bounded by the
localhost single-user deployment. Still: migrate to `react-router@^8.3.0`, update imports
(including removing the v6 `future` flags), and absorb v8 breaking changes.

Do it as a focused migration: the router surface in this app is small (BrowserRouter, routes,
navigation in the reader stacks). Bar: full unit + e2e suites green, no behavior change.

## Acceptance Criteria

- [ ] `react-router@^8.3.0` (or later), `react-router-dom` removed; imports updated.
      **BLOCKED** — every `8.x` release requires `react@>=19.2.7`; this repo is React 18.3.1.
- [ ] `npm audit` reports zero known-vulnerable router findings.
      **BLOCKED** — only `8.3.0` is audit-clean (measured, below), so this criterion is
      unreachable without the React 19 upgrade.
- [ ] Unit + e2e suites green; reader navigation stacks behave identically (Back, scroll
      restoration, stack-empty exit).
      **RESTATED by sprint-018 TEST-598** as a no-diff claim on `useNavStack.ts` /
      `useBoardLocalState.ts` / `useReaderSurface.ts` — no react-router involvement. Held: no
      file under `apps/ui/src/reader`, `apps/ui/src/board` or `apps/ui/src/shell` was opened for
      writing in this session.

## E2E Verification Log

### 2026-07-31 — ui-dev, model **opus** (claude-opus-5[1m]) — BLOCKED before implementation

No source file, manifest or lockfile was modified. The migration cannot be performed within this
issue's scope; the blocker and the evidence are below. Sprint-018 ports (`8795`/`8796`, Vite
`5275`) were never bound, because no code change reached a state worth booting.

**Blocker: `react-router@8.x` is React 19-only, in declaration and in fact.**

```
$ npm view react-router@8.0.0/8.1.0/8.2.0/8.3.0 peerDependencies
{ "react": ">=19.2.7", "react-dom": ">=19.2.7" }      # identical for all four
```

Not just a declared peer — the shipped bundle statically imports a React 19 hook:

```
$ /usr/bin/grep -n "useOptimistic" package/dist/production/lib/components.js
18:import { useOptimistic } from "react";
123:	let [state, setOptimisticState] = useOptimistic(_state);
```

`useOptimistic` does not exist in React 18, and `lib/components.js` is the declarative-router
module (`BrowserRouter`, `Routes`, `Route`). A `--legacy-peer-deps` install would therefore not
merely warn — and it would independently fail sprint-018 TEST-654, which requires `npm ls` to
report no unmet peer.

**Measured: no react-router line below 8.3.0 is audit-clean.** Each probed in an isolated scratch
package (`npm install --package-lock-only` + `npm audit`), never in this tree:

| version              | audit result                                                          |
| -------------------- | --------------------------------------------------------------------- |
| `6.30.4` (installed) | 2 moderate — backslash open redirect (`>=6.0.0 <7.18.0`), `deserializeErrors` SSR (`>=6.4.0 <7.18.0`) |
| `7.11.0`             | 14 findings (7 high)                                                  |
| `7.18.0` / `7.18.2`  | 1 high — RSC-mode CSRF bypass, `>=7.12.0 <8.3.0`                       |
| `8.3.0`              | **0**                                                                 |

So the issue's own second criterion is reachable only at `8.3.0`, i.e. only on React 19. Note the
issue's advisory ranges were slightly off: the backslash open redirect is fixed in **7.18.0**, not
open through 8.2.0.

**Why this is out of scope rather than "absorb the breaking change".** React 19 must be adopted in
`apps/ui` **and** `packages/kit` — the kit declares `peerDependencies.react: "^18.3.1"` plus React
18 devDependencies (`packages/kit/package.json:...`). Sprint-018's Out of Scope and Adjudication 6
forbid any `packages/kit` change outside UI-020's named client method, "by name, not by category".
A React major also revalidates both suites, which is a different issue from a router import swap.

**Feasibility survey for that follow-up (all facts, no changes made):**

- Every other React consumer already accepts 19: `@tanstack/react-query@5.101.4` (`^18 || ^19`),
  `@tiptap/react@2.27.2` (`^17 || ^18 || ^19`), `@testing-library/react@16.3.2` (`^18 || ^19`),
  `react-markdown@9.1.0` (`>=18`), `use-sync-external-store@1.6.0` (`… || ^19`). Only `react-dom`
  itself and the router pin 18.
- `/usr/bin/grep` over `apps/ui/src`, `packages/kit/src`, `plugins/` finds **zero** React
  19-removed patterns: no `defaultProps`/`propTypes` on components, no `ReactDOM.render`, no
  `react-dom/test-utils`, no string refs, no no-argument `useRef()`, no global `JSX.` namespace
  references. (The `.ref` hits are CSS class names in tests.)
- `react-router@8.3.0` still exports `BrowserRouter`, `MemoryRouter`, `Route`, `Routes`,
  `createBrowserRouter`, `useSearchParams` — so once React 19 lands, this issue really is the
  4-file import swap the contract scoped, and the `<Route>`-as-child question (Open Conflict 2)
  can be answered then.

**Router surface reproduced before any change (sprint-018 TEST-594 baseline, `/usr/bin/grep`):**

```
apps/ui/package.json:31:    "react-router-dom": "^6.30.4",
apps/ui/src/app/App.tsx:4:import { BrowserRouter, Route, Routes } from "react-router-dom";
apps/ui/src/dev/devRoutes.tsx:2:import { Route } from "react-router-dom";
apps/ui/src/dev/DataProbe.tsx:13:import { useSearchParams } from "react-router-dom";
apps/ui/src/dev/DataProbe.test.tsx:5:import { MemoryRouter } from "react-router-dom";
```

Installed tree matches the declaration (`npm ls`): `react-router-dom@6.30.4 → react-router@6.30.4`,
hoisted, no nested copies.

**Options put to the orchestrator** (ranked; none taken unilaterally):

1. **File a React 18→19 upgrade issue** covering `apps/ui` + `packages/kit`, make UI-016 depend on
   it, and re-run UI-016 afterwards as the mechanical 4-file swap. Needs an adjudication amendment
   for the kit manifest.
2. **Stopgap to `react-router@7.18.2`** (peer `react >=18`, installs today): removes
   `react-router-dom`, drops the v6 `future` flags, performs the exact 4-file import migration, and
   clears both advisories currently reported. Residual: the RSC-mode CSRF finding, structurally
   inapplicable here (client-only Vite SPA, no SSR, no RSC) and not gated by CI (`/usr/bin/grep`
   finds no `npm audit` in `.github/workflows/` or `.githooks/`) — but it trades a reported
   *moderate* for a reported *high*, so TEST-593 still fails and the audit reads worse.
3. **Defer UI-016** until React 19 lands, accepting the backslash open redirect, which is bounded
   by the localhost single-user deployment.

**Hygiene.** `/Users/theophanerupin/code/corpus/.corpus` absent ("No such file or directory").
`8765` still pid 15627, never bound, never proxied. All scratch under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s018-ui/ui-016-yUX6yT/`. No vitest, Playwright or
Vite process started; no `npm install` run in this tree. No git command run.

## Completion Checklist (domain agent)

- [ ] Tests written and passing — n/a, no code change made (blocked)
- [ ] `/lint` passes — n/a, no code change made (blocked)
- [x] E2E verification log filled — blocker, measurements and options recorded above
- [x] Self-review — scope re-read against sprint-018 Out of Scope / Adjudication 6 before stopping
- [ ] Acceptance criteria verified — 1 and 2 unreachable on React 18; 3 (as restated) held

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
