---
description: Pick ready issues from the plan and implement them by spawning the appropriate domain agent. This is the main orchestration skill.
argument-hint: "[issue-id, 'next', or 'all']"
user_invocable: true
---

Implement one or more issues from the project plan.

## 0. Restore context (if context-manager active)

If `.claude/agents/context-manager.md` exists and `.claude/handoffs/` contains files, spawn the context-manager agent in "restore" mode to produce a session briefing. Use this briefing to orient before reading the plan.

Skip this step if no handoff files exist or if this is a continuation of an active session.

## 1. Read the current plan

Read `issues/PLAN.md` to understand the current state of all issues.

## 2. Determine what to implement

If `$ARGUMENTS` is a specific issue ID (e.g., `CORE-001` or `API-005`):

- Read that issue file from the appropriate `issues/<domain>/` directory.
- Verify its dependencies are all `done`. If not, report which dependencies are blocking and stop.

If `$ARGUMENTS` is `next` or not provided:

- Scan the phase table for all issues with status `todo`.
- Filter to those whose dependencies are all `done`.
- Group by domain.
- Pick the highest-priority ready issues (P0 before P1 before P2).

If `$ARGUMENTS` is `all`:

- Run the full orchestration loop continuously until no more issues can be picked up.
- Follow steps 3-5 as normal for each batch. After each batch completes (all agents done, verified, committed), **loop back to step 1**: re-read `issues/PLAN.md`, find newly unblocked issues, and repeat.
- Stop only when there are no `todo` issues with all dependencies `done`.
- If an issue is marked `blocked`, skip it and continue with other ready issues.

## 2b. Spec validation

Before implementing any issue, read the relevant section(s) of `SPEC.md`. Look for **spec holes** — anything the issue requires but the spec doesn't define clearly enough.

**If the spec hole is blocking** (cannot implement without an answer):

- Stop implementation for that issue.
- Present the spec gap to the user with what's missing, why it blocks, and 2-3 alternative approaches.
- Other non-blocked issues can continue in parallel.

**If the spec hole is non-blocking** (can proceed with a reasonable default):

- Proceed with the most reasonable interpretation.
- File a new issue for each non-blocking spec gap found (title: `Clarify spec: <what's missing>`, priority P1).

## 3. Sprint contract (if evaluator active)

If `.claude/agents/evaluator.md` exists AND the batch has more than 1 issue:

1. Spawn the sprint-planner agent (`.claude/agents/sprint-planner.md`).
2. Pass it the list of ready issue IDs.
3. It produces a sprint contract at `issues/sprints/sprint-NNN.md`.

Skip this step for single issues or trivial batches (P2, single-file changes).

## 4. Handle shared issues directly

If the ready issue is in `shared/` (e.g., SHARED-001):

- Read the issue file and implement it yourself as orchestrator.
- Run validation, update status to `done` in both the issue file and `issues/PLAN.md`.

## 5. Spawn domain agents for domain issues

For each domain with ready issues:

- Use the Agent tool to spawn the appropriate domain agent (defined in `.claude/agents/<domain>-dev.md`), passing the issue's **Model** recommendation as the model override (missing ⇒ opus). Never downgrade the pr-reviewer — it is pinned to fable.
- Pass the issue ID(s) and instruct it to read the issue file, implement, test, verify E2E, and report back.
- If a sprint contract was produced in step 3, include the contract file path so the domain agent knows what the evaluator will verify.
- **E2E requirement**: Explicitly instruct agents to fill in the "E2E Verification Log" section of the issue file with concrete evidence. For bug fixes, they must reproduce the bug first. Remind them the evaluator will reject issues without credible proof-of-work.

If multiple domains have ready issues, spawn all agents in parallel.

## 6. Verify, evaluate, and commit

When a domain agent reports completion:

1. **Run checks**: `/test` and `/lint` to verify correctness. If checks fail, report failures to the domain agent for fixing. Loop until checks pass.
2. **Check E2E proof-of-work** (skip if evaluator active — it handles this): Read the issue file and verify the "E2E Verification Log" section is filled in with concrete evidence (not placeholder text) and states which model the agent ran on. For bugs, verify both "Reproduction" and "Post-Implementation Verification" are present. If missing, send the issue back to the domain agent.
3. **Evaluate** (if evaluator active): If `.claude/agents/evaluator.md` exists:
   - Spawn the evaluator agent for this issue (or the sprint batch).
   - If FAIL: send the eval verdict file (`issues/evals/<ISSUE-ID>-eval.md`) to the domain agent for fixing. After fixes, re-run `/test` + `/lint`, then re-evaluate.
   - Loop up to 3 iterations. If still failing after 3 attempts, escalate to user with the eval file.
   - If PASS: proceed.
4. **Decide whether to audit**: Run `/audit <ISSUE-ID>` only when:
   - The issue is P0 (critical path)
   - The issue touches shared contracts or cross-domain interfaces
   - The issue modifies more than ~5 files
   - The issue involves security-sensitive code (auth, input validation, crypto)
   - Skip `/audit` for small, single-file changes, documentation-only issues, and P2 tasks.
5. If the audit surfaces FIX items, send them back to the domain agent. Loop until clean.
6. **Commit the changes**:
   - Stage only the files relevant to this issue (`git add <specific files>`).
   - Commit with format: `[ISSUE-ID] Short imperative description`
7. Update the issue's Status to `done` in both the issue file and `issues/PLAN.md`.

## 7. Checkpoint and report

1. **Checkpoint** (if context-manager active): After every 3-5 completed issues, spawn the context-manager in "checkpoint" mode to create a handoff artifact at `.claude/handoffs/`.

2. **Report**: After all targeted issues are processed, report:
   - Which issues were completed.
   - Which issues failed and why (include eval verdict paths if applicable).
   - What the next ready issues are.

## Rules

- Never modify another domain's code directly — spawn the appropriate agent.
- Mark issues as `in_progress` before spawning agents, `done` only after verification.
- If an agent cannot complete an issue, mark it as `blocked` with a reason.
- Never commit code with a FAIL evaluator verdict without explicit user approval.
