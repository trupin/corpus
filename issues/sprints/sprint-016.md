# Sprint 016 — Phase 5 wave 2: the signed spec becomes behavior (delegation, genesis, deferral, board UX, item comments)

**Issues**: AGENT-007 (stage A) · AGENT-005, AGENT-006 (stage B) · UI-017, UI-018, UI-019 (stage C) · PLUGINS-003 (stage D)
**Domains**: agent-runtime, ui, plugins
**Branch**: `phase-5-followups`
**Date**: 2026-07-30
**Test numbering**: continues the ladder from sprint-015's `TEST-372`; this sprint runs `TEST-373`–`TEST-474`.

---

## What makes this wave different from wave 1

Sprint-015 shipped capabilities that SPEC.md described as pending. **SHARED-004 is now `done`, signed
off by the user on 2026-07-30, and every amendment is applied to `SPEC.md` on this branch.** So for
the first time in this phase, the spec is ahead of the code in exactly the seven places this batch
closes, and every issue in this batch has a **signed, applied** sentence to implement rather than a
draft to interpret. The consequence for every agent: **`git diff SPEC.md` must be empty at the end of
your session.** The text you are implementing is already there; there is nothing to add to it, and
anything you think is missing from it is an escalation, not an edit (TEST-465).

Three of the seven are **product** issues, not dev-harness issues — see the next section, because
getting that wrong invalidates the work.

---

## Product agent vs. dev harness — binding, and the most likely way to get AGENT-005 wrong

AGENT-005, AGENT-006 and AGENT-007 change files under `assets/workspace/`. Those files are **product
code**: they are what `corpus init` copies into an end user's workspace, and they instruct **the
user's** Claude Code agent — the one the operator starts by running `claude` in their own workspace
and invoking `/orchestrate`. They are not, in any sense, instructions to the agents building Corpus.

| | The product agent (`assets/workspace/claude/skills/…`) | This repo's dev harness (`.claude/agents/…`, `CLAUDE.md`) |
| --- | --- | --- |
| Who reads it | the end user's agent, in the user's workspace | the agents building Corpus, in this repo |
| Concurrency bound | **10 concurrent subagents** (SPEC §7, signed 2026-07-30) | **~3 concurrent implementation agents** (CLAUDE.md, user directive 2026-07-27) |
| Where the bound comes from | the spec's delegation contract | this laptop's measured limits |
| Who may change it | AGENT-005, per the signed §7 | the user, via CLAUDE.md |

**These two numbers are unrelated and neither constrains the other.** The machine-load discipline in
the next section binds *you*, the implementing agent, while you work in this repo. **N = 10** is what
the product skill you are writing must state. An agent that writes "3" into
`assets/workspace/claude/skills/orchestrate/SKILL.md` because this laptop can only run 3 agents has
shipped a spec violation into the product (TEST-378); an agent that spawns 10 concurrent subagents in
this repo because the skill it is writing says 10 has crashed the user's laptop. Keep the distinction
explicit **in the skill text itself** — AGENT-005's issue file asks for exactly that, and it is the
one sentence a future reader needs most.

The same split applies to model policy. The **skill's** model-tier table names real Claude models
(**Opus 5 is in the mix**, per sign-off item 1) chosen by *task weight*; this repo's Model policy in
CLAUDE.md is a separate document with separate numbers, and neither is a source for the other.

---

## Machine rules — binding on every agent in this batch

### Ports

Verified free at contract time (2026-07-30): `lsof -nP -iTCP:9180-9199 -sTCP:LISTEN` shows **nothing
bound**, and `lsof -nP -iTCP:8765 -sTCP:LISTEN` shows **nothing** — leave it that way.

| Consumer             | Server range  | Primary | Vite dev port |
| -------------------- | ------------- | ------- | ------------- |
| AGENT-007            | `9185`–`9186` | `9185`  | —             |
| AGENT-005            | `9180`–`9182` | `9181`  | —             |
| AGENT-006            | `9183`–`9184` | `9183`  | —             |
| UI-017               | `9187`–`9188` | `9187`  | `5290`        |
| UI-018               | `9189`–`9190` | `9189`  | `5291`        |
| UI-019               | `9191`–`9192` | `9191`  | `5292`        |
| PLUGINS-003          | `9193`–`9195` | `9193`  | `5293`        |
| sprint-016 evaluator | `9196`–`9199` | `9197`  | `5294`        |
| Automated tests, every workspace | — | `0` (ephemeral). **Never hardcode.** | — |

**`8765` is NEVER bound and NEVER killed, by anyone, for any reason.** The maintainer's personal
server lives there (user directive, 2026-07-29). The hazard is structural: `corpus init` with no
`--port` probes upward from `DEFAULT_PORT` 8765 (`apps/cli/src/commands/init/port.ts:19,51-63`), so
**every `corpus init` in this sprint passes `--port` explicitly**, including runs expected to fail.
Check `lsof -nP -iTCP:8765 -sTCP:LISTEN` before declaring done and leave whatever is there alone.

#### The Vite dev proxy points at `8765` by default — the single most dangerous line in this sprint

`apps/ui/vite.config.ts:14` is `const SERVER_ORIGIN = process.env.CORPUS_SERVER_ORIGIN ?? "http://127.0.0.1:8765";`
and `/api`, `/events` and `/attachments` are proxied to it. **A UI or plugins agent that starts
`npm run dev -w apps/ui` without setting `CORPUS_SERVER_ORIGIN` sends every request the browser
makes — creates, `PUT`s, and `DELETE /api/docs/:id` — into the maintainer's personal server on
8765.** UI-017 is an auto-*deletion* issue and UI-019 writes view-document frontmatter; either one
pointed at 8765 corrupts live user data, and no test in this repo would notice.

So, for every agent that starts a dev server:

```sh
export CORPUS_SERVER_ORIGIN="http://127.0.0.1:<your primary port>"   # BEFORE npm run dev
npm run dev -w apps/ui -- --port <your vite port> --strictPort
```

Start your own `corpus server` **first**, then the dev server, then **prove the proxy is yours** and
paste it: a request through the dev port must be answered by your server and appear in its log — e.g.
`curl -s http://127.0.0.1:<vite port>/api/health` returning your workspace's health while
`lsof -nP -iTCP:8765 -sTCP:LISTEN` stays empty. An agent that cannot show that check has not verified
anything, whatever its screenshots say.

`5173`/`5174` are held by an `ssh` process and `apps/ui/vite.config.ts` pins
`server.port: 5173, strictPort: true` without reading `CORPUS_UI_PORT`, so a bare
`npm run dev -w apps/ui` fails to start — use `-- --port <your port from the table above> --strictPort`.
`5273` is the pre-push hook's e2e port; nobody binds it. **No issue in this batch runs
`npm run e2e`** — Playwright is single-holder and starts its own Vite; the orchestrator runs it once
at harvest. Write Playwright specs, run them **scoped** at most once
(`./node_modules/.bin/playwright test <spec> --workers=1` against your own port), and never while
another agent's dev server is up.

### Scratch directories

All scratch work lives under `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp` — **never bare `/tmp`**
(an evaluator flagged a wave-1 drill that used it), and **never inside the repository**.

| Issue       | Prefix                                                                              |
| ----------- | ----------------------------------------------------------------------------------- |
| AGENT-005   | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-agent005-XXXXXX`    |
| AGENT-006   | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-agent006-XXXXXX`    |
| AGENT-007   | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-agent007-XXXXXX`    |
| UI-017      | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-ui017-XXXXXX`       |
| UI-018      | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-ui018-XXXXXX`       |
| UI-019      | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-ui019-XXXXXX`       |
| PLUGINS-003 | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-plugins003-XXXXXX`  |

Automated tests use `fs.mkdtemp`/`mkdtempSync`. **Never** glob-delete the prefix — other agents'
evidence lives there. Delete only paths you created and captured in a variable.

### Workspace creation — the subshell-cd rule still applies

CLI-013 landed, so `corpus init --workspace <path>` now honors its flag. Both forms are legal;
**prefer the subshell `cd`** anyway, because it is correct whether or not CLI-013 is present in
whatever tree your session started from, and because a mistyped `--workspace` scaffolds your cwd:

```sh
# Preferred — the subshell cd is what makes the target real
( cd "$WS" && node --import tsx "$REPO/apps/cli/src/bin/corpus.ts" init --port 9181 )

# Legal since CLI-013, but only from a cwd outside this repository
corpus init --workspace "$WS" --port 9181
```

- **Every drill runs from a cwd OUTSIDE this repository.** Not the repo root, not a worktree, not any
  subdirectory of either. `cd` to your scratch prefix first and `pwd` into the log. The 2026-07-29
  CLI-014 drill got this wrong and clobbered the repo's `README.md` and `.gitignore` irrecoverably.
- **Verify `/Users/theophanerupin/code/corpus/.corpus` is absent** at the end of your session and
  paste the check. A workspace scaffolded into the dev repo is the failure mode this rule exists for
  (TEST-469).
- From-source CLI is `node --import tsx apps/cli/src/bin/corpus.ts`, or the built
  `apps/cli/dist/bin/corpus.js` after `npm run build` — **never `npx`**.

### Process cleanup — pid-targeted only

`pkill -f main.ts`, `pkill -f tsx`, `pkill -f vite`, `pkill node`, `killall node` kill sibling agents'
servers and the maintainer's `8765` server — **forbidden.** Stop what you started, by recorded pid,
and verify with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before declaring done. This includes the Vite
dev server and any `claude` session you started for a drill.

### Tests and load

- **Scoped tests only**: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run <path>`. Never the
  repo-wide suite, never `npm test` unfiltered, never `npm run coverage` or `npm run test:coverage`,
  never `npm run e2e`. The orchestrator's harvest run is the single repo-wide gate.
- **One workspace-scoped run at the very end of your session is the maximum.**
- **Cap workers on every vitest invocation**: `VITEST_MAX_THREADS=4`.
- **One heavy command at a time** — never overlap builds, test runs, Playwright, or `npm install`.
- **Three concurrent implementation agents maximum**, and stages A and D make it fewer.
- `npm run build` before lint/typecheck/test — `@corpus/*` imports resolve through `dist/`.

### Live-session drills are the verification bar for AGENT issues

AGENT-002/003/004 established the methodology and it is not optional here: a skill change is verified
by **running a real `claude` session in a real scratch workspace against a real server**, driving the
loop through real queue events, and **pasting the transcript excerpts** into the E2E log. A skill
that "reads correctly" is not evidence — the whole artifact is instructions to a model, so the only
proof it works is a model following it. Concretely, every AGENT issue's log contains: the workspace
path, the `corpus` invocations the session actually ran (from the transcript, not from the skill),
the resulting queue/job state read back through the CLI, and `git log --format='%an %s'` in the
scratch workspace showing `agent`-authored commits. Deferred or impossible drills are recorded per
the next rule, never silently dropped.

### Deferred verification is recorded, not skipped

Any criterion below that cannot be executed is marked `STRUCK → Adjudication N`,
`STRUCK → Open Conflict N`, or `DEFERRED → <reason>` in the E2E Verification Log, **with the reason
and the substitute evidence supplied**. Silent omission is a fail. Each agent also states
`implemented on: opus | fable` per CLAUDE.md's Record-actuals rule.

---

## Acceptance Tests

### AGENT-007: the orchestrate skill teaches `corpus queue defer`, and the `deferred:` protocol is gone

**Stage A, alone, first.** `assets/workspace/claude/skills/orchestrate/SKILL.md` — the "Locks and
deferral" section (lines 143–174) — **plus** `assets/workspace/claude/skills/comment/SKILL.md`'s
deferral paragraph (lines 165–182), which teaches the same dead protocol and is in scope by
**Adjudication 8**. Text only; `scripts/workspace-template.test.ts` follows.

