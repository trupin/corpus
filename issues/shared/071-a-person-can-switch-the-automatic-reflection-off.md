# [SHARED-071] A person can switch the automatic reflection off, from the board

## Domain

shared

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Blocks: CONTRACT-086, SERVER-151, UI-172

## Spec References

- SPEC.md §7 — "Core event types", the `workspace.reflect` paragraph (rider signed 2026-08-22)
- SPEC.md §9.2 — `POST /api/workspace/reflect` · `GET /api/workspace/reflect`

## Summary

User request, 2026-08-25 — _"I want to be able to disable the auto reflection
entirely from the UI. When auto reflection is off, the only way to make the
agent reflect is by clicking the reflect button."_

**The behaviour already exists. The reach does not.** §7 says `reflect.quiet`
defaults to 30 minutes and that **`0` disables the automatic path**, leaving
asking as the only way a reflection happens. `readQuietMinutes` re-reads the
value on every use, so an edit takes effect with no restart.

What is missing is a way to get at it. **No route writes workspace config.**
`GET /api/workspace/reflect` already reports `quiet`, and nothing anywhere sets
it, so today the only way to switch the automatic path off is to hand-edit
`.corpus/config.json`.

So this is not a new mechanism. It is a write path to a switch the spec already
describes, and a control that flips it. The spec sentence that must change is
the one naming who can reach the value.

## The rider, drafted and unsigned

**This issue does not edit SPEC.md.** Appended to §7's `workspace.reflect`
paragraph, after the sentence beginning _"Or the dust settles"_:

> **A person may switch the automatic path off where they see it.** The board
> bar's Reflect control carries the switch beside the ask, because the two are
> the same decision seen from either side — whether the corpus reflects on its
> own, and asking it to now. Switching it off writes `reflect.quiet: 0` and
> nothing else, so the one rule stays the one rule and the file remains what a
> person edits directly. Switching it on writes the default window. The control
> names the window it will restore before it restores it, because a person whose
> config carried a different one is owed the number rather than a surprise.
> _(Rider signed <date>.)_

## Acceptance Criteria

- [ ] The rider is put to the user, quoted, and applied only once signed
- [ ] No second way to disable the automatic path is introduced — `quiet: 0`
      stays the one rule, and no `reflect.auto` boolean is added
- [ ] The three implementing issues are filed and depend on this one

## Technical Design

### Key Implementation Details

**The one design call, made here so three issues do not each make it
differently.** The wire carries the window in minutes, matching what `GET`
already returns, and `0` keeps the meaning the signed spec gave it. It does not
carry a boolean.

**Rejected: a `reflect.auto` boolean.** Two keys with one effect is two ways to
say the same thing, and this repository's most-repeated defect is a second
mechanism beside a working one. `quiet: 0` is already load-bearing and already
signed.

**Rejected: remembering the window a person switched off from.** It needs a
second config key whose only job is to undo a toggle, and it hides the value
that is about to be written. The control shows the number instead — a person
whose config says 45 sees 45, and sees 30 before switching back on. Anyone who
wants a non-default window edits `.corpus/config.json`, which is the source of
truth and is re-read on every use.

### Edge Cases

- A config file that is absent or unparseable: `readQuietMinutes` already falls
  back to the default, and the write path must not destroy a file it could not
  read.
- A reflection already pending when the switch goes off: the switch governs the
  automatic path only. Nothing cancels work already enqueued.

## Testing Strategy

None here — this issue is a spec decision. Its three children carry the tests.

## E2E Verification Plan

None here.

## E2E Verification Log

<!-- filled by the implementing agent -->

## Completion Checklist (orchestrator)

- [ ] Rider signed by the user
- [ ] SPEC.md §7 amended
- [ ] Committed with `[SHARED-071]` prefix
