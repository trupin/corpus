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

- Depends on: CLI-003, AGENT-002
- Blocks: PLUGINS-002

## Spec References

- SPEC.md §7 (**comment skill**, agent stewardship, **skill genesis**, job logs, document locks)
- SPEC.md §8 (agent participation semantics) — what requests the agent, targeted `@<subagent>` / `/<skill>` as directives, structured `mentions`/`skills` in the event payload, `engaged` re-triggering, the honest pending indicator
- SPEC.md §6 (threads and anchors) — turn format, anchor context, **standalone threads** (`parent: null`), forms in turns
- SPEC.md §11 (capture filing) — quick creation lands in `data/docs/inbox/`; Capture creates an inbox document plus an agent-requested filing thread; "the agent files inbox arrivals per its skill"
- SPEC.md §15 M4 — the executable check the loop plus this skill must satisfy

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

_[Agent fills]_

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output, confirmation feature works]_

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
