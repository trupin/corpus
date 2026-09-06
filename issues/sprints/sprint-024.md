# Sprint 024 — The workspace maintains itself honestly

**Issues**: UI-189 · CLI-081 · CLI-082 · CLI-083 · CLI-084 · SERVER-165 · SERVER-163 ·
AGENT-070 · AGENT-064 · INFRA-037 · INFRA-035 · SERVER-101 · SERVER-106 · SERVER-150
**Domains**: cli · server · agent-runtime · infra (see P1 — UI-189 is filed `ui` and is not a UI change)
**Release**: v0.34.0 — _"The workspace maintains itself honestly"_
**Date**: 2026-09-06
**Test numbering**: continues the ladder from sprint-023's `TEST-1090`; this sprint runs
`TEST-1091`–`TEST-1167`.

---

## What this wave is

Three strands that do not share code and do share a promise.

- **Phase 58 — upgrade conflicts (UI-189, CLI-081, CLI-082, CLI-083, CLI-084).** Five defects
  from one real 0.32.0 → 0.33.0 upgrade of the `cos` workspace on 2026-09-06. Every one of them
  makes the upgrade report something that is not true: a resize reported as an edit, a deliberate
  customization reported forever, a timestamp reported as a modification, a verb the new tool has
  reported as missing, and a three-way merge nobody can perform without hand-running
  `git merge-file` and losing a block to it.
- **Designation engages (SERVER-165, SERVER-163, AGENT-070).** The §7/§8 rider is signed
  (user, 2026-09-06). The behaviour may land. AGENT-070 makes the shipped skills say the new truth,
  and SERVER-163 fixes the lane that never had a launch record at all.
- **Harness and server debt (AGENT-064, INFRA-037, INFRA-035, SERVER-101, SERVER-106,
  SERVER-150).** One real product bug hiding inside harness noise, two harness defects that blame
  the product for the harness's own timing, and three pieces of long-carried server debt.

**The bar for this wave.** Every acceptance test below is verifiable from outside the code — a
command's output, a file's bytes, a queue event, a git log line, a rehearsal record. Where an
issue's own file asks the implementer to decide something, the contract names the decision and
requires it in writing. Where an issue's premise is wrong, P1–P10 correct it before an agent is
spawned on it.

---

## Premise checks — verified read-only against the tree, 2026-09-06

No git, no builds, no installs, no test runs. Line numbers are from the tree at contract time.

### P1 — UI-189 under direction 2 is not a UI change

The orchestrator has already ruled for direction 2: the template comparison ignores declared
presentation keys. Under that ruling the whole fix lives in `apps/cli`:

- the comparison — `apps/cli/src/template/plan.ts`, `apps/cli/src/template/manifest.ts`
- the write — `apps/cli/src/commands/workspace/upgrade.ts`

**No file under `apps/ui` or `packages/kit` changes.** `apps/ui/src/board/useColumnWidth.ts:98`
keeps PUTting `{ extra: { width } }` exactly as it does today — direction 1, which would have moved
that write, is the rejected direction. UI-189 should be implemented by **cli-dev**, in the same
worktree and by the same agent as CLI-083, because the two share one mechanism (P4). The
`ui` domain label on the issue file records who found it, not who fixes it.

The one criterion that stays UI-observable is "resize still persists across a reload", and it is a
regression check on untouched code (TEST-1102).

### P2 — `width` is already declared presentation state, server-side

`apps/server/src/docs/update.ts:171`:

```ts
const PRESENTATION_KEYS: ReadonlySet<string> = new Set(["width"]);
```

read by `isContentEdit` at line 186 and by `stampUpdated` at line 655. **So a column resize does
not restamp `updated`.** The file's whole delta after a resize is one added `width:` key.

Two consequences the issues do not state:

1. UI-189 does not depend on CLI-083's stamped-key set for its own reproduction. The two are
   independent defects that must share one mechanism, not one defect seen twice.
2. The name and the meaning already exist in this repository. Direction 2's stated cost — "the list
   of ignored keys is a second place the meaning of frontmatter lives" — is **already paid**; what
   this sprint must refuse is paying it a *third* time. See P3.

### P3 — the presentation-key set is server-private, and the CLI may not import it

`PRESENTATION_KEYS` is a module-local `const` in `apps/server/src/docs/update.ts`. The dependency
direction is `packages/contract` ← `apps/server` / `apps/cli`: **`apps/cli` cannot import from
`apps/server`, and must not.**

CLI-083's own criterion already asks for the right shape — _"the ignored-key set is derived from
the contract's own definition, with a drift test"_. That criterion now binds UI-189's key too.
The single declaration lives in `packages/contract`, both the server's stamping rule and the CLI's
comparison read it, and a drift test fails if a key is added in one place only.

**This is a `packages/contract` touch that no issue in this batch owns.** See Escalation E1.

### P4 — the comparison is a sha256 over raw bytes, and normalized(baseline) is not recoverable

`decide()` (`plan.ts:84`) is a pure function of three hex strings. The manifest
(`manifest.ts:19`) stores `{ path, sha256 }` and nothing else. Ignoring a key therefore means
hashing **normalized** bytes — and of the three values, only two can be normalized:

| value | bytes on hand? | normalizable? |
| --- | --- | --- |
| `workspace` | yes, the file | yes |
| `incoming` | yes, the tool's own template | yes |
| `baseline` | **no** — only a stored raw hash | **no** |

