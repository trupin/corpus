# [AGENT-004] Teach the product agent to emit `↳` trace lines in its turns

## Domain

agent-runtime

## Status

done

## Priority

P2

## Model

opus — skill-text authoring against an already-rendered UI convention.

## Dependencies

- Depends on: AGENT-002 (orchestrate skill), SHARED spec amendment (trace grammar)
- Blocks: —

## Spec References

- SPEC.md §6/§7 (agent turns) — **currently defines no trace grammar; the phase-3 spec pass
  proposes it** (a trailing agent-turn line beginning with `↳` naming what the agent did)
- UI-008 (2026-07-28): the thread view already renders a trailing `↳` line as a styled trace
  (arrow re-supplied from CSS), but nothing in the product writes one

## Summary

UI-008 shipped the reader's side of a convention the runtime doesn't have yet: an agent turn
whose last line begins with `↳` renders as a trace ("what I did"), styled distinctly. This issue
teaches the orchestrate/comment skills (assets/workspace) to end action-taking turns with such a
line, once the spec pass lands the grammar. If the spec pass rejects the grammar, close this and
strip the UI affordance instead.

## Acceptance Criteria

- [ ] Skills emit `↳ <past-tense action summary>` as the final line of turns that performed
      writes (per the spec amendment's exact grammar).
- [ ] E2E: a real agent run produces a turn the shipped UI renders as a trace.

## E2E Verification Log

**implemented on: opus.**

**TEST-216 — the spec dependency landed; this issue's own text is stale.** `SPEC.md:183`
("**Trace lines.**") now states the grammar in §6, and §7's comment-skill paragraph reads
"…closing it with a trace line (§6) reporting the actions taken." The Summary's "the phase-3 spec
pass **proposes** it" wording and the "if the spec pass rejects the grammar, close this and strip
the UI affordance" branch are therefore **struck** — the grammar is signed off, and this issue
implements it rather than gating on it.

**Ownership (Adjudication 10 / Open Conflict 3).** AGENT-003 wrote the comment skill's Reply
section complete **except** the trace rule; this issue adds the rule to **both** skills, owns the
grammar statement, the worked-example traces and the template tests. Files carrying this issue's
edits: `assets/workspace/claude/skills/comment/SKILL.md` (trace bullet in Reply, four
worked-example traces + the Reply example's, the "that reply changed nothing, so it carries no
trace line" sentence in the deferral, `updated` → `2026-07-29`),
`assets/workspace/claude/skills/orchestrate/SKILL.md` (trace bullet in Stewardship, the worked
example's trace, the deferral's explicit no-trace comment, `updated` → `2026-07-29`), and
`scripts/workspace-template.test.ts` (`describe("trace lines")`). _Orchestrator correction
(2026-07-29, evaluator H-1): file-level staging put the comment-skill trace edits and the trace
test block into `ac3cf30 [AGENT-003]`; the `[AGENT-004]` commit (`c48a4c6`) carries only the
orchestrate skill + this issue file. Content is correct in the tree; the attribution deviation
from sprint-014 Adjudication 10 was disclosed in the `[AGENT-003]` commit message and is
accepted._ **TEST-228: nothing outside
`assets/workspace/**` and that one test file** — no `trace` field on `Turn`, no UI or contract
change.

**Environment.** Second scratch workspace, `/tmp/corpus-s014-agent004-p5fuWc/ws`, `corpus init …
--port 9135` (AGENT-004's allocated `9135`–`9139`), real server, the **shipped UI served by the
server itself** from `apps/ui/dist` (`GET /` → 200; no Vite, so `5173`/`5273`/`5285` were never
bound and Playwright's runner was never invoked), and a fresh live `claude` session running
`/orchestrate` against the **updated** template. Transcript retained at
`/tmp/corpus-s014-agent004-p5fuWc/transcript.stream.json` (128 stream events; audit → `Bash 19,
Read 2, Skill 1`, zero `Write`/`Edit`, zero raw HTTP, zero git state changes).

| Test | Result | Evidence |
| ---- | ------ | -------- |
| TEST-217 | PASS | The comment skill's Reply section states: final line **and only** the final line, the literal `↳ ` (arrow, space), a one-line **past-tense** action report, and "**A turn whose work changed nothing carries no trace**". |
| TEST-218 | PASS | The orchestrate skill states the same rule in Stewardship for **every** agent turn "including the ones you post yourself", names the comment skill as stating it for its own replies, and its deferral reply carries an explicit `# nothing changed, so that reply carries no trace line`. This is the one sanctioned edit to that file. |
| TEST-219 | PASS | Pinned by `it("$name puts a trace last, or not at all")`: every `↳` line in either skill is immediately followed by the heredoc's `EOF`. Replies that changed nothing (the deferral in both skills) carry none. |
| TEST-220 | PASS | Pinned by `it("$name neither hides the arrow nor dresses it up")` — no "omit the arrow", no `::before`, no markup around the arrow. The skill says the arrow goes into the turn body and that rendering "is not your concern". |
| TEST-221 | PASS | `describe("trace lines")` in `scripts/workspace-template.test.ts`: literal `↳ `, the past-tense/final-line wording, trace-is-last, and no `↳` in any user-authored example line. |
| TEST-222 | PASS | **Live DOM, shipped UI on 9135** (headless Chromium against the served build, not a Vitest DOM). Thread `Re: "90 EUR per day"`: `author=agent hasTrace=true traceText="updated the lift ticket budget in [[doc_oxb7b2cd]] from 90 to 105 EUR per day" ::before="↳ "`. The `textContent` **does not** contain the arrow; the computed `::before` `content` **does**. Screenshot `/tmp/corpus-s014-agent004-A-agent-turn-that-wrote.png`. |
| TEST-223 | PASS | `data/threads/th_jjnydd6x.md` final line of that turn is literally `↳ updated the lift ticket budget in [[doc_oxb7b2cd]] from 90 to 105 EUR per day` — the arrow is in the file's bytes. `git log` → `agent \| doc edit: Winter trip budget (doc_oxb7b2cd) by agent`. |
| TEST-224 | PASS | Follow-up in the already-titled `th_uinzdi6p` ("is APR the same as APY?") — a pure answer, no writes: no `↳` line on disk and `hasTrace=false` in the live DOM. (The *first* turn in that thread **did** write — it titled the standalone thread — and correctly carried `↳ titled this thread`, which is the rule discriminating rather than the agent guessing.) |
| TEST-225 | PASS | A **user** turn whose last line is `↳ this line is mine, not a trace` renders with **no** `.turn-trace`; the arrow appears as ordinary text in the turn body (`splitTrace` short-circuits on `author !== "agent"`). Read-only observation. |
| TEST-226 | PASS | A harness-posted agent turn with a `↳` line **not** last: no `.turn-trace`, the arrow line stays inside the body — which is why the skill's "final line only" rule matters. |
| TEST-227 | RECORDED | `apps/ui/src/thread/Turn.tsx`'s `splitTrace` `.trim()`s the candidate and checks `startsWith("↳")` **without** requiring the trailing space, and runs on attachment-stripped `prose` rather than the raw final line. The skills specify the **strict** grammar (`↳ ` with the space, true final line); the reader's leniency is **not** relied on and **not** fixed here — it was `issues/ui/013-pr10-minor-findings.md` finding (11), which UI-013 fixed in `287fd63` (`TRACE_PREFIX` is now `"↳ "` with the space, read from the raw final line) — _stale cross-reference corrected by the orchestrator, 2026-07-29 (evaluator F-2)_. Related nit for the same issue: `thread.css:64`'s comment ("The arrow is CSS content, never a character in the document's bytes") is true of the DOM but reads as contradicting SPEC §6, where the arrow **is** in the bytes. |
| TEST-228 | PASS | `git status --porcelain` for this half: the two `assets/workspace/claude/skills/*/SKILL.md` files and `scripts/workspace-template.test.ts`. |

Live loop evidence for the trace rule (job log, `.corpus/jobs/evt_hewgfwwwg2xh.jsonl`):
`claimed comment.created on th_jjnydd6x` → `routed to the comment skill` → `read th_jjnydd6x and its
parent doc_oxb7b2cd` → `edited [[doc_oxb7b2cd]] — lift tickets 90 to 105 EUR per day` → `completed —
replied on th_jjnydd6x`. `corpus doc check` over the workspace: `checked 11 documents — no
findings` (exit 0). Server stopped; `9135` and `8765` verified free.

Template suite after both halves:
`VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts` → **91
passed** (TEST-291).

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
