# [SHARED-067] The plugin system is removed, and the core is the whole of it

## Domain
shared (orchestrator)

## Status
done — **SIGNED by the user 2026-08-22** (as the `/goal` opening Phase 41), applied
to SPEC.md the same day.

**The renumber was the expensive half, and it carried a hazard the checker cannot
see.** Deleting §10, §12 and §13 moved UI from §10 to §10, Validation from §11 to
§10, and Milestones from §12 to §12. A citation to a section that no longer
exists is caught by `spec:check`. A citation to §10 meaning *UI* that now lands
on *Validation* is not — it resolves, and it is wrong. So the sweep was done in a
single pass with placeholders rather than three passes: **1,574 citations across
596 files**, with no window in which two numbers meant the same thing.

## Priority
P0

## Model
fable

## Dependencies
- Depends on: —
- Blocks: the whole of Phase 41

## The instruction

User, 2026-08-22: *"I want to remove the plugin surface. No more plugin. Which
means let's delete the todo plugin as well. I want it fully gone, no trace of it
in the codebase or the specs."*

Asked what should become of `todo` — since v0.17.0's derived `status` and `due`
are plugin-declared — the user chose **delete it entirely: `todo` is not a
type**, with the consequences named and accepted.

## Why this is a rider and not a deletion

**Plugins are not a subsystem in this spec. They are a premise.** §1 states it as
a goal:

> The core is deliberately small; every domain feature (todos, schedules, domain
> agents, …) is a **plugin**.

That sentence is why §5's `type` is an open string, why §9 has an `/api/x/`
route space, why `packages/kit` exists in the shape it does, and why §12's M6 is
a milestone. Deleting §10, §12 and §13 without answering §1 would leave the spec
asserting an architecture the code no longer has.

So this rider **replaces the premise** rather than removing a feature, and that
is what needs a signature.

## The drafted amendments

**1. §1 — the goal line.** Replace:

> The core is deliberately small; every domain feature (todos, schedules, domain
> agents, …) is a **plugin**.

with:

> The core is deliberately small, and it is the whole of the product. There is no
> extension surface in the code: what would have been a plugin is a **convention
> in documents and a skill the agent follows**. A domain gets its shape from the
> templates, views and skills a workspace holds — all of them documents (§5, §7)
> — so extending Corpus means writing in the corpus, never building against it.

**2. §1 — non-goals.** Strike `plugin distribution/installation beyond the set
bundled with the tool` from the list; there is nothing to distribute.

**3. §2 — repository layout.** Delete the `plugins/` entry. Reword
`packages/kit` from *"the plugin-facing UI kit"* to *"the shared UI kit — the
components and data hooks `apps/ui` is built from"*, and drop its §10 reference.

**4. §4 — workspace layout.** In the `.claude/skills/` line, strike
`(+ plugin skills)`.

**5. §5 — the `type` field.** Replace the comment
`"note" | "thread" | "view" | "template" | "skill" | "agent-def" | plugin types (e.g. "todo")`
with the six core values alone. **The wire type stays an open string** — a
document carrying an unrecognised `type:` must still parse, render and be
searchable, because workspaces already hold `type: todo` documents and they are
not to break. Say so, so the openness reads as deliberate rather than as a
leftover.

**6. §7 — core event types.** Strike `Plugins may define their own types`.

**7. §9 — the projection.** `extra_json` keeps its column and loses its plugin
framing: it carries **extra frontmatter** — any key the core does not define —
as opaque passthrough the server never interprets.

**8. §9 — the route table.** Delete `Plugin routes mount under
/api/x/<plugin>/...`.

**9. §10 — delete the section entirely.**

**10. §12 — delete the section entirely** (Reference plugin: todos).

**11. §13 — delete the section entirely** (Publish plugin). It describes the
first plugin after todos, which will now never exist.

**12. §12 — milestones.** M6 (*plugin system + todos plugin*) is struck and the
remaining milestones renumber. Its subtractive check — *delete `plugins/todos` →
app still boots and todo docs render* — is **kept in substance** as a check on
§5's open type: a document whose `type:` the core does not know still opens,
renders and searches.

Sections after §10 renumber. Every cross-reference to §10, §12 and §13 elsewhere
in the spec is repointed or removed.

## What the user is accepting, recorded because it is a real loss

- A todo list's `status` stops reading its items, and its `due` stops rolling up
  — **the 18-days-overdue report that motivated v0.17.0 returns.**
- The stats panel, the item routes and `corpus todos` verbs go.
- **A pre-PLUGINS-005 todo, whose items live in an `items:` frontmatter key
  rather than as checkbox lines, opens as near-empty prose.** Its items are
  preserved verbatim in `extra` and reachable through the file itself or
  `doc show --json`, but nothing renders them, and `corpus todos migrate` — the
  only converter — goes with the plugin. **This was not in the loss the user
  accepted**; it was found by PR #57's cold reviewer, which noticed that the
  deleted `todos-legacy.spec.ts` had been guarding exactly this state. Named
  here rather than left to be discovered.
- Existing `type: todo` documents keep working as ordinary markdown, checkboxes
  included. This is not a guess: v0.17.0's subtractive check was run twice
  against a real server, and the board rendered a todo document in the core
  editor with a checkbox whose click persisted to disk.

## Acceptance
Nothing until signed. On signature the orchestrator applies every amendment
above, and Phase 41 removes the code.
