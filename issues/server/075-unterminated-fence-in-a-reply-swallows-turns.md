# [SERVER-075] A person's reply with an unterminated fence swallows every later turn

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Sibling of: SERVER-066 (`doc check` reports it), AGENT-016 (the skill rule)

## Spec References

- SPEC.md **§6** — a fenced block closes only on a line holding nothing but its
  run; a turn that leaves one open swallows the turns after it
- SPEC.md **§14** — the validator reports an unterminated fence

## Summary

**Found by the pr-reviewer during PR #28's final review**, while checking a
sentence I had written into §6 claiming a person is "never refused" for any of
the shapes the form rules name — one of which is an unterminated fence. The
claim was true of the code, and that is the defect: the reply path guards
nothing.

Probed against the real `parseTurns`:

```
body: user turn → "```js" (never closed) → agent turn → user turn
turns parsed: 1
```

**Two turns vanish.** They are still on disk, but every reader — the board, the
projection, the agent — sees one turn. The conversation silently loses its
later half.

`assertAppendableAnswer` (`apps/server/src/threads/forms.ts:140`) checks for
this, but it runs **only on the form-answer route**. The ordinary reply path
(`apps/server/src/threads/turns.ts:246`) calls only `assertWritableForm`, which
no-ops for a non-agent actor. So the one path a person uses most is the one path
unguarded.

**Why this is P0 and not a footnote**: §11's snippet feature exists to paste
fenced content into composers, so producing an unterminated fence is a mainline
action, not a corner case. SERVER-066 made `doc check` *report* the condition
after the fact; nothing stops it being written, and by then the turns are
already invisible.

## The tension this must resolve, deliberately

SERVER-066 chose **non-blocking** for `doc check`: a pre-existing condition must
not block a save, because refusing a person's edit to protect them from
something already on disk is worse than the condition. That decision was right
and stays.

**This is a different moment.** The write being refused is the one *introducing*
the fault, the writer is present, and the fix is one character. Refusing here is
not blocking a save for a pre-existing condition; it is declining to create a new
one. Say that in the code, or someone will read SERVER-066 and revert this.

## Acceptance Criteria

- [ ] Reproduced first, with the swallowing observed before the fix, logged with
      the actual turn count
- [ ] A turn whose body leaves a fence open is refused on the **reply** path, for
      **every** actor — this is not the agent-only asymmetry the form rules draw,
      because the damage does not depend on who wrote it
- [ ] The refusal **names the line the fence opened on**. `unterminatedFence`
      already returns it (`core/code.ts:231-244`); it is currently discarded
- [ ] The person's wording is **never lost** — the refusal is something to fix in
      the composer, not a message arriving after the text is gone
- [ ] A turn that merely *quotes* a fence correctly (opened wider, closed on its
      own line) is untouched — §6's snippet rule depends on it
- [ ] **Pre-existing unterminated fences still do not block anything.**
      SERVER-066's non-blocking decision is unchanged; only the write that
      introduces one is refused
- [ ] `corpus doc check` still reports the condition for files that already have
      it, unchanged

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/turns.ts` (the reply path), reusing
  `unterminatedFence` from `apps/server/src/core/code.ts` — do not write a
  second scanner.

### Notes

- Check `POST /api/threads` (thread creation) and the capture path too. SERVER-070
  found that thread creation is a second door for malformed forms; this is very
  likely the same shape, and finding out after shipping the reply fix would be
  the third time.
- The same scanner is what the UI needs for a pre-check (see CONTRACT-044); if
  moving it to the contract is the right call, coordinate rather than duplicating.

## Testing Strategy

The reviewer's fixture is the regression test: a four-turn body with an
unterminated fence in the first, asserting four turns parse after the fix and
that the write is refused before it. Plus the correctly-quoted-fence case
asserted as accepted, and a pre-existing bad file asserted as still saveable.

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