The issue's one open design point — whether the legacy `corpus queue fail --reason "deferred:…"` is
removed, kept as a no-op, or merely no longer taught — is **decided at contract time by
Adjudication 7: merely no longer taught.** CLI-015 left the question open and shipped `fail`
accepting any reason string; nothing validates the prefix, no caller has asked for a refusal, and a
refusal would break operator scripts still using the old form. AGENT-007 satisfies sprint-015
TEST-357's "two documented ways to defer is the outcome to avoid" by documenting exactly **one**.
The implementing agent makes **no CLI change** and adds no refusal.

Four facts from the shipped tree govern this section:

- **The verb exists.** CLI-015 is `done`: `corpus queue defer <event-id> --blocked-on <doc-id>
  [--reason <text>]` is documented at `docs/cli.md:957-1002`, so the skill is allowed to name it
  (the template test refuses commands `docs/cli.md` does not document).
- **`--blocked-on` is required and locally validated** — a missing flag is exit 2 with **no request
  sent**; naming the wrong document waits forever. Only `in-progress` work defers (409 → exit 5).
- **Re-entry is automatic on three triggers**: releasing, force-breaking **or** reaping the lock on
  `blockedOn` returns the event to `pending` and unparks a held `corpus queue idle` — CLI-015's E2E
  log shows the parked poll returning ~4 s into a 20 s window with no `job retry` and no operator.
- **Both skills currently teach the dead protocol.** Orchestrate prints
  `corpus queue fail evt_7c1d9a --reason "deferred: …"` (`:159`) and calls the prefix meaningful
  (`:162`); comment tells the user "the operator re-enters the work with `corpus job retry` from the
  console's failed-job row" (`:180-181`) and names "`deferred:` accounting" (`:179`). Fixing one and
  leaving the other is the failure mode this section exists to prevent.

TEST-373: The dead protocol is gone from the orchestrate skill
  Given: `assets/workspace/claude/skills/orchestrate/SKILL.md` after the change
  When: Searched for `deferred:` used as a reason prefix, and for `corpus queue fail` in any
  deferral context
  Then: **Neither appears.** The string `deferred:` survives nowhere as instruction, example, or
  explanation of what a prefix means. `corpus queue fail` still appears — it is a real outcome — but
  never with a `deferred:` reason and never as the way to postpone work.

TEST-374: The deferral block is the defer verb, in the right order
  Given: The rewritten "Locks and deferral" section
  When: Its bash block is read
  Then: It is `corpus thread reply …` (reply first, a person is watching a pending indicator) then
  `corpus queue defer <eventId> --blocked-on <docId> --reason "<sentence>"`. `--blocked-on` names the
  **locked document**, not the thread. The reply carries no trace line (nothing changed) and the
  section says so, as it does today.

TEST-375: `--blocked-on` is taught as load-bearing, not as ceremony
  Given: The rewritten prose
  When: Read
  Then: It states that the flag is required, that clearing **that** lock is what returns the event,
  and therefore that naming the wrong document parks the work indefinitely. An agent that reads this
  section and defers on the *thread* id has been mis-taught; the text must make that impossible to
  do by accident.

TEST-376: Automatic re-entry is stated, with all three triggers
  Given: The rewritten prose
  When: Read
  Then: It says the event returns to `pending` **by itself** when the lock on `blocked-on` is
  **released, force-broken, or reaped** — all three named — and that a parked `corpus queue idle`
  unparks on it. It does not describe the deferral as a failure, and it says `corpus queue status`
  counts it under `deferred`, not `failed`.

TEST-377: `corpus job retry` is demoted to the manual override
  Given: The rewritten prose
  When: Read
  Then: `corpus job retry` appears **only** as the by-hand escape for a deferral automatic re-entry
  did not reach (a lock cleared out of band, a deferral that named the wrong document) — never as the
  normal path and never as the operator's chore. Nothing tells the operator to retry from the
  console's failed-job row, because a deferral no longer produces a failed-job row.

TEST-378: The sample thread reply stops asking the user to do the system's job
  Given: The heredoc reply in the deferral block
  When: Read
  Then: It no longer contains "retry the job from the console when you're done editing" or any
  paraphrase. It says the work resumes on its own when the document is free. It stays short and
  stays honest about having changed nothing.

TEST-379: The terminal-state invariant absorbs the fourth outcome
  Given: Invariant 4 (`SKILL.md:43-45`, "Every claimed event reaches a terminal state — `corpus queue
  complete` or `corpus queue fail`") and the "Completing and failing" section (`:192-216`)
  When: Read after the change
  Then: They account for **defer** as the fourth, non-terminal-but-settled outcome: every claimed
  event is completed, failed, **or deferred**, and a deferred event is settled accounting (it is out
  of `in-progress/` and it comes back on its own), not an event left dangling. The restated invariant
  at `:212` ("every claimed event ends in `processed/` or `failed/`") is corrected in the same pass —
  it is false the moment defer is taught, and an internally contradictory skill is worse than an
  out-of-date one.

TEST-380: The comment skill's deferral paragraph is fixed in the same change
  Given: `assets/workspace/claude/skills/comment/SKILL.md:165-182` (Adjudication 8)
  When: Read after the change
  Then: The phrase "`deferred:` accounting" is gone; the `corpus job log … "deferred: …"` line no
  longer carries the prefix; and the sentence "The operator re-enters the work with `corpus job
  retry <eventId>` from the console's failed-job row once the lock clears" is replaced by the truth —
  the work re-enters by itself when the lock clears. "Reply *before* you defer" stays: it is still
  correct and it is the sentence that protects the pending indicator.

TEST-381: The comment skill does not gain a queue verb
  Given: `scripts/workspace-template.test.ts:323`'s pinned assertion
  `expect(commentBody).not.toMatch(/corpus queue (?:complete|fail)/)`
  When: The suite runs
  Then: It passes **unchanged**, and — the part the regex cannot enforce — the comment skill contains
  no `corpus queue defer` either. Sprint-014 Adjudication 11 keeps queue state with orchestrate; the
  comment skill **hands the event back** to the orchestrate skill, which owns the defer call.
  Widening the regex instead of keeping the verb out is the wrong fix and is a fail.

TEST-382: The template suite is green with an empty pending list
  Given: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts`
  When: Run
  Then: Green, with `CLI_COMMANDS_PENDING_CLI_006` still `[]` (`scripts/workspace-template.test.ts:1049`).
  Every `corpus …` invocation in both rewritten sections resolves against `docs/cli.md`. **No
  allowlist entry is added** — permission arrives by the verb existing, and it does.

TEST-383: The printed commands are run, against a real lock, in a live drill
  Given: A scratch workspace (prefix `s016-agent007-…`, `--port 9185`, cwd outside this repository)
  with a real server, a document, and a user-held lock acquired via `corpus lock acquire <doc>
  --from user`
  When: The exact commands the rewritten section prints are executed in order, by hand, as an agent
  would
  Then: The thread reply posts; `corpus queue defer` exits 0; `.corpus/queue/deferred/<id>.json`
  exists carrying `blockedOn` and `deferReason`; `corpus queue status` reads `deferred 1, failed 0`.
  The E2E log pastes each command and its real output.

TEST-384: The automatic return is observed, not asserted
  Given: The deferred event from TEST-383 and a parked `corpus queue idle --wait 20`
  When: `corpus lock release <doc> --from user` is run from a second shell
  Then: The parked `idle` returns **within the window**, naming the event; `corpus queue status`
  shows `pending 1, deferred 0`; the pending file on disk has **no** `blockedOn`/`deferReason`. No
  `corpus job retry` was run. Timestamps are pasted. This is the sentence the skill now makes —
  proving it is the point of the issue.

TEST-385: A live `claude` session follows the section, not just a human reading it
  Given: A real `claude` session in the scratch workspace, running `/orchestrate` against a real
  `comment.created` event whose parent document the user holds locked
  When: The session hits the `423`
  Then: Its transcript shows it replying to the thread and then calling **`corpus queue defer …
  --blocked-on <docId>`** — not `corpus queue fail`, not a retry loop against the lock, not a lock
  break. Transcript excerpt and the resulting `corpus queue status` are pasted (Machine rules →
  live-session drills). If the model instead invents a different recovery, the section is not yet
  clear enough and the issue is not done.

TEST-386: The blast radius is exactly two files plus tests, and SPEC.md is untouched
  Given: `git status --porcelain` and `git diff SPEC.md` at the end of the session
  When: Inspected
  Then: Changes are confined to the two `SKILL.md` files and whatever `scripts/workspace-template.test.ts`
  needed; **`git diff SPEC.md` is empty**. §7 still contains three residual `deferred:`-prefix
  sentences that sign-off item 7 did not replace — that is **Open Conflict 2**, routed to spec-writer,
  and it is emphatically not this agent's to fix. The agent records the residual sentences it noticed,
  by line number, in its log.

---

### AGENT-005: the product orchestrator delegates every event, bounded at 10, model-by-weight

**Stage B, after AGENT-007 lands.** `assets/workspace/claude/skills/orchestrate/SKILL.md` (+ any
subagent persona files under `assets/workspace/claude/agents/`, which today holds only a `.gitkeep`).
The largest text change in the batch, and the one with a signed spec paragraph to match sentence for
sentence: **SPEC.md §7, the "Orchestrator skill" paragraph and its four bullets (`SPEC.md:245-250`),
applied 2026-07-30.** Model: **fable** (issue file), and the E2E log states it.

The shipped skill diverges from that paragraph in five specific places, and each one is a test below:

| Shipped today | Signed §7 |
| --- | --- |
| `:97-101` routing table: the orchestrator "invokes the comment skill" itself | every event is **handed to a subagent**; the orchestrator never works a job inline |
| `:137` "may run in parallel by delegating the *work* to subagents — at most **3** at a time" | delegation is not an option for parallel cases, it is **the** path; bound is **10** |
| `:134-137` overlap defined as "sharing any touched document" | overlap is same document(s) **or otherwise conflicting touched-sets** |
| no model guidance at all | subagent model **scales with task weight**; the concrete tier table (with **Opus 5**) lives in the skill |
| `:84-88` "work the whole batch to terminal states before claiming again" | return to parking **as soon as the batch is dispatched** |

#### A. What the skill must say

TEST-387: Delegation is unconditional, and the skill says so in the loop
  Given: The rewritten skill
  When: The loop section and the routing section are read
  Then: **Every claimed event is dispatched to a subagent.** There is no inline path, no "handle it
  yourself when it is small", no exception for one-line replies. The routing table's rows name which
  *skill the subagent is given* (comment, `<plugin>`, …) rather than telling the orchestrator to
  invoke that skill itself. The sign-off (item 1a) chose delegate-everything over the draft's narrow
  inline carve-out deliberately; reintroducing a carve-out because it seems wasteful is a spec
  violation, not an optimization.

TEST-388: The orchestrator returns to parking without waiting for the batch
  Given: The loop section
  When: Read
  Then: The documented order is claim → dispatch → **`corpus queue idle`**, with settlement happening
  as subagent outcomes arrive — not claim → work → settle → idle. The shipped sentence "work the
  whole batch to terminal states before claiming again" (`:84-88`) is corrected: what must not happen
  mid-batch is a **second `claim-all`**, and the skill states that reason explicitly rather than
  keeping a rule whose stated justification no longer holds.

TEST-389: The bound is 10, and it is the product's bound
  Given: The rewritten skill
  When: Searched for the concurrency number
  Then: It reads **10** — `at most 10 concurrent subagents` — matching `SPEC.md:249` verbatim in
  substance. The number `3` does not appear as a concurrency bound anywhere in the file. The skill
  additionally states, in one sentence, that this is the **workspace agent's** bound and is unrelated
  to any limit the operator's own tooling imposes (Product-vs-harness section above; the issue file
  asks for the distinction to be explicit).

