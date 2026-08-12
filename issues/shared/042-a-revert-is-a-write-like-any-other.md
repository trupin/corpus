# [SHARED-042] A revert is a write like any other

## Domain

shared (orchestrator-handled — SPEC.md rider)

## Status

done — **decided by the user 2026-08-12 and applied to SPEC.md §7**

## Priority

P0

## Model

fable

## Dependencies

- Depends on: SHARED-041 (the key this relies on)
- Blocks: CONTRACT-050, SERVER-104, CLI-040, AGENT-023
- Related: SERVER-090 (**now load-bearing** — see below), SERVER-103 (evaporates)

## Spec References

- SPEC.md **§7** "Loop safety" — replaced
- SPEC.md **§2.4** (twice), **§4** (twice), **§15** M5 — references removed
- SPEC.md **§9.1** — the watcher and out-of-band edits

## Summary

PR #43's review found `corpus skill rollback` overwrites a whole file with an old
revision, destroying uncommitted edits **unrecoverably**, at exit 0, with no
warning. Reproduced on a real server: because the restored bytes equalled `HEAD`
the rollback made no commit, and the destroyed text had never been committed
either — so it existed in no git object, no reflog, no stash.

The first proposed fix was to make rollback present a key. The **user's** answer
was better: revert the commits rather than overwrite the file. §7 already said
so — "a targeted git revert, performed by the server" — and
`apps/server/src/skills/rollback.ts`'s own header comment claimed the revert it
did not do.

Following that through led somewhere simpler still. **A revert is a write whose
content came from history.** It needs no verb and no revert engine:

- through the ordinary write path it reconciles anchors (§6), validates (§14),
  commits under the acting party (§4), re-projects, and is protected by §7's key
- a dedicated server-side verb has to reimplement all four, and replaces a whole
  file rather than reverting a path — which is exactly how the data loss happened

So the verb goes. The **skill** stays, and gains what it was always missing:
how to revert. Reading history is not writing, and the agent is good at git.

## The decision, and its one real cost

**Loop safety** was the verb's justification: a bad edit to `orchestrate` breaks
the loop that would otherwise fix it, so recovery must work with no agent
running. Without a verb, the operator reverts in the workspace with git directly.

That makes **SERVER-090 load-bearing**. Today an out-of-band edit is never
committed for itself and is swept into the next mutation under *that* mutation's
author — so the operator's recovery would leave either no trace or a false one.
§7's replacement text now states the guarantee explicitly ("the watcher picks
that up as the out-of-band `user` edit it is and commits it for itself"), which
means **SERVER-090 must land in this phase**, not after it.

That is a promotion, not a discovery: SERVER-090 was filed as P1 tidiness on
2026-08-10. It is now half of a spec guarantee.

## Applied to SPEC.md (2026-08-12)

§7's "Loop safety" bullet replaced in full; five other references removed —
§2.4's two "covers/undoes a bad upgrade", §4's read-back sentence and "One
action, one commit", and §15's M5 check.

## Acceptance Criteria

- [x] §7's loop-safety bullet replaced
- [x] Five consequential references removed; a sweep confirms only the rider's
      own marker still names the verb
- [ ] Follow-on issues filed and landed: CONTRACT-050, SERVER-104, CLI-040,
      AGENT-023, and **SERVER-090**
- [ ] The removal is verified as a removal: no `corpus skill rollback`, no route,
      no server module, nothing in `docs/cli.md`

## Technical Design

Spec text only. The follow-on issues carry the code.

### Files to Create/Modify

- `SPEC.md` — done.

## Testing Strategy

N/A — spec text.

## E2E Verification Log

_N/A — spec rider._

## Completion Checklist (orchestrator)

- [x] Applied to SPEC.md with signature marker
- [ ] Follow-on issues filed
- [ ] Committed with `[SHARED-042]` prefix
