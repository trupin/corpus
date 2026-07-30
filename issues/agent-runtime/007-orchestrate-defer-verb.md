# [AGENT-007] Orchestrate skill: replace the `deferred:`-prefixed failure with the defer transition

## Domain

agent-runtime

## Status

todo

## Priority

P2

## Model

opus — a bounded rewrite of one documented section against a transition whose semantics are
already pinned by SERVER-030's E2E log; the only judgement is how much of the automatic
re-entry to say out loud.

## Dependencies

- Depends on: SERVER-030 (the transition), CLI rider for the `corpus queue defer` verb (not yet
  filed — see Open Question 1), AGENT-002 (orchestrate skill)
- Blocks: —

## Spec References

- SPEC.md §7 — the lock/deferral bullet and the force-unlock bullet. Both are spent by
  SERVER-030 and are routed to SHARED-004's sign-off set; this issue follows whatever §7
  lands as, and does not edit SPEC.md itself.
- `issues/sprints/sprint-015.md` — TEST-357 (retiring the interim protocol), TEST-359 (this
  rider), TEST-360 (the template suite stays green with `CLI_COMMANDS_PENDING_CLI_006` still
  `[]`).

## Summary

Filed by SERVER-030 (2026-07-30) per sprint-015 TEST-359. server-dev may not edit
`assets/workspace/` (sprint-014 Adjudication 6), so the skill text that still teaches the
interim protocol is filed here rather than changed there.

`assets/workspace/claude/skills/orchestrate/SKILL.md`'s **"Locks and deferral"** section
(around lines 143–175) currently instructs:

```bash
corpus job log evt_7c1d9a "deferred: doc_a1b2c3 is locked by user"
corpus queue fail evt_7c1d9a --reason "deferred: doc_a1b2c3 locked by user — retry when the lock clears"
```

and then explains that "the `deferred:` prefix on the reason marks the failure as a
postponement, not a defect", that the work re-enters "through `corpus job retry`", and that
the operator normally runs that retry "from the console's failed-job row".

Every one of those sentences is now false or misleading:

- A deferral is no longer a failure. `POST /api/queue/{id}/defer` moves the event to
  `.corpus/queue/deferred/`, it is counted separately from `failed` in
  `GET /api/queue/status`, and the console renders it with its own dot.
- The `deferred:` prefix is dead grammar. The status carries the meaning; the request's
  `reason` is free to say something useful.
- The work re-enters **automatically** when the lock on `blockedOn` is released,
  force-broken or reaped. `corpus job retry` remains, but as the *manual override* for a
  deferral automatic re-entry did not reach (a lock cleared out of band, a deferral that
  named the wrong document).
- "Retry the job from the console when you're done editing" — the sentence the skill tells
  the agent to write into the user's thread — now asks the user to do something the system
  does by itself. It should say the work resumes on its own.

## Acceptance Criteria

- [ ] The "Locks and deferral" bash block uses the defer verb instead of
      `corpus job log … "deferred: …"` + `corpus queue fail --reason "deferred:…"`.
- [ ] The prose explains automatic re-entry (release, break **and** reap) and names
      `corpus job retry` as the manual override, not the only path.
- [ ] The sample thread reply no longer instructs the user to retry the job by hand.
- [ ] `corpus queue fail --reason "deferred:…"` appears nowhere as an instruction. Whether the
      old form is *removed*, kept as a legacy no-op or merely no longer taught is settled by
      the CLI rider (sprint-015 TEST-357: "two documented ways to defer is the outcome to
      avoid"), and the skill states one way only.
- [ ] `VITEST_MAX_THREADS=4 vitest run scripts/workspace-template.test.ts` is green with
      `CLI_COMMANDS_PENDING_CLI_006` still `[]` — the new verb has to be a real entry in
      `docs/cli.md` before the skill may name it (sprint-015 TEST-360).
- [ ] The pinned comment-skill assertion
      `expect(commentBody).not.toMatch(/corpus queue (?:complete|fail)/)` still passes. It
      constrains **how the new verb may be named in the comment skill**: sprint-014
      Adjudication 11 keeps queue terminal state with orchestrate, so if the CLI names the
      verb `corpus queue defer`, the comment skill must not gain it — the regex does not
      match `defer` today, and widening the regex rather than keeping the verb out of the
      comment skill would be the wrong fix.
- [ ] `git diff SPEC.md` from the implementing agent is empty.

## Technical Design

Text only. One section of `assets/workspace/claude/skills/orchestrate/SKILL.md`, plus
whatever `scripts/workspace-template.test.ts` needs to keep resolving every `corpus …`
invocation in it.

## Testing Strategy

`scripts/workspace-template.test.ts` (command resolution against `docs/cli.md`, no allowlist
entry) and the comment-skill body assertions.

## E2E Verification Plan

Read the rewritten section against a real workspace: run the exact commands it prints,
against a real lock, and confirm the event reaches `deferred/` and comes back on release
without the operator doing anything — the same drill SERVER-030's E2E log records.

## Open Questions

1. **The CLI verb is not filed yet.** SERVER-030 shipped the route
   (`POST /api/queue/{id}/defer`) and CONTRACT-021 shipped the surface, but no `corpus queue
   defer` verb exists, and the skill can only name commands that resolve in `docs/cli.md`.
   This issue is blocked on that CLI rider and the orchestrator sequences it.
2. Whether the deferral's `reason` should also be written to the job log (so the console row's
   `lastLine` shows the sentence) is a CLI-side choice — `Job` carries no `reason` field, by
   CONTRACT-021's deliberate scoping. If the CLI verb logs it, the skill's example should show
   one command, not two.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent
ran on._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
