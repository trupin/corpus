# [SERVER-097] A `doc.edited` range starts at a commit that touched a different document

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
- Blocks: —
- Related: SERVER-052 (built the range), CONTRACT-028 (its payload), SERVER-093
  (path-scoping under multi-document commits), SERVER-095

## Spec References

- SPEC.md **§4** "Edit acknowledgment" — the event carries "the document id and
  the session's commit range with change stats"
- SPEC.md **§9.2** — `GET /api/docs/:id/diff`, "the unified diff of one document
  across a commit range, **path-scoped**"

## Summary

Found in the user's live workspace while diagnosing SERVER-095, and filed apart
from it because it is a separate defect with a separate fix.

A pending `doc.edited` in `/Users/theophanerupin/cos/.corpus/queue/pending/`:

```json
{ "docId": "doc_6malm2hs",
  "from": "62b3c95…",   // "doc edit: Comment (doc_skillcomment) by agent"
  "to":   "b8e5520…" }  // "doc edit: Estate (doc_6malm2hs) by user"
```

The range's `from` is a commit by the **agent** to a **different document**. The
event is about `doc_6malm2hs`; `62b3c95` never touched it.

## Why it is not harmless, and why it is only P1

The diff read is path-scoped (§9.2, verified by SERVER-093), so
`corpus doc diff doc_6malm2hs --from-rev 62b3c95 --to-rev b8e5520` still shows
**only** that document's change. The bytes the agent gets are right.

What is wrong is the *range*, and it costs two things:

1. **`stats` are computed over the range.** `commits` counts commits in it, so a
   range whose base is an unrelated commit reports a commit count that includes
   work on other documents. The agent is told "3 commits" for what was one save.
2. **The range is a claim.** §4 says "the session's commit range", and a reader —
   human or agent — reasonably takes `from` to be the state this document was in
   before the session. It was not.

P1 rather than P0: nothing is corrupted and no wrong bytes are served. But the
number the agent reads to decide "is this change worth fetching" is inflated by
other documents' activity, which is a bad input to a decision that costs tokens.

## The likely cause, to be confirmed rather than assumed

`from` appears to be resolved as "the commit before the session's first commit"
in branch order, rather than "the previous commit **that touched this
document**". Under party-scoped commit windows (SHARED-040) that gets worse, not
better: a window commit legitimately holds several documents, so branch order and
per-document order diverge routinely rather than occasionally.

Confirm this against `apps/server/src/edit/sessions.ts` and `edit/diff.ts` before
building anything. The fix is probably `git log -1 --skip=1 -- <path>` shaped —
the previous commit touching this document — but the interesting question is what
`from` should be when the document has **no** earlier commit, and whether the
answer differs from today's null-range case.

## Acceptance Criteria

- [x] Reproduce first: two documents saved in one window, then an acknowledgment
      whose `from` names a commit that did not touch its document
- [x] `from` names a commit that **touched this document**, or is null when there
      is none
- [x] `stats.commits` counts commits touching this document, not commits in the
      branch range. Check `insertions`/`deletions` too — if they were already
      path-scoped, say so; the inconsistency is worth recording either way
      — **all three were already path-scoped; the issue's diagnosis is wrong on
      this point. See "Where the diagnosis was wrong" below.**
- [x] The null-range case (a document with no earlier commit) is unchanged, or
      the change is deliberate and stated — **deliberately widened, stated below**
- [x] A range across a **multi-document window commit** is correct in both
      directions — this is the case SHARED-040 made routine

## Technical Design

### Files to Create/Modify

- `apps/server/src/edit/sessions.ts`, `apps/server/src/edit/diff.ts`

### Notes

- SERVER-093 established that path-scoping is newly load-bearing under
  party-scoped windows and verified the **diff** is scoped. This issue is the
  other half: the **range and its stats**. Read that issue's ruling first.
- Do not widen this into changing what the diff serves. The diff is correct.

## Testing Strategy

Unit: a session on document A with a commit to document B interleaved, asserting
`from`, and `stats.commits`. Plus the multi-document window commit case.

## E2E Verification Plan

Real server on a free port (**never 8765 or 5173**), scratch workspace under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`. Never write to
`/Users/theophanerupin/cos` — that is the user's real workspace.

## E2E Verification Log

**Model: Opus 5 (1M context), as server-dev.** Real server from source on
**port 8791** (never 8765/5173), scratch workspace
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/ws102`, real `corpus` CLI from
`apps/cli/dist`, real git.

### Pre-fix reproduction (mandatory)

Sequence, each step a separate commit because §4's window belongs to a party and
the party alternates:

1. `corpus doc create --title Estate` (user) → the create commit
2. `corpus --from agent doc create --title Comment` (agent) → closes the user's
   window, opens its own
3. `corpus doc edit doc_lqelqfu4 --key … < body` (user) → a new commit
4. `POST /api/docs/doc_lqelqfu4/edit-session/flush`

`git log --format='%h %an %s' -4` at step 3:

```
2cc4772 user  doc edit: Estate (doc_lqelqfu4) by user
fc90be6 agent editing session: 1 document by agent
7a6fb65 user  editing session: 1 document by user      <- the create
46ffaef user  workspace: initialize corpus workspace by user
```

The queue file `.corpus/queue/pending/*.json`:

```json
{ "docId": "doc_lqelqfu4", "sessionId": "es_788832db46f3b6d8", "actor": "user",
  "endedBy": "close",
  "from": "fc90be62b9910b9902adc54c6bf501b09c97959b",
  "to":   "2cc47724a88a4a8a34b0ec8d8f0068f891ff844f",
  "stats": { "commits": 1, "insertions": 2, "deletions": 7 } }
```

