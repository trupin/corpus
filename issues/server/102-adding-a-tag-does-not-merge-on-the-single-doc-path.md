# [SERVER-102] Adding a tag merges in bulk and races on a single document

## Domain

server

## Status

done

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

- [x] Reproduce first: two concurrent `corpus doc edit --add-tag` calls against
      one document, one tag lost — **5 rounds, 5 tags lost**
- [x] The single-document path expresses a tag **delta**, merged server-side
      inside the write lane, exactly as the bulk action does — and through the
      **same function**, `docs/tags.ts`'s `nextTags`, which `bulk.ts` now imports
- [x] `corpus doc edit --add-tag` / `--remove-tag` send the delta rather than a
      computed whole set, and the accepted-race comment at
      `apps/cli/src/commands/doc/edit.ts` is deleted rather than reworded —
      `mergeTags` and its docblock are **gone**, and the command help no longer
      advertises the race
- [x] `tags` stays **keyless** — §7's canonical keyless write must not start
      needing a key — `KEYED_UPDATE_FIELDS` is untouched, and a test sends
      `addTags` with no key at all
- [x] The same question is asked of every other whole-set frontmatter field on
      `UpdateDocRequest` — **`tags` is the only one.** See "The sweep" below
- [x] `packages/contract/src/schemas/key.ts`'s paragraph on `tags` is updated —
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

**Model: Opus 5 (1M context), as server-dev.** Real server from source on
**port 8791** (never 8765/5173), scratch workspace
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/ws102`, real `corpus` CLI from
`apps/cli/dist`.

### Pre-fix reproduction (mandatory)

Five rounds, each firing two `corpus doc edit --add-tag` processes at one
document and waiting for both:

```
round 1: ['beta1']
round 2: ['beta1', 'beta2']
round 3: ['beta1', 'beta2', 'alpha3']
round 4: ['beta1', 'beta2', 'alpha3', 'alpha4']
round 5: ['beta1', 'beta2', 'alpha3', 'alpha4', 'alpha5']
```

Ten tags asked for, **five on disk**. Every round lost exactly one, and both
processes exited 0 — the loss is silent, which is the part that matters.

### The diagnosis held

The issue's reading was right in full: the bulk act merged, the single-document
path did not, and the missing thing was a **wire shape** rather than a guard.
Nothing had to be re-diagnosed.

### The fix, in three places

- **Contract** — `UpdateDocRequestSchema` gains `addTags` / `removeTags`.
  A refinement refuses a request carrying `tags` alongside either, reported at
  `addTags`: stating the set and stating a change to it are contradictory, and
  the caller most likely to send both is one half-migrated from the whole-set
  field, which must be told rather than accommodated. `openapi.json` and
  `schema.generated.ts` regenerated (+19 / +5 lines — nothing else moved).
- **Server** — `nextTags` moved out of `docs/bulk.ts` into `docs/tags.ts` and is
  now imported by both writes, so the two paths cannot drift on order, on
  duplicates, or on a tag named in both lists. `changedFields` applies the delta
  against `current` — the bytes `updateDocumentLocked` just read off disk, inside
  `mutex.run(id, …)` — and puts the result through the same "different from the
  file?" gate every other field passes, so a delta that asks for what is already
  there is a no-op rather than a commit.
- **CLI** — `mergeTags` deleted along with its accepted-race docblock; the flags
  now send `addTags`/`removeTags`. `--add-tag` costs **no read at all** now:
  the `GET` that remains belongs to `--status`, and only to phrase the archived
  refusal. Command description rewritten (and `docs/cli.md` regenerated).

### Post-fix E2E — the same five rounds

```
round 1: ['alpha1', 'beta1']
round 2: ['alpha1', 'beta1', 'beta2', 'alpha2']
round 3: ['alpha1', 'beta1', 'beta2', 'alpha2', 'alpha3', 'beta3']
round 4: [... 8 tags ...]
round 5: ['alpha1','beta1','beta2','alpha2','alpha3','beta3','beta4','alpha4','alpha5','beta5']
```

**10 of 10 survive**, against 5 of 10 before.

Everything else, on the same running server:

```
$ corpus doc edit doc_dfaoq7r7 --remove-tag alpha1 --remove-tag beta1 --add-tag housing
edited doc_dfaoq7r7                       # keyless, one request, add+remove together

