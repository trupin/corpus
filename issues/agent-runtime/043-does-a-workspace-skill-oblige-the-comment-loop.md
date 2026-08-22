# [AGENT-043] Does a workspace skill covering a domain oblige the comment loop to apply it?

## Domain
agent-runtime

## Status
todo

## Priority
P2

## Model
fable

## Dependencies
- Depends on: SHARED-067
- Related: AGENT-044 (which stopped on it rather than filling it)

## Spec References
- SPEC.md **§1** — *"a domain gets its shape from the templates, views and skills a workspace holds"* (SHARED-067)
- SPEC.md **§7** — skills as documents

## Summary

Raised by AGENT-044 and deliberately not answered there, which was right.

SHARED-067's replacement premise says a domain *"gets its shape from the
templates, views and skills a workspace holds"*. Read plainly, that says a
workspace skill covering a request should be applied.

**No skill text says so today.** `comment`'s *Routing directives* covers only the
**directed** case — a `/<skill>` on the turn, which the server parses into the
payload. *Skill genesis* only tells the agent to look for an existing skill when
it is about to codify a pattern. Nothing says "a skill exists for this, use it".

## Why it was not just written

Adding *"apply a workspace skill when one covers this request"* is **new
behaviour with a real cost**: a discovery step on every turn, in a loop whose
whole retrieval discipline is that the agent retrieves rather than enumerates
(§7). It would also need a rule for what happens when two skills both look
applicable.

**And it may already be covered.** Claude Code invokes skills from their own
frontmatter descriptions, so the runtime may do this without the skill text
saying anything — in which case writing it down would be a second mechanism
beside a working one, which is this repository's most-repeated defect.

## What to decide

1. **Does the runtime already do it?** Check before writing anything. If it
   does, the answer is a sentence saying so, not a procedure.
2. If it does not, is the discovery cost worth paying on every turn, or only
   when the request is unrecognised?
3. Two applicable skills: pick, or ask?

## Acceptance Criteria
- [ ] Decision 1 answered from observed behaviour, not assumption
- [ ] Whatever is decided is stated once, in one skill, and pinned
- [ ] No second mechanism beside the runtime's own invocation

## E2E Verification Log
_[Agent fills — state the model]_