TEST-390: Overlap is generalized past "same document"
  Given: The "Concurrency and ordering" section
  When: Read
  Then: Two events overlap when their work would touch the same document(s) **or otherwise conflict
  in what they touch** — the sign-off's generalization (item 1c) — and overlapping events run
  **serially, in dispatch order**, the later dispatched only after the earlier one's outcome is
  recorded. The existing "an event whose touched set you cannot compute touches everything" rule
  survives: it is the conservative default the generalization needs.

TEST-391: The model tier table exists, is concrete, and includes Opus 5
  Given: The rewritten skill
  When: The model guidance is read
  Then: There is a **concrete tier table** mapping task weight → model: small/mechanical work to a
  smaller, faster model; larger or judgment-heavy work to a stronger one; **Opus 5 named in the mix**
  (sign-off item 1d). The table lives here and **not** in SPEC.md — the sign-off routed exact model
  names to the skill on purpose — and the skill says how the orchestrator decides which tier an event
  falls into, so the guidance is executable rather than decorative.

TEST-392: Every invariant is restated as binding on subagents
  Given: The Invariants section and the delegation section
  When: Read
  Then: All four §7 sub-invariants bind the subagent explicitly: **CLI-only** (never hand-edit
  `data/`, `.corpus/`, `.claude/`; never call the HTTP API), **locks** acquired/released around
  edits, **job-log progress lines** to the job's console feed, and the **trace line** (§6) on any turn
  whose work changed documents. `export CORPUS_FROM=agent` / `--from agent` attribution is stated as
  binding inside the subagent too — a subagent inheriting no environment is the obvious way to
  corrupt the audit trail.

TEST-393: The division of labor over queue state survives delegation
  Given: The rewritten skill
  When: Read
  Then: A subagent **never** runs `corpus queue claim-all`, `corpus queue complete`,
  `corpus queue fail`, or `corpus queue defer`. The orchestrator owns every queue transition
  (sprint-014 Adjudication 11, unchanged by delegation). The subagent **reports** an outcome; the
  orchestrator **records** it.

TEST-394: Outcomes are recorded from reports, never assumed at dispatch
  Given: The rewritten skill
  When: Read
  Then: It states that an event is completed or failed **only** from its subagent's reported outcome,
  never at dispatch time; that a subagent failure fails the event **with the subagent's reason**
  (not a generic one); and that a subagent that dies without reporting leaves its event
  `in-progress`, recovered by the loop's opening `corpus queue reap-stale`. "No path loses a job
  silently" is the property, and the text makes each of the three paths concrete.

TEST-395: A subagent's lock deferral defers — it does not fail
  Given: The rewritten skill, on top of AGENT-007's landed text
  When: The delegated-deferral path is read
  Then: The subagent reports the block, and the **orchestrator** calls
  `corpus queue defer <id> --blocked-on <docId>`. No `deferred:` prefix, no `corpus queue fail`, no
  `corpus job retry` as the normal path. §7's own parenthetical at `SPEC.md:248` still says
  "`deferred:`-prefixed failure" — it is one of the three residual sentences sign-off item 7 did not
  reach, it is **Open Conflict 2**, and by **Adjudication 9** this agent follows the shipped verb and
  AGENT-007's text rather than the stale parenthetical. The agent records that it did so.

TEST-396: The console stays honest about delegated work
  Given: The "Progress and job logs" section
  When: Read
  Then: A delegated job's log carries its **dispatch** (which subagent, which model tier, and why
  that tier), the **subagent's own progress lines** (same `corpus job log <eventId>` sink, same
  event id — a subagent's lines land on the job it was dispatched for, not on a new one), and the
  **recorded outcome**. The existing "name the object and the change; do not narrate tool calls"
  discipline is preserved and now binds the subagent's lines too.

TEST-397: The skill states how a subagent is actually spawned
  Given: The rewritten skill
  When: Read
  Then: It tells the reader concretely how to delegate in Claude Code — the mechanism, what context
  the subagent is given (the event, the thread/document ids, the skill to apply, the model tier), and
  how its report comes back. A skill that says "delegate to a subagent" without saying how is not
  executable, and the live drill (TEST-401) will expose it. If persona files under
  `assets/workspace/claude/agents/` are part of the design, they ship in this issue and are indexed
  as `type: agent-def` documents like any other (§7).

TEST-398: The wake-back mechanism is described honestly against what ships
  Given: `agent.done` is a declared core event type (`packages/contract/src/schemas/queue.ts:10`)
  with **no producer**: the only enqueue paths in the server are comment/capture
  (`apps/server/src/threads/turns.ts:236`, `apps/server/src/capture/capture.ts:219`), there is no
  `POST /api/queue` enqueue route (`packages/contract/src/routes/queue.ts` — status, idle, claim-all,
  reap-stale, halt, resume, complete, fail, defer, delete), and no CLI verb enqueues one
  When: The rewritten skill's wake-back prose is read
  Then: It describes a mechanism that **actually works today** and names no command that does not
  resolve in `docs/cli.md` (TEST-400 enforces the latter mechanically). It does **not** instruct the
  agent to emit `agent.done`. The `agent.done` **routing row** may stay — consuming an event type
  nothing yet produces is harmless — but the skill must not depend on it for correctness. This is
  **Open Conflict 1**, escalated; the agent implements the default recorded there and states in its
  log which shape it shipped.

#### B. Mechanical checks

TEST-399: `git diff SPEC.md` is empty
  Given: The end of the session
  When: Inspected
  Then: Empty. §7 already says everything this issue implements; the gap is in the skill, not the
  spec. Anything §7 appears to be missing is Open Conflict 1 or 2, both already routed.

