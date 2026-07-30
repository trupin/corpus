# [AGENT-007] Orchestrate skill: replace the `deferred:`-prefixed failure with the defer transition

## Domain

agent-runtime

## Status

in_progress

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

**implemented on: fable** (this agent). The live `/orchestrate` drill session ran on
`claude-opus-5` (from its stream-json init record).

**Scope note (Adjudication 8).** This issue's change covers **both** skills:
`assets/workspace/claude/skills/orchestrate/SKILL.md` (Invariant 4, the loop block's settle
lines, "Locks and deferral", "Completing and failing", Purpose's "terminal state" →
"settled state", `updated` → 2026-07-30) and
`assets/workspace/claude/skills/comment/SKILL.md` (the deferral paragraph in *Doing the
work*: job-log line without the prefix, hand-back sentence without "`deferred:` accounting",
operator-retry sentence replaced by automatic re-entry, `updated` → 2026-07-30), plus
`scripts/workspace-template.test.ts`. Per Adjudication 7, **no CLI change**: the legacy
`corpus queue fail --reason "deferred:…"` form is not refused, merely no longer taught —
the skills document exactly one way to defer.

**Environment.** Scratch `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-agent007-izzIJt`
(sprint prefix respected, cwd outside the repository — `pwd` logged as
`…/s016-agent007-izzIJt/ws` before init). `corpus init --port 9185` from a `corpus` wrapper
at `…/bin/corpus` (from-source CLI, absolute tsx loader). Real server pid 99575 on `:9185`.
The freshly-initialized workspace received the **rewritten** skills (5 `corpus queue defer`
mentions in the installed orchestrate skill).

