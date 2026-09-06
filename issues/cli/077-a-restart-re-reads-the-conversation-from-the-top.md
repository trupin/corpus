# [CLI-077] Nothing carries a conversation forward, so every restart re-reads it from the top

## Domain

cli

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: **CLI-076** (the index this is surfaced at the top of),
  **CONTRACT-096** (the route), **SERVER-164** (the behaviour). The §6 rider is
  **signed** (SHARED-077, 2026-09-05) — the block below is resolved.
- ~~**Blocked on work that is not filed yet.**~~ Filed 2026-09-05: See *This issue cannot ship alone*
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

- [x] `corpus thread digest set <id>` accepts a body via `-m`, `--file` and
      stdin, and **never** as a positional argument.
- [x] A digest body containing a heredoc terminator, a `$(...)`, and a line
      reading as a turn heading round-trips **byte for byte** through the `--file`
      and stdin paths.
- [x] `corpus thread show <id> --index` prints the digest above the header, with
      its watermark.
- [x] A stale digest prints **marked stale**. It is never hidden and never
      silently replaced.
- [x] A thread with no digest prints no digest block — having none is the
      ordinary state, not a value.
- [x] Both surfaces' help states: summaries orient, they never act; read the turn
      verbatim before quoting or patching. (One shared spelling,
      `DIGEST_ORIENTS_HELP`, embedded in `digest`, `show` **and** `context` —
      three surfaces, since the pack carries the digest too.)
- [x] Measured on the reported thread's shape (19 turns, 32,724-byte whole
      read reproduced E2E): digest + index = **2,758 B**, `--last 3` =
      **5,405 B**, total **8,163 B ≤ 8KB**. See the E2E log.
- [x] `docs/cli.md` regenerates cleanly (`npm run docs:cli -w apps/cli`,
      Prettier-clean, `docs/generate.test.ts` green).

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

## Decisions (implementation, 2026-09-05)

1. **One verb, an `action` positional.** The registry dispatches
   `corpus <topic> <verb>` and nothing deeper, so `digest set <id>` /
   `digest clear <id>` are one `digest` verb whose first positional is
   `set|clear` — the command lines read exactly as this issue writes them, and
   the registry keeps its two-level shape. An unknown action is exit 2 naming
   both, before any body is read (so a heredoc is not consumed on the way to a
   refusal).
2. **An exactly-empty body is refused locally, exit 2**, hint naming
   `corpus thread digest clear <id>` — `thread reply`'s posture, one round trip
   earlier than the contract's `422`. A **whitespace-only** body is sent: the
   server owns what blank means, and its `422` names the same remedy.
3. **No pre-read on `clear`.** `thread release` pre-reads to disambiguate its
   no-op, but that pre-read is the whole conversation — paying a 32KB read for
   a courtesy sentence on the surface built to avoid 32KB reads. The line
   states the post-state (`<id> now carries no digest`), true in both cases.
4. **A body flag beside `clear` is exit 2** — a caller that typed `-m` on a
   clear meant something else, and nothing is sent.
