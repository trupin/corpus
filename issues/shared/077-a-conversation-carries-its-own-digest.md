# [SHARED-077] A conversation carries its own digest — the §6 rider and the decomposition

## Domain

shared

## Status

done — rider signed by the user 2026-09-05 (quoted in full at proposal, signed
in the /goal), applied to SPEC.md §6 the same day on `phase-57-token-ledger`.

## Priority

P0

## Model

fable

## Dependencies

- Blocks: CONTRACT-096, SERVER-164, CLI-077, AGENT-069

## Spec References

- SPEC.md **§6** — the rider's home, after the per-turn model record (rider
  signed 2026-08-08, the precedent: derived data about turns, recorded outside
  them, server as sole writer of the record)

## Summary

CLI-077 measured the cost: a listener restart re-reads a 32,375-byte thread
whole. The digest — one per thread, written by the resident at reply time,
surfaced by the read verbs — cuts rehydration to ~7.5 KB and keeps it flat as
the conversation grows.

The rider text as signed (verbatim, now in §6):

> **A thread may carry a digest — one, written by its resident, never by the
> server.** A thread document's frontmatter may record a digest: a short prose
> account of the conversation so far, written by the agent resident on the
> thread at reply time, through the CLI. The server never generates, edits, or
> repairs a digest — a summary nobody wrote is worse than none. The digest
> records the timestamp of the newest turn it covers (its watermark). Deleting
> or revising a turn at or before the watermark marks the digest stale; the
> server records the staleness and changes nothing else. A stale digest is
> shown as stale wherever it is shown, and it is corrected only by a resident
> writing it again. Turns after the watermark are simply not yet covered, which
> is the ordinary state between a message landing and the resident's next
> reply. **Digests orient**: an agent quotes and edits from turns read
> verbatim, never from a digest. A thread with no digest is the ordinary state,
> not a fault. _(Rider signed 2026-09-05.)_

## The decomposition

| Issue | Domain | Carries |
| --- | --- | --- |
| CONTRACT-096 | contract | `digest` on `ThreadSchema` (`{body, watermark, stale}`, nullable), `PUT /api/threads/{id}/digest` |
| SERVER-164 | server | the write path (resident-gated), staleness on turn delete and revise, projection |
| CLI-077 | cli | `corpus thread digest set` (body via `-m`/`--file`/stdin, never argv), the digest block atop `thread show --index` |
| AGENT-069 | agent-runtime | converse writes the digest at reply time; the *digests orient* invariant in the skills |

Order is the table's order — contract first, consumers after, per CLAUDE.md.

## Acceptance Criteria

- [x] The rider is in SPEC.md §6, byte-identical to the signed text
- [x] The four issues are filed with PLAN rows
