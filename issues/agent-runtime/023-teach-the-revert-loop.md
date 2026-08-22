# [AGENT-023] The skills teach how to revert, now that the verb is gone

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-042 (the decision and the §7 text), AGENT-022 (the key loop
  this extends)
- Related: CLI-040 and CONTRACT-050 (removing the verb and its route),
  SERVER-104 (removing `apps/server/src/skills/rollback.ts`), **SERVER-090** (the
  out-of-band `user` commit the operator path depends on)

## Spec References

- SPEC.md **§7** "Loop safety (validate + reverting)" — amended 2026-08-12
- SPEC.md **§4** (window commits, out-of-band edits belong to the person at the
  machine), **§9.1** (the watcher)

## Summary

`corpus skill rollback` is deleted rather than fixed: it overwrote a whole file
with an old revision and destroyed uncommitted edits unrecoverably, at exit 0.
The user's decision was not to fix the verb but to remove it — **a revert is a
write whose content came from history**, and through the ordinary write path it
reconciles anchors (§6), validates (§11), commits under the acting party (§4) and
is protected by §7's key. A dedicated verb reimplements all four and gets them
wrong.

So the skill gains the teaching the verb stood in for. Same shape as AGENT-022,
and for the same reason: the old text named a command to remember rather than a
path to walk.

## Acceptance Criteria

- [x] No `corpus skill rollback` anywhere in `assets/workspace/` — including the
      text AGENT-022 left behind — or in `plugins/*/skills/`
- [x] Both skills teach the revert as a **loop**: read the history
      (`corpus doc diff <id>`, or git directly) → work out the content you want
      back → write it with `corpus doc edit <id> --key <k>` like any other change
- [x] The skills say **why there is no verb**, briefly, so an agent neither hunts
      for a rollback command nor invents one — and so the rule generalises to any
      document, not just a skill
- [x] The skills say that **the key is what makes it safe**: the content came from
      history, but the write presents the key of the version just read, so a
      revert that would clobber a newer change is refused rather than landing
- [x] The orchestrate skill's operator-facing recovery section says plainly that
      the **broken-loop case is the operator's, not the agent's**: no agent is
      running, so the operator reverts in the workspace with git and the watcher
      commits it as the out-of-band `user` edit it is
- [x] The workspace README (operator-facing) says the same
- [x] `scripts/workspace-template.test.ts` fails on a skill that names a deleted
      verb, independently of `docs/cli.md`'s regeneration timing

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the revert loop inside
  `## Writing a document`; `## If the loop breaks (operator recovery)` rewritten
  to git; the skills-are-documents bullet split into the agent's case and the
  core-loop case
- `assets/workspace/claude/skills/comment/SKILL.md` — the same loop, shorter, in
  `## Doing the work`; the two `skill rollback` mentions (skill genesis, the
  "thread is about a skill document" edge case) rewritten to point at it
- `assets/workspace/README.md` — the operator's recovery block
- `scripts/workspace-template.test.ts` — a `REMOVED_VERBS` guard, and the
  positive pins for the new teaching

### Notes

- No new `## ` heading in either skill: the pinned `sections.size` stays **16**
  (orchestrate) and **13** (comment). Putting the revert inside *Writing a
  document* is itself part of the teaching — a revert is a write.
- Existing workspaces get this through `corpus workspace upgrade` (§2.4), which
  will not overwrite a skill the user edited. An unmerged workspace runs an agent
  that still names `corpus skill rollback` against a CLI that no longer has it:
  the failure is a usage error at exit 2, not a bad write.

## Testing Strategy

Sweep plus a read-through against the CLI's actual surface: every command and
flag the skills name must exist, and the deleted verb must appear nowhere.
`npx vitest run scripts`.

## E2E Verification Plan

`corpus init` a scratch workspace under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`, and walk the revert loop the
skill describes, command by command, against a real server on a free port
(**never 8765 or 5173**). Then walk the operator path with git and watch what the
server does with it.

## E2E Verification Log

**Model: opus (claude-opus-5, 1M context).** 2026-08-12.
Scratch workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s023-agent/ws`,
server on **port 8931** (8765 and 5173 untouched).

### How the revert is framed

