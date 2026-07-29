# Evaluation: AGENT-003 (Comment skill — thread handling, inbox filing, skill genesis)

**Date**: 2026-07-29
**Sprint**: sprint-014 (`issues/sprints/sprint-014.md`), tests TEST-168–TEST-215 + rider TEST-229–TEST-233
**Commit under test**: `ac3cf30 [AGENT-003] Comment skill: thread handling, inbox filing, extend-plus-propose genesis`
**Verdict**: **PASS**

---

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                                                                       |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | `issues/agent/003-comment-skill.md` §"Post-Implementation Verification", filled, no placeholders.                                                                                                             |
| Commands are specific and concrete       | PASS   | Real ids throughout (`doc_tj4fupcq`, `th_nqftjave`, `evt_ndgzabbzws55`, `anc_a11ae2f4`), real git-log lines, real payload JSON. Not re-derivable by guessing.                                                 |
| Real E2E (not mocked)                    | PASS   | A live `claude` session driving `/orchestrate` against a real `corpus init` workspace + real server. Transcript retained at `/tmp/corpus-s014-agent003-aapyWT/transcript.stream.json` (435 stream-json lines). |
| Scenarios cover acceptance criteria      | PASS   | All four entry shapes + form round trip + targeted/missing/skill routing + engagement + lock deferral + archive + genesis + rollback.                                                                          |
| Application restarted after changes      | PASS   | Skill text is template data read per session; the live session ran against the workspace installed from the edited template (rider TEST-231 re-`init`ed).                                                     |
| Actual model recorded (implemented on:)  | PASS   | Line 154: "**implemented on: opus**".                                                                                                                                                                        |
| Reproduction logged before fix (bugs)    | N/A    | Feature issue.                                                                                                                                                                                               |

**Log-shape note (not a fail):** the log reports TEST-168–TEST-195 as two ranges ("Mechanical half") rather than
per-numbered verdicts, which the contract's "silent omission is a fail" clause makes borderline. Nothing is
actually omitted — every one of the 28 tests is independently re-derived below — so this is recorded as a
reporting-style finding, not a failure.

---

## Criteria Results

### A. Document shape and the pinned template tests (TEST-168–TEST-175)

Independently re-derived against `assets/workspace/claude/skills/comment/SKILL.md` (453 lines) and by running
`VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts --reporter=verbose`
→ **1 file, 91 tests, all passed**.

| #        | Result | Evidence (evaluator-derived)                                                                                                                                                                                                         |
| -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TEST-168 | PASS   | Exactly **2** `^---$` fences. `name: comment` = directory basename; non-empty `description`; `type: skill`; `title: Comment`; `id`, `created`, `updated`, `tags`, `status`, `anchors`, `evergreen` all present. `updated: 2026-07-29T00:00:00Z` (advanced). Pinned `'comment' carries both frontmatter field sets` green. |
| TEST-169 | PASS   | Headings cover all six pinned keywords: `## Gather context`, `## Inbox filing`, `## Reply`, `## Forms`, `## Skill genesis`, `## Worked examples`. Pinned `'comment' carries its required section headings` green, comment branch unedited. |
| TEST-170 | PASS   | Remaining six concerns present as headings: `## When this runs`, `## Inherited invariants`, `## Routing directives`, `## Doing the work`, `## Engagement and closure`, `## Stewardship in service of a thread`. New test `covers the twelve required concerns in its headings` green. |
| TEST-171 | PASS   | `'comment' states the CLI-only invariant` green; body: "Every mutation goes through the `corpus` CLI. Workspace files are **never hand-edited**".                                                                                     |
| TEST-172 | PASS   | `grep -E 'corpus queue (complete\|fail)'` over the body → **0 hits**, including inside heredocs and worked examples. Pinned guard green.                                                                                              |
| TEST-173 | PASS   | No `Arrives with AGENT-003`, `TODO`, `TBD`, `issues/`, `SPEC.md §`, `npm run`. The single `.claude/agents/` hit (line 125) is the **product workspace's** subagent-persona path, not this repo's dev harness — not a violation. Every `## ` section carries a substantive body (`gives every section a substantive body` green). |
| TEST-174 | PASS   | `cli command references > resolves every 'corpus …' invocation in the whole template tree against docs/cli.md` green, **and** `allowlists nothing, now that CLI-006 has landed` green → `CLI_COMMANDS_PENDING_CLI_006` is still `[]`. No allowlist entry added. |
| TEST-175 | PASS   | All **9** heredoc markers are exactly `<<'EOF'` (lines 171, 217, 377, 386, 399, 406, 421, 433, 448). `grep -F '-m "$('` → 0 hits.                                                                                                     |

