# [CONTRACT-043] A turn has nowhere to record the model that wrote it

## Domain

contract

## Status

done

## Priority

P1

## Model

fable

## Dependencies

- Depends on: SHARED-027 (signed, applied)
- Blocks: SERVER-074, UI-090

## Spec References

- SPEC.md **§11** Thread view — "An agent turn says which model wrote it"
  (rider signed 2026-08-07)
- SPEC.md **§7** — the console's dispatch line, amended by the same rider
- SPEC.md **§6** — the turn format

## Summary

SHARED-027 is signed: an agent turn carries the model that produced it, so
"which model wrote this?" survives the job log being reaped. Nothing records it.

**This issue owns one decision, and it is the reason the issue is `fable`**:
*where* the model is written, given that a turn on disk is
`## <author> · <ISO instant>` followed by prose.

## The decision, and why it is not obvious

**Option A — extend the turn heading.** The natural place, and the dangerous one.
`core/turns.ts` finds turn boundaries by scanning for that heading shape, and
this project has already shipped **two** parser defects in that exact area:
AGENT-016 (a closing fence on a content line swallowed every later turn) and
SERVER-066 (`unterminated-fence`). A person's turn body can contain arbitrary
markdown, so every character added to the delimiter grammar is a new way for
content to imitate a delimiter. The most recent CRITICAL on this project was
precisely a delimiter content could imitate.

**Option B — a separate line inside the turn**, below the heading. Keeps the
delimiter untouched. But it is content, so a person can type it, and then the
same imitation problem appears one line lower with none of the heading's
structure to anchor it.

**Option C — frontmatter on the thread document**, keyed by turn timestamp.
Cannot be imitated by turn content at all, and does not touch the delimiter.
Costs locality: the record lives away from the turn it describes, and a turn
moved or copied loses it.

None is obviously right. **Answer it explicitly, with the parser history in
view, and write the reasoning where the next reader will find it.** Do not pick
the one that is easiest to render.

## The answer: option C — the thread document's frontmatter, keyed by turn timestamp

A thread file records its turns' models in a `turnModels` mapping in its own
frontmatter, beside the `anchors` map §6 already keeps there:

```yaml
---
id: th_x9y8
type: thread
agent: engaged
turnModels:
  2026-07-19T10:07:12Z: claude-opus-4-1
---
## user · 2026-07-19T10:05:00Z
@agent is 6.1% still the right assumption?

## agent · 2026-07-19T10:07:12Z
Checked current averages; 6.4% is more representative.
```

The key is the turn's timestamp — §6 already makes that the turn's identity and
guarantees it unique within a thread, and it is the key
`DELETE /api/threads/{id}/turns/{ts}` already addresses a turn by. **On the wire
none of this is visible**: `Turn` carries `model: string | null`, so the API
reads with the locality the file gives up. The full reasoning lives in
`packages/contract/src/schemas/turn-model.ts`, which is where the next reader
will be standing when they wonder why.

### Why not the heading (option A)

Two things make it worse than the general "every character added to a delimiter
is a new way for content to imitate one":

1. **It changes the meaning of bytes already on disk.** Widening the grammar is
   retroactive — a line that is prose in a thread file today becomes a turn
   delimiter the moment the server is upgraded, in every file, with no write to
   notice it on. SERVER-076's guard refuses a fabricated heading *at write time*
   and so cannot help; the fabrication predates the grammar. There is no version
   of A that is not a silent re-reading of the whole corpus.
2. **A model name is a display string**, so the grammar's last field would match
   arbitrary text — a delimiter with an unbounded tail. Restricting the charset
   to make it safe makes it an enum by the back door, which §7 forbids.

And the one that decides it against what the rider is *for*: if the attribution
rides the delimiter, whatever can write a delimiter can write an attribution.
"Which model wrote this?" would be answered by a claim, not a record.

### Why not a line inside the turn (option B)

It leaves the delimiter alone and inherits nothing for it: SERVER-076's guard
refuses *turn headings* in a body, not this marker, so every write door needs a
second guard — one that would have to refuse prose a person legitimately wrote.
Worse, the marker must be stripped on read and re-added on write, so `Turn.body`
stops being what its author typed. §6's trace line is not a counter-example: it
is content the agent writes *to be read*, and §6 resolves its ambiguity by
declaring a `↳ ` line elsewhere ordinary markdown. That resolution is
unavailable to an attribution.

### Why not `extra`, and why not the projection

