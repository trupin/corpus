# [CLI-069] The help does not say which types retrieval skips

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-144
- Blocks: —

## Spec References

- SPEC.md **§9.2** — retrieval surfaces and their filters
- SPEC.md **§7**, signed rider 2026-08-24 — skills and agent-defs do not rank in
  an unfiltered search; a `template` always ranks

## Summary

SERVER-144 shipped once, was withdrawn from v0.21.0, and returns in v0.22.0 on
the signed rider. Its revert took six CLI help blocks with it, and the
re-implementation restored the behaviour without them.

So the agent's only interface now silently skips document types in an unfiltered
search and says nothing about it anywhere. That is the exact failure this release
is named for: the tool behaves one way and describes another.

**The numbers changed between the two implementations and the old text is
stale.** The withdrawn version excluded three types; the signed one excludes two
on search and four on the neighbour surfaces, and `template` is excluded from
none of them. The `3 of 5 hits` figure in the old wording no longer holds — this
release's probe returns two user rows where four used to be machinery.

## Acceptance Criteria

- [ ] The six help blocks are restored, describing **two** excluded types on
      search and **four** on the neighbour surfaces
- [ ] `template` appears in none of them, as an exclusion or as an example
- [ ] The help says how to reach an excluded type — `--type skill` still returns
      every skill — so the exclusion never reads as "out of reach"
- [ ] No stale count survives. Any figure in the text either matches this
      release's behaviour or is removed rather than guessed
- [ ] A test pins the help text against the server's exclusion lists, so the two
      cannot drift apart again the way they did across the withdrawal

## Technical Design

The pin is the point. This text has now been wrong twice for the same reason —
it restates a server-side list in prose with nothing tying the two together. If a
mechanical pin is not possible, say so in the E2E log and explain what was tried,
rather than restating the list a third time.

## Testing Strategy

Unit coverage for the help output. The falsification is direct: change the
server's exclusion list and the help test must go red.

## E2E Verification Log

_(to be filled by the implementing agent)_