5. **One renderer, one invariant spelling.** `digestLines()` and
   `DIGEST_ORIENTS_HELP` live in `digest.ts` and are shared by
   `show --index` and `thread context`, so a stale digest is marked identically
   wherever it is shown (§6's own wording) and the invariant cannot drift into
   three paraphrases.
6. **`thread context` renders the pack's `digest` first** — CONTRACT-096 put it
   on `contextPackBase`, the pack is the rehydration read, and the envelope
   travels unchanged under `--json`.
7. **No client-side actor guard and no length guard.** The route enforces
   "resident writes it" through thread state, deliberately leaving a person
   able to clear a wrong digest (CONTRACT-096's docblock), and the 2,000-char
   bound is the server's `400` — duplicating either here would be a second,
   staler copy of the rule.
8. **Setting a digest on a no-turn thread** is the server's `422` (SERVER-164's
   `NO_TURNS_MESSAGE`), rendered as answered — the CLI decides nothing.

## E2E Verification Log

**Model: fable** (cli-dev, 2026-09-05). Worktree of `phase-57-token-ledger`
(CONTRACT-096 + SERVER-164 + CLI-076 present). Built CLI
(`apps/cli/dist/bin/corpus.js`) against a real server started by
`corpus server start` (source layout via tsx), fresh `corpus init` workspace,
**port 8976**. Server pid 81813, started and stopped inside the session, port
verified free afterwards.

### Post-Implementation Verification

1. **Init + start**: `corpus init <scratch>/cli077-ws --port 8976` →
   `corpus server start` → `corpus 0.32.0 listening on http://127.0.0.1:8976`.
2. **Thread + resident**: `thread create --title "Mortgage decisions" -m …` →
   `th_mqfpaarr`, with the default general resident (§6 rider 2026-08-25), so
   no explicit designate was needed. Three more turns posted (`--from agent` /
   user alternating), 4 turns total.
3. **Hostile round-trip, byte for byte**: `thread digest set th_mqfpaarr
   --from agent <<'CORPUS_EOF'` with a body containing `$(date)`,
   `` `$(whoami)` ``, a bare line `EOF`, an indented ` CORPUS_EOF`, and a bare
   `## user · 2026-09-05T22:05:07Z` heading line. Printed:
   `set digest of th_mqfpaarr — covers turns through 2026-09-05T22:05:09Z`.
   `data/threads/th_mqfpaarr.md` frontmatter holds every one of those lines
   **literally** in the `digest.body` block scalar — no command ran, nothing
   reflowed, `watermark: 2026-09-05T22:05:09Z`, `stale: false`. Turn parsing
   below the frontmatter is untouched (4 turns render).
4. **Index block**: `thread show th_mqfpaarr --index` opens with
   `digest · covers turns through 2026-09-05T22:05:09Z`, the body, a blank
   line, then CLI-076's header and rows unchanged.
5. **The load-bearing staleness check**: deleted a covered turn through the
   real API as user — `curl -X DELETE …/api/threads/th_mqfpaarr/turns/
   2026-09-05T22%3A05%3A07Z` → `{"deletedTurn":true,…}`. Re-ran `--index`:
   first line is now `digest · STALE — a turn at or before
   2026-09-05T22:05:09Z was deleted or revised since this was written; it
   covers text that may no longer be there. Trust the turns, not this.` — body
   still printed below it, and the thread file shows `stale: true`.
   `thread context th_mqfpaarr` prints the same STALE block **first**.
6. **Measurement** (19-turn thread `th_kk6p7pxr` built to the reported shape —
   the original `cos` workspace thread is not reachable from this repo):
   - whole read `thread show`: **32,724 bytes** (reported: 32,375)
   - `thread show --index` (digest block + index): **2,758 bytes**
   - `thread show --last 3`: **5,405 bytes**
   - **digest + index + last-3 total: 8,163 bytes ≤ 8,192 (8KB)** — a quarter
     of the whole read, and flat-ish as the thread grows.
7. **Empty body**: `digest set th_kk6p7pxr --from agent -m "" < /dev/null` →
   exit **2**, `no digest to send.`, hint ends `An empty digest is not a clear
   — \`corpus thread digest clear th_kk6p7pxr\` removes one.` Nothing sent.
8. **No-resident 422 rendered as the server answers it**: released
   `th_mqfpaarr`'s resident, then `digest set … -m …` → exit **5**,
   `422 unknown_recipient: \`th_mqfpaarr\` holds no resident, and a digest is
   the resident's (SPEC.md §6). …` verbatim. The stranded digest still prints
   STALE in `--index` — readable, untouchable, honest (CONTRACT-096
   decision 6).
9. **Clear**: `digest clear th_kk6p7pxr --from agent --json` →
   `{"threadId":"th_kk6p7pxr","digest":null,"warnings":[]}`; `--index` shows
   no digest block; `grep -c digest data/threads/th_kk6p7pxr.md` → **0** (the
   frontmatter field is gone entirely).
10. **Teardown**: `corpus server stop` → `stopped (pid 81813)`; `lsof -i :8976`
    empty.

### Checks

- `npm run build -w packages/contract -w packages/kit -w apps/cli` — clean.
  (`apps/ui` was not built: the worktree's UI build is known-broken —
  `react-router` resolves only through the main checkout's nested
  `node_modules` — same limitation CONTRACT-096 recorded.)
- `VITEST_MAX_THREADS=4 npm test -w apps/cli` — **113 files, 2,357 passed, 0
  failed** (includes the new `digest.test.ts` (22), the digest cases added to
  `show.test.ts` and `context.test.ts`, and the two `hygiene.test.ts`
  inventories extended with `thread/digest.ts`).
- `npm run typecheck -w apps/cli` — clean. This also **closed the known red**
  CONTRACT-096 left: the five `context.test.ts` fixtures missing the pack's
  now-required `digest` field (fixed with `digest: null` on the shared base).
- `npx eslint apps/cli/src` — clean. Prettier — clean.
- `npm run docs:cli -w apps/cli` — regenerated `docs/cli.md`
  (+74/−12 lines), Prettier-clean, drift test green.

## Completion Checklist (domain agent)

- [x] The four upstream issues exist and are done. The §6 rider is **signed**
      (SHARED-077, 2026-09-05, in SPEC.md), CONTRACT-096 is done, and
      SERVER-164 is implemented on this branch (verified E2E above, not
      guessed). The AGENT issue (the skills that write the digest and honour
      the invariant) is downstream of this verb, not upstream of it.
- [x] Tests written and passing (2,357/2,357 in apps/cli)
- [x] `/lint` passes (eslint, prettier, `tsc --noEmit` for apps/cli)
- [x] E2E verification log filled in, including the staleness check and the three
      byte counts
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] The SPEC §6 rider is drafted, read back to the user, and **signed**
- [ ] `/audit` run (cross-domain — qualifies)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-077]` prefix
