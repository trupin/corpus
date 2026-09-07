# [SHARED-079] What a document costs is measured, not felt — the token-accounting chain

## Domain

shared

## Status

done — decision and decomposition recorded 2026-09-06 (user directive); the
§9 rider below was SIGNED by the user 2026-09-06 — quoted verbatim in the release
proposal before any behaviour lands.

## Priority

P0

## Model

fable

## Dependencies

- Blocks: CONTRACT-097, SERVER-166, CLI-085, UI-190

## Spec References

- SPEC.md **§2** (CLI is the agent's surface), **§9** (server), **§10** (UI)

## Summary

User directive, 2026-09-06:

> "I'd like the CLI to track how many tokens it outputs and takes as input. I
> want the server to keep track of those measurements and I want measurements
> to show in the UI. […] The goal is to be able to measure how heavy documents
> really are and whether agents are able to deal with heavy documents in a way
> that makes token consumption flat. I'd like to be able to see the evolution
> of CLI command token cost over time for each document, available directly in
> that panel."

**Placement assumption, stated because the directive read two ways**: the
measurements panel lives on the document/thread's own view, NOT in the console
section — "I don't want to add a panel in the console section" is read as
rejecting the console placement, and "that panel" as the per-document one the
directive describes. Cheap to move if the reading is wrong.

## The design, held constant across the four issues

- **The unit is the house token**: bytes ÷ 4, the same deterministic estimate
  INFRA-038 and the Phase 57 ledger use. No tokenizer dependency — the value
  of the number is that `wc -c` reproduces it.
- **What is measured, per CLI invocation**: bytes the agent wrote (argv +
  stdin body) and bytes the agent read (stdout + stderr), per command path
  (`thread show`, `doc patch`, …), attributed to the document/thread ids the
  invocation named. One invocation touching two ids records against both.
- **Telemetry is runtime state, never a document**: it lives in the server's
  SQLite under `.corpus/`, beside the queue — not in files, not committed,
  not reconstructible by `db rebuild`, and `db doctor` treats its absence as
  ordinary (INFRA-033's rule: what the product should record, the product
  records — but telemetry is not corpus content).
- **Reporting must never slow the loop**: the CLI reports fire-and-forget
  after the command's own work, and a failed report is silent-to-the-agent,
  logged server-side. A measurement channel that adds a round-trip to every
  verb would tax the thing it measures.
- **The question the UI answers**: is cost flat as the document grows? So the
  panel plots command token cost over time per document, with the document's
  own size as the reference line — flat cost against a growing size is the
  bounded reads working; cost tracking size is an agent reading whole.

## The rider — signed 2026-09-06, applied to SPEC.md as §9.4

For §9 (server) with §2/§10 cross-references:

> **The workspace measures what its own surface costs.** Every `corpus`
> invocation reports, after its work is done, the size of what the caller
> wrote and what the command printed — counted deterministically as bytes,
> shown as the workspace's token estimate — attributed to the documents and
> threads the invocation named. The server keeps these measurements as
> runtime state beside the queue: they are telemetry about using the corpus,
> not part of it — never a document, never committed, absent after a rebuild
> and none the worse for it. Each document's view can show its own cost over
> time, beside its size, so "is working with this document getting more
> expensive as it grows?" is answered by looking rather than by feeling. A
> report that fails to arrive costs the command nothing and is never retried:
> the measurements are advisory, and no verb's outcome may depend on the
> telemetry channel. _(Rider signed 2026-09-06.)_

## Decomposition

| Issue | Domain | Carries |
| --- | --- | --- |
| CONTRACT-097 | contract | the ingestion route + the per-document series query |
| SERVER-166 | server | storage, retention, doctor/rebuild posture |
| CLI-085 | cli | measuring + fire-and-forget reporting in the dispatcher |
| UI-190 | ui | the per-document panel with the time series |

Order: contract → server → cli → ui; the rider signs before any of it lands.

## The §9.2 catalogue amendment, drafted for signature (PR #76 review, finding 4)

§9.2's route catalogue does not yet list the two telemetry routes. The
behaviour is fully covered by the signed §9.4 rider; the catalogue bullets
are the bookkeeping §9.2's history lands via sign-off. Drafted:

> - `POST /api/telemetry/invocations` — ingest one invocation's cost report,
>   or a batch of them (§9.4). Fire-and-forget from the caller's side: `204`
>   with no body, and a report naming no known document is kept rather than
>   refused.
> - `GET /api/docs/{id}/cost` — a document's cost series (§9.4): daily
>   buckets of written/read token estimates and invocation counts, the
>   totals, the document's current size, and when measuring began.
>
> _(Amendment signed — date to be filled at signature.)_
