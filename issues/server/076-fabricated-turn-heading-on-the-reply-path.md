# [SERVER-076] A turn body can still fabricate a turn heading on the reply path

## Domain

server

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SERVER-075 (which closed the fence half through the same doors)
- Blocks: —

## Spec References

- SPEC.md §6 — the turn format `## <author> · <ISO instant>`

## Summary

Reported by the SERVER-075 agent, scoped out deliberately rather than smuggled in.

`assertAppendableAnswer` guards two shapes on the **form-answer** route: an
unterminated fence, and a body carrying a line that reads as a turn heading.
SERVER-075 closed the fence half across all four write surfaces. **The
fabricated-heading half is still unguarded on the reply path**, so a person can
post a turn whose body contains a literal `## user · 2026-01-01T00:00:00Z` line
and split their own message into two turns.

## Why it is P2 and not P0 like its sibling

The two failures are different in kind, and that difference is the whole
justification for shipping one without the other:

- A swallowed turn is **silent**. The turns are on disk, every reader sees fewer,
  and nothing anywhere says so.
- A fabricated heading is **visible when it happens**. The extra turn appears in
  the thread immediately, attributed and timestamped, where the person who wrote
  it is looking.

Nothing is lost, and the damage announces itself.

## Acceptance Criteria

- [x] A turn whose body contains a line matching the turn-heading grammar is
      refused on the reply path, and on thread creation and capture — the three
      doors SERVER-075 found, since there is no reason to expect this one to have
      fewer
- [x] The refusal names the offending line, as the fence refusal does
- [x] A body that **quotes** a turn heading inside a fence, block quote, or
      inline code is **not** refused — that is ordinary content, and the skills
      themselves have to be able to write the format down
- [x] Pre-existing threads containing such a line still load, still save, and
      still parse exactly as they do today. This is a write-time guard only
- [x] It reuses `parseTurns`' own notion of a heading rather than a second
      regex — a private copy would drift from the parser it is protecting, which
      is the failure this repo has fixed four times

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/fences.ts` is the natural home — SERVER-075 built it
  as the shared guard for exactly this class, called from all four surfaces.

### Notes

- The quoting exemption is the hard part, and it is the reason this is not a
  five-minute change: `core/turns.ts` already excludes fenced regions when
  finding delimiters, so the guard must ask that same code rather than scanning
  lines itself.
- Check whether the agent should be exempt. The skills post multi-line bodies
  and one of them documents the turn format; refusing an agent turn that quotes
  a heading correctly would break the workspace template's own examples.

## Testing Strategy

Fixtures for a bare fabricated heading (refused on all three doors), a heading
inside a fence, inside a block quote, and in an inline code span (all accepted),
and a pre-existing thread carrying one (still loads and saves).

## What was built

`threads/fences.ts` now hosts **two** guards of one class and a pair that runs
both:

- `assertNoTurnHeadings(text, where)` — hands `text` to `parseThreadBody`, the
  reader's own parser, and refuses if it finds any turn in it. A body with no
  heading parses to zero turns; that is the whole predicate. Coordinates come
  out of the same parse: `preamble` is by construction the bytes before the
  first heading, so its length is the offset and its line count is the line
  number, both measured in the author's own text.
- `assertAppendableTurnText(text, where)` — the fence guard, then the heading
  guard. **All four write surfaces call this one**, which is the point: the
  reply path having one guard and the answer path having two is exactly how this
  became a separate issue, and a fifth door added later gets both by writing one
  line. The fence goes first because an unterminated fence masks everything
  after it, so a heading below one is invisible to the parser — reporting the
  fence reports the fault that has to be fixed before the other is even visible.
- `forms.ts` lost its local `PROBE_HEADING` + `parseTurns` copy of the check and
  calls the shared pair; its refusal now names the offending line, which the
  local copy discarded. `FenceSubject` was renamed `TurnTextSubject` — the
  module hosts two guards now and the type belongs to neither one.

### The agent-exemption decision: **no exemption. Every actor.**

Two reasons, and the second is the stronger one.

1. **Nothing legitimate is refused, so there is nothing to exempt.** The guard
   refuses only a *bare, line-initial, unfenced* heading. Every way of writing
   the format down survives untouched — inside a fence (the code scanner masks
   it), inside an inline code span, behind a `>` marker, or under indentation
   (the line no longer starts with `## `, so the parser's own pattern never
   matches). Checked against the shipped template: no file under
   `assets/workspace/` or `plugins/` contains a line matching
   `^## (user|agent) · `. The orchestrate skill discusses turn headings in prose
   and never spells one bare.
