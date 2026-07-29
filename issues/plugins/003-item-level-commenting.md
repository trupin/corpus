# [PLUGINS-003] Item-level anchored commenting on plugin-rendered documents

## Domain

plugins

## Status

todo

## Priority

P2

## Model

fable — requires a design for anchoring outside the body-range model.

## Dependencies

- Depends on: UI-014, PLUGINS-002
- Blocks: —

## Spec References

- issues/sprints/sprint-014.md — Open Conflict 8 + Adjudication 16 (2026-07-28)

## Summary

Filed from sprint-014 Open Conflict 8, struck from PLUGINS-002. Anchored comments on individual
todo items are unreachable today under either storage format: anchors resolve against the document
*body* while items live in frontmatter, and `selectorFromSelection` is a ProseMirror/`DocEditor`
affordance that a plugin `View` replaces entirely (a plugin View wins over the editor — UI-014).
Needs a real design: either a kit-provided selection→selector affordance plugin Views can embed,
or an item-keyed anchor variant, or moving items into the body. Document-level commenting on todo
docs is the v1 behavior.

## Acceptance Criteria

- [ ] Design decision recorded (spec amendment if the anchor model grows a variant).
- [ ] A comment can be opened on an individual todo item from the plugin View and round-trips
      through the standard thread machinery.

## E2E Verification Log

_Filled in by the implementing agent. State the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