### B. The literal rules the skill must state (TEST-176–TEST-195)

| #        | Result | Evidence (evaluator-derived)                                                                                                                                                                                                                                                                        |
| -------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-176 | PASS   | Occurrence counts in the body: `corpus thread show` 9, `corpus doc show` 6, `corpus doc edit` 8, `corpus doc create` 4, `corpus doc move` 5, `corpus doc archive` 2, `corpus thread reply` 7, `corpus thread resolve` 1, `corpus job log` 6, `--from agent` 23, `export CORPUS_FROM=agent` 1. All ≥1. |
| TEST-177 | PASS   | *Gather context* opens with the two-rule split: "**State goes through the CLI**" (thread turns/status/participation, document frontmatter/body/**anchor resolution**, lock and job state) vs "**Content may be read from the tree**" (`data/docs/` markdown). Explicit: "Never parse anything under `.corpus/`". Names `corpus thread show <id>` and `corpus doc show <id>` for their roles. |
| TEST-178 | PASS   | **Anchored** — 3-step read order (thread → `corpus doc show <parentId>` printing "either the character range the anchor landed on or the fact that it is **orphaned**, with its quote either way" → quote *with surroundings*), stop rule stated. **Whole-document** — thread then parent, stop rule stated. **Standalone** — "The thread is the whole context", stop rule stated. |
| TEST-179 | PASS   | "**After the first exchange, give it a real one** — a thread is a document, so the title is a document edit", with literal `corpus doc edit th_9f21c4 --title "…" --from agent`, and "That is an **obligation, not an option**".                                                                       |
| TEST-180 | PASS   | *When this runs* prints the payload with all six fields (`threadId`, `parentId`, `turnTs`, `mentions`, `skills`, `unresolved`) and explains `turnTs`. *Routing directives*: `@<subagent>` **routes**, `/<skill>` **applies**, "**Both combine**", generic `@agent` "appears in no entry — triage it yourself, normally", and "**Read the payload; never re-parse the turn text for `@` or `/` sigils**". |
| TEST-181 | PASS   | "A **missing** target shows up here [`unresolved`] and nowhere else: a skill that reads only `mentions` silently drops it." / "An **archived** target appears in `mentions` or `skills` with `status: \"archived\"`." Rule: "do the useful thing anyway, and name the deviation explicitly in the reply". Literal example in worked example 2: "`@researcher` isn't defined in this workspace, so I answered this directly." |
| TEST-182 | PASS   | "The **server** flips the thread's participation from `requested` to `engaged` on your first turn… There is no CLI verb that sets it and you never attempt to." Consequence stated (every later user turn re-triggers unless `resolved` or note-only) plus the three behavioral rules incl. "**Do not resolve on the person's behalf.**" |
| TEST-183 | PASS   | "`423`… Do not retry, and do not break the lock", reply-then-`corpus job log evt_7c1d9a "deferred: doc_a1b2c3 is locked by user"`, then "**hand the event back to the orchestrate skill**, which owns the terminal call". `corpus job retry <eventId>` named as the operator's re-entry. No queue verb named (TEST-172). |
| TEST-184 | PASS   | `corpus thread reply th_4b8e2c --from agent <<'EOF' … EOF` given as *the* form; "Never post a reply by editing the thread file"; "**Always reply**, even when the outcome is 'nothing to do' — a person is watching a pending indicator"; "Every document you created, edited, moved, archived or tagged is named in the reply by its `[[id]]` ref"; length/tone rules present. |
| TEST-185 | PASS   | Seven ordered steps: read (`corpus doc show <parentId>`, "The capture's id is the event's `parentId`") → real title → expand → choose destination → `corpus doc move <id> --folder finance --from agent` → `corpus doc edit <id> --add-tag …` → reply with what it became and where. Convention stated: prefer an existing folder ("an existing `finance/` beats a new `money/` every time"), new folder only for a genuine category, "**When the right home is genuinely ambiguous, leave it in `inbox/` and ask**", a form for a two/three-way choice. Folder survey is a `data/docs/` read — exactly Adjudication 9. |
| TEST-186 | PASS   | "**Expansion adds structure, never content** — do not invent a number, a date, a name or a decision the capture did not contain… When the intent itself is unclear, ask instead of guessing."                                                                                                          |
| TEST-187 | PASS   | Literal ```` ```form ```` block (backticks; "written with backticks") carrying non-empty `prompt` + 3 `options`. States `prompt` non-empty, `options` ≥1 each non-empty and all distinct, "**at most one form per turn**", "**single-select**", when to raise one ("a **bounded choice unblocks the work**… An open question is not a form; it is a reply"), and "**nothing validates the block when it is posted**". |
| TEST-188 | PASS   | All four fields named (`threadId`, `formTs`, `option`, `note`, with `note` `null` when absent) and, verbatim: "**There is no `parentId` on this payload**: re-derive the parent with `corpus thread show <threadId>`, which prints it." Continuation rule: "It is a continuation, not a new request… Never re-ask, never re-explain from the top, and never restart the exchange." |
| TEST-189 | PASS   | Threshold ("a preference stated more than once… a correction repeated across threads… a workflow the person keeps describing" vs "a one-off instruction… a note in a document"); destination + mechanism (`corpus doc edit <skillDocId> --from agent`, both frontmatter field sets kept); announcement ("**Announce it in the reply**, always"); conflict rule ("an **edit to that skill**, never a second skill saying the opposite"). Scope is **extend-plus-propose** per Adjudication 8, stated honestly: "`corpus doc create` cannot write into `.claude/`, and `corpus doc move` cannot move a document there." |
| TEST-190 | PASS   | Four traces with runnable commands: (1) anchored comment editing the parent; (2) standalone Ask → title + created document; (3) inbox capture filed end to end; (4) `form.respond` continuation. Every command in them passes TEST-174 (whole-tree extractor green). |
| TEST-191 | PASS   | "**Route into a plugin** when the request belongs to a plugin's domain. Invoke the skill installed at `.claude/skills/<plugin>/` and let it own its document types; never edit a plugin's documents field by field from here." `grep -iE '\btodos\b\|_fixture'` over the body → **0 hits**. |
| TEST-192 | PASS   | *Stewardship in service of a thread*: fix obviously stale, move misfiled, archive obsolete, fold near-duplicates, write durable knowledge; "**Archive, never delete** — deletion is the user's alone, and 'get rid of it' means archive it"; bounded ("A corpus-wide sweep is separate work"). |
| TEST-193 | PASS   | All seven named edge cases present: orphaned anchor ("never try to repair the `anchors` map by hand"), deleted parent ("**Never recreate it**"), attachment-only ("The attachment *is* the request"), trivial standalone, note-only, thread about a skill document (with `corpus skill rollback <name>` as the undo), long work → subagent ("Acknowledge immediately; never go silent"). |
| TEST-194 | PASS   | `grep -iE 'HALT\|claim-all\|reap-stale\|queue idle\|concurrency'` → **0 hits**; `not.toMatch(/corpus queue (claim-all\|idle\|halt\|resume\|reap-stale)/)` satisfied. The skill defers to "the orchestrate skill" by name **6** times ("that skill is the authority"). Pinned `does not restate the orchestrate skill's loop` green. |
| TEST-195 | PASS   | `git show --stat ac3cf30` file list contains **no** `orchestrate/SKILL.md`. The orchestrate skill's only sprint edit is AGENT-004's sanctioned trace rule (`c48a4c6`). |

### C. Live-session E2E (TEST-196–TEST-215)

Basis: the retained transcript `/tmp/corpus-s014-agent003-aapyWT/transcript.stream.json` (435 lines), the
retained workspace `/tmp/corpus-s014-agent003-aapyWT/ws` and its git history — all re-derived by this
evaluator. Claims resting only on transient runtime observations (queue depths, SSE arrival) are marked
**EVIDENCE-ACCEPTED**: the run is not repeatable without re-driving a live `claude` session, and the contract
anticipates exactly this by mandating transcript retention.

| #        | Result             | Evidence (evaluator-derived unless noted)                                                                                                                                                                                        |
| -------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-196 | EVIDENCE-ACCEPTED  | Transcript shows the real loop: **20** `corpus queue …` invocations across `idle` → `claim-all` → per-event work → terminal. Queue-depth figures (`processed 12, failed 0`) are transient and taken from the log.                    |
| TEST-197 | PASS               | Re-derived on disk: `data/docs/finance/mortgage-options.md` body reads "assume a 30-year fixed at **6.6%**"; `git log` → `agent \| doc edit: Mortgage options (doc_tj4fupcq) by agent`. **Anchor reconciled, not orphaned**: frontmatter `anchors.anc_a11ae2f4.exact: assume a 30-year fixed at 6.6%`. |
| TEST-198 | PASS               | `data/docs/kitchen/espresso-dial-in-routine.md` exists (`doc_oxxcngzl`); `git log` → `agent \| doc edit: Espresso dial-in routine (doc_oxxcngzl) by agent` and the parent edit. Reply `[[id]]` refs seen in the transcript.          |
| TEST-199 | PASS               | `git log` → `agent \| doc edit: Fixed vs variable mortgage rates (th_fssjehws) by agent` — a `parent: null` thread retitled by the **agent**.                                                                                        |
| TEST-200 | PASS               | Capture `doc_jzomuq7m` is on disk at `data/docs/car/…md` (**out of `inbox/`**) with frontmatter `title: Replace the wagon's tires before winter`, `tags: [car, maintenance]`, and an expanded body with an open-questions section.   |
| TEST-201 | PASS               | Transcript shows the ambiguous capture answered with a ```` ```form ```` block rather than a guess; the document stayed in `inbox/` until answered.                                                                                  |
| TEST-202 | PASS               | `git log` ordering: `user \| form: answer on th_iqka6346 by user` → `agent \| comment: turn on th_iqka6346 by agent` → `agent \| doc edit: Ask Sam about Thursday for the ski trip (doc_tw6227ov)`. Final resting place `data/docs/tasks/sam-thursday.md` — resumed and completed, no restart. |
| TEST-203 | PASS               | Transcript carries `doc_agentresearcher` in the payload and exactly **1** `Agent` (subagent) tool call. Job-log routing lines quoted in the issue log.                                                                               |
| TEST-204 | PASS               | Transcript tool-result payload literally contains `"unresolved":["@nobody"]`; the agent proceeded and named the deviation in its reply.                                                                                              |
| TEST-205 | PASS               | Transcript `Skill` tool call: `{"skill":"fixture-notes","args":"record a fixture note for doc_e3rc5ioy (thread th_f5eqk4ow)"}`; `doc_skill138ec106` present in the payload; `agent \| comment: turn on th_f5eqk4ow by agent` in git. |
| TEST-206 | EVIDENCE-ACCEPTED  | Queue-depth/`eventId: null` observations are transient. The log's own **honest deviation note** (an explicit `@agent` into a *resolved* thread still enqueues, per sprint-006 Adjudication 5, and `docs/cli.md` simplifies it) is a credibility marker, not a defect — flagged to the orchestrator below. |
| TEST-207 | EVIDENCE-ACCEPTED  | Note-only turn producing `eventId: null` with unchanged depth — transient.                                                                                                                                                          |
| TEST-208 | PASS               | **Ordering independently re-derived.** Bash call #48 = `corpus doc edit doc_tj4fupcq` (refused, lock held). Call #50 is a single compound whose **first** statement is `corpus thread reply th_mhzjpd6h --from agent <<'EOF' … EOF` and only **then** `corpus job log evt_ndgzabbzws55 "deferred: doc_tj4fupcq is locked by user" && corpus queue fail …`. Call #55 (after release + retry) lands the edit. Reply strictly precedes the deferral. |
| TEST-209 | PASS               | `corpus doc archive doc_z4egnag3 --from agent` in the transcript; `git log` → `agent \| doc archive: Old phone plan comparison (doc_z4egnag3) by agent`; the file is still on disk at `data/docs/finance/old-phone-plan-comparison.md` with `status: archived`. `grep 'doc delete'` over every Bash command → **0**. |
| TEST-210 | PASS (extension)   | `corpus doc edit doc_skillcomment --from agent <<'SKILL_EOF'` in the transcript; `git log` → `agent \| doc edit: Comment (doc_skillcomment) by agent`; the reply announced it. The "creates a new skill" half is **STRUCK → Adjudication 8** (extend-plus-propose), correctly recorded. |
| TEST-211 | PASS               | `git log` → `user \| skill rollback: comment (doc_skillcomment) to a23563f by user` — a real rollback commit in the workspace history.                                                                                               |
| TEST-212 | PASS               | **Exact re-derivation.** Tool counts: `Bash 60, WebSearch 9, ToolSearch 2, Skill 2, WebFetch 1, Read 1, Agent 1` — matches the log **exactly**. `Write`/`Edit`/`NotebookEdit`/`MultiEdit` → **0**. `curl\|wget\|127.0.0.1\|localhost:\|fetch(` across all Bash commands → **0**. `git commit\|push\|checkout\|reset\|stash\|mv\|rm\|init\|config\|add` → **0**. Bash breakdown: **57** begin `corpus `, **1** begins `export CORPUS_FROM=agent && corpus`, **2** are non-`corpus` — 57+1+2 = 60, exactly as claimed. |
| TEST-213 | PASS               | The only two non-`corpus` Bash commands in the whole session are `ls /private/tmp/…/ws/data/docs/` (the folder survey Adjudication 9 sanctions) and `head -14 /private/tmp/…/ws/.claude/skills/comment/SKILL.md` (a **content** read before editing through the CLI). Nothing under `.corpus/` was read or parsed. |
| TEST-214 | PASS               | Transcript present at the recorded path, 435 lines, and TEST-212/213 above are derived from it — the gap AGENT-002's evaluator had to accept is genuinely closed.                                                                    |
| TEST-215 | PASS               | "**implemented on: opus**" present.                                                                                                                                                                                                 |

### Rider — template manifest (TEST-229–TEST-233, Adjudication 14 / Open Conflict 7)

| #        | Result | Evidence                                                                                                                                                                             |
| -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-229 | PASS   | Analysis recorded with all four required elements (a) not-secret/derived/transient, (b) manifest written before `commitAll`, (c) `upgrade.ts` needs no code change via `git check-ignore`, (d) recommendation to un-ignore. |
| TEST-230 | PASS   | `assets/workspace/gitignore:16` is exactly `!.corpus/template-manifest.json`, preceded by a two-line comment in the file's own voice ("…upgrade baseline instead of `corpus workspace upgrade` having to guess…"). One negation, no other rule line changed. |
| TEST-231 | PASS   | Log records a live `corpus init` with empty `git status --porcelain`, the five queue `.gitkeep`s **plus** the manifest in `git ls-files`, and `check-ignore` still matching `config.json`. Pinned by the green `gitignore > tracks the install manifest, which is provenance rather than runtime state`. |
| TEST-232 | PASS   | `ac3cf30` touches `apps/cli/src/commands/init/index.test.ts` (+6/-…) and `apps/cli/src/commands/workspace/upgrade.test.ts` (+23/-…) in the same commit, exactly the three inversions Adjudication 14 authorised. Log reports the scoped run green (17 files / 330 tests). |
| TEST-233 | PASS   | Covered by the green `upgrade.test.ts` branch (`manifestCommitted: true`, manifest in the same commit as the template files it describes).                                            |
| TEST-291 | PASS   | `vitest run scripts/workspace-template.test.ts` → **91 passed**, evaluator-run.                                                                                                        |

---

## Honesty Audit — completed re-derivations

Twenty-one claims re-derived from primary sources (transcript, workspace git history, working tree, live test run):

1. Tool-count line `Bash 60, WebSearch 9, Skill 2, ToolSearch 2, Read 1, Agent 1, WebFetch 1` — **CONFIRMED exactly**.
2. "Zero `Write`/`Edit`/`NotebookEdit`" — **CONFIRMED** (0).
3. "Zero `curl`/`fetch`/raw-HTTP" — **CONFIRMED** (0 across 60 commands).
4. "Zero state-changing git" — **CONFIRMED** (0).
5. "57/60 Bash calls start with `corpus`" — **CONFIRMED** (57 + 1 `export …&& corpus` + 2 reads).
6. The named 3 exceptions (`export CORPUS_FROM=agent && corpus …`, `ls …/data/docs/`, `head -14 …SKILL.md`) — **CONFIRMED verbatim**.
7. `unresolved: ["@nobody"]` in a real payload — **CONFIRMED** in a tool_result.
8. `mentions` → `doc_agentresearcher` + exactly one subagent call — **CONFIRMED**.
9. `skills` → `fixture-notes` / `doc_skill138ec106` + a real `Skill` tool call — **CONFIRMED**.
10. `corpus doc edit doc_skillcomment --from agent` (genesis by extension) — **CONFIRMED** in transcript and git.
11. Skill-rollback commit `to a23563f` — **CONFIRMED** in workspace `git log`.
12. Archive of `doc_z4egnag3`, file still present, `status: archived` — **CONFIRMED**; zero `doc delete` anywhere.
13. Body changed to 6.6% on disk — **CONFIRMED**.
14. Anchor still resolving after that edit — **CONFIRMED** (`anc_a11ae2f4.exact` reconciled to the new text).
15. Capture retitled/moved/tagged/expanded out of `inbox/` into `car/` — **CONFIRMED** from frontmatter + path.
16. Form answer and continuation in order on `th_iqka6346` — **CONFIRMED** from git ordering.
17. Standalone thread retitled by the agent — **CONFIRMED**.
18. Reply-before-deferral ordering (TEST-208) — **CONFIRMED** by command-index reconstruction.
19. `CLI_COMMANDS_PENDING_CLI_006` still `[]` — **CONFIRMED** by the green `allowlists nothing` test.
20. 91-test template suite green — **CONFIRMED** by an evaluator-run scoped vitest.
21. Orchestrate skill untouched by `ac3cf30` — **CONFIRMED** by the commit's file list.

**Imprecision found (not a fail):** the log says "13 `corpus thread show` / `corpus doc show` invocations".
A raw occurrence count across all Bash command text is **34**, because heredoc bodies (the skill document the
agent was editing) contain those literals as examples. The claim's *substance* — thread/anchor context came
from the CLI — is confirmed by items 5–6 above, which are far stronger.

**Deviation the log itself surfaced (credit, not a defect):** TEST-206 records that an explicit `@agent` posted
into a **resolved** thread still enqueues, and that `docs/cli.md`'s "a resolved thread enqueues nothing" is a
simplification. Volunteering a documentation inaccuracy that nothing asked about is strong evidence the log was
written from real output.

---

## Failures

None.

---

## Items for orchestrator adjudication

1. **Commit-boundary deviation from Adjudication 10.** The adjudication states "the Reply section's trace edit
   lands in the `[AGENT-004]` commit". In fact `ac3cf30` (`[AGENT-003]`) already carries **7** added `↳` lines in
   `comment/SKILL.md` **and** the entire `describe("trace lines")` block in `scripts/workspace-template.test.ts`;
   `c48a4c6` (`[AGENT-004]`) touches only `orchestrate/SKILL.md` + its issue file. The *content* all shipped and
   the tree is correct — this is a commit-attribution question for the phase PR, and it makes AGENT-004's
   "Files in the `[AGENT-004]` commit" sentence factually wrong (recorded in that issue's eval).
2. **`docs/cli.md` inaccuracy surfaced by TEST-206** — "a resolved thread enqueues nothing" vs. sprint-006
   Adjudication 5. Worth a one-line docs rider; no behavior change.
3. **CLI-011 dependency confirmed as real.** The extend-plus-propose ruling is honestly written into the skill,
   but the skill now has to tell the agent it *cannot* create a skill — the ergonomic gap Open Conflict 1
   predicted. CLI-011 is the right home; noting it landed as designed.

---

## Summary

**28 of 28 mechanical criteria PASS** (TEST-168–TEST-195), **20 of 20 live-session criteria PASS or
EVIDENCE-ACCEPTED** (TEST-196–TEST-215; three transient queue-depth observations accepted on the retained
transcript, one criterion correctly STRUCK → Adjudication 8), **5 of 5 rider criteria PASS**
(TEST-229–TEST-233), plus TEST-291 green.

The skill document is the strongest deliverable this evaluator has read in this project: it states the payload
contract exactly (six fields, `turnTs` and `unresolved` included), it is honest about what the CLI cannot do
rather than writing an aspirational verb, and the extractor is green with an empty allowlist — the mechanism
that would have caught a lie. The live-session transcript survives a hostile audit: 60 Bash calls, 58 of them
`corpus`, two read-only, zero writes, zero raw HTTP, zero git. The one imprecision found (a 13-vs-34 count) is
an undercount in the agent's own favour of *less* credit, not more.

**Verdict: PASS.**