TEST-400: The template suite is green with an empty pending list
  Given: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts`
  When: Run
  Then: Green, `CLI_COMMANDS_PENDING_CLI_006` still `[]`, no allowlist entry added. Every `corpus …`
  invocation the rewrite introduces resolves against `docs/cli.md`. This is the mechanical guard
  against inventing a delegation verb that does not exist.

#### C. Live drills — the acceptance bar

TEST-401: Two independent jobs are worked concurrently, in a real session
  Given: A scratch workspace (prefix `s016-agent005-…`, `--port 9181`, cwd outside this repository),
  a real server, two documents with **no** overlap, and a real `claude` session running `/orchestrate`
  When: Two `comment.created` events are enqueued (via `POST /api/threads` with `requestsAgent: true`,
  the user's own path — there is no CLI verb that opens a thread, by design)
  Then: The transcript shows **both dispatched before either completes**, both worked by subagents,
  both replies posted, both events reaching `processed`. The E2E log pastes: the dispatch lines with
  their timestamps, `corpus job list --json` mid-flight showing two jobs running, and the final
  `corpus queue status`. This is the issue's own stated verification step and it is not optional.

TEST-402: The orchestrator was actually parked while they ran
  Given: The same drill
  When: The transcript between dispatch and the first completion is read
  Then: The orchestrator's own next call is `corpus queue idle` — it did not sit inside a subagent's
  work, and it did not `sleep` or poll. A third event enqueued while the first two are still running
  **unparks it and is picked up**, which is the entire point of the issue: the queue stayed open.
  Paste the timestamps that prove the third event was claimed before the first two finished.

TEST-403: Overlapping work serialized itself
  Given: Two events whose touched sets share a document (two threads on the same parent), enqueued
  together
  When: The batch is dispatched
  Then: The transcript shows the second dispatched **only after** the first's outcome was recorded,
  and the second subagent's reply reflects the first's edit. Two subagents editing the same document
  concurrently — or a `423`/lock-contention storm between two of the agent's own subagents — is a
  **fail** of this test, not a tolerable race.

TEST-404: A delegated lock deferral defers, live
  Given: A user-held lock (`corpus lock acquire <doc> --from user`) and an event whose work needs
  that document
  When: The dispatched subagent hits the `423`
  Then: The subagent reports the block and does **not** call any queue verb; the orchestrator replies
  to the thread and calls `corpus queue defer <id> --blocked-on <docId>`; `corpus queue status` reads
  `deferred 1, failed 0`; releasing the lock returns it to `pending` with no operator action, and the
  loop picks it up and finishes. Transcript plus CLI output pasted.

TEST-405: The audit trail is intact and CLI-only, from inside subagents
  Given: The scratch workspace after the drills
  When: `git log --format='%an %s'` and `git status --porcelain` are run **in the scratch workspace**
  Then: Every mutation is a commit authored by `agent`; the working tree is clean (no hand-edited
  files); the job logs under `.corpus/jobs/` carry the subagents' progress lines under the dispatching
  event's id; and every agent turn that changed documents ends with a `↳ ` trace line. A subagent
  that wrote a file directly, or replied without the trace line, fails this test — those invariants
  binding across the delegation boundary is the substance of §7's first bullet.

TEST-406: The model actually used is recorded, for both layers
  Given: The E2E Verification Log
  When: Read
  Then: It states `implemented on: fable` (this issue's recommendation) for the implementing agent,
  **and** separately records which model tiers the drilled `/orchestrate` session chose for its
  subagents and whether those choices matched the table the skill now ships. The second half is the
  only evidence that the tier guidance is usable rather than aspirational.

---

### AGENT-006: the comment skill creates skills instead of proposing them

**Stage B, parallel with AGENT-005** — disjoint files (comment skill vs. orchestrate skill), one
shared test file (`scripts/workspace-template.test.ts`, reconciled per TEST-472). Scope:
`assets/workspace/claude/skills/comment/SKILL.md`, the **Skill genesis** section only (lines 312–345;
the "Where it goes" second bullet is the false one). Model: **opus**.

Two shipped facts govern it. **`corpus skill create <name> --description "<one line>" --from agent`
exists** (CLI-011, `done`; documented in `docs/cli.md`), writing `.claude/skills/<name>/SKILL.md`
through the server's ordinary mutation pipeline — auto-commit, projection, live without a restart.
And **§7's genesis clause has already been flattened**: `SPEC.md:277` now reads "…and **creates a
genuinely new skill directly** (`corpus skill create`), announcing what it codified — and why — in
its reply." The spec is ahead of the skill; this issue closes the gap and touches no spec text.

TEST-407: The propose bullet becomes a create bullet
  Given: The **Where it goes** list after the change
  When: Read
  Then: The second bullet names `corpus skill create <name> --description "<one line>" --from agent`
  with a heredoc body, as the thing to do when nothing installed fits. "Propose it as a note in the
  inbox" is gone as the primary path — not kept beside the new verb as an alternative, which would
  leave two documented ways to do one thing.

TEST-408: The false rationale is deleted, not left standing
  Given: The sentence "Documents are created under `data/docs/` and nowhere else: `corpus doc create`
  cannot write into `.claude/`, and `corpus doc move` cannot move a document there."
  When: The rewritten section is read
  Then: It is **gone**. Both halves remain true of `corpus doc …` and both are now beside the point;
  a rationale that argues for a behavior the text no longer prescribes is worse than no rationale,
  because the next reader will believe the argument and not the instruction.

TEST-409: Extend-first is still the default
  Given: The rewritten section
  When: Read
  Then: The first bullet still says: a pattern belonging to an installed skill is an **edit** to that
  skill (`corpus doc edit <skillDocId> --from agent`), including an edit to the comment skill itself.
  Creation is for the case where nothing fits. Sprint-014's TEST-189 and TEST-210 are superseded only
  in **which verb the creation branch names**, never in the ordering rule.

TEST-410: The conflict rule survives in force
  Given: "A correction that contradicts an existing skill is an **edit to that skill**, never a second
  skill saying the opposite."
  When: The rewritten section is read
  Then: It is still there, still unambiguous. Now that creating is cheap, this is the rule that stops
  the agent from routing around a skill it disagrees with — it matters *more* after this change than
  before, and weakening it while making creation easier is the failure this test exists to catch.

TEST-411: The section says what the server owns, so the skill does not re-implement it
  Given: The rewritten section
  When: Read
  Then: It states: the name is lowercase letters, digits and single hyphens, at most 64 characters
  (`400` otherwise); an installed **or archived** name is a `409`; `--description` is **required**
  because Claude Code discovers a skill by `name` + `description`; and both frontmatter vocabularies
  (Claude Code's `name`/`description`, Corpus's `id`/`type`/`title`/`tags`/`status`) are written by
  the server, so a later `corpus doc edit` must keep them intact. Validation logic is not restated as
  something the agent should pre-check — it is stated as what will come back if it gets it wrong.

TEST-412: The archived-name collision names the right recovery
  Given: A name colliding with an **archived** skill
  When: The rewritten section is read
  Then: It says the `409` means unarchive it, not create it again under a different name. "Create it
  again" is the wrong recovery and the obvious one to reach for.

TEST-413: The ways back are named
  Given: The rewritten section
  When: Read
  Then: `corpus skill rollback <name>` is named as the way back from a bad genesis, and
  `corpus doc archive` as the way to disable a skill that stopped earning its place — consistent with
  the orchestrate skill's operator-recovery section, which already documents both.

TEST-414: Announcement and next-run semantics survive
  Given: The paragraph after the list
  When: Read
  Then: The skill still says: announce the codification in the reply, naming the skill, and state
  that a skill change takes effect on the **next** run of the loop, not the running session. Direct
  creation makes announcing more important, not less — it is now a real, immediate write to
  `.claude/`.

TEST-415: The pinned assertions still hold and the pending list is empty
  Given: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts`
  When: Run
  Then: Green; `CLI_COMMANDS_PENDING_CLI_006` still `[]` (no allowlist entry — CLI-011 put both verbs
  in `docs/cli.md`, which is what grants permission); and
  `scripts/workspace-template.test.ts:323`'s `expect(commentBody).not.toMatch(/corpus queue
  (?:complete|fail)/)` passes untouched (sprint-014 Adjudication 11 — queue terminal state stays with
  orchestrate).

TEST-416: A live session creates a skill, through the CLI, attributed to the agent
  Given: A scratch workspace (prefix `s016-agent006-…`, `--port 9183`, cwd outside this repository)
  and a real `claude` session working a thread that establishes a recurring pattern no installed
  skill covers
  When: The session follows the rewritten genesis section
  Then: The transcript shows it running `corpus skill create …` (not `corpus doc create` into the
  inbox); `corpus doc list --type skill` shows the new skill; `.claude/skills/<name>/SKILL.md` exists
  with **both** frontmatter vocabularies; `git log --format='%an %s'` in the scratch workspace shows
  the commit authored by **`agent`**; and the reply announces what was codified and why. The
  extend-first branch is drilled too: a second pattern that *does* fit an installed skill produces a
  `corpus doc edit`, not a second skill (TEST-409's rule, observed rather than read).

---

### UI-017: an empty untitled document never survives being left

**Stage C.** `apps/ui` — the create flow and the reader/editor exit paths. Model: **opus**.

The signed rule (`SPEC.md:383`, sign-off item 2, the user's own words): *"if any doc is left empty, it
is automatically deleted on exiting the doc. empty means: no title and no content. This means it
works if I start typing but then change my mind, remove what I was typing and leave."*

**The mechanism is deliberately out of spec.** Defer-creation and create-then-delete are both
allowed; the sign-off dropped the mechanism question and the draft's "no commits in git history"
claim with it. **Every test below is written against the observable rule only** — nothing here
asserts a `POST` that did not happen or a `DELETE` that did. An implementation that never creates the
document and one that creates and removes it both pass, and both are correct (**Adjudication 12**).

Four shipped facts the implementer must not rediscover the hard way:

- **Column-`＋` creation already supplies a title**: `UNTITLED_DOCUMENT_TITLE = "Untitled"`
  (`apps/ui/src/board/useCreateInColumn.ts:21`) is the default when no title is given (`:72`). By
  **Adjudication 16** the placeholder **is not a title** for this rule. The omnibox path
  (`SearchOverlay.tsx:92-115`) supplies the user's real query as the title and therefore creates a
  document that persists.
- **No blank/new document state exists today** — `apps/ui/src/reader/useReaderDoc.ts` returns the
  same shape for every document, and `selectTitle` is a one-shot transient prop, not a state.
- **Switching the active column does not close a reader.** Readers are per-column state
  (`useBoardLocalState.ts`, `Reader.tsx:13-21`), so "switching away" in the spec's plain-English list
  is covered by **Adjudication 17** below rather than by a column switch.
- **Autosave already owns the exit seam**: `useAutosave.ts:360-368` flushes on unmount, `:351` on
  `pagehide`, `:329-330` on `visibilitychange`, with `AUTOSAVE_DEBOUNCE_MS = 700` and an in-flight
  `PUT` guard. Whatever removes the document has to cooperate with that flush, not race it
  (TEST-424).

#### A. The rule

TEST-417: A blank document created from a column's ＋ and left leaves nothing
  Given: A running app (own server on `9187`, dev server on `5290` with `CORPUS_SERVER_ORIGIN` set),
  a column, and a document created with `＋` and not touched
  When: The reader is closed (Back / `esc`)
  Then: **Nothing remains**: no row in that column or any other, no hit in search (including with the
  "include archived" chip lifted — this is not an archive), no file under `data/docs/`, no thread, no
  lock under `.corpus/locks/`, and `corpus db doctor` reports a clean projection. Every one of those
  six checks is run and pasted; "the row disappeared from the board" is not evidence, because an
  optimistic list refresh can hide a file that is still on disk.

TEST-418: Typed, then erased, then left — still nothing
  Given: The same flow, but the user types a title and some body text and then deletes all of it
  When: The reader is closed
  Then: Same six checks, same result. This is the sentence the user wrote the rule for; **history
  does not matter**, only the state at exit. An implementation that only defers creation and never
  removes an already-created blank fails exactly here, and this is the test that catches it.

TEST-419: A title alone persists; a body alone persists
  Given: Two new documents — one given only a title, one given only body text
  When: Each is left
  Then: **Both persist**, exactly as any document does today: on the board, in search, on disk, with
  their content intact. "Empty" is the conjunction — no title **and** no content — and an
  implementation that treats either alone as empty destroys user work. Both cases are drilled
  separately; a single combined check does not distinguish them.

TEST-420: Whitespace is not content
  Given: A new document containing only spaces, newlines, or an empty heading marker the editor left
  behind
  When: It is left
  Then: It is treated as empty and does not survive. The editor serializes to markdown, so the
  emptiness test is against the **serialized body** the `PUT` would send, not against ProseMirror's
  internal document (which is never truly empty).

TEST-421: The "Untitled" placeholder is not a title
  Given: A document created through `＋`, whose title is the shipped `UNTITLED_DOCUMENT_TITLE`
  placeholder, with no body
  When: It is left untouched
  Then: It does not survive (Adjudication 16). A user who types nothing has not titled anything, and
  a rule that counted the placeholder would make the ＋ path exempt from the whole issue — which is
  the exact annoyance the user filed.

TEST-422: The omnibox create path is unaffected
  Given: `Create "quarterly planning"` from the search overlay
  When: The document opens and is left immediately without further typing
  Then: It **persists** — the user supplied that title, and the create row is how they said it.
  Capture and Ask are likewise unaffected: both always carry content at creation (`POST /api/capture`,
  `useCapture.ts`), and this issue must not change either.

#### B. Every exit route

TEST-423: All five exit routes are covered
  Given: A blank new document
  When: It is left by each route in turn — (1) Back / nav-stack pop (`useNavStack.back()`), (2)
  `esc`/`⌫` close (`useEscapeStack`, `Reader.tsx:76-85`), (3) ⇧-Back / `⇧esc` to list
  (`useNavStack.toList()`), (4) opening a different document into the same reader, (5) **closing the
  browser tab or reloading**
  Then: Nothing remains, in all five. Route 5 is the one that is easy to skip and the one the user
  will hit; it rides `pagehide` (`useAutosave.ts:351`), it is drilled for real (close the tab, then
  read the disk from the shell), and `beforeunload` must **not** grow a confirmation dialog for this
  path — an automatic rule that prompts is not automatic.

TEST-424: Focus mode and the column reader behave identically
  Given: A blank document open in focus mode (`f` / ⇧↵)
  When: Focus mode is exited by every route it offers
  Then: Same result as the column reader. `DocView` is one component with two hosts
  (`DocView.tsx:18-29`); a rule implemented in only one host is a bug, and the two hosts are drilled
  separately.

TEST-425: The pending autosave does not resurrect the document
  Given: A blank document with an autosave flush in flight or a debounce timer armed
  (`AUTOSAVE_DEBOUNCE_MS = 700`)
  When: The document is left inside that window — including the deliberate race: type a character,
  erase it, and leave within 700 ms
  Then: Nothing remains, and **no `PUT` lands after the removal**. A flush that recreates or
  re-writes a document that is being abandoned is the defect this test exists to catch; the log
  records the server's request sequence (its log, not the browser's intent) for the race case.

TEST-426: Nothing is orphaned
  Given: The abandoned blank
  When: `.corpus/locks/` and the thread projection are inspected after every route above
  Then: No lock record for the vanished id (the editor session takes one on first keystroke and
  `endEditing` releases it — `useAutosave.ts:360-368`), no thread rows pointing at it, and
  `corpus db doctor` clean. The board's Attention view shows no reason chip for a document that no
  longer exists.

TEST-427: A document that acquired a thread is no longer abandonable
  Given: A new document with no title and no body on which the user opened a whole-document thread
  When: It is left
  Then: It **persists** (Adjudication 18). A thread is content the user created about this document;
  removing the document to satisfy the emptiness rule would orphan it, which the spec's own "no
  orphaned threads" clause forbids. The safe branch is the persisting one.

TEST-428: Navigating deeper and coming back does not land on a tombstone
  Given: A blank new document from which the user follows a `[[ref]]` or a backlink (pushing the
  reader's nav stack) and then presses Back
  When: Back pops
  Then: The reader does not display an error or a missing-document state. Whichever way the
  implementer resolves this — treating the push as an exit and dropping the stack entry with the
  document, or treating the reader session as still open — the **observable** requirement is that Back
  never lands on something that no longer exists, and the chosen resolution is stated in the E2E log.

#### C. Tests, evidence, and blast radius

TEST-429: The emptiness rule is unit-tested at its seam, both branches
  Given: The new logic
  When: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/ui/src/...` (scoped) is run
  Then: There are unit tests for the emptiness predicate (empty, whitespace-only, placeholder title,
  title-only, body-only, typed-then-erased) **and** for the exit path that acts on it, including the
  in-flight-`PUT` race. Coverage does not regress and **no new per-path exemption is added to
  `scripts/coverage-config.ts`** (Adjudication 15).

TEST-430: Playwright covers what Playwright can, and the drill covers the rest
  Given: `apps/ui/playwright.config.ts:16-22` — the e2e suite runs against the Vite dev server and
  **deliberately starts no workspace server**, so no existing spec performs a real `POST /api/docs`
  round trip
  When: The issue's evidence is assembled
  Then: New/extended Playwright specs assert the **UI-observable** half (the row is gone from the
  board and from search after each exit route), run **scoped**
  (`./node_modules/.bin/playwright test <spec> --workers=1` against the agent's own Vite port, at
  most once, never `npm run e2e`), and the **disk / git / lock / projection** half comes from the
  manual real-app drill above, pasted into the E2E log (**Adjudication 19**). Neither half alone is
  acceptance; a spec asserting an absent DOM row against a backend-less dev server proves nothing
  about the corpus.

