# [SHARED-070] What else the agent pays for — a measured audit of token cost

## Domain
shared

## Status
done

## Priority
P1 (important)

## Model
fable

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 2 — the CLI is the agent's whole surface
- SPEC.md Section 7 — the agent loop, the queue and parking
- CLAUDE.md, second architecture decision — "The agent interacts with the system
  **only through the CLI**"

## Summary

Phase 39 came from one dogfood report on 2026-08-21. It produced seven findings
and six measurements, and every one of them was something a person **noticed**
while working. That is a good way to find the largest cost and a poor way to find
the total.

This issue asks the other question: **over a real agent loop, where does the
context actually go?** Not "which command prints the most", but "which cost,
multiplied by how often it is paid, dominates the transcript".

The deliverable is a measured report and a set of filed issues, each carrying its
own number. It is deliberately **not** an implementation issue. Nothing here
changes a command.

## Why the ranking matters more than the list

CLI-055 measured a 175× context saving on one read path. CLI-056 measured 7,000
words to read four help topics. Both are real, and neither says how many times a
loop pays them.

A 200-word answer paid 300 times in a session costs more than a 3,500-word answer
paid once, and no one has counted either. An audit that reports per-call costs
without frequencies will re-find CLI-055 and stop.

## Acceptance Criteria

- [x] A real agent loop is run against a real workspace — the product's own
      `orchestrate` skill in a scratch workspace, not a synthetic script — and
      its whole transcript captured.
- [x] Every CLI invocation in that transcript is counted: words in (the command,
      its flags, its stdin) and words out (stdout, stderr, exit path).
- [x] Costs are ranked by **total** — per-call cost times call count — and the
      ranking is published in the report, not only the top entry.
- [x] The audit covers all five surfaces the agent reads, and says so per
      surface:
      1. command **output**, both human and `--json`
      2. **help** text, at every level
      3. **error** messages and refusals
      4. the **skills the product installs** (`assets/workspace/`), which the
         agent reads every turn before it runs anything
      5. the **queue and job** surface, including what parking and re-arming cost
- [x] Each opportunity worth acting on becomes an issue file with a PLAN row, a
      measurement, and an estimate of the saving. _(Seven issues filed with
      measurements and estimates; PLAN rows deliberately left to the
      orchestrator, per its instruction — it reconciles PLAN.md continuously.)_
- [x] Anything measured and found **not** worth acting on is written down too,
      with its number. A finding that was checked and dismissed is what stops the
      next audit re-checking it.
- [x] The report states what it did **not** measure. A coverage claim nobody
      bounded reads as "everything", which is how a second dogfood report
      arrives with findings this audit could have caught.
- [x] Nothing in this issue changes a command, a flag or an output. Every change
      lands in an issue of its own. _(No source file touched; every change is a
      filed issue.)_

## Technical Design

### Files to Create/Modify
- `issues/evals/` or a sibling — the report, wherever a measured artifact
  belongs. Choose the existing home rather than inventing one.
- `issues/<domain>/NNN-*.md` — one per opportunity found
- `issues/PLAN.md` — their rows

### Key Implementation Details

**Measure, do not read.** Every number in this report comes from a captured
transcript or a run command. A count derived by reading a source file is an
estimate, and Phase 39's value was that six of its seven findings were measured.

**Words, and tokens where they differ.** Phase 39 counted words, so the report
should stay comparable with it. Where a surface is mostly punctuation, JSON or
identifiers, words understate the token cost badly — say so and count both.

**Count the skills.** `assets/workspace/` is the one surface the agent reads on
**every** turn, before any command runs, and no issue in Phase 39 touched it. It
may be the largest fixed cost in the product and nobody has measured it.

**Count the failures.** An agent that gets a refusal reads it, reasons about it,
and retries. A verbose error is paid twice — once to read and once to recover —
and error paths are absent from Phase 39 entirely.

