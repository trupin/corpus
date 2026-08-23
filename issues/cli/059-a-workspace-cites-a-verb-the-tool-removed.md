# [CLI-059] A workspace's skills can cite a verb the tool removed, and nothing says so

## Domain
cli

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Related: CLI-040 (which removed `skill rollback`), CLI-027 (`corpus workspace diff`), CLI-025 (upgrade's template sync), SERVER-066 (`doc check`'s existing job)

## Spec References
- SPEC.md **§2.4** — upgrade and the workspace template sync
- SPEC.md **§11** — validation on the write path

## Summary

Raised by a live report, 2026-08-21: *"The workspace already cites `skill
rollback` in three places, so either the CLI is missing a verb its own ecosystem
assumes, or the citations were always wrong."*

**Neither.** `corpus skill rollback` existed and was **deliberately removed** by
CLI-040 on 2026-08-12, under SHARED-042 (*"A revert is a write like any other"*).
PR #43's review found it destroyed uncommitted edits unrecoverably; the answer
was that a revert is a write whose content came from history, so the verb went
and the skills teach the loop instead.

The tool repository is already guarded: `scripts/workspace-template.test.ts`
carries a `REMOVED_VERBS` allowlist naming `skill rollback`, and
`assets/workspace/README.md` says outright *"There is no rollback command, and
here that is the point."* So a workspace created **today** is correct.

**A workspace created before 2026-08-12 is not**, and keeps its old skills until
`corpus upgrade` runs the template sync. The reporter's workspace is in exactly
that state, and the symptom is the worst kind: the agent's own instructions tell
it to run a command that does not exist.

## The gap

`corpus workspace diff` (CLI-027) and upgrade's template sync both exist, so the
repair path is there. What is missing is that **nothing tells you to walk it**.
The stale citation is discovered by an agent trying the verb and failing, which
is a bad moment to find out and costs a turn every time.

## What to build

The narrow, cheap version: a workspace skill that cites a CLI verb the installed
tool does not have is a **finding**, reported where findings already go. The
`REMOVED_VERBS` list the tool repo already maintains is half the data; the
command registry is the other half and is authoritative.

## Decisions to make and record

1. **Where the check lives.** `corpus doc check` already validates skills on
   every save (§11) and knows how to report a finding — that is the cheap seam.
   A check at `corpus upgrade` time reaches a whole workspace at once. They are
   not exclusive, and doing both may be right.
2. **Warning or failure?** A skill citing a removed verb still saves and still
   runs — it just fails later. §11's warning channel is the honest home, and
   SERVER-067 is the open question about that channel. Do not make this a hard
   failure without saying why.
3. **False positives.** A skill may quote a verb inside prose explaining that it
   was removed — `assets/workspace/README.md` does exactly that. A checker that
   flags the sentence explaining the removal is worse than no checker.

## Decisions, as made

**1. Where the check lives: the upgrade report, not `corpus doc check`.**

`doc check` was the issue's suggested seam and it is closed. That verb renders
the server's `CheckReport`, whose `code` is a **closed enum** in
`packages/contract` (`CHECK_CODES`), deliberately closed so the CLI's exit-6
decision and the UI's rendering can both narrow on it. A CLI-only rule would
need a new contract code — a cross-domain change, contract-dev's to make — and
would put a client-derived finding into a report whose own help promises
`--json` emits _"the server's report … unchanged"_. It is also a rule the server
can never own: **the command registry lives in the CLI**, so the CLI is the only
process that knows what this build has.

So it goes where the tool's surface moving under a workspace is already the
subject: the upgrade report, from **one** detector, reported by both
`corpus workspace upgrade` and `corpus upgrade` (including `--check`).

**2. It is scanned _after_ the sync, and it is a warning.**

After, because a citation in a file the sync just overwrote is already gone —
what is left is only what the run could not repair, which is the workspace's own
edited skills. Under `--dry-run` nothing was written, so the scan reports the
workspace as it stands, which is what a dry run is for.

A warning, never a failure, for the reason the issue gives: a skill citing a
removed verb still saves and still runs, and fails only when the agent reaches
that line. It changes no exit code — every E2E run below exits 0.

**Corrected mid-implementation, and worth recording.** The section was first
rendered _inside_ `renderUpgradeReport`, on the reasoning that a stale citation
is a template-file matter. E2E showed that was wrong: **both** of
`corpus upgrade`'s renderers skip the nested template report entirely when the
template files are current (`if (template !== null && !template.upToDate)`), and
a workspace whose template files are current is exactly the one this finds
something in — its skills were edited, so the sync kept them, so their dead verbs
are still there. Nested, the finding was dropped in the only case that matters.
`corpus upgrade --check` printed nothing on a workspace that had one. It is now
hoisted to `UpgradeResult.staleCitations` and rendered beside the migrations, in
all three of the root verb's renderers, and written into `.corpus/upgrade.log`.

**3. False positives: two rules, and the check errs toward silence.**

Only **code** is read — a line inside a fenced block, or an inline `` ` `` span.
Prose that merely says the word corpus is never scanned. A sentence explaining
that a verb was removed can therefore only get in through an inline span, and an
inline span on a line carrying a removal phrase (`no longer`, `was removed`,
`there is no`, `does not exist`, `no such`, `used to be`, …) is read as prose
about a command rather than an instruction to run it. The guard is scoped to the
**sentence**, never to the file: a page may explain a removal in one paragraph
and still teach the dead verb in a worked block below, and that block is what an
agent copies.