---

### UI-018: right-click opens the item's own actions

**Stage C.** `apps/ui` (+ `packages/kit` if the shared primitive belongs there). Model: **opus**.
Signed spec: `SPEC.md:395`, the "Right-click context menu" bullet, applied 2026-07-30 as an
accept-all bundle **including** the two recommendation-level clauses (⇧F10/menu-key on the keyboard
highlight; plugin-rendered surfaces out of v1).

What exists today, and what does not:

| Surface | Its actions today | Where |
| --- | --- | --- |
| document/thread row | staleness quick actions **only, and only at the stale tier** | `packages/kit/src/row/Row.tsx:190-219`, gated by `hasStaleActions(level)` |
| open reader (`⋯`) | Still current · Resolve/Reopen (threads) · Archive · **Delete…** (two-click arm) | `apps/ui/src/reader/DocMenu.tsx:127-195`, mounted only from `ReaderHead.tsx:146-156` |
| column header | Rename · Edit query · Unpin (archives, never deletes) | `apps/ui/src/board/ColumnMenu.tsx:59-67` |
| console job row | `↗ open` (disabled when `originId === null`) · Retry · Abandon, the latter two **only** when status is `failed`/`deferred` | `apps/ui/src/console/JobDetail.tsx:63-127`; `JobList.tsx` has no per-row actions |
| a shared menu primitive with esc-dismiss + arrow-nav + ↵-activate | **does not exist** | closest: `useEscapeStack.ts` (precedence), `reader/popover.ts` (positioning), kit's `AutocompleteMenu` (a listbox, host-managed escape) |
| any `contextmenu` / `F10` handling | **does not exist anywhere in `apps/ui/src`** | — |

TEST-431: Right-clicking a document row opens that row's actions
  Given: A document row on the board
  When: Right-clicked
  Then: A Corpus menu opens at the pointer, offering **exactly** the set `SPEC.md:395` enumerates for
  rows: open · open in focus · archive · delete · resolve/reopen (threads only) · the staleness quick
  actions **where they are already shown**. Each item performs the same operation as its existing
  route — the same `useRowActions` / `useSetThreadStatus` / `useDeleteDoc` calls, not a parallel
  implementation (**Adjudication 20**: the spec's enumeration is authoritative; "nothing invented"
  bars *new capabilities*, not the row menu itself, which is new by construction because rows have no
  `⋯` today).

TEST-432: The staleness actions appear only where they already appear
  Given: A fresh row (no stale tier) and a stale row
  When: Each is right-clicked
  Then: The stale row's menu carries Archive / Still current / @agent triage; the fresh row's does
  **not**. `hasStaleActions(level)` is the one gate, consulted rather than duplicated
  (`packages/kit/src/row/staleness.ts`).

TEST-433: The menu targets the item under the cursor, not the selection
  Given: Row A is the current keyboard highlight (`.row.kbd`, `useRowCursor`)
  When: Row B is right-clicked
  Then: The menu shows **row B's** actions and acts on row B. The keyboard highlight may follow or
  not — the spec is silent — but an action must never be applied to A. This is drilled with a
  destructive-shaped action (archive) so a wrong target is visible in the result.

TEST-434: Delete keeps its explicit confirmation
  Given: The Delete item in a row or reader context menu
  When: Chosen
  Then: It requires the same explicit confirm the shipped `⋯` uses (`DocMenu.tsx:162-195`'s two-click
  arm, or an equivalent), and it calls `DELETE /api/docs/:id` as the **user**. §9's "user-only,
  explicit confirm" is not relaxed because the entry point changed; a right-click that deletes a
  document in one click is a fail.

TEST-435: Column headers, the open reader, and console job rows each open their own set
  Given: Each of the three remaining surfaces
  When: Right-clicked
  Then: **Column header** → Rename · Edit query · Unpin, the `ColumnMenu` set. **Open reader** → the
  `DocMenu` set (Still current · Resolve/Reopen · Archive · Delete…). **Console job row** → that
  row's actual actions: `↗ open` (absent or disabled when `originId === null`) and Retry / Abandon
  **only for `failed`/`deferred` jobs** — a running job's menu must not offer Retry, because its
  detail header does not.

TEST-436: The native menu survives where it is the useful one
  Given: A text selection anywhere; the inside of the editor; any `<input>`/`<textarea>`/
  `contenteditable`; and empty board/page background
  When: Right-clicked
  Then: The **browser's own menu** appears, unmodified. Copy on a selection and spellcheck inside the
  editor are the concrete cases; losing either is a regression a user notices immediately.

TEST-437: Plugin-rendered surfaces are out of scope, and demonstrably so
  Given: A row rendered by a plugin `ListItem`, and the body of a plugin `View`/column (the todos
  column)
  When: Right-clicked
  Then: The **native** menu appears — no Corpus menu, no half-populated one. v1 scope per sign-off
  item 4; a plugin surface silently inheriting a core menu with core actions is the accident the
  scope decision exists to prevent.

TEST-438: The menu key and ⇧F10 open the menu on the keyboard highlight
  Given: A keyboard-highlighted row in the active column (`useRowCursor.docId` + `useActiveColumn.id`)
  When: The menu key or `⇧F10` is pressed
  Then: The same menu opens, anchored to that row, with its first item focused. Neither key has any
  handler today, so this is new wiring on the two hooks that already identify the highlight exactly.

TEST-439: The menu follows the app's menu conventions
  Given: An open context menu
  When: Driven from the keyboard
  Then: `esc` dismisses (through `useEscapeStack`'s precedence registry, so it composes correctly
  with focus mode and overlays rather than racing them), `↑`/`↓` move between items, `↵` activates,
  and focus returns to the item the menu was opened on. An outside click dismisses. The menu stays
  on screen near the pointer at viewport edges (`reader/popover.ts`'s clamping is the existing
  precedent).

TEST-440: The action lists have one source, not two
  Given: The reader's `⋯` and the reader's context menu
  When: Compared, and when an action's availability changes (a thread resolved, a document archived)
  Then: They offer the same items and reflect the change together, because both read one declaration.
  Two hand-maintained lists that agree on the day they were written is the defect this test names in
  advance — it is exactly what the issue means by "one source of actions, two presentations".

TEST-441: Every action stays reachable without a pointer
  Given: The full action set the context menu exposes
  When: Reached by keyboard only
  Then: Each remains reachable by its existing route (the `⋯` menus, the row keyboard scheme) — the
  context menu **adds no exclusive capability**, per the signed bullet. If the row menu is the only
  way to reach Archive on a row without opening it, TEST-438's keyboard opening is what satisfies
  this, and the E2E log says so explicitly.

TEST-442: `ColumnMenu`'s divergent dismissal is reconciled, not duplicated
  Given: `ColumnMenu.tsx:34-49` handles its own capture-phase mousedown and Escape rather than using
  `useEscapeStack`, while `DocMenu` registers at `Popover` priority (`DocMenu.tsx:114`)
  When: The shared primitive lands
  Then: The column header's menu and its context menu behave the same as every other menu — one
  dismissal story. Whether `ColumnMenu` is migrated onto the primitive or the primitive wraps it is
  the implementer's call; **three** dismissal implementations after this issue is a fail.

TEST-443: Where the primitive lives is decided deliberately
  Given: The primitive is new (nothing in `@corpus/kit` provides it — `AutocompleteMenu` is a
  listbox for inline autocomplete, not an action menu)
  When: It is placed
  Then: The choice is stated in the E2E log with its reason. **Default: `apps/ui`** — plugin surfaces
  are out of v1 scope, so exporting a plugin-facing menu from `@corpus/kit` now would ship public
  surface with no consumer (**Adjudication 21**). Moving it to kit when plugin surfaces are in scope
  is a later, cheap change; unshipping a kit export is not.

TEST-444: Coverage and evidence
  Given: The change
  When: Verified
  Then: Scoped vitest covers the action-list derivation, target resolution (cursor item vs. keyboard
  highlight), and native-menu passthrough decisions; a scoped Playwright spec drives real
  right-clicks on a row, a column header and the console; and the real-app drill (own server `9189`,
  Vite `5291`, `CORPUS_SERVER_ORIGIN` set) shows an action taken from the context menu actually
  changing the corpus, with the resulting `git log` line pasted. No new coverage exemption.

---

### UI-019: column width is a property of the view document

**Stage C.** `apps/ui` only. Model: **opus**. Signed spec: `SPEC.md:377`, appended to the "Columns
are pinned view documents" bullet — per-view **edge drag** (the console-height pattern), width in the
**view document's frontmatter**, synced, idle-squashed, agent-stewardable, server stays sole writer,
snap scrolling unchanged, **no settings panel**.

**The contract question is answered: no rider is needed** (**Adjudication 22**, verified at contract
time). `ExtraFrontmatterSchema` (`packages/contract/src/schemas/extra.ts:195-220`) is
`z.record(z.string().min(1), z.unknown())` rejecting only `RESERVED_FRONTMATTER_KEYS`
(`extra.ts:46-68`), and `width` is **not** among them; `extra` is present on
`UpdateDocRequestSchema` (`doc.ts:301`) as a real mutable field applied as an RFC 7386 shallow merge
(`extra.ts:102-109`); and it is carried on **every** document type, not only plugin types
(`doc.ts:88-90`) — CONTRACT-011's passthrough generalizes from "a new plugin doc type is zero
contract changes" to "a new core-UI view convention is zero contract changes". So UI-019 is a
`packages/contract` no-op and `TEST-466` binds it as one.

The shipped starting point: `.col { width: 336px }` (`apps/ui/src/board/Column.css:10-25`) with
`.col.reading { width: 560px }` (`:27-29`) applied by class in `Column.tsx:188-195` — **two hard
constants and no per-column state**. `toBoardColumn` (`apps/ui/src/board/viewDoc.ts:203`) does not
read `row.extra` today, though the docs-list row carries it.

TEST-445: A column is resized by dragging its edge
  Given: A board column
  When: Its edge is dragged
  Then: The column's width follows the pointer live and stays where it is dropped, within sane
  min/max bounds. The interaction matches the console's precedent (`useConsoleLayout.ts:167-196`):
  pointer capture on the handle, `pointermove`/`pointerup`/`pointercancel`, and a clamp recomputed
  from the current viewport rather than a stored ceiling (`clampConsoleHeight`, `:43-47`). A
  drag-in-progress does not scroll the board or start a column reorder — the header drag
  (`persistMove`) and the edge drag must not fight.

TEST-446: The width is written to the view document's frontmatter, through the server
  Given: A completed drag on a pinned view document
  When: The network and the workspace are inspected
  Then: A `PUT /api/docs/{viewDocId}` carrying `{ extra: { width: <number> } }` — the same mutation
  path `order` already uses (`useUpdateDocById`, `packages/kit/src/query/useUpdateDoc.ts:81-95`) —
  and the view document's file on disk gains the key in its frontmatter, auto-committed. No
  `localStorage`, no browser-local width: the sign-off chose frontmatter over browser-local
  explicitly ("width describes the view, not the viewer"), and the server stays the sole writer.

TEST-447: The merge does not clobber other frontmatter
  Given: A view document that already carries `pinned`, `order`, `query`, and any other `extra` keys
  When: A width write lands
  Then: All of them survive unchanged. `extra` is merged per RFC 7386 at the top level
  (`extra.ts:102-109`), so a width write replaces only `width` — and the test proves it rather than
  assuming it, because sending the whole `extra` object instead of the one key is the easy way to
  destroy a plugin's data.