**Do not propose a session mode here.** CLI-058 already holds that question, with
the reasoning for why it is not obviously right. This audit feeds it numbers and
leaves the decision where it is.

**Do not fold findings into existing issues.** If the audit finds more on a path
CLI-056 or CLI-057 already covers, note it against that issue and leave its scope
alone. Widening a filed issue during an audit is how an audit becomes a rewrite.

### Edge Cases
- A loop that fails part-way. Its transcript is still data, and the recovery path
  is one of the five surfaces.
- A workspace with no documents. Costs paid before any work exists are the fixed
  floor, and worth naming separately from the variable cost.
- The `--json` path where no skill uses it. Cheap output nobody reads is not a
  saving.

## Testing Strategy

None — this issue produces a report and issue files. The check is that every
number in the report names the command that produced it, and that a second person
can re-run it.

## E2E Verification Plan

The audit **is** the E2E work: a real workspace, a real agent loop, real
invocations, no mocks and no test clients.

### Verification Steps
1. `corpus init` a scratch workspace
2. Run the product's `orchestrate` skill over a seeded corpus, capturing every
   invocation and its output
3. Produce the ranked table
4. File the issues

## E2E Verification Log

### Post-Implementation Verification

Implemented on: **fable** (claude-fable-5). Report:
`issues/evals/SHARED-070-token-audit.md` — every number in it names its command
and its analyzer script.

- **Workspace**: `corpus init` under the session scratchpad (`ws-070`), server
  v0.19.0 on port 8766 (the user's 8765 untouched), built from the working tree
  (`npm run build` re-run first). Machine load 3.87 at start, 1.64 at end.
- **The loop**: 3 passes of the orchestrate procedure run to the letter — reap,
  roster, claim, dispatch, log, park, settle — over 6 real events: an anchored
  comment (patched 2 documents), a whole-document inbox filing (retitle, expand,
  move, tag), a standalone ask (titled + answered), an engaged-thread follow-up
  (asked with a form), the form's `form.respond` (document created, thread
  resolved), and a `workspace.reflect` (window gathered, digest posted with
  `--job`). All 6 settled `processed`; `queue status` confirmed
  `processed 6, failed 0`.
- **Captured**: 111 invocations with argv, stdin, stdout, stderr, exit, wall
  time (`scratchpad/audit/*.jsonl`), analyzed by word and by token
  (gpt-tokenizer, stated as an approximation of Claude's tokenizer).
- **The ranking** (full table in the report): comment SKILL.md per event
  456.8k/day (56%) › asd-ste100 per context 111k › orchestrate per session
  103.9k › dispatch-prompt duplication 48.6k › all CLI traffic 45k › CLAUDE.md +
  descriptions 41.8k › retrieval pollution 15k › reflection's
  `doc list --json` 11.7k › queue surface 2.5k › help ~1k › errors ~0.5k.
- **Error battery**: stale key (394 tok, exit 9), patch matched-0 and matched-4
  (exit 10), keyless edit, agent delete, bad `--from`, model-on-user-turn,
  unknown id, invalid form fence (400), halt/resume cycle — all captured with
  exits. Two correctness defects found and filed (SERVER-145, CLI-066).
- **Issues filed**: AGENT-047, AGENT-048, AGENT-049, SERVER-144, SERVER-145,
  CLI-065, CLI-066. Notes with the audit's figures appended to CLI-058 and
  CLI-064 without widening either.
- **Not measured** (bounded in the report): `doc.edited` reflection (UI editing
  sessions not driven — a user CLI edit verifiably emits no event), residents/
  `converse` in flight, the runtime's actual skill-caching behavior, Claude's
  exact tokenizer, multi-day parking, `upgrade`/`db`/`index`/`folder` outputs
  in anger, the UI surface.

## Completion Checklist (domain agent)
- [x] Tests written and passing _(none required — report-and-issues issue; the
      check is that every number names its command, which the report holds to)_
- [x] `/lint` passes _(prettier clean on every touched file; no source touched)_
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
