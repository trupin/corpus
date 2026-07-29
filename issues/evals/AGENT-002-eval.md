# Evaluation: AGENT-002

**Date**: 2026-07-28
**Sprint**: sprint-012 (`issues/sprints/sprint-012.md`)
**Commit under test**: `b7afd24 [AGENT-002] Orchestrate skill: the product agent's main loop`
**Verdict**: **PASS** (51/51 tests have a verdict: 49 PASS, 1 STRUCK, 1 DEFERRED)

Evaluator environment: server on `9080` (my range), scratch `/tmp/corpus-s012-eval-ws`,
CLI from source (`node --import tsx apps/cli/src/bin/corpus.ts`). Implementing agent's scratch
`/tmp/corpus-s012-agent002-UYqrmz` audited as a claimed-evidence source, never as a substitute.

---

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                              |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | 90 lines of per-test evidence plus an addendum and a cleanup section.                                                               |
| Commands are specific and concrete       | PASS   | Exact CLI invocations, event ids, job-log lines, commit shas, timestamps to the second.                                            |
| Real E2E (not mocked)                    | PASS   | Real `corpus init` workspace, real server (pid 90799), real `claude` sessions, real `POST /api/threads`, raw SSE capture.           |
| Scenarios cover acceptance criteria      | PASS   | Every TEST-1…51 addressed; the three unobserved sub-claims are **disclosed**, not omitted.                                          |
| Application restarted after changes      | PASS   | Sessions killed by recorded pid and restarted (TEST-48 addendum); server stopped at the end.                                        |
| Actual model recorded (`implemented on:`)| PASS   | "Implemented on: fable"; live session on `claude-fable-5` from its stream-json init record. Matches the issue's recommendation.     |
| Reproduction logged before fix (bugs)    | N/A    | Feature issue.                                                                                                                     |

**Disclosure quality is unusually high.** The log volunteers four things that weakened its own
claims: the console drawer and browser-SSE were not watched in a browser; the §8 pending indicator
was not visually observed; the TEST-45 lock was held via the CLI rather than the UI editor; and the
session spent ~2 minutes repairing its own harness wrapper (an Edit outside the workspace). I closed
the first of these myself (see TEST-39). None were overclaims.

---

## Honesty Audit — claims re-derived from scratch

Re-derived independently; `EXACT` means byte-identical to the quoted evidence.