TEST-448: One drag is one `PUT` and one commit
  Given: A drag that moves the pointer many times
  When: It completes
  Then: The corpus sees **one** write (the drag flushes on `pointerup`, or on a short debounce — not
  per `pointermove`), and `git log` shows **one** commit for it. The 30-second idle squash
  (`apps/server/src/git/commit.ts:42`, `SQUASH_IDLE_MS`, keyed per doc **and** actor) folds successive
  adjustments to the same view document into one entry — the drill drags a column three times in
  under 30 s and pastes `git log --oneline` showing that history stayed meaningful, which is the
  spec's stated requirement ("one history entry, not fifty").

TEST-449: The width persists across reload and syncs across browsers
  Given: A resized column
  When: The page is reloaded, and when a second browser (or a second tab) is opened on the same
  workspace
  Then: The chosen width is there in both — read from the view document (`toBoardColumn` now consults
  `row.extra`), not from browser storage. The SSE invalidation path makes the second view update
  without a manual reload; if it does not, that is a finding to record, not to paper over with a
  refetch interval.

TEST-450: Reader-open widening is relative to the chosen width
  Given: A column resized wider (or narrower) than the 336 px default
  When: A document is opened in it
  Then: It widens **relative to its chosen base**, not to a fixed 560 px. `.col.reading`'s hard
  constant (`Column.css:27-29`) is replaced by something computed from the column's own width; a
  narrow custom column that jumps to 560 px on open, or a wide one that *shrinks*, is the specific
  regression this test catches.

TEST-451: Bounds are enforced and degradation is sane
  Given: A drag past both extremes, and a narrow browser window
  When: Observed
  Then: The width clamps to sane min/max; a column can never be dragged to unusability or past the
  viewport; snap scrolling still snaps to column boundaries; and the board still shows as many
  columns as fit at their chosen widths, horizontally scrolling as before. Existing responsive
  behavior is preserved — the spec says narrow-window behavior is **unchanged**.

TEST-452: A stored width that is nonsense does not break the board
  Given: A view document whose `extra.width` is a string, a negative number, or absurdly large
  (hand-edited or written by the agent — `extra` is `z.unknown()` and the server never interprets it)
  When: The board renders
  Then: It falls back to the default width and renders normally. The server validates nothing here by
  design, so the UI is the only place this can be caught, and an unhandled value must not blank the
  board.

TEST-453: Plugin columns honor the same mechanism
  Given: A plugin-provided column (the todos column)
  When: Resized
  Then: It behaves identically — it is a pinned view document like any other. Nothing in the width
  path may be conditioned on the column being a core type.

TEST-454: No settings panel appears
  Given: The shipped UI after this change
  When: Inspected
  Then: There is **no** settings surface, no global width preference, no gear icon. The sign-off
  approved the draft "as drafted", and the draft's last sentence is "There is no settings panel —
  width is a property of each view, adjusted in place."

TEST-455: The agent-stewardable claim is checked, and its gap recorded if there is one
  Given: `SPEC.md:377`'s promise that "@agent make the finance column wider" just works
  When: The agent path is attempted from the CLI against the drill workspace
  Then: Either it works and the log shows the command and the resulting width, **or** the log records
  precisely what is missing (e.g. no CLI verb writes an arbitrary `extra` key on a document) as a
  **finding for a follow-up issue**. Making that work is explicitly **not** in UI-019's scope — the
  issue is `apps/ui` — but the spec sentence is signed, so the gap gets filed rather than discovered
  by a user (**Adjudication 23**).

---

### PLUGINS-003: item-level anchored commenting on plugin-rendered documents

**Stage D, and the only issue in this batch whose shape is not yet decided.** Model: **fable** (the
issue file: "requires a design for anchoring outside the body-range model"). Dependency UI-014 is
`done`. Read **Open Conflict 3 before starting** — it is P0 and it determines whether Part 2 below is
live or struck.

Five shipped facts, established at contract time, that the design must survive:

1. **The whole anchor stack is body-only.** Capture (`apps/ui/src/anchors/selectorFromSelection.ts:39-48`),
   resolution (`apps/server/src/anchors/resolve.ts:25-45,54-71`), reconciliation
   (`reconcile.ts:72-280`) and projection (`project-document.ts:363`) every one take
   `(body: string, selector)`. Nothing reads frontmatter as candidate text.
2. **Todo items live in frontmatter**, not the body: `extra.items` of
   `{text, done, ts, due?}` (`plugins/todos/items.ts:44-59,89-117`), pinned there by PLUGINS-002.
3. **Items have no stable id.** Identity is the array **index** plus an `expectedText`
   optimistic-concurrency guard (`items.ts:172-180`); `ts` is creation time and never changes, and the
   React key is `${ts}:${text}` (`TodoView.tsx:153`) — good enough to render, not to anchor to.
4. **An anchor whose text is not in the body is not rejected — it is silently accepted and
   immediately orphaned.** `CreateThreadRequestSchema` requires only `exact.min(1)`
   (`packages/contract/src/schemas/thread.ts:140-156`); the next read resolves it to
   `range: null, orphaned: true`. **This prunes the option set**: a design that merely gives plugin
   Views a selector-capture affordance (the issue's option 1, alone) produces threads that are
   orphaned from birth, and would *look* like it worked in a demo.
5. **A plugin `View` hosts none of the anchor layer.** `DocView.tsx:88-96` sets
   `anchorsHost = … && PluginView === null`, so chips, margin cards and highlight decorations —
   all ProseMirror-decoration-based (`anchorDecorations.ts`, `AnchoredThreads.tsx:37`) — are
   structurally absent wherever a plugin View wins. Rendering a thread **on** an item is as much of
   the problem as anchoring one.

And one guard rail that must be respected rather than deleted: `plugins/todos/imports.test.ts:104-116`
asserts that **no** file under `plugins/todos/**` mentions `TextQuoteSelector`, `resolveAnchor`, or
`selectorFromSelection` — "the plugin does not implement anchoring, threads, or highlights; if it
needs to, something is wrong". If the chosen design requires a plugin to touch any of those names,
that test changes **deliberately, with its comment rewritten to say what the new rule is** — deleting
it to reach green is a fail (Adjudication 14).

#### Part 1 — the design decision (mandatory this sprint, whatever Open Conflict 3 rules)

TEST-456: The decision is recorded, with the option set and the reason
  Given: The three candidate designs the issue names — (1) a kit-provided selection→selector
  affordance plugin Views embed, (2) an item-keyed anchor variant in the contract, (3) moving todo
  items into the body as markdown checkboxes
  When: The design is written up in the issue file
  Then: One is chosen, the other two are rejected **in writing with their costs stated**, and the
  write-up addresses each of the five facts above by name. Fact 4 in particular must be answered:
  whatever ships, an item comment must resolve — a design whose anchors are orphaned on creation is
  rejected by this test regardless of how good it looks in the UI.

TEST-457: The decision names its blast radius across domains, honestly
  Given: The chosen design
  When: Its file list is written down
  Then: It enumerates every workspace it touches and every domain that owns them —
  `packages/contract` (contract-dev), `apps/server` (server-dev), `packages/kit` + `apps/ui`
  (ui-dev), `plugins/todos` (plugins-dev) — because **plugins-dev may not edit contract, server, or
  kit** (standing rule since sprint-008; TEST-466). A design that quietly assumes it can is not a
  design, it is a domain violation waiting to happen.

TEST-458: Item identity is settled explicitly
  Given: Fact 3 — index + `expectedText`, no stable id
  When: The design is read
  Then: It states what an item comment is anchored **to** and what happens to that anchor when the
  item is renamed, reordered, checked, or deleted. "The text" inherits the existing fuzzy
  reconciliation story; "the index" breaks on reorder; a new stable id is a storage change to
  `TodoItemSchema` with a migration for existing documents. Whichever is chosen, the four lifecycle
  events are each answered.

TEST-459: The spec's transitional note is routed, not edited
  Given: `SPEC.md:404` — "each item can be commented on, anchored to that item _[TBD: PLUGINS-003 —
  anchoring on plugin-rendered content needs its own design; until it lands, whole-document
  commenting is the behavior on todo documents]_"
  When: The design lands
  Then: The implementing agent **does not touch SPEC.md** (TEST-465). Retiring the `[TBD]` — and
  amending §6/§10 if the anchor model grows a variant — is spec-writer work with user sign-off, filed
  as a rider and named in this issue's log (**Adjudication 24**). SHARED-004 item 5's own rationale
  anticipated exactly this: the TBD "costs one clause and keeps the spec honest if PLUGINS-003 slips".

TEST-460: Whole-document commenting on todo documents keeps working throughout
  Given: The v1 behavior — a todo document takes whole-document threads through the standard
  machinery, unaffected by its plugin `View`
  When: Anything from this issue lands, in any order
  Then: That still works, on every todo document, including ones created before the change. It is the
  shipped promise and the fallback if item-level anchoring is not completed.

#### Part 2 — the behavior (live only if Open Conflict 3 rules the implementation chain in; otherwise **STRUCK → Open Conflict 3**, carried to wave 3)

TEST-461: A comment can be opened on a single todo item from the plugin View
  Given: A todo document with several items, rendered by `TodoView`
  When: The user invokes the comment affordance on one item
  Then: A thread composer opens for **that** item, and posting creates a thread whose anchor
  identifies that item — through the standard thread machinery (`POST /api/threads`, the same turn
  and reply verbs), not a plugin-private thread store.

TEST-462: The anchor resolves — on creation and after a round trip
  Given: The thread from TEST-461
  When: The document is re-read through `GET /api/docs/:id` and re-projected (`corpus db doctor`)
  Then: The anchor is **resolved, not orphaned** — `range` non-null / `resolved_offset` non-NULL, per
  whatever resolution path the design introduces. This is fact 4 made into a gate: it is the single
  test that separates a working design from a demo.

TEST-463: The item's lifecycle is survived
  Given: An item carrying a comment
  When: It is checked, renamed, reordered, and (separately) deleted — through the plugin's own routes
  (`POST/PUT/DELETE /api/x/todos/:docId/items…`, atomic since PLUGINS-004)
  Then: Each outcome matches what TEST-458's design says it should be, and none of them silently
  detaches the thread without surfacing it. A deleted item's thread appears wherever orphaned threads
  already appear (the detached-threads region below the body, `AnchoredThreads.tsx:19-20`) rather
  than vanishing.

TEST-464: The comment is visible on the item, and the plugin boundary is still honest
  Given: The todo document open in its plugin `View`
  When: Rendered
  Then: The item carries a visible indication of its thread, and clicking it opens the thread —
  through whatever seam the design chose (fact 5: the plugin View hosts no ProseMirror decorations,
  so this is new surface, not reuse). `plugins/todos/imports.test.ts`'s ban is either still green or
  deliberately rewritten with its comment updated (Adjudication 14), and the `@corpus/kit` public
  surface gained only what the design said it would. Evidence: scoped vitest in the touched
  workspaces, plus a real-app drill (own server `9193`, Vite `5293`, `CORPUS_SERVER_ORIGIN` set) —
  note that `apps/ui/e2e/` has **no** todos spec today, so a new one is optional but a manual drill
  is not.

---

## Cross-Issue Tests

TEST-465: No agent edited SPEC.md
  Given: `git diff SPEC.md` across all seven issues
  When: Inspected
  Then: **Empty.** Every spec sentence this batch implements was signed off and applied on
  2026-07-30 (SHARED-004); there is nothing left to add. The three places where SPEC.md is now
  *wrong* — Open Conflict 2's residual `deferred:` sentences — are spec-writer work with user
  sign-off, routed, not patched in passing.