Three more silences, all deliberate: a heredoc body is skipped to its
terminator, a placeholder (`corpus <topic> <verb>`, `corpus $LANE idle`) is a
claim about nothing, and `.claude/skills-archived/` is not scanned because
Claude Code does not discover it.

`assets/workspace/README.md`'s real sentence — _"There is no rollback command,
and here that is the point"_ — never names the verb at all, so it was never at
risk. The hypothetical that _is_ at risk is tested directly, six ways.

## Files

- `apps/cli/src/template/stale-verbs.ts` — the detector, pure and read-only
- `apps/cli/src/registry/types.ts` — `CommandContext.registry`, so a verb can ask
  what this build has without importing the registry that imports it (a cycle)
- `apps/cli/src/commands/workspace/upgrade.ts` — `UpgradeReport.staleCitations`,
  scanned in a wrapper around the four-exit sync, and `renderStaleCitations`
- `apps/cli/src/commands/upgrade/index.ts` — `UpgradeResult.staleCitations`,
  hoisted and rendered in all three renderers, journalled

## Acceptance Criteria
- [x] A skill citing a verb the installed registry does not have is reported
- [x] The registry is the source of truth, not a hand-kept list — the detector
      takes a `Registry` and has no list of removed verbs anywhere in it; a test
      passes a build with `corpus health` deleted and watches `health` be reported
- [x] Prose explaining that a verb was removed is not flagged
- [x] The report names the skill, the line, and what to do instead
- [x] A current workspace produces no findings — asserted against a workspace
      built from the real `collectIncoming()` install plan, and again E2E

## Testing Strategy
Unit over the detector, with `assets/workspace/README.md`'s own removal sentence
as the negative case — it is the exact false positive that matters.

## E2E Verification Log

**Model: Opus 5 (1M context).** Real `corpus` binary from `apps/cli/dist`, a
freshly `corpus init`-ed workspace at `.../scratchpad/ws` on port 9377. The
user's server on 8765 was never touched.

**1. A workspace this tool created reports nothing:**

```
$ corpus workspace upgrade
already up to date.
migrations: none — every document is written the way this tool reads it.
exit=0
```

**2. The agent edits its own skill, citing the verb CLI-040 removed** — and, in
the same file, writes a sentence _about_ the removal:

```bash
cat >> .claude/skills/orchestrate/SKILL.md <<'CORPUS_EOF'

## Recovering a broken loop

Undo the last edit:

```bash
corpus skill rollback orchestrate
```

Note that `corpus skill rollback` was removed, so this paragraph is prose about it.
CORPUS_EOF
```

**3. `corpus workspace upgrade` says so — once, for the block, not for the prose:**

```
$ corpus workspace upgrade
already up to date.
migrations: none — every document is written the way this tool reads it.

1 stale command reference — these files tell the agent to run a command this tool does not have, and it will find out by trying. Nothing here was changed:
  .claude/skills/orchestrate/SKILL.md:1976: `corpus skill rollback`
    corpus skill rollback orchestrate
    `corpus skill --help=brief` lists the verbs `corpus skill` has.
  Each of these files is yours, so the repair is an edit: `corpus doc edit <id>` with the line rewritten, or `corpus workspace diff <path>` to see what the tool's own copy says now.
exit=0
```

Line 1976 is the fenced command. Line 1986, the sentence saying it was removed,
is not reported. That is the whole false-positive requirement, on real content.

**4. `--json` carries it, and the exit code is still 0:**

```
$ corpus workspace upgrade --json
{
  "upToDate": true,
  "staleCitations": [
    {
      "path": ".claude/skills/orchestrate/SKILL.md",
      "line": 1976,
      "command": "skill rollback",
      "text": "corpus skill rollback orchestrate",
      "hint": "`corpus skill --help=brief` lists the verbs `corpus skill` has."
    }
  ]
}
```

**5. `corpus upgrade --check` reports it too** — this is the run that printed
nothing before the section was hoisted:

```
$ corpus upgrade --check
corpus 0.19.0 is the latest release
migrations: none — every document is written the way this tool reads it.

1 stale command reference — these files tell the agent to run a command this tool does not have, and it will find out by trying. Nothing here was changed:
  .claude/skills/orchestrate/SKILL.md:1976: `corpus skill rollback`
    corpus skill rollback orchestrate
    `corpus skill --help=brief` lists the verbs `corpus skill` has.
  …
nothing was downloaded, installed or written (--check).
exit=0
```

**6. The hint it prints actually runs:**

```
$ corpus skill --help=brief
corpus skill — Create a skill: the one skill operation no document verb can express.

Usage:
  corpus skill <verb> [args] [flags]

Verbs:
  create  …
```

### Checks

- `npm test -w apps/cli` — **102 files, 1,982 tests, all pass**
- `npx vitest run scripts` — **18 files, 919 tests, all pass**
- `tsc -p apps/cli/tsconfig.json --noEmit`, `eslint apps/cli/src`,
  `prettier --check` — all clean, no rule disabled

### Falsification

| Break                                                          |            Result |
| -------------------------------------------------------------- | ----------------: |
| `staleVerbCitations` short-circuited to `[]`                   | 6 failures across 2 files |
| removal-phrase guard disabled                                  |        2 failures |
| `staleCitations` hard-coded `[]` in the root `UpgradeResult`   |        3 failures |

No test was found that could not be made to fail.

## Not done

The finding is reported at upgrade time and nowhere else. A workspace whose
operator never runs any upgrade verb still discovers a stale citation the old
way. Reaching that case wants either a new contract check code so `corpus doc
check` can carry the finding (CONTRACT issue, cross-domain), or a standalone
workspace-lint verb — both larger than this P2, and both worth deciding
deliberately rather than in passing.
