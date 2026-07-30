# [INFRA-010] npm audit: brace-expansion override + vitest/coverage-v8 peer alignment

## Domain

infra

## Status

done

## Priority

P2

## Model

opus — dependency hygiene with gate-verified proof. (Executed directly by the orchestrator,
2026-07-29, at user request.)

## Dependencies

- Depends on: INFRA-001
- Blocks: —

## Spec References

- GHSA-mh99-v99m-4gvg (brace-expansion DoS, high)
- GHSA-qwww-vcr4-c8h2 (react-router RSC CSRF, high — NOT fixed here, see UI-016)

## Summary

`npm audit` cleanup (user request, 2026-07-29). The working tree turned out to carry UNCOMMITTED
residue from a manual `npm audit fix --force` plus junk installs (literal packages `audit`,
`fix`, `pipe`; a foreign root `dependencies` block pinning `react-router-dom@7.18.2` and
`@hono/node-server@2.0.12`; unreviewed eslint 9->10 and coverage-v8 3->4 bumps) — every early
"fix" was chasing symptoms of that residue. Resolution: restore ALL manifests to HEAD, then
apply a reviewed, gate-proven set:

1. **brace-expansion ≤5.0.7 DoS** via `openapi-typescript@7.13.0 → @redocly/openapi-core →
   minimatch@5.1.9 → brace-expansion@2.1.3` (dev-time codegen only). No patched 2.x exists;
   npm's suggested fix was a breaking downgrade to openapi-typescript@6. Fixed instead with a
   root `overrides: { "brace-expansion": "^5.0.8" }` — the patched release; the other installed
   copies were already 5.0.8. Applying the override surfaced a **pre-existing peer skew**:
   `@vitest/coverage-v8@^4.1.10` (peer: exactly vitest 4.1.10) against `vitest@^3.2.0` — the old
   lockfile had papered over it, and strict re-resolution refused. Aligned per vitest's
   documented pairing: `@vitest/coverage-v8@^3.2.7` matching `vitest@3.2.7`.
2. **react-router**: the audit unions three advisories across 6.0.0–8.2.0 — no 6.x or 7.x is
   clean. The reinstall also exposed that the declared `^7.18.2` had NEVER truly installed
   (App.tsx uses the v6-only `future` flags; a stale nested v6 copy served every prior gate,
   and the dedupe removed it, breaking typecheck). Pinned `react-router-dom` to `^6.30.4` —
   the line the code is written for and every gate actually tested. UI-016 (P1) is the v8
   migration that clears all three; SSR/RSC advisories are inapplicable to this SPA, the
   backslash open-redirect is bounded by the localhost single-user deployment.

## Acceptance Criteria

- [x] `npm audit` clean except the documented react-router advisories (2 highs, all router; UI-016).
- [x] Codegen proven over the overridden chain: `check-generated-artifacts` green (both arms).
- [x] Coverage gate green with coverage-v8 3.2.7 (repo-wide run before push).

## E2E Verification Log

Implemented on: fable (orchestrator-direct, with the user in the loop).

Final shipped set, each element verified:

- overrides scoped to `@redocly/openapi-core` and `test-exclude` subtrees only: brace-expansion
  ^5.0.8 (the GLOBAL override broke eslint 9.s minimatch@3 — 8 boundary-test failures — and was
  withdrawn; minimatch@5/@9 handle it, proven by the drift check and the coverage run).
- eslint ^10.8.0 + @eslint/js ^10.0.1 (declared — eslint.config.js imported it as a phantom):
  clears the whole eslint-family brace-expansion chain; combo was already gate-proven earlier
  the same night. One new eslint-10 core finding fixed (useAnchorLayer dead initializer).
- coverage-v8 stays on HEAD.s ^3.2.0 line (vitest 3 pairing); react-router-dom stays ^6.30.4
  (HEAD; the code is v6 — the pinned 7.18.2 had never truly installed); @hono/node-server
  stays ^1.19.0 (v2 is SERVER-033).
- `npm audit fix` (non-breaking) bumped nested js-yaml.

Audit: 13 findings (10 high, 3 moderate) at the true HEAD baseline -> **0 high, 3 moderate**,
all three documented with migration issues: @hono/node-server (SERVER-033, P1),
react-router x2 (UI-016, P1). Boundary probes 8/8; repo lint clean; drift check green both
arms; full coverage gate run before push (see commit CI).

## Completion Checklist (orchestrator)

- [x] Committed
