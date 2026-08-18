# [SHARED-053] §7 says a renamed or archived profile goes missing; archiving does not

## Domain

shared

## Status

todo — **NEEDS USER SIGN-OFF.** Drafted 2026-08-18, not applied. SPEC.md changes
are the user's.

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Blocks: — (the false statements downstream are being corrected in PR #50
  without waiting for this)
- Related: SHARED-048 (the rider that carries the sentence), SHARED-049, -050,
  -051, -052 — **read one at a time**

## Spec References

- SPEC.md **§7** line 323 — the resident rider, signed 2026-08-17:
  > A profile that is renamed or archived after designation does not end the
  > designation: the resident goes on owning its scope, and the missing profile
  > is reported rather than silently substituted.

## Summary

Found by PR #50's third review, at one site. Chasing it found **five**, written
by four different agents, and one of them is a string a person reads.

**Archiving a profile does not make it missing.** Established two ways:

**By code.** `targetRows` (`apps/server/src/threads/mentions.ts:153-156`) is
`SELECT … WHERE type = ? ORDER BY id` with **no status filter**. `targetIndex`
skips a row on exactly one condition — the off-root gate. And archiving cannot
move an `agent-def`: `folderMove` (`apps/server/src/docs/archive.ts:124-138`)
only moves paths already under the two skill roots, so for every other type
archiving is a frontmatter write and the path — the sole input to the gate — is
untouched.

**Against a real server**, all four arms on one workspace:

| act on the profile | `resident` on the next `GET` |
| --- | --- |
| **archive** (stays in root) | `{"name":"scratch-persona","docId":"doc_5g4njtsp"}` — **unchanged** |
| moved out of the root by hand | `docId: null` |
| renamed | `docId: null` |
| deleted | `docId: null` |

An already-archived profile is also still **designatable**, verified live.

## Why the same false half appears five times

§7's sentence joins two cases with one verb — *"renamed or archived … the missing
profile is reported"* — and the first clause is true of both while the second is
true of only one. Every downstream author read it as one claim, which is exactly
what a spec sentence is for.

| site | what it says | kind |
| --- | --- | --- |
| `packages/kit/src/recipient/laneRows.ts:154` | `"its profile is gone — renamed or archived since"` | **a string a person reads** |
| `apps/cli/src/commands/thread/designate.ts` ×3 | one of them prints in `--help` and generates into `docs/cli.md` | user-facing |
| `packages/contract/src/schemas/agents.ts` | `docId` null causes | **corrected in PR #50** |
| six test and component comments | — | comments |
| `apps/server/src/threads/resident.test.ts:805` | quotes a contract string that no longer exists | stale quotation |

The worst is the first: the recipient picker tells a person their **working**
archived profile is gone. It is not gone, it still resolves, and a message
addressed to that lane reaches the same agent it always did.

**`deleted` was never listed anywhere**, and it is a real cause.

## The drafted text — read this back verbatim before applying

Replace the final sentence of §7's resident rider at line 323:

> A profile that is renamed, deleted, or moved out of `.claude/agents/` after
> designation does not end the designation: the resident goes on owning its
> scope, and the missing profile is reported rather than silently substituted.
> **Archiving is not one of those cases.** An archived profile is still under its
> root and still resolves, so the designation is unchanged and nothing is
> reported missing — an archived `agent-def` can even be designated in the first
> place. Archiving a profile withdraws it from the choices a workspace offers; it
> does not reach back into the conversations that already chose it.
> _(Rider signed 2026-08-\_\_.)_

## What the sign-off decides

1. **Whether the behaviour is right, or only the sentence is wrong.** The draft
   assumes the behaviour is right: a conversation that chose a persona should not
   lose it because somebody tidied the roster. If archiving *should* end the
   designation, this is a server issue instead and the sentence stays.
2. Whether the last clause — *"withdraws it from the choices a workspace offers;
   it does not reach back"* — belongs in normative text. It states the principle
   rather than the mechanism, which is what stops the next reader guessing again.
3. Whether `deleted` needs saying, given that a deleted document cannot resolve
   by construction. The draft says it, because five surfaces omitted it while
   listing two causes that are not exhaustive.

## Acceptance Criteria

- [ ] The user has signed the drafted text, verbatim, on its own
- [ ] §7's rider distinguishes archiving from the three causes that do null a
      profile
- [ ] `packages/kit/src/recipient/laneRows.ts`'s user-visible string no longer
      tells a person a working profile is gone
- [ ] The CLI's `--help` and the regenerated `docs/cli.md` agree
- [ ] The stale quotation in `apps/server/src/threads/resident.test.ts` is
      corrected or dropped
- [ ] One wording, pinned across the surfaces that state it — this claim reached
      five places because nothing held them together
- [ ] `npm run spec:check` passes

## Technical Design

### Files to Create/Modify

- `SPEC.md` — §7 line 323, the rider's final sentence only
- the five downstream sites listed above

### Key Implementation Details

**The downstream fixes do not wait for the signature.** A false statement shown
to a person is a defect whatever the spec says, and PR #50 corrects the contract,
the CLI and the kit string. What the signature buys is the sentence that stops it
recurring.

Quote rather than paraphrase when reading it back (SHARED-045).

## Testing Strategy

A pin holding the surfaces to one wording, in the shape CONTRACT-064 used — its
absence is why four agents wrote the same false half independently.

## E2E Verification Plan

### Verification Steps

1. `git diff SPEC.md` shows exactly the signed text
2. Designate a profile, archive it, and confirm the designation still resolves
   and the picker does not call it gone
3. `npm run spec:check` passes

## E2E Verification Log

_[Filled after sign-off]_

## Completion Checklist (domain agent)

- [ ] N/A — orchestrator-applied after sign-off

## Completion Checklist (orchestrator)

- [ ] Committed with `[SHARED-053]` prefix
