# [CONTRACT-054] Designating an archived agent succeeds silently, and the response cannot say so

## Domain

contract (then server)

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Related: CLI-043 (which could not implement its own acceptance criterion
  because of this), SERVER-109 (which made the decision deliberately)

## Spec References

- SPEC.md **§7** — designation is user-only state on a standalone thread

## Summary

`CLI-043` carried an acceptance criterion requiring `corpus thread designate` to
**warn inline when the response carries `status: "archived"`**. It is
unimplementable as written: the designation response carries no archived signal
at all.

This was a deliberate server decision, stated in
`apps/server/src/threads/resident.ts:150-153`, and CLI-043 verified the
behaviour against a real server: designating an archived agent-def succeeds
cleanly, `status` is `open` (the *thread's* status, not the agent's), `resident`
carries no status, and `warnings` is empty.

So the CLI could only warn by issuing a second `GET /api/docs/{docId}` and
re-deriving what the server chose not to publish — which is both a round trip
per designation and a client re-implementing a server judgment. CLI-043
escalated rather than doing that, correctly.

## The question this issue has to answer first

**Is designating an archived agent something a person should be warned about?**
Do not assume the acceptance criterion was right merely because it was written
down. There is a real case for silence: an archived agent-def is still a
document, designation is user-only state, and a person who archived a definition
and then designated it may well mean it. There is also a real case for warning:
archiving is how a person says "this is no longer current", and designating one
by name — most likely from a stale note or an old thread — is the kind of thing
worth one line of feedback.

If the answer is *no warning*, this issue closes by **removing the criterion
from CLI-043** and recording why, which is a legitimate outcome and cheaper than
building the mechanism.

## If the answer is yes

- [ ] The designation response carries whatever the client needs — most likely
      the resident's own document status — so no second request is required
- [ ] `SERVER-109`'s comment at `threads/resident.ts:150-153` is updated rather
      than left contradicting the new behaviour
- [ ] `openapi.json` regenerated; the field described in terms of what it is
      for, not merely its type
- [ ] A follow-up CLI issue restores the criterion CLI-043 could not meet

## Testing Strategy

Contract-side: the schema and its generation. Server-side: designating an
archived definition returns the signal, and designating a current one does not.

## E2E Verification Log

### Implemented on

opus.

### The question, answered: **no warning.** The criterion was wrong, not unmet.

Four reasons, in the order they decided it:

1. **Archiving an `agent-def` changes nothing about the persona.**
   `ResidentSchema.docId` publishes it in so many words — *"an archived
   `agent-def` still under that root resolves exactly as before, and is still
   designatable"*. A warning would tell a person their correct, fully-supported
   act was suspect, and a contract cannot say both.
2. **Archiving is an organisational act, not a deprecation** (SPEC.md §7: *"a
   reversible organizational act, never a deletion"*). Designation is user-only
   state on a standalone thread. A person who archived a definition and then
   named it has done two deliberate things.
3. **§11's `warnings` is about the write, not about the caller's judgement.** It
   carries a rejected auto-commit or a workspace with no git. A warning about
   *which document a request named* sets a precedent that every write
   editorialises about the documents it mentions, with no principled stopping
   point after the first one.
4. **The cheap-looking fix is not cheap.** `Resident` is consumed by four domains
   and appears in roughly fifty fixture literals (CONTRACT-071 measured it), and
   a status on it would contradict `docId`'s published sentence that
   *"archived-ness is not carried on a `Resident` at all — it is the document's
   own `status`, on the document this id names, for the caller that cares."*

A person who wants the answer keeps it one ordinary read away: `docId` names the
document and the document carries its own `status`.

### What changed

No wire change, no new field, no follow-up CLI issue.

- `issues/cli/043-lane-verbs-designation-and-corpus-agents.md` — the criterion is
  marked **retired, not deferred**, and its Unresolved section carries the four
  reasons above under an "Adjudicated 2026-08-24" heading.
- `apps/server/src/threads/resident.ts` — SERVER-109's comment already gave this
  reasoning and does **not** contradict the decision, so it stands. It gains a
  "Re-asked and upheld" paragraph so the next reader does not reopen the question
  by default.
- `packages/contract/src/openapi.test.ts` — a decision to publish nothing leaves
  nothing to assert about, so five assertions pin the reasoning's load-bearing
  published sentences instead: `Resident` has no `status` and the string
  `"archived"` appears nowhere in it, `docId` still says an archived profile
  resolves and is designatable, `docId` still points at the document's own
  status, and the designation operation carries no new warning code.

### Verified against the published document

From the running server on port **8838**:

```
Resident.properties = ['name', 'docId', 'weight', 'designationId']
```

No status, as decided.

### Gates

`vitest run packages/contract` — 2972 tests, exit 0. Typecheck, ESLint, Prettier
clean. `openapi.json` unchanged by this issue.

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-054]` prefix
