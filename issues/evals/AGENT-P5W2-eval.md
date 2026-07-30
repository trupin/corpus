# Evaluation: AGENT-005 · AGENT-006 · AGENT-007 (sprint-016 wave 2, combined)

**Date**: 2026-07-30
**Sprint**: sprint-016 (TEST-373–416, plus cross-issue TEST-465–472)
**Verdict**: **PASS** (all three issues), with two recorded findings for follow-up filing

Evaluator workspace: `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-eval2-2368/ws`,
own server on `:9197` (pid 2634), cwd outside the repository throughout.
`lsof -nP -iTCP:8765 -sTCP:LISTEN` empty before, during and after — never bound, never
killed, never proxied. No Vite dev server was started for these three issues.

---

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes |
| --------------------------------------- | ------ | ----- |
| Verification log present                | PASS   | All three issues carry a filled `## E2E Verification Log` with a per-TEST evidence table. |
| Commands are specific and concrete       | PASS   | Exact `corpus` invocations, real event/doc/thread ids (`evt_kf23qgilff44`, `doc_4d7ox6bw`, `doc_2o55qpkc`), real timestamps, real pids. |
| Real E2E (not mocked)                    | PASS   | Real `corpus init` workspaces, real servers on `:9185`/`:9181`/`:9183`, real `claude -p "/orchestrate"` sessions. Raw stream-json transcripts retained on disk and re-audited by me (below). No test client, no fixture, no mock. |
| Scenarios cover acceptance criteria      | PASS   | Every TEST-373–416 row is present; the only non-executed items are recorded, not dropped. |
| Application restarted after changes      | PASS   | Each drill workspace was `corpus init`-ed **after** the skill rewrite; I independently confirmed a fresh `corpus init` installs the rewritten text (5 `corpus queue defer` mentions, 0 `deferred:`, genesis naming `corpus skill create`). |
| Actual model recorded (`implemented on:`)| PASS   | AGENT-007 `fable`; AGENT-005 `fable`; AGENT-006 `fable` (issue recommended opus — the deviation is explicitly recorded per the record-actuals rule, which is the rule's purpose). Drill sessions independently confirmed as `claude-opus-5` from the stream-json init records. |
| Reproduction logged before fix (bugs)    | N/A    | All three are feature/text issues, not bug fixes. |

**Transcripts audited, not taken on trust.** I parsed the raw stream-json myself:

| Transcript | Events | Session model | Task dispatches | Write/Edit tools |
| --- | --- | --- | --- | --- |
| `s016-agent007-izzIJt/transcript-agent007.stream.json` | 74 | `claude-opus-5` | 0 (pre-delegation text) | 0 |
| `s016-agent005-CnYfR3/transcript-agent005.stream.json` | 341 | `claude-opus-5` | 5 (haiku×3, sonnet×2) | 0 |
| `s016-agent005-CnYfR3/transcript-agent005b.stream.json` | 68 | `claude-opus-5` | 1 (haiku) | 0 |
| `s016-agent005-CnYfR3/transcript-agent005c.stream.json` | 255 | `claude-opus-5` | 3 (haiku×3) | 0 |
| `s016-agent006-LsuxYL/transcript-agent006.stream.json` | 105 | `claude-opus-5` | 0 (genesis drill) | 0 |

---

## Criteria Results — AGENT-007

| #   | Criterion | Result | Notes (re-derived) |
| --- | --- | --- | --- |
| TEST-373 | `deferred:` gone from orchestrate | PASS | `/usr/bin/grep -rn 'deferred:' assets/workspace/` → **exit 1, zero matches**. (My first pass used the shell's `rtk`-proxied grep, which returned a false negative on an unrelated pattern; every grep in this verdict was re-run with `/usr/bin/grep`.) `corpus queue fail` survives at 8 sites, all non-deferral (invariant list, unknown-event-type row, missing-plugin-skill row, the subagent prohibition at `:204` which is a *negative* — "never `corpus queue fail` for a lock"). |
| TEST-374 | Deferral block is reply-then-defer | PASS | `SKILL.md:243-250`: `corpus thread reply` heredoc, then `corpus queue defer evt_7c1d9a --blocked-on doc_a1b2c3 --reason …`. `--blocked-on` names the document. `# nothing changed, so that reply carries no trace line` present. |
| TEST-375 | `--blocked-on` taught as load-bearing | PASS | `:258-262` — required, names the locked document never the thread, "Name the wrong document and the event parks forever". |
| TEST-376 | Automatic re-entry, three triggers | PASS | `:264-269` — **released**, **force-broken**, **reaped**, all three named; parked `idle` unparks; `:254-256` "a postponement, not a failure … counts it under `deferred`, never `failed`". |
| TEST-377 | `job retry` demoted | PASS | Only two `job retry` mentions in the whole file: `:267` (the by-hand override) and `:330` (retrying **failed** events). `/usr/bin/grep -i 'retry the job\|failed-job row'` → no instructional match. |
| TEST-378 | Sample reply stops asking the user to work | PASS | `:245-247` — "The change is ready and will land on its own once the document is free." |
| TEST-379 | Invariant 4 absorbs defer | PASS | `:45-49` "Every claimed event is **settled** — complete, fail, or defer … a deferred event is settled accounting, not a dangling one". The restated invariant at `:325-326` corrected in the same pass: "ends settled — in `processed/`, in `failed/`, or in `deferred/`". |
| TEST-380 | Comment skill's deferral paragraph fixed | PASS | `comment/SKILL.md:175` job-log line carries no prefix; "`deferred:` accounting" gone; `:180-181` "The work re-enters by itself the moment the lock clears — nobody retries anything by hand, so never tell the person to."; "Reply *before* you defer" retained at `:181-182`. |
| TEST-381 | Comment skill gains no queue verb | PASS | `/usr/bin/grep -n 'corpus queue' comment/SKILL.md` → **exit 1, zero matches** — so not `defer` either, not just `complete|fail`. `scripts/workspace-template.test.ts:322-326`'s `not.toMatch(/corpus queue (?:complete\|fail)/)` is present **at its original strength** — not widened. |
| TEST-382 | Template suite green, pending list `[]` | PASS | Re-run by me: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts` → **96 passed** on the merged tree. `:1149` `expect([...CLI_COMMANDS_PENDING_CLI_006]).toEqual([])` passes. |
| TEST-383 | Printed commands run against a real lock | **PASS — independently re-derived** | See "Re-derived drill A" below. Not taken from the log. |
| TEST-384 | Automatic return observed | **PASS — independently re-derived** | See "Re-derived drill A". |
| TEST-385 | Live session follows the section | PASS | Re-audited from raw transcript. Command sequence: `corpus doc edit` → **423/exit 5** → `corpus thread reply th_27ynadxd` → `corpus queue defer evt_kf23qgilff44 --blocked-on doc_4d7ox6bw --reason "…"` → `corpus queue idle`. Independent counts over the transcript: `queue defer` **1**, `queue fail` **0**, `lock break` **0**, `job retry` **0**, `deferred:` **0**, Write/Edit tools **0**. After the release the same session re-claimed, edited, replied and completed with no operator action. |
| TEST-386 | Blast radius two files + tests; SPEC untouched | PASS | `git log --oneline main..HEAD -- SPEC.md` names only `[SHARED-004]`/`[SHARED-005]` (spec-writer, user-signed). Commit `1b0430f` touches exactly the 2 `SKILL.md` files, `scripts/workspace-template.test.ts`, and the 3 issue files. Residual `deferred:` sentences were recorded by line number — and have since been **fixed by SHARED-005** (see Findings). |

## Criteria Results — AGENT-005

| #   | Criterion | Result | Notes (re-derived) |
| --- | --- | --- | --- |
| TEST-387 | Delegation unconditional | PASS | `:143-146` "**Every claimed event is worked by a subagent.** You never work a job inline — not a one-line answer, not a 'quick' edit, no exception for small work". Routing rows read "A subagent applying the **comment** skill…" — they name the skill the subagent is given, never a job the orchestrator takes. Live: **9** real Task dispatches across three sessions, **0** inline handlings. |
| TEST-388 | Returns to parking without waiting | PASS | Loop block `:58-69` is claim → dispatch → `corpus queue idle`, settle lines annotated "on every return". `:71-75` "You return to `corpus queue idle` **as soon as the batch is dispatched**". The old rule is replaced by its honest residue at `:97-101` — no second `claim-all` mid-dispatch, **with the reason stated** ("a second claim splices new events into an ordering you have already computed"). |
| TEST-389 | Bound is 10, and it is the product's bound | PASS | `:229` "bounded to at most **10** concurrent subagents". `:230-233` "That 10 is **this workspace agent's** bound, set by the product's contract — it is unrelated to any concurrency limit the operator's own tooling enforces elsewhere, and neither number constrains the other." No `3` appears as a concurrency bound. The template suite additionally pins the absence of dev-harness references (`SPEC.md`, `CLAUDE.md`, `issues/`, `/implement`, `/decompose`). |
| TEST-390 | Overlap generalized past "same document" | PASS | `:216-219` "same document(s) — or when their touched sets otherwise conflict: a folder one event reorganizes while another files into it, a skill one event edits while another applies it". Serial in dispatch order, dispatch order anchored to `claim-all` order `:219-222`; the rule spans batches `:225-227`; the uncomputable-touched-set → touches-everything default survives at `:213-214`. |
| TEST-391 | Model tier table, concrete, includes Opus 5 | PASS | `:161-165` three rows — **Haiku** / **Sonnet** / **Opus 5** — each with a concrete "what falls here". Decision rule at `:167-169` (document count, prescribed-vs-decision, cost of error; tie goes to the stronger). Names live in the skill only: `/usr/bin/grep -i 'opus\|sonnet\|haiku' SPEC.md` → **zero matches**, and `SPEC.md:245` says "model names live in the skill, not here". |
| TEST-392 | Invariants restated as binding on subagents | PASS | `:29-31` "These bind every step below — and every subagent you dispatch, without dilution". `:171-185` restates all four for the dispatch prompt: CLI-only, `export CORPUS_FROM=agent` + `--from agent` **inside** the subagent ("a subagent inherits no environment"), lock conduct, job-log lines to the dispatching event id, `↳ ` trace line. |
| TEST-393 | Queue state stays with the orchestrator | PASS | `:187-189` "A subagent never runs `corpus queue claim-all`, `corpus queue complete`, `corpus queue fail`, or `corpus queue defer`: it **reports** an outcome, and you **record** it." Live: every queue-verb call in all three transcripts is a top-level orchestrator `Bash` call (29 total across A/B/C); none appears outside the orchestrator turn. |
| TEST-394 | Outcomes recorded from reports, three paths | PASS | `:189-198` — verify-then-complete; fail **with the subagent's reason**; no-report → stays `in-progress` → `reap-stale`. The third path was exercised *unplanned* and I confirmed it in the server-written job logs: `evt_mfhjwwjpyknk` was claimed 17:40:35, its session died, and session C re-claimed it at **17:56:28** and logged `"verified prior run's work: [[doc_lamjjwbx]] contains the added title and th_7pssfqef has the reply"` before completing at 17:56:46. Nothing lost, nothing blindly redone. |
| TEST-395 | Delegated lock deferral defers | PASS | `:200-204` "**A blocked subagent defers — through you.** … never `corpus queue fail` for a lock, never a retry loop against it." Adjudication 9 recorded in the log. Drilled live under TEST-404. |
| TEST-396 | Console honest about delegated work | PASS | `:284-291` adds the **dispatched** moment (which subagent, which tier, **and why that tier**); `:288-290` the subagent's acted lines go to the same event id, "never to a job of its own"; `:294-300` one-story-one-file plus the preserved "name the object and the change; do not narrate tool calls" discipline, now binding the subagent. Verified against the real job logs — e.g. `evt_ehl2ets6wrgb.jsonl` carries claim + dispatch + subagent read/edit + outcome in one file under one id. |
| TEST-397 | The skill says how a subagent is spawned | PASS | `:148-156` names the mechanism (Claude Code's Task/Agent tool, launched in the background, one subagent per event), the context handed over (event id/type, payload ids, which skill, the binding rules), and how the report returns ("the task's final message"). Live sessions followed it without inventing anything: `subagent_type: "claude"` with the skill named in the prompt, consistent with shipping no persona files (`assets/workspace/claude/agents/` correctly still holds only `.gitkeep`, which TEST-397 makes conditional). |
| TEST-398 | Wake-back described honestly | PASS | Open Conflict 1's **default shape shipped**, and the log states so. `:153-156` "You park on `corpus queue idle` — never on a subagent … Settlement never depends on any queue event announcing the subagent; the report itself is the signal." The `agent.done` routing row survives as an honest consumer: `:115` "Nothing produces this event today — reports reach you directly". The priced-in cost was observed live: `evt_o2mtodxh2cmt`'s subagent finished ~17:13:46 and settled at **17:22:03** — the rearm window, exactly as the ruling predicted. |
| TEST-399 | `git diff SPEC.md` empty | PASS | No implementing-agent commit touches SPEC.md; only `[SHARED-004]`/`[SHARED-005]`. |
| TEST-400 | Template suite green, pending `[]` | PASS | Re-run by me: 96 passed, pending list `[]`, no allowlist entry. |
| TEST-401 | Two independent jobs worked concurrently | **PASS — re-derived from server-written job logs** | `evt_fguramwqhcks` and `evt_tpsorp6wcbtz`: both claimed **17:12:31**, both dispatched **17:12:36**, edits landed 17:13:14 / 17:13:17, both completed **17:13:51**. Both were dispatched ~75 s before either completed. |
| TEST-402 | Orchestrator was parked while they ran | **PASS — re-derived** | Transcript A's next call after the two dispatches is `corpus queue idle` (no `sleep`, no poll). The third event `evt_o2mtodxh2cmt` was **claimed 17:13:08 and dispatched 17:13:12** — before the first two's edits even landed (17:13:14/17:13:17) and well before they completed (17:13:51). The queue demonstrably stayed open. |
| TEST-403 | Overlapping work serialized itself | **PASS — re-derived, both runs** | Run 1: `evt_ggx3sae5akg6` dispatched 17:22:46; `evt_sftqjf7sankr` logged `"held — overlaps evt_ggx3sae5akg6 on [[doc_fk2w2v7k]]; runs after it settles"` at 17:22:47 and was dispatched at **17:31:13 — the same second the first completed**; its subagent reconciled the first's edit ("added auto policy line, updated count 1 to 2" on top of "added summary line stating 1 policy tracked"). Run 2: `evt_pirukt3lgv67` logged `"queued behind evt_mfhjwwjpyknk — both touch [[doc_lamjjwbx]]"` at 17:40:36, dispatched **17:56:46** after the first settled, and its reply carried the post-edit count (2). No concurrent edits and no lock contention between the agent's own subagents at any point. The log's disclosure that run 1 exposed an ordering ambiguity, which was then fixed in the text and re-drilled, is honest self-reporting and I verified the corrected sentence is in the shipped file. |
| TEST-404 | Delegated lock deferral defers, live | **PASS — re-derived** | `evt_ehl2ets6wrgb.jsonl`: claimed 18:05:52, dispatched 18:05:56 (Haiku), subagent logged `"waiting on [[doc_e6esh4rx]] — the user holds its edit lock"` at 18:06:34 and ran **no queue verb**; the defer was a top-level orchestrator call — `corpus queue defer evt_ehl2ets6wrgb --blocked-on doc_e6esh4rx --reason "…"` — visible verbatim in transcript C. After the release: `"reclaimed after the lock on doc_e6esh4rx cleared"` 18:14:57, edited 18:15:40, completed 18:23:27. No `corpus job retry` anywhere in any transcript. |
| TEST-405 | Audit trail intact and CLI-only | PASS | In the drill workspace: `git log --format='%an %s'` — 29 commits, **every** mutation authored `agent` or `user` correctly (agent for all subagent work, user for seeds and thread creation). `.corpus/queue/` final state: 8 in `processed/`, `pending/`, `in-progress/`, `deferred/`, `failed/`, `abandoned/` all empty. `git status --porcelain` shows only ` M .claude/skills/orchestrate/SKILL.md` — the disclosed harness `cp` of the corrected text, not an agent hand-edit (transcripts show **0** Write/Edit tool calls in all three sessions). |
| TEST-406 | Model recorded for both layers | **PASS — re-derived exactly** | Implementing agent: `fable`. Drill sessions: `claude-opus-5` (from the init records). Subagent tiers extracted directly from the Task tool inputs: **haiku ×7, sonnet ×2** — matching the log's claim to the dispatch. Opus 5 unused because no drill task reached that weight, which is consistent with the table rather than contradicting it; each dispatch job-log line names the tier **and** its reason. |

## Criteria Results — AGENT-006

| #   | Criterion | Result | Notes (re-derived) |
| --- | --- | --- | --- |
| TEST-407 | Propose bullet becomes a create bullet | PASS | `comment/SKILL.md:331-340` names `corpus skill create <name> --description "<one line>" --from agent` with a working heredoc example. `/usr/bin/grep -i 'propose it as a note\|propose it'` → **zero matches**. One documented way, not two. |
| TEST-408 | False rationale deleted | PASS | `/usr/bin/grep -i 'cannot write into'` → **zero matches**. The `data/docs/`-only sentence is gone, not demoted. |
| TEST-409 | Extend-first still the default | PASS | `:325-330` first bullet — edit the fitting installed skill via `corpus doc edit <skillDocId> --from agent`, "including this one". Creation is explicitly the nothing-fits branch. |
| TEST-410 | Conflict rule survives in force | PASS | `:355-357` verbatim and unweakened: "A correction that contradicts an existing skill is an **edit to that skill**, never a second skill saying the opposite." |
| TEST-411 | Section states what the server owns | **PASS — every stated fact independently verified true** | I drove each claim against my own server: uppercase name → **400**; `weekly--review` (double hyphen) → **400**; 65-char name → **400**; already-installed name → **409** ("a skill named `weekly-review` is already installed"); archived name → **409**; omitted `--description` → CLI usage error, required. The created file carried **both** vocabularies (`name`/`description` + `id`/`type`/`title`/`tags`/`status`/`anchors`). Stated as outcomes ("do not pre-check them — know what comes back"), not as pre-checks. |
| TEST-412 | Archived-name collision names the right recovery | PASS (text) — **see FINDING-1** | `:344-346` "for an archived skill that `409` means unarchive it — never create the same skill again under a different name." The criterion is textual and is met; the server's own 409 message says the same thing. But the named recovery is not reachable by a CLI-only agent — recorded as FINDING-1. |
| TEST-413 | The ways back are named | PASS | `:351-353` names `corpus skill rollback <name>` and `corpus doc archive`. I verified both exist: `corpus skill rollback` resolves (404s correctly when the skill is not installed) and `corpus doc archive doc_…` moves the folder to `.claude/skills-archived/` as documented. |
| TEST-414 | Announcement and next-run semantics survive | PASS | `:359-362` — announce always, naming the skill; "a genesis is a real, immediate write into `.claude/`"; takes effect on the **next** run of the loop, not the running session. |
| TEST-415 | Pinned assertions hold, pending list empty | PASS | Re-run by me: 96 passed on the merged tree, `CLI_COMMANDS_PENDING_CLI_006` `[]`, `:322-326`'s regex untouched. |
| TEST-416 | Live session creates a skill through the CLI | **PASS — transcript re-audited + CLI half independently re-derived** | Transcript: exactly **1** real `corpus skill create weekly-review --description "…"`, **0** `corpus doc create`, **0** Write/Edit tools. In the drill workspace: `.claude/skills/` holds exactly 5 dirs; `weekly-review/SKILL.md` carries both vocabularies (`name`, `description`, `id: doc_2o55qpkc`, `type: skill`, `title: Weekly review`); `git log --format='%an %s'` → `agent skill create: weekly-review (doc_2o55qpkc) by agent`; `git status --porcelain` **empty**. Extend branch: `corpus doc edit doc_skillcomment --file … --from agent`, `agent doc edit: Comment (doc_skillcomment) by agent`, and **no second skill** was created. Independently, I ran the skill's verbatim example against my own server — see "Re-derived drill B". |

## Cross-Issue

| #   | Criterion | Result | Notes |
| --- | --- | --- | --- |
| TEST-465 | No agent edited SPEC.md | PASS | `git log --oneline main..HEAD -- SPEC.md` → only `ee2683e [SHARED-005]` and `b4aa5b1 [SHARED-004]`, both spec-writer, both user-signed. |
| TEST-466 | No in-place `packages/contract` amendment | PASS | `git log --oneline main..HEAD -- packages/contract` → only `3717887 [CONTRACT-020][CONTRACT-021]`, a wave-1 contract-dev commit. Nothing from wave 2. |
| TEST-467 | No state-changing git command by an agent | PASS | Transcripts contain zero `git commit/push/checkout/reset/stash` in the dev repo. In-workspace git activity is the server's own auto-commit, as expected. |
| TEST-468 | Repo clean of scratch escape | PASS | `git status --short` at session start: clean. No `data/`, `.corpus/`, `.claude/skills/`, coverage or Playwright output. |
| TEST-469 | No workspace scaffolded into the dev repo | PASS | `ls -d /Users/theophanerupin/code/corpus/.corpus` → "No such file or directory", at start **and** after all my drills. |
| TEST-470 | Ports and processes clean; 8765 untouched | PASS | Baseline and post-drill `lsof -nP -iTCP:8765 -sTCP:LISTEN` → nothing. `9180-9199` clean at baseline; my own `:9197` server stopped by recorded pid. |
| TEST-471 | The two orchestrate rewrites reconciled once | PASS | One deferral story (defer verb only), one terminal-state invariant that includes defer (Invariant 4 at `:45-49` **and** its restatement at `:325-326` agree), one concurrency bound (10). No sentence from AGENT-007's pass contradicts AGENT-005's, and AGENT-007's text was reconciled rather than reverted — the deferral section is intact and now additionally carries the subagent path at `:253-254`. |
| TEST-472 | Template test reconciled across all three | PASS | 96 tests green on the merged tree; `CLI_COMMANDS_PENDING_CLI_006` `[]`; no allowlist entry; `:322-326`'s regex intact at original strength. AGENT-007's additive `not.toContain("corpus queue defer")` / `not.toMatch(/deferred:/)` assertions on the comment body strengthen rather than weaken it. |

---

## Re-derived drills (mine, not the implementing agents')

### Drill A — the defer cycle (TEST-383 / TEST-384), `:9197`

Fresh workspace, `corpus init --port 9197` from a cwd outside the repo. Doc `doc_nygienjv`
created as user; `corpus lock acquire doc_nygienjv --from user --ttl 900` → `locked
doc_nygienjv for user, lease 900s.` Thread opened by the user's own path
(`POST /api/threads` with `requestsAgent: true`, `x-corpus-author: user`) → `th_siwgkgkw`,
enqueuing `evt_2tmyf2jzklai`. `corpus queue claim-all` returned the batch.

Then the commands the rewritten section **prints**, verbatim and in its order:

```
$ corpus doc edit doc_nygienjv --from agent <<'EOF' … EOF
corpus: 423 locked: doc_nygienjv is being edited by user; the lock was acquired at 2026-07-30T19:01:59Z
  The write was not applied. The other party holds this document's edit lock — defer and come back to it, rather than retrying in a loop.
exit=5

$ corpus thread reply th_siwgkgkw --from agent <<'EOF' … EOF
replied to th_siwgkgkw — turn 2026-07-30T19:02:11Z          exit=0

$ corpus queue defer evt_2tmyf2jzklai --blocked-on doc_nygienjv --reason "waiting for the user's edit lock on doc_nygienjv"
event evt_2tmyf2jzklai is deferred on doc_nygienjv.          exit=0
```

`.corpus/queue/deferred/evt_2tmyf2jzklai.json` carries
`"status": "deferred"`, `"blockedOn": "doc_nygienjv"`,
`"deferReason": "waiting for the user's edit lock on doc_nygienjv"`.
`corpus queue status` → `pending 0, in-progress 0, **deferred 1**, processed 0, **failed 0**`.

Automatic return, timestamps from `date -u`:

```
idle-start   19:02:23Z     (corpus queue idle --wait 20, parked)
release-at   19:02:27Z     corpus lock release doc_nygienjv --from user   [second shell]
idle-return  19:02:27Z     evt_2tmyf2jzklai comment.created   exit=0
```

`corpus queue status` → `pending 1, deferred 0`. The pending file carries **no**
`blockedOn` and **no** `deferReason`. **No `corpus job retry` was run.** The sentence the
skill now makes is true.

### Drill B — skill genesis (TEST-411/412/413/416 CLI half), `:9197`

The skill's verbatim example ran unmodified:

```
$ corpus skill create weekly-review --description "Run the weekly review over the corpus." --from agent <<'EOF' … EOF
created doc_d6rrnpjt — .claude/skills/weekly-review/SKILL.md    exit=0
```

The written file carries **both** frontmatter vocabularies exactly as the skill promises
(`name`, `description`, then `id: doc_d6rrnpjt`, `type: skill`, `title`, `created`,
`updated`, `tags`, `status`, `anchors`). `corpus doc list --type skill` shows it. `git log
--format='%an %s'` → `agent skill create: weekly-review (doc_d6rrnpjt) by agent`.
`corpus db doctor` → `projection is clean — 12 documents from 12 files`.

Every validation outcome the skill states, checked against the server:

| Stated in the skill | Observed |
| --- | --- |
| lowercase/digits/single-hyphens, ≤64 chars, else `400` | `Weekly-Review` → 400 · `weekly--review` → 400 · 65×`a` → 400 |
| installed name → `409` | `409 conflict: a skill named 'weekly-review' is already installed` |
| **archived** name → `409` | `409 conflict: the name 'weekly-review' belongs to an archived skill … unarchive it to bring it back` |
| `--description` required | `corpus: --description is required.` |
| `corpus doc archive` disables a skill | folder moved to `.claude/skills-archived/weekly-review` |
| `corpus skill rollback <name>` is the way back | verb exists; 404s correctly when the skill is not installed |

---

## Findings (no criterion violated; both need a follow-up issue)

### FINDING-1 (MAJOR): the archived-name recovery the comment skill names is unreachable from the CLI

**Where**: `assets/workspace/claude/skills/comment/SKILL.md:344-346` — "for an archived
skill that `409` means **unarchive it** — never create the same skill again under a
different name."

TEST-412 asks only that the text say this, and it does, so the criterion passes. But the
skill is instructions to a CLI-only agent (Invariant 1: "never call the HTTP API
directly"), and I could not carry out the instruction:

```
$ corpus doc unarchive doc_d6rrnpjt --from agent
corpus: unknown verb "unarchive" for "corpus doc".
  Did you mean "archive"? Valid: list, show, check, create, edit, move, archive, delete.

$ corpus doc edit doc_d6rrnpjt --status open --from agent
edited doc_d6rrnpjt                       # ← reports success…
$ ls .claude/skills/ .claude/skills-archived/
.claude/skills-archived/: weekly-review   # ← …but the folder did not come back
$ corpus skill create weekly-review --description "y" --from agent
corpus: 409 conflict: the name 'weekly-review' belongs to an archived skill …
```

The route exists (`POST /api/docs/{id}/unarchive` is in `openapi.json`, and it works — I
confirmed it over HTTP, which the agent may not do) and `SPEC.md:317` promises
"archive/**unarchive** routes". No CLI verb exposes it, so an agent that hits this `409`
is dead-ended by the only recovery its skill names. Note also that `corpus doc edit
--status open` reports success while leaving a **half-state**: frontmatter flips to
`status: open` but the folder stays in `.claude/skills-archived/` and the name stays
409-blocked.

This is not AGENT-006's doing — the server's own 409 message gives the same unreachable
advice, and it predates this wave. It is the exact shape of Adjudication 23 (record the
gap, do not close it) and should be filed as a CLI issue. Recommend: `corpus doc
unarchive` (or `corpus skill unarchive`), plus deciding whether `doc edit --status open`
on an archived skill should refuse rather than half-succeed.

### FINDING-2 (MINOR): two `agent.done` residues survive Open Conflict 1's default

1. `assets/workspace/claude/skills/comment/SKILL.md:158` still tells the agent that "the
   server's `agent.done` event wakes the orchestrate skill, which routes the result back".
   Nothing produces `agent.done` — which the orchestrate skill now says out loud at `:115`.
   This paragraph belongs to none of the three issues' declared scopes (AGENT-007 owned the
   deferral paragraph, AGENT-006 the genesis section, AGENT-005 the orchestrate file), so
   no criterion catches it, but the two shipped skills now disagree with each other.
2. `SPEC.md:248` still says "The orchestrator parks while subagents run and is woken by
   their completion — the `agent.done` core event (above) exists for exactly this."

Both should ride the same follow-up chain Open Conflict 1 already routed
(`POST /api/queue` → server handler → CLI verb → AGENT rider). Recording it here so the
comment-skill sentence is not forgotten when that chain lands.

**Also observed, non-blocking**: in the AGENT-005 drill, the live opus-5 session wrote a
free-text job-log line `"deferred: doc_e6esh4rx is held by the user's edit lock; replied on
th_xuapmnrd"` (`evt_ehl2ets6wrgb.jsonl`, 18:14:23Z) — the retired prefix reappearing by the
model's own habit, in a line no criterion constrains and where it creates no second
protocol (the actual settle call was `corpus queue defer`). Worth knowing that removing the
grammar from the text does not immediately remove it from model output.

**Also observed, trivial**: the AGENT-006 drill's live session staged an edit body at bare
`/tmp/comment-body.md` before feeding it to `corpus doc edit --file`. That is the *drilled
product agent's* behavior inside its own workspace, not the implementing agent's scratch,
and it touched nothing under `data/`/`.corpus/`/`.claude/` by hand, so no invariant is
broken. Noted only because the sprint's scratch rule reads strictly.

---

## Summary

**AGENT-007: PASS** — 14/14 (TEST-373–386). The dead `deferred:` protocol is gone from both
skills, the defer verb is taught once with all three re-entry triggers, and I re-derived the
full defer→park→release→pending cycle myself against a real server rather than trusting the
log.

**AGENT-005: PASS** — 20/20 (TEST-387–406). The strongest evidence is not the text but the
server-written job logs: two events dispatched at 17:12:36 and completed at 17:13:51 with a
third claimed at 17:13:08 in between; an overlapping pair held and released at the exact
second the first settled, with the second subagent reconciling the first's edit; and a
delegated deferral where the subagent ran no queue verb and the orchestrator made the defer
call. The subagent tier counts (haiku ×7, sonnet ×2) matched the log's claim exactly when I
extracted them from the raw Task inputs.

**AGENT-006: PASS** — 10/10 (TEST-407–416). Every server behavior the rewritten genesis
section asserts is true — I checked all six against a live server, including the two `409`
branches — and the live session took the create branch for a novel pattern and the edit
branch for a fitting one, producing exactly one new skill.

**Cross-issue: PASS** — 8/8 applicable (TEST-465–472).

Two findings are recorded for follow-up filing; neither violates a sprint-016 criterion.
FINDING-1 is the one worth acting on: a `409` recovery the product tells its agent to
perform, that the product gives its agent no way to perform.
