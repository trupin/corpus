# [AGENT-044] The unknown event type keeps its rule, without plugins

## Domain
agent-runtime

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SHARED-067

## Spec References
- SPEC.md **§7** — the queue and the agent loop

## Summary
Remove every plugin trace from the shipped skills. The judgment is recorded in
the commit: the *"an unrecognised event type fails loudly and names why"* rule
survives its cause, because such an event still arrives from an older
workspace's queue, from a hand-written `pending/` file, or from a server newer
than the installed skill.

Removal makes it **stronger**: the `<plugin>.<action>` row used to intercept any
dotted type before the catch-all could name it.

`comment`'s routing bullet was deleted rather than rewritten — the directed
`/<skill>` form is stated a section earlier, and its only other substance was
domain ownership of document types, which no code has any more.

## Acceptance Criteria
- [x] No shipped skill names a plugin surface
- [x] The unknown-event rule is kept and restated
- [x] A structural pin stops plugin routing returning in any shape
