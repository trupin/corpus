# [SERVER-024] Provision the bearer token to the served UI

## Domain

server

## Status

todo

## Priority

P1

## Model

opus — one endpoint or one injection point; the security reasoning is already settled by Decision 5 (localhost bind + token).

## Dependencies

- Depends on: SERVER-003
- Blocks: UI-003 (the board must fetch real data when served by the production server)

## Spec References

- CLAUDE.md Architecture Decision 5 (localhost bind + bearer token)
- `issues/sprints/sprint-008.md` — Open Conflict 3 (discovery: `UNPROVISIONED_TOKEN = ""`, no injection in `mountStaticUi`, no `/api/config`)

## Summary

Nothing provisions the workspace bearer token to the browser: the kit takes `{ baseUrl, token }` as config (UI-002), dev uses a `VITE_CORPUS_TOKEN` env var, but the production server serving the built UI hands it no token — every hook 401s. Decide and implement the provisioning mechanism (e.g. the server injects config into the served `index.html`, or a loopback-only tokenless `GET /api/config` mirroring the job-ingest hardening pattern), with the security tradeoff written down.

## Acceptance Criteria

- [ ] The production-served UI obtains the token without manual steps; dev flow unchanged.
- [ ] The mechanism's security rationale documented in the module (why it does not widen Decision 5's model).
- [ ] E2E: `corpus server start` → browser (or curl of the served page + config surface) → authenticated API call succeeds.

## Technical Design

To be decided by the implementing agent within Decision 5's constraints.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-024]` prefix
