# [CONTRACT-066] A menu filters a page the server already truncated

## Domain

contract

## Status

todo

## Priority

P2

## Model

fable

## Dependencies

- Depends on: —
- Blocks: —
- Related: UI-123 (which widened the shape), SERVER-125, UI-122

## Spec References

- SPEC.md **§10** line 539 — the `@` autocomplete, backed by `GET /api/docs`
- SPEC.md **§7** line 399 — the agent-def root

## Summary

Both offer surfaces fetch one page of `type: agent-def` rows and then apply the
addressability gate **client-side, to that page**. `GET /api/docs` is called with
`limit=50` and `sort=-updated`.

So a workspace whose first page of agent-def rows is entirely off-root shows an
empty `@` menu and *"No profiles yet"* while addressable personas exist beyond
the page.

Raised as a NIT by PR #50's third review, and **deliberately not fixed there**.
The implementer's recommendation is adopted, and its reasoning is the substance
of this issue.

## Why it did not ship with UI-123

1. **UI-123 improved that workspace rather than degrading it.** Before the gate,
   those same off-root rows were *offered* — every pick inserted a mention that
   resolved to nobody, and every designation earned a 404. The menu now
   under-offers, which a person can route around: `@bookkeeper` typed by hand
   still resolves, because `parseMentions` never consults the menu. The widening
   converted the worse failure into the milder one.
2. **The bound is narrow.** It needs more than 50 `type: agent-def` documents,
   deliberately filed off-root, all touched more recently than every real
   persona. §7's general designation is unaffected either way (UI-122).
3. **Any honest fix is cross-domain and needs a decision.** See below.
4. **The cheap hedge is not a fix.** Raising the limit from 50 to 200 moves the
   cliff and asserts in code that 200 is enough.

## The decision this issue exists to make

Filtering at the query was already rejected in UI-123: `GET /api/docs?type=agent-def`
must keep returning every agent-def, because the board's `type:` filter and the
seeded "Skills & agents" view read it, and a document *about* a persona has to
stay listed.

What remains is a **new API concept** — an `addressable=true` filter, or a
`folder=` filter — and the question underneath is whether *addressable* belongs
in the API at all. SPEC.md does not answer it.

That is why this is `fable` and why it was not guessed at inside a loose-ends PR:
guessing it is how the next third copy of a rule gets written, which is the
defect UI-123 existed to fix.

## Acceptance Criteria

- [ ] The question in "The decision" is answered, with the rejected shapes and
      why they lost
- [ ] A workspace with more addressable personas than fit one page offers them
- [ ] `GET /api/docs?type=agent-def` still returns every agent-def, so the board
      and the seeded view are unchanged
- [ ] **The same fix closes the pre-existing instance**: the typeable-token
      filter has this identical shape and predates the addressability gate
- [ ] One rule, one home — the client does not grow a fourth copy of what is
      addressable

## Technical Design

### Files to Create/Modify

- `packages/contract` — the filter, if one is added
- `apps/server/src/docs/` — the query
- `packages/kit/src/components/Autocomplete/useAutocomplete.ts`,
  `apps/ui/src/thread/ThreadMenuItems.tsx` — the two call sites

### Key Implementation Details

Read UI-123's "PR #50 third review" section first. It records why query filtering
was rejected and why the client-side gate is where it is.

`packages/kit/src/components/Autocomplete/invocable.ts` is the client's single
home for the rule. Whatever ships must not put a second answer beside it.

## Testing Strategy

A fixture with more addressable personas than the page holds, exercised through
both surfaces. Falsify by restoring the page-local gate and confirming the
overflow case goes red.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Seed more than one page of off-root agent-defs, all touched recently, plus one
   real persona
3. Confirm the real persona is offered in both menus
4. Confirm the board and the "Skills & agents" view still list everything
5. Stop the server; confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-066]` prefix
