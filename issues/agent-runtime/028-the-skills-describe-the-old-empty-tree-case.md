# [AGENT-028] Two product skills still say the empty tree is the repository's first commit

## Domain

agent-runtime

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-113 (which changed the behaviour)
- Related: CONTRACT-052, CLI-045 (the same sentence, fixed in the published
  contract and the CLI help)

## Spec References

- SPEC.md **§4** — commit windows are party-scoped; each document's diff is
  path-scoped

## Summary

`SERVER-113` changed the diff base to *the previous commit that touched this
document*, with git's empty tree when there is none. A consequence nobody
predicted at the time: **every document's first change now diffs against the
empty tree**, where previously that was an exotic case.

`CONTRACT-052` corrected the published contract, `CLI-045` corrected the CLI
help — and its sweep found the same too-narrow framing surviving in two skills
that `corpus init` installs into a user's workspace:

- `assets/workspace/claude/skills/orchestrate/SKILL.md:937` — "empty-tree sha
  carried by a document **the repository's first commit** introduced"
- `assets/workspace/claude/skills/comment/SKILL.md:358` — reads correctly under
  the new rule, but was flagged as worth a second look

**This is product text, not repository documentation.** It is what a user's
agent reads to decide what a diff means, and it currently tells that agent the
empty-tree base is a rarity it will almost never see, when it is now the
ordinary shape of a document's first change. An agent that treats it as
anomalous may report it as one.

The fourth surface of the same sentence, and worth noting as a pattern: this
rule has now been found stale in the spec (`SHARED-045`, unsigned), the
contract, the CLI, and the skills. One behavioural change, four places that
described it.

## Acceptance Criteria

- [x] `orchestrate/SKILL.md` states the rule correctly: the base is the previous
      commit that touched this document, and the empty tree is the ordinary case
      for a document's first change
- [x] `comment/SKILL.md:358` is read against the new rule and either corrected
      or confirmed correct in the report — do not leave it ambiguous
      (**confirmed correct**, unchanged; reasoning in the log below)
- [x] Wording matched to `packages/contract/src/schemas/edit.ts` rather than
      phrased a fifth time
- [x] Pinned in `scripts/workspace-template.test.ts`, as AGENT-025's and
      AGENT-027's text is — the defect is documentation drifting from behaviour,
      and it has now recurred four times

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md`
- `assets/workspace/claude/skills/comment/SKILL.md`
- `scripts/workspace-template.test.ts`

## Testing Strategy

Template assertions. No drill: no behaviour changes, and SERVER-113's plumbing
is already covered by its own regression tests.

## E2E Verification Log

**Model: Opus 5 (1M context).** Documentation-only; **no drill was staged, and
none was warranted** — nothing behavioural changes here, and SERVER-113's
plumbing (both range defaults walking the document's own history, the empty-tree
base) already has its own regression tests in the server and the CLI
(`apps/cli/src/commands/doc/diff.test.ts` pins "no longer confines the
empty-tree base to the repository's root commit"). Standing up a workspace and a
server would have exercised that code again, not this text.

**What changed.**

- `assets/workspace/claude/skills/orchestrate/SKILL.md`, *Reflecting on a user
  edit*, step 1: the pass-through clause now reads "the empty-tree sha an event
  carries for a document's **first** change, which diffs as wholly added" —
  the CLI's own sentence (`apps/cli/src/commands/doc/diff.ts:190`,
  `docs/cli.md:649`), which came from `EMPTY_TREE_OBJECT_ID`'s doc comment.
  A new paragraph after the stats paragraph carries the *why*: both ends of a
  range walk this document's history rather than the branch's, because a commit
  window belongs to a party rather than to a document, so the commit immediately
  before a document's first one is routinely somebody else's save to a different
  file — a commit at which this document did not exist. No new `##` heading, so
  the pinned `sections.size` (16) is untouched.
- `assets/workspace/claude/skills/comment/SKILL.md`: **no change** (verdict
  below).
