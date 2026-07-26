---
description: "Create a pull request from the current branch with auto-generated title and body from issue and commit context."
argument-hint: "[base-branch]"
user_invocable: true
---

Create a pull request for the current branch.

## 1. Gather Context

Run in parallel:

- `git branch --show-current` — current branch name
- `git log main..HEAD --oneline` — commits on this branch (use `$ARGUMENTS` instead of `main` if a base branch was specified)
- `git diff main..HEAD --stat` — files changed
- `git status --short` — any uncommitted work?

If on `main` (no branch), warn: "You're on main. Create a branch first, or specify a base branch."

If there are uncommitted changes, warn: "There are uncommitted changes. Commit them first, or they won't be in the PR."

## 2. Identify Related Issues

Scan the commit messages for issue IDs (pattern: `[DOMAIN-NNN]`). For each unique issue ID found:

1. Read the issue file to get the title and summary.
2. Check if the issue status is `done`.

## 3. Generate PR Content

**Title**: If all commits relate to a single issue, use: `[ISSUE-ID] Issue title`. If multiple issues, use a brief summary of the overall change (under 70 characters).

**Body**: Generate using this structure:

```markdown
## Summary

<1-3 sentences describing the overall change>

## Issues Addressed

- [ISSUE-ID] Title — status
- [ISSUE-ID] Title — status

## Changes

<Bulleted list of key changes, grouped by domain if multi-domain>

## Test Plan

- [ ] `/test` passes
- [ ] `/lint` passes
- [ ] <any issue-specific verification steps from the issue files>
```

## 4. Push and Create

1. Check if the current branch has an upstream: `git rev-parse --abbrev-ref @{upstream}` — if not, push with `-u`.
2. Push to remote: `git push` (or `git push -u origin <branch>` if no upstream).
3. Create the PR:

```bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
<body content>

---
Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## 5. Objective Local Review (required)

Spawn the **pr-reviewer** agent (`.claude/agents/pr-reviewer.md`) as a **fresh** subagent — never a fork, and never pass it implementation context beyond the PR number. In parallel, watch CI: `gh pr checks <number> --watch`.

- Verdict **APPROVE** (MINOR-only findings) → proceed to landing; surface the MINOR findings to the user.
- Verdict **REQUEST_CHANGES** → fix the CRITICAL/MAJOR findings (or present them to the user if they're judgment calls), push, and re-run the reviewer on the updated diff. Loop until APPROVE or the user explicitly waives specific findings.

## 6. Land

Only when BOTH are true — `CI / validate` green on the head commit AND pr-reviewer verdict APPROVE (or user waiver):

```bash
gh pr merge <number> --rebase --delete-branch
```

Then update the issue status to `done` in the issue file and `issues/PLAN.md` (trivial bookkeeping — may commit directly to main).

## 7. Report

Show the user:

- PR URL and merge status
- Reviewer verdict + findings summary
- CI outcome
- Issues referenced

## Rules

- Never force-push. If the push fails, report the error and let the user decide.
- Never create a PR from `main` to `main`.
- If `gh` is not installed, tell the user to install it: `brew install gh && gh auth login`.
- If the branch is already associated with a PR, report that and offer to update it instead.
