# [INFRA-011] Pre-push e2e must not depend on port 8765 being unbound

## Domain

infra

## Status

done

## Priority

P1

## Model

opus — shipped orchestrator-direct (fable) as a two-line hook fix during the PR #11 babysit; recorded for the audit trail.

## Dependencies

- Depends on: INFRA-004 (e2e in the push gate)
- Blocks: —

## Spec References

- SPEC.md §3 — server binds 127.0.0.1:8765 by default

## Summary

Found during the PR #11 push: the e2e suite's `vite.config.ts` proxies the UI's API
requests to `http://127.0.0.1:8765` unless `CORPUS_SERVER_ORIGIN` says otherwise, and the
suite's hermetic premise is that this origin is *dead* (the two "server unreachable"
specs assert the health-failure notice; the rest assert prototype fidelity against an
unreachable backend). On a machine where a personally-installed `corpus` server is
serving a real workspace on the default port — the maintainer's, today — the health
specs fail deterministically and, worse, the remaining 96 specs quietly issue their
reads against a real person's workspace. Three pushes were blocked before the cause was
found (an earlier kill of the personal server didn't stick — its owner respawns it).

Fix shipped: `.githooks/pre-push` exports `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8790`
(explicit value wins), exactly parallel to the existing `CORPUS_UI_PORT=5273` default
and for the same reason — a hook must not fight whatever the developer's machine is
running. CI is unaffected (it does not run the hook; runners have 8765 unbound).

## Acceptance Criteria

- [x] `git push` passes the e2e gate with a live corpus server on 8765 (verified: the blocked push went green with the origin exported).
- [x] Explicit `CORPUS_SERVER_ORIGIN` still wins.
- [ ] Follow-up for triage (SHARED-003 rules): the same pin for *manual* `npm run e2e` runs — a bare invocation outside the hook still targets 8765; decide whether playwright.config.ts should own the default instead.

## E2E Verification Log

Implemented on: fable (orchestrator-direct, during the PR #11 babysit).

Pre-fix: three consecutive `git push` runs blocked at `pre-push ✗ playwright e2e` with
`console.spec.ts:62` and `smoke.spec.ts:241` timing out on `.console-strip .c-failed`
("server unreachable" never rendered); `lsof -iTCP:8765` showed the personal server
(cwd `~/cos`, global npm install), respawned under a new pid after a kill.
Post-fix: `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8790 git push` → 98/98 e2e specs,
`pre-push ✓ all checks passed`, branch pushed. The hook now exports that default itself.

## Completion Checklist (orchestrator)

- [x] Committed with `[ISSUE-ID]` prefix
- [ ] Manual-run follow-up triaged with SHARED-003