$ grep -A9 '^tags:' data/docs/notes/tag-race-2.md
tags:
  - beta2 … - housing                     # the file, which §5 makes the truth

$ curl -X PUT -d '{"tags":["x"],"addTags":["y"]}' …/api/docs/doc_dfaoq7r7
400  bad_request  json.addTags: send either `tags` … or `addTags`/`removeTags` … not both

$ corpus doc edit doc_dfaoq7r7 --add-tag housing   # already carries it
head moved: no                            # a no-op delta commits nothing

.corpus/server.log for one `--add-tag`:
{"method":"PUT","path":"/api/docs/doc_dfaoq7r7","status":200}   # and no GET
```

### The sweep — every other whole-set field on `UpdateDocRequest`

`tags` is the **only** one, and the rest fail the test for different reasons:

- `title`, `status`, `due`, `reviewed`, `evergreen`, `pinned`, `order`, `column`
  — scalars. Naming one is a complete statement of the change; last-writer-wins
  loses nothing the request did not itself state.
- `query` — object-valued but one view key, replaced wholesale by the caller that
  is editing that view. It is a value, not a collection of other writers'
  contributions.
- `extra` — an RFC 7386 shallow merge patch, per-key delta by construction. Two
  plugins writing different keys already cannot race.
- `body` — the keyed write. §7 covers it by a different mechanism entirely.
- `origin` — clear-only and user-only.

So no second instance of this bug exists on this request. Recorded in
`packages/contract/src/schemas/key.ts`, which is where the next person
classifying a new field will look.

`apps/ui/src/reader/FrontmatterForm.tsx` still sends `tags` as a whole set, and
**that is correct**: it is a comma-separated text field a person types the entire
list into, which is exactly the "these and no others" intent `tags` remains on
the request for.

### Tests, and that they fail without the fix

`apps/server/src/docs/update.test.ts`, new describe "a tag delta merges rather
than overwrites" — seven cases, every concurrent one issuing **both writes before
awaiting either**:

- "keeps both tags when two writers add one each at the same time"
- "loses one when the same two writers each send a whole set they computed" —
  the pre-fix reproduction, kept as the contrast that shows the fix is a wire
  shape rather than a guard
- removal merged against the file; a tag in both lists resolving as a removal;
  the no-op; keyless; the contradiction refusal

**Verified red**: the merge was moved *outside* `mutex.run` (computed from a
snapshot taken before the lane, exactly as the client used to) — two cases went
red, including a `draft` tag surviving a `removeTags` that had raced an
`addTags`. So the tests measure the **lane**, not the arithmetic. Separately, the
contradiction case was verified red by neutering the refinement.

`apps/cli/src/commands/doc/edit.test.ts`: the two tag tests now assert the delta
on the wire and that **no `GET` is made**; the test that pinned the race in the
help text now asserts the help no longer claims one.

Whole `apps/server` suite: 3855 passed, 1 failed — `threads/resident.test.ts`,
SERVER-109's in-flight work, untouched by this change. `npm run typecheck` clean.
`npm run lint` clean for every file this touched.

### Scope note

The issue says this is a contract change and so two issues by CLAUDE.md's rule.
It was delivered as one because the orchestrator assigned it whole; the contract
edit is confined to `schemas/doc.ts` + `schemas/key.ts` and the two generated
artifacts, and the CLI edit to `commands/doc/edit.ts`. Neither file was being
touched by the concurrent SERVER-109 work.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
