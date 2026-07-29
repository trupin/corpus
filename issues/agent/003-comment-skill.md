# [AGENT-003] Comment skill: thread handling + inbox filing + skill genesis

## Domain

agent

## Status

todo

## Priority

P0

## Model

opus — behavioral rules enumerated in §7/§8; judgment encoded in AGENT-002's charter carries over.

## Dependencies

- Depends on: CLI-003, CLI-006, CLI-010, AGENT-002
- Blocks: PLUGINS-002

## Spec References

- SPEC.md §7 (**comment skill**, agent stewardship, **skill genesis**, job logs, document locks)
- SPEC.md §8 (agent participation semantics) — what requests the agent, targeted `@<subagent>` / `/<skill>` as directives, structured `mentions`/`skills` in the event payload, `engaged` re-triggering, the honest pending indicator
- SPEC.md §6 (threads and anchors) — turn format, anchor context, **standalone threads** (`parent: null`), forms in turns
- SPEC.md §11 (capture filing) — quick creation lands in `data/docs/inbox/`; Capture creates an inbox document plus an agent-requested filing thread; "the agent files inbox arrivals per its skill"
- SPEC.md §15 M5 — the executable check the loop plus this skill must satisfy (corrected per sprint-014 Adjudication 15)

## Summary

Write the real `.claude/skills/comment/SKILL.md` — everything the product agent does once the orchestrate loop hands it a thread event. It replaces the AGENT-001 skeleton at `assets/workspace/claude/skills/comment/SKILL.md`.

> **Attribution requirement (CLI-003 adjudication, 2026-07-27):** same as AGENT-002 — the CLI defaults `--from` to `user`; agent-side calls MUST set `CORPUS_FROM=agent` or pass `--from agent`, or thread replies and edits will be misattributed in git.

This is where the system's conversational behavior lives: gathering the right context for the three thread shapes (anchored, whole-document, standalone), honoring targeted mentions and skill invocations as directives rather than hints, doing the actual work through the CLI, filing inbox captures, replying in a way that closes the loop for a waiting user, continuing through form answers, and codifying recurring patterns into skills. It inherits AGENT-002's invariants verbatim — CLI-only, archive-never-delete, defer on user locks, log progress — and adds the thread-level judgment on top.

## Acceptance Criteria