TEST-466: No agent amended `packages/contract` in place
  Given: `git diff packages/contract`
  When: Inspected
  Then: Empty. UI-019 was **verified** at contract time to need no contract change
  (Adjudication 22); PLUGINS-003's candidate designs that would need one are escalations
  (Open Conflict 3), not in-place edits. Standing rule since sprint-008.

TEST-467: No agent ran a state-changing git command
  Given: Every agent's transcript and the repository's reflog
  When: Audited
  Then: No `git commit`, `push`, `checkout`, `reset`, `stash`, `mv`, or `rm` by an implementing
  agent in **this repository**. (Git activity inside a scratch workspace is the *server's* own
  auto-commit and is expected — that is what TEST-405 and TEST-416 read.)

TEST-468: The repository is clean of scratch escape
  Given: `git -C /Users/theophanerupin/code/corpus status --porcelain` at the end of each session
  When: Read
  Then: Only intended source edits. No `data/`, no `.corpus/`, no `.claude/skills/` entries, no
  clobbered `README.md`/`.gitignore`, no stray coverage or Playwright output. Pasted by **every**
  agent.

TEST-469: No workspace was scaffolded into the dev repo
  Given: `ls -d /Users/theophanerupin/code/corpus/.corpus` at the end of each session
  When: Run
  Then: Absent — "No such file or directory", pasted. Every drill ran from a cwd outside this
  repository (Adjudication 5). This is the CLI-014 incident's direct check and it is not optional
  for any issue in this batch, including the ones that never run `corpus init`.

TEST-470: Ports and processes are clean, and `8765` was never touched
  Given: The end of each session
  When: `lsof -nP -iTCP:<port> -sTCP:LISTEN` is run for each allocated server port, each Vite port,
  and for `8765`
  Then: Nothing bound that the agent started (servers, dev servers, `claude` sessions); no orphaned
  vitest or Playwright workers (`ps aux | grep -E 'vitest|playwright'`); and whatever is on `8765`
  is **exactly as it was** — never bound, never killed, and — the new hazard this sprint —
  **never proxied into** (Adjudication 2).

TEST-471: The two orchestrate-skill rewrites are reconciled once, not fought over
  Given: AGENT-007 (Locks and deferral, Invariant 4, "Completing and failing") and AGENT-005 (the
  loop, routing, concurrency, model tiers, and Invariant 4 again) both edit
  `assets/workspace/claude/skills/orchestrate/SKILL.md`
  When: Both have landed
  Then: The file is internally consistent: one deferral story, one terminal-state invariant that
  includes defer, one concurrency bound (10), and no sentence left over from either rewrite that
  contradicts the other. Invariant 4 is the specific overlap. Sequencing (Adjudication 25) makes
  AGENT-005 the reconciler; reverting AGENT-007's text to reach a clean rewrite is a fail.

TEST-472: `scripts/workspace-template.test.ts` is reconciled across all three AGENT issues
  Given: Each of AGENT-005/006/007 may adjust assertions in that one file
  When: All three have landed
  Then: It reflects all three changes and is green on the merged tree, with
  `CLI_COMMANDS_PENDING_CLI_006` still `[]`, no allowlist entry added by anyone, and
  `expect(commentBody).not.toMatch(/corpus queue (?:complete|fail)/)` (`:323`) intact. Whoever lands
  second and third reconciles rather than reverts.

TEST-473: Generated artifacts still regenerate cleanly at harvest
  Given: The merged tree
  When: The orchestrator runs the generated-artifact drift checks (`docs/cli.md`, `openapi.json`)
  Then: Green. No issue in this batch changes the CLI surface or the API surface, so any drift here
  is a symptom of something nobody intended — most plausibly a UI agent's stray write or a
  regenerated file committed from a worktree.

TEST-474: The repo-wide gate passes at harvest
  Given: The merged tree
  When: The orchestrator runs the single repo-wide `npm run coverage`
  Then: Lint, format, typecheck, unit tests, e2e and the ≥90% four-metric merged gate all pass, with
  **no new per-path exemption** added to `scripts/coverage-config.ts` (Adjudication 15). This is the
  batch's only repo-wide run and the only `npm run e2e` execution.

---

## Out of Scope

- **Any SPEC.md edit**, including the three sentences that are now demonstrably wrong
  (Open Conflict 2) and §12's `[TBD: PLUGINS-003]` note (Adjudication 24). Both are spec-writer work
  with user sign-off, at the phase PR.
- **Any in-place `packages/contract` amendment.** Standing rule since sprint-008.
- **Making the CLI refuse `corpus queue fail --reason "deferred:…"`.** Adjudication 7: the legacy
  form keeps working, it is simply no longer taught anywhere. A refusal would be a CLI issue, and
  nothing in this batch needs it.
- **Producing `agent.done` events.** No enqueue route or verb exists; adding one is a
  CONTRACT + SERVER + CLI chain (Open Conflict 1), not something AGENT-005 may improvise.
- **A settings panel of any kind** (UI-019, sign-off item 3 explicitly).
- **Context menus on plugin-rendered surfaces** (UI-018, sign-off item 4 explicitly) and the
  kit-exported menu primitive that would enable them (Adjudication 21).
- **A global column-width default or a browser-local width.** Per-view frontmatter only.
- **Changing todo item storage** unless PLUGINS-003's recorded design chooses it *and* the
  orchestrator rules the chain in (Open Conflict 3).
- **A CLI verb for writing arbitrary `extra` frontmatter keys** — UI-019 records the gap
  (TEST-455, Adjudication 23) and files it; it does not fix it.
- **UI-016 (react-router v8) and SERVER-033 (@hono/node-server v2)** — deferred beyond Phase 5 per
  `issues/PLAN.md:192`.
- **Publishing to npm.** Still a user decision; the package name is still provisional.

---

## Integration Points

- **AGENT-007 → AGENT-005.** AGENT-007 establishes the deferral vocabulary (`corpus queue defer`,
  automatic re-entry, `job retry` as override) that AGENT-005's delegated-deferral path
  (TEST-395/404) restates across the subagent boundary. **Producer**: AGENT-007. **Consumer**:
  AGENT-005. Serialized by Adjudication 25.
- **CLI-015 → both AGENT issues.** `corpus queue defer <id> --blocked-on <docId> [--reason]` is
  shipped and documented (`docs/cli.md:957-1002`); `docs/cli.md` is what grants the skills permission
  to name it (`scripts/workspace-template.test.ts`). **Producer**: CLI-015 (`done`).
  **Consumers**: AGENT-005, AGENT-007.
- **CLI-011 → AGENT-006.** `corpus skill create` is shipped and documented; §7's genesis clause is
  already flattened to match (`SPEC.md:277`). **Producer**: CLI-011 (`done`). **Consumer**: AGENT-006.
- **CONTRACT-011's `extra` passthrough → UI-019.** `extra` is writable through `PUT /api/docs/:id`,
  merged per RFC 7386, unreserved for `width`, and carried on every doc type. No new surface, no
  rider. **Producer**: CONTRACT-011 (shipped). **Consumer**: UI-019.
- **`packages/kit`'s `Row` → UI-018.** Staleness quick actions and `useRowActions` live in kit
  (`Row.tsx:190-219`, `useRowActions.ts:62-165`) and are shared with `DocMenu`. A row context menu
  reads that one declaration; if UI-018 touches kit, UI-019 and UI-017 must not be mid-flight in the
  same files (Adjudication 26).
- **`useAutosave`'s exit seam → UI-017.** Unmount flush, `pagehide`, `visibilitychange` and the
  in-flight `PUT` guard (`useAutosave.ts:259-368`) are the mechanism the abandon rule has to
  cooperate with. **Producer**: UI-006/UI-013 (shipped). **Consumer**: UI-017.
- **The Vite dev proxy → every UI/plugins agent.** Default target is `127.0.0.1:8765`; every agent
  overrides `CORPUS_SERVER_ORIGIN` and proves it (Adjudication 2). **Producer**: `apps/ui/vite.config.ts:14`.
  **Consumers**: UI-017, UI-018, UI-019, PLUGINS-003, the evaluator.
- **PLUGINS-003 → contract/server/kit.** Every candidate design crosses at least one domain
  plugins-dev may not edit. **Producer**: the design decision (Part 1). **Consumers**: whichever
  riders Open Conflict 3 rules in.

---

## Open Conflicts — orchestrator decision required

### 1. `agent.done` has no producer, and §7 leans on it (**P0 for AGENT-005's shape — ESCALATED, default supplied**)

`SPEC.md:237` lists `agent.done` as a core event type ("background subagent wake-back") and
`SPEC.md:248` makes it load-bearing: "The orchestrator parks while subagents run and is woken by
their completion — the `agent.done` core event (above) exists for exactly this."

Nothing produces it. `CORE_QUEUE_EVENT_TYPES` declares it
(`packages/contract/src/schemas/queue.ts:10`) and the console can label it
(`apps/ui/src/console/consoleModel.test.ts:116`), but the server's only enqueue paths are
comment-created and capture (`apps/server/src/threads/turns.ts:236`,
`apps/server/src/capture/capture.ts:219`); `packages/contract/src/routes/queue.ts` has no enqueue
route (status, idle, claim-all, reap-stale, halt, resume, complete, fail, defer, delete); and no CLI
verb enqueues an event. The agent's own thread replies deliberately do **not** enqueue
(`apps/server/src/threads/participation.ts:71` — that would hand the agent its own reply forever).
So a subagent has **no CLI-only way** to wake a parked orchestrator, and the template test will
mechanically block AGENT-005 from naming a verb that would.

**Recommended default (proceed on this unless overruled):** AGENT-005 ships delegation **without**
depending on `agent.done`. The orchestrator dispatches, parks on `corpus queue idle`, and reconciles
subagent outcomes each time `idle` returns (on a real event or on the ~8-minute rearm), settling
each event from its subagent's report. The `agent.done` routing row stays as a consumer. The gap is
recorded as a follow-up chain — `POST /api/queue` (or a narrower `agent-done` enqueue) in
`packages/contract`, its handler in `apps/server`, a CLI verb, then an AGENT rider that teaches it —
and filed by the orchestrator. **Cost of the default**: a subagent finishing early is not settled
until the next `idle` return, so worst-case settlement latency is the rearm window. **Cost of
blocking instead**: AGENT-005 waits on a three-domain chain, and the delegation the user asked for
slips a wave for a latency property they did not ask about.

### 2. §7 still teaches the `deferred:` protocol in three places sign-off item 7 did not reach (**non-blocking, needs routing — ESCALATED**)

Sign-off item 7 replaced exactly one sentence in the locks bullet. These survive and are now false:

- `SPEC.md:248` (delegation bullet) — "a lock deferral surfaces exactly as an inline deferral would
  (a `deferred:`-prefixed failure, retryable via `corpus job retry`)".
- `SPEC.md:257` (locks bullet) — "fails the event with a `deferred:`-prefixed reason, and the work
  re-enters the queue via `corpus job retry` (from the console's failed-job row, or by the agent once
  the lock clears)" — which then sits immediately beside the newly applied sentence saying re-entry
  is automatic.
- `SPEC.md:325` (§9.2 locks) — "a deferred edit stays retryable via job retry — **automatic
  re-enqueue arrives with the planned defer state**, §7", written when SERVER-030 was unshipped.

`SPEC.md:258`'s force-unlock sentence ("the agent's deferred edit stays retryable (`corpus job
retry`)") is *not* false but reads as the primary path and should be reviewed in the same pass.

