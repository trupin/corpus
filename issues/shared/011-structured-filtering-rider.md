# [SHARED-011] Structured filtering — arbitrary fields and glob matching (SIGNED 2026-08-04)

## Domain
shared

## Status
todo — signed by the user 2026-08-04; apply to SPEC.md at phase kickoff.

## Priority
P1

## Model
fable

## Dependencies
- Depends on: —
- Blocks: CONTRACT-030, SERVER-056, UI-069

## Spec References
- §5 (views and queries), §9.2 (`GET /api/docs` filters), §2.1 (frontmatter)

## Summary
Two related asks, one day apart, that turn out to be the same feature.

**First:** _"I would like views to be able to filter based on tags… say I use one
document per task and I want my view to list only tasks assigned to me… The goal
would be to generalize this pattern… Additionally, I think we should expand the
filtering options. There should be a rich filtering feature set that allows to
filter on titles, content, etc… using globbing."_

**Then, the reframing that matters:** _"I realized that what I really want isn't
only about filtering, it's also about providing the flexibility for the agent to
add arbitrary fields on documents so that those fields can then be filtered on in
a structured way."_

**Most of the machinery already exists — this is a query-surface feature, not a
storage one.** Established by survey before drafting:

- **Tag filtering ships today.** `tag=theo`, comma-separated values OR together
  (`packages/contract/src/schemas/query.ts`). The user's task-assignment example
  works right now; it was never discoverable, which is its own finding.
- **Arbitrary fields already round-trip.** `ExtraFrontmatterSchema`
  (`packages/contract/src/schemas/extra.js`) is an open passthrough object, and
  `doc.ts` documents the design as "closed core, open extra" — deliberate, with
  the reasoning written down.
- **They already reach the projection.** `apps/server/src/projection/schema.ts`
  carries an `extra_json TEXT NOT NULL` column.
- **What is missing is only the query.** No filter reads `extra_json`, and there
  is no pattern matching anywhere — `q=` is FTS5 (indexed, word-based) and there
  is no `GLOB` or `LIKE` in the query path at all.

**User's choices on the shape** (AskUserQuestion, 2026-08-04): matching syntax is
**globbing** (`*`, `?`) — regex was offered and declined as too unpredictable to
report errors for in a one-line box. Fields to cover: **title, body, tags, and
folder**.

APPEND to §5 (views and queries):

> **Structured fields.** A document's frontmatter carries the core fields the
> system understands plus **any others its author chooses** — the agent adds a
> field the way it adds a sentence, and no schema change or migration is needed
> to start using one. Those fields are queryable in the same vocabulary as the
> core ones, so a convention a workspace invents (an assignee, an estimate, a
> customer) becomes a filter the moment it is written, and a view built on it is
> an ordinary view.
>
> **Pattern matching.** Filters on a document's title, body, tags and folder
> accept **glob** patterns — `*` for any run of characters, `?` for one — so
> `title=Catch-Up*` and `folder=work/*` mean what they look like. This is
> distinct from full-text search (`q=`), which ranks whole words across the
> corpus; a glob matches a field literally and says nothing about relevance. A
> pattern with a leading wildcard cannot use an index and scans, which is a
> performance property, not a limit.

## Design questions for the implementing chain
- **Namespacing.** `assignee=theo` reads better than `extra.assignee=theo`, but a
  bare name collides the day a core field of that name is added, and the closed
  core is a deliberate boundary (`doc.ts` explains why). Prefer an explicit
  prefix unless there is a strong argument otherwise, and state the choice.
- **Typing.** `extra_json` holds JSON — strings, numbers, booleans, arrays. Does
  `estimate>3` work, or is everything a string match? Numeric comparison is a
  much larger surface; decide deliberately and say so rather than half-supporting
  it.
- **Missing vs empty.** A document without the field and one with an empty value
  are different. Both need an answer, and it should agree with however the
  existing filters treat absence.
- **Discoverability is half the feature.** Tag filtering already worked and the
  user did not know. Whatever is added must reach the query editor's autocomplete
  and help panel (UI-039 generates both from the schema) — including, ideally,
  the `extra` keys actually present in the workspace, which the projection can
  enumerate.

## Acceptance Criteria
- [ ] Both paragraphs applied to SPEC.md verbatim at phase kickoff
- [ ] The chain does not start before the text is in place

## Technical Design
### Files to Create/Modify
- `SPEC.md` §5

## Testing Strategy
None — spec text.

## E2E Verification Log
_N/A — spec change._

## Completion Checklist (orchestrator)
- [ ] SPEC.md updated
- [ ] Committed with `[SHARED-011]` prefix