| #  | Claim (log)                                                             | Re-derivation                                                        | Result          |
| -- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------- |
| 1  | Frontmatter diff is one line: `updated` advanced, `created` untouched    | `git diff b7afd24^ b7afd24`                                          | EXACT           |
| 2  | `<…>` tokens: plugin×6, name×4, action×3, id×2, type/subagent/skill/seconds/line/eventId ×1 | `grep -o '<[a-zA-Z]*>' \| uniq -c`                | EXACT (all ten) |
| 3  | Body names no dev-harness artifact                                      | greps for `SPEC.md`/`CLAUDE.md`/`issues/`/`/implement`/`/decompose`  | EXACT (all 0)   |
| 4  | Exactly one `sleep`, zero `while true`, zero timers                     | grep                                                                 | EXACT           |
| 5  | Zero hedges ("use your judgment", …)                                    | grep                                                                 | EXACT (all 0)   |
| 6  | Zero plugin names (`todos`, `_fixture`)                                 | grep                                                                 | EXACT           |
| 7  | `scripts/workspace-template.test.ts` → 61 tests green                   | `vitest run scripts/workspace-template.test.ts`                      | EXACT (61)      |
| 8  | TEST-34 fails naming `doc frobnicate`, passes on revert                 | re-ran; **plus** a fenced-block variant I added (`queue frobnicate`)  | MATCH+          |
| 9  | Scope is the whole template tree, not just skill bodies                 | inserted a bogus verb into `assets/workspace/README.md` → suite fails | CONFIRMED       |
| 10 | Allowlist = exactly `["doc check","skill rollback"]`, self-invalidating  | appended `### corpus doc check` to `docs/cli.md` → expiry test fails with "`corpus doc check` is now documented — empty CLI_COMMANDS_PENDING_CLI_006" | CONFIRMED |
| 11 | `installed 8 template files`                                            | my own `corpus init` on 9080                                         | EXACT           |
| 12 | evt_shzavv22x3nk job log, 4 lines                                       | `cat .corpus/jobs/evt_shzavv22x3nk.jsonl`                            | EXACT           |
| 13 | Commits `e2b3576` / `c417c46` authored `agent`                          | `git -C <ws> log`                                                    | EXACT           |
| 14 | Thread turn header `## agent · 2026-07-29T00:37:40Z`                    | thread file                                                          | EXACT           |
| 15 | TEST-41 claim at 00:38:22 (~6–9 s after the post)                       | `evt_dkivhrx377xf.jsonl`                                             | EXACT           |
| 16 | TEST-42 "shares doc_f4na522f with evt_73dlujsfhfoj — running serially"  | `evt_vvgp5zmac7y6.jsonl`                                             | EXACT           |
| 17 | TEST-42 duplicate "claimed" line (self-reported cosmetic defect)        | job logs show 00:42:13 **and** 00:42:19                              | EXACT (real)    |
| 18 | Final queue `{processed:10, failed:1, pending:0, inProgress:0}`         | directory listing                                                    | EXACT           |
| 19 | No event in two status directories                                      | listed all five dirs                                                 | CONFIRMED       |
| 20 | `.corpus/HALT` is 35 B                                                  | my own `corpus queue halt` → 35 B                                    | EXACT           |
| 21 | TEST-45 deferral reply text                                             | `th_gcsy66im.md`                                                     | EXACT           |
| 22 | TEST-45 `corpus job retry` re-entry                                     | job log carries `{"source":"server","line":"retry requested"}`       | EXACT           |
| 23 | TEST-46 `086bfd5 user lock: force-break on doc_vmfaen3i (was agent)`    | `git -C <ws> log`                                                    | EXACT           |
| 24 | TEST-46 no re-enqueue on break (`pending/` empty)                       | directory listing                                                    | CONFIRMED       |
| 25 | TEST-47 `evt_bogus0001` error `no installed skill named frobnicator`    | event file + job log                                                 | EXACT           |
| 26 | TEST-48 `evt_yucgcqcvkjh7` `attempts: 1`, addendum 4 log lines          | event file + job log                                                 | EXACT           |
| 27 | TEST-49 `doc_b5j6l36v` content, commit `fd35df9`, reply "Changed: …"    | doc + git log + thread                                               | EXACT           |
| 28 | TEST-50 every workspace change was a server auto-commit                 | all 37 commits match the server's message grammar; `git status` empty | CORROBORATED    |
| 29 | TEST-50 tool counts `{Bash:53, Read:10, Edit:1, Skill:1}`, transcript greps | **transcript not retained in the scratch dir**                    | EVIDENCE-ACCEPTED |
| 30 | TEST-45 transcript grep for `lock break` → 0                            | not re-derivable; **but** git log shows exactly one force-break, on a different document during TEST-46 | CORROBORATED |
| 31 | `corpus queue idle` prints `{"idle":true,"reason":"timeout"}` exit 0    | my own `corpus queue idle --wait 2`                                  | EXACT           |
| 32 | Halted: `claim-all` → `{"events":[]}`, `idle` → `reason:"halted"` exit 0| my own halt/resume cycle                                             | EXACT           |
| 33 | `CORPUS_FROM=agent` alone attributes writes to `agent`                  | `CORPUS_FROM=agent corpus doc create` → `agent doc create: …`        | CONFIRMED       |
| 34 | Skill's stated exit codes (423→5; `lock break`/`doc delete` as agent→2) | measured directly                                                    | CONFIRMED       |