Inside `## Writing a document`, immediately after the stale-key paragraph, so it
reads as what it is — a continuation of the key discipline rather than a new
subject. The opening clause is the whole argument: *there is no revert command and
there is none to look for: **a revert is a write whose content came from
history***. Then three numbered steps, of which only the last one writes:

1. **Read the history.** `corpus doc diff <id>` prints the document's path and its
   last committed change — for a small change the diff already carries the old
   text. `git log --oneline -- <path>` and `git show <sha>:<path>` go further back.
2. **Work out the content you want back** — *rarely the whole old file*, because
   the version you are going back to predates everything since, some of which
   should stay.
3. **Write it** with the key from a fresh read, through `corpus doc edit`.

Three qualifiers carry the risk, and each was verified below rather than asserted:

- **Read from git, never write to it.** `git log`/`git show`/`git diff` are reads
  and the agent is good at them; `git checkout`, `git restore`, `git revert`,
  `git add`, `git commit` are writes behind the server's back, and the server is
  the sole writer. The contrast with the operator's section (which *is* git) is
  deliberate and stated in both places.
- **Git hands you the whole file; the write takes the body.** Everything down to
  the closing `---` is frontmatter the server owns.
- **The key is what makes a revert safe**, and it is the whole difference from the
  deleted verb: the content is old, but the key names the version *just read*, so
  a revert that would clobber a change made since that read is refused at exit 9
  with the current text in hand. "The age of the content is never the question;
  what happened after your read is."

The comment skill carries the same loop, compressed to a paragraph plus those
three bullets, in `## Doing the work` after its own stale-key paragraph. Its two
`skill rollback` mentions became pointers to it: skill genesis now offers the
ordinary ways back (`corpus doc archive` to disable, a revert to undo a wording),
and the "thread is about a skill document" edge case tells the person the previous
wording is *one read of the history and one write away*.

Section counts unchanged — no heading was added. Cross-checked with a real
CommonMark parser (`mdast-util-from-markdown`): **16 / 13** top-level `depth: 2`
headings, equal to the pinned `sections.size`, and **0** code nodes whose closing
line is anything but a bare backtick run.

### What the operator path says

`## If the loop breaks (operator recovery)` is still marked *for the operator, not
the agent*, and now reads:

```bash
corpus queue halt
git log --oneline -- .claude/skills/orchestrate/SKILL.md
git restore --source=<sha> -- .claude/skills/orchestrate/SKILL.md
corpus queue resume
```

with the reason stated where an agent will read it: **this is the one repair that
does not go through the agent** — the agent reverts a document by reading history
and writing it back, but when the broken document *is* the loop there is no agent
running to do it. Three further points, each load-bearing:

- **Restore the file, not the commit.** A commit here belongs to an editing
  session rather than to a save (§4), so it gathers everything that party changed
  while its window was open; `git revert <sha>` would take neighbouring documents
  back with it. `git restore --source=<sha> -- <path>` is path-scoped and stages
  nothing.
- **Halt first, resume last**, and the restored skill takes effect at the next
  `/orchestrate` — a fresh read of the file, not a server restart.
- **Leave the server up.** It watches the workspace, re-projects the restored
  skill within moments, and commits the change as the out-of-band `user` edit it
  is — which is what keeps `git log` a complete account even for the one change
  the agent did not make.

The workspace README says the same in operator language, including the sentence
that keeps someone from hunting for the old verb: *there is no rollback command,
and here that is the point*.

### The revert loop, run verbatim against a real server

`doc_y24fme4q` (`data/docs/finance/rate-policy.md`), created and then rewritten
badly (`Assume 6.1% …` + a `## Notes` section → `Assume 9.9%.`). Two commits,
`d197c1d` then `21f0308`.

1. **Read the history.** `corpus doc diff doc_y24fme4q` printed the path, the
   resolved range and the unified diff — enough on its own to reconstruct the old
   body. `git log --oneline -- data/docs/finance/rate-policy.md` listed both
   revisions; `git show d197c1d:data/docs/finance/rate-policy.md` printed the file
   as of the good one.
