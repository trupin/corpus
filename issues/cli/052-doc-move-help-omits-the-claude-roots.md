# [CLI-052] `doc move`'s help omits `.claude/` from what cannot be moved

## Domain

cli

## Status

done

## Priority

P3

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: CONTRACT-065 (the published half of the same gap), SHARED-054

## Spec References

- SPEC.md **§4** — the workspace layout
- SPEC.md **§7** line 399 — the agent-def and skill roots

## Summary

`apps/cli/src/commands/doc/move.ts:49-50` enumerates what cannot be moved as
**threads and skills**, omitting `.claude/agents/`. `assertMovable`
(`apps/server/src/docs/move.ts:45-58`) refuses every path whose root is not
`docs`, so a persona is refused too.

Raised as a NIT by PR #50's fourth review and filed separately on that reviewer's
recommendation:

> They are different work — one is a cross-package pin, the other is one sentence
> of CLI help text.

## Priority is P3, and lower than when it was raised

The same review noted why: `corpus doc check`'s help now states the refusal and
**quotes the exact error string**, so a reader who hits it has something to
search for. The immediate harm — a person following one help text into a `400`
another help text could have predicted — is closed from the other side.

What remains is that `doc move --help` is the natural place to look before
running `doc move`, and it lists two of three cases.

## Acceptance Criteria

- [x] `doc move`'s help states the rule — **only a document under `data/docs/`
      can be moved** — rather than enumerating, and names `.claude/agents/` as an
      example of what that excludes
- [x] The wording agrees with `assertMovable`'s two messages, quoting both
- [x] `docs/cli.md` **regenerated** (`npm run docs:cli -w apps/cli`), never
      hand-edited
- [x] The rule is stated, not the list extended

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/doc/move.ts`
- `docs/cli.md` — regenerated

### Key Implementation Details

`assertMovable` emits two different messages: `threads are flat under
data/threads/ and cannot be moved` for a thread, and `<path> is not under
data/docs/ and cannot be moved` for everything else. The help should not imply
one message where two exist.

Read `apps/cli/src/commands/doc/check.ts`'s repair paragraph first and match its
substance rather than inventing a fourth wording of the same rule — this release
spent ten sites reducing one claim to one wording.

## Testing Strategy

Whatever pins CLI help text today. The behavioural check is running `doc move` on
a persona and comparing the refusal with what the help predicted.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. `corpus doc move <persona-id> --folder inbox` — capture the real refusal
3. Confirm `doc move --help` predicted it
4. Stop the server; confirm the port is free

## E2E Verification Log

_Filled by the implementing agent (cli-dev, **Opus 5 (1M context)**), 2026-08-24._

### What changed

`apps/cli/src/commands/doc/move.ts`'s description. The old sentence enumerated
two of three cases ("Threads live flat under `data/threads/` and skills inside
their own folder"). It now states the rule and quotes both real messages:

> **Only a document under `data/docs/` can be moved**, and that is the whole
> rule — stated rather than enumerated, because the list is what went stale
> twice (CLI-052). Anything filed anywhere else has a fixed location: a thread
> under `data/threads/`, a skill under `.claude/skills/`, a persona under
> `.claude/agents/`. The server refuses all of them with `this document's
> location is fixed`, in **two** wordings that differ by type — a thread is
> `threads are flat under data/threads/ and cannot be moved`, and everything else
> off the docs root is `<path> is not under data/docs/ and cannot be moved`,
> which names the path so the reason is legible. Repair such a document where it
> is (`corpus doc check`) rather than moving it by hand: off the docs root a file
> often carries no `id:` of its own, so relocating it re-mints the id and breaks
> every `[[ref]]`, anchor and thread pointing at it.

The repair clause matches `doc check`'s substance rather than inventing a fourth
wording, as the Technical Design asked.

### E2E — the refusal against what the help predicted

Throwaway workspace, real server on port 8891 (not 8765, not 5173).

```
$ corpus doc create --type agent-def --title "Bookkeeper"
created doc_leimqmem — .claude/agents/bookkeeper.md

$ corpus doc move doc_leimqmem --folder inbox
      "path": "id",
      "message": ".claude/agents/bookkeeper.md is not under data/docs/ and cannot be moved"
refusal exit=5

$ corpus doc move doc_skillcomment --folder inbox
      "message": ".claude/skills/comment/SKILL.md is not under data/docs/ and cannot be moved"

$ corpus doc move th_32apsx67 --folder inbox
      "message": "threads are flat under data/threads/ and cannot be moved"
```

Both of `assertMovable`'s messages observed, both quoted verbatim in the help,
and the persona case — the omission this issue was filed for — is now predicted
by the text a reader consults first. Server stopped afterwards; port 8891 free.

### Checks

typecheck clean, eslint clean, prettier clean, `docs/cli.md` regenerated,
`vitest run apps/cli scripts/…` — 109 files, 2148 tests, exit 0.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-052]` prefix
