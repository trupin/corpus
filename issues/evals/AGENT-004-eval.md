# Evaluation: AGENT-004 (`↳` trace lines in agent turns)

**Date**: 2026-07-29
**Sprint**: sprint-014, tests TEST-216–TEST-228
**Commit under test**: `c48a4c6 [AGENT-004] Emit trace lines in agent turns` (with content also in `ac3cf30` — see finding H-1)
**Verdict**: **PASS** (with one commit-attribution finding for orchestrator adjudication)

---

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                          |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | `issues/agent-runtime/004-emit-trace-lines.md`, filled, per-test table for TEST-216–TEST-228.                                                                    |
| Commands are specific and concrete      | PASS   | Real thread ids (`th_jjnydd6x`, `th_uinzdi6p`, `th_nhwnsvuu`), real doc id `doc_oxb7b2cd`, quoted `::before` value, named screenshot path.                       |
| Real E2E (not mocked)                   | PASS   | A second live `claude` session against a real workspace + real server, and a **headless browser against the server-served build** — explicitly not a Vitest DOM. |
| Scenarios cover acceptance criteria     | PASS   | Positive trace, no-write turn, user arrow, mid-body arrow, file bytes, and both skills' text.                                                                    |
| Application restarted after changes     | PASS   | Fresh workspace `corpus init … --port 9135`, fresh session against the **updated** template.                                                                     |
| Actual model recorded (implemented on:) | PASS   | Line 47: "**implemented on: opus.**"                                                                                                                            |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue.                                                                                                                                                  |

---

## Criteria Results

