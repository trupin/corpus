# [CLI-076] A thread is read whole or not at all, so every reply pays for the whole conversation

## Domain

cli

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: CLI-077 (the digest is surfaced at the top of this verb's index)
- Related: CLI-055 (`doc show --headings` / `--section` — this is its thread-side
  twin, and its decisions are the precedent), CLI-065 (`doc list --json`
  verbosity, from the same measurement session), CLI-058 (fixed startup cost per
  invocation)

## Spec References

- SPEC.md **§2** — the CLI is the agent's whole surface
- SPEC.md **§6** — turn format: an H2 heading `## <author> · <ISO timestamp>`,
  timestamps unique and monotonic within a thread, and **they are the turn's
  identity**
- SPEC.md **§7** — Retrieval discipline: reading is bounded on purpose
- **CLAUDE.md Architecture Decision 2** — *"The agent interacts with the system
  **only through the CLI**."*

## Summary

Reported from live use, 2026-09-03, with measurements. Corpus 0.32.0, the `cos`
workspace.

`corpus thread show` declares `flags: []`
(`apps/cli/src/commands/thread/show.ts:76`). It renders the title, the state
lines, and then **every turn**, oldest first. There is no way to ask it for less.

**Measured**: a 19-turn thread (`th_lnj76e2u`) is **32,375 bytes** — about **8K
tokens** at the 1 byte ≈ ¼ token rate this repo counts by. Every read of that
thread costs 8K tokens, and the cost grows with the conversation. An agent that
reads the thread three times in a session pays 24K tokens to learn nothing new
the second and third times.

**This is the one unbounded read left in the comment skill's path, and it sits
next to a verb that refuses to be unbounded.** `corpus thread context` is bounded
by contract — at most `CONTEXT_MAX_EXCERPTS` excerpts, `CONTEXT_MAX_EXCERPT_CHARS`
each — and its own help says why it has no flags: *"the bounds live in the
contract, so there is no way to ask this verb for the dump it exists to refuse."*
That verb is careful because §7 asks it to be. Then the skill calls
`thread show`, which the context pack deliberately does not carry turns for, and
the dump arrives anyway.

## Why this is P0 rather than an ergonomic wish

Three reasons, in ascending order.

1. **The cost is paid on every reply, not once.** §7's loop reads a thread before
   it answers. A workspace with ten live conversations pays this on every wake.
2. **It scales the wrong way.** `thread context` costs roughly the same however
   large the corpus grows, by design. `thread show` costs more every time
   somebody speaks. The two verbs the same skill calls in sequence have opposite
   cost curves.
3. **The decisive one, and it is the same one CLI-055 named.** The cheap way to
   read three turns of a thread today is `sed -n` against the file in
   `data/threads/`. That works, and it goes around the CLI, which Architecture
   Decision 2 forbids. An architecture decision that costs 8K tokens to honour
   will not be honoured.

## What to build

Two things, both derived from the `turns` array the endpoint already returns.
Nothing is generated, nothing is stored, so nothing can go stale.

### `--index` — the map

A header line, then one line per turn:

- **Header**: title, status, turn count, total bytes.
- **Per turn**: turn number, author, timestamp, byte count, first-line excerpt.

### Verbatim fetch by address — the territory

- `--turn <n>` — one turn.
- `--turns <a,b-c>` — a list, ranges allowed.
- `--last <n>` — the newest `n`.
- `--since <iso>` — the turns after a timestamp.

**This is `doc show --headings` + `--section` for threads**, a shape agents in
this workspace already know. Read the index, decide, fetch what you need.

## Acceptance Criteria

- [x] `corpus thread show <id> --index` prints the header and one line per turn,
      and nothing else.
- [x] The index for the 19-turn thread above prints in **~1.5KB** — the reported
      measurement is the target, and the issue records what it actually came to.
      **Measured: 2,073 bytes** for a 19-turn, 34,713-byte conversation. Above
      the 1.5KB target because a row carries a 20-character ISO timestamp and a
      60-character excerpt; the index size is bounded by turn *count* and does
      not grow with turn size.
- [x] `corpus thread show <id> --last 3` prints only those three turns, **byte
      for byte** as stored.
- [x] `--turn`, `--turns`, `--last` and `--since` each address turns and print
      no other turn's body.
- [x] An address that matches nothing **fails loudly** and never falls back to
      printing the whole thread. **With one argued exception, recorded as
      decision 5**: a `--since` whose instant is valid but later than every turn
      exits 0 with `(no turns after <ts>)`, on the same reasoning the issue's own
      Edge Cases give `--last 50` of 19 turns. Every *malformed or unsatisfiable*
      address — including an unparseable `--since` — is exit 2, and in no case is
      the whole thread printed.
- [x] `--index --json` emits the derived rows and **no turn bodies**.
- [x] `corpus thread show <id>` with no flags is byte-for-byte what it prints
      today. This verb's existing contract does not move.
- [x] `docs/cli.md` regenerates cleanly (SPEC.md §11 drift check).

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/thread/show.ts` — the flags, the two printing paths.
- `apps/cli/src/commands/thread/turns.ts` — **new, a deviation from the plan
  above**: the index projection, the address grammar and the selection. Split out
  on `doc/show.ts` + `doc/sections.ts`'s precedent, which is the same feature on
  the document side; `show.ts` was already 7KB of prose and behaviour. Added to
  both pinned inventories in `commands/hygiene.test.ts`.
- `apps/cli/src/commands/thread/show.test.ts` — the cases below.
- `docs/cli.md` — regenerated, not hand-edited.

### Decisions taken (recorded 2026-09-05, implemented on opus)

**1 — CLI-side projection, not a server route.** The whole thread still crosses
the socket, and the help says so in as many words. CLI-055's decisive argument
does **not** carry here and was not borrowed: a turn is a discrete record with
its own identity, not a substring that a later `doc patch --old` has to match, so
a server-computed slice would not be a second definition of anything. The wire
case is therefore genuinely stronger than it was for `--section` — a route would
save ~35KB per read on the measured thread. It was still declined for this issue,
on three grounds: the cost being paid is the **agent's context**, which a CLI
slice removes in full; a route needs a CONTRACT issue and a SERVER issue before
it can deliver a byte, and this is P0; and slicing the one response already in
hand cannot disagree with what that response said. A test pins the request count
at one so no future edit can quietly start claiming a wire saving.
**Escalated to the orchestrator**: a follow-up CONTRACT/SERVER pair for a
turn-range parameter on `GET /api/threads/{id}` is worth filing, and this issue
deliberately does not pre-empt it.

**2 — `--turn` addresses by ordinal *or* timestamp.** SPEC.md §6 makes the
timestamp the turn's identity, and it permits deleting a single turn, after which
every later ordinal silently points at a different turn. So the index prints
both, `--turn` accepts either (`--turn 7` or `--turn 2026-07-28T10:05:00Z`), and
the flag's help states plainly which one survives a deletion. Instants are
compared as parsed times, so the file's second-precision form and the API's
millisecond form both address the same turn. `--turns` takes **ordinals only** —
a range written over instants cannot be told from the dashes inside them, and a
single turn already has a durable address through `--turn`.

**3 — A byte count is the turn's body in UTF-8, and nothing around it.** Not the
`## author · ts` heading, not the blank line between turns. Two properties follow
and both are asserted by tests: the header's total is exactly the sum of the
rows, and a row's count predicts what `--turn <n>` writes. The help says the
heading is excluded.

**4 — The addressed path is byte-exact and the whole read keeps its `trimEnd`.**
The no-flag path is the existing contract and does not move. An addressed turn's
body is written raw through `out.write`: nothing trimmed, nothing collapsed, and
no newline appended after the last one. The `author · ts` line above each body,
and the blank line between two of them, are the verb's **framing** rather than
stored bytes — the help says so, and the E2E log below shows exactly which lines
of a slice are framing and which are the file's own.

**5 — `--since` is exclusive.** The natural caller holds the `ts` of the last
turn it read and asks what came after it, so that turn is not part of the answer.
The help states it, because one invocation cannot tell you. An **empty** result
is exit 0 with `(no turns after <ts>)`: a loop asking "anything new?" on every
wake would otherwise read its own quiet as a failure, and the issue's own Edge
Cases already carve out the same shape for `--last 50` of 19 turns. An
unparseable instant is still exit 2.

**6 — Flag combinations.** `--index` beside any address flag is exit 2, on
`doc show --headings`/`--section`'s precedent — they ask different questions.
Two address flags together are exit 2, naming both. Any address flag with
`--json` is accepted and emits `{id, turnCount, turns:[…]}` with byte-exact
bodies and no framing; `--index --json` emits `{id, title, status, turnCount,
bytes, index:[…]}` and no `body` key anywhere. Every combination check runs
**before the request**, so a usage error never costs a round trip.

### Decisions left to the implementer, to make and record in this file

CLI-055 left four and the record of what it chose is why that feature is
trustworthy. These are this issue's.

1. **CLI-side projection, or a server route?** CLI-055 chose a CLI-side slice and
   said in its help that **no wire saving is claimed**. The recommendation here
   is the same, for its second and third reasons — a route needs a CONTRACT issue
   and a SERVER issue, and this is P0. But **be honest about the asymmetry**:
   CLI-055's decisive argument was that a server-computed section would be a
   *second definition* of the bytes `doc patch --old` matches against. That
   argument does not carry here — turns are discrete records with their own
   identity, not a substring of anything. So the case for a route is stronger
   than it was for `--section`, and it saves 32KB of real wire. **Decide, and do
   not borrow CLI-055's reasoning wholesale.** If it stays CLI-side, the help
   must say the saving is context and not wire, and a test must assert the
   request count is still one.

2. **What addresses a turn: an ordinal, or its timestamp?** SPEC §6 is explicit
   that **timestamps are the turn's identity**, and it also permits a person to
   **delete an individual turn** (`DELETE /api/threads/:id/turns/:ts`). So an
   ordinal is a positional address that a deletion silently re-points at a
   different turn. Recommendation: the index prints **both**, `--turn` accepts
   **either**, and the help says which one survives a deletion. An ordinal is the
   ergonomic address and a timestamp is the durable one — say so rather than
   letting a caller discover it.

3. **What a byte count counts.** Define it once so the header total is the sum of
   the rows, and so a row's count predicts what `--turn <n>` will print. The
   turn's body in UTF-8 is the useful definition, because that is what a caller
   is deciding whether to fetch. If the heading line is excluded, the help says
   so.

4. **Whether `--turn` prints byte-exact.** It must, and this is a change from
   what the verb does now: `runThreadShow` prints `turn.body.trimEnd()`. That is
   right for a human-facing whole read and **wrong for a slice meant to be
   quoted** — CLI-055's whole lesson is that a prettified excerpt fails a
   byte-exact match downstream. Decide whether the no-flag path keeps its
   `trimEnd` (recommended: yes, it is the existing contract) while the addressed
   path does not, and state the difference in the help.

5. **`--since` — inclusive or exclusive?** The natural caller holds the timestamp
   of the last turn it read and asks what happened after. Recommendation:
   **exclusive**. Either way, say which, because the caller cannot tell from one
   invocation.

6. **Flag combinations.** `--index` with an address flag, two address flags
   together, an address flag with `--json`. Decide each, and prefer a usage error
   over a silently-ignored flag — a flag that does nothing is how a caller comes
   to believe it got a slice when it got a dump.

### Edge Cases

- A thread with **no turns**: the index prints its header and the existing
  `(no turns)` line, not an empty table.
- `--turn 0`, `--turn 99`, `--turns 5-3` (reversed), `--last 0`, `--since` with
  an unparseable timestamp: each is a usage error naming the fault. **None of
  them prints the whole thread.**
- `--last <n>` where `n` exceeds the turn count: prints every turn, exit 0. This
  is the one over-range that is not an error — "the newest 50 of 19" has an
  obvious honest answer.
- A turn whose body is **empty**, or attachment-only (SPEC §6 permits it): it
  gets an index row with a zero byte count and an empty excerpt, not a missing
  row.
- A turn body containing an **open fence** or a line that reads as a turn heading
  — `--turn` prints it verbatim regardless. This verb reports what is stored;
  SPEC §11 is what reports that it is malformed.
- The index **excerpt is truncated and must be marked so** (a trailing `…`). An
  unmarked excerpt is a quotable-looking string that is not the stored text, and
  that is precisely the failure CLI-055 recorded against `search`'s snippet.

## Testing Strategy

Vitest, colocated in `show.test.ts`, against the stub server the other thread
command tests use.

- The index of an N-turn thread has N rows plus a header, and the header's total
  equals the sum of the rows.
- `--last 3` on a 19-turn fixture prints exactly turns 17–19 and no other body.
- A fixture turn whose body has trailing whitespace and an internal blank line
  comes back from `--turn` **byte-identical** to the fixture.
- Every bad address in Edge Cases exits non-zero and its output does not contain
  a body from the fixture. Assert the *absence* — an exit code alone would pass
  while a fallback dump printed underneath it.
- `--index --json` output contains no `body` key.
- The no-flag path's output is unchanged against the existing assertions.
- If the CLI-side slice is chosen: a test asserting exactly one request.

## E2E Verification Plan

### Verification Steps

1. Rebuild and restart against a real workspace with a long thread:
   `npm run build && corpus server restart`.
2. `corpus thread show <id> | wc -c` — record the whole-read byte count.
3. `corpus thread show <id> --index | wc -c` — record it, and state the ratio.
   The reported figures are 32,375 → ~1,500.
4. `corpus thread show <id> --last 3 > /tmp/tail.txt`, then confirm those bytes
   appear verbatim in `data/threads/<id>.md` — `grep -F -f` or a diff of the
   extracted region. This is the byte-exactness proof and a paraphrase of it is
   not evidence.
5. `corpus thread show <id> --turn 999` — confirm non-zero exit and confirm the
   output does **not** contain the thread's turns.
6. `npm run build && node --import tsx scripts/check-generated-artifacts.ts` —
   `docs/cli.md` regenerates clean.

## E2E Verification Log

Implemented on: **opus**.

### Post-Implementation Verification

Real binary (`node apps/cli/dist/bin/corpus.js`, built from this branch) against
a real server: a scratch workspace at `/private/tmp/.../scratchpad/ws`,
`corpus init --port 8972` then `corpus server start` (pid 14297, stopped at the
end, port confirmed free). The user's own server on 8765 was never touched.

Two 19-turn threads were seeded through the CLI: `th_xx5spuft` with ~456-byte
turns, and `th_freo7ey4` with ~1,827-byte turns, which is the size the reported
32,375-byte conversation had.

**The two byte counts and the ratio** (`th_freo7ey4`, 19 turns):

```
$ corpus thread show th_freo7ey4 | wc -c
   35505
$ corpus thread show th_freo7ey4 --index | wc -c
    2073
$ corpus thread show th_freo7ey4 --last 3 | wc -c
    5573
```

**35,505 → 2,073 bytes: a 17.1× reduction**, against the reported 32,375 → ~1,500
(21.6×). The index is 2,073 rather than ~1,500 because each row carries a
20-character ISO timestamp and a 60-character excerpt. The smaller thread gives
9,443 → 2,040 (4.6×), which is the same index size — the index is bounded by turn
count and does not grow with turn size, which is the property the feature is for.

The header and the first rows:

```
$ corpus thread show th_freo7ey4 --index
Rate assumptions, at length · th_freo7ey4 · open · 19 turns · 34713 bytes
1   user   2026-09-05T21:02:58Z  1827 B  I pulled the rate sheet again this morning and the 6.1% figu…
2   agent  2026-09-05T21:02:59Z  1827 B  I pulled the rate sheet again this morning and the 6.1% figu…
```

19 × 1,827 = 34,713, so the header's total is exactly the sum of the rows. Every
excerpt ends in `…` because every turn body is longer than its first line.

**The byte-exactness proof**, against the thread file rather than a paraphrase:

```
$ corpus thread show th_freo7ey4 --last 3 > /tmp/tail2.txt
$ grep -c . /tmp/tail2.txt
75
$ grep -F -x -v -f data/threads/th_freo7ey4.md /tmp/tail2.txt
user · 2026-09-05T21:03:14Z
agent · 2026-09-05T21:03:15Z
user · 2026-09-05T21:03:16Z
```

Every one of the 75 non-blank lines of the slice is found **verbatim** in
`data/threads/th_freo7ey4.md` except three — and those three are exactly the
`author · ts` framing lines, which the file writes as `## author · ts`
(decision 4). Not one line of the three turns' bodies differs by a byte. The same
run on `th_xx5spuft` gives 21 lines with the same 3 framing exceptions.

**A miss never falls back to the dump:**

```
$ corpus thread show th_xx5spuft --turn 999
corpus: --turn 999 names no turn: this thread has 19 turns.
  Turns are numbered 1–19, oldest first; --index prints them.
$ echo $?
2
```

Nothing of the conversation is printed — the two lines above are the whole
output.

**One turn, verbatim**, and `--since` exclusive of the instant it names:

```
$ corpus thread show th_xx5spuft --turn 5
user · 2026-09-05T21:02:08Z
I pulled the rate sheet again this morning and the 6.1% figure still stands.
…
I will check again next week and say if anything has changed.
$ corpus thread show th_xx5spuft --since 2026-09-05T21:02:21Z | head -3
user · 2026-09-05T21:02:22Z
I pulled the rate sheet again this morning and the 6.1% figure still stands.
```

`--since` on the 18th turn's `ts` returns the 19th and not the 18th.

**`--index --json` carries no body:**

```
$ corpus thread show th_xx5spuft --index --json | grep -c '"body"'
0
```

**Docs.** `npm run docs:cli -w apps/cli` regenerates `docs/cli.md`; running it a
second time produces an identical file (same md5), and
`npx prettier --check docs/cli.md` passes. `node --import tsx
scripts/check-generated-artifacts.ts` reports the CLI reference as differing from
`HEAD`, which is the expected state for an uncommitted regeneration — the
generator's output is stable and formatted.

**Unit tests.** 53 in `thread/show.test.ts`, all passing, including the pinned
no-flag rendering that proves the existing contract did not move.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence, including the two
      measured byte counts
- [x] The six decisions above are recorded in this file, with reasons
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-076]` prefix