- `scripts/workspace-template.test.ts`: two pins in the `doc.edited` describe.

**Verdict on `comment/SKILL.md:358` — correct under the new rule, left as is.**
The sentence is "`corpus doc diff <id>` prints the document's path and its last
committed change". Bare `doc diff` resolves `to` to the newest commit that
touched this document and `from` to the newest commit **before it that touched
this document** (`DocDiffQuerySchema`, `docs/cli.md:651`), so the printed range
is exactly that document's last committed change — the claim is not merely
survivable under SERVER-113, it is *more* precisely true after it than before,
when `from` was `to`'s parent and the range could be named after a commit
belonging to somebody else's save. The sentence makes no claim about the empty
tree at all, so the stale framing had nowhere to hide in it. The one first-change
case it does cover (a document whose only commit is its first) prints the whole
document as added, which is still "its last committed change".

**Sweep of the two files for other pre-2026-08-13 commit/range/base claims.**
Extent: every line in both skills matching
`commit|revision|rev\b|--from-rev|--to-rev|empty.tree|sha|git |range|diff|parent|history`
(41 hits in orchestrate, 27 in comment), each read in context. Only three
passages make a claim about a *diff base or range*, and two were already right:

| Passage | Claim | Verdict |
| --- | --- | --- |
| `orchestrate` step 1 (was :937) | empty tree = a document the repository's first commit introduced | **stale — fixed** |
| `orchestrate` *Doing the work* revert loop (:791) and `comment` (:358) | bare `doc diff` prints the document's last committed change | correct, and more exactly so post-SERVER-113 |
| `orchestrate` cut-diff paragraph (:1085) | "`corpus doc diff doc_a1b2c3` with no range reads its newest commit whole" | correct — "its" is the document's, which is what both defaults now resolve to |

Everything else that mentions commits turned out not to be a claim about ranges:
commit *authorship* and traceability (:52, :1341), one commit per write and the
fresh key (`orchestrate` :686, `comment` :308), `git log`/`git show` as reads and
the frontmatter trap (:816–:831), and the operator's repair (:1385–:1408), whose
"a commit here belongs to an editing session… `git revert <sha>` would take
neighbouring documents back with it" is the *same* party-scoped-window fact the
correction above leans on, stated correctly. Nothing else needed touching. The
`converse` skill was checked too: it names no diff, range or base.

**Pinned** in `scripts/workspace-template.test.ts` (`doc.edited` describe), both
directions, because this sentence has now been found stale in four surfaces:

- positive, on the orchestrate body: the contract's phrasing ("a document's
  **first** change"), "ordinary shape of a first change, not an anomaly to
  report", "**any** document's first commit", plus the three fragments carrying
  the *reason* — a window "belongs to a party rather than to a document",
  "somebody else's save to a different file", "this document did not exist". The
  reason is pinned because a correction without it drifts back.
- negative, `it.each(installedSkills)` — every core **and plugin** skill: any
  sentence mentioning the empty tree that also names the repository or a root
  commit must qualify it (`not only` / `not just` / `whether or not` / …). The
  corrected wording passes; the deleted sentence fails. Verified against both
  strings directly through the same split-and-match logic before relying on it,
  since a negative pin that cannot fail is not a pin.

**Checks run** (scoped, `VITEST_MAX_THREADS=4`; no port bound, no server, no
workspace scaffolded):

- `vitest run scripts/workspace-template.test.ts` → **304 passed** (301 before;
  the new positive pin plus one negative case per installed skill). This is the
  run that matters: the same file also re-checks the pinned section counts, the
  400-char section floor, the fence rules, and extracts every `corpus …`
  invocation in the template against `docs/cli.md` — the edit adds no invocation
  and moves no heading, and all of that stayed green.
- `prettier --check` on the three touched files → clean.
- `eslint scripts/workspace-template.test.ts` → clean.
- `tsc --noEmit -p scripts/tsconfig.json` → exit 0 (run through the local binary,
  output captured to a file and the exit code read, not the proxy's prose).

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-028]` prefix