The rule that fixes both reported cases without any manifest migration is the normalized lift of
the branch already at `plan.ts:96`:

> when `normalized(workspace) === normalized(incoming)`, the verdict is `current`.

That covers a resized view and a restamped skill on **every existing workspace**, with no
migration, because it never consults the baseline.

The residual case is real and must be stated rather than hidden: upstream changed the file **and**
the workspace's only delta is ignored keys. Deciding that needs `normalized(baseline)`, and a
legacy manifest cannot answer it. The implementer records the decision — the expected shape is a
normalized sha recorded going forward, with legacy entries falling back to the raw comparison and
therefore reading `keep-modified`. **Never guess a baseline.** `manifest.ts`'s own comment says
why: adopting a modified file's current sha as its baseline is how the next template change
overwrites the edit this verb exists to protect.

### P5 — the hazard neither issue names: an `update` verdict destroys the ignored key

This is the most important finding in the batch.

The point of ignoring `width` is to make a resized view **`update`-eligible again**. And
`apps/cli/src/commands/workspace/upgrade.ts:510` is:

```ts
copyFileSync(from, to);
```

So the very first upgrade the fix enables overwrites `width: 686` with template bytes that carry
no `width` at all. The user's resize is destroyed by the fix for the resize.

`updated:` is worse in kind, not in degree. **Every seeded template document ships a fixed
`updated:`** — `assets/workspace/data/docs/views/attention.md:6` is
`updated: 2026-07-26T00:00:00Z`, and the six installed skills, the README, three boards and the
note template all carry one. Copying those bytes over a document a person edited yesterday moves
`updated` **backwards by six weeks**, and `updated` is read by §5's staleness ramp, by §9.2's
newest-first ordering, and by `isUnreflected`.

**Binding requirement: an ignored key present in the workspace copy survives the write that
ignoring it enabled.** An `update` writes the template's content and keeps the workspace's ignored
keys. TEST-1094 and TEST-1099 hold it for both keys, and they are the two tests most likely to be
missed, because both issues are written as if the comparison were the whole job.

### P6 — the merge verb's writes and the upgrade's writes are different paths

`workspace upgrade` writes directly: `writeFileSync` at `upgrade.ts:132` and `:438`,
`copyFileSync` at `:510`. It is not a server client, and it runs across a tool swap and a server
restart.

CLI-082's _"clean merges are written through the server (sole writer)"_ is correct **for merge**,
which runs against a live workspace with a running server. It is not a demand to re-plumb the
upgrade's copy, and no test below asks for that. An implementer who reads it as one will rewrite a
verb this sprint has no issue for.

### P7 — SERVER-165 and SERVER-163 collide on two files

Both land in `apps/server/src/threads/create.ts` and `apps/server/src/threads/resident.ts`. One
agent, sequenced — **SERVER-165 first, SERVER-163 second** — never two worktrees. `resident.ts`'s
`sameResident` (line 332) deliberately excludes `designationId` so a no-op re-designation does not
displace a listener; SERVER-163's criterion "no duplicate designation events" must not defeat that
guard, and SERVER-165's engagement write must not route around it either.

### P8 — rehearsal scenario 10's follow-up is already plain; the workaround is on the create

SERVER-165's sixth criterion says scenario 10's seeding _"no longer needs the `@agent` workaround
its E2E logs record"_. Read against
`rehearsals/scenarios/10-a-listener-answers-twice.ts`:

- the **create** passes `--requests-agent true` (line 72) and asserts `thread.eventId !== null`;
- the **follow-up** already omits `requestsAgent` (lines 85–103), with a comment saying so —
  _"the thread is engaged, so omission enqueues — a person's ordinary follow-up"_.

So there is no `@agent` string in the scenario, and the follow-up needs no change. **What the
criterion is actually about is Open Question O1**, which SERVER-165 must answer before it can
know whether that file changes at all.

### P9 — SERVER-106's audit has three named doors, and two of them are gaps

Of §4's list — _"a document archived, restored, moved, renamed, or marked still current"_ — the
tree says:

| act | door | declares `act: "names-the-window"`? |
| --- | --- | --- |
| archived | `POST /api/docs/{id}/archive` | **yes** — `archive.ts:639` |
| archived | `PUT` with `{status:"archived"}` | **no** — `update.ts:777` sets it only for `reviewed` |
| restored | `PUT` with `{status:"open"}` | **n/a — no door**: refused 400 at `update.ts:539` (SERVER-039). The real restore gap is §5's stage coupling, which bypasses that guard (`update.ts:707`). Corrected 2026-09-06 by SERVER-106's audit, which also found a third gap: retitling. |
| moved / renamed | `move.ts` | **yes** — `move.ts:133` |
| marked still current | `PUT` with `reviewed` | **yes** — `update.ts:796` |

So the audit has exactly two PUT-door gaps to name, and `update.ts:796` is the one line that
decides both. That is the shape of the audit deliverable, and the rider must cover both — a rider
that settles archiving and leaves restoring open re-files this issue next release.

### P10 — AGENT-064's precondition is met

`issues/PLAN.md:2265` records INFRA-036 as **done**. So a red rehearsal row now means the product
did something, which is exactly the condition AGENT-064's own file says it was waiting for. The
named record — `rehearsals/out/2026-09-02T16-29-29.929Z/01-stated-weight.run-3.json` — carries the
job log, the queue state and the thread bytes, and is read before anything is changed.

