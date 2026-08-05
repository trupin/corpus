# [AGENT-011] Orchestrate: reflect-on-edit handling for doc.edited events

## Domain
agent-runtime

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CLI-026
- Blocks: —

## Spec References
- SHARED-008 rider; SPEC §7/§8 loop; AGENT-008 retrieval-first rules

## Summary
Teach the orchestrate skill to handle `doc.edited`: fetch the diff via
`corpus doc diff` (the event's range), reflect, act. The reflection is
retrieval-first: from the changed content, `corpus search`/`corpus doc
related` to find documents the change ripples into; where it does, update
them (ordinary stewardship edits, stated in a reply/trace) or open a
comment where the right move is a question; where it does not, acknowledge
briefly on the document's own surface (a short whole-document-thread note or
the established acknowledgment convention — decide against the existing
thread conventions, don't invent a new surface). Judgment guidance: trivial
edits (typos, formatting) get silent completion (complete the event, no
acknowledgment spam); substantive edits get the reflection. The skill must
restate the actor-scoping guarantee (its own edits never produce events) so
the model doesn't defensively self-suppress.

## Acceptance Criteria
- [x] Orchestrate SKILL.md handles doc.edited with the reflect procedure and
      the triviality guidance; fits section-count constraints (see domain
      knowledge 2026-08-02)
- [x] One worked example (fetch diff → related check → one update + trace)
- [x] E2E: real queue drill — user edit → event → agent session reflects,
      updates a genuinely related doc, completes the event

## Technical Design
### Files to Create/Modify
- assets/workspace/claude/skills/orchestrate/SKILL.md; template tests

## Testing Strategy
Skill-text assertions; the real drill per the E2E plan.

## E2E Verification Log

**Model.** Implemented on **Opus 5 (1M context)**. The three drill sessions ran on
Claude Code 2.1.221 defaults; each dispatched one subagent (Opus 5 once, Sonnet twice —
tier chosen by the skill's own weight rule).

**Environment.** Scratch workspace `/tmp/agent011-ws` (retained, with all three
transcripts, at `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s0xx-agent011`).
`corpus init . --port 9761` from built output (`apps/cli/dist/bin/corpus.js`, exposed on
PATH as `corpus`); server pid 39386. Ports 8765 and 5173 untouched.
`.corpus/config.json` got `editAcknowledgment.idleMs: 5000` so §4's three-minute
acknowledgment window fires in seconds — the **idle** end path, not a flush shortcut, so
every event below was produced by the real session-end detector.

**How each event was produced.** A real user edit through the editor's own route —
`corpus doc edit <id> --from user` is `PUT /api/docs/{id}`, which is what opens a §4 edit
session — then the idle window elapsing. No event was hand-written into the queue.

| # | Drill | Event | Payload stats | Outcome |
| - | ----- | ----- | ------------- | ------- |
| A | Substantive, ripple is a **question** | `evt_tb2xbupqm3oe` on `doc_noi36tko` | `1 commit, +2 -2` | anchored comment on `doc_mvpxrkv3` + whole-document acknowledgment; `complete` |
| B | **Trivial** | `evt_z5s6iedca6rz` on `doc_sucn5uv7` | `1 commit, +2 -2` | job log only, **no thread, no write**; `complete` |
| C | Substantive, ripple is **entailed** | `evt_gq2hfxyx72nm` on `doc_32q4k4k5` | `1 commit, +2 -2` | `corpus doc edit` on `doc_uhb6qalr` + acknowledgment with trace line; `complete` |

**A and B carry byte-identical stats.** That is the point of the drill, and it is the
evidence for the skill's central rule: `+2 -2` is a rate assumption moving 6.1% → 6.4%
(A) and it is `tomatos` → `tomatoes` (B). Nothing in the payload separates them, so the
skill fetches the diff on every event and decides triviality from the changed claims.
Had the skill triaged on stats, one of these two would have been handled wrongly.

**A — substantive, ripple is a question.** Event payload
`{"docId":"doc_noi36tko","sessionId":"es_8141e24454974645","actor":"user","endedBy":"idle","from":"ed00ab12…","to":"6a6b04d9…","stats":{"commits":1,"insertions":2,"deletions":2}}`.
Transcript shows `corpus doc diff doc_noi36tko --from-rev ed00ab123926b008691ac38bce78e2cbeca65eda --to-rev 6a6b04d9a1d02cde159ba08f6b415d3c49c1e0a0`
— both shas passed through verbatim, one call, whole (650 characters, not cut). Ripple
check was exactly the two bounded lookups: `corpus doc related doc_noi36tko --limit 5`
and `corpus search "6.1% rate assumption" --limit 5`, then one `corpus doc show
doc_mvpxrkv3`. It **commented rather than updated**, and said why: "the new break-even is
a recalculation rather than a substitution" — the skill's mechanical-and-entailed test
applied correctly to a derived conclusion. Anchored thread `th_4htcy3km` landed on the
quoted span (`anchor anc_e655ed9f`); acknowledgment `th_bvpwm6nr` is a whole-document
thread on the edited note (`anchor — · whole document`). Neither turn carries a trace
line, because neither wrote a document — correct.

**B — trivial, and silent.** `corpus doc diff doc_sucn5uv7 --from-rev 876fd096… --to-rev
e0912a1f…` → whole, 512 characters; body change is `tinned tomatos` → `tinned tomatoes`
plus the frontmatter `updated` bump. Judged trivial, so the ripple check never ran at all
(transcript audit: **0** `doc related`, **0** `search`, **0** `thread create`, **0**
`doc edit`). The whole record is the job log:

```
{"line":"claimed doc.edited on [[doc_sucn5uv7]] (1 commit, +2 -2, ended by idle)"}
{"line":"dispatched to a doc-edit-reflection subagent (Sonnet — single document, bounded ripple check)"}
{"line":"doc.edited on [[doc_sucn5uv7]] — fixed a spelling typo (tomatos -> tomatoes), no claim changed"}
{"line":"completed — trivial edit, no thread opened"}
```

`corpus doc list --type thread` before and after drill B: **2 threads both times**. The
console shows the event was seen and judged; the corpus shows nothing.

**C — substantive, entailed, so an update.** User replaced a name (`Dana Whitfield` →
`Priya Raman`) in `doc_32q4k4k5`; `doc_uhb6qalr` restated the same fact in the same form,
with one way to write the new one. Diff read once (569 characters, whole), `doc related`
+ `corpus search "Dana Whitfield"` + one `corpus doc show doc_uhb6qalr`, then
`corpus doc edit doc_uhb6qalr --from agent <<'EOF'`. `corpus doc show doc_uhb6qalr` now
reads "escalate to the on-call rotation lead, Priya Raman." The acknowledgment on the
edited document states the change and closes with the trace as its final line:

```
agent · 2026-08-05T07:02:05Z
The edit changed the on-call rotation lead from Dana Whitfield to Priya Raman. I checked
related documents and found the Escalation path doc restating the old name, so I updated
it to match.
↳ updated [[doc_uhb6qalr]]'s on-call rotation lead name from Dana Whitfield to Priya Raman to match this edit
```

`git log`: `fd0edda agent comment: new thread on doc_32q4k4k5 (th_g46kq564) by agent` /
`4408289 agent doc edit: Escalation path (doc_uhb6qalr) by agent` / `858197d user doc
edit: Team contacts (doc_32q4k4k5) by user` — authorship correct on every mutation.

**Cascade: proven absent, not argued.** Drill C's reflection performed a real
`PUT /api/docs/{id}` on `doc_uhb6qalr` as the agent, and three agent-authored thread
creations landed across the three drills (one of them *anchored*, which writes the
parent's frontmatter). Final queue after all of it, well past the 5-second window:
`pending 0, in-progress 0, deferred 0, processed 3, failed 0, abandoned 0` — three events
total, all user-produced. No agent write produced an event. Both mechanisms held: the
server never opens an edit session for a non-user actor, and every agent thread shows
`agent none` with **0** `--requests-agent` flags across all three transcripts, so no
`comment.created` was enqueued either.

**Transcript audit** (`node` over the retained `stream-json`; subagent tool calls appear
in the parent stream):

| Transcript | events | tools | `doc diff` | `related` | `search` | `doc edit` | `thread create` | `complete` | `fail` | `lock break` | `--requests-agent` | corpus sweeps |
| ---------- | ------ | ----- | ---------- | --------- | -------- | ---------- | --------------- | ---------- | ------ | ------------ | ------------------ | ------------- |
| `transcript-ripple.jsonl` | 65 | `{Bash: 11, Agent: 1}` | 1 | 1 | 1 | 0 | 2 | 1 | 0 | 0 | 0 | 0 |
| `transcript-trivial.jsonl` | 44 | `{Bash: 7, Agent: 1}` | 2 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| `transcript-update.jsonl` | 65 | `{Bash: 14, Agent: 1}` | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 |

**Zero `Write`/`Edit` tool uses in all three sessions** — the CLI-only invariant held; no
shell redirection, `tee` or `sed -i` writes either. Zero `lock break`, zero `queue fail`,
zero directory sweeps. `doc diff` is 1 per event except drill B, where the orchestrator
re-read the same range itself to verify the subagent's trivial call before settling.

**Skill-text tests.** `scripts/workspace-template.test.ts` — 109 passed, including the
new `doc.edited` describe block (8 cases) and the section count moved 15 → 16.
`npx prettier --check` clean on both touched files.

**Observations, not blockers.** (1) Two sessions passed reply bodies with `-m` instead of
the heredoc the skill's examples use; content and trace placement were correct, and the
CLI documents `-m`, so this is style rather than a violation. (2) Drill B's session
guessed at a `corpus job show` verb that does not exist and recovered by reading
`corpus job list`; the skill never names that verb.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