`git show --name-only fc90be6` → `data/docs/notes/comment.md` **only**. The
range's base is an agent commit to a different document — the user's live
workspace shape, reproduced exactly.

### Where the diagnosis was wrong

The issue's cost #1 — "`stats` are computed over the range … a commit count that
includes work on other documents" — **is not true, and was not true before this
fix.** `readRangeStats` has ended in `-- <path>` since SERVER-093, for both the
`--shortstat` and the `rev-list --count`. Measured in the reproduction workspace
over a range that genuinely spans an unrelated agent commit:

```
git rev-list --count 95d8d49..2cc4772                             -> 2
git rev-list --count 95d8d49..2cc4772 -- data/docs/notes/estate.md -> 1
git diff --shortstat 95d8d49 2cc4772                              -> 2 files changed, 22 insertions(+), 7 deletions(-)
git diff --shortstat 95d8d49 2cc4772 -- data/docs/notes/estate.md -> 1 file changed, 2 insertions(+), 7 deletions(-)
```

All three numbers — `commits`, `insertions`, `deletions` — were already
path-scoped and already correct. There is also a structural reason no inflation
was possible: `from` was `parentOf(firstSha)`, the *immediate* branch
predecessor, so no commit could sit between it and the session's first one, and
`from..to` therefore contained exactly the session's own commits.

**The defect is cost #2 alone: `from` is a false claim.** §4 calls it "the
session's commit range" and a reader takes it for the state this document was in
before the session; it named a commit that never touched the document. The
agent's numbers were never wrong — its *provenance* was.

### The fix

`edit/diff.ts` gains `previousCommitFor(git, sha, path)` — `parentOf`, then
`git rev-list --max-count=1 <parent> -- <path>` — and `edit/sessions.ts`'s
`emit()` uses it in place of `parentOf`. The walk starts at the parent rather
than at `sha` with `--skip=1` so it stays correct for a `sha` that does not
itself touch the path.

**Null-range case, deliberately widened.** `null` (→ `EMPTY_TREE_OBJECT_ID`) used
to mean "the session's first commit is the repository's root". It now also means
"nothing before this session touched this document" — which is the honest answer
for a document created and edited inside one window, where the old code named
some unrelated earlier commit. `EMPTY_TREE_OBJECT_ID` was already a value this
payload published and `GET /api/docs/{id}/diff` already accepts it back, so no
consumer sees a new shape. The diff bytes are identical either way: a file absent
at the old base and a file absent from the empty tree produce the same
whole-file-added diff.

**Nothing else moves.** Every commit the new base skips over left this file
byte-identical, so `git diff from..to -- path` and `rev-list --count from..to --
path` report the same numbers before and after. Verified in the post-fix run
below: `stats` unchanged at `{commits: 1, insertions: 2, deletions: 7}`.

### Post-fix E2E

Server restarted (it runs from source via tsx), same sequence on fresh documents:

```
f6925b5 user  doc edit: Estate2 (doc_qy2xgecq) by user
4e1cd61 agent editing session: 1 document by agent      <- the old, wrong `from`
7a6fb65 user  editing session: 1 document by user       <- the new, right `from`
```

```json
{ "docId": "doc_qy2xgecq", "actor": "user", "endedBy": "close",
  "from": "7a6fb652eadb68b90cdfaeb3e6a001d0f77d100c",
  "to":   "f6925b5f00834a09f161d4c432e6efd9502bb535",
  "stats": { "commits": 1, "insertions": 2, "deletions": 7 } }
```

`git show --name-only 7a6fb65` → `data/docs/notes/estate2.md`. The range is
passable straight back:

```
$ corpus doc diff doc_qy2xgecq --from-rev 7a6fb65… --to-rev f6925b5…
doc_qy2xgecq · data/docs/notes/estate2.md
1 commit · +2 -7 · 507 characters
```

### Tests, and that they fail without the fix

- `apps/server/src/edit/acknowledgment.test.ts` — "names the previous commit that
  touched this document, not the branch's previous commit". Real git, the
  reproduction sequence. **Verified red before the fix**, at
  `expect(payload?.from).not.toBe(interloper)`.
- `apps/server/src/edit/sessions.test.ts` — "skips past commits that never
  touched this document to find `from`" (two interloping commits, so a `--skip=1`
  implementation would also fail) and "uses git's empty tree when nothing before
  the session touched this document". **Both verified red** by reverting
  `emit()` to `parentOf` (2 failed, `from: "a9e0071"` reported).
  `FakeRepo` gained a `touches` map; a sha absent from it touches every path, so
  every pre-existing case still asserts exactly what it asserted.
- Whole `apps/server` suite: 3855 passed, 1 failed — `threads/resident.test.ts`,
  SERVER-109's in-flight work, untouched by this change.

### Found and NOT fixed — same defect, other route

`GET /api/docs/{id}/diff` computes its **default** `from` the same wrong way
(`edit/diff.ts` `readDocDiff`: `parentOf(to)`). Measured on the running server in
the same workspace:

```
$ corpus doc diff doc_qy2xgecq --json
from 4e1cd6105f94e2997b39ab487137bd369c8dcccc
$ git show --name-only 4e1cd61
data/docs/notes/comment2.md          <- a different document
```

Left alone because this issue says in as many words *"Do not widen this into
changing what the diff serves. The diff is correct."* — and the response's `from`
field is served by that route. It is a one-line change (`previousCommitFor` is
already exported and the bytes and stats provably do not move), and it wants its
own issue so that the acknowledgment and the read route stop disagreeing about
the same document's base.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