---

## Rulings already made — binding, not open

These are the orchestrator's, recorded so no agent re-opens them.

1. **UI-189 takes direction 2.** The template comparison ignores declared presentation keys, riding
   on CLI-083's ignored-key mechanism. Direction 1 — moving presentation state under `.corpus/` —
   is rejected, and the rejection is argued in the issue file by the implementing agent, as its
   first acceptance criterion requires. The migration criterion is met **comparison-side**, by P4's
   normalized rule, not by rewriting anyone's files.
2. **SERVER-101: a thread's first turn is a turn under §4's existing text.** Implement it. No spec
   change, no rider, no escalation. §4's closer list already reads "a turn posted to a thread", and
   the delta's own justification in `turns.ts` applies verbatim to the comment that creates the
   thread.
3. **SERVER-106 ships no behaviour change this sprint.** Both readings change SPEC.md, so the
   deliverable is the audit of P9's table, a drafted rider with a recommendation, and nothing else.
   No `update.ts` diff, no `acts.test.ts` behaviour case. A signature is what unblocks the code, and
   this sprint does not have one.
4. **SERVER-165's rider is signed** (user, 2026-09-06). The behaviour may land. Applying the rider
   text to SPEC.md is the orchestrator's, not the domain agent's.

---

## Machine rules — binding on every agent in this batch

