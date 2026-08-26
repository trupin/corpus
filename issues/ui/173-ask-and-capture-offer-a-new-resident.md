# [UI-173] Ask and Capture offer a new resident

## Domain

ui

## Status

todo

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

- [ ] Both submits offer a designation: **a new general resident** (the default),
      **a named profile**, or **none**
- [ ] **The default is visibly the default.** Rider A makes a general resident
      what happens if a person does nothing, so the control shows that rather
      than presenting an unchosen state
- [ ] **The two choices are not collapsed in the UI either.** A recipient and a
      designation are different acts, and a control that made picking one imply
      the other would be the collapse §10 rules out. They may both be set
- [ ] Capture offers designation although it carries no recipient. The control
      must not imply Capture is routing anywhere
- [ ] The composer's existing statement of who it will reach (§10, "a composer
      says who it will reach, before you send") accounts for the designation, so
      what it says stays true
- [ ] Nothing about the overlay resizes as the choice changes (§10)
- [ ] Keyboard reachable, and it does not steal the composer's own keys

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

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-173]` prefix