`extra` is frontmatter too, and is the cheap answer inside option C's own
family. It is **client-writable** — an RFC 7386 merge patch on
`PUT /api/docs/{id}` — so an attribution stored there could be rewritten by an
ordinary API call. `turnModels` is therefore a **reserved** core key, which is
precisely what makes `extra` unable to name it. The SQLite projection is derived
and rebuilt from files (§9.1); a derived store cannot hold the only copy of a
fact whose whole purpose is to outlive runtime state.

### The cost, stated rather than hidden

**Locality.** The record lives away from the turn it describes: reading raw
markdown in `git log`, you match a timestamp against a map at the top of the
file. §6 made this exact trade for anchors ("the body stays clean — no inline
markers"), and the API pays it back by putting the model on the turn.

**A turn that moves loses it** — but there is no move: §6 makes a timestamp a
turn's identity, turns are appended and deleted, and a revision keeps its stamp.

**One real obligation, handed to SERVER-074: deleting a turn must delete its
entry.** `nextTurnTs` derives the next stamp from the stamps currently in the
body, so deleting the last turn frees its timestamp for reuse, and a stale entry
would then attribute a model to a different turn. An entry whose key is not a
turn of this thread is dropped — the same housekeeping §6 already requires of an
anchor entry when its thread is deleted.

## Acceptance Criteria

- [x] A turn can carry the model that wrote it, on the wire and in whatever the
      server persists — `Turn.model` on every read; `TurnModelsSchema` +
      `TURN_MODELS_FRONTMATTER_KEY` as the persisted shape, imported by the
      server's file-level frontmatter schema rather than restated
- [x] **Absent is a first-class state**, not a default or an empty string —
      `model` is **required and nullable** (the `threadRowShape`
      nullable-not-optional convention), `null` is always present, and a blank
      or empty-string model is refused by the schema so absence has exactly one
      spelling
- [x] Where a request ran in stages (§7), what is recorded is the **deciding**
      stage's model — said in the published description, in those words, with
      "one model, never a list" and the pointer to the job log for the per-stage
      account. `TurnModelsSchema` refuses an array value, so the file cannot
      accumulate one either
- [x] The chosen location **cannot be forged by turn content** — structurally,
      since the record is not in the body; tested anyway with adversarial bodies
      (`turn-model.test.ts` in both packages): model-bearing heading impostors,
      a `turnModels:` block fenced inside a turn, a `---` frontmatter block in a
      body, an HTML comment, a `↳ ` attribution line. None becomes a delimiter,
      none reaches the map, and `ExtraFrontmatterSchema` refuses `turnModels`
- [x] Round-trips — `apps/server/src/core/turn-model.test.ts` parses the same
      thread file with and without the record and gets identical turns with
      identical bodies; the body is byte-identical because the record is outside
      it entirely
- [x] Whether this belongs in §6's turn-format prose is **answered: yes**, and
      the line is **drafted below and HELD for user sign-off** — not applied
- [x] `openapi.json` and the typed client regenerated with
      `npm run generate -w packages/contract`, never hand-edited

## SPEC draft — §6, HELD for user sign-off (not applied)

**Answer: yes, §6 needs a line.** The test is the `anchors` precedent. §6
documents the anchors map in frontmatter not as an implementation note but as a
**commitment** — "the body stays clean, no inline markers" — because that is
what makes a thread file readable, a hand-edit safe, and the delimiter stable.
This decision makes the identical commitment about the identical file, and it is
exactly the commitment a future issue would otherwise undo by "simplifying" the
model into the heading. The spec should say WHAT is guaranteed (the record is
not in the turn text and the delimiter never carries it), not which key spells
it.

Proposed addition to §6, as a new paragraph after **Turn format**:

> **Which model wrote a turn is recorded outside the turn.** A thread document's
> frontmatter records, per turn timestamp, the model that wrote that turn (§11);
> the turn's own text carries none of it and the turn heading never grows a field
> for it. This is the same trade anchoring makes below — the body stays plain
> markdown, and what a turn's text says can never be mistaken for a record of who
> wrote it. A turn nobody recorded a model for simply has no entry, which is the
> "nothing rather than a guess" §11 requires; a person's turn never has one. The
> server is the only writer of the record, and it removes a turn's entry when the
> turn is deleted, so an entry never outlives the turn it describes.

_Held: not applied to SPEC.md. Requires user sign-off._

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/` (the turn shape), plus regenerated artifacts.
- Read `apps/server/src/core/turns.ts` before choosing — the parser is the
  constraint, and it is not in this domain.

### Notes

- **CONTRACT-039 deliberately kept request-time instruction off the turn**: a
  chosen *weight* is a directive, not a property of the message, and promoting
  it to a stored field was called out there as a separate decision needing
  sign-off. This issue does **not** overturn that. The model that wrote a turn
  is a fact about what happened, not an instruction about what should; SHARED-027
  was signed on exactly that basis. Keep the two apart, and say so in the
  description, or someone will later "unify" them.
- The model name is a display string, not an enum. §7 keeps model names in the
  skill; do not enumerate them in the contract.

## Testing Strategy

Round-trip over a thread file with and without the field; absent distinguishable
from empty; adversarial turn bodies attempting to forge it, if the chosen shape
makes that possible.

## E2E Verification Log

**Model: Fable 5** (`claude-fable-5`), as the issue recommends — the decision was
the work.

Not a bug, so no pre-fix reproduction. Evidence:

**Generation is idempotent, and the artifacts were never hand-edited.**
`npm run generate -w packages/contract` → exit 0. Ran again and compared
checksums:

```
IDEMPOTENT
a6c1a7b9b7822291f1a12ef6842bea0575c51e11  packages/contract/openapi.json
f86a7ad30156b97ee27134b73a852bba4034bbbc  packages/contract/src/client/schema.generated.ts
```

**The published shape is what was intended.** `Turn.model` in `openapi.json` is
`"type": ["string", "null"]` with `minLength: 1`, `maxLength: 200`, and required
(absent from no response). The generated client agrees, and the asymmetry is the
one the field was designed for:

```
schema.generated.ts:4537   model: string | null;   // Turn — response
schema.generated.ts:4561   model?: string;         // AppendTurnRequest
schema.generated.ts:4578   model?: string;         // MultipartAppendTurnRequest
```

**Forgery, tested rather than asserted.**
`packages/contract/src/schemas/turn-model.test.ts` (27 tests) drives `turnHeadings`
with adversarial bodies: `## agent · <ts> · claude-opus-4-1` and four variants,
a `turnModels:` mapping written as body text, a `---`-fenced frontmatter block
inside a turn, a ```` ```yaml ```` block containing the map, an HTML comment, and
a `↳ ` attribution line. None is read as a delimiter; a body stuffed with all of
them still parses as exactly the two real turns. `ExtraFrontmatterSchema` refuses
`turnModels`, so the client-writable door is shut too.

**Round-trip against the real parser.**
`apps/server/src/core/turn-model.test.ts` (9 tests) parses one thread file with
and without the record through `parseDocument` + `parseThreadBody`: identical
turns, identical bodies, and `parseDocument(WITH).body === parseDocument(WITHOUT).body`
byte for byte — the record is outside the body entirely. It also confirms the
`yaml` package keeps an unquoted instant key a **string** (1.2 core schema), so no
quoting hazard, and that `FileThreadFrontmatterSchema` accepts the file.

**Suites.** `npm run build` → exit 0. `npm run typecheck` → exit 0 (all
workspaces). `VITEST_MAX_THREADS=4 npx vitest run packages/contract packages/kit
apps/server apps/ui scripts` → **PASS 9109, FAIL 0**. `npm run lint` → exit 0;
`npm run format:check` → exit 0.

**Consumer fallout, deliberate.** Making `model` required-and-nullable made the
compiler enumerate every site that constructs a `Turn`. Two were production —
`apps/server/src/core/turns.ts` (a body carries no model, so `null`) and
`packages/kit/src/query/useAppendTurn.ts` (an optimistic *person's* turn, so
`null`) — and the rest were test fixtures. `apps/ui/e2e/serverParity.ts`'s
`StubTurn` was a hand-restated copy of `Turn`; it is now `type StubTurn = Turn`,
which is what would have caught this drift on its own. No local copy of anything
the contract owns was reintroduced.

**Handed to SERVER-074**: read the map and join it onto parsed turns; refuse a
`model` on a turn whose author is not `agent` (`400`, declared in the request
field's description); normalise a `Date` or offset key on read before the
contract schema sees it; and **drop a turn's entry when the turn is deleted** —
`nextTurnTs` frees a deleted last turn's stamp for reuse, so a stale entry could
attribute a model to a different turn.

## Completion Checklist (domain agent)

- [x] Tests written and passing (36 new: 27 contract, 9 server)
- [x] `/lint` passes (eslint, prettier, tsc all exit 0)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