| Test | Result | Evidence |
| ---- | ------ | -------- |
| TEST-373 | PASS | `grep -n "deferred:"` over both rewritten SKILL.md files → **0 matches**. `corpus queue fail` still appears 6× in orchestrate — routing/unknown-type/error contexts only, never in a deferral context (occurrences enumerated: invariant list, loop example, routing table ×2, subagent prohibition, Completing-and-failing example). |
| TEST-374 | PASS | The deferral bash block is reply-heredoc first, then `corpus queue defer evt_7c1d9a --blocked-on doc_a1b2c3 --reason "waiting for the user's edit lock on doc_a1b2c3"`; `--blocked-on` names the document; the `# nothing changed, so that reply carries no trace line` comment survives; pinned by the new template test `"defers on a user lock with the defer verb; the deferred:-prefix protocol is gone"`. |
| TEST-375 | PASS | Prose: "`--blocked-on` is required, and it is load-bearing: it names the **locked document** — never the thread — because clearing the lock on exactly that document is what returns the event to `pending`. Name the wrong document and the event parks forever… The right value is always the id of the document whose write was refused." |
| TEST-376 | PASS | "Re-entry is automatic. When the lock on the blocked-on document is **released**, **force-broken**, or **reaped**, the server returns the event to `pending` by itself and a parked `corpus queue idle` unparks"; "a postponement, not a failure … `corpus queue status` counts it under `deferred`, never `failed`". |
| TEST-377 | PASS | "`corpus job retry` remains only as the by-hand override for a deferral automatic re-entry did not reach: a lock that cleared out of band, or a deferral that named the wrong document." No console failed-job-row instruction anywhere (asserted: body `not.toMatch(/retry the job from the console/i)`). The Completing-and-failing mention of `job retry` covers **failed** events only. |
| TEST-378 | PASS | The heredoc reply now reads "The change is ready and will land on its own once the document is free." — short, honest, no user chore. |
| TEST-379 | PASS | Invariant 4: "**Every claimed event is settled** — `corpus queue complete`, `corpus queue fail`, or `corpus queue defer` … Complete and fail reach a terminal state; a deferred event is settled accounting, not a dangling one — it leaves `in-progress/` and returns to `pending/` on its own…". The restated invariant in Completing and failing now reads "every claimed event ends settled — in `processed/`, in `failed/`, or in `deferred/` waiting on a named lock and coming back to `pending/` on its own". The settle example block gained the defer line in both places. |
| TEST-380 | PASS | Comment skill: job-log line is now `corpus job log evt_7c1d9a "waiting on [[doc_a1b2c3]] — the user holds its edit lock"`; "`deferred:` accounting" gone; replacement sentence: "The work re-enters by itself the moment the lock clears — nobody retries anything by hand, so never tell the person to." "Reply *before* you defer" retained verbatim. |
| TEST-381 | PASS | `expect(commentBody).not.toMatch(/corpus queue (?:complete|fail)/)` untouched at its original strength; new **additive** assertions pin `not.toContain("corpus queue defer")` and `not.toMatch(/deferred:/)` on the comment body. The regex was not widened; the comment skill hands the event back ("queue state belongs to that skill"). |
| TEST-382 | PASS | `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts` → **92 passed**. `CLI_COMMANDS_PENDING_CLI_006` still `[]`; no allowlist entry; `corpus queue defer` + `--blocked-on` added to the orchestrate verbatim-rules list and resolve against `docs/cli.md:957-1002`. |
| TEST-383 | PASS | Live: `doc_4d7ox6bw` created, `corpus lock acquire doc_4d7ox6bw --ttl 600` (user), thread `th_27ynadxd` opened via `POST /api/threads` (`requestsAgent: true`) → `evt_kf23qgilff44` pending. After `claim-all` and the real `423` (exit 5), the section's commands ran verbatim: reply posted (`turn 2026-07-30T16:54:57Z`), `corpus queue defer … --blocked-on doc_4d7ox6bw` → exit **0**, `event evt_kf23qgilff44 is deferred on doc_4d7ox6bw.`; `.corpus/queue/deferred/evt_kf23qgilff44.json` carries `"blockedOn": "doc_4d7ox6bw"` and `"deferReason": "waiting for the user's edit lock on doc_4d7ox6bw"`; `corpus queue status` → `deferred 1, … failed 0`. |
| TEST-384 | PASS | Parked `corpus queue idle --wait 20` (idle-start **16:55:08Z**); `corpus lock release doc_4d7ox6bw --from user` from a second shell at **16:55:11Z**; idle returned at **16:55:11Z** (≤1 s) printing `evt_kf23qgilff44 comment.created`, exit 0. `corpus queue status` → `pending 1, deferred 0`; the pending file has **no** `blockedOn`/`deferReason` keys (full JSON captured). No `corpus job retry` was run at any point. |
| TEST-385 | PASS | Live `claude -p "/orchestrate"` session (pid 1617, transcript `…/s016-agent007-izzIJt/transcript-agent007.stream.json`, 74 stream events, tools `{Bash: 18, Skill: 1}`, zero Write/Edit) against the re-locked document. Transcript command sequence: `doc edit` (423) → `corpus thread reply th_27ynadxd` → `corpus queue defer evt_kf23qgilff44 --blocked-on doc_4d7ox6bw --reason "waiting for the user's edit lock on doc_4d7ox6bw"` → `corpus queue idle`. Audit: **1** `queue defer`, **0** `queue fail`, **0** `lock break`, **0** `job retry`, **0** `deferred:`. Bonus full circle: releasing the lock at 16:57:08Z unparked the session's idle; it re-claimed (job log `re-claimed after the lock on doc_4d7ox6bw cleared`), edited the doc to 6.4%, replied with a trace line, `processed 1` at 16:57:49Z — no operator action. `git log` in the workspace: every mutation authored `agent`/`user` correctly. |
| TEST-386 | PASS | `git status --porcelain` in the dev repo: only the two SKILL.md files, `scripts/workspace-template.test.ts`, and this issue file. `git diff SPEC.md` → empty. **Residual `deferred:` sentences noticed (Open Conflict 2, spec-writer's, not touched)**: `SPEC.md:248` ("a `deferred:`-prefixed failure, retryable via `corpus job retry`"), `SPEC.md:257` ("fails the event with a `deferred:`-prefixed reason…"), `SPEC.md:325` ("automatic re-enqueue arrives with the planned defer state" — defer is no longer planned, it shipped), plus `SPEC.md:258`'s force-unlock retry sentence reading as the primary path. |

Cleanup: claude session killed by recorded pid (1617, verified stopped); server stopped
(`stopped (pid 99575)`); `lsof` over 9185-9186 and 8765 → nothing bound; `8765` never bound,
never killed, never proxied; `/Users/theophanerupin/code/corpus/.corpus` → "No such file or
directory". Scratch retained (transcript + idle.log) for the evaluator.

## Completion Checklist (domain agent)

- [x] Tests written and passing (template suite 92/92)
- [x] `/lint` passes (prettier + eslint on the touched test file; skills are markdown)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
