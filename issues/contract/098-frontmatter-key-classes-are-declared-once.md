# [CONTRACT-098] Frontmatter key classes are declared once, where both sides can import them

## Domain

contract

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: CLI-083, UI-189 (their comparison must import these sets, never
  restate them)

## Spec References

- SPEC.md **§5** — server-stamped core fields; **§10** — presentation state on
  view documents

## Summary

Filed from sprint-024's pre-flight (E1/P3). Two frontmatter key classes exist
today with no importable home:

- **Server-stamped keys** (`updated:` foremost) — stamped by the server, not
  authored. CLI-083 needs the set to ignore them in the template comparison.
- **Presentation keys** (`width`) — already a module-local `PRESENTATION_KEYS`
  const in `apps/server/src/docs/update.ts`, which `apps/cli` cannot import
  (dependency direction: `packages/contract` ← `apps/server` / `apps/cli`).

UI-189's direction-2 decision and CLI-083 both need one declaration both the
server's stamping rule and the CLI's comparison read. Restating either set in
`apps/cli` is a third copy of the same meaning and a drift waiting to happen.

## What to build

In `packages/contract`: exported, documented sets (named exports, `as const`)
for server-stamped frontmatter keys and presentation frontmatter keys. The
server's existing uses (stamping, `PRESENTATION_KEYS`) switch to importing
them, with a drift test on the server side proving the local const is gone.
No route or schema changes. No behaviour change anywhere — this issue is the
declaration and the re-pointing only.

## Acceptance Criteria

- [ ] Both sets exported from `packages/contract` with doc comments naming
      what qualifies a key for each
- [ ] `apps/server` imports them; no module-local restatement survives
- [ ] A drift test fails if a key is added in one place only
- [ ] `npm run build` and the OpenAPI drift check are clean (no generated
      surface changes expected)

## E2E Verification Log

_Implementing agent fills; state the model._
