# [SHARED-052] `corpus doc check` can report what a save accepts, and §11 says it cannot

## Domain

shared

## Status

done — signed by the user 2026-08-20 (as drafted, in the v0.15.0 go-ahead). SPEC.md text applied 2026-08-20. The CLI half was already true from PR #50 (`doc check`'s help states the exit-6/save asymmetry); the remaining consequence, an ill-shaped block that vanishes a designation silently, is **SERVER-132**.

## Priority

P1

## Model

fable

## Dependencies

- Depends on: SERVER-124 (which widened the class), SERVER-123 (which created it)
- Blocks: merging PR #50 without a recorded waiver
- Related: SHARED-049, SHARED-050, SHARED-051 — **read one at a time**

## Spec References

- SPEC.md **§11** line 594 — *"Every server mutation validates before writing.
  **The same validator behind `corpus doc check` runs on every save** …
  Unresolvable-but-well-formed anchors (orphaned threads) and unresolved
  `[[refs]]` are warnings, not failures."* _(Rider signed 2026-08-07.)_

## Summary

Found by PR #50's second review, and it is the finding that would otherwise have
shipped unnoticed — the orchestrator believed SHARED-049, -050 and -051 were the
whole spec debt of this release.

§11:594 makes two claims. The validator behind `corpus doc check` is the **same**
one that runs on every save, and the things that are *warning rather than
failure* are **two**: orphaned anchors, and unresolved `[[refs]]`. The list reads
as exhaustive.

**There is a third class, and this release widens it.** A finding can be an
**error** in `corpus doc check` — exit 6 — while the save path accepts the same
bytes. The branch's own test says so in its title:
`apps/server/src/check/routes.test.ts:545`, *"agrees with the write path the
other way: what a check reports, a save still accepts"*, asserting `PUT` → 200
and `POST /api/check` → `errors: ["frontmatter-invalid"]` on one document.

**The class pre-exists this release.** `REPORTED_CHECK_CODES`
(`apps/server/src/docs/write.ts:126`) already held `unterminated-fence`, which
§11:594 names in its own list of what the validator checks and which also does
not block a save. So the spec was already inaccurate; SERVER-123 and SERVER-124
widened it.

## The user-facing change nobody is told about

Take a workspace holding a hand-authored `.claude/agents/x.md` carrying
`status: banana`.

| | before this branch | after |
| --- | --- | --- |
| `corpus doc check` | exit 0 | **exit 6** |
| save the same file | accepted | accepted |

Someone whose pre-commit gate is `corpus doc check` gets a red gate on a file the
server itself just wrote to. Nothing user-facing explains it:
`apps/cli/src/commands/doc/check.ts`'s help is silent, `docs/cli.md`'s
`doc check` section is untouched by this branch, and there is no release note.

**The code is not what should change.** Blocking would reproduce the regression
PR #49 caught, where a check made hand-authored profiles unwritable with no
repair the board could express. Reported-not-blocking is the right design. What
is missing is that the spec says it is impossible.

## The drafted text — read this back verbatim before applying

Insert into **§11**, immediately after the sentence ending *"are warnings, not
failures"* in the first bullet at line 594:

> **A finding may be reported without refusing the write.** The validator is one,
> and its verdict is read twice: `corpus doc check` reports **everything** it
> finds, and the write path refuses only what would make a document unreadable to
> the corpus. So a third state exists beside warning and failure — an **error a
> save accepts** — and it exists on purpose. A document Corpus did not author,
> under `.claude/` (§7), may carry a malformed field Corpus never wrote, and a
> file that is merely wrong must stay editable, because refusing every write to it
> would leave a person no way to repair it through the app. `corpus doc check`
> therefore exits non-zero on documents the server will still happily save, and a
> workspace using it as a gate should expect that. The reverse never holds: the
> write path refuses nothing `check` would pass over in silence.
> _(Rider signed 2026-08-\_\_.)_

## What the sign-off decides

1. **Whether the asymmetry is stated or removed.** Removing it means either
   blocking those writes (rejected — it is PR #49's regression) or demoting the
   findings to warnings (rejected — a malformed `status` is an error, and
   demoting it makes `check` say less than it knows). The draft states it.
2. Whether the last sentence — *"the reverse never holds"* — is a promise worth
   making. It is true today and it is the invariant a reader most wants. Making
   it normative means a future blocking-but-unreported finding is a spec
   violation, which is the intent.
3. Whether `corpus doc check`'s own help and `docs/cli.md` should say this too.
   **They should**, and that is a code change rather than a spec one — filed as
   part of this issue's acceptance criteria, not deferred.

## Acceptance Criteria

- [x] The user has signed the drafted text, verbatim, on its own
- [x] SPEC.md §11 states that a finding may be reported without refusing the write
- [x] `corpus doc check`'s CLI help says the same, in one sentence, and
      `docs/cli.md` is **regenerated** rather than hand-edited
- [x] The release notes for the version that ships SERVER-124 state the exit-code
      change plainly, so a workspace gating on `doc check` is not surprised —
      **carried to v0.15.0's notes**, since SERVER-124 shipped in v0.12.0 before
      this rider was signed and its notes could not have stated a rule that did
      not yet exist
- [x] `npm run spec:check` passes
- [x] No other §11 bullet is reworded to agree with it

## Technical Design

### Files to Create/Modify

- `SPEC.md` — §11, the first bullet only
- `apps/cli/src/commands/doc/check.ts` — the help text
- `docs/cli.md` — regenerated

### Key Implementation Details

Quote rather than paraphrase when reading it back (SHARED-045).

`REPORTED_CHECK_CODES` and `isClaudeRootFrontmatter` in
`apps/server/src/docs/write.ts` are the two mechanisms this sentence describes.
Read both before writing the help text, so the CLI's wording and the server's
behaviour cannot part company — which is the defect CONTRACT-064 spent four
sites correcting.

## Testing Strategy

`npm run spec:check` for the citation. The behaviour is already covered by
`apps/server/src/check/routes.test.ts`'s two-directions pair, which is a route
test rather than a validator test.

## E2E Verification Plan

### Verification Steps

1. `git diff SPEC.md` shows exactly the signed text
2. `corpus doc check --help` states the asymmetry
3. A hand-authored `.claude/agents/x.md` with `status: banana` exits 6 on check
   and saves through `PUT`, and the help predicted it

## E2E Verification Log

_[Filled after sign-off]_

## Completion Checklist (domain agent)

- [x] N/A — orchestrator-applied after sign-off

## Completion Checklist (orchestrator)

- [x] Committed with `[SHARED-052]` prefix
