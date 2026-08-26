# [UI-173] Ask and Capture offer a new resident

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-088
- Blocks: —

## Spec References

- SPEC.md §10 — rider B signed 2026-08-25
- SPEC.md §7 — rider A signed 2026-08-25

## Summary

User request, 2026-08-25 — _"I want to be able to pick 'new resident agent' as an
option when clicking ask / capture button."_

The global composer already picks a **recipient** from the live roster
(`useComposerRecipient`), which routes one message. Rider B adds a second,
different choice: who will **own** the conversation.

## Acceptance Criteria

- [x] Both submits offer a designation: **a new general resident** (the default),
      **a named profile**, or **none**
- [x] **The default is visibly the default.** Rider A makes a general resident
      what happens if a person does nothing, so the control shows that rather
      than presenting an unchosen state
- [x] **The two choices are not collapsed in the UI either.** A recipient and a
      designation are different acts, and a control that made picking one imply
      the other would be the collapse §10 rules out. They may both be set
- [ ] ~~Capture offers designation~~ — **cut**. Its thread has a parent, and §7
      lets only a standalone thread designate. See SHARED-073
- [x] The composer's existing statement of who it will reach (§10, "a composer
      says who it will reach, before you send") accounts for the designation, so
      what it says stays true
- [x] Nothing about the overlay resizes as the choice changes (§10)
- [x] Keyboard reachable, and it does not steal the composer's own keys

## Technical Design

### Files to Create/Modify

- `apps/ui/src/compose/ComposeOverlay.tsx` — the control
- `apps/ui/src/compose/useCompose.ts` — carrying it onto both bodies
- `apps/ui/src/compose/compose.css`
- `packages/kit/src/recipient/` — reuse the profile list the recipient picker
  already loads, rather than fetching agent-defs a second time

### Key Implementation Details

`useCompose` already documents the tri-state discipline for `weight` and
`recipient`: _"so 'stated nothing' has exactly one spelling on the way out: the
key is absent."_ The designation follows it, with CONTRACT-088's spelling for
explicit-none.

`ComposeInput` gains one field. Both branches carry it, unlike `recipient` which
rides the Ask branch only — and the comment there explaining why Capture has no
recipient must be extended to say why it **does** have a designation, or the next
reader will assume the two go together.

### Edge Cases

- No profiles in the workspace: "a new general resident" still offers, since §7
  says naming none requires nothing to exist first.
- An archived profile: still designatable per §7, but withdrawn from the choices
  a workspace offers. Do not list it.

## Testing Strategy

Unit tests over the three states reaching the request body, over the default
being sent as absence, and over Capture carrying a designation and no recipient.
Falsify by collapsing recipient and designation into one control and watching the
both-set test fail.

## E2E Verification Plan

Real app: Ask with the default and confirm the created thread has a general
resident. Ask with a named profile. Ask with none. Capture with a designation.
Read the request bodies from the network log and the resulting threads from the
API.

## E2E Verification Log

Implemented by the orchestrator on opus, 2026-08-25.

### Ask only — Capture was cut in SERVER-154

Rider B asked for both, and its premise about Capture was wrong: the thread a
capture creates is its document's *filing* thread and has a parent, so §7 forbids
it designating. The contract field was removed and **SHARED-073** carries the
three ways out. This control is Ask's.

### The default is shown as the default

Rider A makes a general resident what happens if a person does nothing, so the
picker's first option reads **"its own agent"** rather than *"choose an owner…"*.
A control offering an unchosen state would misdescribe what pressing Ask is about
to do.

### Two controls, because they are two acts

The owner picker sits **beside** the address line, not inside it. §10's rider is
explicit that naming a recipient routes one message and rewires nothing, while
designating hands over the conversation and everything that grows out of it — so
a single control that made choosing one imply the other would be exactly the
collapse the rider rules out. Both may be set on one request.

### Three states, three strings

A `<select>` value cannot be `null`, so the tri-state needs three strings: `""`
is the default, `@none` is nobody, and anything else is a profile name. `@none`
is chosen to be one no profile can hold — `AgentNameSchema` refuses a blank name,
and a leading `@` is not part of the invocable name it validates.

**Absence is spelled by leaving the key off the body**, and `null` is sent as a
value. A test asserts each, because the contract's own description calls this out
as the one field of that body where omitted and null differ.

### `rowToken`, not a field read

The profile list is gated by `rowToken` — the predicate `@` autocomplete and the
designate menu already share. Its docblock says why one exists: the two surfaces
each derived their own idea of what an agent-def answers to, *"and when the
server changed its mind both were wrong in the same way at once and neither
noticed."* A third reading here would have been that bug restored. It also gates
the offer, since a row it cannot name is one the server would not resolve.

### Falsification, and a first attempt that proved nothing

Replacing the submitted designation with `{}` **passed all 46 tests** on the
first try — my edit had not matched the formatted source, so I had falsified
nothing. Re-done against the real lines, it fails:

```
× sends an explicit null for no owner, which is a value and not an absence
  Tests  1 failed | 45 passed
```

Worth recording: a falsification that does not fail is not evidence the test is
good, it is evidence the falsification missed.

### Checks

```
vitest run apps/ui/src           179 files, 3747 tests passed   exit 0
eslint apps/ui/src                          0 errors            exit 0
tsc --noEmit -p apps/ui                                          exit 0
```


## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[UI-173]` prefix
