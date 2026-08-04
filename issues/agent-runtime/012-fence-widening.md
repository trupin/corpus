# [AGENT-012] A snippet containing ``` splits into several snippets

## Domain
agent-runtime

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: AGENT-010 (which established the labeled-fence convention)
- Blocks: —

## Spec References
- SPEC.md §11 Thread view, copyable canvases (rider signed 2026-08-02)

## Summary
Live report 2026-08-03, with a screenshot: a single deliverable the agent emitted
rendered as **three separate canvases**, with the text between them spilling out
as ordinary prose. The payload was a prompt that itself contains markdown —
`## Output format`, bullet lists, and fenced examples.

The cause is CommonMark, not the renderer: a fence opened with three backticks
**closes at the first line with three backticks**. So the moment the agent wraps
a payload that itself contains ``` in a three-backtick fence, the fence
terminates early, the payload's own fence markers become the boundaries of new
blocks, and one snippet becomes several with prose leaking between them. The
copy buttons then copy fragments, which is the part that actually costs the user
something — AGENT-010 exists so a deliverable can be lifted in one gesture, and
this silently defeats it.

The fix is on the **producer** side: a fence must be longer than any backtick run
inside its payload. Four backticks around a payload containing three; five around
one containing four. This is what `remark-stringify` does automatically when the
editor serializes, and it is what the skills must do by hand when they compose
markdown as text.

## Investigation: ANSWERED — the editor does not corrupt (orchestrator, 2026-08-03)

The P0 question was whether opening such a document and letting autosave write it
back would split the block **on disk**. It does not. Probed against the repo's
own printer with the payload shape from the user's screenshot — a four-backtick
fence whose body contains a three-backtick fence:

```
PARSE   -> code blocks: 1
SERIALIZED:
````markdown
## Output format

```
owner | action | topic
```

**Critical instruction**
````
REPARSE -> code blocks: 1
WIDENED FENCE KEPT: true
```

So `remark-stringify` widens correctly, the round-trip is stable at one block,
and `serialize.ts`'s docblock claim ("fence widening is deliberately not
hand-rolled") holds. The normalisation line that reads "fences are ```" describes
the default, not a cap.

**Therefore this is purely a producer-side fix.** The agent emitted a
three-backtick fence around a payload that itself contains three backticks; the
fence closed early and one snippet became several. Nothing in Corpus needs to
change to hold a correctly-widened fence.

Two things still owed:
- A regression test for the widened-fence round-trip. `serialize.test.ts` /
  `roundtrip.test.ts` have no nested-fence case (grepped: no "widen", no
  backtick-run fixture), so the property proven above is currently unguarded and
  a future serializer change could break it silently. **File this as a small UI
  issue rather than leaving the probe as the only evidence.**
- Documents already written with the split are not retroactively repaired; note
  that in the skill guidance so the agent does not assume old output is fine.

## Acceptance Criteria
- [ ] The skills' fence convention states the widening rule explicitly, with an
      example of a payload containing ``` and the four-backtick fence around it
- [ ] The rule is stated where the deliverable convention lives (AGENT-010's
      section), not as a footnote elsewhere
- [ ] `assets/workspace/claude/skills/orchestrate/SKILL.md` and
      `comment/SKILL.md` both carry it — a convention only one skill knows is a
      convention that lasts until the other one writes something
- [ ] The round-trip question above is answered in writing, with the evidence
- [ ] Guidance covers the general case (longest run + 1), not just the
      three-into-four case, so a payload containing ```` is also handled

## Technical Design
### Files to Create/Modify
- `assets/workspace/claude/skills/orchestrate/SKILL.md`
- `assets/workspace/claude/skills/comment/SKILL.md`
- `.claude/agents/agent-runtime-dev.md` domain knowledge, if the round-trip
  answer is worth keeping

### Notes
- `agent-runtime-dev`'s domain knowledge already records "never nest fences in
  bash examples" — that note was about the SKILL files themselves. This is the
  same hazard one level out: about what the agent *writes into the workspace*.
  Make the distinction explicit so the next reader does not think it is covered.

## Testing Strategy
The skills carry no runner. Verify by having the agent emit a payload containing
a fence in a real workspace and confirming it renders as one canvas whose copy
button yields the whole thing.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] `/lint` passes (prettier covers markdown)
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