**Overclaims found: none.** Two claims rest on a session transcript that was not retained
(#29, #30) — marked EVIDENCE-ACCEPTED and EVIDENCE-CORROBORATED respectively; both are
independently supported by workspace state that *would* have differed had the claim been false.

**Recommendation for the orchestrator:** future live-session issues should retain the
`--output-format stream-json` transcript in the scratch directory. It is the only artifact behind
TEST-50, the one invariant the contract itself calls "invisible in the finished artifact".

---

## Criteria Results

### The file and its frontmatter

| #  | Criterion                                    | Result | Evidence                                                                                                     |
| -- | -------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| 1  | Frontmatter shape preserved, `updated` advanced | PASS | All ten fields present; `name: orchestrate` = directory; `created` byte-identical; `updated` 2026-07-26→07-28. |
| 2  | Path stays dotless                            | PASS   | File at `assets/workspace/claude/skills/orchestrate/SKILL.md`; `find` shows only `.gitkeep` dot-prefixed.       |
| 3  | No skeleton remnants, no placeholders         | PASS   | `TODO`/`TBD`/`<fill`/`Arrives with AGENT`/`skeleton`/`placeholder` all 0; all ten `<…>` tokens enumerated and each is an argument placeholder in a documented example/row. |
| 4  | The product's voice, not the dev harness's    | PASS   | Zero hits for every named dev-harness artifact; the body addresses "the operator".                             |

### Required sections

| #  | Criterion                          | Result | Evidence                                                                                                                     |
| -- | ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 5  | All fourteen sections, substantive | PASS   | Exactly 14 `##` headings, in the contract's order. Suite asserts each body > 400 chars ("gives every section a substantive body, not a bare heading"). |
| 6  | Comment skeleton not broken        | PASS   | In the same 61-test run: `'comment' carries both frontmatter field sets`, `'comment' states the CLI-only invariant`, `'comment' carries its required section headings`, `leaves queue terminal-state handling to the orchestrate skill` — all green. |

### The loop, literally

| #  | Criterion                             | Result | Evidence                                                                                                                    |
| -- | ------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 7  | Loop appears once, literal, in order  | PASS   | Lines 54–63: `export CORPUS_FROM=agent` → `reap-stale` → `claim-all` → `complete`/`fail` → `idle` → "repeat from claim-all".   |
| 8  | `idle` is the only wait, proven       | PASS   | Invariant 5 forbids sleep/poll/busy-wait; body's only `sleep` is inside that prohibition; zero `while true`/`watch `/timers.   |
| 9  | Rearm spelled as the CLI spells it    | PASS   | Text matches my measured output exactly: exit 0, `{"idle":true,"reason":"timeout"}`, halted `reason: "halted"`, `--wait <seconds>` default 480 named as the only flag. |
| 10 | `claim-all` is one batch, claimed once| PASS   | "prints the batch as **one JSON payload**… never call `claim-all` mid-batch, because a second claim reorders work you have already sequenced." |
| 11 | Empty batch is not an error           | PASS   | "An empty batch (`{"events":[]}`) is not an error… Go straight to `corpus queue idle`." Reproduced: halted `claim-all` → `{"events":[]}`. |

### Routing

| #  | Criterion                                | Result | Evidence                                                                                                                  |
| -- | ---------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| 12 | One row per core event type, as a table  | PASS   | Five-row table: `comment.created`, `form.respond`, `agent.done`, `<plugin>.<action>`, `anything else` → `corpus queue fail <id> --reason "unknown event type: <type>"`. |
| 13 | Unknown types never guessed/silently completed | PASS | "Never guess: an event type with no row below is failed with a reason and is never silently completed."                |
| 14 | Plugin row is generic — no plugin name   | PASS   | `todos`/`_fixture` → 0. Convention stated as `<plugin>.<action>` → skill `<plugin>`. **This is the text PLUGINS-001 cites (Adjudication 1).** |
| 15 | Missing/archived plugin skill fails, naming it | PASS | "If no skill of that name is installed, or it sits in `.claude/skills-archived/`, fail the event with a reason naming the skill" + the literal command. |
| 16 | §8 structured routing honored            | PASS   | Structured `mentions`/`skills`; `@<subagent>` → `type: agent-def` persona; `/<skill>` applies a skill; "the two combine"; missing target stated in the reply; generic `@agent` → triage. |

### Concurrency and ordering

| #  | Criterion                          | Result | Evidence                                                                                                              |
| -- | ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| 17 | Touched set is computed            | PASS   | Per-type rules incl. thread id **and** parent; plus a rule for uncomputable sets ("touches everything: run it serially"). |
| 18 | Serial per document, parallel across, stated cap | PASS | "serially, in claim order — the second must see the first's effects"; parallel via subagents "at most **3** at a time". |
| 19 | A subagent never touches queue state | PASS   | "**never runs `corpus queue claim-all`, `corpus queue complete`, or `corpus queue fail`** — completing an event it does not own corrupts the queue accounting". |

### Locks and deferral

| #  | Criterion                     | Result | Evidence                                                                                                                            |
| -- | ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 20 | Deferral protocol is executable | PASS | Lines 151–159 are an ordered, literal three-command sequence (reply heredoc → `job log` → `queue fail --reason "deferred: …"`), with `corpus job retry` as re-entry. Matches **Adjudication 6(a)** exactly. I executed the whole sequence myself on 9080: 423→exit 5, fail→`failed/`, `job retry`→`pending/`. |
| 21 | The agent never forces a lock  | PASS  | "`corpus lock break` is the human's escape hatch, and the CLI refuses it from you (exit `2`)" — measured exit 2. Implicit edit locks and `corpus lock reap` for TTL'd leftovers both stated and confirmed. |
| 22 | Attribution unmissable and correct | PASS | Invariant 2 states the `user` default incl. `lock acquire`, mandates `export CORPUS_FROM=agent` **and** `--from agent`. Enumerated: `doc edit`×1 and `thread reply`×2 carry `--from agent` explicitly; queue/job verbs are covered by the stated env rule — and I confirmed `CORPUS_FROM=agent` alone really does attribute to `agent`, so the rule is not aspirational. |

### Progress, terminal states, HALT

| #  | Criterion                        | Result | Evidence                                                                                                                      |
| -- | -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 23 | Job logging with a good and a bad line | PASS | `corpus job log <eventId> "<line>"`, "the command has no flags"; good line `"edited [[doc_a1b2c3]] — updated the rate assumption to 6.4%"` vs `"working"`; explicit prohibition on narrating tool calls / streaming tokens. |
| 24 | Terminal state as an invariant   | PASS   | Invariant 4 up front, restated in "Completing and failing"; `corpus queue reap-stale` named, and "Run `corpus queue reap-stale` at every loop start". |
| 25 | Failing specified end to end     | PASS   | `--reason` "is a `--reason` flag, never a positional"; same reason mirrored to the job log; **"Reply before you fail"** for `comment.created`/`form.respond` so the pending indicator resolves. |
| 26 | HALT is a quiet loop, not an exit| PASS   | `.corpus/HALT`, empty `claim-all`, parked `idle` with `reason: "halted"`, `corpus queue halt`/`resume`; "Do not exit, do not error". All four behaviours measured on 9080. |

### Stewardship, skills-as-documents, recovery, worked example

| #  | Criterion                                    | Result | Evidence                                                                                                                    |
| -- | -------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 27 | §7 charter complete, rule by rule            | PASS   | All nine mapped: durable knowledge→documents; stale updated; obsolete archived; archive-never-delete + deletion user-only (Invariant 3); misfiled moved; near-duplicates merged; overgrown split; change stated in the occasioning reply; auto-commit traceability. |
| 28 | Decision rules, not "use your judgment"      | PASS   | All four hedge phrases → 0. Replaced by a scope rule ("do the stewardship its own documents call for… propose the sweep in a reply instead of quietly starting it") and the concrete test "if you would need it in a future thread, write it down now". |
| 29 | Skills and subagents are documents           | PASS   | Documents/indexed/commentable/edited via CLI; "An edit to **this** skill… takes effect on the **next** `/orchestrate`". |
| 30 | Operator recovery written for the human      | PASS   | Marked "*This section is for the operator, not the agent.*"; symptoms enumerated; ordered `halt` → `corpus skill rollback orchestrate` → `resume`; `corpus doc archive` → `.claude/skills-archived/` note. |
| 31 | Worked example is a real trace               | PASS   | One `comment.created` from `claim-all` to `complete` to `idle`; ids `evt_7c1d9a`, `th_4b8e2c`, `doc_a1b2c3`; no ellipsis in any command. |
| 32 | Heredoc convention holds everywhere          | PASS   | All 3 heredocs are `<<'EOF'`; zero unquoted heredocs; zero `-m "$(`. Suite asserts both.                                       |

### The CLI-command-existence test

| #  | Criterion                          | Result | Evidence                                                                                                                    |
| -- | ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 33 | Extractor exists, handles both forms | PASS | Suite carries all five required cases and two extra: `extracts a fenced multi-line heredoc invocation without its body`, `extracts an inline-code invocation`, `never extracts a prose sentence mentioning corpus`, `extracts a top-level command with no topic`, `splits compound shell lines`, `normalizes flag-only and undocumented invocations honestly`, `classifies topics and commands from the reference's headings`. |
| 34 | The test actually fails on a nonexistent command | PASS | **I made it fail twice, in both forms.** Inline: `AssertionError: claude/skills/orchestrate/SKILL.md: expected [ 'doc frobnicate' ] to deeply equal []`. Fenced block (my own addition): `expected [ 'queue frobnicate' ] to deeply equal []`. Reverted → 61 passed. |
| 35 | Scope declared, README accounted for | PASS  | Scope = every `.md` in the whole tree, proven by inserting a bogus verb into `README.md` → suite fails naming `README.md`. Allowlist is exactly Adjudication 5's two verbs and **self-invalidates**: I appended `corpus doc check` to `docs/cli.md` and the companion test failed with the removal instruction. Not silently narrowed. |
| 36 | `docs/workspace-template.md` records the coupling | PASS | §"Verified against the CLI reference": the coupling, `npm run docs:cli -w apps/cli`, the fix direction ("never the reference to match the skill"), and the allowlist. |

### The live loop

| #  | Criterion                                  | Result | Evidence                                                                                                                    |
| -- | ------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 37 | Real workspace boots                       | PASS   | Log: init on 9062, server pid 90799, `queue status` zero pending, `db rebuild`/`db doctor` clean. I reproduced the whole shape on 9080. `corpus doc check` **STRUCK → Adjudication 5** (does not exist until CLI-006); `db doctor` substituted, and the log says so. Board verified over HTTP by the agent; **I additionally loaded it in a real browser** (Playwright, Chromium) — 200, no page errors. |
| 38 | Agent-requested comment enqueues a real event | PASS | Log quotes `evt_shzavv22x3nk.json` verbatim; the file matches byte for byte. Interface honestly named as `POST /api/threads` (there is no `corpus thread create` — Adjudication 7). **I reproduced it independently**: `POST /api/threads {requestsAgent:true}` on 9080 → `evt_bpllocvmoxc5` in `pending/`. The §8 pending indicator was not visually observed by the agent (disclosed); the board's thread rows render the agent state, and no criterion turns on it. |
| 39 | A live `claude` session drives an event to terminal | PASS | All six sub-claims: `claim-all` output in the transcript; `pending/ → in-progress/ → processed/`; job log present (4 lines, EXACT); agent turn in `GET /api/threads/:id` and in the thread file; loop parked on `idle`. Two sub-claims were disclosed as unwatched — **I closed both**: (a) the raw SSE `invalidate` frame is reproduced on my own stream, and I watched a plugin column update in a real browser with no reload (see PLUGINS-001 TEST-108, same transport); (b) **job-log lines do render in the console drawer** — I opened it in Chromium and read `frobnicator.zap · failed · started 18:49 · evt_evalbogus1 · Retry · Abandon · claimed frobnicator.zap`. |
| 40 | Writes attributed to the agent             | PASS   | `e2b3576 agent <agent@corpus.local> comment: turn on th_gcsy66im by agent`; `c417c46 agent … doc edit`; turn header `## agent · 2026-07-29T00:37:40Z`. All EXACT. Workspace-wide: 21 agent / 16 user commits. |
| 41 | Parked loop wakes promptly, not on rearm   | PASS   | Post at 00:38:13; `evt_dkivhrx377xf` claimed at 00:38:22 → **9 s**, not ~8 min. Timestamp EXACT from the job log. No operator input. |
| 42 | Two events on the same document are serial | PASS   | One batch of two on parent `doc_f4na522f`. Job logs show no interleaving (evt_73d acted 00:42:31 / completed 00:42:32; evt_vvg routed 00:42:36 / acted 00:42:40 / completed 00:42:41). The loop **logged its own reasoning**: "shares doc_f4na522f with evt_73dlujsfhfoj — running serially after it". The second saw the first's effects (bananas, then rye bread; the grocery doc's final state confirms the accumulation). |
| 43 | Two events on independent documents keep accounting correct | PASS | Both claimed in one batch (00:43:25/00:43:26) across `doc_vmfaen3i` and `doc_f4na522f`. Afterwards: zero `in-progress`, no event in two directories (I listed all five), no double completion. The orchestrator handled both itself rather than fanning out — permitted, the rule is "may run in parallel". |
| 44 | HALT stops consumption, not production     | PASS   | `.corpus/HALT` created (35 B — I measured the same); event stayed in `pending/`; `claim-all` → `{"events":[]}`; `queue status` `{"halted":true,"pending":1}`; `resume` at 00:39:30 → parked `idle` returned at 00:39:34 (4 s, no session restart) and the event processed at 00:39:48. I reproduced every one of these transitions on 9080. |
| 45 | Lock deferral happens for real, nothing forced | PASS | User lock acquired; agent's `doc edit` → 423/exit 5; then the skill's exact three-command order; reason `deferred: doc_y3z2zwnv locked by user — retry when the lock clears`; `job retry` → re-claimed → doc now reads 6.5% (the file confirms it). No lock break: the only force-break in the whole workspace history is `086bfd5`, on a *different* document, during TEST-46. **Deviation disclosed**: the lock was held via `corpus lock acquire --from user` rather than the UI editor. Same server-side state, same 423; accepted. |
| 46 | Force unlock observed honestly              | PASS   | Break recorded: `086bfd5 user lock: force-break on doc_vmfaen3i (was agent) by user`. Re-enqueue: `pending/` stayed empty → **the server does not re-enqueue a deferred edit on lock break**. Recorded as a SERVER finding (SERVER-030, Adjudication 6) and *not* papered over in the skill text. This is exactly the behaviour the criterion asks for. |
| 47 | Unknown event type fails loudly             | PASS   | `evt_bogus0001` (`type: frobnicator.zap`) → `failed/` with `"error": "no installed skill named frobnicator"`; job log `claimed` → `failed:`; `corpus job list` shows it. Nothing silently completed. **I reproduced the whole path** with `evt_evalbogus1` on 9080 and confirmed the console drawer renders the failed job with Retry/Abandon. |
| 48 | `reap-stale` recovers a killed session      | PASS   | Session killed by pid 93161 mid-event; `evt_yucgcqcvkjh7` stranded in `in-progress/`; immediate `reap-stale` → `{"reaped":[]}` (15-min threshold, honestly disclosed and filed as finding 3); after the window it returned to `pending/` and a fresh `/orchestrate` drove it to `processed/`. Event file carries `"attempts": 1`. I confirmed the threshold behaviour independently. |
| 49 | Stewardship happens and leaves a trace      | PASS   | `doc_b5j6l36v` created via `corpus doc create … --from agent`; commit `fd35df9 agent doc create: User preferences … by agent`; reply ends "Changed: [[doc_b5j6l36v]] (created)." All EXACT against the workspace. |
| 50 | CLI-only invariant holds behaviourally      | PASS   | **All 37 workspace commits match the server's auto-commit message grammar** (`doc create/edit/move/archive`, `comment: …`, `lock: …`, `workspace: …`) — I checked with an inverse grep and found zero exceptions — and `git -C <ws> status --porcelain` is empty. A hand-written file would show as either a non-conforming commit or dirty state; neither exists. The agent's transcript-level tool counts (`Edit:1`, targeting the harness wrapper outside the workspace) are **EVIDENCE-ACCEPTED**: the transcript was not retained. The log also honestly records that the session *read* workspace files directly after finding no CLI read verbs — reading is not a mutation, and that gap is escalated as finding 1 (now CLI-010). |
| 51 | Loop safety proven                          | **DEFERRED → CLI-006** | `corpus skill rollback` does not exist: `corpus skill rollback orchestrate` → exit 2, `grep -c "skill rollback" docs/cli.md` → 0. Substitute evidence verified: the recovery section names exactly `corpus skill rollback <name>` with `orchestrate`/`comment` as arguments and halt-first/resume-last ordering, and the verb sits in the allowlist that **fails the suite the day CLI-006 lands** (I proved that expiry fires). The break/observe/restore drill is correctly deferred to CLI-006's verification. |

