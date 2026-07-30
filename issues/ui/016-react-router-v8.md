# [UI-016] Migrate to react-router v8 (clears GHSA-qwww-vcr4-c8h2)

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus — a mechanical major-version migration with a green e2e suite as the bar.

## Dependencies

- Depends on: UI-005
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
- [ ] `npm audit` reports zero known-vulnerable router findings.
- [ ] Unit + e2e suites green; reader navigation stacks behave identically (Back, scroll
      restoration, stack-empty exit).

## E2E Verification Log

_Filled in by the implementing agent. State the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
