# [SERVER-102] Adding a tag merges in bulk and races on a single document

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: SHARED-041 (§7's keyless rule rests on this), CONTRACT-049,
  CLI-008 item 3 (accepted the race originally)

## Spec References

- SPEC.md **§7** — "A write that names its own delta does **not** need one —
  adding a tag … Those say what they change, so they **merge with whatever else
  happened** rather than overwriting it"

## Summary

Found by PR #43's review. §7's keyless half rests on a claim that is true of one
of the two tag paths and false of the other.

- **`POST /api/docs/bulk`'s `tag` action merges server-side**, inside the write
  lane (`apps/server/src/docs/bulk.ts`, `nextTags`). It genuinely cannot lose a
  tag.
- **`corpus doc edit --add-tag` reads the list, merges in the client, and sends
  the whole set.** Two concurrent calls each `GET` the same list, each `PUT` its
  own merge, and the second wins with the first's tag missing.

`apps/cli/src/commands/doc/edit.ts` has documented this as an accepted race since
CLI-008. What changed is that §7 now makes a **guarantee** out of it —
"they merge with whatever else happened" — and one path does not.

The key does not close this and is not meant to: `tags` is deliberately keyless
because §7 names adding a tag as the canonical keyless write. Making it keyed
would refuse the very write the spec holds up as needing no key.

## The fix is a wire shape, not a guard

The single-document route offers only `tags: [...]` — a whole-set replacement. A
client that wants to add one tag has no way to say so. The bulk route already
models the delta; the single-document route does not.

So the work is to give `PUT /api/docs/{id}` (or a sibling) the same delta the
bulk action already has, and have the CLI send it instead of a computed set.
That makes §7's sentence true by mechanism rather than by shape.

**Do not close this by making `tags` a keyed field.** That contradicts §7's own
example and would make the canonical keyless write require a key.

## Acceptance Criteria

- [ ] Reproduce first: two concurrent `corpus doc edit --add-tag` calls against
      one document, one tag lost
- [ ] The single-document path expresses a tag **delta**, merged server-side
      inside the write lane, exactly as the bulk action does
- [ ] `corpus doc edit --add-tag` / `--remove-tag` send the delta rather than a
      computed whole set, and the accepted-race comment at
      `apps/cli/src/commands/doc/edit.ts` is deleted rather than reworded
- [ ] `tags` stays **keyless** — §7's canonical keyless write must not start
      needing a key
- [ ] The same question is asked of every other whole-set frontmatter field on
      `UpdateDocRequest`. If another one has the same shape, it has the same bug;
      name what you found either way
- [ ] `packages/contract/src/schemas/key.ts`'s paragraph on `tags` is updated —
      it currently points here

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/doc.ts` (the request shape),
  `apps/server/src/docs/update.ts`, `apps/cli/src/commands/doc/edit.ts`

### Notes

- This is a contract change and therefore two issues by CLAUDE.md's rule; split
  it when it is picked up, with the contract first.

## Testing Strategy

Two concurrent adds against one document, asserting both tags survive. The
existing bulk merge test is the shape to copy.

## E2E Verification Log

_Filled by the implementing agent; state the model. This is a bug: the pre-fix
reproduction is mandatory._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