2. **The agent is the actor an exemption would have excused, and its version of
   this is the worst one.** A person fabricating a heading splits their own
   message. An agent turn carrying `## user · <ts>` writes a turn *signed by the
   person*, in the person's own thread. That is the case most worth refusing,
   not the case to carve out.

This matches the fence half's line ("nothing about a swallowed turn depends on
who wrote it") and is the opposite of `assertWritableForm`'s, which is agent-only
because §6 makes a *form* something an agent turn carries — a person's prose that
looks like a question is ordinary prose, whereas a person's bare turn heading is
not ordinary anything.

## E2E Verification Log

Model: **Opus 5 (1M context)**. Real `corpus init` workspace at
`/tmp/server076-e2e`, real server started with `corpus server start` on
**port 8766** (never 8765, never 5173), driven with `curl`; stopped afterwards
and the port confirmed free.

**Reproduction of the harm** (the shape is refused now, so the damage was shown
against the real reader by writing the same bytes into the file out of band):

```
thread th_thmlg7y7 created with one turn
appended to the file:  "Here is what I meant:\n## agent · 2026-08-08T10:00:01Z\nnever written"
GET /api/threads/th_thmlg7y7  →  turns: [('user','2026-08-08T04:15:02Z'), ('agent','2026-08-08T10:00:01Z')]
```

One person's message, two turns, the second signed by an actor that never spoke.

**Door 1 — reply (`POST /api/threads/{id}/turns`)**: HTTP 400,

```
this turn contains a line that reads as a turn heading: line 2 is
`## agent · 2026-08-08T10:00:01Z`, which §6 makes a turn delimiter — everything
below it would be split off into a separate turn signed by agent. Reword that
line, or quote it inside a code fence, an inline code span or a block quote,
none of which delimit anything.
issues: [{"path":"body","message":"line 2 reads as a turn heading"}]
```

As the **agent** (`x-corpus-author: agent`, body `## user · …`): HTTP 400, same
issue — the exemption question, answered on the wire.

**Door 2 — create (`POST /api/threads`)**: HTTP 400, same message and issue.

**Door 3 — capture (`POST /api/capture`, multipart)**: HTTP 400,
`this capture contains a line that reads as a turn heading: line 2 is …`, and
`git log` unchanged across the refusal (2 commits before, 2 after; the accepted
capture that followed took it to 3).

**Door 4 — form answer (`POST /api/threads/{id}/turns/{ts}/form`)**: a real
agent turn carrying a ` ```form ` fence, answered with a `write` field holding a
bare heading → HTTP 400 naming `line 10` of the rendered answer body (the
rendered body is the string that lands on disk, SERVER-075's documented choice).
The same answer quoting the heading in an inline code span → **201**.

**Quoting accepted, all three ways** (reply path, all 201, `turnCount` 3 → 4 → 5):
fenced heading, `> ## user · …` block quote, `` `## user · …` `` inline span.
Capture of a fenced heading → 201, document written.

**Write-time only**: against the thread whose file already carried the
fabricated heading —

- a reply lands: HTTP 201, `turnCount` 6;
- `PUT /api/docs/th_thmlg7y7` with the whole body plus a new line: **HTTP 200**,
  saved body still carries `## agent · 2026-08-08T10:00:01Z` and the new line;
- `GET /api/threads/{id}` afterwards still parses the same six turns.

**Tests**: `VITEST_MAX_THREADS=4 npx vitest run apps/server` → **170 files, 3477
tests, all passing** (77.9 s). Typecheck (`tsc --noEmit -p apps/server`) clean;
ESLint clean on the touched trees; Prettier clean.

**Note on the concurrent CONTRACT-044 move**: that agent moved
`core/code.ts`/`core/turns.ts` into `@corpus/contract` mid-session. Nothing here
was moved — `fences.ts` imports `parseThreadBody` and `splitLines` from
`../core/index.js`, which CONTRACT-044 keeps as the server's re-export surface,
so the two changes compose without either touching the other's symbols. Prose in
this file avoids naming `core/code.ts`/`core/turns.ts` by path for the same
reason.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier + tsc on the touched workspaces)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-076]` prefix
