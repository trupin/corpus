# [CLI-077] Nothing carries a conversation forward, so every restart re-reads it from the top

## Domain

cli

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: **CLI-076** (the index this is surfaced at the top of)
- **Blocked on work that is not filed yet.** See *This issue cannot ship alone*
  below. It needs, at minimum: a signed SPEC §6 rider, a CONTRACT issue for the
  field and the write route, a SERVER issue for the write path, and an AGENT
  issue for the skills that write and honour it.
- Related: CLI-055 (bounded reads), CLI-074 / AGENT-058 (a value the shell never
  sees — a digest is prose and must never travel through argv), AGENT-061 (the
  per-turn model record, the precedent for storing derived data in thread
  frontmatter)

## Spec References

- SPEC.md **§6** — thread frontmatter and the turn format; **turn deletion**
  (user-only) and **turn revision** (agent-only, last turn only); *"Which model
  wrote a turn is recorded outside the turn"* (rider signed 2026-08-08) — the
  precedent for a derived per-thread record living in frontmatter
- SPEC.md **§7** — Retrieval discipline; the agent loop and what a listener reads
  on waking
- SPEC.md **§9** — the server is the sole writer

## Summary

Reported from live use, 2026-09-03, with measurements. Corpus 0.32.0, the `cos`
workspace.

CLI-076 makes a long thread **addressable**. It does not make it **shorter**. An
agent that has never seen a 19-turn conversation still has to read most of it to
know what was decided, and CLI-076's index — turn numbers, authors, byte counts,
first lines — tells it where things are, not what they were.

So: **one rolling digest per thread, not one summary per message.**

- The **resident agent** writes it, **incrementally, at reply time**. The turns
  are already in its context when it replies, so the write is nearly free.
- **The server never generates it.** No summarization job, no model call on the
  write path, nothing to be stale-but-running.
- Stored in the thread file. Surfaced at the top of `thread show --index` and
  inside `corpus thread context`.

**Measured effect.** A listener restart today reads 32,375 bytes. With this it
reads a digest (~1KB) plus the index (~1.5KB) plus the last few turns verbatim
(~5KB) — roughly **7.5KB instead of 32KB**, and the cost stays roughly flat as
the thread grows, which is the property `thread context` already has and
`thread show` does not.

## The invariant, which is the whole of it

**Summaries orient. They never act.**

Before an agent quotes a passage, patches a document, or answers a question about
what was said, it reads the turn **verbatim** — `corpus thread show <id> --turn
<n>`. The digest tells it *which* turn. It is never the source of a quotation and
never the basis of a write.

This must be stated in the skills (the AGENT issue), and it must be stated in the
help text of every surface that prints a digest. A summary an agent is willing to
act on is a summary that will eventually be acted on wrongly, and the failure is
silent: the corpus records a confident answer to something nobody said.

## The premise that needs correcting before this is designed

The report says: *"Turns are immutable, so a written digest never goes stale
retroactively."*

**That is not true of the built system, and SPEC §6 says so in two places.**

1. **Individual turns can be deleted** — user-only, via
   `DELETE /api/threads/:id/turns/:ts`. A person deleting a turn the digest
   summarizes falsifies the digest retroactively.
2. **The agent may revise its own last turn in place** — same author, same
   timestamp, same position. A revision changes a turn's body under a digest that
   already covered it.

Both are rare. Neither is impossible, and a summary that is wrong about what
someone said is exactly the failure the invariant above exists to prevent — so
being rare is not a reason to leave it undefined. **The digest must therefore
record what it covers**, and a change inside that range must be visible.

Recommended shape, to be decided and recorded:

- The digest carries a **watermark**: the timestamp of the newest turn it covers.
- Deleting or revising a turn **at or before the watermark** marks the digest
  stale. It is not deleted and not regenerated — the server generates nothing.
  It is **printed as stale**, so the next reader knows to distrust it and rewrite
  it.
- Turns after the watermark are simply not covered yet. That is the ordinary
  state between a turn landing and the resident's next reply, and it needs no
  marking beyond the watermark itself.

**Do not make the server repair this.** A stale digest that says so is honest. A
digest the server quietly regenerated is a summary nobody wrote, on the write
path, which is the thing this design exists to avoid.

## This issue cannot ship alone

Recorded plainly, because the CLI's share of this is the small half.

`corpus` is a thin HTTP client and the **server is the sole writer** (CLAUDE.md
Architecture Decision 2). "Stored in the thread file" therefore means the thread
file's frontmatter gains a field, which is:

| Needs | Domain | Why |
| --- | --- | --- |
| A signed SPEC **§6 rider** | SHARED (orchestrator + user) | §6 enumerates thread frontmatter. The per-turn model record needed a rider (signed 2026-08-08) for exactly this, and it is the closest precedent — derived data, about turns, recorded outside them. |
| The field on `ThreadSchema`, and a write route | CONTRACT | `packages/contract/src/schemas/thread.ts`. Also the **context pack** (`schemas/context.ts`), if the digest is to appear in `thread context` — that pack is bounded by contract and has no flags by design. |
| The write path, the watermark, and staleness on delete/revise | SERVER | Sole writer. The delete and revise paths are where staleness is detected. |
| The skills that write it at reply time, and the *summaries orient* invariant | AGENT | `assets/workspace/claude/skills/` — `comment`, `converse`, `orchestrate`. |

