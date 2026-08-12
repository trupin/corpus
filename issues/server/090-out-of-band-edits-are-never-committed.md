# [SERVER-090] An external editor's change is committed under someone else's name, or not at all

## Domain

server

## Status

done

## Priority

P0 — promoted from P1 by SHARED-042: §7's amended loop-safety bullet states this
as a guarantee ("the watcher picks that up as the out-of-band `user` edit it is
(§9.1) and commits it for itself"), and with the rollback verb gone it is the
operator's only recovery path.

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: SHARED-040 (found it; explicitly **not** justified by it),
  SERVER-091–094 (the rider's implementation — this issue is independent of all
  four and may land before or after any of them), SERVER-007 (specified the
  commit that was never built), SERVER-005, SERVER-094 (boot recovery, the other
  thing that will pick these edits up if this is not fixed)

## Spec References

- SPEC.md **§4** — every mutation auto-commits with the acting party as git
  author; `git log` doubles as the audit trail of who changed what
- SPEC.md **§2** Architecture rule 1 — out-of-band edits are **legitimate**: the
  watcher detects them, reconciles anchors (§6), and re-projects
- SPEC.md **§5** — files on disk are the source of truth

## Summary

Found while verifying a claim in SHARED-040's draft, and deliberately filed apart
from it: this is a defect on its own terms and **must not be fixed as a side
effect of that rider**, or it will be recorded as a consequence of a design
change rather than as the bug it is.

Editing a workspace file in an external editor is a supported act (§2 rule 1).
The watcher reconciles its anchors and rewrites the file with `writeAtomically`
(`apps/server/src/watcher/reconcile-out-of-band.ts:138`) — **bypassing the commit
path entirely**. The watcher has no committer.

SERVER-007 step 5 specified the commit that should follow:
`reconcile: anchors on <docId> after external edit`. **No such subject exists
anywhere in `apps/`.** The log line at `reconcile-out-of-band.ts:142` records
`commit: "deferred"` above a comment saying "the `reconcile:` commit is
SERVER-005's; recorded here rather than faked" — and SERVER-005's write paths
commit their own mutations only. The comment points at a commit neither path
builds.

## What actually happens, and why it is worse than "uncommitted"

The commit path stages with `git add -A -- <paths>`. So an out-of-band edit
reaches git **incidentally**: the *next* server mutation to that document sweeps
the earlier content into its own commit, **under that mutation's actor and its
subject**.

Two consequences, and the first is the serious one:

1. **The audit trail is wrong, not merely coarse.** A change you made in an
   external editor is attributed to whoever touched the document next — often the
   agent. §4 makes `git log` the record of *who changed what*, and this makes it
   say something false. A reader has no way to tell.
2. **Absent a later mutation it stays uncommitted indefinitely**, so
   `corpus doc diff` and `corpus skill rollback` read a history that does not
   contain the change, and §9's "git is the only recovery" does not cover it.

## Acceptance Criteria

- [x] Reproduce first, per the SDLC: edit a workspace file in an external editor,
      show that no commit follows; then make a server mutation and show the
      earlier content inside that commit under the wrong author
- [x] An out-of-band edit is committed **for itself**, authored `user` — the
      watcher cannot know it was anyone else, and a person editing their own files
      is the only actor §2 rule 1 describes
- [x] The commit says what it is, so a reader can tell it from a mutation the
      server performed. SERVER-007's `reconcile: anchors on <docId> after external
      edit` is the specified subject; use it or say why not — **not used; see
      "Why not SERVER-007's subject" below and the header of
      `watcher/commit-out-of-band.ts`**
- [x] A change no longer reaches git under a later mutation's authorship. Check
      what `git add -A -- <paths>` sweeps on every write path, not only this one —
      **audited; see "The `git add -A` sweep, audited" below**
- [x] Anchor reconciliation's own rewrite and the user's edit land together —
      they are one change to the file, not two
- [x] The comment at `reconcile-out-of-band.ts:141-142` is corrected. It asserts a
      commit that does not exist, and it is why this went unnoticed

## Why not SERVER-007's subject

SERVER-007 specified `reconcile: anchors on <docId> after external edit`. Three
things now rule against it, two of them spec text signed after that sprint:

1. **§4's commit-window rider (signed 2026-08-10)** has a paragraph about exactly
   this change: "An out-of-band edit belongs to the person at the machine … it
   closes the agent's window if one is open, then joins — or opens — the user's,
   **exactly like editing in the board**. Nothing about it is an act and **nothing
   announces it**, so the idle window is what commits it." A subject naming a
   distinct kind of event is the announcement §4 rules out.
2. **§7's amendment (signed 2026-08-12)** asks that the operator's recovery
   "leaves **the same visible trace** every other change does" — the same, not a
   distinguishable one.
3. It would be **false** for the great majority of out-of-band edits, which have
   no anchors to reconcile at all.

What the interim commit carries instead is the board's own grammar —
`doc edit: <title> (<id>) by user`, `doc|thread delete: …` for a removal — and,
because no act named the window, its **close relabels it**
`editing session: N documents by user`, which is precisely what a board editing
session produces. What tells this apart from a mutation the server performed is
the thing §4 nominates for the job and this issue's second criterion names: the
**author**.

## The `git add -A` sweep, audited

Every `MutationPlan.stage` in the server was read (`capture.ts`, `docs/create`,
`update`, `move`, `archive`, `delete`, `bulk`, `threads/create`, `turns`,
`status`, `cascade`, `reattach`, `skills/create`), plus `git/recovery.ts`'s own
`add -A`:

- **All but one stage individual file paths.** `git add -A -- <file>` stages that
  file's working-tree content and nothing else, and the commit is `--only` over
  the same paths, so no mutation can reach a neighbouring document. What it *did*
  sweep was the document's own out-of-band content — this issue — and that is now
  committed under `user` before the mutation runs.
- **The one exception is a skill folder move** (`docs/archive.ts:524`, and the
  same plan reached through `docs/bulk.ts`): archiving or unarchiving a skill
  stages the two **directories** `.claude/skills/<name>` and
  `.claude/skills-archived/<name>`. That is required by the operation — a folder
  rename has to commit both sides — and it sweeps the folder's non-document
  neighbours (`reference.md`, scripts). Those files are not documents, so the
  watcher never commits them for themselves and only boot recovery otherwise
  covers them. Left as is: narrowing the pathspec would leave the rename's other
  half in the index for the next commit to swallow, which is the worse failure.
- `git/recovery.ts`'s `add -A` is scoped to the document roots and claims no
  party by design (§4's single deliberate exception); nothing changed there.

## Technical Design

### Files to Create/Modify

- `apps/server/src/watcher/reconcile-out-of-band.ts`, and whatever committer it
  needs to reach.

### Notes

- **Interaction with SHARED-040**, which is signed and being implemented in
  parallel: under commit windows an out-of-band edit joins or opens the `user`
  party's window rather than committing alone. Whichever lands second must not
  re-introduce the other's defect — fix the attribution here regardless of window
  shape, because "it will be right once windows exist" is how a wrong author
  survives a refactor.
- Check whether `git add -A -- <paths>` is the right staging for any path, not
  just this one: it is the mechanism that lets one act carry another's bytes.

## Testing Strategy

Write a file directly on disk, wait for the watcher, assert a commit exists with
the `user` author and the reconcile subject. Then a server mutation, and assert
its commit contains only its own change. Plus the no-later-mutation case: the
edit is in git without any subsequent activity.

## E2E Verification Log

**Model: opus** (`claude-opus-5[1m]`), 2026-08-12. Real workspaces under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`, real `corpus` server from
`apps/cli/dist/bin/corpus.js` on port 8791/8792 (never 8765/5173).

### Pre-fix reproduction (mandatory)

`corpus init` + `corpus server start`, then `corpus doc create --title "Repro Note"`
→ `8857210 user doc create: Repro Note (doc_qx6ygl3w) by user`.

**1. An external editor's change produces no commit.**

```
$ printf '\nA sentence typed in an external editor at 15:46:50.\n' >> data/docs/inbox/repro-note.md
$ git log --format='%h %an %s' -3
8857210 user doc create: Repro Note (doc_qx6ygl3w) by user
6521d7f user workspace: initialize corpus workspace by user
$ git status --porcelain
 M data/docs/inbox/repro-note.md
```

No commit followed, and the file stayed dirty for the rest of the session.

**2. The next mutation carries it under the wrong author.**

```
$ corpus doc edit doc_qx6ygl3w --add-tag reviewed-by-agent --from agent
$ git show --name-only --format='%h  author=%an  %s' HEAD
f86e12e  author=agent  doc edit: Repro Note (doc_qx6ygl3w) by agent
data/docs/inbox/repro-note.md
$ git show HEAD -- data/docs/inbox/repro-note.md | tail -3
 ## Open questions
+
+A sentence typed in an external editor at 15:46:50.
```

The person's sentence is inside the **agent's** commit, with the agent's subject.
`git status` is now clean, so nothing survives to say otherwise.

### Post-fix

**1. Committed for itself, `user`, with no later mutation.**

```
$ printf '\nA SECOND sentence typed in an external editor at 15:53:35.\n' >> data/docs/inbox/repro-note.md
$ git log --format='%h  author=%an  %s' -3
b2e4c61  author=user  doc edit: Repro Note (doc_qx6ygl3w) by user
c791887  author=agent  editing session: 1 document by agent
6232613  author=user  editing session: 1 document by user
$ git status --porcelain      # clean
```

The agent's open window was closed and relabelled first, exactly as §4 requires.

**2. Repeated external saves fold into one commit** — a third sentence amended
`b2e4c61` into `c26de6b` rather than adding a commit ("a commit per editing
session, as the board does, and not one per save").

**3. A later mutation carries only its own change.**

```
$ corpus doc edit doc_qx6ygl3w --add-tag second-agent-tag --from agent
$ git log --format='%h  author=%an  %s' -4
eb93773  author=agent  doc edit: Repro Note (doc_qx6ygl3w) by agent
69a2a3d  author=user  editing session: 1 document by user
...
$ git show HEAD -- data/docs/inbox/repro-note.md
+  - second-agent-tag        # and nothing of the person's prose
```

**4. Reconciliation's rewrite and the person's edit land together; the key moves
once.** A note with a thread anchored to "Beta paragraph here.", edited out of
band to extend that sentence:

```
key before: a95d4b63…   HEAD before: 54a800c
$ git log --format='%h  author=%an  %s' -2
1b378c5  author=user  doc edit: Anchored (doc_hfq6n762) by user
18f22e0  author=user  editing session: 2 documents by user
$ git log -1 --format='%b'
Corpus-Doc: doc_hfq6n762
Corpus-Actor: user
Corpus-Anchors: remapped=1 orphaned=0
$ git show HEAD:data/docs/inbox/anchored.md | sed -n '/^anchors:/,/^due:/p'
anchors:
  anc_cde8b956:
    exact: Beta paragraph here, now with an out-of-band clause appended by a person.
$ git status --porcelain      # clean
key after:  b0b3f67d…   (and identical on a second read 3 s later)
```

One commit, holding the **remapped** selector and the person's sentence together.
The key moved exactly once — the reconciliation's own rewrite — and committing
moved it no further, because a commit writes no file.

**5. An out-of-band deletion and an out-of-band rename.**

```
$ rm data/docs/inbox/anchored.md
c03bc67  author=user  doc delete: Anchored (doc_hfq6n762) by user
D  data/docs/inbox/anchored.md              # tree clean afterwards

$ mv data/docs/inbox/repro-note.md data/docs/renamed-note.md
4dc1ad4  author=user  doc edit: Repro Note (doc_qx6ygl3w) by user
R100  data/docs/inbox/repro-note.md  data/docs/renamed-note.md
```

**6. §7's loop-safety recovery, end to end** (fresh workspace, port 8792). The
operator breaks `.claude/skills/orchestrate/SKILL.md` in an editor — committed as
`7b11407 user doc edit: Orchestrate (doc_skillorchestrate) by user` — and then
reverts it with git directly, no agent running:

```
$ git checkout HEAD~1 -- .claude/skills/orchestrate/SKILL.md
$ git log --format='%h  author=%an  %s' -3
7190e81  author=user  doc edit: Orchestrate (doc_skillorchestrate) by user
29c102f  author=user  editing session: 1 document by user
9af1e14  author=user  workspace: initialize corpus workspace by user
$ git status --porcelain     # clean
```

The recovery is in git, authored `user`, as its own commit — §7's "leaves the
same visible trace every other change does", satisfied without a server verb.

### Checks run

- `npm run build` — clean
- `npx tsc --noEmit -p apps/server/tsconfig.json` — clean
- `VITEST_MAX_THREADS=4 vitest run apps/server` — **178 files, 3722 tests, all
  passing** (13 of them new, in `watcher/commit-out-of-band.test.ts`)
- `eslint apps/server/src --max-warnings=0` — clean; `prettier --check` — clean

### Note

A real defect was found while writing the tests and is fixed: chokidar delivers a
rename's halves in either order, and when `add` arrives first the watcher's
`retireStaleHolder` drops the old path's row before the `unlink` is processed —
so the old name's **removal was never staged** and the rename came out as a
creation with a deletion left dirty. `retireStaleHolder` now returns the path it
retired and that path joins the same commit. The E2E above happened to hit the
favourable ordering; the test does not.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
