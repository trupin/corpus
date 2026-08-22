# [AGENT-021] The agent states the model that wrote the turn

## Domain

agent-runtime

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CLI-033 (the flag), CONTRACT-043 + SERVER-074 (done)
- Blocks: the SHARED-027 feature being true rather than merely possible

## Spec References

- SPEC.md **§10** — "An agent turn says which model wrote it… the turn names the
  model of the **deciding** stage"
- SPEC.md **§7** — work may be split into stages at different weights; the
  deciding stage runs at the governing weight

## Summary

CLI-033 makes it possible to state a model. This makes the agent do it, which is
what turns the chip from an empty space into the answer the user asked for.

**The rule is already fixed by the signed rider, so this issue implements rather
than decides**: the turn names the model of the **deciding** stage — the one that
drew the conclusion or wrote the words, which is the stage carrying the
consequence (§7). Where a request ran in stages, the collecting stages do not
appear on the turn; the full per-stage account stays in the job's log while it
lasts.

## Acceptance Criteria

- [x] Every agent turn the skill posts states the model that wrote it
- [x] Where work was **split** (§7), what is stated is the **deciding** stage's
      model, not the first stage's and not a list
- [x] The agent states what actually ran, never what was asked for. A stated
      weight is a directive (§7, CONTRACT-039); this is a fact about what
      happened. Conflating them makes "honoured, not weighed again"
      unverifiable, and the skill should say so in one line so the distinction
      survives a later edit
- [x] When the agent genuinely does not know, it states **nothing** — §10 wants
      an absence rather than a plausible attribution nobody can check. An
      instruction to "state your best guess" would be the exact failure
- [x] `scripts/workspace-template.test.ts` passes and pins the rule

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/comment/SKILL.md` and/or
  `assets/workspace/claude/skills/orchestrate/SKILL.md` — whichever owns posting
  a turn — plus the frontmatter `updated` timestamp, and the test.

### The skill-file constraints that bite

**Re-verify against the test rather than trusting these numbers**:

- Exact section counts: **16** orchestrate, **13** comment. Prefer editing in
  place; a new `## ` section is a two-file change.
