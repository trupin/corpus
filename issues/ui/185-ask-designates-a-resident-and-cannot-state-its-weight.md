# [UI-185] Ask designates a resident and cannot state its weight, so `null` means nobody was asked

## Domain

ui

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Blocks: `AGENT-059` reads as the whole defect until this is fixed; it is the
  second half, not the first
- Related: SHARED-073 (Rider A/B — Ask offers a new resident), CONTRACT-067 (the
  wire field), SERVER-129, CLI-053 (`--weight`), UI-126 (the address model)

## Spec References

- SPEC.md **§7** — *"A resident's weight is set when it is designated, not per
  message"* (rider signed 2026-08-19). The designation is the **only** place the
  choice exists.
- SPEC.md **§7** — the same rider: *"a weight stated on a message that reaches a
  resident's lane governs any stage the resident hands off, and never the
  resident's own turn"*
- SPEC.md **§7** — *"Surfaces follow: a composer addressing a resident's lane
  offers no weight for that turn and says why, rather than offering a control
  whose choice is discarded in silence."*

## Summary

Found while diagnosing `AGENT-059`, from the user's question: *"why not provide
the info from the ask/capture form directly to the agent … isn't that in itself a
hole?"* It is, and the hole is further upstream than the question supposed.

**The global composer's `owner` control designates a resident and offers no
weight.** `ComposeOverlay.tsx` renders a bare `<select>` — a general resident, no
resident, or a named profile — and submits:

```ts
resident: resident === undefined ? {} : { resident: resident === null ? null : { name: resident } }
```

`{name}`, and nothing else. Every other surface in the chain carries a weight:

| Surface | States a designation weight? |
| --- | --- |
| `CreateThreadResidentSchema` (contract) | **yes** — `weight` is a field on it |
| `threads/create.ts` (server) | **yes** — reads `input.resident?.weight` |
| `corpus thread designate --weight <key>` | **yes** |
| The thread menu's designate rows (`residentActions.ts`) | **yes**, including an explicit *"the launcher decides"* row |
| **Ask, in the global composer** | **no** |

Ask is where a standalone thread is created, and §7 lets **only** a standalone
thread designate — so this is not one designation surface among several. It is
the one where most residents are born, and it is the only one that cannot say
what its resident runs at.

**So `weight: null` is not "the person chose the launcher's judgment".** The
thread menu makes that a real, pressable row, with its own wording. Ask has no row
at all. The two states are indistinguishable on the wire and mean opposite things
about what the person intended.

## The part that is worse than an omission

**The overlay does show a weight control, and it is the wrong weight.** The one
control feeds `address.weightRequest`, which is submitted as the body's top-level
`weight` — the **message** weight. §7 says in terms that a message weight *"never
governs the resident's own turn"*.

So a person who picks a weight in that composer **and** designates a resident has
their choice routed to the one thing the spec says it does not govern, while the
designation — where the spec says the weight belongs — is created with none. No
surface says this happened.

That is the precise shape §7's own sentence forbids: *"rather than offering a
control whose choice is discarded in silence."* The rider was written about a
composer addressing an existing resident's lane, and that case is handled —
`addressWeight` suppresses the choice there. The case it does not reach is the
composer **creating** one, because `composerAddress` is not told a resident is
being designated at all: its input is `{weight, recipient, live}`, and the
`owner` selection is held in separate state that never reaches it.

## Why this is P0

- **The choice is durable and cannot be corrected in place.** §7: an already
  running resident *"cannot change what it is without discarding the conversation
  it is holding."* A weight nobody was asked for is therefore not a setting to
  adjust later — it is the conversation's model for as long as it lives.
- **It is silent in both directions.** Nothing tells the person their weight went
  to the message, and nothing tells the launcher that no weight was chosen versus
  chosen-as-launcher-decides.
- **It makes `AGENT-059` unfixable on its own.** Any rule the skill adopts for a
  weightless resident is a rule about a state the product manufactures by not
  asking.

## Acceptance Criteria

- [ ] Ask's designation can state a weight, from the same declared vocabulary
      every other surface reads (`useWeightLevels`) — never a hardcoded list
- [ ] The set includes an explicit **"the launcher decides"** member, worded as
      `residentActions.ts` already words it, so choosing it is a decision rather
      than an unpressed state
- [ ] A workspace whose guidance declares no levels offers no weight rows here
      either, exactly as the thread menu behaves
- [ ] The designation weight and the **message** weight are visibly two different
      things in the overlay, and the message control no longer reads as though it
      governs the resident being designated
- [ ] Picking a resident and a message weight together does not silently apply the
      message weight to the designation, and does not silently discard it either
      — whichever is chosen, the overlay says which
- [ ] Capture is unchanged: its thread has a parent, and §7 lets only a standalone
      thread designate (SHARED-073)
- [ ] `{name}` with no weight remains expressible, because omitting the field is
      what the contract's three states are built on

## Technical Design

### Files to Create/Modify

- `apps/ui/src/compose/ComposeOverlay.tsx` — the `owner` control and the submit's
  `resident` shape
- `apps/ui/src/compose/useCompose.ts` — `resident` currently types as
  `{ resident?: { name?: string } | null }` and needs the weight
- Possibly `packages/kit/src/address/addressModel.ts` — if the message-weight
  control's statement must change when a designation is being made
- Tests beside each, plus `apps/ui/e2e/` coverage for the real overlay

### Notes

- **Do not invent a second weight vocabulary.** `useWeightLevels` parses the
  workspace's own orchestrate skill, and SHARED-022 Decision 1 makes that the one
  declaration. The thread menu's `weightOptions` is the pattern to follow.
- The three-state `resident` encoding is deliberate and documented on
  `CreateThreadResidentSchema` — omitted, `null`, `{…}`. A weight rides inside the
  object; it must not become a fourth top-level state.

## Testing Strategy

Component tests over the overlay: the rows offered come from the parsed
declaration, an empty declaration offers none, and the submitted body carries the
weight inside `resident` rather than beside it. A browser spec through the real
composer, asserting what leaves on the wire. Falsify by removing the weight from
the submitted object and watching the wire assertion fail.

## E2E Verification Log

_Filled by the implementing agent; state the model._

**Pre-fix reproduction, 2026-09-01 (orchestrator, Opus 5), by reading the code
rather than the app:** `ComposeOverlay.tsx`'s submit sends
`{ resident: { name: resident } }`; `threads/create.ts` resolves
`residentFor(projection, input.resident?.name, input.resident?.weight)`; the
overlay never sets that field. The user's two live designations arrived as
`{"name":null,"docId":null,"weight":null}`, which is exactly what this path
produces. A running-app confirmation belongs in this log before the fix lands.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