2. **Work out the content**, then **write it**: `corpus doc show` →
   `key 3d84d55a…` → `corpus doc edit doc_y24fme4q --key 3d84d55a… --from agent`
   with the recovered body in a heredoc → `edited doc_y24fme4q` /
   `key 680874c1…`. `--json .body` came back byte-identical to the recovered text
   and `.frontmatter` still carried the original `id`/`type`/`title` with a fresh
   `updated` — the server's fields, untouched by the revert.

**The frontmatter trap is real, and silent.** Piping `git show <sha>:<path>`
straight into `corpus doc edit` as the body exits **0** and writes the file's
whole YAML block into the document a second time, as text — a document that now
begins with two `---` blocks. That is why the skills spend a bullet on it.

**The key refusal was exercised on a revert, not just described.** Holding a key,
letting a `--from user` write land, then replaying the old key with the recovered
body: exit **9**, nothing written, the refusal carrying the current text and a
fresh key. That is the claim "a revert that would clobber somebody's newer change
is refused rather than landing", measured.

**Anchors survive it.** A thread anchored on `Revisit when the lender publishes
Q3.` orphaned when the bad edit dropped that passage (`1 orphaned (th_wxskmhkm)`,
`warning: orphaned_anchor`); after the revert restored the passage,
`corpus doc show` resolved the anchor again at `chars 81–118` with its quote
intact. The revert went through the write path's reconciliation like any other
save.

### The operator path, run for real

On the same workspace, the orchestrate skill document was broken deliberately
(`corpus doc edit doc_skillorchestrate` replacing its body with one line — 1110
lines deleted), and committed as `951d3ee`. Then, exactly as the README now says:

- `corpus queue halt` → `queue halted — pending 0, …`
- `git log --oneline -- .claude/skills/orchestrate/SKILL.md` → the bad commit and
  the install commit
- `git restore --source=db69b18 -- .claude/skills/orchestrate/SKILL.md` → 1122
  lines back on disk, `git status` showing exactly one modified path, **nothing
  staged**
- the watcher picked it up with no prompting: `corpus doc show
  doc_skillorchestrate --json` returned the restored body (75 372 characters) and
  a new key, so the board sees the good skill again
- `corpus queue resume` → `queue resumed`

**One honest gap, and it is SERVER-090's.** On this build the restored file was
*not* committed for itself: after 30 s (`SQUASH_IDLE_MS`) and after a later
unrelated mutation, `git status` still showed
`M .claude/skills/orchestrate/SKILL.md`. That is exactly the state SHARED-042
promotes SERVER-090 to fix, and the §7 sentence the skills now carry ("the watcher
picks that up as the out-of-band `user` edit it is and commits it for itself") is
the guarantee that issue lands. The recovery is *effective* without it — Claude
Code re-reads the file from disk and the projection is already current — but the
audit trail is the half SERVER-090 owns. **If SERVER-090 does not land in this
phase, the skills and README promise a commit the workspace will not make.**

### The sweep and the tests

`grep -rn "rollback" assets/workspace/ plugins/*/skills/` → one hit, the README's
explanatory *"There is no rollback command"*. No invocation anywhere.

`scripts/workspace-template.test.ts` gained a guard that does not depend on
`docs/cli.md` being regenerated first — `REMOVED_VERBS = ["skill rollback"]`,
checked with the same extractor the reference test uses, over every markdown file
in the template tree, plus a meta-test proving the guard fires on text that names
the verb. The old assertion that both formerly-allowlisted verbs resolve against
`docs/cli.md` now asserts only `doc check`; `CLI_COMMANDS_PENDING_CLI_006` stays
empty. Five new positive pins cover the loop, the read-git-never-write rule, the
frontmatter trap, what makes a revert safe, and the operator path in both the
skill and the README.

`npx vitest run scripts` (`VITEST_MAX_THREADS=4`): **14 files, 578 tests, all
passing**. Prettier clean on the four touched files. A fresh `corpus init` into
`.../s023-agent/ws2` installed the rewritten skills verbatim — the recovery
section reads correctly as installed.

Server on 8931 stopped at the end; port confirmed free. 8765 and 5173 never bound.

## Completion Checklist

- [x] Acceptance criteria met
- [x] Scoped tests pass (`scripts`)
- [x] Lint/format clean on touched files
- [x] E2E log filled with concrete evidence
- [ ] Committed with `[AGENT-023]` prefix (orchestrator)
