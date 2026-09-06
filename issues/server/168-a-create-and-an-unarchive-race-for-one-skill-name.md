# [SERVER-168] A create and an unarchive race for one skill name

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
- Blocks: —

## Origin

Re-filed 2026-09-06 from **SHARED-003** (the PR #11 / PR #12 review ledger), PR
#12 review, 2026-07-30:

> (server, TOCTOU) skills/create.ts:104-120 — create (CREATE_LANE) vs unarchive
> (doc lane) interleave lets create silently overwrite a just-unarchived skill;
> microsecond window, git preserves content; untested.

The 2026-09-06 audit re-checked the code. The line numbers moved but the defect
did not: the two paths still take **disjoint lane sets**, and there is still no
test.

## Spec References

- SPEC.md §7 — skill genesis (`corpus skill create`, `POST /api/skills`) and the
  archive folder move
- SPEC.md §9.2 — `POST /api/skills`, "`409` when the name is already installed"

The 409 is the contract's promise that a name is claimed once. The race lets a
create pass the check and then write over a name that became installed in the
window.

## Summary

Skill creation serialises on one global `CREATE_LANE`, because the thing being
protected is the **name**. Unarchiving a skill serialises on the **document ids**
it moves. The two lane sets never intersect, so nothing orders a create against
an unarchive that restores a skill of the same name. A create can call
`assertNameFree`, find the name free because the skill is still archived, and
then write `SKILL.md` at that path after the unarchive has moved the archived
skill back to it — silently turning a restore into an edit. The window is
microseconds, git preserves the overwritten content, and no test covers it.

## Acceptance Criteria

- [ ] Creating a skill and unarchiving a skill of the same name cannot interleave
      between the name check and the write.
- [ ] The chosen mechanism is stated in a comment at both sites, so the next
      reader can see why the lane sets now intersect (or why a different
      mechanism was used).
- [ ] A test drives the interleaving deterministically — not by timing, but by
      gating the two operations on each other — and asserts the second one loses
      cleanly: either a `409` from the create, or the create succeeding only
      after the unarchive completed and then correctly reporting the collision.
- [ ] Which of those two outcomes is correct is decided and written down. The
      contract says `409` when the name is already installed, so a create that
      began before the unarchive and finished after it should still 409.
- [ ] No regression in the `create` path's existing serialisation for two
      concurrent creates of one name (SERVER-036's case).
- [ ] The archive/unarchive path's carried-skill lane set (PR #38 finding 3) is
      preserved: the fix must not narrow the lanes that act already holds.

## Technical Design

### Files to Create/Modify

- `apps/server/src/skills/create.ts` — the lane taken at line 189 and the
  `assertNameFree` call at line 190.
- `apps/server/src/docs/archive.ts` — the lane set at line 605.
- A test beside whichever module ends up owning the ordering.

### Key Implementation Details

`apps/server/src/skills/create.ts:183-190`:

```ts
  // The lane every create takes. It is not about the id — those are minted free
  // — but about the name: two concurrent creates of one name would otherwise
  // both find it unclaimed and race to write the same file, and the second
  // would silently become an edit of the first (SERVER-036). One lane for all
  // creates is what `docs/create.ts` already does, for the same reason about
  // slugs.
  return mutex.run(CREATE_LANE, async () => {
    assertNameFree(workspace, name);
```

`apps/server/src/docs/archive.ts:598-605`:

```ts
  // §7's folder move carries — and this verb therefore *writes* — every other
  // `SKILL.md` under the folder, so their lanes are held for the whole act (PR
  // #38, finding 3). Read before any lane is taken, because which lanes to hold
  // is a question only the current tree answers; an id that fails to load here
  // fails inside too, on the read that reports.
  const carried = prospectiveCarriedIds(workspace, id, archived);

  return runInLanes(mutex, [id, ...carried], async () => {
```

The comment in `create.ts` already names the invariant the fix must extend: the
lane is about the **name**. An unarchive that restores a skill also claims a
name, and it does not take the name's lane.

Candidate shapes, to be judged by the implementing agent:

1. **Make unarchive take `CREATE_LANE` too**, but only when the document being
   unarchived (or carried) is a skill. Smallest change, and it makes the two
   paths share exactly the resource they contend for. Cost: it serialises
   skill unarchives against all creates, including creates of unrelated names.
   Given how rare both operations are, that is probably acceptable — say so
   explicitly rather than leaving it implied.
2. **A per-name lane** (`skill-name:<name>`) held by both paths, in addition to
   the lanes each already takes. Finer-grained, more moving parts, and the
   unarchive side has to know the names of every carried skill before taking
   lanes — which `prospectiveCarriedIds` already computes ids for.

Whichever is chosen, the lane acquisition order must be fixed and documented, or
holding two lanes on both paths reintroduces a deadlock.

### Edge Cases

- A folder unarchive **carries** other skills (PR #38 finding 3). Every carried
  skill claims a name too, so the guard must cover the carried set, not only the
  requested id.
- Archiving is the inverse and **frees** a name. A create racing an archive is
  benign in the other direction (the create sees the name still taken and 409s,
  or sees it free after the move and succeeds) but should be reasoned about in
  the issue log rather than assumed.
- `assertNameFree` reads the projection. Confirm whether the projection is
  updated inside the mutation or after it — if after, the window is wider than
  the lane analysis suggests, and that is a second finding worth recording.
- Nothing here may make `POST /api/skills` slower in the ordinary uncontended
  case.

## Testing Strategy

The point of this issue is the test as much as the fix. Do not write a timing
test. Gate the two operations on each other explicitly — a promise the test
resolves between the unarchive's read and its write, or an injected hook — so
the interleaving is deterministic and the test fails reliably against the
current code before the fix.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start the server. Create a skill `demo`, then archive it.
2. Fire `POST /api/docs/<id>` (unarchive) and `POST /api/skills` (name `demo`)
   concurrently, repeatedly, from two processes.
3. Expected: every create either 409s or the skill's content is the unarchived
   one — never a silently overwritten file.
4. Actual: with the right interleaving, the created skill's body replaces the
   restored one and the response is a 200 create.

Note the window is microseconds, so a live reproduction may need many
iterations. A deterministic unit-level reproduction is acceptable as the primary
evidence **provided** the E2E leg demonstrates the post-fix behaviour on the real
server. State plainly in the log which leg proved what.

### Verification Steps

1. Restart the server after the fix.
2. Repeat the concurrent loop; assert no overwrite occurs across the run.
3. Confirm two concurrent creates of one name still produce exactly one skill and
   one 409 (SERVER-036's case is not regressed).
4. Confirm a folder unarchive carrying several skills still moves all of them.

## E2E Verification Log

_[Agent fills. State which model the implementing agent ran on.]_

### Reproduction (bugs only)

_[Agent fills]_

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (concurrency — qualifying)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-168]` prefix
