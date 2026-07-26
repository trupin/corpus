---
description: Audit recent changes for gaps, defects, missing tests, spec drift, and code quality issues. Run after completing implementation work.
argument-hint: "[domain-name|ISSUE-ID|all]"
user_invocable: true
---

Audit recent implementation work for problems. The goal is a concrete, actionable list — not praise or commentary.

## 1. Determine scope

Parse `$ARGUMENTS` to determine what to audit:

**By domain:** If `$ARGUMENTS` names a domain (e.g., `api`, `core`, `ui`): audit only that domain's source and test directories.

**By issue:** If `$ARGUMENTS` matches an issue ID pattern (e.g., `API-003`, `CORE-012`):

1. Read the issue file to find which files were expected to change (Technical Design > Files to Create/Modify).
2. Cross-reference with `git diff` to find the actual changed files related to this issue.
3. Scope the audit to only those files.
4. Use the issue's Acceptance Criteria and Testing Strategy as the primary checklist.

**All:** If `$ARGUMENTS` is `all` or not provided: audit all recent changes.

## 2. Gather context

Check `git diff main --stat` and `git diff main --name-only` to see what changed. If on main, check `git diff HEAD~5 --stat` instead.

Read every changed and newly created file in full within the determined scope. Read `SPEC.md` sections relevant to the changes (if `SPEC.md` exists).

## 3. Check each dimension

### A. Spec compliance

- Compare implementation against `SPEC.md` for relevant sections (skip if no SPEC.md).
- Flag behavior that diverges from the spec.
- Flag spec requirements with no corresponding test.

### B. Test coverage gaps

- For each new function/method, check that at least one test exercises it.
- Look for missing edge cases: empty inputs, error paths, boundary conditions.
- Verify negative tests exist (things that should fail do fail).

### C. Code quality

- Unused imports, dead code, unreachable branches.
- Inconsistent patterns vs. the rest of the codebase.
- Missing type annotations.
- Functions doing too much (should be split).

### D. Correctness risks

- Async safety issues (event loop, concurrent access).
- Resource leaks (unclosed connections, files, subprocesses).
- Error cases that silently swallow failures.
- SQL injection or other security issues.

### E. Cross-domain consistency

- Do shared types match between producer and consumer domains?
- Do API response types match between backend and frontend?
- Do event/message types match between sender and receiver?

### F. Issue compliance (when scoped to an issue)

- Read the issue file for the changes being audited.
- Verify all acceptance criteria are met.
- Verify the testing strategy was followed.

## 4. Produce the action list

Output a numbered list of concrete actions:

- **FIX**: A defect or incorrect behavior
- **TEST**: A missing test case
- **SPEC**: A gap or ambiguity in the spec
- **CLEAN**: A code quality issue

Format:

```
N. [TYPE] file:line — Description
   -> What to do
```

Order by severity: FIX first, then TEST, then SPEC, then CLEAN.

If auditing a specific issue, end with a summary: "N of M acceptance criteria verified."

## Rules

- Do NOT fix anything — only report.
- Do NOT run tests or linters — those have their own skills.
- Be specific. "Improve error handling" is not actionable.
