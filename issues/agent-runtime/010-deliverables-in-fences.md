# [AGENT-010] Skills: reusable deliverables go in labeled fenced blocks

## Domain
agent-runtime

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §11 thread view copyable canvases (rider signed 2026-08-02)

## Summary
Companion to UI-041. The product agent's skills instruct it: any text the user
is expected to lift and reuse elsewhere — prepared prompts for other agents,
command lines, config snippets, drafted messages — is emitted inside a fenced
block with a short info-string label naming what it is (```prompt, ```command,
…), one deliverable per fence, prose outside the fence. The UI renders each
fence as a copyable canvas, so this convention is what makes the copy button
land on the right content.

## Acceptance Criteria
- [x] comment (and orchestrate where it composes turns) SKILL.md carry the
      convention with a concrete example
- [x] Wording keeps ordinary prose/code-discussion unaffected — only
      lift-and-reuse deliverables get fenced
- [x] E2E: a real agent turn produced through the queue renders the labeled
      fence (verify with UI-041 landed, or assert the raw markdown shape)

## Technical Design
### Files to Create/Modify
- `assets/workspace/claude/skills/comment/SKILL.md` (+ orchestrate if
  applicable)

### As built
- `assets/workspace/claude/skills/comment/SKILL.md` — the rule is a bullet in
  **Reply** (where the turn's contents are governed), followed by one worked
  example fence. It states the four parts: what counts as a deliverable, the
  info-string label, one deliverable per fence with prose outside, and the
  scope limit (prose stays prose; code being explained is not a deliverable).
  No new section, so the skill's section count and per-section substance
  assertions are untouched.
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — one bullet in
  **Delegation**'s binding-rules list, beside the trace-line rule it mirrors:
  the dispatch prompt restates it, and it binds the turns orchestrate posts
  itself. It defers to the comment skill for the statement rather than
  duplicating it — two copies of a rule is how they drift.
- Both skills' `updated` stamps advanced to `2026-08-02`.
- `scripts/workspace-template.test.ts` — a `deliverable fences` describe (4
  tests) plus a `fencedBlocks()` helper that parses a body's fences so the
  example can be asserted structurally, not by substring.

## Testing Strategy
Skill-text assertions per existing agent-runtime test patterns.

## E2E Verification Plan
Real workspace: ask the agent for a prompt; the turn carries a labeled fence.

## E2E Verification Log

**Model: Opus 5 (1M context).** 2026-08-02, agent-runtime-dev.

Scoped suite: `VITEST_MAX_THREADS=4 vitest run scripts/workspace-template.test.ts`
→ **101 passed** (97 before this change + 4 new). Prettier clean on both skills
and the test file; `eslint` and `tsc --noEmit -p scripts/tsconfig.json` clean.

Real drill, end to end through the CLI only — no hand-edited files, no HTTP:

1. `npm run build`, then `corpus init /tmp/agent010-ws --port 8871` →
   "installed 8 template files". `diff` of both installed skills against
   `assets/workspace/…` → identical, so the edited text is what a new
   workspace actually gets.
2. `corpus server start` → listening on 127.0.0.1:8871; `corpus health` → ok.
3. `corpus doc create --type note --title "Mortgage options" --folder finance`
   → `doc_wvi6rn7m`.
4. `corpus thread create --parent doc_wvi6rn7m --quote "6.1%" -m "@agent can
   you write me a prompt I can paste into a research agent…"` → `th_lhyufhvx`,
   anchored at `anc_18e821a6`, queued `evt_vuzgr2ephocu`.
5. `corpus queue claim-all` → the `comment.created` event, payload as expected.
6. Composed the agent turn per the new rule — framing prose, then a single
   ` ```prompt ` fence holding only the deliverable, then a closing sentence,
   no trace line (the turn changed nothing) — through
   `corpus thread reply th_lhyufhvx --from agent <<'EOF'`. Logged and settled:
   `corpus job log …`, `corpus queue complete evt_vuzgr2ephocu` → complete.
7. **Raw markdown shape asserted** at `data/threads/th_lhyufhvx.md`: the agent
   turn is stored verbatim — opening fence `` ```prompt `` on its own line, two
   deliverable lines, closing fence, framing prose outside on both sides, and
   the info string preserved byte-for-byte through the write path.
   `corpus thread show th_lhyufhvx` prints the same block back.
8. Renderer half (UI-041, already landed) confirmed against the same shape:
   `vitest run packages/kit/src/markdown/CodeFence.test.tsx` → 16 passed,
   including `renderMarkdown("```prompt\nhi\n```")` yielding
   `.fence-label` text `"prompt"` and a copy button whose confirmation reads
   "Copied the prompt block to the clipboard". So the label the skill now
   writes is exactly the title the canvas shows.
9. `corpus server stop` → stopped (pid 9727); port 8871 verified free.

Not verified in-browser: no Playwright run (single-holder resource, and
`apps/ui/e2e/fences.spec.ts` already covers the rendered canvas with a real
clipboard as part of UI-041). The claim proved here is the skill-side half —
the composed turn's raw markdown — joined to the renderer's contract via its
component tests.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