- **At most three implementation agents at once.** The suggested waves are in "Spawn order" below.
- **Scoped tests only**: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run <path>`. Never
  `npm test`, never `npm run test:coverage`, never `npm run coverage` from a worktree. The
  orchestrator runs the single repo-wide gate at harvest.
- **One heavy command at a time.** No overlapping builds, test runs, e2e, or `npm install`.
- **Playwright and the rehearsal harness are single-holder.** Both start their own servers.
  INFRA-037 and INFRA-035 both run passes — they do not run at the same time as each other, nor
  while AGENT-064 is reproducing.
- **`npm run build` before lint, typecheck or test.** `@corpus/*` imports resolve through `dist/`.
- Kill every process you started before ending, by recorded pid, and verify your ports are free.
  **Never kill the `corpus` process on 8765** — that is the user's live server.

---

## Acceptance Tests

### Group A — the upgrade comparison (cli-dev)

#### CLI-083: `updated:` restamps count as modification

TEST-1091: The ignored-key set is one declaration, in the contract
Given: The repository builds
When: The ignored frontmatter keys are located
Then: They are declared in `packages/contract`, exported, and read by both
`apps/cli/src/template/` and `apps/server/src/docs/update.ts` — no second literal set exists
anywhere in `apps/` (a grep for a set literal containing `"width"` or `"updated"` outside the
contract returns nothing)

TEST-1092: A drift test fails when a key is added in one place only
Given: The contract's declaration and the server's use of it
When: A key is added to one and not the other in a scratch edit
Then: A named test fails with a message saying which side is behind; the test is reverted and
passes on the real tree

TEST-1093: A stamp-only delta reads unmodified and upgrades cleanly
Given: A real workspace whose `data/docs/views/inbox.md` differs from its manifest baseline in the
`updated:` value alone, and a tool whose template changed that file's body
When: `corpus workspace upgrade` runs
Then: The file's verdict is `update`, not `keep-modified`; the run's report does not list it as a
conflict; the file's body is the incoming template's

TEST-1094: The update preserves the workspace's `updated:` (P5)
Given: The workspace file from TEST-1093, whose `updated:` reads a date after the template's
When: The same upgrade writes that file
Then: The written file carries the template's body **and the workspace's `updated:` value** — the
template's fixed `2026-07-26T00:00:00Z` does not appear in the file afterwards

TEST-1095: A stamped delta plus a real edit still reads modified
Given: A workspace file with both a restamped `updated:` and an edited body line
When: `corpus workspace upgrade` runs against a tool that also changed that file
Then: The verdict is `keep-modified`, the file is not written, and it is reported as a conflict

TEST-1096: `workspace diff` says what it is looking at
Given: A stamp-only file, per TEST-1093
When: `corpus workspace diff <path>` runs
Then: Output is either empty or a single line stating the file differs only in server-stamped
keys — the choice is recorded in the issue file, and the same choice holds for a `width`-only file

#### UI-189: resizing a column manufactures an upgrade conflict

TEST-1097: The decision is recorded with the rejected direction argued
Given: The issue file after implementation
When: It is read
Then: It records direction 2 as chosen, argues direction 1's rejection in prose, and states that
the migration criterion is met comparison-side with no file rewritten

TEST-1098: Resize then upgrade reports no conflict
Given: A real workspace, upgraded to the current tool, with `views/attention.md` at its baseline
When: A column is resized in the board (writing `width:` into that view), and
`corpus workspace upgrade` then runs against a tool whose template changed that view
Then: The report lists no conflict for `views/attention.md`

TEST-1099: The update preserves the workspace's `width:` (P5)
Given: TEST-1098's workspace, whose view carries `width: 686`
When: The upgrade writes that view
Then: The written file carries the template's body **and `width: 686`** — the width is not lost by
the write that ignoring it enabled

TEST-1100: An existing stamped-width workspace stops conflicting, with no migration
Given: A workspace created and resized **before** this fix — its manifest is a pre-fix manifest,
untouched, and its view carries a `width:` the baseline does not
When: The fixed tool runs `corpus workspace upgrade`
Then: No conflict is reported for that view, and the manifest file is not rewritten to make it so

TEST-1101: A real content edit to a view still conflicts
Given: A workspace whose `views/attention.md` has both a `width:` and an edited `query:` block
When: An upgrade runs against a tool that changed that view
Then: The verdict is `keep-modified` and the file is untouched

TEST-1102: Resize still persists across a reload
Given: The running app with a resized column
When: The browser reloads
Then: The column renders at the resized width (regression check on untouched UI code)

#### CLI-081: the manifest cannot record deliberate divergence

TEST-1103: A kept file stops being reported
Given: A workspace whose `data/docs/boards/attention.md` carries two hand-added columns, reported
`keep-modified` by an upgrade
When: The keep verb is run on that path, and `corpus workspace upgrade` runs again against a tool
that still changes that file
Then: That path is absent from the conflict list, and the run prints one summary line naming how
many kept files exist

TEST-1104: Silence never hides a growing list
Given: Three kept files
When: An upgrade runs
Then: The summary line states the count as three, and a verb exists that lists them by path

TEST-1105: Un-keep compares against the current baseline
Given: The kept file from TEST-1103, after two further upgrades advanced its manifest baseline
When: The keep mark is cleared and an upgrade runs
Then: The conflict reported is against the **current** template, not the one in force when the
file was kept — the reported diff names content from the newest template

TEST-1106: Keeping does not freeze the baseline
Given: A kept file
When: Upgrades run while it is kept
Then: The manifest entry for that path advances to each version's incoming sha, and the file on
disk is never written

TEST-1107: The mark survives an upgrade
Given: A kept file, and the tool upgraded to a new version
When: The upgrade completes and another runs
Then: The mark still holds and the file is still unreported

TEST-1108: Keeping a path the manifest does not know is refused, clearly
Given: A workspace
When: The keep verb names a path that is not a template file
Then: It exits non-zero with a message naming the path and saying it is not template-tracked;
nothing is written

TEST-1109: The surface is documented
Given: The implementation
When: `npm run docs:cli` (or the repo's generator) runs and `docs/cli.md` is read
Then: `docs/cli.md` is regenerated with no diff left over, and the verb's help states: kept files
are skipped by the conflict report, the summary line always appears, keeping is not merging, and
un-keeping compares against the current baseline

#### CLI-082: skills have dual ownership and no merge verb

TEST-1110: Three divergent copies merge their clean hunks
Given: A real workspace where `.claude/skills/comment/SKILL.md` has local additions, the manifest
baseline is a third set of bytes, and the incoming tool copy adds non-overlapping lines
When: `corpus workspace merge .claude/skills/comment/SKILL.md` runs
Then: Exit code is the clean-merge code; the file contains both the local additions and the
incoming additions; the run says what it merged

TEST-1111: A conflicted merge writes nothing
Given: The same file, with a local edit and an incoming edit on the **same** lines
When: The merge runs
Then: Exit code is the conflicts code; the workspace file is **byte-identical** to before
(sha256 compared); the conflicting hunks print with surrounding context

TEST-1112: The baseline-only-hunk trap is named on the hunk
Given: A file with a block present in the manifest baseline and in the workspace copy, and absent
from the incoming tool copy
When: The merge runs
Then: That hunk carries a warning saying, in as many words, that the tool cannot tell an upstream
deletion from a pre-baseline local edit; no side is silently picked; the block is not dropped
without saying so

TEST-1113: Nothing to merge says so
Given: A file identical to the incoming copy
When: The merge runs
Then: Exit code is the nothing-to-merge code and the message says there is nothing to merge

TEST-1114: The write goes through the server, as one authored act
Given: A workspace with its server running
When: A clean merge writes the file
Then: `git log -1 --format='%an %s'` on that workspace shows one commit, authored by the acting
party, naming the merge — not one commit per hunk, and no direct-to-disk write bypassing the
server (P6: this applies to `merge`, and not to `upgrade`'s copy)

TEST-1115: A kept file merges on request
Given: A file marked kept under CLI-081
When: The merge verb names it
Then: It merges normally — kept is "stop nagging", never "stop being mergeable"

TEST-1116: Merging does not clear the keep mark
Given: TEST-1115's file after a clean merge
When: An upgrade runs
Then: The file is still kept and still unreported; clearing the mark remains a separate act

TEST-1117: The trap is documented in the help
Given: The implementation
When: `docs/cli.md` is regenerated and the verb's `--help` is read
Then: Both name the baseline-only-hunk ambiguity explicitly, and the three exit codes are
documented by meaning

#### CLI-084: the stale-verb scan judges against the outgoing tool

TEST-1118: **Reproduce first** — the 0.32.0 binary flags a verb 0.33.0 has
Given: A workspace on the 0.32.0 tool
When: It is upgraded to 0.33.0 and the upgrade's stale-verb scan runs
Then: `corpus thread digest` is flagged at converse/SKILL.md lines 299 and 906; the exact output is
pasted into the issue's E2E Verification Log before any code changes

TEST-1119: The three-word-grammar hypothesis is answered
Given: `apps/cli/src/template/stale-verbs.ts:244`'s two-token cap
When: It is tested directly against the 0.33.0 registry entry for `thread digest`
Then: The issue log records whether the reporting agent's parser diagnosis was right or wrong, with
the evidence — tested, never assumed, so the report's author gets a correction or a confirmation

TEST-1120: Post-fix, the same upgrade path reports nothing for that verb
Given: The reproduction from TEST-1118, on the fixed tool
When: The upgrade runs
Then: No finding is reported for `thread digest`

TEST-1121: A genuinely removed verb is still flagged
Given: A template skill referencing a verb the incoming tool does not have
When: The upgrade's scan runs
Then: It is flagged, naming the file and line — CLI-059's purpose survives the fix

TEST-1122: The direction is recorded
Given: The issue file after implementation
When: It is read
Then: It states which direction was taken — resolving against the incoming package's registry, or
deferring the scan to first run after the tool swap — and why the other was not

---

### Group B — designation engages (server-dev, then agent-runtime-dev)

#### SERVER-165: designating a thread engages it

TEST-1123: The rider is applied to SPEC.md before the behaviour lands
Given: The signed rider text (user, 2026-09-06)
When: SPEC.md is read
Then: §7's designation text and §8's opt-in rule carry the rider, cross-referenced, before any
behaviour commit — the orchestrator applies it, not the domain agent

TEST-1124: Designation sets `agent: engaged` in the same write
Given: A standalone thread whose `agent` is `none`
When: A resident is designated through `POST /api/threads/:id/resident`
Then: The thread's frontmatter reads `agent: engaged`, and `git log -1 --name-only` shows the
designation and the engagement in **one** commit

TEST-1125: Every designating surface does it
Given: A workspace
When: A resident is designated through each surface in turn — the Ask composer, the thread control,
and a re-designation replacing an existing resident
Then: Each leaves `agent: engaged`, in the same commit as the designation

TEST-1126: A plain user turn on a designated thread enqueues on the resident's lane
Given: A designated thread with a real listener parked on its lane
When: A person posts a turn with no mention, no skill directive and no `requestsAgent` flag
Then: A `comment.created` is enqueued stamped with the resident's lane; the listener claims it and
answers in the thread — E2E on a real workspace, with the listener's reply quoted in the log

TEST-1127: Release reverts nothing on the thread
Given: TEST-1126's thread, after the resident is released
When: The thread's frontmatter is read, and a plain turn is posted
Then: `agent: engaged` persists; the turn enqueues on the **orchestrator's** lane; the conversation
keeps being answered, by the ordinary agent (settled at PR #74 finding 3 — the pre-designation
restore reading is rejected)

TEST-1128: Resolve ends engagement through its existing cascade
Given: An engaged, designated thread
When: It is resolved
Then: The resident is released and engagement ends by the cascade that already does it — no new
code path, and a plain turn afterwards enqueues nothing until the thread is reopened

TEST-1129: The event payloads are unchanged
Given: A designation and a release
When: The `resident.designated` and `resident.released` payloads are compared against the current
schema
Then: They are byte-comparable in shape to today's — nothing new travels, and the contract is not
touched

#### SERVER-163: a plainly created thread designates with no event

TEST-1130: The ordinary creation path is decided, in writing
Given: The issue file after implementation
When: It is read
Then: It states whether a plain `corpus thread create` enqueues `resident.designated` for the
general resident it designates, or whether the absence is deliberate — with the queue-cost
reasoning either way

TEST-1131: Whichever it is, the ordinary path behaves that way
Given: A workspace
When: `corpus thread create --title "…"` runs with no resident named
Then: The queue holds exactly what TEST-1130 decided — one `resident.designated` on the
orchestrator's lane, or none — and a server test asserts it by name

TEST-1132: The two absences are distinguishable
Given: A lane whose launch record was reaped, and a lane for which none was ever written
When: `UI-186`'s launch-record read runs on each
Then: It returns two different states, and the Residents pane says something truer than "unknown"
for at least one of them

TEST-1133: No duplicate designation events
Given: A thread created with an explicit resident named at creation
When: It is created
Then: Exactly one `resident.designated` exists for it — an event per creation path, never per code
path

TEST-1134: The churn guard survives
Given: A thread with a live listener, re-designated to the same resident
When: The re-designation runs
Then: `sameResident` still suppresses the displacement — the listener is not displaced, and
`designationId` is still excluded from that comparison

#### AGENT-070: the skills still say mentions only

TEST-1135: Every statement matches the signed rider
Given: `assets/workspace/claude/skills/converse/SKILL.md`, `comment/SKILL.md`, `orchestrate/SKILL.md`
When: Every statement about participation on a designated lane is read
Then: None says a plain turn on a designated lane reaches nobody; each matches the rider's text,
including release leaving engagement in place

TEST-1136: The template guards are updated
Given: `workspace-template.test.ts`
When: It runs
Then: It passes, and its assertions name the new truth rather than the old

TEST-1137: The size ratchet is green
Given: INFRA-038's skill size budget
When: The ratchet runs after the edits
Then: It is green, and the net size change per skill is recorded in the issue's log

TEST-1138: A plain message to a designated conversation is answered
Given: A real workspace initialized from the edited template, with a designated thread and a
listener running
When: A person posts an unmentioned message
Then: The resident answers it in the thread — E2E, with the reply quoted in the log

---

### Group C — §4 acts (server-dev)

#### SERVER-101: a thread creation is not an act

TEST-1139: The answer is recorded
Given: The issue file after implementation
When: It is read
Then: It records the orchestrator's ruling — a thread's first turn is a turn under §4's existing
text — and states that no spec change was needed

TEST-1140: A thread creation closes the window and names its commit
Given: A document saved inside an open idle window
When: A thread is created on that document before the window closes
Then: One commit lands whose subject names the thread creation
(`comment: new thread on doc_… by user`), and the subject is not overwritten by a later save

TEST-1141: The next save opens a fresh window
Given: TEST-1140's state
When: The document is saved again
Then: A new window opens and its commit is a separate `editing session` commit

TEST-1142: The two-file act is one commit
Given: An anchored thread creation, which also writes the parent document's frontmatter
When: It runs
Then: `git log -1 --name-only` shows the thread file and the parent document in **one** commit —
this act must not become two

TEST-1143: The "does not close a window" list is unaffected
Given: `apps/server/src/docs/acts.test.ts`
When: It runs
Then: Its "what does not close a window (§4)" describe block (line 312) passes unchanged

#### SERVER-106: archiving through the form is not an act

**No behaviour change ships this sprint** (Ruling 3). The deliverable is the audit and the rider.

TEST-1144: The audit covers every PUT door on §4's list
Given: §4's list — archived, restored, moved, renamed, marked still current
When: The audit is read in the issue file
Then: It names, per act, which route declares `act: "names-the-window"` and which does not,
citing the line — at minimum `archive.ts:639`, `move.ts:133` and `update.ts:796` — and it names
**both** PUT-door gaps (`status: archived` and `status: open`), not only the reported one

TEST-1145: The rider is drafted with a recommendation
Given: The audit
When: The rider text is read
Then: It is quotable spec prose, it picks one of the two readings, it argues the rejected one, and
it says what changes in §4 or §10 — a rider that settles archiving and leaves restoring open is
not accepted

TEST-1146: No behaviour changed
Given: The branch's diff for this issue
When: It is read
Then: `apps/server/src/docs/update.ts` is untouched, `acts.test.ts` gains no behaviour case, and
SPEC.md is unchanged — the rider waits for a signature

TEST-1147: The escalation is explicit
Given: The orchestrator's report
When: It is read
Then: The rider is named as an unsigned item for the next release proposal, quoted in full for
the user to read aloud

---

### Group D — the rehearsal harness (infra-dev)

#### INFRA-037: a seed write commits after the boundary

TEST-1148: The boundary is taken after every seed write is committed
Given: `rehearsals/fixture.ts`'s `snapshotSeed`
When: A scenario seeds and the boundary is taken
Then: No commit authored `user` with a tree the boundary does not hold appears on the run's side of
the boundary, across a full pass of the affected stories

TEST-1149: The window is closed, not outlasted
Given: The implementation
When: The diff is read
Then: `SEED_COMMIT_WAIT_MS` is not increased, and the fix closes the server's commit window
deterministically rather than waiting longer — INFRA-020's timeout-moving reflex is refused in
writing

TEST-1150: The narrow excusal stays narrow, and fires less
Given: INFRA-033's tree-and-parent excusal
When: The existing tests for it run, and a pass is scored
Then: The tests pass unchanged, and the excusal fires no more often than before — a boundary that
is right makes it fire less

TEST-1151: A cut-short run contributes no universal findings
Given: A run the harness cut short
When: It is scored
Then: It contributes no universal findings, for the same reason it contributes no score; a
**completed** run with a genuine hand-edit still reports one, and a unit test over the scorer holds
both halves

TEST-1152: Story 4 is re-run and its grade reflects the product
Given: The fix
When: `04-two-lanes-no-crossing` is re-run
Then: The universal finding is gone, and the grade — whatever it is — is reported as a fact about
the product, with the run records named

#### INFRA-035: a second judgment scenario proves the read discriminates

TEST-1153: A second lane is seeded, and it reads as working something out
Given: The new scenario (or the second seed inside story 2)
When: Its seed text is read
Then: It is a decision being weighed, with wording that will leave the corpus — and it is as
unambiguous in its own direction as story 2's fetch-and-relay seed is in its

TEST-1154: The distribution is recorded, and no tier is asserted
Given: The scenario at its N
When: It runs
Then: Its launch tiers are recorded as a distribution; **no assertion names a tier** — pinning one
re-imposes the default AGENT-063 removed

TEST-1155: The finding is the comparison, stated once
Given: Both scenarios' results
When: The scorecard is read
Then: One line states whether the two lanes landed **differently** — a reader does not have to hold
two rows in their head to see the finding

TEST-1156: The seed produces the two lanes it claims
Given: The fixture
When: Its unit test runs
Then: It asserts the seeded workspace holds both lanes, with the titles and bodies the scenario
describes

TEST-1157: The cost is recorded
Given: The chosen shape — a second scenario, or one scenario seeding both lanes
When: The issue file is read
Then: It records which shape was taken, the added pass time measured rather than estimated, and why
the other shape was not

---

### Group E — the settled event with no reply (agent-runtime-dev)

#### AGENT-064: an event is settled without a reply

TEST-1158: **Reproduce first**, naming the settled status
Given: `rehearsals/out/2026-09-02T16-29-29.929Z/01-stated-weight.run-3.json`
When: Its job log, queue state and thread bytes are read
Then: The issue log names whether the event settled `processed`, `failed` or `abandoned` — which
decides whether this is a wrong report or a lost one — before anything is changed

TEST-1159: The failure is reproduced live
Given: A real workspace
When: The path the record describes is exercised
Then: Either the failure reproduces, with the settled status and the empty thread recorded, or the
log states plainly that it did not reproduce in N attempts and what was learned instead

TEST-1160: An answering event cannot settle silently
Given: The fix
When: An agent reaches the settle verb for a `comment.created` without having posted a turn
Then: Either the settle is refused, or the event fails with a reason a person can read in the
console — silence is the one outcome §7 rules out

TEST-1161: A legitimate no-reply settle still works
Given: An event whose correct outcome is no thread turn — a `doc.edited` reflection that changed a
changelog, for instance
When: It settles
Then: It settles normally; the new rule reaches answering events only, and a named test holds the
boundary

TEST-1162: Stories 1 and 3 pass on scored runs
Given: The fix, with INFRA-036 landed
When: INFRA-034 stories 1 and 3 run a full pass
Then: Both pass, on runs that were actually scored — a pass carried by cut-short runs does not
count, and the run records are named in the log

---

### Group F — the undiagnosed waits (server-dev)

#### SERVER-150: three tests hold real waits

TEST-1163: `acts.test.ts:299` is diagnosed before it is sized
Given: The 2537 ms measurement
When: The time is attributed
Then: The issue log names what the time is spent on — a real wait, a warm-up, or contention — with
the measurement that shows it; **no budget is set before this line exists**

TEST-1164: The real-listener warm-up moves to a `beforeAll`
Given: `apps/server/src/attachments/serve.real-listener.test.ts`
When: The file runs
Then: The one-time bind cost is paid in `beforeAll`; no single test in the file is an outlier
against its siblings' 241–266 ms; every assertion is unchanged

TEST-1165: `sse.test.ts:306`'s wait is removed or its cause is named
Given: The `SHUTDOWN_GRACE_MS` hypothesis, recorded as unverified
When: It is tested
Then: Either the ~4 s wait is removed and the test's assertions are unchanged, or the hypothesis is
disproved and the real cause is recorded in the issue

TEST-1166: The stopgap budgets come down, measured
Given: The two `15_000` budgets
When: They are reset
Then: Each is set from a measurement stated in the issue, not from a round number

TEST-1167: `test:slow` is clean, or its survivors carry a diagnosis
Given: The fixed tests
When: `npm run test:slow` runs over `apps/server`
Then: It reports zero findings, or each survivor has a diagnosis written beside it — and **no
assertion in any of the three tests changed**; a needed assertion change is reported as a finding,
not made as an edit

---

## Out of scope

- **Any SERVER-106 behaviour change.** Ruling 3. The rider waits for a signature.
- **Moving presentation state under `.corpus/`.** UI-189 direction 1 is rejected. `useColumnWidth.ts`
  keeps its PUT.
- **Re-plumbing `workspace upgrade` through the server.** P6. CLI-082's server-writes rule is about
  `merge`.
- **Rewriting anyone's manifest to fix an existing workspace.** P4. The migration criterion is met
  comparison-side. A manifest an upgrade rewrites is a manifest that can lie.
- **A resolution UI for CLI-082's conflicting hunks.** The verb prints hunks and exits; an editor
  integration is not this issue.
- **Changing what the stale-verb scan checks.** CLI-084 changes **which registry** it resolves
  against, never the grammar it parses — unless TEST-1119 proves the grammar is also wrong, in
  which case that is a new issue.
- **Widening the universal-findings excusal to every `user` commit.** INFRA-037's own file refuses
  it: the invariant exists because a hand-edited workspace is not a rehearsal.
- **Raising any timeout to make a test pass.** SERVER-150 and INFRA-037 both.
- **AGENT-064's rate.** How often the silent settle happens is not measurable this sprint; the fix
  makes it impossible, and the rate stays unknown.
- **CLI-077 (`thread digest` carrying a conversation forward).** Referenced by CLI-084 as the verb
  that exposed the bug. Not in this batch.

---

## Integration points — the seams that must hold

**S1 — one ignored-key declaration serves three consumers.** CLI-083's stamped keys and UI-189's
presentation keys are **one mechanism with two key classes**, declared once in `packages/contract`
and read by: the CLI's template comparison (`plan.ts` / `manifest.ts`), the CLI's upgrade write
(P5's preservation), and the server's `isContentEdit` (`update.ts:186`). A drift test fails when a
key is added on one side only (TEST-1091, TEST-1092). **The two key classes stay distinguishable**:
a stamped key is one the server writes, a presentation key is one about how a document is shown,
and a future reader needs to know which list a key is on and why. Contract shape:

```ts
// packages/contract — names illustrative, the declaration is not
export const SERVER_STAMPED_KEYS: ReadonlySet<string>;   // "updated", …
export const PRESENTATION_KEYS: ReadonlySet<string>;     // "width", …
export const UPGRADE_IGNORED_KEYS: ReadonlySet<string>;  // the union the comparison uses
```

**S2 — CLI-081's keep-marks compose with CLI-082's merge verb.** A kept file is invisible to the
conflict report and fully visible to `merge` (TEST-1115). Merging does not clear the mark
(TEST-1116). The two verbs are separate acts on the same per-path state, and whichever module owns
that state exports one reader both use — not two lookups that can disagree.

**S3 — CLI-081's baseline advance and CLI-083's comparison meet in `nextManifestFiles`.** Keeping
advances the baseline; ignoring keys may change what a baseline **is** (P4's normalized sha). One
agent owns both, or the second one to land re-reads the first's manifest shape before writing.
If the manifest gains a version 2, `readTemplateManifest`'s `isManifest` guard
(`manifest.ts:76`) must accept both versions — a workspace on the old manifest is a normal state,
not an error, and rejecting it breaks upgrade in exactly the workspaces it protects.

**S4 — SERVER-165's engagement reaches AGENT-070's skill text.** AGENT-070 cannot start until
SERVER-165's behaviour is real, because TEST-1138 is an E2E against it. The rider's exact text is
what both must match — the skills quote the behaviour, and a skill that describes behaviour the
server does not have is the defect AGENT-070 exists to fix.

**S5 — SERVER-165 and rehearsal scenario 10's seeding.** See Open Question O1. Whatever SERVER-165
answers, scenario 10's seed asserts `thread.eventId !== null` on create
(`10-a-listener-answers-twice.ts:81`) and its follow-up already omits `requestsAgent`. A change to
the seed that breaks that assertion breaks the scenario, so the seed changes only if O1 says the
creating turn now enqueues without the flag.

**S6 — SERVER-165 and SERVER-163 share two files.** P7. One agent, sequenced, 165 first.

**S7 — INFRA-037 and INFRA-035 both run rehearsal passes.** Single-holder. They serialize against
each other and against AGENT-064's reproduction. INFRA-037 lands first: a boundary that blames the
product makes INFRA-035's new distribution unreadable.

---

## Open questions the implementers must answer, not guess

**O1 — does designation-engages make the *creating* turn enqueue?** §8's engagement rule reads
_"every **later** turn in a thread where the agent is `engaged`"_. The first message is posted with
the thread, not later than it. So a plainly created thread may designate, engage, and still not
enqueue its own first turn — in which case `--requests-agent true` stays necessary on scenario 10's
create, and SERVER-165's sixth acceptance criterion is unsatisfiable as written. **SERVER-165
answers this in its issue log, with the ordering of the designation write and the turn enqueue
stated explicitly.** If the answer is "the creating turn does not enqueue", the orchestrator strikes
that criterion rather than letting an agent invent a behaviour to satisfy it.

**O2 — what does CLI-083's comparison do when upstream changed the file and only ignored keys
changed locally?** P4. The honest answer is `keep-modified` for legacy manifests and a correct
answer for manifests written after the fix. The implementer records which, and the report says so
rather than pretending the case does not exist.

**O3 — what shape does the keep-mark take?** CLI-081 leaves it open: `corpus workspace keep <path>`
plus `unkeep`, or flags on an existing verb. Decide, record, and make the verb list kept files
(TEST-1104). Storage lives in the manifest or beside it — either is acceptable, and the choice is
recorded with its reasoning.

---

## Escalations — for the orchestrator, before spawning

**E1 — the contract touch nobody owns.** S1 requires a declaration in `packages/contract`, and no
issue in this batch is a CONTRACT issue. Options: file a small CONTRACT issue and let contract-dev
land it first (cleanest, costs one sequencing step), or let cli-dev add the export as part of
CLI-083 and have the pr-reviewer check the direction. **Recommendation: file it.** The repository's
own rule is that a change spanning contract plus one consumer is two issues with a dependency.

**E2 — UI-189's domain.** P1. It is filed `ui` and is a `cli` change. Recommendation: implement it
with cli-dev alongside CLI-083, and correct the domain label in the issue file for the record.

**E3 — SERVER-165's sixth criterion may be unsatisfiable.** O1. Decide after the answer, not before.

**E4 — SERVER-106 produces an unsigned rider.** It goes to the user at the next release proposal,
quoted in full. It does not go into SPEC.md this sprint.

---

## Spawn order — three at a time, at most

| Wave | Agents | Issues |
| --- | --- | --- |
| 0 | contract-dev | the E1 declaration (small, blocking S1) |
| 1 | cli-dev · server-dev · infra-dev | CLI-083 + UI-189 · SERVER-165 → SERVER-163 · INFRA-037 |
| 2 | cli-dev · agent-runtime-dev · infra-dev | CLI-081 → CLI-082 · AGENT-070 (after S4) · INFRA-035 |
| 3 | cli-dev · server-dev · agent-runtime-dev | CLI-084 · SERVER-101 + SERVER-106 · AGENT-064 |
| 4 | server-dev | SERVER-150 (last — it re-measures a tree everything else has changed) |

SERVER-150 runs last on purpose: it sets budgets from measurements, and a measurement taken before
the batch's other server changes land is a measurement of a tree that no longer exists.

---

## Done Criteria

This sprint is complete when:

- Every acceptance test above PASSES in the evaluator's verdict, or is struck by an orchestrator
  ruling recorded in this file
- Every issue's E2E Verification Log is filled with concrete evidence and states the model it ran on
- The three "reproduce first" issues — CLI-084, AGENT-064, and INFRA-037's boundary — carry a
  pre-fix reproduction log, per SDLC step 1
- Every decision this contract requires in writing is written: UI-189's rejected direction, CLI-081's
  verb shape and mark storage, CLI-082's exit codes, CLI-083's ignored-key list and the O2 fallback,
  CLI-084's direction, SERVER-163's event decision, SERVER-101's recorded answer, SERVER-106's audit
  and rider, INFRA-035's shape and cost, SERVER-150's three diagnoses
- `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` all pass at the orchestrator's
  harvest gate — the single repo-wide run
- `docs/cli.md` regenerates with no leftover diff
- `CI / validate` is green on the phase PR's head, and the pr-reviewer's verdict is APPROVE
