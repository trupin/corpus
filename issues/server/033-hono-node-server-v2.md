# [SERVER-033] Migrate @hono/node-server to v2 (serve-static path traversal advisory)

## Domain

server

## Status

todo

## Priority

P1

## Model

opus — a dependency major with the full server suite + e2e as the bar.

## Dependencies

- Depends on: SERVER-003
- Blocks: —

## Spec References

- npm advisory: @hono/node-server <2.0.5 — path traversal in `serve-static` (moderate)
- issues/infra/010-audit-brace-expansion-vitest-peer.md

## Summary

`npm audit` flags the server's `@hono/node-server@^1.19.0`: a path-traversal advisory in the
adapter's `serve-static`, patched only in ≥2.0.5 (a major). The Corpus server serves the built UI
statically, so the surface is nominally ours; mitigations already in place: the localhost bind,
the bearer guard in front of the UI routes, and the attachment route's own hardened traversal
guard (SERVER-010) which does not use the adapter's serve-static. Confirm during the migration
whether the static-UI path uses the adapter's `serveStatic` at all.

Migrate to `@hono/node-server@^2.0.12`: absorb the v2 API changes (server creation, serve-static
options), full `apps/server` suite + e2e green, and an explicit traversal probe against the
static-UI route in the E2E log (encoded/backslash/dotted paths → 404, mirroring SERVER-010's
matrix).

## Acceptance Criteria

- [ ] `@hono/node-server@^2` in apps/server; boot, SSE, static UI, attachments all green
      (unit + e2e).
- [ ] `npm audit` no longer reports the adapter advisory.
- [ ] Traversal probe matrix against the static-UI route logged pre/post migration.

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
