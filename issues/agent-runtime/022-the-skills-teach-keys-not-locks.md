# [AGENT-022] The skills teach keys, and stop teaching locks

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CLI-038

## Spec References

- SPEC.md **§7** "A key, not a lock", and the orchestrator-skill invariants

## Summary

The instructions that made the old mechanism forgettable.
`assets/workspace/claude/skills/orchestrate/SKILL.md` tells the agent to run
`corpus lock acquire` in four places (lines 39, 745, 777, 781). Those verbs will
not exist.

This is product code — the skills `corpus init` installs into a user's workspace —
and it is the half of SHARED-041 that decides whether the agent behaves well or
merely cannot misbehave.

## Acceptance Criteria

- [x] Every `corpus lock` reference is gone from `assets/workspace/`. Grep, do
      not remember: the SPEC sweep for this rider found four references the plan
      had missed
- [x] The skill teaches the key discipline as a **loop**, not a rule to recall:
      read → work → write with the key you were given → keep the key the write
      returned. The old text failed because it asked for an extra action; the new
      text should describe the ordinary path, with no extra action in it
- [x] The skill says what to do on a `409`, concretely: re-read, reconcile what
      changed against what you meant, write again. Not "handle the error"
- [x] The **advisory signal** is taught as a courtesy with a named response: if a
      person has a session open, prefer to defer the event (`corpus queue defer
      --blocked-on`) over writing beside them. §7 makes this politeness rather
      than a gate — the skill should not imply the write would be refused
- [x] "Never force a lock" and the `corpus lock reap` recovery advice are removed
      rather than reworded. There is no recovery path because there is nothing to
      wedge
- [x] The comment skill gets the same pass — it also writes documents

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md`
- `assets/workspace/claude/skills/comment/SKILL.md`

### Notes

- Existing workspaces get these through `corpus workspace upgrade` (§2.4), which
  three-way merges and **will not overwrite a skill the user edited**. Say in the
  log what an unmerged workspace experiences — an agent following old
  instructions against a CLI that no longer has the verb.

## Testing Strategy

The skills are documents, so the test is the sweep plus a read-through against
the CLI's actual surface: every command the skill names must exist.

## E2E Verification Plan

`corpus init` a scratch workspace under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`, and walk the loop the skill
describes, command by command, against a real server on a free port (**never
8765 or 5173**). A skill that names a flag the CLI does not have is a failure.

## E2E Verification Log

**Model: opus (claude-opus-5, 1M context).** 2026-08-12.

### How the loop is framed

The orchestrate skill's `## Locks and deferral` is gone and `## Writing a document`
stands in its place — moved up, to sit between *Delegation* and *Reflecting on a user
edit*, so the mechanics arrive before the first section that writes. Its opening line is
the whole teaching: **Read → work → write with the key you were given → keep the key the
write returned.** Section count is unchanged at 16 (comment stays 13), so the pinned
`sections.size` assertions did not have to move.

The framing deliberately adds no step. The read is the one the retrieval discipline
already requires before a rewrite ("you already read a document before rewriting it"), and
the *next* key arrives in the write's own output rather than from a second read — which is
stated as the reason a chain of edits costs one read at the start. Invariant 7 in
orchestrate and invariant 4 in comment say the same in one sentence and point at the
section, so a subagent briefed only on invariants still has it.

The `409` is concrete and split from its sibling: **exit `2`** (no key or malformed — the
CLI refuses before sending, nothing reached the server, read and write again) against
**exit `9`** (stale — nothing was written, your text is still yours to resend; read what
the refusal printed, reconcile your change against the current text, run the same command
again with the fresh key). Both skills say *that retry is the mechanism working*, agreeing
with the CLI's own message rather than contradicting it, and both add the thing an agent
gets wrong next: **reconcile, never resend unchanged** — the text that came back is
somebody's edit and a body that ignores it erases it.

The advisory signal is taught as a courtesy with a named response and is never dressed as
a gate: *"Nothing is refused for it and a write would land"*, then reply → `corpus queue
defer --blocked-on <doc>` (comment stops at the reply and hands the event back, since queue
verbs stay with orchestrate). Its edge is stated too, because a text that only says "defer"
teaches over-deferring: a delta merges and is fine to land, a body rewrite is what the
courtesy is about, and where there is no claimed event there is nothing to park.

"Never force a lock" and the `corpus lock reap` recovery bullets are **deleted, not
reworded**. What replaced them is one clause of the loop paragraph — *nothing is acquired,
nothing is released* — stated as a property, not as a recovery procedure.

### The grep sweep

`grep -rni lock` across `assets/workspace/` found **56 hits, 12 of them real** (the rest
`block`, `blocked-on`, `clock`, "a closed door, not a locked one"). Four were the ones the
issue names; the sweep found eight more, and two outside the skills entirely:

