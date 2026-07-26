---
description: "Manage project issues: create, close, implement, plan, refine, list, show, reopen"
argument-hint: "<subcommand> [args]"
user_invocable: true
---

Manage project issues. Parse the subcommand from the first argument and the body from the rest.

**Usage:** `/issue <subcommand> <body>`

## Subcommands

### `create <description>`

Create a new issue from a natural language description.

#### Step 0: Assess Complexity

Before starting, classify the task:

**Simple** (single domain, clear scope, <3 files likely changed):

- Bug fixes with obvious cause ("fix typo in X", "null check missing in Y")
- Small config changes, dependency updates
- Documentation fixes

**Complex** (multi-domain, ambiguous scope, new feature, architectural impact):

- New features or behaviors
- Cross-domain changes
- Anything requiring design decisions

**For simple tasks**, skip directly to the Filing step — do a quick scan of the affected file(s) and file the issue with a lightweight Technical Design. No clarifying questions needed unless something is genuinely unclear.

**For complex tasks**, follow the full research flow below.

#### Phase 1: Deep Research (complex only)

Before writing any issue file, investigate the codebase:

1. **Explore the affected code.** Use the Explore agent (or Glob/Grep) to read every file the feature will touch. Understand current data flow, state management, component boundaries.
2. **Identify cross-domain impact.** Trace the change through the dependency chain. If a feature requires work in multiple domains, plan separate issues for each with dependency links. Favor parallelizable issues.
3. **Assess regression risk.** Identify what existing functionality could break. Run the existing test suite to establish a green baseline. Note fragile areas.
4. **Check for prior art.** Search the codebase for similar patterns, existing utilities, or partially-implemented versions.

#### Phase 2: Ask Clarifying Questions (complex only)

Before filing, surface design blind spots:

- **Behavioral ambiguities**: "When X happens during Y, should the system do A or B?" Present concrete scenarios.
- **Scope boundaries**: "Should this also handle [related edge case], or is that a separate issue?"
- **Priority tradeoffs**: "This could be done simply with [approach A] or more robustly with [approach B] — which do you prefer?"

Do not file issues with ambiguous acceptance criteria. If you can't define "done" precisely, ask more questions.

#### Phase 3: Plan the Issue Structure (complex only)

For complex features spanning multiple domains:

- **Create multiple issues** rather than one monolith. Each should be implementable by a single domain agent in one session.
- **Maximize parallelism**: structure dependencies so as many issues as possible can be worked concurrently.
- **Group into a phase**: add all related issues under a new phase heading in `issues/PLAN.md`.

#### Phase 4: Consider Testing Strategy

Every issue must have a concrete testing strategy (scale to match complexity):

- **Simple tasks**: "Verify the fix by running existing tests. Add a regression test if none covers this case."
- **Complex tasks**:
  - **Unit tests**: what functions/components need coverage?
  - **Integration tests**: does the feature cross module boundaries?
  - **E2E tests**: if user-visible behavior, describe how to verify end-to-end.
  - **Regression surface**: list specific existing tests that should still pass.

#### Phase 5: Update the Spec (complex only)

If `SPEC.md` exists and the new feature introduces behavior not yet covered:

1. Read the relevant spec section(s).
2. Add or update spec text to describe the new behavior.
3. If exploratory, add a stub with `[TBD: <issue-id>]` marker.

#### Phase 6: File the Issue(s)

1. **Determine the domain** from the description.
2. **Find the next issue number** by scanning `issues/<domain>/` for the highest NNN prefix and incrementing.
3. **Generate a short slug** (e.g., "add retry logic" -> `add-retry-logic`).
4. **Create the issue file** at `issues/<domain>/NNN-<slug>.md` using `issues/TEMPLATE.md`.
5. **Fill in all sections** based on the research (for simple tasks, keep Technical Design brief — a sentence or two is fine). Always set the **Model** recommendation: opus by default; fable only when the task hinges on judgment (spec/architecture, ambiguous tradeoffs, novel design).
6. **Add to `issues/PLAN.md`** in the appropriate phase table.
7. **File follow-up issues for shortcuts** (complex only). If the Technical Design takes shortcuts (stubs, hardcoded values, skipped edge cases), create follow-up issues titled `Harden: <what was cut>`, priority P2.
8. **Report** the created issue path(s) and ID(s).

### `close <issue-id>`

Mark an issue as done.

1. Find the issue file matching `<issue-id>`.
2. Update the Status field to `done`.
3. Update `issues/PLAN.md` — change the status to `done`.
4. Report what was closed.

### `implement <issue-id>`

Delegate to the `/implement` skill logic for this specific issue.

### `plan`

Show the current state of the plan.

1. Read `issues/PLAN.md`.
2. Summarize: total by status (done, in_progress, todo, blocked), ready issues, in-progress issues, blocked issues.

### `refine <issue-id>`

Flesh out an existing issue with more detail.

1. Read the issue file.
2. Read relevant source files mentioned in Technical Design.
3. Read `SPEC.md` for relevant sections.
4. Update with: more specific acceptance criteria, concrete file paths, edge cases, updated dependencies.
5. Report what was refined.

### `list [--domain <domain>] [--status <status>]`

List issues, optionally filtered by domain or status.

1. Scan `issues/PLAN.md` for phase tables.
2. Filter by domain and/or status if provided.
3. Display as compact table: `ID | Title | Status | Depends On`.

### `show <issue-id>`

Display the full contents of an issue file.

### `reopen <issue-id>`

Set status back to `todo` in both the issue file and `issues/PLAN.md`.

## Issue ID Resolution

Issue IDs can be provided in several formats:

- Full: `API-019`
- Lowercase: `api-019`
- Number only (requires domain context): `019`

Resolution: normalize to uppercase, extract domain prefix and number, glob for `issues/<domain>/<number>-*.md`.

## File Locations

- Issue files: `issues/<domain>/NNN-<slug>.md`
- Plan: `issues/PLAN.md`
- Template: `issues/TEMPLATE.md`

## Notes

- Issue numbers are per-domain.
- Always use the template format from `issues/TEMPLATE.md`.
- When creating issues, read relevant codebase files for accurate Technical Design sections.