CLAUDE.md: *"A change spanning contract + one consumer is two issues with a
dependency, not one issue."* None of those four are filed. **This issue is not
ready to implement, and an agent that picks it up should stop and say so.**

## What is genuinely this issue's — the CLI's share

- **A write verb.** `corpus thread digest set <id>` — the resident's way to write
  the digest through the CLI, which is the only surface it has.
  - **The body never travels through argv.** CLI-074 measured what happens when a
    value's own content reaches the shell: a person's pasted words executed as
    commands and the output landed in their document. A digest is multi-line
    prose written by a model. It takes `-m`, `--file` or **stdin**, the three
    forms `corpus thread reply` already offers, and the help says so.
  - It sends what it was given. It does not summarize, reflow, or trim.
- **A read surface.** The digest at the top of `thread show --index` (CLI-076),
  marked **stale** when the server says it is, and carrying its watermark so a
  reader can see what it does and does not cover.
- **The invariant in the help text** of both, in the words above.
- **`thread context`**: the pack is the server's envelope rendered unchanged. If
  CONTRACT adds the digest to the pack, this verb prints it. That is a
  consequence, not work this issue designs.

## Acceptance Criteria

Scoped to the CLI. The upstream issues carry their own.

- [ ] `corpus thread digest set <id>` accepts a body via `-m`, `--file` and
      stdin, and **never** as a positional argument.
- [ ] A digest body containing a heredoc terminator, a `$(...)`, and a line
      reading as a turn heading round-trips **byte for byte** through the `--file`
      and stdin paths.
- [ ] `corpus thread show <id> --index` prints the digest above the header, with
      its watermark.
- [ ] A stale digest prints **marked stale**. It is never hidden and never
      silently replaced.
- [ ] A thread with no digest prints no digest block — having none is the
      ordinary state, not a value.
- [ ] Both surfaces' help states: summaries orient, they never act; read the turn
      verbatim before quoting or patching.
- [ ] Measured on the reported thread: digest + index + `--last 3` totals
      **≤ 8KB** against the 32,375-byte whole read. The issue records the actual.
- [ ] `docs/cli.md` regenerates cleanly.

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/thread/digest.ts` — new, the write verb.
- `apps/cli/src/commands/thread/digest.test.ts` — new.
- `apps/cli/src/commands/thread/index.ts` — register it.
- `apps/cli/src/commands/thread/show.ts` — the digest block in `--index`.
- `docs/cli.md` — regenerated.

### Key Implementation Details

Read the CONTRACT issue's route before writing this. Do not invent the wire
shape here — a CLI that guesses the field name is a CLI that compiles against a
contract that does not exist.

The digest block renders above CLI-076's header, and it is the only part of
`--index` that is **not** derived. Everything else in that index is a projection
of `turns` and cannot be wrong; this is written prose that can be. Render it so a
reader can tell the difference — the watermark line does that work, and the stale
marker does the rest.

### Edge Cases

- Setting a digest on a thread with **no turns**: permitted or refused? Decide.
  A digest of nothing is not obviously wrong (a thread can be created with a
  designation and no turns), but a watermark has nothing to point at.
- An **empty** digest body: is that "clear the digest" or a usage error? Decide,
  and prefer an explicit clear over an empty string that reads as a digest saying
  nothing.
- A digest **longer than the turns it summarizes**. Nothing should refuse it —
  but the help should not pretend it is a summary either.
- Setting a digest on a thread whose resident is not the caller. §7 owns who may
  write; the CLI reports the server's refusal and does not decide it.
- A **stale** digest that the resident then overwrites: the write clears
  staleness, because the writer has just read the turns. That is the server's
  call to record, not the CLI's to infer.

## Testing Strategy

Vitest, colocated, against the stub server.

- The three body forms (`-m`, `--file`, stdin) produce identical request bodies.
- The hostile-content round-trip above, asserted byte-for-byte.
- `--index` with a digest, without one, and with a stale one — three distinct
  renderings, each asserted for the marker's presence **and** absence.
- The help of both surfaces contains the *summaries orient* sentence. This is a
  wording assertion, and CLAUDE.md's note on `workspace-template.test.ts` applies:
  a wording test proves the sentence is present, never that it is true or heeded.
  The AGENT issue's rehearsal (INFRA-033/034) is what tests whether an agent
  reading it acts on it, and this test does not claim otherwise.

## E2E Verification Plan

### Verification Steps

1. `npm run build && corpus server restart`.
2. Write a digest from a heredoc containing a `$(date)` and its own terminator
   string. Confirm with `cat data/threads/<id>.md` that the frontmatter holds the
   literal text and that no command ran.
3. `corpus thread show <id> --index | head -5` — digest and watermark present.
4. Delete a turn at or before the watermark through the real interface. Re-run
   `--index`. **Confirm the digest prints as stale.** This is the load-bearing
   check and the one a passing unit test does not cover.
5. Measure: `corpus thread show <id> --index | wc -c` plus
   `corpus thread show <id> --last 3 | wc -c`, against the whole read. Record all
   three numbers.

## E2E Verification Log

_Filled in by the implementing agent. State which model it ran on._

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] The four upstream issues exist and are done. **If they do not, stop and
      report — do not implement against a guessed contract.**
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in, including the staleness check and the three
      byte counts
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] The SPEC §6 rider is drafted, read back to the user, and **signed**
- [ ] `/audit` run (cross-domain — qualifies)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-077]` prefix