- orchestrate: invariant 2 ("`--from` defaults to user … including `corpus lock acquire`"),
  invariant 4, the loop's step-8 defer example, the Routing "owns … locks" clause, the
  Delegation invariant bullet, "A blocked subagent defers", the `--quote` fallback in
  *Reflecting* ("when the anchoring write is refused by the user's lock" — a refusal that no
  longer exists, since an anchor is a named delta), the changelog write's "This write takes
  an edit lock", the whole `Locks and deferral` section, the job-log "blocking document",
  and two `--reason "waiting for the user's edit lock"` examples.
- comment: inherited invariant 4, the "Lock state … are CLI reads too" line, the whole
  `423`/deferral block in *Doing the work*, and the resolve paragraph ("a lock on the parent
  document does not stand in its way").
- **`assets/workspace/gitignore`** — `locks/` in the list of runtime state. No heading, no
  skill, and it would have shipped.
- **`docs/workspace-template.md`** (the install contract) still listed `.corpus/locks/` as a
  directory `corpus init` creates, which CLI-038 had already stopped creating; the
  install-contract test was red on it before I touched anything. Removed there and from
  `INIT_GENERATED` in `scripts/workspace-template.ts`, with "The three `.corpus/` runtime
  directories" corrected to two.

**One hit outside my domain, fixed and flagged**: `plugins/todos/skills/todos/SKILL.md`
told the agent `add` and `check` "take the document's edit lock, so the write is refused
with a `423`" and to "never break the lock". The plugin's *code* had already moved on
(`plugins/todos/server/errors.ts` speaks `409 stale_key`), so only the skill was stale. It
now says what is true: those verbs name their own delta and need no key, their `409` is
the item-moved guard ("changed under you; nothing was written") whose answer is a re-read
of `corpus todos list`, and the editing signal gets the same stand-aside response. Flagged
for plugins-dev in the report.

Final sweep: `grep -rni lock` over `assets/workspace/` and `plugins/*/skills/` returns one
hit — the word `clock`.

### Read-through against the CLI's actual surface

A script extracted every `corpus …` invocation from both skills, the todos skill and the
workspace README (fence-aware, heredoc bodies skipped) and resolved each command **and each
flag** against `docs/cli.md`'s per-command sections. Every one resolves; the only reported
misses are `--from` (a global flag, documented in the global table) and `corpus --help`.
`corpus doc patch` is **not** named anywhere: SHARED-037 has not shipped it, so the skills
teach only verbs that exist, and `CLI_COMMANDS_PENDING_CLI_006` stays empty.

Fence check, per the rule that has now bitten three times: both skills parsed with
`mdast-util-from-markdown` give **16 / 13** top-level `depth: 2` headings — equal to the
pinned `sections.size` — and every one of their 16 / 15 code nodes ends on a line that is
nothing but a backtick run. The todos skill likewise (6 headings, 4 blocks, 0 open).

### Real workspace, real server, real queue

`corpus init` into `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/agent022-ws`, server on
**port 7911** (8765 and 5173 untouched; the server was stopped and the port confirmed free
at the end). Every command below is the skill's own text, run verbatim.

1. **No `locks/` at install.** The scaffold creates `.corpus/{queue,jobs,attachments}` and
   nothing else — the directory the old text taught recovery for does not exist.
2. **The read prints the key**, in exactly the shape the skill's example shows: title, then
   `doc_alhvo5bt · note · open`, then
   `key 8c04c7ba23618c2205ee714d946f4045e4ad5f76a4c0010266c6a4c7c454eb04`.
3. **The write presents it and hands back the next one.**
   `corpus doc edit … --key 8c04c7ba… --from agent <<'EOF'` → `edited doc_alhvo5bt` /
   `key d6b91378…`. The **second** edit ran on that returned key with **no intervening
   read** → `key 340d358f…`. The chain the skill promises is real.
4. **Both refusals, as documented.** The first key replayed → exit **9**, the refusal
   printing the whole document as it now stands plus `--key 340d358f…` and the sentence
   "Retrying after a re-read is the expected path here, not a failure". No key at all →
   exit **2**, "Nothing was sent to the server". `--key nope` → exit **2**. Retrying with
   the fresh key the refusal printed → `edited`, no extra read.
5. **Delta verbs need no key**: `--add-tag`, `--title`, `--reviewed`, `--status`,
   `corpus doc move --folder`, `corpus doc archive`, `corpus doc unarchive` — all exit 0
   with no `--key`. And a key **is** still checked when passed on one: a stale key on a
   bare `--add-tag` refused at 9, which is why the skill says passing one is worth it on an
   edit you would rather have refused than merged.
6. **The advisory signal is advisory.** A `--from user` write opened an edit session;
   `corpus doc show` then printed the notice verbatim ("Nothing is refused for it and a
   write would land; … or park the work with `corpus queue defer <event-id> --blocked-on
   doc_alhvo5bt`"). An agent write **while that session was open landed, exit 0** — which
   is the fact that makes the old "the write would be refused" framing false, and is why
   the new text says a write would land.
7. **The named response, end to end.** Thread with `@agent` → `evt_fygarl2mgrrs` pending →
   `claim-all` → reply → `corpus job log … "stood aside on [[doc_alhvo5bt]] — a person has
   an edit session open"` → `corpus queue defer evt_fygarl2mgrrs --blocked-on doc_alhvo5bt
   --reason "a person is editing doc_alhvo5bt"` → `deferred 1`. Ending the person's session
   returned it to `pending` **by itself** (`pending 2`, the second being the `doc.edited`),
   the notice vanished from `doc show`, and the re-entered event was re-claimed and
   completed. `corpus doc check` on the finished workspace: 11 documents, no findings.

**One artifact worth recording.** The skills now contain example lines of the form
`key <64 hex>` inside fenced blocks, and `corpus doc show <skillDocId>` prints the body —
so a loose `awk '/^key /'` over a *skill* document picks up example keys as well as the
real one. It bit this session's own shell one-liner. Nothing in the product is wrong: the
header key precedes the blank line that starts the body, and `--json`'s `.key` is exact.
Both are what the skills tell an agent to use; the loose grep is not taught anywhere.

### Tests

`scripts/workspace-template.test.ts`: **212 pass** (was 4 failing before this issue — two on
the surviving `.corpus/locks/` and two on the four `corpus lock` invocations, which the
extractor had been catching all along). New `describe("a key, not a lock")` pins, across
**every installed skill** (template + plugins, the PLUGINS-013 widening): no `corpus lock`,
no "edit lock", no lock-breaking, no lock reaping, no `423`; no body-replacing
`corpus doc edit` without `--key`; one full read-key-write-key loop demonstrated (with an
anti-vacuity check, since "no edit without a key" passes trivially if no example edits);
both exits; "nothing was written"/"reconcile"/"fresh key"/"the mechanism working"; and the
courtesy phrasing including "would land". Five older assertions were re-based rather than
deleted, because each still pins something true (the deferral order, the append-by-reading
rule, the subagent hand-back). `scripts/` as a whole: 566 pass. Adjacent suites that read
these files (`apps/cli/src/commands/workspace/*`, `apps/server/src/projection/roots.test.ts`,
`plugins/todos`): 502 pass. ESLint clean on the two TS files; Prettier run on everything
touched that it is allowed to touch (`assets/workspace/` is in `.prettierignore` by
design — those bytes are what `corpus init` installs).

### What an unmerged workspace experiences

`corpus workspace upgrade` three-way compares, and the only cell that overwrites is *the
workspace never touched this file and the tool changed it*. Demonstrated both cells in the
scratch workspace: the untouched orchestrate skill was **updated** in one attributed
commit; a comment skill the user had edited was **kept**, and when the tool's copy also
changed it was reported as an unresolved conflict —
`keep .claude/skills/comment/SKILL.md — modified here … unresolved — corpus workspace diff …`,
`wrote 0 files`. So a workspace whose owner edited a core skill keeps the **old text**
until someone merges it by hand.

What that agent then experiences, measured rather than guessed:

- `corpus lock acquire <id>` → **exit 2**, `unknown command "lock". Did you mean "doc"?`
  with the valid topic list. Loud, immediate, and harmless: the old text calls it only in
  the deferral path and in an aside about `--from`, so most passes never reach it.
- The likelier collision is silent in the old text and loud in the CLI: every body edit the
  old skill teaches (`corpus doc edit <id> --from agent <<'EOF'`) is now **refused at exit
  2** before anything is sent, with the message naming the whole fix — *read it with
  `corpus doc show`, which prints its `key`, then send this edit again with `--key`*. An
  agent that reads its errors recovers inside one turn without the skill; one that does not
  fails the edit and reports it. **Nothing is lost or overwritten either way**, which is the
  property the key was chosen for.
- One residual mis-read is possible: the old text keys its deferral on **exit 5** with a
  named holder, and the new refusals are 2 and 9, so the wrong branch is unlikely to fire.
  An agent that nonetheless treats the refusal as contention would defer an event that had
  nothing to wait on — it parks, `corpus job retry` is the by-hand way out, and no write
  happens. Annoying, not destructive.
- The recovery is the one already documented in the workspace README and the *If the loop
  breaks* section: `corpus workspace diff <path>` to see what the tool changed, then merge
  by hand — or `corpus skill rollback <name>` to take the tool's copy wholesale and re-apply
  the local edit on top.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier on everything touched)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