Environment for the evaluator's own re-derivation: AGENT-004's retained workspace
`/tmp/corpus-s014-agent004-p5fuWc/ws` copied to `/tmp/corpus-s014-eval2-zcfHex/ws4` (port re-pointed to
**9171**, inside this evaluator's allocated range), served by a real `corpus server start --workspace …`
(pid 66119) with the **shipped UI served by the server itself** — no Vite, `5173`/`5174`/`5273`/`5287`/`8765`
untouched. Browser: headless Chromium driven through `playwright-core` directly (not the Playwright runner;
`npm run e2e` never invoked). Server stopped by pid; `9171` verified free afterwards.

| #        | Result   | Evidence (evaluator-derived unless noted)                                                                                                                                                                                                                                                                                                                                                       |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-216 | PASS     | `SPEC.md:183` reads "**Trace lines.** An agent turn may close with a **trace**: a final line beginning with `↳ ` …" and states every element the issue needed: past-tense action report, **final line only**, **agent turns only** ("a `↳ ` line anywhere else in a turn body is ordinary markdown"), "a turn whose work changed nothing simply carries no trace", "no dedicated field or markup beyond the line itself". `SPEC.md:247` (§7) reads "…closing it with a trace line (§6) reporting the actions taken." The grammar **has landed**; the issue's stale "proposes it" / "if the spec pass rejects the grammar, close this" wording is struck in the log, as required. |
| TEST-217 | PASS     | `comment/SKILL.md:235-242` states, verbatim: final line "**— and only its final line —**"; the literal `↳ ` (arrow, space); "a one-line, **past-tense** report of what the work did"; "**A turn whose work changed nothing carries no trace**". The literal `↳ ` appears 7 times in the file (rule + 5 example traces + the Reply example). |
| TEST-218 | PASS     | `git show c48a4c6 -- …/orchestrate/SKILL.md` adds a Stewardship bullet: "**Every turn that wrote closes with a trace line.** … This binds **every agent turn, including the ones you post yourself**; a turn whose work changed nothing — an answer, a deferral, an apology for a failure — carries no trace. The comment skill states the same rule for the replies it writes." Choice is stated, not implicit. This is the one sanctioned edit to that file. |
| TEST-219 | PASS     | Pinned by the green `skills > trace lines > '$name' puts a trace last, or not at all` (both skills), which asserts every `↳` line is immediately followed by the heredoc's `EOF`. Confirmed by inspection: worked examples 1–4 in the comment skill each end with a trace as the last body line; the deferral replies in **both** skills carry none, the orchestrate one with an explicit `# nothing changed, so that reply carries no trace line`. |
| TEST-220 | PASS     | Pinned by the green `'$name' neither hides the arrow nor dresses it up`. Skill text says "Write the arrow into the turn body exactly as it is written here; **how the board renders that line is not your concern**" — no instruction to omit it, no `::before`, no markup around it. |
| TEST-221 | PASS     | `describe("trace lines")` exists and runs — evaluator-run `vitest run scripts/workspace-template.test.ts --reporter=verbose` lists 5 tests under `skills > trace lines`: `'orchestrate' states the trace grammar`, `'comment' states the trace grammar`, `'orchestrate' puts a trace last, or not at all`, `'comment' puts a trace last, or not at all`, `'orchestrate' neither hides…`, `'comment' neither hides…`, and `keeps traces out of user-authored turns`. All green (suite: **91 passed**). |
| TEST-222 | **PASS — independently reproduced** | Live DOM, server-served build on `9171`, thread `Re: "90 EUR per day"` (`th_jjnydd6x`). Evaluator's own readout: `traceCount: 1`; `.turn-trace` `textContent` = `"updated the lift ticket budget in [[doc_oxb7b2cd]] from 90 to 105 EUR per day"` with **`textHasArrow: false`**; computed `::before` `content` = **`"↳ "`**. `document.body.innerText` contains **0** `↳` characters on that page — the arrow exists only as CSS content. Zero page errors. This is the exact split the issue claimed. |
| TEST-223 | PASS     | Both from the file bytes and through the API. `data/threads/th_jjnydd6x.md` final line of the agent turn is literally `↳ updated the lift ticket budget in [[doc_oxb7b2cd]] from 90 to 105 EUR per day`. `GET /api/threads/th_jjnydd6x` returns the same turn body with the trailing `\n↳ updated the lift ticket budget …` — the arrow is in the transported bytes, only the *rendering* strips it. |
| TEST-224 | **PASS — independently reproduced** | Thread `th_uinzdi6p`. On disk the final agent turn (the APR-vs-APY answer) has **no** `↳` line. In the live DOM the thread shows `traceCount: 1` — and that single trace is on the **first** agent turn (`textContent: "titled this thread"`, `::before: "↳ "`), which genuinely wrote (it titled the standalone thread). The last turn, which only answered, carries no `.turn-trace`. The rule is discriminating on *whether the turn wrote*, exactly as specified. |
| TEST-225 | **PASS — independently reproduced** | Thread `th_nhwnsvuu`. A **user** turn whose last line is `↳ this line is mine, not a trace` renders with `traceCount: 0`; the arrow appears in the turn body's visible text (`arrowsInBodyText: 4` across the page, `.turn-body` snippet: `"Note to self, not for the agent. ↳ this line is mine, not a trace"`). Read-only observation of shipped behavior. |
| TEST-226 | **PASS — independently reproduced** | Same thread: an **agent** turn whose `↳` line is **not** last (`"Observation posted by the harness, not by the loop. ↳ this arrow line is in the middle of the body And this ordinary sentence is the real final line."`) produces **no** `.turn-trace`; the arrow stays inside the body as ordinary markdown text. Confirms the skill's "final line only" rule is load-bearing. |
| TEST-227 | RECORDED (as the contract requires) | The log records the renderer's leniency honestly — `splitTrace` `.trim()`s the candidate and checks `startsWith("↳")` without requiring the trailing space, and runs on attachment-stripped `prose`. The skills specify the **strict** grammar (`↳ ` with the space, true final line), so the strict rule is written against a lenient reader and does **not** depend on the leniency. The log correctly names `issues/ui/013-pr10-minor-findings.md` finding (11) as the home for tightening it, and adds a related nit about `thread.css:64`'s comment. AGENT-004 did not fix it — correct per the sprint's Out of Scope. |
| TEST-228 | PASS (substance) / see H-1 | `git show --name-only c48a4c6` → `assets/workspace/claude/skills/orchestrate/SKILL.md`, `issues/agent-runtime/004-emit-trace-lines.md`. No `packages/contract`, no `apps/ui`, no `Turn` field added. `ac3cf30` (the other commit carrying trace content) likewise touches no contract or UI source. The substantive assertion — **no contract or UI change, no `trace` field on `Turn`** — holds. The *file list* the log recites for its own commit does not; see H-1. |
| TEST-291 | PASS     | Evaluator-run `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts` → **1 file, 91 tests, all passed**, matching the log's "91 passed".                                                                                                                                                                                                                        |

**Acceptance criteria (issue file):** both met — skills emit `↳ <past-tense action summary>` as the final line
of write-performing turns per the SPEC §6 grammar, and a real agent run produced a turn the shipped UI renders
as a trace (re-derived above, not merely accepted).

---

## Honesty Audit — what was re-derived vs accepted

**Re-derived from primary sources (11 claims):**

1. Transcript B tool counts "`Bash 19, Read 2, Skill 1`" — **CONFIRMED exactly** by `jq` over
   `/tmp/corpus-s014-agent004-p5fuWc/transcript.stream.json`.
2. "128 stream events" — **CONFIRMED** (`wc -l` = 128).
3. "zero `Write`/`Edit`" — **CONFIRMED** (0).
4. "zero raw HTTP, zero git state changes" — **CONFIRMED** (no `curl`/`wget`/`127.0.0.1`/`git commit|push|checkout|reset|add|config` in any of the 19 Bash commands).
5. Every Bash command in the session begins with `corpus` — **CONFIRMED** (0 non-`corpus` first lines).
6. The two trace lines the session authored (`↳ updated the lift ticket budget …`, `↳ titled this thread`) appear in the transcript's own `corpus thread reply` heredocs — **CONFIRMED**.
7. File bytes of `th_jjnydd6x` — **CONFIRMED**.
8. API body carries the arrow — **CONFIRMED** (`GET /api/threads/th_jjnydd6x`).
9. `.turn-trace` textContent-without-arrow / `::before`-with-arrow split — **CONFIRMED in this evaluator's own headless browser**, not accepted from the log.
10. No-write turn carries no trace — **CONFIRMED in the live DOM**.
11. User arrow and mid-body arrow are not traces — **CONFIRMED in the live DOM**.

**Accepted, not re-derived:** the log's job-log excerpt for `evt_hewgfwwwg2xh` and its `corpus doc check`
exit-0 line (transient runtime output from a session that has ended); the screenshot at
`/tmp/corpus-s014-agent004-A-agent-turn-that-wrote.png`. Both are corroborated by the DOM and disk evidence
above, so nothing rests on them alone.

**Finding H-1 — the log misstates which commit carries its files.** The log says: *"Files in the `[AGENT-004]`
commit: `assets/workspace/claude/skills/comment/SKILL.md` (…), `assets/workspace/claude/skills/orchestrate/SKILL.md`
(…), and `scripts/workspace-template.test.ts` (`describe("trace lines")`)."* In the committed history:

- `c48a4c6 [AGENT-004]` touches **only** `orchestrate/SKILL.md` and its own issue file.
- `ac3cf30 [AGENT-003]` already contains **7** added `↳` lines in `comment/SKILL.md` **and** the entire
  `describe("trace lines")` block in `scripts/workspace-template.test.ts` (its commit body even notes
  "comment SKILL.md as committed includes AGENT-004's trace bullets").

Sprint-014 **Adjudication 10** is explicit: *"Commit boundary stays per-issue: the Reply section's trace edit
lands in the `[AGENT-004]` commit."* It did not. **All the content ships and the working tree is correct** —
this is an attribution/bookkeeping defect, not a behavioral one, and commits are the orchestrator's act rather
than the implementing agent's. It does not change any TEST verdict, but it makes one sentence of the E2E log
false and it will read oddly to the pr-reviewer scanning the phase diff. Flagged for adjudication rather than
scored as a failure.

---

## Failures

None behavioral. See H-1 for the commit-attribution finding.

---

## Items for orchestrator adjudication

1. **H-1, commit boundary vs. Adjudication 10** — decide whether to correct AGENT-004's log sentence (cheap,
   honest) or to note the deviation in the phase PR. Recommend correcting the sentence; re-splitting committed
   history is not worth it.
2. **UI-013 finding (11) is now load-bearing** — the strict grammar shipped against a lenient reader, exactly
   as TEST-227 records. Worth confirming UI-013 still carries the tightening (its eval is in this batch).
3. **`thread.css:64`'s comment** ("The arrow is CSS content, never a character in the document's bytes") reads
   as contradicting SPEC §6, where the arrow **is** in the bytes. One-line comment fix, ui domain — surfaced by
   the implementing agent itself.

---

## Summary

**13 of 13 criteria PASS** (TEST-216–TEST-228), with TEST-227 correctly RECORDED rather than fixed, plus
TEST-291 green. Six of them — the whole browser half (TEST-222, TEST-224, TEST-225, TEST-226) plus the byte and
API halves (TEST-223) — were **independently reproduced by this evaluator in a live headless browser against the
server-served build**, not accepted from the log. The `::before`/`textContent` split is exactly as claimed:
arrow in the file bytes, arrow in the API body, arrow absent from `textContent`, arrow present in the computed
`::before` content, and zero `↳` characters in the rendered page's `innerText`.

The one blemish is bookkeeping: the log names three files for a commit that contains one. Content is correct
and complete in the tree.

**Verdict: PASS.**
