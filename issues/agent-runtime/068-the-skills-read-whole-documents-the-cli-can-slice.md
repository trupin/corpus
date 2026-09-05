# [AGENT-068] The skills read whole documents the CLI can slice

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: **CLI-076** (the thread half needs `--index` / `--last` /
  `--turn` to exist)
- Related: CLI-055 (built the document half a fortnight ago), AGENT-051 (the
  precedent — when CLI-064/065 shipped, a dedicated issue taught the skills to
  use them; nothing did that for CLI-055)

## Spec References

- SPEC.md **§7** — retrieval discipline: reading is bounded on purpose
- **CLAUDE.md Architecture Decision 2** — the agent works only through the CLI

## Summary

Measured 2026-09-05 across
`assets/workspace/claude/skills/*/SKILL.md` and their references:

- `corpus doc show` appears **41 times** — the most-instructed verb in the
  product.
- `--headings` appears **0 times**. `--section` appears **0 times**.

CLI-055 shipped the bounded document read on 2026-08-21 with a measured 175×
saving, precisely so that a patch-shaped change never pays for a whole body.
Two weeks later, no skill has ever told an agent it exists. The orchestrate
skill's own invariant 6 ends every retrieval at *"a separate, deliberate act:
`corpus doc show <id>`"* — the whole document, every time.

When CLI-064/065 shipped, AGENT-051 was filed the same day to make the skills
collect the saving. CLI-055 got no AGENT-051, and this issue is it — plus the
same adoption for CLI-076's thread reads, which would otherwise repeat the
identical miss.

**Measured, per event, on a seeded 0.32.0 workspace** (19-turn thread, 3,500-B
parent):

| Read | Today | Bounded |
| --- | --- | --- |
| thread (context + show) | 3,272 + 17,635 B | 3,272 + ~1,500 index + ~2,600 last-3 |
| parent document | 4,104 B whole | 35 headings + 2,295 section |
| **event total** | **~25,100 B (~6,300 tok)** | **~9,800 B (~2,500 tok)** |

The real `cos` thread that prompted Phase 57 is 32,375 B, so the real-world
today column is ~40 KB per event. This issue is where Phase 57's CLI work
actually starts saving tokens: **a bounded read nobody is instructed to make
saves nothing.**

## What to change

In `comment`, `converse` and `orchestrate` (and `profile` where it reads):

1. **The document read forks on the write it feeds.** Before a patch-shaped
   change: `doc show <id> --headings`, then `--section "<path>"`, then
   `doc patch` quoting from the section — never the whole body. Before a
   whole-body `doc edit`: the full read, exactly as today, because a rewrite
   needs everything and the `--key` comes from that read. The skills already
   distinguish patch-shaped from rewrite-shaped work — the fork attaches to a
   distinction they draw, it does not add one.
2. **The thread read starts at the index.** `thread show <id> --index`, then
   verbatim fetches of the turns the work needs (`--last <n>`, `--turn <n>`).
   The whole-thread read remains for the case that genuinely needs every turn,
   and the skill says what that case is instead of leaving it the default.
3. **The quoting invariant travels with both**: what is patched or quoted is
   fetched verbatim first (`--section`, `--turn`) — CLI-055 and CLI-076 built
   byte-exact outputs for exactly this, and search snippets and index excerpts
   remain non-quotable, as the skills already say of snippets.
4. **`corpus search` composes in**: its `headingPath` is what `--section`
   accepts (CLI-055's decision 2) — a search hit goes straight to a section
   read without a whole-document stop in between. Say so where invariant 6
   sends the reader to `doc show`.

## What must not change

- **The full-read-before-rewrite rule.** The comment skill's warning is
  correct and stays: rewriting a parent from its section alone deletes the
  rest of the document.
- **Anchor resolution reads.** Anchors resolve server-side against the current
  body; where a skill reads a document to see anchor state, the bounded forms
  do not answer that and the skill must not pretend they do.
- **INFRA-038's anti-gaming rule.** These instructions land in the sections
  agents already read, sized to replace what they amend — not as a new
  always-read reference file.

## Acceptance Criteria

- [ ] Every `doc show` instruction in the four skills either reads a section
      path or states why that site needs the whole body. Zero unexplained
      whole-body reads remain.
- [ ] Every `thread show` instruction starts at `--index` or states why not.
- [ ] The byte-exact quoting rule is stated once per skill and cited at the
      patch and reply sites.
- [ ] The skills grow by less than they direct readers to save — net token
      change of the skill files is recorded and is not positive by more than
      500 bytes total.
- [ ] `workspace-template.test.ts` guards updated.
- [ ] One `comment.created` handled end-to-end on a seeded workspace with the
      new instructions, its reads logged, and the per-event total recorded
      against the ~25,100 B baseline above.

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/comment/SKILL.md`
- `assets/workspace/claude/skills/converse/SKILL.md`
- `assets/workspace/claude/skills/orchestrate/SKILL.md`
- `assets/workspace/claude/skills/profile/SKILL.md` (audit; amend only if it
  instructs reads)
- `scripts/workspace-template.test.ts`

### Key Implementation Details

**Sequence against AGENT-067.** That issue rewrites orchestrate wholesale. Land
this one's orchestrate edits either before it (small, surgical — the rewrite
carries them forward) or fold them into its brief explicitly. Decide with the
orchestrator at dispatch time and record which; do not let the two race on the
same file (worktree isolation if parallel).

**The rehearsal harness covers regressions** (INFRA-033/034): scenarios that
exercise comment work must still pass — a skill that now under-reads and
patches the wrong section would surface there, not in wording guards.

### Edge Cases

- A document with no headings: `--headings` prints nothing useful and the
  whole read is correct. The instruction says so.
- Duplicate heading paths: CLI-055 decision 4 governs; the skill defers to the
  verb's own failure rather than restating it.
- A workspace running an older CLI (upgrade lag): the flags exist since
  v0.20.0 — confirm the version floor and state it, or drop the concern with a
  sentence.

## Testing Strategy

- Wording guards for the fork rule and the index-first rule, marked as wording
  guards per CLAUDE.md's standing caveat.
- The rehearsal suite, unchanged, as the behavioural check.

## E2E Verification Plan

### Verification Steps

1. `corpus init` a scratch workspace with the amended skills; seed the Phase 57
   fixture shape (19-turn thread, sectioned parent).
2. Drive one `comment.created` through a real agent session following the
   comment skill; capture the commands it ran from the job log.
3. Sum the bytes of its reads; record against 25,100 B.
4. Verify the patch it made quoted section-fetched bytes.

## E2E Verification Log

_Filled in by the implementing agent. State which model it ran on._

### Post-Implementation Verification

_[Agent fills: the command list, the byte sum, the patch evidence]_

## Completion Checklist (domain agent)

- [ ] Zero unexplained whole reads, both kinds, verified by grep and read
- [ ] Net skill-size change recorded
- [ ] `/lint` passes
- [ ] E2E log with the measured event total
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Sequencing against AGENT-067 decided and recorded
- [ ] `/evaluate` passes
- [ ] Committed with `[AGENT-068]` prefix