- [ ] `assets/workspace/claude/skills/comment/SKILL.md` contains real behavioral prose (no skeleton remnants) with frontmatter shape unchanged from AGENT-001: both Claude Code fields (`name: comment`, `description`) and Corpus fields (`id`, `type: skill`, `title`, `status`, `created`, `updated`, `tags`, `evergreen`), `updated` advanced.
- [ ] The skill contains all **required sections** listed in Technical Design, each covering the behavioral rules enumerated there.
- [ ] Context gathering is specified for all three thread shapes: **anchored** (read the thread, the parent document, and the anchor quote with its surrounding context), **whole-document** (thread + parent, no anchor), **standalone** (`parent: null`, no anchor — the thread _is_ the context), all through `corpus` read verbs, with the rule that a standalone thread gets a good title set through a document edit after the first exchange.
- [ ] Structured routing from the event payload is specified: a targeted `@<subagent>` mention is a **directive** — route the work to that subagent; `/<skill>` applies that skill to the thread/document context; both may combine; generic `@agent` leaves routing to normal triage; a **missing or archived target** means proceed sensibly with the request anyway and say so explicitly in the reply. The skill reads the payload's `mentions`/`skills` fields and does not re-parse the turn text.
- [ ] Doing the work is specified across its shapes: answer directly; edit the parent document through `corpus doc edit`; create documents; spawn a subagent for large work, with the handoff back through `agent.done` described so the orchestrate loop can resume it.
- [ ] Inbox filing is specified concretely for `data/docs/inbox/` arrivals: retitle, move out of `inbox/` into the right folder, expand the capture into a usable document, tag it — with a stated filing convention (how to choose a folder, when to keep it in `inbox/` and ask instead of guessing) and the exact CLI verbs used.
- [ ] Reply mechanics are exact: `corpus thread reply <id> --from agent` with a quoted heredoc; the reply **states any document changes made**, referencing changed documents by `[[id]]`; guidance on reply length and tone; never post a reply by editing the thread file.
- [ ] Engagement semantics are stated (the server sets the flag; the skill states the consequence): the first agent reply makes the thread `engaged`, after which **every later user turn re-triggers the agent** unless the thread is `resolved` or the turn was posted note-only — so the agent should resolve or say when it considers a matter closed rather than leaving threads to accumulate.
- [ ] Form handling is specified in both directions: emitting a `form` block in a turn when a small, well-bounded choice would unblock the work; and handling `form.respond` as a **continuation of the same conversation** — read the answer turn, resume from where the form was raised, do not restart the exchange.
- [ ] Skill genesis is specified per §7: recurring patterns, stated preferences, and repeated corrections across threads get codified into a new skill document or an extension of an existing one, created/edited through the CLI, and **announced in the reply**; with a stated threshold for what earns a skill versus a note in a document.
- [ ] Inherited constraints are restated compactly and not contradicted: CLI-only (never hand-edit files, never call the API directly), the agent archives and never deletes, defer on user-locked documents rather than forcing, emit `corpus job log` lines at meaningful steps.
- [ ] Every `corpus …` command appearing in the skill exists in the generated `docs/cli.md` — enforced by the automated test introduced in AGENT-002.
- [ ] Verified by running the real loop against a real workspace across all four entry shapes: anchored comment, whole-document comment, standalone Ask, and Capture filing — plus a form round trip and a targeted `@<subagent>` invocation (E2E log).

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/comment/SKILL.md` — the real skill (replaces the AGENT-001 skeleton body; frontmatter shape preserved, `updated` advanced)
- `scripts/workspace-template.test.ts` — extend the AGENT-002 assertions to cover the comment skill's required sections, required rules, and CLI-command existence
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — touch **only** if routing wording needs to match the comment skill's entry contract; do not duplicate comment rules there

### Key Implementation Details

**Required sections of the skill** (wording flexible, coverage is not):

1. **When this runs** — invoked by the orchestrate skill for `comment.created` and `form.respond`; the event payload carries `threadId`, `parentId` (may be null), and the structured `mentions`/`skills` fields.
2. **Inherited invariants** — a short restatement pointing at the orchestrate skill: CLI-only, archive-never-delete, defer on user locks, log progress. Short enough to be read every time; the authority stays in one place.
3. **Gather context** — the read verbs to run for each thread shape, in order, and when to stop reading. Anchored: the thread's turns, the parent document, and the anchor quote plus enough surrounding text to understand what the comment points at (an orphaned anchor still carries its last selector — say so and work from the thread). Whole-document: thread plus parent. Standalone: the thread alone is the whole context; also state the follow-up obligation to set a real title after the first exchange, via a document edit on the thread (a thread is a document).
4. **Honor the routing directives** — `@<subagent>` routes, `/<skill>` applies, both combine, generic `@agent` triages normally. Read them from the payload, not from the prose. Missing or archived target: do the useful thing anyway and name the deviation in the reply ("`@researcher` isn't defined here, so I handled this directly").
5. **Do the work** — the menu, with a decision rule for each: answer in the reply; edit the parent (`corpus doc edit`, anchors reconcile automatically on save — do not hand-maintain anchors); create documents when the answer is durable; spawn a subagent when the work is long enough that the user should not wait on a single turn, with the `agent.done` wake-back described.
6. **Inbox filing** — the `data/docs/inbox/` protocol: read the capture, give it a real title, expand it into something usable, choose a destination folder, move it, tag it, and reply with what it became and where it lives. State the filing convention: prefer an existing folder that already holds similar documents (check the tree), create a new folder only when a genuine category is missing, and when the right home is genuinely ambiguous leave it in `inbox/` and ask — a form is the right instrument for a two-or-three-way choice.
7. **Reply** — the heredoc form, what a good reply contains (the answer, then what changed, with `[[id]]` refs to changed documents), how long it should be, and the rule that a reply is always posted, even when the outcome is "nothing to do", because a waiting user is watching a pending indicator.
8. **Engagement and closure** — the `engaged` semantics and their consequence for how the agent ends a turn; when to suggest resolving; that the agent does not resolve a thread on the user's behalf unless the user asked for the matter to be closed.
9. **Forms** — when to raise one (bounded choice that unblocks work; not for open questions, which are just replies), and how `form.respond` resumes the same conversation rather than restarting it.
10. **Stewardship in service of a thread** — the opportunistic half of the §7 charter as it applies here: while in a document, fix what is obviously stale, misfiled, or duplicated, and say so in the reply. Never silently destructive; archive, never delete.
11. **Skill genesis** — what earns codification (a preference stated more than once, a correction repeated across threads, a workflow the user keeps describing), where it goes (extend an existing skill when one fits; create a new skill document otherwise), how it is written (through the CLI, with both frontmatter field sets so Claude Code and Corpus both see it), and that it is announced in the reply so the user can push back.
12. **Worked examples** — four short traces with literal commands: an anchored comment that edits the parent, a standalone Ask that becomes a titled thread plus a created document, an inbox Capture filed end to end, and a `form.respond` continuation.

**Writing standard.** Same bar as AGENT-002: imperative, second person, decision rules over "consider". Do not restate the orchestrate skill's loop mechanics — this skill is entered with an event already claimed and exits leaving the terminal-state call to the orchestrator.

**Command accuracy.** Read `docs/cli.md` before writing any command and use only verbs and flags that exist. Thread reads, document reads, `corpus doc create|edit|move|archive`, and `corpus thread reply` all come from CLI-003; if a verb this skill needs is missing, **escalate to the orchestrator for a CLI issue** rather than writing an aspirational command. The AGENT-002 test enforces this permanently.

**Heredoc convention** (same as the orchestrate skill):

```
corpus thread reply th_x9y8 --from agent <<'EOF'
6.4% is more representative than 6.1% — updated the assumption in [[doc_a1b2c3]].
EOF
```

**Boundary with PLUGINS-002.** Plugin skills handle their own event types; this skill handles core thread events only. Where a thread's request falls into a plugin's domain (e.g. "add a todo for this"), the skill invokes the plugin's skill rather than manipulating plugin document types directly — state that rule, since it is what PLUGINS-002 builds on.

### Edge Cases

- **Anchored thread whose anchor is orphaned** — the selector no longer resolves; the thread still functions. Work from the thread's content, say the anchor drifted if it matters, and never attempt to hand-repair the `anchors` map.
- **Parent document is user-locked** — defer the edit per the inherited rule, and reply saying the edit is queued behind the user's editing session rather than going silent.
- **Parent document was deleted** between the comment and handling — reply in the thread explaining; do not recreate the document.
- **Note-only turn** — never produces an event; if one somehow arrives, handle it normally and do not treat the absence of a request as an error.
- **A turn that is attachment-only** — no text, just an image or file; the request is the attachment. Read it and respond to it.
- **Standalone thread that stays trivial** — not every Ask deserves a created document; the reply may be the whole answer. Say when the answer was durable enough to write down and when it was not.
- **Capture whose text is one ambiguous line** — expanding it must not invent facts; expand structure (title, headings, an open-questions section), not content, and ask if the intent is unclear.
- **Repeated correction that contradicts an existing skill** — genesis becomes an *edit* to that skill, not a second skill saying the opposite; state that conflict-resolution rule.
- **Long work spawned to a subagent** — the user should get an acknowledging reply immediately, not silence until `agent.done`.
- **The thread is about a skill document** (§7's behavioral feedback loop: commenting on an instruction inside `orchestrate` or `comment`) — this is legitimate and expected; edit the skill through the CLI, announce it, and mention the rollback path in case the change misbehaves.

## Testing Strategy

Vitest, extending `scripts/workspace-template.test.ts` with the same machinery AGENT-002 introduced:

- **Frontmatter preserved**: `name: comment` matches the directory; both field sets present; `type: skill`.
- **Required sections present**: assert on the section list so a future edit cannot silently drop inbox filing, forms, or skill genesis.
- **Required rules present**: literal assertions for `corpus thread reply`, `--from agent`, the heredoc form, `corpus doc move`, `corpus doc archive`, and phrases covering standalone-thread titling, `engaged` re-triggering, missing/archived mention targets, archive-never-delete, and skill genesis being announced in the reply.
- **CLI command existence**: every extracted `corpus …` invocation resolves against `docs/cli.md`.
- **No placeholders** and no contradiction with the orchestrate skill: assert the comment skill does not redefine queue terminal-state handling (a crude but effective guard against the two skills drifting apart on who completes events).

Conversational quality is not unit-testable; the E2E plan is the proof.

## E2E Verification Plan

### Reproduction Steps (bugs only)

_N/A — feature issue._

### Verification Steps

Real workspace, real server, real UI, a live `claude` session running `/orchestrate` — every path exercised through the real interfaces.

1. `corpus init` a scratch workspace; `corpus server start`; open the board; start `claude` and invoke `/orchestrate`.
2. **Anchored comment**: create a document with a factual claim in it; select text in the UI, comment `@agent is this still right?` → the agent reads the anchor context, edits the parent through the CLI, and replies stating the change with a `[[ref]]`. Confirm: the agent turn appears via SSE, the file on disk changed, `git log` shows the edit authored by the agent, and the anchor still resolves after the edit (highlight intact).
3. **Whole-document comment**: comment on the document as a whole with a request that creates a new document → confirm the new document exists on disk with valid frontmatter, appears in the board, and is referenced from the reply.
4. **Standalone Ask**: use the global composer's Ask with an open question → confirm a `parent: null` thread is created, answered, and **retitled** by the agent after the exchange (title visible in the board row, changed on disk).
5. **Capture filing**: use the composer's Capture with a one-line thought → confirm the inbox document is retitled, moved out of `data/docs/inbox/` into a sensible folder, expanded, tagged, and that the filing thread's reply says what it became and where it went. Confirm via `GET /api/tree` and the file's new path.
6. **Ambiguous capture**: capture something whose destination is genuinely unclear → confirm the agent asks (a form or a direct question) instead of guessing, and that the document stays in `inbox/` meanwhile.
7. **Form round trip**: from step 6's form, answer it in the UI → a `form.respond` event is enqueued, the agent resumes the same conversation (does not restart), and completes the filing.
8. **Targeted invocation**: define a subagent persona document under `.claude/agents/`, comment with `@<that-subagent>` → confirm the work is routed there (visible in the job log). Then comment with `@<nonexistent>` → confirm the agent proceeds sensibly and **says so** in the reply.
9. **Skill invocation**: comment with `/<skill>` on a document → confirm that skill is applied.
10. **Engaged re-trigger**: reply again in an engaged thread with no `@agent` → confirm the agent responds anyway; mark the thread resolved and reply once more → confirm it does not.
11. **Skill genesis**: state the same preference across two threads → confirm the agent creates or extends a skill document under `.claude/skills/`, that it is indexed as `type: skill` and visible on the board, and that the reply announces it. Then verify `corpus skill rollback` can undo it.
12. **Lock deferral**: hold the parent's lock in the UI editor, post an edit request → confirm the reply says the edit is queued and the edit lands after the lock clears.
13. **Archive-not-delete**: ask the agent to "get rid of" an obsolete document → confirm it archives (`status: archived`, restorable) and never deletes.

Record exact commands, API responses, file diffs, and console/job-log excerpts for each step.

## E2E Verification Log

### Reproduction (bugs only)

_N/A — feature issue._

### Post-Implementation Verification

**implemented on: opus** (per CLAUDE.md's Record-actuals rule / TEST-215).

**Environment.** Scratch `/tmp/corpus-s014-agent003-aapyWT`; workspace `.../ws` created by
`corpus init … --port 9130` (inside AGENT-003's allocated `9130`–`9134`; the orchestrator's brief
named `9130`, the contract's table `9132` — either is in range). Real server (pid 40529), real
from-source CLI through a `$SCRATCH/bin/corpus` wrapper on `PATH`, and a **live `claude` session**
running `/orchestrate` with
`--output-format stream-json --verbose --allowedTools "Bash(corpus *)" Read Glob Grep Skill Task TodoWrite`.
User-side actions (creating threads, captures, form answers) went through the **HTTP API**, which is
what the UI itself calls — the CLI has no thread-create verb; every **agent-side** action went
through the CLI.

**Transcript retained (TEST-214):** `/tmp/corpus-s014-agent003-aapyWT/transcript.stream.json`
(435 stream-json lines). Audit script: `/tmp/corpus-s014-agent003-audit.js`.

| Test | Result | Evidence |
| ---- | ------ | -------- |
| TEST-196 | PASS | Loop parked on `idle`; 12 events claimed and settled. Final `corpus queue status`: `pending 0, in-progress 0, processed 12, failed 0, abandoned 0`. Job logs in `.corpus/jobs/*.jsonl` carry claimed → routed → acted → terminal lines. |
| TEST-197 | PASS | Anchored comment on `doc_tj4fupcq` (`th_nqftjave`). Agent turn posted; `git log` → `agent \| doc edit: Mortgage options (doc_tj4fupcq) by agent`; body on disk changed 6.1% → 6.6%; reply named `[[doc_tj4fupcq]]`; **anchor still resolves**: `corpus doc show` → `anc_a11ae2f4 → th_nqftjave (open) · chars 23–53 · "assume a 30-year fixed at 6.6%"` (later `chars 89–119` after the deferred edit landed). |
| TEST-198 | PASS | Whole-document comment on `doc_e3rc5ioy` → agent created `doc_oxxcngzl` (`data/docs/kitchen/espresso-dial-in-routine.md`), edited the parent to link it, reply referenced both by `[[id]]`. |
| TEST-199 | PASS | Standalone Ask (`th_fssjehws`, `parent: null`) answered and **retitled** to "Fixed vs variable mortgage rates"; `git log` → `agent \| doc edit: Fixed vs variable mortgage rates (th_fssjehws) by agent`. |
| TEST-200 | PASS | Capture `doc_jzomuq7m` retitled "Replace the wagon's tires before winter", **moved out of `inbox/`** into a new `car/`, expanded with an open-questions section, tagged `car`/`maintenance`; reply said what it became and where. `GET /api/tree` → `car(2), finance(4), inbox(1), kitchen(5), tasks(2), templates(1), views(3)`. |
| TEST-201 | PASS | Capture "sam — thursday?" → agent **asked** with a ` ```form ` block (3 options) and left `doc_tw6227ov` in `data/docs/inbox/sam-thursday.md`. |
| TEST-202 | PASS | Form answered via `POST …/turns/{ts}/form` (`option: "a reminder to ask or message Sam about Thursday"`, `note: "about the ski trip"`). Agent **resumed**: filed into `tasks/`, folded the note into the body, no re-ask. Answer turn and continuation both in `data/threads/th_iqka6346.md`, in order. |
| TEST-203 | PASS | `.claude/agents/researcher.md` written out of band (no CLI verb writes there — Open Conflict 1). Payload `mentions: [{name: "researcher", docId: "doc_agentresearcher", status: "open"}]`; transcript shows one `Agent` (subagent) call prompted as the researcher persona; job log: `routed to @researcher — background subagent checking sources`, then `acknowledged on th_aapo7vff — awaiting researcher result` — i.e. the "acknowledge immediately" edge case, live. |
| TEST-204 | PASS | Same event's payload `unresolved: ["@nobody"]`; the agent proceeded and said so verbatim: "`@nobody` doesn't name anything in this workspace, so the researcher handled it alone." |
| TEST-205 | PASS | `/fixture-notes` comment → payload `skills: [{name:"fixture-notes", docId:"doc_skill138ec106", status:"open"}]`; transcript `SKILL: {"skill":"fixture-notes",…}`; job log `routed to the fixture-notes skill`. |
| TEST-206 | PASS | Engaged re-trigger: plain user turn with **no `@agent`** in `th_icqjrx64` enqueued `evt_2tvlzqj45sbd` and the agent replied. After `corpus thread resolve th_fssjehws`, a plain reply returned `eventId: null` and the queue depth was unchanged (12 → 12). *Observation, not a defect*: a reply carrying an explicit `@agent` **into a resolved thread** does enqueue — `participation.ts` documents this as sprint-006 Adjudication 5 ("resolving suppresses the *automatic* re-trigger; it is not a mute button on someone deliberately typing `@agent`"). `docs/cli.md`'s "a resolved thread enqueues nothing" is a simplification of that rule. |
| TEST-207 | PASS | Note-only turn (`requestsAgent: false`) in engaged `th_fssjehws` → `eventId: null`, depth `pending 2` before and after. |
| TEST-208 | PASS | `corpus lock acquire doc_tj4fupcq --from user` held. Agent **replied first** ("You're editing [[doc_tj4fupcq]] right now, so I haven't touched it…"), then `.corpus/jobs/evt_ndgzabbzws55.jsonl` → `deferred: doc_tj4fupcq is locked by user`, then the orchestrate skill failed the event. After `corpus lock release` + `corpus job retry evt_ndgzabbzws55`, the edit **landed** (one-line summary at the top of the note) and the anchor still resolved. |
| TEST-209 | PASS | "get rid of it" → `git log` `agent \| doc archive: Old phone plan comparison (doc_z4egnag3) by agent`; `corpus doc show` → `status: archived`, file present. No `doc delete` anywhere in the transcript. |
| TEST-210 | PASS (extension path, per Adjudication 8) | A stated preference ("always lead with the number… I keep having to ask") → agent ran `corpus doc edit doc_skillcomment --from agent`, adding a "**Lead with the number.**" rule to the Reply section; committed as `agent \| doc edit: Comment (doc_skillcomment) by agent`; indexed as `type: skill`; the reply **announced it** and named the rollback path. The "creates a new skill" half is **STRUCK → Adjudication 8** (no write path outside `data/docs/`). |
| TEST-211 | PASS | `corpus skill rollback comment --from user` → `restored .claude/skills/comment/SKILL.md in commit 2c519fb…`; `git log` shows `user \| skill rollback: comment (doc_skillcomment) to a23563f by user`; the added rule is gone (grep count 0). |
| TEST-212 | PASS | Transcript audit: `Bash 60, WebSearch 9, Skill 2, ToolSearch 2, Read 1, Agent 1, WebFetch 1`. **Zero** `Write`/`Edit`/`NotebookEdit` calls, **zero** `curl`/`fetch`/raw-HTTP, **zero** state-changing git. 57/60 Bash calls start with `corpus`; the 3 others are `export CORPUS_FROM=agent && corpus …`, `ls …/data/docs/`, `head -14 …/.claude/skills/comment/SKILL.md`. |
| TEST-213 | PASS | 13 `corpus thread show` / `corpus doc show` invocations. The only direct filesystem reads are the two above: a `data/docs/` **folder survey** (exactly Adjudication 9's ruling) and a **content** read of the skill file before editing it through the CLI. Nothing under `.corpus/` was parsed. |
| TEST-214 | PASS | Path recorded above; TEST-212/213 claims are derived from it. |
| TEST-215 | PASS | implemented on: opus. |

Also observed: `corpus doc check` over the finished workspace → `checked 24 documents — no findings` (exit 0).

**Rider — the template manifest (TEST-229 – TEST-233, Adjudication 14 / Open Conflict 7).**

- TEST-229 (analysis + recommendation): (a) the blanket `.corpus/*` rule's own comment enumerates
  *secret* (`config.json`), *derived* (`cache.db`), *transient* (pid/log/jobs/locks/attachments/
  seen/HALT) — the install manifest is **none of the three**; it is provenance carrying a
  `toolVersion`. (b) `scaffoldWorkspace` writes it **before** `commitAll`'s `git add --all`, so a
  freshly initialised workspace still comes out clean. (c) `upgrade.ts:191` already asks git
  (`isIgnored` → `git check-ignore --quiet`), so the tracked case needs **no code change**.
  (d) **Recommendation: un-ignore it** — a clone then carries its own upgrade baseline instead of
  degrading to the `withoutBaseline` path. Done.
- TEST-230: one negation added to `assets/workspace/gitignore` after `.corpus/*`, with a comment in
  the file's voice. No other rule line changed.
- TEST-231: live `corpus init` into the scratch dir → `git status --porcelain` **empty**;
  `git ls-files` under `.corpus` lists the five queue `.gitkeep`s **plus**
  `.corpus/template-manifest.json`; `git check-ignore .corpus/config.json` still matches.
- TEST-232: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/ apps/cli/src/commands/init apps/cli/src/commands/workspace apps/cli/src/template` → **17 files, 330 tests, all green**. The three
  directly-caused updates: `init/index.test.ts`'s tracked-set test (manifest added to the `toEqual`
  list, removed from the `check-ignore` loop, name updated); `upgrade.test.ts`'s `makeTemplate()`
  now mirrors the shipped rules (manifest un-ignored) so `it("commits the manifest when the
  workspace does track it")` needs no override; and the "touching only template paths" test now
  **synthesizes an ignoring template itself**. Both branches of `isIgnored` stay covered.
- TEST-233: covered by the green `upgrade.test.ts` branch — `manifestCommitted: true` and the commit
  lists `.corpus/template-manifest.json` alongside the changed template file.

Two prose fixes fall out of the same change and ship in the same commit:
`docs/workspace-template.md` (the parenthetical claiming `.gitignore` covers all of `.corpus/`
except the queue skeleton) and `assets/workspace/README.md` (same claim, product-side).

**Mechanical half.** `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts`
→ green. TEST-168–TEST-175 and TEST-176–TEST-195 are covered by the new
`describe("comment skill body")` block plus the pinned tests, which pass unchanged;
**TEST-174 is green with `CLI_COMMANDS_PENDING_CLI_006` still `[]`** — no allowlist entry added.
TEST-195: the orchestrate skill is **untouched by the `[AGENT-003]` commit**; its only edit this
sprint is AGENT-004's sanctioned trace rule (TEST-218).

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[AGENT-003]` prefix