- Both counters are now **fence-aware** (AGENT-020 made orchestrate's match the
  comment skill's), so a `## ` inside a fenced example is safe in either file —
  this is a recent change and worth confirming rather than assuming.
- Every `## ` body must exceed 400 characters after trimming.
- Banned hedges: `use your judgment`, `consider whether`, `you may want`,
  `if appropriate`. Banned strings: `SPEC.md`, `CLAUDE.md`, `issues/`.
- Quoted heredocs for multi-line shell arguments; `-m "$(` banned.
- `EXPECTED_TREE` is exhaustive equality.
- `## The loop` in orchestrate deliberately contains **no fenced block** and a
  test asserts it (AGENT-019). Do not reintroduce one.

### Notes

- The worked examples post turns. If they show a reply without stating a model,
  they teach the opposite of the rule — check every one of them, since an
  example that contradicts a rule beats the rule.

## Testing Strategy

`scripts/workspace-template.test.ts` is the surface. Pin the rule, the
deciding-stage clause, and the state-nothing-when-unknown case.

## E2E Verification Plan

Through the product: `corpus init` a scratch workspace from the built package on
a non-default port (**never 8765**, **never 5173**), run the real agent loop,
have it answer a comment, and confirm the turn on disk carries a `turnModels`
entry and the board shows the chip. Then a staged request, confirming the
deciding stage's model is the one recorded.

## E2E Verification Log

**2026-08-08 — implemented on Opus 5 (`claude-opus-5[1m]`).**

### What changed

- `assets/workspace/claude/skills/comment/SKILL.md` — three new bullets in
  `## Reply` (the rule, the deciding stage, the absence), `--model` on every
  turn-writing invocation in the body (the canonical reply, the lock-deferral
  reply, the `## Forms` grammar reference, all four worked examples), and worked
  example 2 rewritten as the **staged** case: a lighter model gathered, this
  session concluded, the turn names the deciding stage and one `corpus job log`
  line carries both. `updated` advanced to 2026-08-08.
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — a new binding-rule
  bullet in `## Delegation`; "the model you are launching it at" added to what a
  dispatch prompt carries; `## Progress and job logs` names the dispatched line
  as **the per-stage account**; `--model` on the lock-deferral reply, the worked
  example's reply, the `## Completing and failing` reply-before-you-fail
  reference and the `corpus thread create` in step 4 of the reflection.
  `updated` advanced to 2026-08-08. Section counts unchanged (16 / 13) — every
  change is in place, no new `## `.
- `scripts/workspace-template.test.ts` — a `stating the model that wrote the
  turn` describe block: a structural sweep asserting **every** turn-writing
  invocation in both skills carries `--model`, plus the wording of the rule, the
  deciding-stage clause, the what-ran-not-what-was-asked line, and the
  state-nothing case (including `not.toMatch(/best guess/i)`). The pre-existing
  reply-mechanics regex was tightened to `--from agent --model \S+ <<'EOF'`.

### Tests

`npx vitest run scripts/workspace-template.test.ts` — **146 passed, 0 failed**
(was 141 before; the counts test still pins 16 / 13). Negative probe: removing
`--model` from worked example 3's reply turned the sweep red with
`claude/skills/comment/SKILL.md: turn written with no model`; restored, green
again. Both section counters confirmed fence-aware in the source before editing.

### E2E, through the product

Scratch workspace on **port 8791** (never 8765, never 5173), CLI run from source
(`npm run dev -w apps/cli`), server started and stopped, port confirmed free
afterwards.

1. `corpus init /tmp/agent021-ws --port 8791` — installed 8 template files; the
   installed `.claude/skills/comment/SKILL.md` carries the new `--model` lines,
   so what a user gets is what was written.
2. `corpus doc create` a mortgage note, then `corpus thread create --parent … --quote "6.1%" -m "@agent is this still right?"` → `queued evt_6tpu5m6hu6dl`.
3. The loop, run by hand exactly as `## The loop` prescribes:
   `export CORPUS_FROM=agent` → `corpus queue reap-stale` → `corpus queue claim-all`
   (one `comment.created`, empty `inProgress`) → `corpus job log` claimed +
   dispatched → `corpus thread context` → the work → reply → `corpus queue complete`.
4. The reply was posted with
   `corpus thread reply th_tq4visgm --from agent --model claude-sonnet-4-5`, the
   exact shape the skill now shows.
5. **On disk**, `data/threads/…md` frontmatter:

   ```
   turnModels:
     2026-08-08T16:33:35Z: claude-sonnet-4-5
   ```

6. **Through the API the thread view renders from** (`GET /api/threads/th_tq4visgm`):
   the agent turn carries `"model":"claude-sonnet-4-5"`, the user turn
   `"model":null`.
7. **The absence case**: a second agent reply posted with no `--model` added *no*
   `turnModels` entry for its timestamp — an absence, not a blank.
8. **Both refusals**, confirmed with their exit codes: `--model ""` → exit `2`
   ("--model was given without a model name"); `--from user --model …` → exit `2`
   ("only an agent turn names the model that wrote it"), nothing sent either time.

**Not exercised**: the rendered chip. The Chrome extension was not connected
("Browser extension is not connected"), so the board was never opened; the
evidence above stops at the API response the chip is drawn from. UI-090's own
`apps/ui/e2e/turn-model.spec.ts` covers the rendering. Also not exercised: a
nested real `claude` session invoking `/orchestrate` — the loop was driven
command-by-command against the real server, not by a second Claude Code process.

### Finding for another domain

`plugins/todos/skills/todos/SKILL.md:74` shows
`corpus thread reply <threadId> --from agent <<'EOF'` with **no** `--model`, and
`corpus init` installs it into every workspace (the init run above reported
"installed 2 plugin skill files"). It is an example that contradicts the rule, in
a skill the agent applies. Out of this domain (`plugins/`) — escalated to the
orchestrator for plugins-dev.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes — scoped: `prettier --check` and `eslint` clean on
      `scripts/workspace-template.test.ts` (the skills are prettier-ignored by
      design, so their bytes are what `corpus init` installs)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-021]` prefix
