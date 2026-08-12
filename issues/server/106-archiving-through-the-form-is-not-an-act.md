# [SERVER-106] §4 says archiving closes a window; archiving through `PUT` does not

## Domain

server

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Related: SHARED-040 (§4's act list), SHARED-030 (§11's frontmatter form),
  SERVER-092 (wired the act closers)

## Spec References

- SPEC.md **§4** — "a document archived, restored, moved, renamed, or marked
  still current (§5)" closes a commit window
- SPEC.md **§11** — the frontmatter form carries `title`, `tags`, `status`, `due`

## Summary

Found while correcting a wrong repair of my own during PR #44's review, which is
the only reason it surfaced: I had asserted in §11 that retitling closes a
window. It does not — and checking *why* turned up a real divergence next door.

§4 lists **"a document archived"** among the acts that close a commit window.
`apps/server/src/docs/archive.ts` honours that: `POST /api/docs/{id}/archive`
declares `act: "names-the-window"`.

But a document can also be archived through **`PUT /api/docs/{id}` with
`{status: "archived"}`**, which is what §11's frontmatter form does — and
`apps/server/src/docs/update.ts:377` sets the act **only** for `reviewed`:

```ts
act: Object.hasOwn(fields, "reviewed") ? "names-the-window" : undefined,
```

So the same act closes a window through one door and folds silently through the
other. §4's list is written in terms of what happened to the document, not which
route was used, and a reader checking it against `git log` will find it false
half the time.

## The question to answer first

**Which is right?** Both readings are defensible and the issue should not assume:

- **The act is the act.** §4 describes changes, not routes, so a status flip to
  `archived` through any door should close the window and name its commit. This
  is the reading §4's plain text supports.
- **The form's writes are saves.** §11 (SHARED-030, signed 2026-08-12) puts the
  frontmatter form "under the body's rule", and the applied text now says every
  field it carries is an ordinary save that joins the open window. Making one of
  those four fields an act reintroduces exactly the surprise that rider removed.

They cannot both hold. If the first wins, §11's frontmatter paragraph needs a
carve-out and the form's status control becomes a window-closing act. If the
second wins, §4's list needs to say that archiving **through the archive verb**
is the act — which is a spec change either way, and therefore needs the user.

**Do not settle this in a diff.** Escalate with a recommendation.

## Acceptance Criteria

- [ ] The question above is answered, in writing, and signed if it changes
      SPEC.md
- [ ] Whichever way it goes, the two doors agree — a reader checking §4's list
      against `git log` finds the same answer whichever route was used
- [ ] `docs/acts.test.ts` enumerates §4's lists case by case; whatever is decided
      gets a case there, on the door that currently lacks one
- [ ] The same question is asked of the rest of §4's list. `restored` reaches
      `PUT` the same way (`status` back to `open`), and `marked still current` is
      already `PUT`-only. Name what you found for each rather than fixing only
      the one that was reported

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/update.ts`, and `SPEC.md` if the answer changes it

## Testing Strategy

Beside `docs/acts.test.ts`'s existing per-act cases: a body save, then the status
flip through `PUT`, inside the idle window — asserting whichever behaviour is
decided, with the reasoning in the test's own comment.

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
