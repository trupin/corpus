# [CLI-010] Read verbs: `corpus doc show` + `corpus thread show`

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus — two thin read verbs over existing GET endpoints, following the registry patterns.

## Dependencies

- Depends on: CLI-003
- Blocks: AGENT-003

## Spec References

- SPEC.md §7 (agent loop) — the comment skill reads thread context before replying
- CLAUDE.md — Architecture Decision 2 ("the agent interacts with the system **only through the
  CLI**")
- issues/sprints/sprint-012.md — AGENT-002 escalation 1 (2026-07-28)

## Summary

Found live during AGENT-002's E2E: the orchestrate loop's `claude` session tried `corpus thread
show` and `corpus doc show` — neither exists — and fell back to reading workspace files directly.
The shipped skill's invariant is mutation-only (reads of workspace files are not forbidden), but
Architecture Decision 2 reads stronger, and AGENT-003's comment skill needs a *stated, stable* read
path for thread context (turns, events, anchors, read-state) that file parsing cannot provide
faithfully — thread state lives in the projection, not only in the markdown.

Ship two read verbs as thin clients over the existing GET endpoints:

- `corpus doc show <id>` → `GET /api/docs/{id}` (frontmatter + body, `--json` for the raw payload)
- `corpus thread show <id>` → `GET /api/threads/{id}` rendered **as the wire returns it** (turns,
  status, anchor incl. orphan state; sprint-013 Adjudication 14 — no `events`, no read-state, and
  never the mutating unread endpoint)

Human-readable default rendering, `--json` for the agent path. Registry validation (description +
examples) as for every verb; `docs/cli.md` regenerated. AGENT-003's skill then cites these verbs;
whether direct file reads remain legal for the agent is settled in AGENT-003's text (recommended:
reads of `data/` markdown are fine for document *content*; thread/queue/lock state goes through the
CLI).

## Acceptance Criteria

- [ ] `corpus doc show <id>` and `corpus thread show <id>` exist, with `--json`; errors follow the
      CLI's standard exit-code mapping (sprint-013 Adjudication 13 — server 404 maps to exit 5).
- [ ] Both appear in `corpus --help`, topic help, and regenerated `docs/cli.md` with ≥1 example.
- [ ] Unit tests per registry conventions; E2E against a real server in the log.

## Technical Design

To be refined when scheduled (wave 2, before AGENT-003).

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran
on._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
