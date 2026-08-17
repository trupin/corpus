# [CLI-045] `corpus doc diff --help` describes the old default base

## Domain

cli

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SERVER-113 (which changed the behaviour being described)
- Related: CONTRACT-052 (the same sentence in the published OpenAPI),
  SHARED-045 (the same sentence in SPEC.md)

## Spec References

- SPEC.md §4 — party-scoped commit windows, path-scoped per-document diffs

## Summary

`SERVER-113` changed the diff default base to *the previous commit that touched
this document*. `apps/cli/src/commands/doc/diff.ts` still tells the reader it is
the parent of `to`, at roughly lines 193 and 219.

Lower priority than `CONTRACT-052` only because the audience is narrower and the
correction is cheaper to discover — an agent reading the help and getting a
surprising range can run `git log -- <path>` and see why. An API consumer reading
`openapi.json` gets no such hint.

## Acceptance Criteria

- [x] The help text states the actual rule, including the empty-tree case for a
      document whose only commit is its first
- [x] Any other CLI surface describing the diff base is swept in the same pass —
      check `doc show`, the edit-acknowledgment help, and the man-page-style
      output, not only the two known lines
- [x] No behavioural change

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/doc/diff.ts`

## Testing Strategy

If help text is snapshot-tested, update the snapshot; otherwise this is a
read-and-fix with no new test, and say so rather than inventing one.

## E2E Verification Log

**Model: opus (claude-opus-5[1m]).**

No server drill: this is help text over behaviour SERVER-113 already covers, and
a drill would prove SERVER-113's point rather than this one. Verified by
rendering the real help through the real command surface.

### What the sweep covered

Walked every CLI surface that could describe a diff base or a commit range,
rather than grepping for "parent of" and stopping:

| Surface swept                                                       | Found                                                       |
| ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `doc/diff.ts` — module docblock, `revision()` hint, description, both flag descriptions, all three examples | **3 stale**, one more than the issue named       |
| `doc/show.ts`                                                       | clean — describes no history or diff base                   |
| `doc/index.ts` (topic help), `doc/edit.ts`, `doc/patch.ts`          | clean — name `diff` as the escalation, never its base       |
| `queue/claim-all.ts`, `queue/idle.ts`, `queue/transitions.ts`, `queue/defer.ts` (the `doc.edited` / edit-acknowledgment surfaces) | clean — carry the range, describe no default |
| `job/log.ts`, `job/console.ts`, `input.ts`, `skill/*`               | clean — mention `corpus doc diff` only as a next move       |
| `docs/cli.md`                                                       | generated; regenerated from the registry                    |

The **third** stale description is the one grepping would have missed, and it is
the same class of miss CONTRACT-052 recorded. It was not the phrase "parent of"
at all:

> "including the empty-tree sha an event carries when the document was
> introduced by **the repository's very first commit**"

`EMPTY_TREE_OBJECT_ID`'s own docblock says this is "not the exotic case it once
was" — because both bases now walk this document's history, *every* document's
first change diffs against the empty tree, not only one created by the root
commit. The line was true before SERVER-113 and is too narrow after it.

Three fixes, all in `apps/cli/src/commands/doc/diff.ts`, all taking
`packages/contract/src/schemas/edit.ts`'s language rather than a third phrasing:

1. the `doc.edited` paragraph — the empty-tree case widened past the root commit;
2. the "both halves default independently" paragraph — `from` is the newest
   commit **before `to` that touched this document**, empty tree when none did,
   plus CONTRACT-052's *why* (party-scoped windows, so `to`'s parent is whoever
   else's document was saved in the same window);
3. the `--from-rev` flag description — same rule, same reason, flag-sized.

### Outside my domain, reported not touched

Two stale descriptions of the same rule live in `assets/workspace/` (agent-runtime,
and another agent is working that tree):

- `assets/workspace/claude/skills/orchestrate/SKILL.md:937` — "empty-tree sha
  carried by a document **the repository's first commit** introduced", the same
  too-narrow framing as fix 1 above.
- `assets/workspace/claude/skills/comment/SKILL.md:358` — "`corpus doc diff <id>`
  prints … its last committed change", which reads correctly under the new rule
  but is worth a glance in the same pass.

### Pinned

The help is not snapshot-tested, so the rule was pinned rather than left
unasserted — the defect being fixed is documentation drifting from behaviour, so
"no test" would leave the same drift free to recur. Three tests in
`doc/diff.test.ts` assert what the base *is*, that the old shorthand is gone
(`not.toMatch(/parent of (?:`to`|the head)/)`), that the *reason* is stated
(`party-scoped`, which is what stops it drifting back), and that the empty-tree
case is no longer confined to the root commit.

**Falsified**: reverting the base sentence to "the parent of `to`" failed
"states the default base SERVER-113 actually implements"; reverting the
empty-tree sentence to "the repository's very first commit" failed "no longer
confines the empty-tree base to the repository's root commit". Both reverted.

`npm test -w apps/cli`: 92 files, 1502 tests, all passing.
`tsc --noEmit -p apps/cli`: exit 0. `eslint`: exit 0.
`docs/cli.md` regenerated and Prettier-clean; no behavioural change (`runDocDiff`
and `revision()` are untouched).

## Completion Checklist (domain agent)

- [x] `/lint` passes
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-045]` prefix