---

## Failures

None.

## Observations for the orchestrator (not failures)

1. **Session transcripts should be retained.** TEST-50 is the contract's own "invariant whose
   violation is invisible in the finished artifact", and its direct evidence (tool counts, `lock
   break` grep) is not re-derivable because the stream-json transcript was not kept. The indirect
   evidence is strong and consistent, but a future evaluator should not have to rely on it.
2. **`reap-stale`'s 15-minute threshold vs. "run it at loop start".** The skill instructs running
   `reap-stale` at every loop start; the server only reaps after `DEFAULT_STALE_AFTER_MS` (15 min).
   The instruction is still correct (it is the *only* recovery), but an operator restarting after a
   crash waits out the window. Agent's finding 3; worth a line in the CLI/server docs, no skill change.
3. **Duplicate "claimed" job-log lines** (TEST-42) — cosmetic over-logging by the session, not a
   skill-text defect. Agent's finding 4.
4. **CLI-010 is the right home for finding 1** (no `corpus doc show`/`thread show`); already filed
   per Adjudication 21.

## Summary

**49 PASS, 1 STRUCK (TEST-37's `corpus doc check`, per the contract's own instruction), 1 DEFERRED
(TEST-51 → CLI-006, with the substitute evidence the contract specifies). No FAILs.**

Both halves of the split acceptance surface hold. The textual half is genuinely machine-enforced —
I made the command-existence test fail in three different ways (inline, fenced, and in a
non-skill template file) and made the allowlist expire, so it is not a test that merely exists. The
live half is corroborated to the byte: every job-log line, commit sha, event file and turn header
quoted in the log matches the retained workspace exactly, and I re-drove every queue mechanic the
skill prescribes — claim-all, complete, fail with `--reason`, job log, halt/resume, idle rearm,
reap-stale, 423 deferral, `job retry` re-entry, and the agent-prohibition exit codes — against my
own server without a `claude` session. The skill's description of the CLI is accurate in every
particular I checked, including the `CORPUS_FROM=agent` environment rule that TEST-22's enumeration
depends on.

The two live-half sub-claims the agent honestly marked unobserved (console-drawer rendering,
browser SSE) I verified myself in a real browser. The one criterion that cannot be satisfied today
is deferred with exactly the substitute evidence the contract asked for, and the deferral is
self-closing.