This does not block anything — Adjudication 9 tells both AGENT agents which text to follow — but it
means the spec currently contradicts itself and the shipped product. **Recommendation**: a small
spec-writer rider in the same sign-off round as PLUGINS-003's §12 retirement (Adjudication 24), at
the phase PR. No implementing agent touches it.

### 3. PLUGINS-003 cannot be built inside the `plugins` domain (**P0 — ESCALATED, default supplied**)

Every candidate design crosses a domain boundary plugins-dev may not cross:

| Design | Where the work lands | Owning domain |
| --- | --- | --- |
| (1) kit selection→selector affordance | `packages/kit`, `apps/ui` | ui-dev — **and it does not work alone** (fact 4: item text is not in the body, so its anchors orphan on creation) |
| (2) item-keyed anchor variant | `packages/contract` (selector variant) + `apps/server` (resolve/reconcile/project) + `packages/kit` (render seam) + `plugins/todos` (stable ids, migration) | contract-dev → server-dev → ui-dev → plugins-dev, in that order |
| (3) items move into the body | `plugins/todos` (storage, routes, migration) + `apps/ui`/kit (a comment affordance inside a plugin `View`) | plugins-dev + ui-dev; reverses PLUGINS-002's frontmatter decision |

Option 1 is pruned by fact 4 as a standalone answer. Options 2 and 3 are both multi-issue chains,
and the batch already carries six other issues under a three-agent cap.

**Recommended default (proceed on this unless overruled):** PLUGINS-003 runs this sprint as a
**design deliverable only** — Part 1 (TEST-456–460) is mandatory and produces the recorded decision,
the cross-domain blast radius, and the decomposition; **Part 2 (TEST-461–464) is `STRUCK → Open
Conflict 3`** and its issues are filed for wave 3. The alternative — ruling the chain in now — is
defensible if the orchestrator wants item comments inside Phase 5, but it turns a 7-issue batch into
a 10-issue one across four domains and should be a deliberate choice, not a side effect of
scheduling. Either way the design decision itself is the gating artifact and is produced now.

---

## Orchestrator Adjudications (2026-07-30)

Binding rulings. Implementing agents follow these; the evaluator evaluates with them.

### Pre-ruled at contract time

1. **`8765` is never bound and never killed, by anyone.** The maintainer's personal server lives
   there. Every `corpus init` passes `--port` explicitly, because init's default probes upward from
   8765. Carried forward from sprint-015.
2. **`CORPUS_SERVER_ORIGIN` is exported before any Vite dev server starts**, pointing at the agent's
   own port, and the proxy target is **proved** in the E2E log. New this sprint, and the highest-risk
   rule in it: the dev proxy's default target is the maintainer's live server, and two issues in this
   batch write and delete documents.
3. **Scoped tests only**, `VITEST_MAX_THREADS=4`, one workspace-scoped run per session maximum, one
   heavy command at a time; nobody runs `npm run e2e` or `npm run coverage`. Playwright, where
   needed, runs scoped with `--workers=1` against the agent's own port. The orchestrator's harvest
   run is the single repo-wide gate.
4. **All scratch lives under `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`**, one prefix per
   issue, never bare `/tmp`, never inside the repository, never glob-deleted.
5. **Every drill runs from a cwd outside this repository**, and every agent verifies
   `/Users/theophanerupin/code/corpus/.corpus` is absent before declaring done (TEST-469).
6. **No implementing agent edits SPEC.md or `packages/contract`.** Both are escalations
   (TEST-465, TEST-466).
7. **The legacy `corpus queue fail --reason "deferred:…"` is not refused, and not taught.** CLI-015
   deliberately left the question open; the shipped answer is that `fail` accepts any reason string
   (`docs/cli.md:1004-1037`) and nothing validates the prefix. Making the CLI reject it would be a new
   CLI issue with no caller asking for it, and would break any operator script that still uses the
   old form. AGENT-007 therefore satisfies sprint-015 TEST-357's "two documented ways to defer is the
   outcome to avoid" by **documenting exactly one** — the skills teach `corpus queue defer` and
   nothing mentions the prefix (TEST-373). **Decided, not escalated.**
8. **AGENT-007's scope includes the comment skill's deferral paragraph**
   (`comment/SKILL.md:165-182`), which teaches the same dead protocol — the `deferred:` prefix in a
   job-log line, "`deferred:` accounting", and the false operator-retry sentence. Fixing orchestrate
   and leaving comment behind would leave the product self-contradictory across two files a single
   agent reads in sequence. The comment skill still gains **no** queue verb (TEST-381).
9. **Where §7 and the shipped product disagree about deferral, both AGENT agents follow the shipped
   product** — `corpus queue defer`, automatic re-entry, `job retry` as manual override. §7's
   residual `deferred:` sentences are Open Conflict 2 and are not evidence that the prefix protocol
   is still current; they are leftovers of an incomplete sign-off application.
10. **The product's N = 10 and this repo's ~3-agent cap are unrelated numbers** and neither may be
    written into the other's document. See the Product-vs-harness section; TEST-389 is the check.
11. **Live `claude` session drills with pasted transcript excerpts are the acceptance bar for every
    AGENT issue** (the AGENT-002/003/004 methodology). A skill is instructions to a model; the only
    proof it works is a model following it.
12. **UI-017's mechanism is the implementer's choice.** Defer-creation and create-then-delete both
    satisfy the contract; the sign-off dropped the mechanism question and the git-history claim with
    it. Every UI-017 test asserts the observable rule only.
13. **Deleting or weakening a test to reach green is a fail, in every issue.** Deliberate inversions
    are listed in the E2E log with reasons and keep both branches covered.
14. **`plugins/todos/imports.test.ts`'s anchoring ban may be changed only deliberately** — with its
    explanatory comment rewritten to state the new rule — and never deleted to accommodate a design.
15. **No new per-path coverage exemption** in `scripts/coverage-config.ts`, in any issue.
16. **The `UNTITLED_DOCUMENT_TITLE` placeholder is not a title** for UI-017's rule. A user who typed
    nothing has titled nothing; counting the placeholder would exempt the ＋ path from the entire
    issue, which is the annoyance the user filed.
17. **"Exiting the doc" means the document stops being open in its reader** — Back, `esc`/`⌫`,
    ⇧-Back to list, another document taking over that reader — **plus tab close/reload**. Switching
    the *active column* does **not** count: readers are per-column state and the document stays open
    (`Reader.tsx:13-21`). The spec's plain-English "switching away" is satisfied by the four reader
    routes plus route 5; TEST-423 enumerates them.
18. **A document that acquired a thread is no longer abandonable** and persists, even with no title
    and no body. The alternative orphans a thread the user deliberately created, which the same spec
    sentence forbids.
19. **UI evidence is two-part**: Playwright (scoped, against the backend-less dev server) proves the
    UI-observable half; the manual real-app drill against a real workspace server proves the disk,
    git, lock and projection half. `apps/ui/playwright.config.ts:16-22` starts **no** workspace
    server, so neither half is sufficient alone.
20. **UI-018 implements `SPEC.md:395`'s enumeration as written.** "Nothing invented" forbids new
    *capabilities*, not the row menu itself — rows have no `⋯` today, and the signed bullet
    nonetheless lists archive/delete/resolve for them, reached through the same hooks the reader menu
    uses.
21. **The context-menu primitive lives in `apps/ui` by default**, not `@corpus/kit` — plugin surfaces
    are out of v1 scope, so a kit export would be public surface with no consumer. Moving it later is
    cheap; unshipping a kit export is not.
22. **UI-019 needs no contract rider.** Verified at contract time against
    `packages/contract/src/schemas/extra.ts` and `doc.ts` (see the UI-019 preamble). If the
    implementing agent finds otherwise, that is an escalation, not an in-place edit.
23. **UI-019 records the agent-stewardability gap; it does not close it.** `SPEC.md:377` promises
    "@agent make the finance column wider" works; if no CLI path writes an arbitrary `extra` key, the
    agent files the finding (TEST-455) for a follow-up issue.
24. **PLUGINS-003 does not retire §12's `[TBD]`.** That is spec-writer work with user sign-off, in
    the same round as Open Conflict 2's fixes.
25. **AGENT-007 runs alone and first; AGENT-005 and AGENT-006 follow together.** AGENT-007 and
    AGENT-005 both rewrite `orchestrate/SKILL.md` (Invariant 4 is the direct overlap) and AGENT-007
    and AGENT-006 both touch `comment/SKILL.md`. Running AGENT-007 first makes each later agent a
    reconciler of a tree that is already honest, rather than three agents racing one file. AGENT-005
    is the reconciler of record for the orchestrate skill (TEST-471).
26. **The three UI issues run in worktree isolation**, at most three concurrent implementation agents
    across the whole batch. UI-018 and UI-019 both touch the column header area; UI-017 and UI-018
    both touch the reader/`DocMenu` area; UI-018 may touch `packages/kit`'s `Row`. The orchestrator
    harvests and reconciles.
27. **UI-017's automatic deletion is the user's act and needs no confirmation dialog.** §7's
    "deletion is user-only" constrains the **agent** (`apps/server/src/docs/delete.ts:169` refuses
    `actor === "agent"`, and stays untouched); the abandon path runs as `user`, on the user's own exit
    gesture, and `SPEC.md:383` says "automatically deleted" in signed text. A prompt would make an
    automatic rule non-automatic (TEST-423).

---

## Merge order (recommendation)

1. **Stage A — AGENT-007, alone.** Retire the `deferred:` protocol from both skills. Commit as
   `[AGENT-007]` before any other agent-runtime work starts.
2. **Stage B — AGENT-005 ∥ AGENT-006** (two agents). Disjoint skill files, one shared test file
   (TEST-472). AGENT-005 reconciles the orchestrate skill on top of AGENT-007 (TEST-471). AGENT-005
   runs on **fable**; AGENT-006 on **opus**.
3. **Rule Open Conflicts 1 and 3** — Conflict 1 **before AGENT-005 starts** (it determines the shape
   of the skill's wake-back prose); Conflict 3 before PLUGINS-003 is scheduled at all.
4. **Stage C — UI-017, UI-018, UI-019**, worktree-isolated, staggered so their end-of-session test
   runs do not collide. UI-017 first if only two slots are free: it is the P1 and the one the user
   hits daily.
5. **Stage D — PLUGINS-003**, per Open Conflict 3's ruling: design-only by default, and its Part 2
   issues filed rather than built.
6. **Harvest** — the orchestrator runs the single repo-wide gate (`npm run coverage`, including the
   one `npm run e2e` execution), then `/audit` (UI-017 qualifies: P1, destructive-by-design, and it
   deletes user documents) and the evaluator.
7. **Route the spec riders** — Open Conflict 2's three sentences and §12's `[TBD]` — to spec-writer
   for one sign-off round at the phase PR.

---

## Done Criteria

This sprint is complete when:

- All non-struck acceptance tests PASS in the evaluator's verdict, with every `STRUCK`/`DEFERRED`
  criterion carrying its reason and substitute evidence
- Every AGENT issue's E2E log contains a live `claude` session transcript excerpt, not a reading of
  the skill (Adjudication 11)
- Every UI issue's E2E log contains both halves of Adjudication 19, including the proof that the dev
  proxy pointed at the agent's own server
- PLUGINS-003's design decision is recorded in its issue file with the option set, the rejections,
  and the cross-domain decomposition
- `/test` passes with no regressions and `/lint` passes
- The repo-wide coverage gate passes at harvest with no new exemptions
- `git status` is clean of scratch escape, `/Users/theophanerupin/code/corpus/.corpus` is absent, and
  `8765` is untouched and unproxied
- Every escalated Open Conflict is either ruled or explicitly carried to wave 3
