# [AGENT-020] Noting a change writes to the document's changelog, not a new thread

## Domain

agent-runtime

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-025 (the §5/§7/§11 rider — **must be signed before this lands**)
- Blocks: UI-089

## Spec References

- SPEC.md **§7** — stewardship: what the agent does when it notices a change
- SPEC.md **§5** — the document model (where a changelog section lives)
- SPEC.md **§11** — collapse: "anything that can be shown can be collapsed"

## Summary

**Requested by the user, 2026-08-07**: *"Anytime an agent takes note of a
document change, it opens a new thread. I'd like the agent to take note of those
changes without creating a new thread each time. Maybe we could annotate
documents with a changelog at the end, maintained by the agent, and I could
choose to comment on it if I want."*

The cost of the current behaviour is that an open thread stops meaning anything:
a corpus accumulates threads nobody needs to answer, so the ones that **do** want
an answer are buried among them.

## The rule, decided

**User decision, 2026-08-07**, chosen against two alternatives:

**A thread means "I need something from you." The changelog means "I noticed."**

- Every observation about a change the agent notices — routine **or**
  worrying-looking — goes to the document's changelog.
- A thread is opened **only** when the agent cannot proceed without a decision
  from the person, and when it does, it asks with a **form** (§7, AGENT-017).

The rejected middle option also opened a thread for changes the agent judged
consequential. It was declined because "consequential" is the agent's own
judgment, and the threads this issue exists to remove would come straight back
through it.

**The accepted cost, stated so nobody re-litigates it later**: an observation the
agent found worrying but had no question about lives only in the changelog, and
a person who never reads the changelog never sees it. That is the trade the
user made knowingly.

## Growth

**User decision, 2026-08-07**: the changelog keeps a bounded number of recent
entries visible and **folds** older ones — it does not drop them. Git holds the
full history regardless, so nothing is lost either way; the fold is what keeps
the document readable, which is the whole reason for putting the log in the
document rather than somewhere else.

Dropping entries outright was declined: a document that silently loses history
is a shape this project has been burned by more than once.

## What is already true, and must not be re-derived

- **The loop cannot feed itself.** `apps/server/src/edit/sessions.ts:10` is
  explicit — the `doc.edited` event is actor-scoped and `SESSION_ACTOR` is
  `"user"`. The agent writing a changelog entry enqueues nothing, so there is no
  risk of it waking itself. Do not add a guard for a loop that cannot happen.
- **Anchors are safe.** The changelog appends at the end of the body, so it
  shifts no earlier offsets and no existing anchor moves.
- **No new machinery is needed to write it.** The agent already edits documents
  through the CLI. This is a stewardship rule and a format, not a new write path.

## Acceptance Criteria

- [ ] Noticing a change writes an entry to the document's changelog and **does
      not** open a thread
- [ ] A thread is still opened when the agent needs a decision from the person,
      and it asks with a form (§7)
- [ ] The changelog is a section at the **end of the document body**, so it is
      ordinary content: commentable, anchorable, searchable, and editable by the
      person like anything else. The person commenting on it is an ordinary
      anchored thread and needs nothing special
- [ ] An entry says **what changed and what the agent made of it** — the note is
      the value, since git already holds the diff. An entry that only restates
      the diff is worse than no entry
- [ ] Older entries **fold** rather than disappear; the fold says how many are
      inside, the way §11 requires every collapse to report its whole size
- [ ] The agent **appends** rather than rewriting the section, so a person's own
      edits inside the changelog survive
- [ ] The skill states that the changelog is the agent's to maintain and the
      person's to edit — neither owns it exclusively
- [ ] `scripts/workspace-template.test.ts` passes and pins the rule

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` and/or
  `assets/workspace/claude/skills/comment/SKILL.md` — whichever owns the
  reflect-on-a-user-edit behaviour (`## Reflecting on a user edit`, orchestrate
  ~L298), plus the frontmatter `updated` timestamp
- `scripts/workspace-template.test.ts`

### The skill-file constraints that bite

**Re-verify these rather than trusting the numbers** — they have moved:

- Exact section counts: **16** for orchestrate, **13** for comment. Adding a
  `## ` section is a two-file change; prefer editing in place.
- **The orchestrate counter is NOT fence-aware.** A `## ` line inside a fenced
  block in that file *will* be counted. This matters here: a worked example
  showing a changelog section would naturally contain `## Changelog` inside a
  fence, and that would break the count. The comment skill's counter *is*
  fence-aware.
- Every `## ` section body must exceed **400 characters** after trimming.
- Forbidden prose: `use your judgment`, `consider whether`, `you may want`,
  `if appropriate`, and the strings `SPEC.md`, `CLAUDE.md`, `issues/`.
- Heredoc mechanics: quoted heredocs for multi-line shell arguments; `-m "$(`
  banned.
- `EXPECTED_TREE` is exhaustive equality.

### Notes

- **Do not invent a parallel store.** The point of the request is that the log is
  *part of the parent document*. Frontmatter, a sidecar file, or a `.corpus/`
  record would all defeat it.
- Decide the heading's exact spelling once and pin it, or the agent will drift
  between spellings and the fold will not find its own section.
- **Interaction with AGENT-019** (the loop block) — both edit skill files under
  `assets/workspace/`. Sequence them rather than running them concurrently.

## Testing Strategy

`scripts/workspace-template.test.ts` is the surface — the skill is prose. Pin the
rule (changelog for noticing, thread only when something is needed), the section
spelling, and the append-not-rewrite instruction.

## E2E Verification Plan

Verify through the product, not the repo:

1. `corpus init` a scratch workspace from the built package on a non-default port
   (**never 8765**, **never 5173**); confirm the skill installed.
2. Start the real server and the agent loop.
3. Edit a document as the person and let the edit session end. **Expected: a
   changelog entry appears at the end of that document, and no new thread.**
4. Edit it again. **Expected: a second entry appended, the first intact, still
   no thread.**
5. Comment on a changelog entry. Expected: an ordinary anchored thread.
6. Drive enough entries to cross the fold threshold; confirm older ones fold
   and the fold names how many.
7. `corpus doc check` and `corpus db doctor` clean; stop the server.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
